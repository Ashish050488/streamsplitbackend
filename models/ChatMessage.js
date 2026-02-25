const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  room_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatRoom', default: null },
  group_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', default: null },
  sender_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['text', 'image', 'system', 'announcement', 'vault'], default: 'text' },
  content: { type: String, required: true },
  media_url: String,
  pinned: { type: Boolean, default: false },
  metadata: { type: mongoose.Schema.Types.Mixed, default: null },
  is_deleted: { type: Boolean, default: false },
}, { timestamps: true });
schema.index({ room_id: 1, createdAt: -1 });
schema.index({ group_id: 1, createdAt: -1 });
schema.index({ room_id: 1, type: 1, pinned: 1 });
module.exports = mongoose.model('ChatMessage', schema);
