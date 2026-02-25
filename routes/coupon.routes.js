const router = require('express').Router();
const Coupon = require('../models/Coupon');
const { authenticate, requireRole } = require('../middleware/auth');

router.post('/validate', authenticate, async (req, res, next) => {
  try {
    const { code, order_total } = req.body;
    const coupon = await Coupon.findOne({ code: code.toUpperCase(), is_active: true });
    if (!coupon) return res.status(404).json({ success: false, message: 'Coupon not found' });
    if (coupon.valid_until && coupon.valid_until < new Date()) return res.status(400).json({ success: false, message: 'Coupon expired' });
    if (coupon.usage_limit !== -1 && coupon.used_count >= coupon.usage_limit) return res.status(400).json({ success: false, message: 'Coupon usage limit reached' });
    if (order_total < coupon.min_order_value) return res.status(400).json({ success: false, message: `Minimum order value is ₹${coupon.min_order_value}` });

    let discount = coupon.type === 'percentage' ? (order_total * coupon.value / 100) : coupon.value;
    if (coupon.max_discount && discount > coupon.max_discount) discount = coupon.max_discount;

    res.json({ success: true, data: { code: coupon.code, discount, type: coupon.type, value: coupon.value } });
  } catch (err) { next(err); }
});

router.post('/', authenticate, requireRole('admin', 'super_admin'), async (req, res, next) => {
  try {
    const coupon = await Coupon.create(req.body);
    res.status(201).json({ success: true, data: coupon });
  } catch (err) { next(err); }
});

module.exports = router;
