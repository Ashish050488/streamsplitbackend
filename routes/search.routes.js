const router = require('express').Router();
const Brand = require('../models/Brand');
const Plan = require('../models/Plan');
const Group = require('../models/Group');
const User = require('../models/User');
const { optionalAuth } = require('../middleware/auth');

// ─── GET /search?q=&types= — Unified search ────────────────
router.get('/', optionalAuth, async (req, res, next) => {
    try {
        const q = (req.query.q || '').trim();
        if (!q || q.length < 2) {
            return res.json({ success: true, data: { brands: [], plans: [], groups: [], hosts: [] } });
        }

        const typesParam = (req.query.types || 'brands,plans,groups,hosts').split(',');
        const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        const result = { brands: [], plans: [], groups: [], hosts: [] };

        if (typesParam.includes('brands')) {
            result.brands = await Brand.find({ is_active: true, $or: [{ name: regex }, { tags: regex }] })
                .select('name slug logo_url brand_color').limit(8);
        }

        if (typesParam.includes('plans')) {
            const matchingBrands = await Brand.find({ is_active: true, name: regex }).select('_id');
            const brandIds = matchingBrands.map(b => b._id);
            result.plans = await Plan.find({
                is_active: true,
                $or: [{ name: regex }, { description: regex }, { brand_id: { $in: brandIds } }],
            }).populate('brand_id', 'name slug logo_url').select('name price brand_id validity_days').limit(8);
        }

        if (typesParam.includes('groups')) {
            result.groups = await Group.find({
                is_public: true, status: { $in: ['waiting', 'active'] },
                $or: [{ name: regex }, { description: regex }],
            }).populate('brand_id', 'name logo_url slug').select('name share_price share_limit member_count brand_id').limit(8);
        }

        if (typesParam.includes('hosts')) {
            result.hosts = await User.find({
                status: 'active', name: regex,
            }).select('name').limit(8);
        }

        res.json({ success: true, data: result });
    } catch (err) { next(err); }
});

module.exports = router;
