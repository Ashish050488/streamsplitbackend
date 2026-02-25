const router = require('express').Router();
const GroupTransaction = require('../models/GroupTransaction');
const EarningsAccount = require('../models/EarningsAccount');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const GroupMembership = require('../models/GroupMembership');
const BRAND = require('../../brand.config');
const { authenticate } = require('../middleware/auth');

// ─── GET /earnings/summary ───────────────────────────────────
router.get('/summary', authenticate, async (req, res, next) => {
    try {
        let account = await EarningsAccount.findOne({ user_id: req.user._id });
        if (!account) {
            account = { withdrawable_balance: 0, total_earned: 0 };
        }

        // Count owned groups
        const ownedGroups = await GroupMembership.countDocuments({ user_id: req.user._id, role: 'owner' });

        // Total pending withdrawals
        const pendingWithdrawals = await WithdrawalRequest.aggregate([
            { $match: { owner_id: req.user._id, status: { $in: ['requested', 'approved', 'processing'] } } },
            { $group: { _id: null, total: { $sum: '$amount' } } },
        ]);

        res.json({
            success: true,
            data: {
                withdrawable_balance: account.withdrawable_balance,
                total_earned: account.total_earned,
                owned_groups: ownedGroups,
                pending_withdrawals: pendingWithdrawals[0]?.total || 0,
                min_withdrawal: BRAND.payouts.minWithdrawal,
                payouts_enabled: BRAND.payouts.enabled,
                platform_cut_percent: BRAND.platformCutPercent,
            },
        });
    } catch (err) { next(err); }
});

// ─── GET /earnings/transactions ──────────────────────────────
router.get('/transactions', authenticate, async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const txns = await GroupTransaction.find({ owner_id: req.user._id, status: 'paid' })
            .populate('group_id', 'name')
            .populate('buyer_id', 'name phone')
            .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit);
        const total = await GroupTransaction.countDocuments({ owner_id: req.user._id, status: 'paid' });
        res.json({ success: true, data: txns, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (err) { next(err); }
});

module.exports = router;
