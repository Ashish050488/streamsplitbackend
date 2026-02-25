const mongoose = require('mongoose');
const crypto = require('crypto');

const schema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, default: '' },
  image_url: { type: String, default: '' },
  brand_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Brand' },
  is_public: { type: Boolean, default: true },
  group_limit: { type: Number, default: 500 },
  member_count: { type: Number, default: 0 },
  share_price: { type: Number, default: 0 },
  share_limit: { type: Number, default: 5 },
  invite_code: { type: String, unique: true, sparse: true },
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  status: { type: String, enum: ['waiting', 'active', 'archived'], default: 'waiting' },
  duration_days: { type: Number, default: 30 },
  start_date: { type: Date },
  end_date: { type: Date },
}, { timestamps: true });

schema.index({ is_public: 1, status: 1 });
schema.index({ invite_code: 1 });
schema.index({ name: 'text', description: 'text' });
schema.index({ created_by: 1 });

// Generate a unique 8-char invite code before save if not set
schema.pre('save', function (next) {
  if (!this.invite_code) {
    this.invite_code = crypto.randomBytes(4).toString('hex');
  }
  next();
});

module.exports = mongoose.model('Group', schema);
