const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  refresh_token_hash: { type: String, required: true, unique: true },
  device_info: { os: String, ip: String },
  is_revoked: { type: Boolean, default: false },
  expires_at: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
}, { timestamps: true });
schema.index({ user_id: 1 });
module.exports = mongoose.model('Session', schema);
