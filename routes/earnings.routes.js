const router = require('express').Router();
const GroupTransaction = require('../models/GroupTransaction');
const EarningsAccount = require('../models/EarningsAccount');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const GroupMembership = require('../models/GroupMembership');
const BRAND = require('../../brand.config');
const { authenticate } = require('../middleware/auth');

// ─── Helper: mature pending earnings ─────────────────────────
// On-read maturation: move any matured pending amounts to withdrawable
async function maturePendingEarnings(userId) {
    const holdHours = BRAND.money.withdrawalHoldHours || 0;
    if (holdHours <= 0) return; // no hold = nothing to mature

    const cutoff = new Date(Date.now() - holdHours * 3600000);

    // Find paid transactions for this owner that are past the hold window
    const maturedTxns = await GroupTransaction.find({
        owner_id: userId,
        status: 'paid',
        pending_release_at: { $ne: null, $lte: new Date() },
    });

    if (maturedTxns.length === 0) return;

    const totalToMature = maturedTxns.reduce((sum, tx) => sum + tx.net, 0);
    if (totalToMature <= 0) return;

    // Move from pending to withdrawable
    await EarningsAccount.findOneAndUpdate(
        { user_id: userId },
        { $inc: { pending_balance: -totalToMature, withdrawable_balance: totalToMature } }
    );

    // Clear pending_release_at so they don't get processed again
    const txIds = maturedTxns.map(tx => tx._id);
    await GroupTransaction.updateMany(
        { _id: { $in: txIds } },
        { $set: { pending_release_at: null } }
    );
}

// ─── GET /earnings/summary ───────────────────────────────────
router.get('/summary', authenticate, async (req, res, next) => {
    try {
        // Mature any pending earnings first
        await maturePendingEarnings(req.user._id);

        let account = await EarningsAccount.findOne({ user_id: req.user._id });
        if (!account) {
            account = { withdrawable_balance: 0, pending_balance: 0, total_earned: 0 };
        }

        // Count owned groups
        const ownedGroups = await GroupMembership.countDocuments({ user_id: req.user._id, role: 'owner' });

        // Total pending withdrawals
        const pendingWithdrawals = await WithdrawalRequest.aggregate([
            { $match: { owner_id: req.user._id, source: 'earnings', status: { $in: ['requested', 'approved', 'processing'] } } },
            { $group: { _id: null, total: { $sum: '$amount' } } },
        ]);

        res.json({
            success: true,
            data: {
                withdrawable_balance: account.withdrawable_balance,
                pending_balance: account.pending_balance || 0,
                total_earned: account.total_earned,
                owned_groups: ownedGroups,
                pending_withdrawals: pendingWithdrawals[0]?.total || 0,
                // All money config from single source of truth
                min_withdrawal: BRAND.money.minWithdrawal,
                earnings_withdraw_enabled: BRAND.money.earningsWithdrawEnabled,
                platform_cut_percent: BRAND.money.platformCutPercent,
                withdrawal_hold_hours: BRAND.money.withdrawalHoldHours,
            },
        });
    } catch (err) { next(err); }
});

// ─── GET /earnings/transactions ──────────────────────────────
router.get('/transactions', authenticate, async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const filter = { owner_id: req.user._id, status: 'paid' };

        if (req.query.from || req.query.to) {
            filter.createdAt = {};
            if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
            if (req.query.to) filter.createdAt.$lte = new Date(req.query.to);
        }

        const [txns, total] = await Promise.all([
            GroupTransaction.find(filter)
                .populate('group_id', 'name')
                .populate('buyer_id', 'name phone')
                .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
            GroupTransaction.countDocuments(filter),
        ]);
        res.json({ success: true, data: txns, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (err) { next(err); }
});

// ─── GET /earnings/transactions/export.csv ───────────────────
router.get('/transactions/export.csv', authenticate, async (req, res, next) => {
    try {
        const filter = { owner_id: req.user._id, status: 'paid' };
        if (req.query.from || req.query.to) {
            filter.createdAt = {};
            if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
            if (req.query.to) filter.createdAt.$lte = new Date(req.query.to);
        }

        const txns = await GroupTransaction.find(filter)
            .populate('group_id', 'name')
            .populate('buyer_id', 'name phone')
            .sort({ createdAt: -1 }).limit(500);

        const rows = ['Date,Group,Buyer,Gross,Platform Fee,Fee %,Net,Status'];
        txns.forEach(t => {
            rows.push(`"${new Date(t.createdAt).toISOString()}","${t.group_id?.name || ''}","${t.buyer_id?.name || ''}","${t.gross}","${t.fee_amount}","${t.fee_percent}%","${t.net}","${t.status}"`);
        });

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=earnings_statement.csv');
        res.send(rows.join('\n'));
    } catch (err) { next(err); }
});

module.exports = router;
