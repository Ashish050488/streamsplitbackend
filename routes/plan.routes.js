const router = require('express').Router();
const Plan = require('../models/Plan');
const { authenticate, requireRole } = require('../middleware/auth');

router.get('/', async (req, res, next) => {
  try {
    const filter = { is_active: true };
    if (req.query.brand_id) filter.brand_id = req.query.brand_id;
    const plans = await Plan.find(filter).populate('brand_id', 'name slug logo_url').sort({ price: 1 });
    res.json({ success: true, data: plans });
  } catch (err) { next(err); }
});

router.post('/', authenticate, requireRole('admin', 'super_admin'), async (req, res, next) => {
  try {
    const plan = await Plan.create(req.body);
    res.status(201).json({ success: true, data: plan });
  } catch (err) { next(err); }
});

module.exports = router;
