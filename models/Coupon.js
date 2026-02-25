const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true },
  type: { type: String, enum: ['percentage', 'flat'], required: true },
  value: { type: Number, required: true },
  max_discount: Number,
  min_order_value: { type: Number, default: 0 },
  usage_limit: { type: Number, default: -1 },
  used_count: { type: Number, default: 0 },
  per_user_limit: { type: Number, default: 1 },
  applicable_brands: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Brand' }],
  valid_from: Date,
  valid_until: Date,
  is_active: { type: Boolean, default: true },
}, { timestamps: true });
module.exports = mongoose.model('Coupon', schema);
