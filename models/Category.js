const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  icon_url: { type: String, default: '' },
  color: { type: String, default: '#7C3AED' },
  sort_order: { type: Number, default: 0 },
  is_active: { type: Boolean, default: true },
}, { timestamps: true });
module.exports = mongoose.model('Category', schema);
