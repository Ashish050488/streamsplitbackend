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

// ─── GET /wallet/transactions — with filters ─────────────────
router.get('/transactions', authenticate, async (req, res, next) => {
  try {
    const wallet = await WalletAccount.findOne({ user_id: req.user._id });
    if (!wallet) return res.json({ success: true, data: [], pagination: { page: 1, limit: 20, total: 0, pages: 0 } });

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const filter = { wallet_id: wallet._id };

    // Filters
    if (req.query.type) filter.type = req.query.type; // 'credit' or 'debit'
    if (req.query.source) filter.source = req.query.source;
    if (req.query.search) {
      filter.description = { $regex: req.query.search, $options: 'i' };
    }
    if (req.query.from || req.query.to) {
      filter.createdAt = {};
      if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
      if (req.query.to) filter.createdAt.$lte = new Date(req.query.to);
    }

    const [txns, total] = await Promise.all([
      WalletTransaction.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      WalletTransaction.countDocuments(filter),
    ]);
    res.json({ success: true, data: txns, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
});

// ─── GET /wallet/transactions/export.csv ─────────────────────
router.get('/transactions/export.csv', authenticate, async (req, res, next) => {
  try {
    const wallet = await WalletAccount.findOne({ user_id: req.user._id });
    if (!wallet) return res.status(404).json({ success: false, message: 'No wallet found' });

    const filter = { wallet_id: wallet._id };
    if (req.query.type) filter.type = req.query.type;
    if (req.query.from || req.query.to) {
      filter.createdAt = {};
      if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
      if (req.query.to) filter.createdAt.$lte = new Date(req.query.to);
    }

    const txns = await WalletTransaction.find(filter).sort({ createdAt: -1 }).limit(500);
    const rows = ['Date,Type,Source,Amount,Balance After,Description'];
    txns.forEach(t => {
      rows.push(`"${new Date(t.createdAt).toISOString()}","${t.type}","${t.source}","${t.amount}","${t.balance_after}","${(t.description || '').replace(/"/g, '""')}"`);
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=wallet_statement.csv');
    res.send(rows.join('\n'));
  } catch (err) { next(err); }
});

// ─── POST /wallet/topup ──────────────────────────────────────
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
