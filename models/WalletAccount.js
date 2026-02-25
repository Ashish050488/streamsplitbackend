const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  balance: { type: Number, default: 0, min: 0 },
  currency: { type: String, default: 'INR' },
  is_active: { type: Boolean, default: true },
}, { timestamps: true });
module.exports = mongoose.model('WalletAccount', schema);
