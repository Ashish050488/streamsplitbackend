const mongoose = require('mongoose');
const schema = new mongoose.Schema({
    type: { type: String, enum: ['group', 'dm'], required: true },
    group_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', default: null },
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    last_message_at: { type: Date, default: null },
    last_message_preview: { type: String, default: '' },
}, { timestamps: true });

schema.index({ type: 1, group_id: 1 }, { unique: true, sparse: true });
schema.index({ participants: 1 });
schema.index({ last_message_at: -1 });

module.exports = mongoose.model('ChatRoom', schema);
