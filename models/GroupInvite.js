const mongoose = require('mongoose');
const crypto = require('crypto');
const schema = new mongoose.Schema({
    code: { type: String, unique: true },
    group_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    created_by_role: { type: String, enum: ['owner', 'member'], default: 'member' },
    status: { type: String, enum: ['active', 'disabled', 'pending'], default: 'active' },
    max_uses: { type: Number, default: null },
    uses_count: { type: Number, default: 0 },
    expires_at: { type: Date, default: null },
}, { timestamps: true });

schema.index({ group_id: 1 });
// code already has unique:true on field definition — no extra index needed

schema.pre('save', function (next) {
    if (!this.code) {
        this.code = crypto.randomBytes(5).toString('hex').toUpperCase();
    }
    // Set default TTL of 60 minutes if not set
    if (!this.expires_at) {
        const ttl = parseInt(process.env.INVITE_TTL_MINUTES || '60', 10);
        this.expires_at = new Date(Date.now() + ttl * 60 * 1000);
    }
    next();
});

module.exports = mongoose.model('GroupInvite', schema);
