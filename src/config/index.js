const path = require('path');

const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const PRODUCTION_DOMAIN = process.env.PRODUCTION_DOMAIN || 'http://localhost:3000';
const DATABASE_URL = process.env.DATABASE_URL || '';
const MAILERSEND_API_KEY = process.env.MAILERSEND_API_KEY || '';
const MAILERSEND_SENDER_EMAIL = process.env.MAILERSEND_SENDER_EMAIL || '';
const IT_BOOTSTRAP_KEY = process.env.IT_BOOTSTRAP_KEY || '';
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000; // 8 hours
const BCRYPT_ROUNDS = 12; // ~250ms per hash — good balance of security vs speed
const APP_VERSION = '2026.03.21.1';

// Cookie signing secret — prevents client-side cookie tampering.
// In production, always set SESSION_SECRET in environment variables.
// Falls back to a random secret per process restart (invalidates sessions on restart — acceptable for dev).
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const SESSION_COOKIE_OPTIONS = {
    httpOnly: true,          // Not accessible via document.cookie (XSS mitigation)
    secure: NODE_ENV === 'production',  // HTTPS only in production
    sameSite: 'strict',      // CSRF mitigation — cookie not sent cross-site
    signed: true,            // HMAC-signed via SESSION_SECRET — prevents tampering
    path: '/',
    maxAge: SESSION_DURATION_MS
};

// Data directory - Railway or local
const dataDir = process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'data')
    : path.join(__dirname, '..', '..', 'data');

// Upload directories (inside dataDir so they persist on Railway Volume)
const uploadsDir = path.join(dataDir, 'uploads');
const soPdfsDir = path.join(uploadsDir, 'so-pdfs');
const leaveFormPdfsDir = path.join(uploadsDir, 'leave-forms');

module.exports = {
    PORT, NODE_ENV, PRODUCTION_DOMAIN, DATABASE_URL,
    MAILERSEND_API_KEY, MAILERSEND_SENDER_EMAIL, IT_BOOTSTRAP_KEY,
    SESSION_DURATION_MS, BCRYPT_ROUNDS, APP_VERSION,
    SESSION_SECRET, SESSION_COOKIE_OPTIONS,
    dataDir, uploadsDir, soPdfsDir, leaveFormPdfsDir
};
