// Session & auth middleware - extracted from server.js lines 188-342
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { SESSION_DURATION_MS, SESSION_COOKIE_OPTIONS } = require('../config');

// Active sessions: token -> { userId, email, role, portal, createdAt, expiresAt, ... }
const activeSessions = new Map();

/**
 * Extract session token from HttpOnly cookie.
 */
function extractToken(req) {
    if (req.cookies && req.cookies.session) {
        return req.cookies.session;
    }
    return null;
}

// Persist sessions to file so they survive Railway redeploys.
// sessionsFile is resolved lazily (needs dataDir which may depend on env vars).
let _sessionsFile = null;
function getSessionsFile() {
    if (!_sessionsFile) {
        const sessDataDir = process.env.RAILWAY_VOLUME_MOUNT_PATH
            ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'data')
            : path.join(__dirname, '..', '..', 'data');
        _sessionsFile = path.join(sessDataDir, 'sessions.json');
    }
    return _sessionsFile;
}

/**
 * Write all active sessions to disk.
 */
function persistSessions() {
    try {
        const sessFile = getSessionsFile();
        const sessObj = {};
        for (const [token, session] of activeSessions) {
            sessObj[token] = session;
        }
        fs.writeFileSync(sessFile, JSON.stringify(sessObj, null, 2));
    } catch (err) {
        console.error('[SESSION] Failed to persist sessions:', err.message);
    }
}

/**
 * Restore active sessions from disk on startup.
 * Discards any sessions that have already expired.
 */
function loadPersistedSessions() {
    try {
        const sessFile = getSessionsFile();
        if (!fs.existsSync(sessFile)) return;
        const raw = fs.readFileSync(sessFile, 'utf8');
        const sessObj = JSON.parse(raw);
        const now = Date.now();
        let loaded = 0, expired = 0;
        for (const [token, session] of Object.entries(sessObj)) {
            if (now > session.expiresAt) {
                expired++;
                continue;
            }
            activeSessions.set(token, session);
            loaded++;
        }
        console.log(`[SESSION] Restored ${loaded} active sessions from disk (${expired} expired sessions discarded)`);
        if (expired > 0) persistSessions(); // Clean out expired entries from file
    } catch (err) {
        console.error('[SESSION] Failed to load persisted sessions:', err.message);
    }
}

/**
 * Generate a cryptographically secure session token (96 hex chars).
 */
function generateSessionToken() {
    return crypto.randomBytes(48).toString('hex');
}

/**
 * Create a new session for the given user and portal.
 * Returns the session token string.
 */
function createSession(user, portal) {
    const token = generateSessionToken();
    const now = Date.now();
    activeSessions.set(token, {
        userId: user.id,
        email: user.email,
        role: user.role || portal,
        portal: portal,
        name: user.name || user.fullName || '',
        fullName: user.fullName || user.name || '',
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        middleName: user.middleName || '',
        suffix: user.suffix || '',
        office: user.office || user.school || null,
        position: user.position || '',
        salary: user.salary || '',
        salaryGrade: user.salaryGrade || '',
        step: user.step || '',
        employeeNo: user.employeeNo || '',
        createdAt: now,
        expiresAt: now + SESSION_DURATION_MS
    });
    persistSessions();
    return token;
}

/**
 * Validate a session token. Returns the session object if valid, null otherwise.
 * Automatically cleans up expired sessions.
 */
function validateSession(token) {
    if (!token) return null;
    const session = activeSessions.get(token);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
        activeSessions.delete(token);
        persistSessions();
        return null;
    }
    return session;
}

/**
 * Destroy (invalidate) a session by token.
 */
function destroySession(token) {
    activeSessions.delete(token);
    persistSessions();
}

// Clean up expired sessions every 15 minutes
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [token, session] of activeSessions) {
        if (now > session.expiresAt) {
            activeSessions.delete(token);
            cleaned++;
        }
    }
    if (cleaned > 0) {
        persistSessions();
        console.log(`[SESSION] Cleaned ${cleaned} expired session(s)`);
    }
}, 15 * 60 * 1000);

/**
 * Auth middleware factory - validates session token from HttpOnly cookie.
 * Optionally restricts access to specific roles.
 * @param {...string} allowedRoles - If provided, only these roles may access the route
 * @returns {Function} Express middleware
 */
function requireAuth(...allowedRoles) {
    return (req, res, next) => {
        const token = extractToken(req);
        if (!token) {
            return res.status(401).json({ success: false, error: 'Authentication required. Please log in.' });
        }
        const session = validateSession(token);
        if (!session) {
            return res.status(401).json({ success: false, error: 'Session expired. Please log in again.' });
        }
        if (allowedRoles.length > 0 && !allowedRoles.includes(session.role)) {
            return res.status(403).json({ success: false, error: 'Access denied. Insufficient permissions.' });
        }
        req.session = session;
        next();
    };
}

module.exports = {
    activeSessions,
    extractToken,
    persistSessions,
    loadPersistedSessions,
    generateSessionToken,
    createSession,
    validateSession,
    destroySession,
    requireAuth
};
