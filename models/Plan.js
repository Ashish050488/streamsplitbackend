const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  brand_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Brand', required: true },
  name: { type: String, required: true },
  description: { type: String, default: '' },
  price: { type: Number, required: true },
  original_price: Number,
  currency: { type: String, default: 'INR' },
  validity_days: { type: Number, default: 30 },
  stock: { type: Number, default: -1 },
  type: { type: String, enum: ['subscription', 'gift_card', 'one_time'], default: 'subscription' },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  is_active: { type: Boolean, default: true },
}, { timestamps: true });
schema.index({ brand_id: 1, is_active: 1 });
module.exports = mongoose.model('Plan', schema);
