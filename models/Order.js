const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  order_number: { type: String, required: true, unique: true },
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  items: [{ plan_id: mongoose.Schema.Types.ObjectId, plan_snapshot: mongoose.Schema.Types.Mixed, quantity: Number, unit_price: Number }],
  coupon_code: String,
  subtotal: { type: Number, required: true },
  discount: { type: Number, default: 0 },
  total: { type: Number, required: true },
  status: { type: String, enum: ['pending', 'paid', 'fulfilled', 'cancelled', 'refunded'], default: 'pending' },
  payment_method: String,
  pg_order_id: String,
  pg_payment_id: String,
  idempotency_key: { type: String, unique: true },
}, { timestamps: true });
schema.index({ user_id: 1, createdAt: -1 });
module.exports = mongoose.model('Order', schema);
