const router = require('express').Router();
const Razorpay = require('razorpay');
const Group = require('../models/Group');
const GroupMembership = require('../models/GroupMembership');
const GroupTransaction = require('../models/GroupTransaction');
const EarningsAccount = require('../models/EarningsAccount');
const Brand = require('../models/Brand');
const BRAND = require('../../brand.config');
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

module.exports = router;
