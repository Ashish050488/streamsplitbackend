const mongoose = require('mongoose');
const itemSchema = new mongoose.Schema({
  plan_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', required: true },
  plan_snapshot: { name: String, price: Number, brand_name: String },
  quantity: { type: Number, default: 1, min: 1 },
}, { _id: false });
const schema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['active', 'checked_out', 'abandoned'], default: 'active' },
  items: [itemSchema],
  coupon_code: String,
  subtotal: { type: Number, default: 0 },
  discount: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
}, { timestamps: true });
schema.index({ user_id: 1, status: 1 });
module.exports = mongoose.model('Cart', schema);
