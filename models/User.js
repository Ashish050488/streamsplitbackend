const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true, index: true },
  name: { type: String, default: '' },
  avatar_url: { type: String, default: '' },
  language: { type: String, default: 'en' },
  role: { type: String, enum: ['user', 'admin', 'super_admin'], default: 'user' },
  status: { type: String, enum: ['active', 'blocked', 'deleted'], default: 'active' },
  device_info: { os: String, model: String, app_version: String },
  referral_code: { type: String, unique: true, sparse: true },
  referred_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  last_login_at: Date,
}, { timestamps: true });
module.exports = mongoose.model('User', schema);
