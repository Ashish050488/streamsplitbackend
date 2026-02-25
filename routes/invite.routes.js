const router = require('express').Router();
const mongoose = require('mongoose');
const Razorpay = require('razorpay');
const Group = require('../models/Group');
const GroupMembership = require('../models/GroupMembership');
const GroupInvite = require('../models/GroupInvite');
const JoinIntent = require('../models/JoinIntent');
const { authenticate, optionalAuth } = require('../middleware/auth');

let razorpay = null;
if (process.env.RAZORPAY_KEY_ID && !process.env.RAZORPAY_KEY_ID.includes('xxxxx')) {
    razorpay = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
}

// ─── Helper: validate invite ──────────────────────────────────
async function resolveInviteByCode(code) {
    const normalized = (code || '').trim().toUpperCase();
    if (!normalized) return { error: 'MISSING_CODE', status: 400 };

    const invite = await GroupInvite.findOne({ code: new RegExp(`^${normalized}$`, 'i') });
    if (!invite) return { error: 'NOT_FOUND', status: 404 };
    if (invite.status !== 'active') return { error: 'DISABLED', status: 410 };
    if (invite.expires_at && new Date() > invite.expires_at) return { error: 'EXPIRED', status: 410 };
    if (invite.max_uses && invite.uses_count >= invite.max_uses) return { error: 'MAX_USES', status: 410 };

    const group = await Group.findById(invite.group_id)
        .populate('brand_id', 'name slug logo_url')
        .populate('created_by', 'name');
    if (!group) return { error: 'GROUP_NOT_FOUND', status: 404 };

    return { invite, group };
}

// ─── GET /invite/:code — Resolve invite (public) ─────────────
router.get('/:code', optionalAuth, async (req, res, next) => {
    try {
        const result = await resolveInviteByCode(req.params.code);
        if (result.error) {
            const msg = result.error === 'NOT_FOUND' ? 'Invalid invite code'
                : result.error === 'EXPIRED' ? 'Invite has expired — ask for a new link'
                    : result.error === 'MAX_USES' ? 'Invite has reached its usage limit'
                        : result.error === 'DISABLED' ? 'Invite is no longer active'
                            : 'Invalid invite';
            return res.status(result.status).json({ success: false, error: result.error, message: msg });
        }

        const { group, invite } = result;
        const seatsLeft = Math.max(0, (group.share_limit || 5) - (group.member_count || 0));

        res.json({
            success: true,
            data: {
                _id: group._id,
                name: group.name,
                description: group.description,
                brand_id: group.brand_id,
                share_price: group.share_price,
                share_limit: group.share_limit,
                member_count: group.member_count,
                max_members: group.share_limit,
                seats_left: seatsLeft,
                owner: group.created_by ? { name: group.created_by.name } : null,
                invite_code: invite.code,
                expires_at: invite.expires_at,
            },
        });
    } catch (err) { next(err); }
});

// ─── POST /invite/:code/join/initiate — Start join payment ───
router.post('/:code/join/initiate', authenticate, async (req, res, next) => {
    try {
        const result = await resolveInviteByCode(req.params.code);
        if (result.error) {
            return res.status(result.status).json({ success: false, error: result.error, message: 'Invite is invalid or expired' });
        }

        const { group, invite } = result;

        // Check not already member
        const existing = await GroupMembership.findOne({
            group_id: group._id, user_id: req.user._id, status: { $ne: 'left' },
        });
        if (existing) return res.status(409).json({ success: false, error: 'ALREADY_MEMBER', message: 'You are already a member of this group' });

        // Check seats
        const seatsLeft = (group.share_limit || 5) - (group.member_count || 0);
        if (seatsLeft <= 0) return res.status(409).json({ success: false, error: 'GROUP_FULL', message: 'No seats available' });

        // Check no pending intent
        const pendingIntent = await JoinIntent.findOne({ user_id: req.user._id, group_id: group._id, status: 'initiated' });
        if (pendingIntent) {
            return res.json({
                success: true,
                data: {
                    joinIntentId: pendingIntent._id,
                    amount: pendingIntent.amount,
                    currency: pendingIntent.currency,
                    payment_method: pendingIntent.payment_method,
                    razorpay_order_id: pendingIntent.razorpay_order_id,
                    razorpay_key_id: process.env.RAZORPAY_KEY_ID || null,
                },
            });
        }

        const amount = group.share_price || 0;
        const paymentMethod = req.body.payment_method || 'dev';
        const intentData = {
            invite_code: invite.code,
            group_id: group._id,
            user_id: req.user._id,
            amount,
            currency: 'INR',
            payment_method: paymentMethod,
        };

        // Free group — join immediately
        if (amount === 0) {
            intentData.status = 'paid';
            const intent = await JoinIntent.create(intentData);
            await joinGroup(group, req.user._id, invite);
            return res.json({ success: true, data: { joinIntentId: intent._id, joined: true, group_id: group._id }, message: 'Joined successfully (free group)' });
        }

        // Wallet payment
        if (paymentMethod === 'wallet') {
            const Wallet = require('../models/Wallet');
            const wallet = await Wallet.findOne({ user_id: req.user._id });
            if (!wallet || wallet.balance < amount) {
                return res.status(402).json({ success: false, error: 'INSUFFICIENT_FUNDS', message: 'Not enough wallet balance' });
            }
            wallet.balance -= amount;
            await wallet.save();
            intentData.status = 'paid';
            const intent = await JoinIntent.create(intentData);
            await joinGroup(group, req.user._id, invite);
            return res.json({ success: true, data: { joinIntentId: intent._id, joined: true, group_id: group._id }, message: 'Joined successfully (wallet)' });
        }

        // Razorpay
        if (paymentMethod === 'razorpay' && razorpay) {
            const order = await razorpay.orders.create({
                amount: Math.round(amount * 100),
                currency: 'INR',
                receipt: `join_${group._id}_${req.user._id}`.substring(0, 40),
            });
            intentData.razorpay_order_id = order.id;
            const intent = await JoinIntent.create(intentData);
            return res.json({
                success: true,
                data: {
                    joinIntentId: intent._id,
                    amount: order.amount,
                    currency: order.currency,
                    razorpay_order_id: order.id,
                    razorpay_key_id: process.env.RAZORPAY_KEY_ID,
                },
            });
        }

        // Dev fallback — create intent, let dev confirm manually
        const intent = await JoinIntent.create(intentData);
        return res.json({
            success: true,
            data: {
                joinIntentId: intent._id,
                amount,
                currency: 'INR',
                payment_method: 'dev',
            },
        });
    } catch (err) { next(err); }
});

// ─── POST /invite/:code/join/confirm — Dev confirmation ──────
router.post('/:code/join/confirm', authenticate, async (req, res, next) => {
    try {
        // Only allow in non-production
        if (process.env.NODE_ENV === 'production') {
            return res.status(403).json({ success: false, message: 'Dev confirm not available in production' });
        }

        const { joinIntentId } = req.body;
        if (!joinIntentId) return res.status(400).json({ success: false, message: 'joinIntentId required' });

        const intent = await JoinIntent.findOne({ _id: joinIntentId, user_id: req.user._id, status: 'initiated' });
        if (!intent) return res.status(404).json({ success: false, message: 'No pending join intent found' });

        const group = await Group.findById(intent.group_id);
        if (!group) return res.status(404).json({ success: false, message: 'Group not found' });

        const invite = await GroupInvite.findOne({ code: new RegExp(`^${intent.invite_code}$`, 'i'), status: 'active' });
        if (!invite) return res.status(410).json({ success: false, message: 'Invite no longer valid' });

        // Mark paid
        intent.status = 'paid';
        await intent.save();

        await joinGroup(group, req.user._id, invite);

        res.json({ success: true, data: { group_id: group._id }, message: 'Joined successfully' });
    } catch (err) { next(err); }
});

// ─── Helper: atomically join group ────────────────────────────
async function joinGroup(group, userId, invite) {
    // Double check not already member
    const existing = await GroupMembership.findOne({ group_id: group._id, user_id: userId, status: { $ne: 'left' } });
    if (existing) return;

    await GroupMembership.create({
        group_id: group._id,
        user_id: userId,
        role: 'member',
        status: 'active',
    });

    const updated = await Group.findByIdAndUpdate(group._id, { $inc: { member_count: 1 } }, { new: true });

    // If group is now full, activate it
    if (updated && updated.member_count >= updated.share_limit && updated.status === 'waiting') {
        updated.status = 'active';
        updated.start_date = new Date();
        updated.end_date = new Date(Date.now() + (updated.duration_days || 30) * 24 * 60 * 60 * 1000);
        await updated.save();
    }

    // Increment invite uses
    await GroupInvite.findByIdAndUpdate(invite._id, { $inc: { uses_count: 1 } });
}

module.exports = router;
