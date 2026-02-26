const mongoose = require('mongoose');

const schema = new mongoose.Schema({
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    withdrawable_balance: { type: Number, default: 0, min: 0 },
    pending_balance: { type: Number, default: 0, min: 0 },
    total_earned: { type: Number, default: 0, min: 0 },
}, { timestamps: true });

module.exports = mongoose.model('EarningsAccount', schema);
