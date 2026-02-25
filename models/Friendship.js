const mongoose = require('mongoose');
const schema = new mongoose.Schema({
    user_a: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    user_b: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

schema.index({ user_a: 1, user_b: 1 }, { unique: true });
schema.index({ user_b: 1 });

module.exports = mongoose.model('Friendship', schema);
