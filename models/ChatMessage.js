const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  room_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatRoom', default: null },
  group_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', default: null },
  sender_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['text', 'image', 'system'], default: 'text' },
  content: { type: String, required: true },
  media_url: String,
  is_deleted: { type: Boolean, default: false },
}, { timestamps: true });
schema.index({ room_id: 1, createdAt: -1 });
schema.index({ group_id: 1, createdAt: -1 });
module.exports = mongoose.model('ChatMessage', schema);
