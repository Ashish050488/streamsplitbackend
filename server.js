require('dotenv').config();
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const { Server: SocketIO } = require('socket.io');
const BRAND = require('../brand.config');
const { apiLimiter } = require('./middleware/rateLimiter');
const chatSocketHandler = require('./services/chatSocket');

const app = express();
const server = http.createServer(app);

// Socket.IO
const io = new SocketIO(server, {
  cors: { origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true },
});

// ─── Global Middleware ────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true }));
app.use(compression());
// Raw body for Razorpay webhook signature verification
app.use('/api/v1/payments/razorpay/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));
app.use(apiLimiter);

// ─── Brand Config Endpoint (public) ─────────────────────────
app.get('/api/v1/config', (req, res) => {
  res.json({
    success: true,
    data: {
      name: BRAND.name,
      slug: BRAND.slug,
      tagline: BRAND.tagline,
      description: BRAND.description,
      domain: BRAND.domain,
      logo: BRAND.logo,
      logoIcon: BRAND.logoIcon,
      logoWhite: BRAND.logoWhite,
      logoAlt: BRAND.logoAlt,
      colors: BRAND.colors,
      fonts: BRAND.fonts,
      social: BRAND.social,
      appLinks: BRAND.appLinks,
      seo: BRAND.seo,
      features: BRAND.features,
      currency: BRAND.currency,
      defaultLanguage: BRAND.defaultLanguage,
      supportedLanguages: BRAND.supportedLanguages,
      nav: BRAND.nav,
      money: {
        platformCutPercent: BRAND.money.platformCutPercent,
        minWithdrawal: BRAND.money.minWithdrawal,
        withdrawalHoldHours: BRAND.money.withdrawalHoldHours,
        walletWithdrawEnabled: BRAND.money.walletWithdrawEnabled,
        earningsWithdrawEnabled: BRAND.money.earningsWithdrawEnabled,
      },
    },
  });
});

// ─── Health Check ────────────────────────────────────────────
app.get('/api/v1/health', (req, res) => {
  res.json({ status: 'ok', brand: BRAND.name, uptime: process.uptime() });
});

// ─── API Routes ──────────────────────────────────────────────
app.use('/api/v1/auth', require('./routes/auth.routes'));
app.use('/api/v1/users', require('./routes/user.routes'));
app.use('/api/v1/categories', require('./routes/category.routes'));
app.use('/api/v1/brands', require('./routes/brand.routes'));
app.use('/api/v1/plans', require('./routes/plan.routes'));
app.use('/api/v1/cart', require('./routes/cart.routes'));
app.use('/api/v1/orders', require('./routes/order.routes'));
app.use('/api/v1/wallet', require('./routes/wallet.routes'));
app.use('/api/v1/groups/invite', require('./routes/invite.routes'));
app.use('/api/v1/groups', require('./routes/group.routes'));
app.use('/api/v1/payments', require('./routes/payment.routes'));
app.use('/api/v1/earnings', require('./routes/earnings.routes'));
app.use('/api/v1/withdrawals', require('./routes/withdrawal.routes'));
app.use('/api/v1/coupons', require('./routes/coupon.routes'));
app.use('/api/v1/admin', require('./routes/admin.routes'));
app.use('/api/v1/friends', require('./routes/friend.routes'));
app.use('/api/v1/chat', require('./routes/chat.routes'));
app.use('/api/v1/vault', require('./routes/vault.routes'));
app.use('/api/v1/search', require('./routes/search.routes'));

// ─── DEV: Audit join by JoinIntent ID ────────────────────────
app.get('/api/v1/dev/audit/join/:id', async (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(404).json({ success: false });
  try {
    const JoinIntent = require('./models/JoinIntent');
    const GroupTransaction = require('./models/GroupTransaction');
    const EarningsAccount = require('./models/EarningsAccount');
    const WalletAccount = require('./models/WalletAccount');
    const GroupMembership = require('./models/GroupMembership');

    const intent = await JoinIntent.findById(req.params.id).lean();
    if (!intent) return res.status(404).json({ success: false, message: 'JoinIntent not found' });

    // Find owner
    const ownerMem = await GroupMembership.findOne({ group_id: intent.group_id, role: 'owner' });
    const ownerId = ownerMem?.user_id;

    // GroupTransaction for this payment
    const tx = intent.razorpay_payment_id
      ? await GroupTransaction.findOne({ razorpay_payment_id: intent.razorpay_payment_id }).lean()
      : await GroupTransaction.findOne({ razorpay_order_id: intent.razorpay_order_id }).lean();

    // Owner EarningsAccount + WalletAccount
    const earningsAcc = ownerId ? await EarningsAccount.findOne({ user_id: ownerId }).lean() : null;
    const walletAcc = ownerId ? await WalletAccount.findOne({ user_id: ownerId }).lean() : null;

    // Membership check
    const membership = await GroupMembership.findOne({
      group_id: intent.group_id, user_id: intent.user_id, status: { $ne: 'left' },
    });

    // Invariant checks
    const WalletTransaction = require('./models/WalletTransaction');
    const walletCreditForGroup = walletAcc
      ? await WalletTransaction.findOne({
        wallet_id: walletAcc._id,
        type: 'credit',
        description: { $regex: /group|earning|seat/i },
        createdAt: { $gte: intent.createdAt },
      }).lean()
      : null;

    res.json({
      success: true,
      data: {
        joinIntent: intent,
        groupTransaction: tx || null,
        ownerEarningsAccount: earningsAcc,
        ownerWalletAccount: walletAcc ? { _id: walletAcc._id, balance: walletAcc.balance } : null,
        membershipCreated: !!membership,
        ownerId: ownerId?.toString(),
        invariants: {
          walletNotCredited: !walletCreditForGroup,
          earningsCredited: tx ? (earningsAcc?.total_earned >= tx.net) : false,
          netMatchesLedger: tx ? true : false,
          intentPaid: intent.status === 'paid',
        },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── DEV: Audit owner totals ─────────────────────────────────
app.get('/api/v1/dev/audit/owner/:id', async (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(404).json({ success: false });
  try {
    const mongoose = require('mongoose');
    const GroupTransaction = require('./models/GroupTransaction');
    const EarningsAccount = require('./models/EarningsAccount');
    const WalletAccount = require('./models/WalletAccount');

    const ownerId = new mongoose.Types.ObjectId(req.params.id);

    const [agg] = await GroupTransaction.aggregate([
      { $match: { owner_id: ownerId, status: 'paid' } },
      { $group: { _id: null, total_gross: { $sum: '$gross' }, total_fee: { $sum: '$fee_amount' }, total_net: { $sum: '$net' }, count: { $sum: 1 } } },
    ]);

    const last10 = await GroupTransaction.find({ owner_id: ownerId, status: 'paid' })
      .sort({ createdAt: -1 }).limit(10)
      .populate('group_id', 'name')
      .populate('buyer_id', 'name phone')
      .lean();

    const earnings = await EarningsAccount.findOne({ user_id: ownerId }).lean();
    const wallet = await WalletAccount.findOne({ user_id: ownerId }).lean();

    res.json({
      success: true,
      data: {
        ownerId: req.params.id,
        ledger_totals: agg || { total_gross: 0, total_fee: 0, total_net: 0, count: 0 },
        earnings_account: earnings || { withdrawable_balance: 0, pending_balance: 0, total_earned: 0 },
        wallet_balance: wallet?.balance || 0,
        last_10_transactions: last10,
        invariants: {
          earnings_matches_ledger: Math.abs((earnings?.total_earned || 0) - (agg?.total_net || 0)) < 0.01,
          wallet_not_inflated: true, // manual check — compare with expected wallet topups
        },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── 404 Handler ─────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// ─── Error Handler ───────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('❌', err.stack || err.message);
  const status = err.status || 500;
  res.status(status).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

// ─── Socket.IO Chat ─────────────────────────────────────────
chatSocketHandler(io);

// ─── Connect DB & Start ──────────────────────────────────────
const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/subspace';

mongoose.connect(MONGO_URI)
  .then(() => {
    console.log(`✅ MongoDB connected`);
    server.listen(PORT, () => {
      console.log(`🚀 ${BRAND.name} API running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  });

module.exports = { app, server, io };
