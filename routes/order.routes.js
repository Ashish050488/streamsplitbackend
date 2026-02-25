const router = require('express').Router();
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const Razorpay = require('razorpay');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const WalletAccount = require('../models/WalletAccount');
const WalletTransaction = require('../models/WalletTransaction');
const Coupon = require('../models/Coupon');
const BRAND = require('../../brand.config');
const { authenticate } = require('../middleware/auth');

// ─── Razorpay Instance ──────────────────────────────────────────
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const generateOrderNumber = () => {
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `ORD-${date}-${uuidv4().slice(0, 6).toUpperCase()}`;
};

// ─── GET /orders — user order history ────────────────────────────
router.get('/', authenticate, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const orders = await Order.find({ user_id: req.user._id })
      .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit);
    const total = await Order.countDocuments({ user_id: req.user._id });
    res.json({ success: true, data: orders, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
});

// ─── POST /orders/checkout — Wallet or Razorpay ─────────────────
router.post('/checkout', authenticate, async (req, res, next) => {
  try {
    const cart = await Cart.findOne({ user_id: req.user._id, status: 'active' });
    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ success: false, message: 'Cart is empty' });
    }

    const payment_method = req.body.payment_method || 'razorpay';
    const idempotency_key = req.body.idempotency_key || uuidv4();

    // Idempotency — prevent double-processing
    const existingOrder = await Order.findOne({ idempotency_key });
    if (existingOrder) {
      return res.json({ success: true, data: { order: existingOrder, message: 'Order already exists (idempotent)' } });
    }

    // Increment coupon usage
    if (cart.coupon_code) {
      await Coupon.updateOne({ code: cart.coupon_code }, { $inc: { used_count: 1 } });
    }

    const orderData = {
      order_number: generateOrderNumber(),
      user_id: req.user._id,
      items: cart.items.map(i => ({
        plan_id: i.plan_id,
        plan_snapshot: i.plan_snapshot,
        quantity: i.quantity,
        unit_price: i.plan_snapshot.price,
      })),
      coupon_code: cart.coupon_code,
      subtotal: cart.subtotal,
      discount: cart.discount,
      total: cart.total,
      payment_method,
      idempotency_key,
    };

    if (payment_method === 'wallet') {
      // ─── Wallet Checkout ───────────────────────────────
      const wallet = await WalletAccount.findOne({ user_id: req.user._id });
      if (!wallet) {
        return res.status(400).json({ success: false, message: 'Wallet not found' });
      }
      if (wallet.balance < cart.total) {
        return res.status(400).json({
          success: false,
          message: `Insufficient wallet balance. You have ${BRAND.formatPrice(wallet.balance)} but need ${BRAND.formatPrice(cart.total)}`,
        });
      }

      // Atomic debit with balance guard
      const updated = await WalletAccount.findOneAndUpdate(
        { _id: wallet._id, balance: { $gte: cart.total } },
        { $inc: { balance: -cart.total } },
        { new: true }
      );
      if (!updated) {
        return res.status(400).json({ success: false, message: 'Wallet debit failed — balance may have changed' });
      }

      await WalletTransaction.create({
        wallet_id: wallet._id, type: 'debit', amount: cart.total,
        balance_after: updated.balance, source: 'purchase',
        description: `Payment for order ${orderData.order_number}`,
        reference_type: 'Order', idempotency_key: `wal-${idempotency_key}`,
      });

      orderData.status = 'fulfilled';
      const order = await Order.create(orderData);

      cart.status = 'checked_out';
      await cart.save();

      res.json({ success: true, data: { order, payment_status: 'completed' } });

    } else {
      // ─── Razorpay Checkout ─────────────────────────────
      // 1) Create our pending order first
      orderData.status = 'pending';
      const order = await Order.create(orderData);

      // 2) Create Razorpay order (amount in paise)
      const rpOrder = await razorpay.orders.create({
        amount: Math.round(cart.total * 100),
        currency: BRAND.currency.code,
        receipt: order.order_number,
        notes: {
          order_id: order._id.toString(),
          user_id: req.user._id.toString(),
        },
      });

      // 3) Store Razorpay order ID on our order
      order.pg_order_id = rpOrder.id;
      await order.save();

      // Don't mark cart as checked_out yet — wait for payment verification

      res.json({
        success: true,
        data: {
          order,
          payment_status: 'pending',
          razorpay: {
            order_id: rpOrder.id,
            amount: rpOrder.amount,
            currency: rpOrder.currency,
            key_id: process.env.RAZORPAY_KEY_ID,
          },
        },
      });
    }
  } catch (err) { next(err); }
});

// ─── POST /orders/verify-payment — Razorpay signature check ────
router.post('/verify-payment', authenticate, async (req, res, next) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Missing payment verification fields' });
    }

    // 1) Verify signature using HMAC SHA256
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Payment verification failed — invalid signature' });
    }

    // 2) Find and update our order
    const order = await Order.findOne({ pg_order_id: razorpay_order_id, user_id: req.user._id });
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    if (order.status === 'fulfilled') {
      return res.json({ success: true, data: { order, message: 'Already verified' } });
    }

    // 3) Mark order as fulfilled
    order.status = 'fulfilled';
    order.pg_payment_id = razorpay_payment_id;

    await order.save();

    // 4) Mark cart as checked out
    await Cart.findOneAndUpdate(
      { user_id: req.user._id, status: 'active' },
      { status: 'checked_out' }
    );

    res.json({ success: true, data: { order, payment_status: 'completed' } });
  } catch (err) { next(err); }
});

// ─── GET /orders/:id — single order detail ──────────────────────
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, user_id: req.user._id });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    res.json({ success: true, data: order });
  } catch (err) { next(err); }
});

module.exports = router;
