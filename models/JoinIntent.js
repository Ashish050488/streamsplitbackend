const mongoose = require('mongoose');

const schema = new mongoose.Schema({
    invite_code: { type: String, required: true },
    group_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    status: { type: String, enum: ['initiated', 'paid', 'failed', 'expired'], default: 'initiated' },
    payment_method: { type: String, enum: ['razorpay', 'wallet', 'dev'], default: 'dev' },
    razorpay_order_id: { type: String, default: null },
    razorpay_payment_id: { type: String, default: null },
}, { timestamps: true });

schema.index({ user_id: 1, group_id: 1, status: 1 });
schema.index({ razorpay_order_id: 1 });

module.exports = mongoose.model('JoinIntent', schema);
