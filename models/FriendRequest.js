const mongoose = require('mongoose');
const schema = new mongoose.Schema({
    from_user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    to_user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['pending', 'accepted', 'rejected', 'cancelled'], default: 'pending' },
}, { timestamps: true });

schema.index({ from_user: 1, to_user: 1 }, { unique: true });
schema.index({ to_user: 1, status: 1 });

module.exports = mongoose.model('FriendRequest', schema);
