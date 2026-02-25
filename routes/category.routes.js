const router = require('express').Router();
const Category = require('../models/Category');
const { authenticate, requireRole } = require('../middleware/auth');

router.get('/', async (req, res, next) => {
  try {
    const categories = await Category.find({ is_active: true }).sort({ sort_order: 1 });
    res.json({ success: true, data: categories });
  } catch (err) { next(err); }
});

router.post('/', authenticate, requireRole('admin', 'super_admin'), async (req, res, next) => {
  try {
    const cat = await Category.create(req.body);
    res.status(201).json({ success: true, data: cat });
  } catch (err) { next(err); }
});

module.exports = router;
