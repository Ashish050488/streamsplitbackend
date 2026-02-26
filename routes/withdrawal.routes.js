const router = require('express').Router();
const mongoose = require('mongoose');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const EarningsAccount = require('../models/EarningsAccount');
const WalletAccount = require('../models/WalletAccount');
const WalletTransaction = require('../models/WalletTransaction');
const BRAND = require('../../brand.config');
const { authenticate } = require('../middleware/auth');

// ─── POST /withdrawals/request ───────────────────────────────
router.post('/request', authenticate, async (req, res, next) => {
    try {
        const { amount, payout_method, payout_details, source = 'earnings' } = req.body;
        const M = BRAND.money;

        // Validate source
        if (!['wallet', 'earnings'].includes(source)) {
            return res.status(400).json({ success: false, message: 'source must be wallet or earnings' });
        }
        if (source === 'wallet' && !M.walletWithdrawEnabled) {
            return res.status(400).json({ success: false, message: 'Wallet withdrawals are not enabled' });
        }
        if (source === 'earnings' && !M.earningsWithdrawEnabled) {
            return res.status(400).json({ success: false, message: 'Earnings withdrawals are not enabled' });
        }

        // Min withdrawal from config
        if (!amount || amount < M.minWithdrawal) {
            return res.status(400).json({ success: false, message: `Minimum withdrawal is ${BRAND.currency.symbol}${M.minWithdrawal}` });
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

        // Check for existing pending requests for same source
        const pendingCount = await WithdrawalRequest.countDocuments({
            owner_id: req.user._id, source,
            status: { $in: ['requested', 'approved', 'processing'] },
        });
        if (pendingCount > 0) {
            return res.status(400).json({ success: false, message: 'You already have a pending withdrawal request for this source' });
        }

        // Deduct balance atomically
        if (source === 'earnings') {
            const account = await EarningsAccount.findOneAndUpdate(
                { user_id: req.user._id, withdrawable_balance: { $gte: amount } },
                { $inc: { withdrawable_balance: -amount } },
                { new: true }
            );
            if (!account) {
                return res.status(400).json({ success: false, message: 'Insufficient withdrawable earnings balance' });
            }
        } else {
            // source === 'wallet'
            const wallet = await WalletAccount.findOneAndUpdate(
                { user_id: req.user._id, balance: { $gte: amount } },
                { $inc: { balance: -amount } },
                { new: true }
            );
            if (!wallet) {
                return res.status(400).json({ success: false, message: 'Insufficient wallet balance' });
            }
            // Record wallet transaction
            await WalletTransaction.create({
                wallet_id: wallet._id, type: 'debit', amount,
                balance_after: wallet.balance, source: 'purchase',
                description: `Withdrawal request of ${BRAND.currency.symbol}${amount}`,
            });
        }

        const wr = await WithdrawalRequest.create({
            owner_id: req.user._id,
            source,
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
        const filter = { owner_id: req.user._id };
        if (req.query.source) filter.source = req.query.source;
        if (req.query.status) filter.status = req.query.status;
        const requests = await WithdrawalRequest.find(filter)
            .sort({ createdAt: -1 });
        res.json({ success: true, data: requests });
    } catch (err) { next(err); }
});

module.exports = router;
