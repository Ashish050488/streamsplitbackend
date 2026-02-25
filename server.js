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
  const { auth, wallet: w, ...publicConfig } = BRAND;
  // Strip sensitive config, expose only frontend-safe fields
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
app.use('/api/v1/groups', require('./routes/group.routes'));
app.use('/api/v1/payments', require('./routes/payment.routes'));
app.use('/api/v1/earnings', require('./routes/earnings.routes'));
app.use('/api/v1/withdrawals', require('./routes/withdrawal.routes'));
app.use('/api/v1/coupons', require('./routes/coupon.routes'));
app.use('/api/v1/admin', require('./routes/admin.routes'));
app.use('/api/v1/friends', require('./routes/friend.routes'));
app.use('/api/v1/chat', require('./routes/chat.routes'));

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
