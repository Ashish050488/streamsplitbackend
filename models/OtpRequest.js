const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  hashed_otp: { type: String, required: true },
  attempts: { type: Number, default: 0 },
  expires_at: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
}, { timestamps: true });
module.exports = mongoose.model('OtpRequest', schema);
