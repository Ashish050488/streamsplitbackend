const router = require('express').Router();
const Cart = require('../models/Cart');
const Coupon = require('../models/Coupon');
const Plan = require('../models/Plan');
const Brand = require('../models/Brand');
const { authenticate } = require('../middleware/auth');

const recalcCart = (cart) => {
  cart.subtotal = cart.items.reduce((sum, i) => sum + (i.plan_snapshot.price * i.quantity), 0);
  cart.total = cart.subtotal - cart.discount;
  return cart;
};

router.get('/', authenticate, async (req, res, next) => {
  try {
    let cart = await Cart.findOne({ user_id: req.user._id, status: 'active' });
    if (!cart) cart = await Cart.create({ user_id: req.user._id });
    res.json({ success: true, data: cart });
  } catch (err) { next(err); }
});

router.post('/items', authenticate, async (req, res, next) => {
  try {
    const { plan_id, quantity = 1 } = req.body;
    const plan = await Plan.findById(plan_id);
    if (!plan || !plan.is_active) return res.status(404).json({ success: false, message: 'Plan not found' });
    const brand = await Brand.findById(plan.brand_id);

    let cart = await Cart.findOne({ user_id: req.user._id, status: 'active' });
    if (!cart) cart = new Cart({ user_id: req.user._id });

    const existing = cart.items.find(i => i.plan_id.toString() === plan_id);
    if (existing) {
      existing.quantity += quantity;
    } else {
      cart.items.push({
        plan_id, quantity,
        plan_snapshot: { name: plan.name, price: plan.price, brand_name: brand ? brand.name : '' },
      });
    }

    recalcCart(cart);
    await cart.save();
    res.json({ success: true, data: cart });
  } catch (err) { next(err); }
});

router.delete('/items/:plan_id', authenticate, async (req, res, next) => {
  try {
    const cart = await Cart.findOne({ user_id: req.user._id, status: 'active' });
    if (!cart) return res.status(404).json({ success: false, message: 'Cart not found' });
    cart.items = cart.items.filter(i => i.plan_id.toString() !== req.params.plan_id);
    recalcCart(cart);
    await cart.save();
    res.json({ success: true, data: cart });
  } catch (err) { next(err); }
});

router.post('/coupon', authenticate, async (req, res, next) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ success: false, message: 'Coupon code required' });

    const cart = await Cart.findOne({ user_id: req.user._id, status: 'active' });
    if (!cart || cart.items.length === 0) return res.status(400).json({ success: false, message: 'Cart is empty' });

    const coupon = await Coupon.findOne({ code: code.toUpperCase(), is_active: true });
    if (!coupon) return res.status(404).json({ success: false, message: 'Coupon not found' });
    if (coupon.valid_until && coupon.valid_until < new Date()) return res.status(400).json({ success: false, message: 'Coupon expired' });
    if (coupon.usage_limit !== -1 && coupon.used_count >= coupon.usage_limit) return res.status(400).json({ success: false, message: 'Coupon usage limit reached' });
    if (cart.subtotal < coupon.min_order_value) return res.status(400).json({ success: false, message: `Minimum order value is ₹${coupon.min_order_value}` });

    let discount = coupon.type === 'percentage' ? (cart.subtotal * coupon.value / 100) : coupon.value;
    if (coupon.max_discount && discount > coupon.max_discount) discount = coupon.max_discount;

    cart.coupon_code = coupon.code;
    cart.discount = Math.round(discount);
    cart.total = cart.subtotal - cart.discount;
    await cart.save();

    res.json({ success: true, data: cart });
  } catch (err) { next(err); }
});

module.exports = router;
