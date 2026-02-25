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

module.exports = router;
