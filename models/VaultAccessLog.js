const mongoose = require('mongoose');
const schema = new mongoose.Schema({
    group_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
    message_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatMessage', required: true },
    viewer_user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    event: { type: String, enum: ['view', 'copy_email', 'copy_password', 'copy_notes'], required: true },
}, { timestamps: true });
schema.index({ group_id: 1, message_id: 1 });
schema.index({ viewer_user_id: 1 });
module.exports = mongoose.model('VaultAccessLog', schema);
