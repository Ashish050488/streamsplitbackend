const router = require('express').Router();
const Brand = require('../models/Brand');
const { authenticate, requireRole, optionalAuth } = require('../middleware/auth');

router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const filter = { is_active: true };
    if (req.query.category_id) filter.category_id = req.query.category_id;
    if (req.query.featured === 'true') filter.is_featured = true;
    if (req.query.search) filter.$text = { $search: req.query.search };
    const brands = await Brand.find(filter).populate('category_id', 'name slug').sort({ is_featured: -1, name: 1 });
    res.json({ success: true, data: brands });
  } catch (err) { next(err); }
});

router.get('/:slug', async (req, res, next) => {
  try {
    const brand = await Brand.findOne({ slug: req.params.slug, is_active: true }).populate('category_id', 'name slug');
    if (!brand) return res.status(404).json({ success: false, message: 'Brand not found' });
    res.json({ success: true, data: brand });
  } catch (err) { next(err); }
});

router.post('/', authenticate, requireRole('admin', 'super_admin'), async (req, res, next) => {
  try {
    const brand = await Brand.create(req.body);
    res.status(201).json({ success: true, data: brand });
  } catch (err) { next(err); }
});

router.patch('/:id', authenticate, requireRole('admin', 'super_admin'), async (req, res, next) => {
  try {
    const brand = await Brand.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, data: brand });
  } catch (err) { next(err); }
});

module.exports = router;
