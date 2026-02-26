const mongoose = require('mongoose');

const schema = new mongoose.Schema({
    owner_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    source: { type: String, enum: ['wallet', 'earnings'], default: 'earnings' },
    amount: { type: Number, required: true, min: 1 },
    payout_method: { type: String, enum: ['upi', 'bank'], required: true },
    payout_details: {
        upi_id: String,
        account_number: String,
        ifsc_code: String,
        account_holder: String,
    },
    status: {
        type: String,
        enum: ['requested', 'approved', 'processing', 'paid', 'rejected'],
        default: 'requested',
    },
    razorpay_payout_id: String,
    utr: String,
    reject_reason: String,
}, { timestamps: true });

schema.index({ owner_id: 1, source: 1 });
schema.index({ owner_id: 1 });
schema.index({ status: 1 });

module.exports = mongoose.model('WithdrawalRequest', schema);
