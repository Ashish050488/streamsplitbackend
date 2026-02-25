const router = require('express').Router();
const mongoose = require('mongoose');
const WalletAccount = require('../models/WalletAccount');
const WalletTransaction = require('../models/WalletTransaction');
const { authenticate } = require('../middleware/auth');
const BRAND = require('../../brand.config');

router.get('/', authenticate, async (req, res, next) => {
  try {
    let wallet = await WalletAccount.findOne({ user_id: req.user._id });
    if (!wallet) wallet = await WalletAccount.create({ user_id: req.user._id });
    res.json({ success: true, data: wallet });
  } catch (err) { next(err); }
});

router.get('/transactions', authenticate, async (req, res, next) => {
  try {
    const wallet = await WalletAccount.findOne({ user_id: req.user._id });
    if (!wallet) return res.json({ success: true, data: [] });
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const txns = await WalletTransaction.find({ wallet_id: wallet._id })
      .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit);
    res.json({ success: true, data: txns });
  } catch (err) { next(err); }
});

router.post('/topup', authenticate, async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const { amount } = req.body;
    if (!amount || amount < BRAND.wallet.minTopup || amount > BRAND.wallet.maxTopup) {
      return res.status(400).json({ success: false, message: `Amount must be between ${BRAND.formatPrice(BRAND.wallet.minTopup)} and ${BRAND.formatPrice(BRAND.wallet.maxTopup)}` });
    }

    const wallet = await WalletAccount.findOne({ user_id: req.user._id }).session(session);
    if (!wallet) throw new Error('Wallet not found');
    if (wallet.balance + amount > BRAND.wallet.maxBalance) {
      return res.status(400).json({ success: false, message: `Max wallet balance is ${BRAND.formatPrice(BRAND.wallet.maxBalance)}` });
    }

    wallet.balance += amount;
    await wallet.save({ session });

    await WalletTransaction.create([{
      wallet_id: wallet._id, type: 'credit', amount,
      balance_after: wallet.balance, source: 'topup',
      description: `Wallet top-up of ${BRAND.formatPrice(amount)}`,
    }], { session });

    await session.commitTransaction();
    res.json({ success: true, data: wallet });
  } catch (err) {
    await session.abortTransaction();
    next(err);
  } finally { session.endSession(); }
});

module.exports = router;
