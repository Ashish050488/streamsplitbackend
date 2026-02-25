const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const KEY_HEX = process.env.VAULT_SECRET || 'a'.repeat(64); // 32 bytes in hex
const KEY = Buffer.from(KEY_HEX.padEnd(64, '0').slice(0, 64), 'hex');

function encrypt(text) {
    if (!text) return { encrypted: '', iv: '', tag: '' };
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGO, KEY, iv);
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    return { encrypted: enc, iv: iv.toString('hex'), tag };
}

function decrypt(data) {
    if (!data || !data.encrypted) return '';
    try {
        const iv = Buffer.from(data.iv, 'hex');
        const tag = Buffer.from(data.tag, 'hex');
        const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
        decipher.setAuthTag(tag);
        let dec = decipher.update(data.encrypted, 'hex', 'utf8');
        dec += decipher.final('utf8');
        return dec;
    } catch (err) {
        console.error('Vault decrypt error:', err.message);
        return '[decryption failed]';
    }
}

function encryptVaultData({ email, password, notes }) {
    return {
        email: encrypt(email || ''),
        password: encrypt(password || ''),
        notes: encrypt(notes || ''),
        updated_at: new Date(),
    };
}

function decryptVaultData(metadata) {
    if (!metadata) return { email: '', password: '', notes: '', updated_at: null };
    return {
        email: decrypt(metadata.email),
        password: decrypt(metadata.password),
        notes: decrypt(metadata.notes),
        updated_at: metadata.updated_at,
    };
}

module.exports = { encrypt, decrypt, encryptVaultData, decryptVaultData };
