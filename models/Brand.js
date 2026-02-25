const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  category_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  logo_url: { type: String, default: '' },
  logo_dark_url: { type: String, default: '' },
  brand_color: { type: String, default: '' },
  cover_url: { type: String, default: '' },
  description: { type: String, default: '' },
  tags: [String],
  is_featured: { type: Boolean, default: false },
  is_active: { type: Boolean, default: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });
schema.index({ category_id: 1 });
schema.index({ is_featured: 1, is_active: 1 });
schema.index({ name: 'text', tags: 'text' });
module.exports = mongoose.model('Brand', schema);
