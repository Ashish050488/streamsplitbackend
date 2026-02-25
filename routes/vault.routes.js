const router = require('express').Router();
const VaultAccessLog = require('../models/VaultAccessLog');
const ChatMessage = require('../models/ChatMessage');
const GroupMembership = require('../models/GroupMembership');
const { authenticate } = require('../middleware/auth');

// ─── POST /vault/:messageId/access — Log view/copy event ────
router.post('/:messageId/access', authenticate, async (req, res, next) => {
  try {
    const { event } = req.body;
    const validEvents = ['view', 'copy_email', 'copy_password', 'copy_notes'];
    if (!validEvents.includes(event)) {
      return res.status(400).json({ success: false, message: 'Invalid event type' });
    }

    const msg = await ChatMessage.findById(req.params.messageId);
    if (!msg || msg.type !== 'vault') {
      return res.status(404).json({ success: false, message: 'Vault message not found' });
    }

    // Verify membership
    const membership = await GroupMembership.findOne({ group_id: msg.group_id, user_id: req.user._id, status: { $ne: 'left' } });
    if (!membership) {
      return res.status(403).json({ success: false, message: 'Not a member' });
    }

    await VaultAccessLog.create({
      group_id: msg.group_id,
      message_id: msg._id,
      viewer_user_id: req.user._id,
      event,
    });

    res.json({ success: true, message: 'Access logged' });
  } catch (err) { next(err); }
});

module.exports = router;
