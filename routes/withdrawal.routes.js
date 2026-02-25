const router = require('express').Router();
const WithdrawalRequest = require('../models/WithdrawalRequest');
const EarningsAccount = require('../models/EarningsAccount');
const BRAND = require('../../brand.config');
const { authenticate } = require('../middleware/auth');

// ─── POST /withdrawals/request ───────────────────────────────
router.post('/request', authenticate, async (req, res, next) => {
    try {
        if (!BRAND.payouts.enabled) {
            return res.status(400).json({ success: false, message: 'Payouts are currently disabled' });
        }

        const { amount, payout_method, payout_details } = req.body;
        if (!amount || amount < BRAND.payouts.minWithdrawal) {
            return res.status(400).json({ success: false, message: `Minimum withdrawal is ${BRAND.currency.symbol}${BRAND.payouts.minWithdrawal}` });
        }
        if (!['upi', 'bank'].includes(payout_method)) {
            return res.status(400).json({ success: false, message: 'payout_method must be upi or bank' });
        }
        if (payout_method === 'upi' && !payout_details?.upi_id) {
            return res.status(400).json({ success: false, message: 'UPI ID is required' });
        }
        if (payout_method === 'bank' && (!payout_details?.account_number || !payout_details?.ifsc_code)) {
            return res.status(400).json({ success: false, message: 'Bank account number and IFSC are required' });
        }

        const account = await EarningsAccount.findOne({ user_id: req.user._id });
        if (!account || account.withdrawable_balance < amount) {
            return res.status(400).json({ success: false, message: 'Insufficient withdrawable balance' });
        }

        // Check for existing pending requests
        const pendingCount = await WithdrawalRequest.countDocuments({
            owner_id: req.user._id,
            status: { $in: ['requested', 'approved', 'processing'] },
        });
        if (pendingCount > 0) {
            return res.status(400).json({ success: false, message: 'You already have a pending withdrawal request' });
        }

        // Deduct from withdrawable_balance atomically
        const updated = await EarningsAccount.findOneAndUpdate(
            { user_id: req.user._id, withdrawable_balance: { $gte: amount } },
            { $inc: { withdrawable_balance: -amount } },
            { new: true }
        );
        if (!updated) {
            return res.status(400).json({ success: false, message: 'Balance changed, please retry' });
        }

        const wr = await WithdrawalRequest.create({
            owner_id: req.user._id,
            amount,
            payout_method,
            payout_details,
        });

        res.status(201).json({ success: true, data: wr });
    } catch (err) { next(err); }
});

// ─── GET /withdrawals/my ─────────────────────────────────────
router.get('/my', authenticate, async (req, res, next) => {
    try {
        const requests = await WithdrawalRequest.find({ owner_id: req.user._id })
            .sort({ createdAt: -1 });
        res.json({ success: true, data: requests });
    } catch (err) { next(err); }
});

module.exports = router;
