const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  group_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['member', 'moderator', 'owner'], default: 'member' },
  status: { type: String, enum: ['active', 'left', 'removed'], default: 'active' },
  is_muted: { type: Boolean, default: false },
  joined_at: { type: Date, default: Date.now },
  left_at: { type: Date, default: null },
  paid_until: { type: Date, default: null },
}, { timestamps: true });
schema.index({ group_id: 1, user_id: 1 }, { unique: true });
module.exports = mongoose.model('GroupMembership', schema);
