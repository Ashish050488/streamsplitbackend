const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const User = require('../models/User');

router.get('/me', authenticate, async (req, res) => {
  res.json({ success: true, data: req.user });
});

router.patch('/me', authenticate, async (req, res, next) => {
  try {
    const allowed = ['name', 'avatar_url', 'language'];
    const updates = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true });
    res.json({ success: true, data: user });
  } catch (err) { next(err); }
});

// ─── GET /users/search — Search users by name/phone ─────────
router.get('/search', authenticate, async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q || q.length < 2) return res.json({ success: true, data: [] });

    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const users = await User.find({
      _id: { $ne: req.user._id },
      status: 'active',
      $or: [{ name: regex }, { phone: regex }],
    }).select('name phone').limit(20);

    const maskPhone = (phone) => {
      if (!phone || phone.length < 6) return '****';
      return phone.slice(0, 4) + '******' + phone.slice(-2);
    };

    const results = users.map(u => ({
      _id: u._id,
      name: u.name || 'User',
      phone_masked: maskPhone(u.phone),
    }));

    res.json({ success: true, data: results });
  } catch (err) { next(err); }
});

module.exports = router;
