const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { BCRYPT_ROUNDS } = require('../config');

// Hash password with bcrypt for new registrations and password changes
function hashPasswordWithSalt(password) {
    return bcrypt.hashSync(password, BCRYPT_ROUNDS);
}

// Legacy hash functions for backward compatibility during migration
function legacyHashSalted(password, salt) {
    return crypto.createHash('sha256').update(salt + password).digest('hex');
}

function legacyHashUnsalted(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// Verify password — supports bcrypt, salted SHA-256, and legacy unsalted SHA-256
// Returns { valid: boolean, needsRehash: boolean }
function verifyPasswordDetailed(password, storedHash) {
    // Format 1: bcrypt hash (starts with $2a$ or $2b$)
    if (storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$')) {
        return { valid: bcrypt.compareSync(password, storedHash), needsRehash: false };
    }
    // Format 2: salted SHA-256 (salt:hash)
    if (storedHash.includes(':')) {
        const [salt, hash] = storedHash.split(':');
        const computed = legacyHashSalted(password, salt);
        try {
            const valid = crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(hash, 'hex'));
            return { valid, needsRehash: valid }; // If valid, needs upgrade to bcrypt
        } catch {
            return { valid: false, needsRehash: false };
        }
    }
    // Format 3: legacy unsalted SHA-256
    const legacyHash = legacyHashUnsalted(password);
    try {
        const valid = crypto.timingSafeEqual(Buffer.from(legacyHash, 'hex'), Buffer.from(storedHash, 'hex'));
        return { valid, needsRehash: valid }; // If valid, needs upgrade to bcrypt
    } catch {
        return { valid: false, needsRehash: false };
    }
}

// Simple boolean verify (backward compatible drop-in)
function verifyPassword(password, storedHash) {
    return verifyPasswordDetailed(password, storedHash).valid;
}

// Transparently rehash a user's password to bcrypt if still on SHA-256
// Call after successful login when needsRehash is true
function rehashIfNeeded(password, storedHash, userRecord, usersArray, writeJSON, usersFile) {
    const { needsRehash } = verifyPasswordDetailed(password, storedHash);
    if (needsRehash) {
        userRecord.password = hashPasswordWithSalt(password);
        userRecord.passwordUpgradedAt = new Date().toISOString();
        writeJSON(usersFile, usersArray);
        console.log(`[SECURITY] Password rehashed to bcrypt for ${userRecord.email}`);
    }
}

module.exports = {
    hashPasswordWithSalt, legacyHashSalted, legacyHashUnsalted,
    verifyPasswordDetailed, verifyPassword, rehashIfNeeded
};
