const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  group_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['member', 'moderator', 'owner'], default: 'member' },
  is_muted: { type: Boolean, default: false },
  joined_at: { type: Date, default: Date.now },
}, { timestamps: true });
schema.index({ group_id: 1, user_id: 1 }, { unique: true });
module.exports = mongoose.model('GroupMembership', schema);
