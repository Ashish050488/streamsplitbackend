const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  wallet_id: { type: mongoose.Schema.Types.ObjectId, ref: 'WalletAccount', required: true },
  type: { type: String, enum: ['credit', 'debit'], required: true },
  amount: { type: Number, required: true },
  balance_after: { type: Number, required: true },
  source: { type: String, enum: ['cashback', 'topup', 'purchase', 'refund', 'reward', 'admin'], required: true },
  reference_type: String,
  reference_id: mongoose.Schema.Types.ObjectId,
  description: { type: String, default: '' },
  idempotency_key: { type: String, unique: true, sparse: true },
}, { timestamps: true });
schema.index({ wallet_id: 1, createdAt: -1 });
module.exports = mongoose.model('WalletTransaction', schema);
