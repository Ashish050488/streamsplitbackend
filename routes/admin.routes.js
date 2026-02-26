const router = require('express').Router();
const mongoose = require('mongoose');
const { authenticate, requireRole } = require('../middleware/auth');
const User = require('../models/User');
const Order = require('../models/Order');
const WalletAccount = require('../models/WalletAccount');
const WalletTransaction = require('../models/WalletTransaction');
const Group = require('../models/Group');
const GroupMembership = require('../models/GroupMembership');
const Coupon = require('../models/Coupon');
const Brand = require('../models/Brand');
const Plan = require('../models/Plan');
const Category = require('../models/Category');

// All routes require admin
router.use(authenticate, requireRole('admin', 'super_admin'));

// ─── Overview Stats ──────────────────────────────────────────
router.get('/overview', async (req, res, next) => {
    try {
        const [totalUsers, totalOrders, totalGroups, activeGroups, recentUsers, recentOrders, revenueAgg] = await Promise.all([
            User.countDocuments(),
            Order.countDocuments(),
            Group.countDocuments(),
            Group.countDocuments({ status: 'active' }),
            User.find().sort({ createdAt: -1 }).limit(10).select('name phone role status createdAt last_login_at'),
            Order.find().sort({ createdAt: -1 }).limit(10).select('order_number user_id total status payment_method createdAt'),
            Order.aggregate([
                { $match: { status: 'fulfilled' } },
                { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } },
            ]),
        ]);

        const revenue = revenueAgg[0]?.total || 0;
        const fulfilledCount = revenueAgg[0]?.count || 0;

        res.json({
            success: true,
            data: {
                stats: { totalUsers, totalOrders, fulfilledCount, revenue, totalGroups, activeGroups },
                recentUsers,
                recentOrders,
            },
        });
    } catch (err) { next(err); }
});

// ─── User Management ─────────────────────────────────────────
router.get('/users', async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const filter = {};

        if (req.query.search) {
            filter.$or = [
                { name: { $regex: req.query.search, $options: 'i' } },
                { phone: { $regex: req.query.search, $options: 'i' } },
            ];
        }
        if (req.query.role) filter.role = req.query.role;
        if (req.query.status) filter.status = req.query.status;

        const [users, total] = await Promise.all([
            User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).select('-__v'),
            User.countDocuments(filter),
        ]);

        // Attach wallet balances
        const userIds = users.map(u => u._id);
        const wallets = await WalletAccount.find({ user_id: { $in: userIds } }).select('user_id balance');
        const walletMap = {};
        wallets.forEach(w => { walletMap[w.user_id.toString()] = w.balance; });

        const enriched = users.map(u => ({
            ...u.toObject(),
            wallet_balance: walletMap[u._id.toString()] || 0,
        }));

        res.json({ success: true, data: enriched, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (err) { next(err); }
});

router.get('/users/:id', async (req, res, next) => {
    try {
        const user = await User.findById(req.params.id).select('-__v');
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        const [wallet, orders, transactions, memberships] = await Promise.all([
            WalletAccount.findOne({ user_id: user._id }),
            Order.find({ user_id: user._id }).sort({ createdAt: -1 }).limit(20),
            WalletTransaction.find({}).populate('wallet_id').sort({ createdAt: -1 }).limit(20),
            GroupMembership.find({ user_id: user._id }).populate('group_id'),
        ]);

        // Filter transactions for this user's wallet
        const userTxns = wallet ? await WalletTransaction.find({ wallet_id: wallet._id }).sort({ createdAt: -1 }).limit(20) : [];

        res.json({
            success: true,
            data: {
                user,
                wallet: wallet || { balance: 0 },
                orders,
                transactions: userTxns,
                groups: memberships.map(m => m.group_id).filter(Boolean),
            },
        });
    } catch (err) { next(err); }
});

router.patch('/users/:id', async (req, res, next) => {
    try {
        const allowed = ['role', 'status', 'name'];
        const updates = {};
        allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

        // Prevent changing own role
        if (req.params.id === req.user._id.toString() && updates.role) {
            return res.status(400).json({ success: false, message: 'Cannot change your own role' });
        }

        const user = await User.findByIdAndUpdate(req.params.id, updates, { new: true }).select('-__v');
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        res.json({ success: true, data: user });
    } catch (err) { next(err); }
});

// ─── Order Management ────────────────────────────────────────
router.get('/orders', async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const filter = {};

        if (req.query.status) filter.status = req.query.status;
        if (req.query.user_id) filter.user_id = req.query.user_id;

        const [orders, total] = await Promise.all([
            Order.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
            Order.countDocuments(filter),
        ]);

        res.json({ success: true, data: orders, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (err) { next(err); }
});

router.patch('/orders/:id', async (req, res, next) => {
    try {
        const allowed = ['status'];
        const updates = {};
        allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

        const order = await Order.findByIdAndUpdate(req.params.id, updates, { new: true });
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

        res.json({ success: true, data: order });
    } catch (err) { next(err); }
});

// ─── Group Management ────────────────────────────────────────
router.get('/groups', async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;

        const [groups, total] = await Promise.all([
            Group.find().populate('brand_id', 'name logo_url').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
            Group.countDocuments(),
        ]);

        res.json({ success: true, data: groups, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (err) { next(err); }
});

// ─── Coupon Management ───────────────────────────────────────
router.get('/coupons', async (req, res, next) => {
    try {
        const coupons = await Coupon.find().sort({ createdAt: -1 });
        res.json({ success: true, data: coupons });
    } catch (err) { next(err); }
});

router.post('/coupons', async (req, res, next) => {
    try {
        const { code, type, value, max_discount, min_order_value, usage_limit, valid_until } = req.body;
        if (!code || !type || value === undefined) {
            return res.status(400).json({ success: false, message: 'code, type, and value are required' });
        }
        const coupon = await Coupon.create({
            code: code.toUpperCase(), type, value,
            max_discount: max_discount || 0,
            min_order_value: min_order_value || 0,
            usage_limit: usage_limit || -1,
            valid_until: valid_until || null,
        });
        res.json({ success: true, data: coupon });
    } catch (err) { next(err); }
});

router.patch('/coupons/:id', async (req, res, next) => {
    try {
        const allowed = ['is_active', 'value', 'max_discount', 'min_order_value', 'usage_limit', 'valid_until'];
        const updates = {};
        allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

        const coupon = await Coupon.findByIdAndUpdate(req.params.id, updates, { new: true });
        if (!coupon) return res.status(404).json({ success: false, message: 'Coupon not found' });

        res.json({ success: true, data: coupon });
    } catch (err) { next(err); }
});

// ─── Brand Management ────────────────────────────────────────
router.get('/brands', async (req, res, next) => {
    try {
        const brands = await Brand.find().populate('category_id', 'name').sort({ name: 1 });
        // Attach plan counts
        const brandIds = brands.map(b => b._id);
        const planCounts = await Plan.aggregate([
            { $match: { brand_id: { $in: brandIds } } },
            { $group: { _id: '$brand_id', count: { $sum: 1 } } },
        ]);
        const countMap = {};
        planCounts.forEach(p => { countMap[p._id.toString()] = p.count; });

        const enriched = brands.map(b => ({
            ...b.toObject(),
            plan_count: countMap[b._id.toString()] || 0,
        }));

        res.json({ success: true, data: enriched });
    } catch (err) { next(err); }
});

router.post('/brands', async (req, res, next) => {
    try {
        const { name, slug, category_id, logo_url, cover_url, description, tags, is_featured } = req.body;
        if (!name || !slug || !category_id) {
            return res.status(400).json({ success: false, message: 'name, slug, and category_id are required' });
        }
        const brand = await Brand.create({ name, slug, category_id, logo_url, cover_url, description, tags, is_featured });
        res.json({ success: true, data: brand });
    } catch (err) { next(err); }
});

router.patch('/brands/:id', async (req, res, next) => {
    try {
        const allowed = ['name', 'slug', 'logo_url', 'cover_url', 'description', 'tags', 'is_featured', 'is_active', 'category_id'];
        const updates = {};
        allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

        const brand = await Brand.findByIdAndUpdate(req.params.id, updates, { new: true });
        if (!brand) return res.status(404).json({ success: false, message: 'Brand not found' });

        res.json({ success: true, data: brand });
    } catch (err) { next(err); }
});

// ─── Withdrawal Management ───────────────────────────────────
const WithdrawalRequest = require('../models/WithdrawalRequest');
const EarningsAccount = require('../models/EarningsAccount');

router.get('/withdrawals', async (req, res, next) => {
    try {
        const filter = {};
        if (req.query.status) filter.status = req.query.status;
        if (req.query.source) filter.source = req.query.source;
        const requests = await WithdrawalRequest.find(filter)
            .populate('owner_id', 'name phone')
            .sort({ createdAt: -1 });
        res.json({ success: true, data: requests });
    } catch (err) { next(err); }
});

router.post('/withdrawals/:id/approve', async (req, res, next) => {
    try {
        const wr = await WithdrawalRequest.findById(req.params.id);
        if (!wr) return res.status(404).json({ success: false, message: 'Withdrawal request not found' });
        if (wr.status !== 'requested') {
            return res.status(400).json({ success: false, message: `Cannot approve — status is ${wr.status}` });
        }

        // Try Razorpay Payout if RazorpayX credentials exist
        const rpxKeyId = process.env.RAZORPAYX_KEY_ID || process.env.RAZORPAY_KEY_ID;
        const rpxKeySecret = process.env.RAZORPAYX_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET;
        const rpxAccountNo = process.env.RAZORPAYX_ACCOUNT_NUMBER;

        if (rpxAccountNo && rpxKeyId && !rpxKeyId.includes('xxxxx')) {
            // Real RazorpayX Payout
            const Razorpay = require('razorpay');
            const rpx = new Razorpay({ key_id: rpxKeyId, key_secret: rpxKeySecret });

            wr.status = 'processing';
            await wr.save();

            try {
                const fundAccount = wr.payout_method === 'upi'
                    ? { account_type: 'vpa', vpa: { address: wr.payout_details.upi_id } }
                    : { account_type: 'bank_account', bank_account: { name: wr.payout_details.account_holder, ifsc: wr.payout_details.ifsc_code, account_number: wr.payout_details.account_number } };

                const payout = await rpx.payouts?.create?.({
                    account_number: rpxAccountNo,
                    fund_account: fundAccount,
                    amount: Math.round(wr.amount * 100),
                    currency: 'INR',
                    mode: wr.payout_method === 'upi' ? 'UPI' : 'NEFT',
                    purpose: 'payout',
                }) || {};

                wr.razorpay_payout_id = payout.id || `payout_${Date.now()}`;
                wr.utr = payout.utr || '';
                wr.status = payout.status === 'processed' ? 'paid' : 'processing';
                await wr.save();
            } catch (payoutErr) {
                // Payout failed — refund balance and mark rejected
                console.error('Payout API error:', payoutErr.message);
                // Refund based on source
                if (wr.source === 'wallet') {
                    const WalletAccount = require('../models/WalletAccount');
                    await WalletAccount.findOneAndUpdate(
                        { user_id: wr.owner_id },
                        { $inc: { balance: wr.amount } }
                    );
                } else {
                    await EarningsAccount.findOneAndUpdate(
                        { user_id: wr.owner_id },
                        { $inc: { withdrawable_balance: wr.amount } }
                    );
                }
                wr.status = 'rejected';
                wr.reject_reason = `Payout API error: ${payoutErr.message}`;
                await wr.save();
                return res.status(500).json({ success: false, message: 'Payout failed', error: payoutErr.message });
            }
        } else {
            // No RazorpayX — mark as paid (DEV mode)
            wr.status = 'paid';
            wr.razorpay_payout_id = `dev_payout_${Date.now()}`;
            await wr.save();
        }

        res.json({ success: true, data: wr });
    } catch (err) { next(err); }
});

router.post('/withdrawals/:id/reject', async (req, res, next) => {
    try {
        const wr = await WithdrawalRequest.findById(req.params.id);
        if (!wr) return res.status(404).json({ success: false, message: 'Not found' });
        if (!['requested', 'approved'].includes(wr.status)) {
            return res.status(400).json({ success: false, message: `Cannot reject — status is ${wr.status}` });
        }

        // Refund the amount based on source
        if (wr.source === 'wallet') {
            const WalletAccount = require('../models/WalletAccount');
            await WalletAccount.findOneAndUpdate(
                { user_id: wr.owner_id },
                { $inc: { balance: wr.amount } }
            );
        } else {
            await EarningsAccount.findOneAndUpdate(
                { user_id: wr.owner_id },
                { $inc: { withdrawable_balance: wr.amount } }
            );
        }

        wr.status = 'rejected';
        wr.reject_reason = req.body.reject_reason || 'Rejected by admin';
        await wr.save();

        res.json({ success: true, data: wr });
    } catch (err) { next(err); }
});

module.exports = router;
