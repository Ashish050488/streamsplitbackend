const router = require('express').Router();
const Razorpay = require('razorpay');
const Group = require('../models/Group');
const GroupMembership = require('../models/GroupMembership');
const GroupTransaction = require('../models/GroupTransaction');
const EarningsAccount = require('../models/EarningsAccount');
const Brand = require('../models/Brand');
const BRAND = require('../../brand.config');
const ChatMessage = require('../models/ChatMessage');
const { authenticate, optionalAuth } = require('../middleware/auth');

// Razorpay instance (may be null if keys not configured)
let razorpay = null;
if (process.env.RAZORPAY_KEY_ID && !process.env.RAZORPAY_KEY_ID.includes('xxxxx')) {
  razorpay = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
}

// ─── GET /groups/public ──────────────────────────────────────
router.get('/public', optionalAuth, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const filter = { is_public: true, status: { $in: ['waiting', 'active'] } };
    if (req.query.search) filter.$text = { $search: req.query.search };
    const groups = await Group.find(filter)
      .populate('brand_id', 'name logo_url slug')
      .populate('created_by', 'name')
      .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit);
    const total = await Group.countDocuments(filter);
    res.json({ success: true, data: groups, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
});

// ─── GET /groups/my ──────────────────────────────────────────
router.get('/my', authenticate, async (req, res, next) => {
  try {
    const memberships = await GroupMembership.find({ user_id: req.user._id })
      .populate({ path: 'group_id', populate: [{ path: 'brand_id', select: 'name logo_url slug' }, { path: 'created_by', select: 'name' }] });
    const groups = memberships
      .filter(m => m.group_id) // guard against deleted groups
      .map(m => ({ ...m.group_id.toObject(), membership_role: m.role }));
    res.json({ success: true, data: groups });
  } catch (err) { next(err); }
});

// ─── GET /groups/owned ───────────────────────────────────────
router.get('/owned', authenticate, async (req, res, next) => {
  try {
    const memberships = await GroupMembership.find({ user_id: req.user._id, role: 'owner' })
      .populate({ path: 'group_id', populate: { path: 'brand_id', select: 'name logo_url slug' } });
    const groups = memberships.filter(m => m.group_id).map(m => m.group_id);
    res.json({ success: true, data: groups });
  } catch (err) { next(err); }
});

// ─── POST /groups — Create group ─────────────────────────────
router.post('/', authenticate, async (req, res, next) => {
  try {
    const { name, description, brand_id, share_price, share_limit, duration_days, is_public } = req.body;
    if (!name || !share_price || share_price <= 0) {
      return res.status(400).json({ success: false, message: 'Name and share_price are required' });
    }

    const group = await Group.create({
      name,
      description: description || '',
      brand_id: brand_id || null,
      share_price,
      share_limit: Math.min(share_limit || 5, 20),
      duration_days: duration_days || 30,
      is_public: is_public !== false,
      created_by: req.user._id,
      status: 'waiting',
      member_count: 1, // owner counts as member
    });

    // Create owner membership
    await GroupMembership.create({ group_id: group._id, user_id: req.user._id, role: 'owner' });

    // Ensure owner has an EarningsAccount
    await EarningsAccount.findOneAndUpdate(
      { user_id: req.user._id },
      { $setOnInsert: { user_id: req.user._id, withdrawable_balance: 0, total_earned: 0 } },
      { upsert: true }
    );

    res.status(201).json({ success: true, data: group });
  } catch (err) { next(err); }
});

// ─── GET /groups/invite/:code — Resolve invite code ──────────
router.get('/invite/:code', async (req, res, next) => {
  try {
    const group = await Group.findOne({ invite_code: req.params.code })
      .populate('brand_id', 'name logo_url slug')
      .populate('created_by', 'name');
    if (!group) return res.status(404).json({ success: false, message: 'Invalid invite code' });

    const seatsLeft = group.share_limit - group.member_count;
    res.json({
      success: true,
      data: {
        ...group.toObject(),
        seats_left: Math.max(seatsLeft, 0),
        platform_fee_percent: BRAND.platformCutPercent,
      },
    });
  } catch (err) { next(err); }
});

// ─── POST /groups/:id/join/initiate — Create Razorpay Order ──
router.post('/:id/join/initiate', authenticate, async (req, res, next) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ success: false, message: 'Group not found' });
    if (group.status === 'archived') return res.status(400).json({ success: false, message: 'Group is archived' });
    if (group.member_count >= group.share_limit) return res.status(400).json({ success: false, message: 'Group is full' });

    // Check if already a member
    const existing = await GroupMembership.findOne({ group_id: group._id, user_id: req.user._id });
    if (existing) return res.status(400).json({ success: false, message: 'Already a member of this group' });

    // Check if there's already a pending transaction for this user+group
    const pendingTx = await GroupTransaction.findOne({
      group_id: group._id, buyer_id: req.user._id, status: 'pending',
    });
    if (pendingTx && pendingTx.razorpay_order_id) {
      // Return existing pending order
      return res.json({
        success: true,
        data: {
          group_id: group._id,
          group_name: group.name,
          amount: pendingTx.gross,
          razorpay: razorpay ? {
            order_id: pendingTx.razorpay_order_id,
            amount: Math.round(pendingTx.gross * 100),
            currency: BRAND.currency.code,
            key_id: process.env.RAZORPAY_KEY_ID,
          } : null,
          dev_mode: !razorpay,
          transaction_id: pendingTx._id,
        },
      });
    }

    const feePercent = BRAND.platformCutPercent;
    const gross = group.share_price;
    const feeAmount = Math.round(gross * feePercent) / 100;
    const net = gross - feeAmount;

    // Find group owner
    const ownerMembership = await GroupMembership.findOne({ group_id: group._id, role: 'owner' });
    if (!ownerMembership) return res.status(500).json({ success: false, message: 'Group has no owner' });

    if (razorpay) {
      // Real Razorpay
      const rpOrder = await razorpay.orders.create({
        amount: Math.round(gross * 100),
        currency: BRAND.currency.code,
        receipt: `grp_${group._id}_${req.user._id}`,
        notes: { group_id: group._id.toString(), buyer_id: req.user._id.toString() },
      });

      const tx = await GroupTransaction.create({
        group_id: group._id,
        owner_id: ownerMembership.user_id,
        buyer_id: req.user._id,
        gross, fee_percent: feePercent, fee_amount: feeAmount, net,
        razorpay_order_id: rpOrder.id,
        status: 'pending',
      });

      res.json({
        success: true,
        data: {
          group_id: group._id,
          group_name: group.name,
          amount: gross,
          razorpay: {
            order_id: rpOrder.id,
            amount: rpOrder.amount,
            currency: rpOrder.currency,
            key_id: process.env.RAZORPAY_KEY_ID,
          },
          transaction_id: tx._id,
        },
      });
    } else {
      // DEV mode — simulate payment
      const devPaymentId = `dev_pay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const devOrderId = `dev_ord_${Date.now()}`;

      const tx = await GroupTransaction.create({
        group_id: group._id,
        owner_id: ownerMembership.user_id,
        buyer_id: req.user._id,
        gross, fee_percent: feePercent, fee_amount: feeAmount, net,
        razorpay_order_id: devOrderId,
        razorpay_payment_id: devPaymentId,
        status: 'paid',
      });

      // DEV: immediately add membership + credit owner
      await GroupMembership.create({ group_id: group._id, user_id: req.user._id, role: 'member' });

      const updated = await Group.findByIdAndUpdate(
        group._id,
        { $inc: { member_count: 1 } },
        { new: true }
      );

      // If group is now full, activate
      if (updated.member_count >= updated.share_limit) {
        updated.status = 'active';
        updated.start_date = new Date();
        updated.end_date = new Date(Date.now() + (updated.duration_days || 30) * 86400000);
        await updated.save();
      }

      // Credit owner earnings
      await EarningsAccount.findOneAndUpdate(
        { user_id: ownerMembership.user_id },
        { $inc: { withdrawable_balance: net, total_earned: net } },
        { upsert: true }
      );

      res.json({
        success: true,
        data: {
          group_id: group._id,
          group_name: group.name,
          amount: gross,
          dev_mode: true,
          payment_complete: true,
          transaction_id: tx._id,
          message: 'DEV mode: payment auto-completed, membership created',
        },
      });
    }
  } catch (err) { next(err); }
});

// ─── POST /groups/:id/leave ──────────────────────────────────
router.post('/:id/leave', authenticate, async (req, res, next) => {
  try {
    // Owners cannot leave their own group
    const membership = await GroupMembership.findOne({ group_id: req.params.id, user_id: req.user._id });
    if (!membership) return res.status(404).json({ success: false, message: 'Not a member' });
    if (membership.role === 'owner') return res.status(400).json({ success: false, message: 'Owners cannot leave. Archive the group instead.' });

    await GroupMembership.deleteOne({ _id: membership._id });
    await Group.findByIdAndUpdate(req.params.id, { $inc: { member_count: -1 } });
    res.json({ success: true, message: 'Left group' });
  } catch (err) { next(err); }
});

// ─── POST /groups/:id/archive — Owner archives group ─────────
router.post('/:id/archive', authenticate, async (req, res, next) => {
  try {
    const membership = await GroupMembership.findOne({ group_id: req.params.id, user_id: req.user._id, role: 'owner' });
    if (!membership) return res.status(403).json({ success: false, message: 'Only the owner can archive' });
    const group = await Group.findByIdAndUpdate(req.params.id, { status: 'archived' }, { new: true });
    res.json({ success: true, data: group });
  } catch (err) { next(err); }
});

// ─── GET /groups/:id/members — Members roster ───────────────
router.get('/:id/members', authenticate, async (req, res, next) => {
  try {
    const uid = req.user._id;
    const membership = await GroupMembership.findOne({ group_id: req.params.id, user_id: uid });
    if (!membership) return res.status(403).json({ success: false, message: 'Not a member of this group' });

    const group = await Group.findById(req.params.id).select('name share_limit member_count created_by');
    if (!group) return res.status(404).json({ success: false, message: 'Group not found' });

    const members = await GroupMembership.find({ group_id: req.params.id })
      .populate('user_id', 'name phone avatar_url')
      .sort({ role: 1, joined_at: 1 });

    const maskPhone = (phone) => {
      if (!phone || phone.length < 6) return '****';
      return phone.slice(0, 4) + '******' + phone.slice(-2);
    };

    const memberList = members.map(m => ({
      user_id: m.user_id._id,
      name: m.user_id.name || 'User',
      phone_masked: maskPhone(m.user_id.phone),
      role: m.role === 'owner' ? 'OWNER' : 'MEMBER',
      joined_at: m.joined_at,
      is_you: m.user_id._id.toString() === uid.toString(),
    }));

    res.json({
      success: true,
      data: {
        group: {
          _id: group._id,
          name: group.name,
          share_limit: group.share_limit,
          member_count: group.member_count,
          owner_id: group.created_by,
        },
        members: memberList,
      },
    });
  } catch (err) { next(err); }
});

// ─── GET /groups/:id/rules — Get rules + onboarding ─────────
router.get('/:id/rules', authenticate, async (req, res, next) => {
  try {
    const membership = await GroupMembership.findOne({ group_id: req.params.id, user_id: req.user._id, status: { $ne: 'left' } });
    if (!membership) return res.status(403).json({ success: false, message: 'Not a member' });
    const group = await Group.findById(req.params.id).select('rules onboarding_steps');
    if (!group) return res.status(404).json({ success: false, message: 'Group not found' });
    res.json({ success: true, data: { rules: group.rules, onboarding_steps: group.onboarding_steps } });
  } catch (err) { next(err); }
});

// ─── PATCH /groups/:id/rules — Update rules + onboarding ────
router.patch('/:id/rules', authenticate, async (req, res, next) => {
  try {
    const membership = await GroupMembership.findOne({ group_id: req.params.id, user_id: req.user._id, role: 'owner' });
    if (!membership) return res.status(403).json({ success: false, message: 'Only the owner can update rules' });

    const updates = {};
    if (req.body.rules !== undefined) {
      const r = req.body.rules;
      // Accept structured { title, bullets } or plain string
      if (typeof r === 'object' && r !== null) {
        if (r.title && r.title.length > 60) return res.status(400).json({ success: false, message: 'Title max 60 characters' });
        if (!Array.isArray(r.bullets) || r.bullets.length === 0) return res.status(400).json({ success: false, message: 'At least 1 rule required' });
        if (r.bullets.length > 12) return res.status(400).json({ success: false, message: 'Maximum 12 rules' });
        const invalid = r.bullets.find(b => typeof b !== 'string' || b.length > 140);
        if (invalid !== undefined) return res.status(400).json({ success: false, message: 'Each rule max 140 characters' });
        updates.rules = JSON.stringify({ title: (r.title || '').trim(), bullets: r.bullets.map(b => b.trim()).filter(Boolean) });
      } else {
        updates.rules = r;
      }
    }
    if (req.body.onboarding_steps !== undefined) updates.onboarding_steps = req.body.onboarding_steps;
    const group = await Group.findByIdAndUpdate(req.params.id, updates, { new: true }).select('rules onboarding_steps');
    res.json({ success: true, data: { rules: group.rules, onboarding_steps: group.onboarding_steps } });
  } catch (err) { next(err); }
});

// ─── POST /groups/:id/announcements — Create announcement ───
router.post('/:id/announcements', authenticate, async (req, res, next) => {
  try {
    const membership = await GroupMembership.findOne({ group_id: req.params.id, user_id: req.user._id, role: 'owner' });
    if (!membership) return res.status(403).json({ success: false, message: 'Only the owner can post announcements' });
    const { text, pinned } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ success: false, message: 'Text is required' });

    // Find or create group room
    const ChatRoom = require('../models/ChatRoom');
    let room = await ChatRoom.findOne({ type: 'group', group_id: req.params.id });
    if (!room) room = await ChatRoom.create({ type: 'group', group_id: req.params.id, participants: [] });

    // If pinned, unpin previous
    if (pinned) {
      await ChatMessage.updateMany({ room_id: room._id, type: 'announcement', pinned: true }, { pinned: false });
    }

    const msg = await ChatMessage.create({
      room_id: room._id, group_id: req.params.id, sender_id: req.user._id,
      type: 'announcement', content: text.trim(), pinned: !!pinned,
    });

    await ChatRoom.findByIdAndUpdate(room._id, { last_message_at: msg.createdAt, last_message_preview: `📢 ${text.trim().substring(0, 60)}` });

    const populated = await ChatMessage.findById(msg._id).populate('sender_id', 'name avatar_url phone');
    res.status(201).json({ success: true, data: populated });
  } catch (err) { next(err); }
});

// ─── POST /groups/:id/vault — Post vault credentials ────────
router.post('/:id/vault', authenticate, async (req, res, next) => {
  try {
    const membership = await GroupMembership.findOne({ group_id: req.params.id, user_id: req.user._id, role: 'owner' });
    if (!membership) return res.status(403).json({ success: false, message: 'Only the owner can post credentials' });

    const { email, password, notes } = req.body;
    if (!email && !password) return res.status(400).json({ success: false, message: 'Email or password required' });

    const { encryptVaultData } = require('../lib/vault-crypto');
    const encryptedMeta = encryptVaultData({ email, password, notes });

    const ChatRoom = require('../models/ChatRoom');
    let room = await ChatRoom.findOne({ type: 'group', group_id: req.params.id });
    if (!room) room = await ChatRoom.create({ type: 'group', group_id: req.params.id, participants: [] });

    const msg = await ChatMessage.create({
      room_id: room._id, group_id: req.params.id, sender_id: req.user._id,
      type: 'vault', content: '🔐 Credentials updated', metadata: encryptedMeta,
    });

    await ChatRoom.findByIdAndUpdate(room._id, { last_message_at: msg.createdAt, last_message_preview: '🔐 Credentials updated' });

    const populated = await ChatMessage.findById(msg._id).populate('sender_id', 'name avatar_url phone');
    res.status(201).json({ success: true, data: { _id: populated._id, type: 'vault', content: populated.content, sender_id: populated.sender_id, createdAt: populated.createdAt } });
  } catch (err) { next(err); }
});

// ─── GET /groups/:id/vault/latest — Get latest credentials ──
router.get('/:id/vault/latest', authenticate, async (req, res, next) => {
  try {
    const membership = await GroupMembership.findOne({ group_id: req.params.id, user_id: req.user._id, status: { $ne: 'left' } });
    if (!membership) return res.status(403).json({ success: false, message: 'Not a member' });

    const ChatRoom = require('../models/ChatRoom');
    const room = await ChatRoom.findOne({ type: 'group', group_id: req.params.id });
    if (!room) return res.json({ success: true, data: null });

    const msg = await ChatMessage.findOne({ room_id: room._id, type: 'vault', is_deleted: false }).sort({ createdAt: -1 });
    if (!msg) return res.json({ success: true, data: null });

    const { decryptVaultData } = require('../lib/vault-crypto');
    const decrypted = decryptVaultData(msg.metadata);
    res.json({ success: true, data: { _id: msg._id, ...decrypted, posted_at: msg.createdAt } });
  } catch (err) { next(err); }
});

// ─── POST /groups/:id/invites — Create group invite ─────────
router.post('/:id/invites', authenticate, async (req, res, next) => {
  try {
    const membership = await GroupMembership.findOne({ group_id: req.params.id, user_id: req.user._id, status: { $ne: 'left' } });
    if (!membership) return res.status(403).json({ success: false, message: 'Not a member' });

    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ success: false, message: 'Group not found' });

    const isOwner = membership.role === 'owner';
    if (!isOwner && !group.allow_member_invites) {
      return res.status(403).json({ success: false, message: 'Member invites are disabled' });
    }

    const GroupInvite = require('../models/GroupInvite');
    const invite = await GroupInvite.create({
      group_id: group._id,
      created_by: req.user._id,
      created_by_role: isOwner ? 'owner' : 'member',
      status: 'active',
    });

    res.status(201).json({ success: true, data: invite });
  } catch (err) { next(err); }
});

// ─── POST /groups/:id/contact-host — Create support thread ──
router.post('/:id/contact-host', authenticate, async (req, res, next) => {
  try {
    const membership = await GroupMembership.findOne({ group_id: req.params.id, user_id: req.user._id, status: { $ne: 'left' } });
    if (!membership) return res.status(403).json({ success: false, message: 'Not a member' });

    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ success: false, message: 'Group not found' });

    const ChatRoom = require('../models/ChatRoom');
    // Find existing support room for this user+group or create new
    let room = await ChatRoom.findOne({ type: 'support', group_id: group._id, participants: req.user._id });
    if (!room) {
      room = await ChatRoom.create({
        type: 'support', group_id: group._id,
        participants: [req.user._id, group.created_by],
      });
    }

    // Send initial message if provided
    const text = (req.body.text || '').trim();
    if (text) {
      const msg = await ChatMessage.create({
        room_id: room._id, group_id: group._id, sender_id: req.user._id,
        type: 'text', content: text,
      });
      await ChatRoom.findByIdAndUpdate(room._id, { last_message_at: msg.createdAt, last_message_preview: text.substring(0, 80) });
    }

    res.json({ success: true, data: { room_id: room._id } });
  } catch (err) { next(err); }
});

// ─── POST /groups/:id/logged-out — "I got logged out" ───────
router.post('/:id/logged-out', authenticate, async (req, res, next) => {
  try {
    const membership = await GroupMembership.findOne({ group_id: req.params.id, user_id: req.user._id, status: { $ne: 'left' } });
    if (!membership) return res.status(403).json({ success: false, message: 'Not a member' });

    const ChatRoom = require('../models/ChatRoom');
    let room = await ChatRoom.findOne({ type: 'group', group_id: req.params.id });
    if (!room) room = await ChatRoom.create({ type: 'group', group_id: req.params.id, participants: [] });

    const User = require('../models/User');
    const user = await User.findById(req.user._id).select('name');
    const msg = await ChatMessage.create({
      room_id: room._id, group_id: req.params.id, sender_id: req.user._id,
      type: 'system', content: `${user?.name || 'A member'} needs login help (OTP/logout).`,
      metadata: { action: 'logged_out' },
    });

    await ChatRoom.findByIdAndUpdate(room._id, { last_message_at: msg.createdAt, last_message_preview: msg.content.substring(0, 80) });

    res.json({ success: true, message: 'Help request sent to group chat' });
  } catch (err) { next(err); }
});

module.exports = router;
