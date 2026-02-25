const mongoose = require('mongoose');

const schema = new mongoose.Schema({
    group_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
    owner_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    buyer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    gross: { type: Number, required: true },
    fee_percent: { type: Number, required: true },
    fee_amount: { type: Number, required: true },
    net: { type: Number, required: true },
    razorpay_order_id: { type: String },
    razorpay_payment_id: { type: String },
    status: { type: String, enum: ['pending', 'paid', 'refunded'], default: 'pending' },
}, { timestamps: true });

schema.index({ group_id: 1 });
schema.index({ owner_id: 1 });
schema.index({ buyer_id: 1 });
schema.index({ razorpay_payment_id: 1 }, { unique: true, sparse: true });
schema.index({ razorpay_order_id: 1 });

module.exports = mongoose.model('GroupTransaction', schema);
