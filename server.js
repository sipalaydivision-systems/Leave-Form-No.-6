// CS Form No. 6 - Application for Leave Server
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const https = require('https');
const multer = require('multer');
const xlsx = require('xlsx');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const PRODUCTION_DOMAIN = process.env.PRODUCTION_DOMAIN || 'http://localhost:3000';

// ========== SECURITY CONFIGURATION ==========

// Rate limiting storage (in-memory)
const rateLimitStore = new Map();

// Rate limiting middleware factory
function createRateLimiter(maxRequests, windowMs) {
    return (req, res, next) => {
        const ip = req.ip || req.connection.remoteAddress;
        const key = `${ip}:${req.path}`;
        const now = Date.now();
        
        if (!rateLimitStore.has(key)) {
            rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
            return next();
        }
        
        const record = rateLimitStore.get(key);
        if (now > record.resetTime) {
            rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
            return next();
        }
        
        if (record.count >= maxRequests) {
            return res.status(429).json({ 
                success: false, 
                error: 'Too many requests. Please try again later.' 
            });
        }
        
        record.count++;
        next();
    };
}

// Login rate limiter: 5 attempts per 15 minutes
const loginRateLimiter = createRateLimiter(5, 15 * 60 * 1000);

// General API rate limiter: 100 requests per minute
const apiRateLimiter = createRateLimiter(100, 60 * 1000);

// Cleanup expired rate limit entries every 5 minutes to prevent memory leak
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, record] of rateLimitStore.entries()) {
        if (now > record.resetTime) {
            rateLimitStore.delete(key);
            cleaned++;
        }
    }
    if (cleaned > 0) {
        console.log(`[RATE-LIMIT] Cleaned ${cleaned} expired entries, ${rateLimitStore.size} remaining`);
    }
}, 5 * 60 * 1000);

// Input sanitization function - prevents XSS and injection (idempotent)
function sanitizeInput(input) {
    if (typeof input !== 'string') return input;
    // Skip valid base64 data URLs (signatures, images) — they must not be modified
    // SECURITY: Only skip specifically valid data URI formats to prevent XSS via data: prefix
    if (/^data:(image|application)\/(png|jpeg|jpg|gif|pdf|octet-stream);base64,/.test(input)) return input;
    // Decode any previously-encoded entities first to prevent double-encoding
    // Also decode &#x2F; and &#x5C; which were previously over-encoded
    let s = input
        .replace(/&#x2F;/g, '/')
        .replace(/&#x5C;/g, '\\')
        .replace(/&#x60;/g, '`')
        .replace(/&#x27;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&gt;/g, '>')
        .replace(/&lt;/g, '<');
    // Re-encode XSS-dangerous characters only
    // Note: / and \ are NOT encoded — they are not XSS vectors and break base64 data & file paths
    return s
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/`/g, '&#x60;');
}

// Deep sanitize object
function sanitizeObject(obj) {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'string') {
        // SECURITY: Truncate excessively long non-data-URI strings to prevent storage abuse
        if (obj.length > 100000 && !/^data:(image|application)\//.test(obj)) {
            obj = obj.substring(0, 100000);
        }
        return sanitizeInput(obj);
    }
    if (Array.isArray(obj)) return obj.map(sanitizeObject);
    if (typeof obj === 'object') {
        const sanitized = {};
        for (const [key, value] of Object.entries(obj)) {
            sanitized[sanitizeInput(key)] = sanitizeObject(value);
        }
        return sanitized;
    }
    return obj;
}

// Validate email format
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// SECURITY: Check if email is already registered in ANY portal (prevents cross-portal abuse)
// excludePortals can be a string (single portal) or array of portal names to skip.
// Policy: Employee and admin portals can share the same email (all admins ARE employees).
//         Admin-to-admin cross-registration is still blocked (can't be both AO and HR).
function isEmailRegisteredInAnyPortal(email, excludePortals) {
    const skipSet = new Set(Array.isArray(excludePortals) ? excludePortals : [excludePortals]);
    const portalFiles = [
        { name: 'user', file: usersFile },
        { name: 'ao', file: aoUsersFile },
        { name: 'hr', file: hrUsersFile },
        { name: 'asds', file: asdsUsersFile },
        { name: 'sds', file: sdsUsersFile },
        { name: 'it', file: itUsersFile }
    ];
    for (const portal of portalFiles) {
        if (skipSet.has(portal.name)) continue;
        const users = readJSON(portal.file);
        if (users.find(u => (u.email || '').toLowerCase() === email.toLowerCase())) {
            return portal.name.toUpperCase();
        }
    }
    return null;
}

// Validate date format (YYYY-MM-DD)
function isValidDate(dateStr) {
    if (!dateStr) return false;
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(dateStr)) return false;
    const date = new Date(dateStr);
    return date instanceof Date && !isNaN(date);
}

// NOTE: Body sanitization middleware moved below bodyParser (see after line ~213)

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self'");
    next();
});

// MailerSend Configuration - MUST be set via environment variables
const MAILERSEND_API_KEY = process.env.MAILERSEND_API_KEY || '';
const MAILERSEND_SENDER_EMAIL = process.env.MAILERSEND_SENDER_EMAIL || '';
if (!MAILERSEND_API_KEY) {
    console.warn('[SECURITY] MAILERSEND_API_KEY not set. Email sending will be disabled.');
}

// ========== SESSION TOKEN MANAGEMENT ==========
const activeSessions = new Map(); // token -> { userId, email, role, portal, createdAt, expiresAt }
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000; // 8 hours

// Persist sessions to file so they survive Railway redeploys
// sessionsFile is defined later (needs dataDir), so we use a lazy getter
let _sessionsFile = null;
function getSessionsFile() {
    if (!_sessionsFile) {
        const sessDataDir = process.env.RAILWAY_VOLUME_MOUNT_PATH 
            ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'data')
            : path.join(__dirname, 'data');
        _sessionsFile = path.join(sessDataDir, 'sessions.json');
    }
    return _sessionsFile;
}

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

// Load persisted sessions on startup
loadPersistedSessions();

function generateSessionToken() {
    return crypto.randomBytes(48).toString('hex');
}

function createSession(user, portal) {
    const token = generateSessionToken();
    const now = Date.now();
    activeSessions.set(token, {
        userId: user.id,
        email: user.email,
        role: user.role || portal,
        portal: portal,
        createdAt: now,
        expiresAt: now + SESSION_DURATION_MS
    });
    persistSessions();
    return token;
}

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

// Auth middleware - validates session token from Authorization header
function requireAuth(...allowedRoles) {
    return (req, res, next) => {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, error: 'Authentication required. Please log in.' });
        }
        const token = authHeader.substring(7);
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

// CORS Configuration - Restrict in production
const corsOptions = {
    origin: NODE_ENV === 'production' 
        ? [PRODUCTION_DOMAIN]  // Uses environment variable for production domain
        : true,  // Allow all origins in development
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};

// Middleware
app.use(cors(corsOptions));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Security middleware - sanitize all incoming requests (must be AFTER bodyParser)
app.use((req, res, next) => {
    if (req.body && typeof req.body === 'object') {
        req.body = sanitizeObject(req.body);
    }
    if (req.query && typeof req.query === 'object') {
        req.query = sanitizeObject(req.query);
    }
    next();
});

// Enable CORS headers for static image files (needed for canvas operations in print)
app.use('/sipalay_logo.png', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
});

app.use(express.static('public', { index: false }));
app.use('/filled', express.static(path.join(__dirname, 'filled')));

// Data file paths
// Railway Volume: When RAILWAY_VOLUME_MOUNT_PATH is set, data persists across deployments.
// In development or without a volume, falls back to local ./data directory.
const dataDir = process.env.RAILWAY_VOLUME_MOUNT_PATH 
    ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'data')
    : path.join(__dirname, 'data');

console.log(`[DATA] Using data directory: ${dataDir}`);
if (process.env.RAILWAY_VOLUME_MOUNT_PATH) {
    console.log(`[DATA] Railway Volume detected at: ${process.env.RAILWAY_VOLUME_MOUNT_PATH}`);
} else {
    console.log('[DATA] No Railway Volume detected - using local filesystem (data will NOT persist on redeploy)');
}

const usersFile = path.join(dataDir, 'users.json');
const employeesFile = path.join(dataDir, 'employees.json');
const applicationsFile = path.join(dataDir, 'applications.json');
const leavecardsFile = path.join(dataDir, 'leavecards.json');
const aoUsersFile = path.join(dataDir, 'ao-users.json');
const hrUsersFile = path.join(dataDir, 'hr-users.json');
const asdsUsersFile = path.join(dataDir, 'asds-users.json');
const sdsUsersFile = path.join(dataDir, 'sds-users.json');
const itUsersFile = path.join(dataDir, 'it-users.json');
const pendingRegistrationsFile = path.join(dataDir, 'pending-registrations.json');
const ctoRecordsFile = path.join(dataDir, 'cto-records.json');
const schoolsFile = path.join(dataDir, 'schools.json');
const initialCreditsFile = path.join(dataDir, 'initial-credits.json');
const activityLogsFile = path.join(dataDir, 'activity-logs.json');
const systemStateFile = path.join(dataDir, 'system-state.json');

// Ensure data directory exists
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// ========== ACTIVITY LOGGING SYSTEM ==========

/**
 * Log user activity with detailed information
 * @param {string} action - Action type (login, logout, create, update, delete, etc.)
 * @param {string} portalType - Portal type (employee, hr, asds, sds, ao, it)
 * @param {object} details - Additional details about the activity
 */
function logActivity(action, portalType, details = {}) {
    try {
        const ip = details.ip || 'unknown';
        const userEmail = details.userEmail || 'anonymous';
        const userId = details.userId || null;
        const timestamp = new Date().toISOString();
        
        // Get user agent info
        const userAgent = details.userAgent || 'unknown';
        
        const logEntry = {
            id: crypto.randomUUID(),
            timestamp,
            action,
            portalType,
            userEmail,
            userId,
            ip,
            userAgent,
            details: {
                ...details,
                ip: undefined,
                userEmail: undefined,
                userId: undefined,
                userAgent: undefined
            }
        };
        
        let logs = [];
        if (fs.existsSync(activityLogsFile)) {
            try {
                const content = fs.readFileSync(activityLogsFile, 'utf-8');
                logs = JSON.parse(content);
                if (!Array.isArray(logs)) logs = [];
            } catch (e) {
                logs = [];
            }
        }
        
        // Keep only last 10,000 logs to prevent file from getting too large
        logs.push(logEntry);
        if (logs.length > 10000) {
            logs = logs.slice(-10000);
        }
        
        writeJSON(activityLogsFile, logs);
        console.log(`Activity logged: ${action} by ${userEmail} (${portalType})`);
    } catch (error) {
        console.error('Error logging activity:', error);
    }
}

/**
 * Extract IP address from request
 */
function getClientIp(req) {
    return (req.headers['x-forwarded-for'] || '').split(',')[0] ||
           req.connection.remoteAddress ||
           req.socket.remoteAddress ||
           req.connection.socket?.remoteAddress ||
           'unknown';
}

// Ensure all data files exist â€” seeds from bundled defaults on first deploy
const defaultsDir = path.join(__dirname, 'data', 'defaults');

function ensureFile(filepath, defaultContent = '[]') {
    const filename = path.basename(filepath);
    const defaultFile = path.join(defaultsDir, filename);
    
    if (!fs.existsSync(filepath)) {
        // File doesn't exist â€” seed from bundled defaults (useful for Railway Volume first deploy)
        if (fs.existsSync(defaultFile)) {
            const content = fs.readFileSync(defaultFile, 'utf8');
            fs.writeFileSync(filepath, content);
            console.log(`[DATA] Seeded ${filename} from defaults`);
        } else {
            fs.writeFileSync(filepath, defaultContent);
            console.log(`[DATA] Created empty ${filename}`);
        }
    }
    // NOTE: Do NOT re-seed existing empty files from defaults.
    // If data was intentionally cleared (e.g., bulk delete), it should stay empty.
}

ensureFile(usersFile);
ensureFile(employeesFile);
ensureFile(applicationsFile);
ensureFile(leavecardsFile);
ensureFile(aoUsersFile);
ensureFile(hrUsersFile);
ensureFile(asdsUsersFile);
ensureFile(sdsUsersFile);
ensureFile(itUsersFile);
ensureFile(pendingRegistrationsFile);

// Helper functions

// File-level write locks to prevent race conditions on concurrent writes
const fileLocks = new Map();

async function acquireLock(filepath) {
    while (fileLocks.get(filepath)) {
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    fileLocks.set(filepath, true);
}

function releaseLock(filepath) {
    fileLocks.delete(filepath);
}

function readJSON(filepath) {
    try {
        if (!fs.existsSync(filepath)) {
            return [];
        }
        let content = fs.readFileSync(filepath, 'utf8');
        // Strip UTF-8 BOM if present
        if (content.charCodeAt(0) === 0xFEFF) {
            content = content.slice(1);
        }
        const parsed = JSON.parse(content);
        return parsed;
    } catch (error) {
        console.error(`Error reading JSON file ${filepath}:`, error.message);
        // Try to recover from backup
        const backupPath = filepath + '.bak';
        if (fs.existsSync(backupPath)) {
            try {
                console.log(`[DATA-RECOVERY] Attempting to recover ${path.basename(filepath)} from backup...`);
                let backupContent = fs.readFileSync(backupPath, 'utf8');
                if (backupContent.charCodeAt(0) === 0xFEFF) {
                    backupContent = backupContent.slice(1);
                }
                const recovered = JSON.parse(backupContent);
                // Restore the main file from backup
                fs.writeFileSync(filepath, JSON.stringify(recovered, null, 2));
                console.log(`[DATA-RECOVERY] Successfully recovered ${path.basename(filepath)} from backup`);
                return recovered;
            } catch (backupError) {
                console.error(`[DATA-RECOVERY] Backup also corrupted for ${filepath}:`, backupError.message);
            }
        }
        return [];
    }
}

// Helper: ensure data from readJSON is always an array (handles both [] and {key:[]} formats)
function readJSONArray(filepath) {
    const data = readJSON(filepath);
    if (Array.isArray(data)) return data;
    // If it's an object with a single key containing an array, unwrap it
    if (data && typeof data === 'object') {
        const keys = Object.keys(data);
        if (keys.length === 1 && Array.isArray(data[keys[0]])) {
            console.log(`[readJSONArray] Unwrapping "${keys[0]}" from ${path.basename(filepath)}, fixing file format...`);
            // Also fix the file to plain array for future reads
            writeJSON(filepath, data[keys[0]]);
            return data[keys[0]];
        }
    }
    return [];
}

function writeJSON(filepath, data) {
    // Atomic write: write to temp file, then rename to prevent corruption
    const tempPath = filepath + '.tmp';
    const backupPath = filepath + '.bak';
    try {
        const jsonStr = JSON.stringify(data, null, 2);
        // Validate JSON before writing (catch serialization issues)
        JSON.parse(jsonStr);
        // Create backup of current file if it exists
        if (fs.existsSync(filepath)) {
            try { fs.copyFileSync(filepath, backupPath); } catch (e) { /* best effort */ }
        }
        // Write to temp file first
        fs.writeFileSync(tempPath, jsonStr);
        // Atomic rename
        fs.renameSync(tempPath, filepath);
    } catch (error) {
        console.error(`[WRITE-ERROR] Failed to write ${filepath}:`, error.message);
        // Clean up temp file if it exists
        try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (e) { /* ignore */ }
        throw error;
    }
}

// ========== MONTHLY LEAVE CREDIT ACCRUAL (1.25/month) ==========

/**
 * Catch-up accrual for cards created AFTER the global monthly accrual already ran.
 * Compares each card's lastAccrualDate (or absence thereof) against the global
 * lastAccruedMonth and adds any missing months of credits.
 */
function catchUpNewCards(globalLastAccruedMonth, now) {
    try {
        ensureFile(leavecardsFile);
        const leavecards = readJSON(leavecardsFile);
        if (leavecards.length === 0) return;

        const accrualPerMonth = 1.25;
        let updatedCount = 0;

        leavecards.forEach(lc => {
            const cardLastAccrual = lc.lastAccrualDate || null;

            // If card already has accrual up to the global month, skip
            if (cardLastAccrual && cardLastAccrual >= globalLastAccruedMonth) return;

            // Determine how many months this card missed
            let monthsToAccrue = 0;
            if (!cardLastAccrual) {
                // Card has never been accrued — accrue from January of the accrual year
                // (DepEd employees earn credits from start of calendar year regardless
                //  of when their card was created in the system)
                const globalParts = globalLastAccruedMonth.split('-').map(Number);
                const globalYear = globalParts[0];
                const globalMonth = globalParts[1];

                // Accrue from January of the globalYear to globalMonth (inclusive)
                monthsToAccrue = globalMonth; // Jan=1 month, Feb=2 months, etc.
                if (monthsToAccrue <= 0) return;
            } else {
                // Card has a lastAccrualDate but it's behind the global
                const cardParts = cardLastAccrual.split('-').map(Number);
                const globalParts = globalLastAccruedMonth.split('-').map(Number);
                monthsToAccrue = (globalParts[0] - cardParts[0]) * 12 + (globalParts[1] - cardParts[1]);
                if (monthsToAccrue <= 0) return;
            }

            const totalAccrual = accrualPerMonth * monthsToAccrue;

            // Update earned values
            const prevVL = parseFloat(lc.vacationLeaveEarned) || parseFloat(lc.vl) || 0;
            const prevSL = parseFloat(lc.sickLeaveEarned) || parseFloat(lc.sl) || 0;
            lc.vacationLeaveEarned = +(prevVL + totalAccrual).toFixed(3);
            lc.sickLeaveEarned = +(prevSL + totalAccrual).toFixed(3);
            lc.vl = lc.vacationLeaveEarned;
            lc.sl = lc.sickLeaveEarned;

            // Add transaction entries
            if (!lc.transactions) lc.transactions = [];
            let runningVL = prevVL;
            let runningSL = prevSL;
            if (lc.transactions.length > 0) {
                const lastTx = lc.transactions[lc.transactions.length - 1];
                runningVL = parseFloat(lastTx.vlBalance) || prevVL;
                runningSL = parseFloat(lastTx.slBalance) || prevSL;
            }

            // Determine the starting month for transaction entries
            let startYear, startMonth;
            if (!cardLastAccrual) {
                // Start from January of the global accrual year
                const globalParts = globalLastAccruedMonth.split('-').map(Number);
                startYear = globalParts[0];
                startMonth = 1; // January
            } else {
                const parts = cardLastAccrual.split('-').map(Number);
                startYear = parts[0];
                startMonth = parts[1] + 1;
                if (startMonth > 12) { startMonth = 1; startYear++; }
            }

            const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

            for (let m = 0; m < monthsToAccrue; m++) {
                let entryMonth = startMonth + m;
                let entryYear = startYear;
                while (entryMonth > 12) { entryMonth -= 12; entryYear++; }

                runningVL = +(runningVL + accrualPerMonth).toFixed(3);
                runningSL = +(runningSL + accrualPerMonth).toFixed(3);

                lc.transactions.push({
                    type: 'ADD',
                    periodCovered: `${monthNames[entryMonth]} ${entryYear} (Monthly Accrual)`,
                    vlEarned: accrualPerMonth,
                    slEarned: accrualPerMonth,
                    vlSpent: 0,
                    slSpent: 0,
                    forcedLeave: 0,
                    splUsed: 0,
                    vlBalance: runningVL,
                    slBalance: runningSL,
                    total: +(runningVL + runningSL).toFixed(3),
                    source: 'system-accrual-catchup',
                    date: now.toISOString()
                });
            }

            lc.lastAccrualDate = globalLastAccruedMonth;
            lc.updatedAt = now.toISOString();
            updatedCount++;
            console.log(`[ACCRUAL CATCH-UP] ${lc.email || lc.name}: +${totalAccrual.toFixed(3)} VL/SL (${monthsToAccrue} month(s))`);
        });

        if (updatedCount > 0) {
            writeJSON(leavecardsFile, leavecards);
            console.log(`[ACCRUAL CATCH-UP] Updated ${updatedCount} card(s) that missed previous accrual.`);

            // Log activity
            try {
                ensureFile(activityLogsFile);
                const logs = readJSON(activityLogsFile);
                logs.push({
                    type: 'ACCRUAL_CATCHUP',
                    timestamp: now.toISOString(),
                    details: {
                        employeesUpdated: updatedCount,
                        globalLastAccruedMonth: globalLastAccruedMonth
                    }
                });
                writeJSON(activityLogsFile, logs);
            } catch (logErr) {
                console.error('[ACCRUAL CATCH-UP] Could not log activity:', logErr.message);
            }
        } else {
            console.log('[ACCRUAL CATCH-UP] All cards are up to date.');
        }
    } catch (error) {
        console.error('[ACCRUAL CATCH-UP] Error:', error.message);
    }
}

/**
 * At the end of every month, each employee earns 1.25 days of Vacation Leave
 * and 1.25 days of Sick Leave (per CSC rules). This function checks on server
 * startup and every 24 hours whether any months have elapsed since the last
 * accrual, then adds the appropriate credits to every employee's leave card.
 */
function runMonthlyAccrual() {
    try {
        // Read or initialize system state
        let systemState = {};
        if (fs.existsSync(systemStateFile)) {
            try {
                systemState = JSON.parse(fs.readFileSync(systemStateFile, 'utf8'));
            } catch (e) {
                systemState = {};
            }
        }

        const now = new Date();
        // We accrue for fully completed months. The "last accrued" month
        // tracks the most recent month-end we have already credited.
        // Format: "YYYY-MM" (e.g. "2026-01" means Jan 2026 was already accrued)
        const lastAccruedMonth = systemState.lastAccruedMonth || null;

        // Determine the last fully completed month (previous month)
        const lastCompletedYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
        const lastCompletedMonth = now.getMonth() === 0 ? 12 : now.getMonth(); // 1-based
        const lastCompletedKey = `${lastCompletedYear}-${String(lastCompletedMonth).padStart(2, '0')}`;

        if (lastAccruedMonth && lastAccruedMonth >= lastCompletedKey) {
            // Global accrual is up to date, but check for newly created cards
            // that missed accrual because they were created after it ran
            console.log(`[ACCRUAL] Already accrued through ${lastAccruedMonth}. Checking for new cards needing catch-up...`);
            catchUpNewCards(lastAccruedMonth, now);
            return;
        }

        // Calculate how many months to accrue
        let monthsToAccrue = 0;
        if (!lastAccruedMonth) {
            // First time running - only accrue 1 month (the last completed month)
            // to avoid retroactively adding credits for unknown past months
            monthsToAccrue = 1;
            console.log(`[ACCRUAL] First-time accrual. Will credit 1 month (${lastCompletedKey}).`);
        } else {
            // Parse last accrued month
            const parts = lastAccruedMonth.split('-').map(Number);
            const lastYear = parts[0];
            const lastMonth = parts[1];
            monthsToAccrue = (lastCompletedYear - lastYear) * 12 + (lastCompletedMonth - lastMonth);
            if (monthsToAccrue <= 0) return;
            console.log(`[ACCRUAL] ${monthsToAccrue} month(s) to accrue (${lastAccruedMonth} -> ${lastCompletedKey}).`);
        }

        const accrualPerMonth = 1.25;
        const totalAccrual = accrualPerMonth * monthsToAccrue;

        // Read all leave cards and add credits
        ensureFile(leavecardsFile);
        const leavecards = readJSON(leavecardsFile);
        if (leavecards.length === 0) {
            console.log('[ACCRUAL] No leave cards found. Skipping accrual but saving state.');
            systemState.lastAccruedMonth = lastCompletedKey;
            systemState.lastAccrualRun = now.toISOString();
            fs.writeFileSync(systemStateFile, JSON.stringify(systemState, null, 2));
            return;
        }

        let updatedCount = 0;
        leavecards.forEach(lc => {
            // Add to vacationLeaveEarned and sickLeaveEarned
            const prevVL = parseFloat(lc.vacationLeaveEarned) || parseFloat(lc.vl) || 0;
            const prevSL = parseFloat(lc.sickLeaveEarned) || parseFloat(lc.sl) || 0;

            lc.vacationLeaveEarned = +(prevVL + totalAccrual).toFixed(3);
            lc.sickLeaveEarned = +(prevSL + totalAccrual).toFixed(3);

            // Also update the shorthand fields for consistency
            lc.vl = lc.vacationLeaveEarned;
            lc.sl = lc.sickLeaveEarned;

            // Add transaction entries so accrual shows as "ADD" rows in leave card tables
            if (!lc.transactions) lc.transactions = [];

            // Get the current running balance from last transaction, or use earned values
            let runningVL = prevVL;
            let runningSL = prevSL;
            if (lc.transactions.length > 0) {
                const lastTx = lc.transactions[lc.transactions.length - 1];
                runningVL = parseFloat(lastTx.vlBalance) || prevVL;
                runningSL = parseFloat(lastTx.slBalance) || prevSL;
            }

            // Add one transaction per accrued month
            for (let m = 1; m <= monthsToAccrue; m++) {
                // Calculate which month this entry is for
                const parts = (lastAccruedMonth || lastCompletedKey).split('-').map(Number);
                let entryYear = parts[0];
                let entryMonth = parts[1] + (lastAccruedMonth ? m : m - 1);
                while (entryMonth > 12) { entryMonth -= 12; entryYear++; }

                // Running balance after this month's accrual
                runningVL = +(runningVL + accrualPerMonth).toFixed(3);
                runningSL = +(runningSL + accrualPerMonth).toFixed(3);

                const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June',
                    'July', 'August', 'September', 'October', 'November', 'December'];
                const periodLabel = `${monthNames[entryMonth]} ${entryYear} (Monthly Accrual)`;

                lc.transactions.push({
                    type: 'ADD',
                    periodCovered: periodLabel,
                    vlEarned: accrualPerMonth,
                    slEarned: accrualPerMonth,
                    vlSpent: 0,
                    slSpent: 0,
                    forcedLeave: 0,
                    splUsed: 0,
                    vlBalance: runningVL,
                    slBalance: runningSL,
                    total: +(runningVL + runningSL).toFixed(3),
                    source: 'system-accrual',
                    date: now.toISOString()
                });
            }

            lc.updatedAt = now.toISOString();
            lc.lastAccrualDate = lastCompletedKey;
            updatedCount++;
        });

        writeJSON(leavecardsFile, leavecards);

        // Save state
        systemState.lastAccruedMonth = lastCompletedKey;
        systemState.lastAccrualRun = now.toISOString();
        systemState.lastAccrualMonths = monthsToAccrue;
        systemState.lastAccrualEmployees = updatedCount;
        fs.writeFileSync(systemStateFile, JSON.stringify(systemState, null, 2));

        console.log(`[ACCRUAL] Added ${totalAccrual.toFixed(3)} days (${monthsToAccrue} month(s) x 1.25) to VL and SL for ${updatedCount} employee(s).`);

        // Log activity
        try {
            ensureFile(activityLogsFile);
            const logs = readJSON(activityLogsFile);
            logs.push({
                type: 'MONTHLY_ACCRUAL',
                timestamp: now.toISOString(),
                details: {
                    monthsAccrued: monthsToAccrue,
                    totalAccrual: totalAccrual,
                    employeesUpdated: updatedCount,
                    period: (lastAccruedMonth || 'initial') + ' -> ' + lastCompletedKey
                }
            });
            writeJSON(activityLogsFile, logs);
        } catch (logErr) {
            console.error('[ACCRUAL] Could not log activity:', logErr.message);
        }

    } catch (error) {
        console.error('[ACCRUAL] Error running monthly accrual:', error.message);
    }
}

// Run accrual on startup (after a short delay to let files initialize)
setTimeout(() => {
    runMonthlyAccrual();
}, 5000);

// Run accrual check every 24 hours
setInterval(() => {
    console.log('[ACCRUAL] Running daily accrual check...');
    runMonthlyAccrual();
}, 24 * 60 * 60 * 1000);

// Parse fullName ("LASTNAME, FIRSTNAME MIDDLENAME SUFFIX") into segregated parts
function parseFullNameIntoParts(fullName) {
    if (!fullName) return {};
    const suffixes = ['Jr.', 'Sr.', 'III', 'IV', 'V', 'II'];
    const parts = fullName.split(',');
    const lastName = (parts[0] || '').trim();
    const rest = (parts.slice(1).join(',') || '').trim();
    let suffix = '', firstName = '', middleName = '';
    if (rest) {
        const words = rest.split(/\s+/);
        if (words.length > 0 && suffixes.includes(words[words.length - 1])) {
            suffix = words.pop();
        }
        firstName = words[0] || '';
        middleName = words.slice(1).join(' ');
    }
    return { firstName, lastName, middleName, suffix };
}

// ===== PASSWORD HASHING — bcrypt (GPU/ASIC resistant) =====
const BCRYPT_ROUNDS = 12; // ~250ms per hash — good balance of security vs speed

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
function rehashIfNeeded(password, storedHash, userRecord, usersArray, usersFile) {
    const { needsRehash } = verifyPasswordDetailed(password, storedHash);
    if (needsRehash) {
        userRecord.password = hashPasswordWithSalt(password);
        userRecord.passwordUpgradedAt = new Date().toISOString();
        writeJSON(usersFile, usersArray);
        console.log(`[SECURITY] Password rehashed to bcrypt for ${userRecord.email}`);
    }
}

function validateDepEdEmail(email) {
    // Require valid DepEd email ending with @deped.gov.ph
    return email && email.toLowerCase().endsWith('@deped.gov.ph');
}

function validatePortalPassword(password) {
    if (!password) return { valid: false, error: 'Password is required' };
    if (password.length < 6 || password.length > 24) {
        return { valid: false, error: 'Password must be 6-24 characters' };
    }
    if (!/[a-zA-Z]/.test(password)) {
        return { valid: false, error: 'Password must contain letters (a-z, A-Z)' };
    }
    if (!/[0-9]/.test(password)) {
        return { valid: false, error: 'Password must contain numbers (0-9)' };
    }
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
        return { valid: false, error: 'Password must contain a special character (!@#$%^&* etc.)' };
    }
    return { valid: true };
}

function buildEmployeeRecord(office, fullName, email, position, salaryGrade, step, salary, district) {
    let lastName = '', firstName = '', middleName = '';
    if (fullName && fullName.includes(',')) {
        const parts = fullName.split(',');
        lastName = parts[0].trim();
        const rem = (parts[1] || '').trim();
        const nameParts = rem.split(/\s+/);
        firstName = nameParts.shift() || '';
        middleName = nameParts.join(' ');
    } else if (fullName) {
        const nameParts = fullName.split(/\s+/);
        firstName = nameParts.shift() || '';
        lastName = nameParts.pop() || '';
        middleName = nameParts.join(' ');
    }
    return {
        id: crypto.randomUUID(),
        office: office || '',
        district: district || '',
        lastName,
        firstName,
        middleName,
        fullName: fullName || '',
        position: position || '',
        salaryGrade: salaryGrade ? parseInt(salaryGrade) : null,
        step: step ? parseInt(step) : null,
        salary: salary ? Number(salary) : null,
        email: email || '',
        createdAt: new Date().toISOString()
    };
}

// ========== INITIAL CREDITS LOOKUP FUNCTION ==========
/**
 * Normalize a name for matching (remove special chars, uppercase)
 */
function normalizeNameForMatching(name) {
    return name
        .toUpperCase()
        .replace(/[.,\-_]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Look up initial leave credits from the extracted Excel data
 * @param {string} fullName - Employee full name (e.g., "Platil, Wesley Hans Magbanua")
 * @returns {object|null} - { vacationLeave, sickLeave } or null if not found
 */
function lookupInitialCredits(fullName) {
    try {
        if (!fs.existsSync(initialCreditsFile)) {
            console.log('[INITIAL CREDITS] File not found:', initialCreditsFile);
            return null;
        }
        
        const data = JSON.parse(fs.readFileSync(initialCreditsFile, 'utf8'));
        
        if (!data || !data.lookupMap) {
            console.log('[INITIAL CREDITS] Invalid data format');
            return null;
        }
        
        // Normalize the input name for matching
        const normalizedInput = normalizeNameForMatching(fullName);
        
        // Try exact match first
        if (data.lookupMap[normalizedInput]) {
            const credits = data.lookupMap[normalizedInput];
            console.log(`[INITIAL CREDITS] Found exact match for "${fullName}": VL=${credits.vacationLeave}, SL=${credits.sickLeave}`);
            return {
                vacationLeave: credits.vacationLeave,
                sickLeave: credits.sickLeave
            };
        }
        
        // Extract last name and first name from input
        let inputLastName = '', inputFirstName = '';
        if (fullName.includes(',')) {
            const parts = fullName.split(',');
            inputLastName = parts[0].trim().toUpperCase();
            // Get just the first word of the remaining part as first name
            const restParts = (parts[1] || '').trim().split(/\s+/);
            inputFirstName = restParts[0].toUpperCase();
        } else {
            const parts = fullName.trim().split(/\s+/);
            inputFirstName = parts[0].toUpperCase();
            inputLastName = parts[parts.length - 1].toUpperCase();
        }
        
        // Search through all credits for partial match
        for (const credit of data.credits) {
            // The credit.name is in format "LASTNAME, FIRSTNAME" from file name
            let creditLastName = '', creditFirstName = '';
            if (credit.name.includes(',')) {
                const parts = credit.name.split(',');
                creditLastName = parts[0].trim().toUpperCase();
                const restParts = (parts[1] || '').trim().split(/\s+/);
                creditFirstName = restParts[0].toUpperCase();
            } else {
                const parts = credit.name.trim().split(/\s+/);
                creditFirstName = parts[0].toUpperCase();
                creditLastName = parts[parts.length - 1].toUpperCase();
            }
            
            // Remove special characters for comparison
            creditLastName = creditLastName.replace(/[.,\-_]/g, '');
            creditFirstName = creditFirstName.replace(/[.,\-_]/g, '');
            inputLastName = inputLastName.replace(/[.,\-_]/g, '');
            inputFirstName = inputFirstName.replace(/[.,\-_]/g, '');
            
            // Match if last name matches and first name starts with same letters
            if (creditLastName === inputLastName && 
                (creditFirstName === inputFirstName || 
                 creditFirstName.startsWith(inputFirstName) || 
                 inputFirstName.startsWith(creditFirstName))) {
                console.log(`[INITIAL CREDITS] Found partial match for "${fullName}" -> "${credit.name}": VL=${credit.vacationLeave}, SL=${credit.sickLeave}`);
                return {
                    vacationLeave: credit.vacationLeave,
                    sickLeave: credit.sickLeave
                };
            }
        }
        
        console.log(`[INITIAL CREDITS] No match found for "${fullName}"`);
        return null;
    } catch (error) {
        console.error('[INITIAL CREDITS] Error looking up credits:', error.message);
        return null;
    }
}

// ========== EMAIL SENDING FUNCTION ==========
/**
 * Send email using MailerSend API
 * @param {string} recipientEmail - Recipient email address
 * @param {string} recipientName - Recipient name
 * @param {string} subject - Email subject
 * @param {string} htmlContent - Email HTML content
 * @returns {Promise<boolean>} - Returns true if email sent successfully
 */
function sendEmail(recipientEmail, recipientName, subject, htmlContent) {
    return new Promise((resolve, reject) => {
        const mailersendData = {
            from: {
                email: MAILERSEND_SENDER_EMAIL,
                name: 'DepEd Sipalay Leave Form'
            },
            to: [
                {
                    email: recipientEmail,
                    name: recipientName
                }
            ],
            subject: subject,
            html: htmlContent
        };

        const jsonData = JSON.stringify(mailersendData);

        const options = {
            hostname: 'api.mailersend.com',
            port: 443,
            path: '/v1/email',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${MAILERSEND_API_KEY}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(jsonData)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode === 202 || res.statusCode === 200) {
                    console.log('Email sent successfully to:', recipientEmail);
                    resolve(true);
                } else {
                    console.error('MailerSend Error:', res.statusCode, data);
                    reject(new Error(`Email sending failed with status ${res.statusCode}`));
                }
            });
        });

        req.on('error', (error) => {
            console.error('Email sending error:', error);
            reject(error);
        });

        req.write(jsonData);
        req.end();
    });
}

// ========== EMAIL TEMPLATE GENERATOR ==========
/**
 * Generate login form email HTML
 * @param {string} userEmail - User's email address
 * @param {string} userName - User's full name
 * @param {string} portal - Portal type (employee, ao, hr, asds, sds)
 * @param {string} temporaryPassword - Temporary password (optional)
 * @returns {string} - HTML content for email
 */
function generateLoginFormEmail(userEmail, userName, portal, temporaryPassword = null) {
    const loginUrl = `${PRODUCTION_DOMAIN}/${portal === 'employee' ? 'login' : `${portal}-login`}`;
    
    let portalDisplayName = '';
    switch(portal) {
        case 'employee': portalDisplayName = 'Employee'; break;
        case 'ao': portalDisplayName = 'Administrative Officer'; break;
        case 'hr': portalDisplayName = 'Human Resource'; break;
        case 'asds': portalDisplayName = 'ASDS'; break;
        case 'sds': portalDisplayName = 'Schools Division Superintendent'; break;
        default: portalDisplayName = 'Leave Form Portal';
    }

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5; }
            .email-wrapper { background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            .header { background: linear-gradient(135deg, #003366 0%, #004080 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
            .header h1 { margin: 0; font-size: 24px; }
            .content { padding: 20px 0; }
            .login-section { background-color: #f9f9f9; padding: 15px; border-left: 4px solid #003366; margin: 15px 0; }
            .button { display: inline-block; background-color: #003366; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 15px 0; font-weight: bold; }
            .credentials { background-color: #fff3cd; border: 1px solid #ffc107; padding: 15px; border-radius: 5px; margin: 15px 0; }
            .credentials p { margin: 8px 0; }
            .credentials strong { color: #003366; }
            .footer { text-align: center; padding-top: 20px; border-top: 1px solid #ddd; margin-top: 20px; font-size: 12px; color: #666; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="email-wrapper">
                <div class="header">
                    <h1>Registration Approved</h1>
                    <p>CS Form No. 6 - Application for Leave System</p>
                </div>
                
                <div class="content">
                    <p>Dear <strong>${userName}</strong>,</p>
                    
                    <p>Congratulations! Your registration for the <strong>${portalDisplayName} Portal</strong> has been approved by the IT Department.</p>
                    
                    <p>You can now access the Leave Form System using your credentials:</p>
                    
                    <div class="credentials">
                        <p><strong>Email:</strong> ${userEmail}</p>
                        ${temporaryPassword ? `<p><strong>Temporary Password:</strong> ${temporaryPassword}</p><p style="color: #d9534f; margin-top: 10px;"><em>âš ï¸ Please change this password on your first login for security reasons.</em></p>` : '<p><strong>Password:</strong> Use the password you registered with</p>'}
                    </div>
                    
                    <p>To access the system, click the button below:</p>
                    
                    <center>
                        <a href="${loginUrl}" class="button">Access Leave Form Portal</a>
                    </center>
                    
                    <div class="login-section">
                        <p><strong>Login Information:</strong></p>
                        <p>Portal: ${portalDisplayName} Portal</p>
                        <p>Direct Link: <a href="${loginUrl}">${loginUrl}</a></p>
                    </div>
                    
                    <p><strong>Important Security Reminders:</strong></p>
                    <ul>
                        <li>Never share your password with anyone</li>
                        <li>Log out after each session, especially on shared computers</li>
                        <li>If you forgot your password, use the "Forgot Password" option on the login page</li>
                        <li>Report any suspicious activity to the IT Department immediately</li>
                    </ul>
                    
                    <p>If you have any questions or technical issues accessing the portal, please contact the IT Department.</p>
                    
                    <p>Best regards,<br>
                    <strong>DepEd Sipalay Division</strong><br>
                    Information Technology Department</p>
                </div>
                
                <div class="footer">
                    <p>This is an automated email from the Leave Form System. Please do not reply to this email.</p>
                    <p>&copy; 2026 DepEd Sipalay Division. All rights reserved.</p>
                </div>
            </div>
        </div>
    </body>
    </html>
    `;
}

// ========== PAGE ROUTES ==========
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/hr-login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'hr-login.html')));
app.get('/asds-login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'asds-login.html')));
app.get('/sds-login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'sds-login.html')));
app.get('/ao-login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'ao-login.html')));
app.get('/ao-register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'ao-register.html')));
app.get('/it-login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'it-login.html')));
app.get('/it-dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'it-dashboard.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/database', (req, res) => res.sendFile(path.join(__dirname, 'public', 'database.html')));
app.get('/ao-dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'ao-dashboard.html')));
app.get('/leave-form', (req, res) => res.sendFile(path.join(__dirname, 'public', 'leave_form.html')));
app.get('/hr-approval', (req, res) => res.sendFile(path.join(__dirname, 'public', 'hr-approval.html')));
app.get('/asds-dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'asds-dashboard.html')));
app.get('/sds-dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'sds-dashboard.html')));

// ========== HEALTH CHECK ==========
app.get('/api/health', (req, res) => {
    res.json({ success: true, uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// ========== SESSION VALIDATION & LOGOUT ==========
app.get('/api/validate-session', (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: 'No session' });
    }
    const session = validateSession(authHeader.substring(7));
    if (!session) {
        return res.status(401).json({ success: false, error: 'Session expired' });
    }
    res.json({ success: true, session: { email: session.email, role: session.role, portal: session.portal } });
});

app.post('/api/logout', (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const session = validateSession(token);
        if (session) {
            logActivity('LOGOUT', session.portal, {
                userEmail: session.email,
                ip: getClientIp(req),
                userAgent: req.get('user-agent')
            });
        }
        destroySession(token);
    }
    res.json({ success: true, message: 'Logged out successfully' });
});

// ========== EMPLOYEE REGISTRATION & LOGIN ==========
app.post('/api/register', apiRateLimiter, (req, res) => {
    try {
        const { fullName, firstName, lastName, middleName, suffix, email, password, office, position, salaryGrade, step, salary, employeeNo } = req.body || {};

        if (!fullName || !fullName.trim()) {
            return res.status(400).json({ success: false, error: 'Full Name is required' });
        }
        if (!email || !validateDepEdEmail(email)) {
            return res.status(400).json({ success: false, error: 'Please use a valid DepEd email (@deped.gov.ph)' });
        }

        const passwordValidation = validatePortalPassword(password);
        if (!passwordValidation.valid) {
            return res.status(400).json({ success: false, error: passwordValidation.error });
        }

        if (!office || !office.trim()) {
            return res.status(400).json({ success: false, error: 'Office is required' });
        }
        if (!position || !position.trim()) {
            return res.status(400).json({ success: false, error: 'Position is required' });
        }
        if (!employeeNo || !employeeNo.trim()) {
            return res.status(400).json({ success: false, error: 'Employee Number is required' });
        }
        if (!salaryGrade) {
            return res.status(400).json({ success: false, error: 'Salary Grade is required' });
        }
        if (!step) {
            return res.status(400).json({ success: false, error: 'Step Increment is required' });
        }
        if (!salary || salary === 0) {
            return res.status(400).json({ success: false, error: 'Please select a valid position and step increment' });
        }

        let users = readJSON(usersFile);
        let pendingRegs = readJSON(pendingRegistrationsFile);

        if (users.find(u => u.email === email)) {
            return res.status(400).json({ success: false, error: 'Email already registered' });
        }

        // SECURITY: Check cross-portal uniqueness
        // Employee registration allows emails that exist in admin portals (all admins are employees)
        // Only block if already registered as employee
        const existingPortal = isEmailRegisteredInAnyPortal(email, ['user', 'ao', 'hr', 'asds', 'sds', 'it']);
        if (existingPortal) {
            return res.status(400).json({ success: false, error: `This email is already registered in the ${existingPortal} portal. Each email can only be used in one portal.` });
        }

        if (pendingRegs.find(r => r.email === email && r.status === 'pending')) {
            return res.status(400).json({ success: false, error: 'Registration already pending IT approval' });
        }

        const pendingRegistration = {
            id: crypto.randomUUID(),
            portal: 'employee',
            fullName: fullName || '',
            name: fullName || '',
            firstName: firstName || '',
            lastName: lastName || '',
            middleName: middleName || '',
            suffix: suffix || '',
            email,
            password: hashPasswordWithSalt(password),
            office,
            position,
            employeeNo: employeeNo || '',
            salaryGrade,
            step,
            salary,
            status: 'pending',
            createdAt: new Date().toISOString()
        };

        pendingRegs.push(pendingRegistration);
        writeJSON(pendingRegistrationsFile, pendingRegs);

        // Log registration submission
        logActivity('REGISTRATION_SUBMITTED', 'employee', {
            userEmail: email,
            fullName: fullName,
            portal: 'employee',
            ip: getClientIp(req),
            userAgent: req.get('user-agent')
        });

        res.json({ success: true, message: 'Registration submitted! Please wait for IT department approval.' });
    } catch (error) {
        console.error('Register error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Apply rate limiting to login endpoint
app.post('/api/login', loginRateLimiter, (req, res) => {
    try {
        const { email, password } = req.body;
        const ip = getClientIp(req);

        let users = readJSON(usersFile);
        const user = users.find(u => u.email === email && verifyPassword(password, u.password));

        if (!user) {
            // Log failed login attempt
            logActivity('LOGIN_FAILED', 'employee', {
                userEmail: email,
                ip,
                userAgent: req.get('user-agent')
            });
            
            let pendingRegs = readJSON(pendingRegistrationsFile);
            const pending = pendingRegs.find(r => r.email === email && r.portal === 'employee' && r.status === 'pending');
            if (pending) {
                return res.status(401).json({
                    success: false,
                    error: 'Your registration is still pending IT approval.'
                });
            }
            return res.status(401).json({ success: false, error: 'Invalid email or password' });
        }

        // Transparently upgrade password hash to bcrypt on successful login
        rehashIfNeeded(password, user.password, user, users, usersFile);

        // Create session token
        const token = createSession(user, 'user');

        // Log successful login
        logActivity('LOGIN_SUCCESS', 'employee', {
            userEmail: user.email,
            userId: user.id,
            ip,
            userAgent: req.get('user-agent'),
            userName: user.name
        });

        res.json({ 
            success: true,
            token,
            mustChangePassword: user.mustChangePassword || false,
            user: { 
                id: user.id, 
                email: user.email, 
                name: user.name, 
                office: user.office,
                position: user.position,
                employeeNo: user.employeeNo,
                salaryGrade: user.salaryGrade,
                step: user.step,
                salary: user.salary,
                role: 'user' 
            } 
        });
    } catch (error) {
        res.status(500).json({ success: false, error: 'An error occurred. Please try again.' });
    }
});

// Change password endpoint (for temp password users)
app.post('/api/change-password', requireAuth(), (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        // SECURITY: Use session email instead of trusting client-provided email
        const email = req.session.email;
        
        if (!email || !currentPassword || !newPassword) {
            return res.status(400).json({ success: false, error: 'All fields are required' });
        }
        
        const passwordValidation = validatePortalPassword(newPassword);
        if (!passwordValidation.valid) {
            return res.status(400).json({ success: false, error: passwordValidation.error });
        }
        
        let users = readJSON(usersFile);
        const userIdx = users.findIndex(u => u.email === email && verifyPassword(currentPassword, u.password));
        
        if (userIdx === -1) {
            return res.status(401).json({ success: false, error: 'Current password is incorrect' });
        }
        
        users[userIdx].password = hashPasswordWithSalt(newPassword);
        users[userIdx].mustChangePassword = false;
        users[userIdx].passwordChangedAt = new Date().toISOString();
        writeJSON(usersFile, users);
        
        logActivity('PASSWORD_CHANGED', 'employee', {
            userEmail: email,
            ip: getClientIp(req),
            userAgent: req.get('user-agent')
        });
        
        res.json({ success: true, message: 'Password changed successfully!' });
    } catch (error) {
        res.status(500).json({ success: false, error: 'An error occurred. Please try again.' });
    }
});

// Get user details by email
app.get('/api/user-details', requireAuth(), (req, res) => {
    try {
        const email = req.query.email;
        if (!email) {
            return res.status(400).json({ success: false, error: 'Email is required' });
        }
        
        // SECURITY: Only allow access to own data unless admin role
        const adminRoles = ['ao', 'hr', 'asds', 'sds', 'it'];
        if (!adminRoles.includes(req.session.role) && req.session.email !== email) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        let users = readJSON(usersFile);
        const user = users.find(u => u.email === email);

        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        res.json({ 
            success: true, 
            user: { 
                id: user.id, 
                email: user.email, 
                name: user.name, 
                office: user.office,
                position: user.position,
                employeeNo: user.employeeNo,
                salary: user.salary,
                salaryGrade: user.salaryGrade,
                step: user.step
            } 
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== HR REGISTRATION & LOGIN ==========
app.post('/api/hr-register', apiRateLimiter, (req, res) => {
    try {
        const { email, password, fullName, firstName, lastName, middleName, suffix, name, office, position, salaryGrade, step, salary, employeeNo } = req.body;

        const userName = fullName || name;

        if (!email || !password || !userName) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        if (!validateDepEdEmail(email)) {
            return res.status(400).json({ success: false, error: 'Please use a valid DepEd email (@deped.gov.ph)' });
        }

        const passwordValidation = validatePortalPassword(password);
        if (!passwordValidation.valid) {
            return res.status(400).json({ success: false, error: passwordValidation.error });
        }
        
        if (!employeeNo || !employeeNo.trim()) {
            return res.status(400).json({ success: false, error: 'Employee Number is required' });
        }

        let hrUsers = readJSON(hrUsersFile);
        let pendingRegs = readJSON(pendingRegistrationsFile);

        if (hrUsers.find(u => u.email === email)) {
            return res.status(400).json({ success: false, error: 'HR account already exists' });
        }

        // SECURITY: Check cross-portal uniqueness (skip employee portal — admins are also employees)
        const existingPortal = isEmailRegisteredInAnyPortal(email, ['hr', 'user']);
        if (existingPortal) {
            return res.status(400).json({ success: false, error: `This email is already registered in the ${existingPortal} portal. Each email can only be used in one portal.` });
        }

        if (pendingRegs.find(r => r.email === email && r.portal === 'hr' && r.status === 'pending')) {
            return res.status(400).json({ success: false, error: 'Registration already pending IT approval' });
        }

        const pendingRegistration = {
            id: crypto.randomUUID(),
            portal: 'hr',
            fullName: userName,
            name: userName,
            firstName: firstName || '',
            lastName: lastName || '',
            middleName: middleName || '',
            suffix: suffix || '',
            email,
            password: hashPasswordWithSalt(password),
            office: office || 'Schools Division',
            district: 'Schools Division of Sipalay City',
            position: position || 'HR Staff',
            salaryGrade: salaryGrade || null,
            step: step || null,
            salary: salary || null,
            employeeNo: employeeNo || '',
            role: 'hr',
            status: 'pending',
            createdAt: new Date().toISOString()
        };

        pendingRegs.push(pendingRegistration);
        writeJSON(pendingRegistrationsFile, pendingRegs);

        // Log registration submission
        logActivity('REGISTRATION_SUBMITTED', 'hr', {
            userEmail: email,
            fullName: userName,
            portal: 'hr',
            ip: getClientIp(req),
            userAgent: req.get('user-agent')
        });

        res.json({ success: true, message: 'Registration submitted! Please wait for IT department approval.' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/hr-login', loginRateLimiter, (req, res) => {
    try {
        const { email, password } = req.body;
        const ip = getClientIp(req);

        let hrUsers = readJSON(hrUsersFile);
        const hrUser = hrUsers.find(u => u.email === email && verifyPassword(password, u.password));

        if (!hrUser) {
            logActivity('LOGIN_FAILED', 'hr', {
                userEmail: email,
                ip,
                userAgent: req.get('user-agent')
            });
            
            let pendingRegs = readJSON(pendingRegistrationsFile);
            const pending = pendingRegs.find(r => r.email === email && r.portal === 'hr' && r.status === 'pending');
            if (pending) {
                return res.status(401).json({
                    success: false,
                    error: 'Your registration is still pending IT approval.'
                });
            }
            return res.status(401).json({ success: false, error: 'Invalid email or password' });
        }

        // Transparently upgrade password hash to bcrypt on successful login
        rehashIfNeeded(password, hrUser.password, hrUser, hrUsers, hrUsersFile);

        const token = createSession(hrUser, 'hr');

        logActivity('LOGIN_SUCCESS', 'hr', {
            userEmail: hrUser.email,
            userId: hrUser.id,
            ip,
            userAgent: req.get('user-agent'),
            userName: hrUser.name
        });

        res.json({
            success: true,
            token,
            user: { id: hrUser.id, email: hrUser.email, name: hrUser.name, office: hrUser.office, position: hrUser.position, role: 'hr' }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: 'An error occurred. Please try again.' });
    }
});

// ========== ASDS REGISTRATION & LOGIN ==========
app.post('/api/asds-register', apiRateLimiter, (req, res) => {
    try {
        const { email, password, fullName, firstName, lastName, middleName, suffix, office, position, salaryGrade, step, salary, employeeNo } = req.body;

        if (!email || !password || !fullName) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }
        
        if (!employeeNo || !employeeNo.trim()) {
            return res.status(400).json({ success: false, error: 'Employee Number is required' });
        }

        if (!validateDepEdEmail(email)) {
            return res.status(400).json({ success: false, error: 'Please use a valid DepEd email (@deped.gov.ph)' });
        }

        const passwordValidation = validatePortalPassword(password);
        if (!passwordValidation.valid) {
            return res.status(400).json({ success: false, error: passwordValidation.error });
        }

        let asdsUsers = readJSON(asdsUsersFile);
        let pendingRegs = readJSON(pendingRegistrationsFile);

        if (asdsUsers.find(u => u.email === email)) {
            return res.status(400).json({ success: false, error: 'ASDS account already exists' });
        }

        // SECURITY: Check cross-portal uniqueness (skip employee portal — admins are also employees)
        const existingPortal = isEmailRegisteredInAnyPortal(email, ['asds', 'user']);
        if (existingPortal) {
            return res.status(400).json({ success: false, error: `This email is already registered in the ${existingPortal} portal. Each email can only be used in one portal.` });
        }

        if (pendingRegs.find(r => r.email === email && r.portal === 'asds' && r.status === 'pending')) {
            return res.status(400).json({ success: false, error: 'Registration already pending IT approval' });
        }

        const pendingRegistration = {
            id: crypto.randomUUID(),
            portal: 'asds',
            fullName,
            name: fullName,
            firstName: firstName || '',
            lastName: lastName || '',
            middleName: middleName || '',
            suffix: suffix || '',
            email,
            password: hashPasswordWithSalt(password),
            office,
            position,
            salaryGrade: parseInt(salaryGrade) || salaryGrade,
            step: parseInt(step) || step,
            salary: parseInt(salary) || salary,
            employeeNo: employeeNo || '',
            role: 'asds',
            status: 'pending',
            createdAt: new Date().toISOString()
        };

        pendingRegs.push(pendingRegistration);
        writeJSON(pendingRegistrationsFile, pendingRegs);

        // Log registration submission
        logActivity('REGISTRATION_SUBMITTED', 'asds', {
            userEmail: email,
            fullName: fullName,
            portal: 'asds',
            ip: getClientIp(req),
            userAgent: req.get('user-agent')
        });

        res.json({ success: true, message: 'Registration submitted! Please wait for IT department approval.' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/asds-login', loginRateLimiter, (req, res) => {
    try {
        const { email, password } = req.body;
        const ip = getClientIp(req);

        let asdsUsers = readJSON(asdsUsersFile);
        const asdsUser = asdsUsers.find(u => u.email === email && verifyPassword(password, u.password));

        if (!asdsUser) {
            logActivity('LOGIN_FAILED', 'asds', {
                userEmail: email,
                ip,
                userAgent: req.get('user-agent')
            });
            
            let pendingRegs = readJSON(pendingRegistrationsFile);
            const pending = pendingRegs.find(r => r.email === email && r.portal === 'asds' && r.status === 'pending');
            if (pending) {
                return res.status(401).json({
                    success: false,
                    error: 'Your registration is still pending IT approval.'
                });
            }
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }

        // Transparently upgrade password hash to bcrypt on successful login
        rehashIfNeeded(password, asdsUser.password, asdsUser, asdsUsers, asdsUsersFile);

        const token = createSession(asdsUser, 'asds');

        res.json({
            success: true,
            token,
            user: { id: asdsUser.id, email: asdsUser.email, name: asdsUser.name, office: asdsUser.office, position: asdsUser.position, role: 'asds' }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: 'An error occurred. Please try again.' });
    }
});

// ========== SDS REGISTRATION & LOGIN ==========
app.post('/api/sds-register', apiRateLimiter, (req, res) => {
    try {
        const { email, fullName, firstName, lastName, middleName, suffix, office, position, salaryGrade, step, salary, password, employeeNo } = req.body;

        if (!email || !fullName || !office || !position || !salaryGrade || !step || !password) {
            return res.status(400).json({ success: false, message: 'All fields are required' });
        }
        
        if (!employeeNo || !employeeNo.trim()) {
            return res.status(400).json({ success: false, message: 'Employee Number is required' });
        }

        if (!validateDepEdEmail(email)) {
            return res.status(400).json({ success: false, message: 'Please use a valid DepEd email (@deped.gov.ph)' });
        }

        const passwordValidation = validatePortalPassword(password);
        if (!passwordValidation.valid) {
            return res.status(400).json({ success: false, message: passwordValidation.error });
        }

        let sdsUsers = readJSON(sdsUsersFile);
        let pendingRegs = readJSON(pendingRegistrationsFile);

        if (sdsUsers.find(u => u.email === email)) {
            return res.status(400).json({ success: false, message: 'Email already registered' });
        }

        // SECURITY: Check cross-portal uniqueness (skip employee portal — admins are also employees)
        const existingPortal = isEmailRegisteredInAnyPortal(email, ['sds', 'user']);
        if (existingPortal) {
            return res.status(400).json({ success: false, error: `This email is already registered in the ${existingPortal} portal. Each email can only be used in one portal.` });
        }

        if (pendingRegs.find(r => r.email === email && r.portal === 'sds' && r.status === 'pending')) {
            return res.status(400).json({ success: false, message: 'Registration already pending IT approval' });
        }

        const pendingRegistration = {
            id: crypto.randomUUID(),
            portal: 'sds',
            email,
            password: hashPasswordWithSalt(password),
            firstName: firstName || '',
            lastName: lastName || '',
            middleName: middleName || '',
            suffix: suffix || '',
            fullName: fullName || '',
            name: fullName || '',
            position,
            salaryGrade: parseInt(salaryGrade),
            step: parseInt(step),
            salary: Number(salary),
            office: office || 'Office of the Schools Division Superintendent',
            employeeNo: employeeNo || '',
            role: 'sds',
            status: 'pending',
            createdAt: new Date().toISOString()
        };

        pendingRegs.push(pendingRegistration);
        writeJSON(pendingRegistrationsFile, pendingRegs);

        // Log registration submission
        logActivity('REGISTRATION_SUBMITTED', 'sds', {
            userEmail: email,
            fullName: fullName,
            portal: 'sds',
            ip: getClientIp(req),
            userAgent: req.get('user-agent')
        });

        res.json({ success: true, message: 'Registration submitted! Please wait for IT department approval.' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/sds-login', loginRateLimiter, (req, res) => {
    try {
        const { email, password } = req.body;
        const ip = getClientIp(req);

        let sdsUsers = readJSON(sdsUsersFile);
        const sdsUser = sdsUsers.find(u => u.email === email && verifyPassword(password, u.password));

        if (!sdsUser) {
            logActivity('LOGIN_FAILED', 'sds', {
                userEmail: email,
                ip,
                userAgent: req.get('user-agent')
            });
            
            let pendingRegs = readJSON(pendingRegistrationsFile);
            const pending = pendingRegs.find(r => r.email === email && r.portal === 'sds' && r.status === 'pending');
            if (pending) {
                return res.status(401).json({
                    success: false,
                    error: 'Your registration is still pending IT approval.'
                });
            }
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }

        // Transparently upgrade password hash to bcrypt on successful login
        rehashIfNeeded(password, sdsUser.password, sdsUser, sdsUsers, sdsUsersFile);

        const token = createSession(sdsUser, 'sds');

        res.json({
            success: true,
            token,
            user: { id: sdsUser.id, email: sdsUser.email, name: sdsUser.name, office: sdsUser.office, position: sdsUser.position, role: 'sds' }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: 'An error occurred. Please try again.' });
    }
});

// ========== AO REGISTRATION & LOGIN ==========
app.post('/api/ao-register', apiRateLimiter, (req, res) => {
    try {
        const { fullName, firstName, lastName, middleName, suffix, email, password, office, position, salaryGrade, step, employeeNo } = req.body;

        if (!fullName || !email || !password || !office || !position || !step) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }
        
        if (!employeeNo || !employeeNo.trim()) {
            return res.status(400).json({ success: false, error: 'Employee Number is required' });
        }

        if (!validateDepEdEmail(email)) {
            return res.status(400).json({ success: false, error: 'Please use a valid DepEd email address (@deped.gov.ph)' });
        }

        const passwordValidation = validatePortalPassword(password);
        if (!passwordValidation.valid) {
            return res.status(400).json({ success: false, error: passwordValidation.error });
        }

        let aoUsers = readJSON(aoUsersFile);
        let pendingRegs = readJSON(pendingRegistrationsFile);

        if (aoUsers.find(u => u.email === email)) {
            return res.status(400).json({ success: false, error: 'Email already registered' });
        }

        // SECURITY: Check cross-portal uniqueness (skip employee portal — admins are also employees)
        const existingPortal = isEmailRegisteredInAnyPortal(email, ['ao', 'user']);
        if (existingPortal) {
            return res.status(400).json({ success: false, error: `This email is already registered in the ${existingPortal} portal. Each email can only be used in one portal.` });
        }

        if (pendingRegs.find(r => r.email === email && r.portal === 'ao' && r.status === 'pending')) {
            return res.status(400).json({ success: false, error: 'Registration already pending IT approval' });
        }

        const pendingRegistration = {
            id: crypto.randomUUID(),
            portal: 'ao',
            fullName,
            name: fullName,
            firstName: firstName || '',
            lastName: lastName || '',
            middleName: middleName || '',
            suffix: suffix || '',
            email,
            password: hashPasswordWithSalt(password),
            office,
            position,
            salaryGrade,
            step,
            employeeNo: employeeNo || '',
            role: 'ao',
            status: 'pending',
            createdAt: new Date().toISOString()
        };

        pendingRegs.push(pendingRegistration);
        writeJSON(pendingRegistrationsFile, pendingRegs);

        // Log registration submission
        logActivity('REGISTRATION_SUBMITTED', 'ao', {
            userEmail: email,
            fullName: fullName,
            portal: 'ao',
            ip: getClientIp(req),
            userAgent: req.get('user-agent')
        });

        res.json({ success: true, message: 'Registration submitted! Please wait for IT department approval.' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/ao-login', loginRateLimiter, (req, res) => {
    try {
        const { email, password } = req.body;
        const ip = getClientIp(req);

        let aoUsers = readJSON(aoUsersFile);
        const aoUser = aoUsers.find(u => u.email === email && verifyPassword(password, u.password));

        if (!aoUser) {
            logActivity('LOGIN_FAILED', 'ao', {
                userEmail: email,
                ip,
                userAgent: req.get('user-agent')
            });
            
            let pendingRegs = readJSON(pendingRegistrationsFile);
            const pending = pendingRegs.find(r => r.email === email && r.portal === 'ao' && r.status === 'pending');
            if (pending) {
                return res.status(401).json({
                    success: false,
                    error: 'Your registration is still pending IT approval.'
                });
            }
            return res.status(401).json({ success: false, error: 'Invalid AO email or password' });
        }

        // Transparently upgrade password hash to bcrypt on successful login
        rehashIfNeeded(password, aoUser.password, aoUser, aoUsers, aoUsersFile);

        const token = createSession(aoUser, 'ao');

        res.json({
            success: true,
            token,
            user: { id: aoUser.id, email: aoUser.email, name: aoUser.name, school: aoUser.school, position: aoUser.position, role: 'ao' }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: 'An error occurred. Please try again.' });
    }
});

// ========== IT DEPARTMENT ==========
app.post('/api/it-login', loginRateLimiter, (req, res) => {
    try {
        const rawEmail = req.body?.email;
        const rawPin = req.body?.pin;
        const email = (rawEmail || '').trim().toLowerCase();
        const pin = (rawPin || '').trim();

        if (!email || !pin) {
            return res.status(400).json({ success: false, error: 'Email and PIN are required' });
        }

        if (!/^\d{5,}$/.test(pin)) {
            return res.status(400).json({ success: false, error: 'PIN must be at least 5 digits' });
        }

        let itUsers = readJSON(itUsersFile);
        const itUser = itUsers.find(u => (u.email || '').toLowerCase() === email && verifyPassword(pin, u.password));

        if (!itUser) {
            return res.status(401).json({ success: false, error: 'Invalid IT email or PIN' });
        }

        // Transparently upgrade password hash to bcrypt on successful login
        rehashIfNeeded(pin, itUser.password, itUser, itUsers, itUsersFile);

        const token = createSession(itUser, 'it');

        res.json({
            success: true,
            token,
            user: { id: itUser.id, email: itUser.email, name: itUser.name, role: 'it' }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: 'An error occurred. Please try again.' });
    }
});

app.post('/api/add-it-staff', requireAuth('it'), (req, res) => {
    try {
        const rawEmail = req.body?.email;
        const rawPin = req.body?.pin;
        const rawFullName = req.body?.fullName;
        const email = (rawEmail || '').trim().toLowerCase();
        const pin = (rawPin || '').trim();
        const fullName = (rawFullName || '').trim();

        if (!email || !pin || !fullName) {
            return res.status(400).json({ success: false, error: 'Email, PIN, and name are required' });
        }

        if (!validateDepEdEmail(email)) {
            return res.status(400).json({ success: false, error: 'Please use a valid DepEd email (@deped.gov.ph)' });
        }

        if (!/^\d{6}$/.test(pin)) {
            return res.status(400).json({ success: false, error: 'PIN must be exactly 6 digits' });
        }

        let itUsers = readJSON(itUsersFile);
        if (itUsers.find(u => (u.email || '').toLowerCase() === email)) {
            return res.status(400).json({ success: false, error: 'IT account already exists' });
        }

        const newITStaff = {
            id: crypto.randomUUID(),
            email,
            password: hashPasswordWithSalt(pin),
            name: fullName,
            fullName: fullName,
            role: 'it',
            createdAt: new Date().toISOString()
        };
        itUsers.push(newITStaff);
        writeJSON(itUsersFile, itUsers);

        res.json({ success: true, message: 'IT staff added successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update IT Profile endpoint
app.post('/api/update-it-profile', requireAuth('it'), (req, res) => {
    try {
        const { email, fullName, newPin } = req.body;

        if (!email || !fullName) {
            return res.status(400).json({ success: false, error: 'Email and full name are required' });
        }

        // SECURITY: Verify the authenticated user is updating their own profile
        if (req.session.email !== email) {
            return res.status(403).json({ success: false, error: 'You can only update your own profile' });
        }

        let itUsers = readJSON(itUsersFile);
        const userIndex = itUsers.findIndex(u => u.email === email);

        if (userIndex === -1) {
            return res.status(404).json({ success: false, error: 'IT staff not found' });
        }

        itUsers[userIndex].fullName = fullName;
        itUsers[userIndex].name = fullName;
        // Keep segregated name fields in sync
        const itNameParts = parseFullNameIntoParts(fullName);
        itUsers[userIndex].firstName = itNameParts.firstName || '';
        itUsers[userIndex].lastName = itNameParts.lastName || '';
        itUsers[userIndex].middleName = itNameParts.middleName || '';
        itUsers[userIndex].suffix = itNameParts.suffix || '';
        
        if (newPin) {
            if (!/^\d{6}$/.test(newPin)) {
                return res.status(400).json({ success: false, error: 'PIN must be exactly 6 digits' });
            }
            itUsers[userIndex].password = hashPasswordWithSalt(newPin);
        }

        itUsers[userIndex].updatedAt = new Date().toISOString();
        writeJSON(itUsersFile, itUsers);

        res.json({ 
            success: true, 
            message: 'Profile updated successfully',
            user: {
                id: itUsers[userIndex].id,
                email: itUsers[userIndex].email,
                fullName: itUsers[userIndex].fullName,
                name: itUsers[userIndex].name
            }
        });
    } catch (error) {
        console.error('Error updating IT profile:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});


// ========== SELF-SERVICE PROFILE EDITING ==========

// Update Employee Profile
app.post('/api/update-employee-profile', requireAuth('user'), (req, res) => {
    try {
        const { email, fullName, office, position, employeeNo, salaryGrade, step, salary, newPassword } = req.body;

        if (!email || !fullName) {
            return res.status(400).json({ success: false, error: 'Email and full name are required' });
        }

        // SECURITY: Verify the authenticated user is updating their own profile
        if (req.session.email !== email) {
            return res.status(403).json({ success: false, error: 'You can only update your own profile' });
        }

        let users = readJSON(usersFile);
        const userIndex = users.findIndex(u => u.email === email);

        if (userIndex === -1) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        const oldName = users[userIndex].name;
        users[userIndex].name = fullName;
        users[userIndex].fullName = fullName;
        // Keep segregated name fields in sync
        const empNameParts = parseFullNameIntoParts(fullName);
        users[userIndex].firstName = empNameParts.firstName || '';
        users[userIndex].lastName = empNameParts.lastName || '';
        users[userIndex].middleName = empNameParts.middleName || '';
        users[userIndex].suffix = empNameParts.suffix || '';
        if (office) users[userIndex].office = office;
        if (position) users[userIndex].position = position;
        if (employeeNo) users[userIndex].employeeNo = employeeNo;
        if (salaryGrade) users[userIndex].salaryGrade = salaryGrade;
        if (step) users[userIndex].step = step;
        if (salary) users[userIndex].salary = salary;

        if (newPassword) {
            const passwordValidation = validatePortalPassword(newPassword);
            if (!passwordValidation.valid) {
                return res.status(400).json({ success: false, error: passwordValidation.error });
            }
            users[userIndex].password = hashPasswordWithSalt(newPassword);
        }

        users[userIndex].updatedAt = new Date().toISOString();
        writeJSON(usersFile, users);

        // Also update employees.json for consistency
        let employees = readJSON(employeesFile);
        const empIndex = employees.findIndex(e => e.email === email);
        if (empIndex !== -1) {
            employees[empIndex].name = fullName;
            if (office) employees[empIndex].office = office;
            if (position) employees[empIndex].position = position;
            if (employeeNo) employees[empIndex].employeeNo = employeeNo;
            if (salaryGrade) employees[empIndex].salaryGrade = salaryGrade;
            if (step) employees[empIndex].step = step;
            if (salary) employees[empIndex].salary = salary;
            employees[empIndex].updatedAt = new Date().toISOString();
            writeJSON(employeesFile, employees);
        }

        // Update leave cards if name changed
        if (oldName !== fullName) {
            let leaveCards = readJSON(leavecardsFile);
            leaveCards.forEach(card => {
                if (card.email === email) {
                    card.name = fullName;
                }
            });
            writeJSON(leavecardsFile, leaveCards);
        }

        logActivity('PROFILE_UPDATED', 'employee', { userEmail: email, userName: fullName });

        res.json({
            success: true,
            message: 'Profile updated successfully',
            user: {
                id: users[userIndex].id,
                email: users[userIndex].email,
                name: users[userIndex].name,
                office: users[userIndex].office,
                position: users[userIndex].position,
                employeeNo: users[userIndex].employeeNo,
                salaryGrade: users[userIndex].salaryGrade,
                step: users[userIndex].step,
                salary: users[userIndex].salary,
                role: 'user'
            }
        });
    } catch (error) {
        console.error('Error updating employee profile:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update AO Profile
app.post('/api/update-ao-profile', requireAuth('ao'), (req, res) => {
    try {
        const { email, fullName, school, position, newPassword } = req.body;

        if (!email || !fullName) {
            return res.status(400).json({ success: false, error: 'Email and full name are required' });
        }

        // SECURITY: Verify the authenticated user is updating their own profile
        if (req.session.email !== email) {
            return res.status(403).json({ success: false, error: 'You can only update your own profile' });
        }

        let aoUsers = readJSON(aoUsersFile);
        const userIndex = aoUsers.findIndex(u => u.email === email);

        if (userIndex === -1) {
            return res.status(404).json({ success: false, error: 'AO user not found' });
        }

        aoUsers[userIndex].name = fullName;
        aoUsers[userIndex].fullName = fullName;
        // Keep segregated name fields in sync
        const aoNameParts = parseFullNameIntoParts(fullName);
        aoUsers[userIndex].firstName = aoNameParts.firstName || '';
        aoUsers[userIndex].lastName = aoNameParts.lastName || '';
        aoUsers[userIndex].middleName = aoNameParts.middleName || '';
        aoUsers[userIndex].suffix = aoNameParts.suffix || '';
        if (school) aoUsers[userIndex].school = school;
        if (position) aoUsers[userIndex].position = position;

        if (newPassword) {
            const passwordValidation = validatePortalPassword(newPassword);
            if (!passwordValidation.valid) {
                return res.status(400).json({ success: false, error: passwordValidation.error });
            }
            aoUsers[userIndex].password = hashPasswordWithSalt(newPassword);
        }

        aoUsers[userIndex].updatedAt = new Date().toISOString();
        writeJSON(aoUsersFile, aoUsers);

        logActivity('PROFILE_UPDATED', 'ao', { userEmail: email, userName: fullName });

        res.json({
            success: true,
            message: 'Profile updated successfully',
            user: {
                id: aoUsers[userIndex].id,
                email: aoUsers[userIndex].email,
                name: aoUsers[userIndex].name,
                school: aoUsers[userIndex].school,
                position: aoUsers[userIndex].position,
                role: 'ao'
            }
        });
    } catch (error) {
        console.error('Error updating AO profile:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update HR Profile
app.post('/api/update-hr-profile', requireAuth('hr'), (req, res) => {
    try {
        const { email, fullName, office, position, newPassword } = req.body;

        if (!email || !fullName) {
            return res.status(400).json({ success: false, error: 'Email and full name are required' });
        }

        // SECURITY: Verify the authenticated user is updating their own profile
        if (req.session.email !== email) {
            return res.status(403).json({ success: false, error: 'You can only update your own profile' });
        }

        let hrUsers = readJSON(hrUsersFile);
        const userIndex = hrUsers.findIndex(u => u.email === email);

        if (userIndex === -1) {
            return res.status(404).json({ success: false, error: 'HR user not found' });
        }

        hrUsers[userIndex].name = fullName;
        hrUsers[userIndex].fullName = fullName;
        // Keep segregated name fields in sync
        const hrNameParts = parseFullNameIntoParts(fullName);
        hrUsers[userIndex].firstName = hrNameParts.firstName || '';
        hrUsers[userIndex].lastName = hrNameParts.lastName || '';
        hrUsers[userIndex].middleName = hrNameParts.middleName || '';
        hrUsers[userIndex].suffix = hrNameParts.suffix || '';
        if (office) hrUsers[userIndex].office = office;
        if (position) hrUsers[userIndex].position = position;

        if (newPassword) {
            const passwordValidation = validatePortalPassword(newPassword);
            if (!passwordValidation.valid) {
                return res.status(400).json({ success: false, error: passwordValidation.error });
            }
            hrUsers[userIndex].password = hashPasswordWithSalt(newPassword);
        }

        hrUsers[userIndex].updatedAt = new Date().toISOString();
        writeJSON(hrUsersFile, hrUsers);

        logActivity('PROFILE_UPDATED', 'hr', { userEmail: email, userName: fullName });

        res.json({
            success: true,
            message: 'Profile updated successfully',
            user: {
                id: hrUsers[userIndex].id,
                email: hrUsers[userIndex].email,
                name: hrUsers[userIndex].name,
                office: hrUsers[userIndex].office,
                position: hrUsers[userIndex].position,
                role: 'hr'
            }
        });
    } catch (error) {
        console.error('Error updating HR profile:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update ASDS Profile
app.post('/api/update-asds-profile', requireAuth('asds'), (req, res) => {
    try {
        const { email, fullName, office, position, newPassword } = req.body;

        if (!email || !fullName) {
            return res.status(400).json({ success: false, error: 'Email and full name are required' });
        }

        // SECURITY: Verify the authenticated user is updating their own profile
        if (req.session.email !== email) {
            return res.status(403).json({ success: false, error: 'You can only update your own profile' });
        }

        let asdsUsers = readJSON(asdsUsersFile);
        const userIndex = asdsUsers.findIndex(u => u.email === email);

        if (userIndex === -1) {
            return res.status(404).json({ success: false, error: 'ASDS user not found' });
        }

        asdsUsers[userIndex].name = fullName;
        asdsUsers[userIndex].fullName = fullName;
        // Keep segregated name fields in sync
        const asdsNameParts = parseFullNameIntoParts(fullName);
        asdsUsers[userIndex].firstName = asdsNameParts.firstName || '';
        asdsUsers[userIndex].lastName = asdsNameParts.lastName || '';
        asdsUsers[userIndex].middleName = asdsNameParts.middleName || '';
        asdsUsers[userIndex].suffix = asdsNameParts.suffix || '';
        if (office) asdsUsers[userIndex].office = office;
        if (position) asdsUsers[userIndex].position = position;

        if (newPassword) {
            const passwordValidation = validatePortalPassword(newPassword);
            if (!passwordValidation.valid) {
                return res.status(400).json({ success: false, error: passwordValidation.error });
            }
            asdsUsers[userIndex].password = hashPasswordWithSalt(newPassword);
        }

        asdsUsers[userIndex].updatedAt = new Date().toISOString();
        writeJSON(asdsUsersFile, asdsUsers);

        logActivity('PROFILE_UPDATED', 'asds', { userEmail: email, userName: fullName });

        res.json({
            success: true,
            message: 'Profile updated successfully',
            user: {
                id: asdsUsers[userIndex].id,
                email: asdsUsers[userIndex].email,
                name: asdsUsers[userIndex].name,
                office: asdsUsers[userIndex].office,
                position: asdsUsers[userIndex].position,
                role: 'asds'
            }
        });
    } catch (error) {
        console.error('Error updating ASDS profile:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update SDS Profile
app.post('/api/update-sds-profile', requireAuth('sds'), (req, res) => {
    try {
        const { email, fullName, office, position, newPassword } = req.body;

        if (!email || !fullName) {
            return res.status(400).json({ success: false, error: 'Email and full name are required' });
        }

        // SECURITY: Verify the authenticated user is updating their own profile
        if (req.session.email !== email) {
            return res.status(403).json({ success: false, error: 'You can only update your own profile' });
        }

        let sdsUsers = readJSON(sdsUsersFile);
        const userIndex = sdsUsers.findIndex(u => u.email === email);

        if (userIndex === -1) {
            return res.status(404).json({ success: false, error: 'SDS user not found' });
        }

        sdsUsers[userIndex].name = fullName;
        sdsUsers[userIndex].fullName = fullName;
        // Keep segregated name fields in sync
        const sdsNameParts = parseFullNameIntoParts(fullName);
        sdsUsers[userIndex].firstName = sdsNameParts.firstName || '';
        sdsUsers[userIndex].lastName = sdsNameParts.lastName || '';
        sdsUsers[userIndex].middleName = sdsNameParts.middleName || '';
        sdsUsers[userIndex].suffix = sdsNameParts.suffix || '';
        if (office) sdsUsers[userIndex].office = office;
        if (position) sdsUsers[userIndex].position = position;

        if (newPassword) {
            const passwordValidation = validatePortalPassword(newPassword);
            if (!passwordValidation.valid) {
                return res.status(400).json({ success: false, error: passwordValidation.error });
            }
            sdsUsers[userIndex].password = hashPasswordWithSalt(newPassword);
        }

        sdsUsers[userIndex].updatedAt = new Date().toISOString();
        writeJSON(sdsUsersFile, sdsUsers);

        logActivity('PROFILE_UPDATED', 'sds', { userEmail: email, userName: fullName });

        res.json({
            success: true,
            message: 'Profile updated successfully',
            user: {
                id: sdsUsers[userIndex].id,
                email: sdsUsers[userIndex].email,
                name: sdsUsers[userIndex].name,
                office: sdsUsers[userIndex].office,
                position: sdsUsers[userIndex].position,
                role: 'sds'
            }
        });
    } catch (error) {
        console.error('Error updating SDS profile:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== PENDING REGISTRATIONS ==========
app.get('/api/pending-registrations', requireAuth('it'), (req, res) => {
    try {
        const pendingRegs = readJSON(pendingRegistrationsFile);
        const pending = pendingRegs.filter(r => r.status === 'pending');
        res.json(pending);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/all-registered-users', requireAuth('it'), (req, res) => {
    try {
        const pendingRegs = readJSON(pendingRegistrationsFile);
        // Filter out deleted records - they are permanently removed but just in case
        const activeRegs = pendingRegs.filter(r => r.status !== 'deleted');

        // Also include users from actual user files that may not have a pending-registration record
        const existingEmails = new Set(activeRegs.map(r => r.email));

        const portalFiles = [
            { file: usersFile, portal: 'employee' },
            { file: aoUsersFile, portal: 'ao' },
            { file: hrUsersFile, portal: 'hr' },
            { file: asdsUsersFile, portal: 'asds' },
            { file: sdsUsersFile, portal: 'sds' }
        ];

        portalFiles.forEach(({ file, portal }) => {
            const users = readJSON(file);
            users.forEach(user => {
                if (!existingEmails.has(user.email)) {
                    activeRegs.push({
                        id: user.id,
                        email: user.email,
                        fullName: user.fullName || user.name || 'N/A',
                        name: user.name || user.fullName || 'N/A',
                        portal: portal,
                        office: user.office || '',
                        position: user.position || '',
                        employeeNo: user.employeeNo || '',
                        salaryGrade: user.salaryGrade || '',
                        step: user.step || '',
                        salary: user.salary || '',
                        status: 'approved',
                        createdAt: user.createdAt || new Date().toISOString(),
                        processedAt: user.createdAt || new Date().toISOString(),
                        processedBy: 'System'
                    });
                    existingEmails.add(user.email);
                }
            });
        });

        res.json({ success: true, registrations: activeRegs });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/registration-stats', requireAuth('it'), (req, res) => {
    try {
        const pendingRegs = readJSON(pendingRegistrationsFile);
        const pending = pendingRegs.filter(r => r.status === 'pending').length;
        const approvedToday = pendingRegs.filter(r => r.status === 'approved' && r.processedAt && new Date(r.processedAt).toDateString() === new Date().toDateString()).length;
        const rejectedToday = pendingRegs.filter(r => r.status === 'rejected' && r.processedAt && new Date(r.processedAt).toDateString() === new Date().toDateString()).length;
        const deletedUsers = pendingRegs.filter(r => r.status === 'deleted').length;

        const allUsers = [
            ...readJSON(usersFile),
            ...readJSON(hrUsersFile),
            ...readJSON(aoUsersFile),
            ...readJSON(asdsUsersFile),
            ...readJSON(sdsUsersFile)
        ];

        res.json({
            success: true,
            stats: {
                pending,
                approvedToday,
                rejectedToday,
                totalUsers: allUsers.length,
                deletedUsers
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== APPROVAL / REJECTION / DELETION ==========
app.post('/api/approve-registration', requireAuth('it'), (req, res) => {
    try {
        const { id, processedBy } = req.body;
        // SECURITY: Use session email for audit trail instead of trusting client
        const actualProcessedBy = req.session.email || processedBy;

        let pendingRegs = readJSON(pendingRegistrationsFile);
        const regIndex = pendingRegs.findIndex(r => String(r.id) === String(id));

        if (regIndex === -1) {
            return res.status(404).json({ success: false, error: 'Registration not found' });
        }

        const registration = pendingRegs[regIndex];

        if (registration.status !== 'pending') {
            return res.status(400).json({ success: false, error: 'Registration already processed' });
        }

        let targetFile, newUser;

        switch (registration.portal) {
            case 'employee':
                targetFile = usersFile;
                newUser = {
                    id: registration.id,
                    email: registration.email,
                    password: registration.password,
                    name: registration.fullName || registration.name,
                    firstName: registration.firstName || '',
                    lastName: registration.lastName || '',
                    middleName: registration.middleName || '',
                    suffix: registration.suffix || '',
                    office: registration.office,
                    position: registration.position,
                    employeeNo: registration.employeeNo,
                    salaryGrade: registration.salaryGrade,
                    step: registration.step,
                    salary: registration.salary,
                    role: 'user',
                    createdAt: registration.createdAt
                };

                const employees = readJSON(employeesFile);
                const employeeRecord = buildEmployeeRecord(
                    registration.office,
                    registration.fullName,
                    registration.email,
                    registration.position,
                    registration.salaryGrade,
                    registration.step,
                    registration.salary,
                    registration.district
                );
                employees.push(employeeRecord);
                writeJSON(employeesFile, employees);
                
                // Create initial leave card (VL/SL start at 0, earned via monthly accrual)
                const leavecards = readJSON(leavecardsFile);
                const existingLeavecard = leavecards.find(lc => lc.email === registration.email);
                
                if (!existingLeavecard) {
                    // Check if there's a leave card with matching name (name-based auto-assignment)
                    const normalizedRegName = (registration.fullName || registration.name || '').toLowerCase().trim();
                    const matchingNameCard = leavecards.find(lc => {
                        const cardName = (lc.name || lc.fullName || '').toLowerCase().trim();
                        return cardName === normalizedRegName;
                    });
                    
                    if (matchingNameCard) {
                        // Update existing leave card with new user's email and name fields
                        matchingNameCard.email = registration.email;
                        matchingNameCard.employeeId = registration.email;
                        matchingNameCard.firstName = registration.firstName || matchingNameCard.firstName || '';
                        matchingNameCard.lastName = registration.lastName || matchingNameCard.lastName || '';
                        matchingNameCard.middleName = registration.middleName || matchingNameCard.middleName || '';
                        matchingNameCard.suffix = registration.suffix || matchingNameCard.suffix || '';
                        matchingNameCard.updatedAt = new Date().toISOString();
                        writeJSON(leavecardsFile, leavecards);
                        console.log(`[REGISTRATION] Assigned existing leave card to ${registration.email} (matched by name: ${normalizedRegName})`);
                    } else {
                        // Create new leave card — VL and SL start at 0
                        // Credits are earned through monthly accrual (1.25/month)
                        // Force Leave (5/year) and SPL (3/year) are fixed yearly allocations
                        const newLeavecard = {
                            employeeId: registration.email,
                            email: registration.email,
                            name: registration.fullName || registration.name,
                            firstName: registration.firstName || '',
                            lastName: registration.lastName || '',
                            middleName: registration.middleName || '',
                            suffix: registration.suffix || '',
                            vacationLeaveEarned: 0,
                            sickLeaveEarned: 0,
                            forceLeaveEarned: 5,
                            splEarned: 3,
                            vacationLeaveSpent: 0,
                            sickLeaveSpent: 0,
                            forceLeaveSpent: 0,
                            splSpent: 0,
                            vl: 0,
                            sl: 0,
                            spl: 3,
                            others: 0,
                            forceLeaveYear: new Date().getFullYear(),
                            splYear: new Date().getFullYear(),
                            leaveUsageHistory: [],
                            createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString(),
                            initialCreditsSource: 'accrual'
                        };
                        leavecards.push(newLeavecard);
                        writeJSON(leavecardsFile, leavecards);
                        console.log(`[REGISTRATION] Created leave card for ${registration.email}: VL=${newLeavecard.vl}, SL=${newLeavecard.sl}, Source=${newLeavecard.initialCreditsSource}`);
                        
                        // Immediately apply catch-up accrual for completed months this year
                        // so the employee doesn't start with VL=0/SL=0
                        try {
                            ensureFile(systemStateFile);
                            const sysState = readJSON(systemStateFile);
                            const globalLastAccrued = sysState.lastAccruedMonth || null;
                            if (globalLastAccrued) {
                                const globalParts = globalLastAccrued.split('-').map(Number);
                                const monthsToAccrue = globalParts[1]; // Jan=1, Feb=2, etc.
                                if (monthsToAccrue > 0) {
                                    const accrualPerMonth = 1.25;
                                    const totalAccrual = accrualPerMonth * monthsToAccrue;
                                    newLeavecard.vacationLeaveEarned = +totalAccrual.toFixed(3);
                                    newLeavecard.sickLeaveEarned = +totalAccrual.toFixed(3);
                                    newLeavecard.vl = newLeavecard.vacationLeaveEarned;
                                    newLeavecard.sl = newLeavecard.sickLeaveEarned;
                                    newLeavecard.lastAccrualDate = globalLastAccrued;
                                    
                                    // Add transaction entries for each month
                                    const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June',
                                        'July', 'August', 'September', 'October', 'November', 'December'];
                                    if (!newLeavecard.transactions) newLeavecard.transactions = [];
                                    let runningVL = 0, runningSL = 0;
                                    for (let m = 1; m <= monthsToAccrue; m++) {
                                        runningVL = +(runningVL + accrualPerMonth).toFixed(3);
                                        runningSL = +(runningSL + accrualPerMonth).toFixed(3);
                                        newLeavecard.transactions.push({
                                            type: 'ADD',
                                            periodCovered: `${monthNames[m]} ${globalParts[0]} (Monthly Accrual)`,
                                            vlEarned: accrualPerMonth,
                                            slEarned: accrualPerMonth,
                                            vlSpent: 0,
                                            slSpent: 0,
                                            forcedLeave: 0,
                                            splUsed: 0,
                                            vlBalance: runningVL,
                                            slBalance: runningSL,
                                            total: +(runningVL + runningSL).toFixed(3),
                                            source: 'system-accrual-catchup',
                                            date: new Date().toISOString()
                                        });
                                    }
                                    newLeavecard.updatedAt = new Date().toISOString();
                                    writeJSON(leavecardsFile, leavecards);
                                    console.log(`[REGISTRATION] Applied catch-up accrual for ${registration.email}: +${totalAccrual.toFixed(3)} VL/SL (${monthsToAccrue} month(s))`);
                                }
                            }
                        } catch (accrualErr) {
                            console.error(`[REGISTRATION] Catch-up accrual failed for ${registration.email}:`, accrualErr.message);
                        }
                    }
                }
                break;

            case 'ao':
                targetFile = aoUsersFile;
                newUser = {
                    id: registration.id,
                    email: registration.email,
                    password: registration.password,
                    fullName: registration.fullName,
                    name: registration.fullName,
                    firstName: registration.firstName || '',
                    lastName: registration.lastName || '',
                    middleName: registration.middleName || '',
                    suffix: registration.suffix || '',
                    office: registration.office,
                    position: registration.position,
                    salaryGrade: registration.salaryGrade,
                    step: registration.step,
                    role: 'ao',
                    createdAt: registration.createdAt
                };
                break;

            case 'hr':
                targetFile = hrUsersFile;
                newUser = {
                    id: registration.id,
                    email: registration.email,
                    password: registration.password,
                    name: registration.name || registration.fullName,
                    fullName: registration.fullName || registration.name,
                    firstName: registration.firstName || '',
                    lastName: registration.lastName || '',
                    middleName: registration.middleName || '',
                    suffix: registration.suffix || '',
                    office: registration.office,
                    position: registration.position,
                    salaryGrade: registration.salaryGrade,
                    step: registration.step,
                    salary: registration.salary,
                    role: 'hr',
                    createdAt: registration.createdAt
                };
                break;

            case 'asds':
                targetFile = asdsUsersFile;
                newUser = {
                    id: registration.id,
                    email: registration.email,
                    password: registration.password,
                    fullName: registration.fullName,
                    name: registration.fullName,
                    firstName: registration.firstName || '',
                    lastName: registration.lastName || '',
                    middleName: registration.middleName || '',
                    suffix: registration.suffix || '',
                    office: registration.office,
                    position: registration.position,
                    salaryGrade: registration.salaryGrade,
                    step: registration.step,
                    salary: registration.salary,
                    role: 'asds',
                    createdAt: registration.createdAt
                };
                break;

            case 'sds':
                targetFile = sdsUsersFile;
                newUser = {
                    id: registration.id,
                    email: registration.email,
                    password: registration.password,
                    firstName: registration.firstName || '',
                    lastName: registration.lastName || '',
                    middleName: registration.middleName || '',
                    suffix: registration.suffix || '',
                    fullName: registration.fullName,
                    name: registration.name || registration.fullName,
                    position: registration.position,
                    salaryGrade: registration.salaryGrade,
                    step: registration.step,
                    salary: registration.salary,
                    office: registration.office,
                    role: 'sds',
                    createdAt: registration.createdAt
                };
                break;
        }

        if (targetFile && newUser) {
            let targetUsers = readJSON(targetFile);
            targetUsers.push(newUser);
            writeJSON(targetFile, targetUsers);
        }

        registration.status = 'approved';
        registration.processedAt = new Date().toISOString();
        registration.processedBy = actualProcessedBy;

        pendingRegs[regIndex] = registration;
        writeJSON(pendingRegistrationsFile, pendingRegs);

        // Log registration approval
        logActivity('REGISTRATION_APPROVED', 'it', {
            userEmail: registration.email,
            fullName: registration.fullName || registration.name,
            portal: registration.portal,
            processedBy: actualProcessedBy,
            ip: getClientIp(req),
            userAgent: req.get('user-agent')
        });

        // Send approval email with login form
        const userEmail = registration.email;
        const userName = registration.fullName || registration.name || 'User';
        const portal = registration.portal;
        
        sendEmail(
            userEmail,
            userName,
            'Registration Approved - Access Your Leave Form Portal',
            generateLoginFormEmail(userEmail, userName, portal)
        ).then(() => {
            res.json({ 
                success: true, 
                message: 'Registration approved successfully and confirmation email sent',
                emailSent: true 
            });
        }).catch((emailError) => {
            console.error('Email sending failed, but registration was approved:', emailError);
            res.json({ 
                success: true, 
                message: 'Registration approved successfully. Note: Confirmation email could not be sent',
                emailSent: false,
                emailError: emailError.message
            });
        });
    } catch (error) {
        console.error('Approve registration error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/reject-registration', requireAuth('it'), (req, res) => {
    try {
        const { id, reason, processedBy } = req.body;
        // SECURITY: Use session email for audit trail instead of trusting client
        const actualProcessedBy = req.session.email || processedBy;

        let pendingRegs = readJSON(pendingRegistrationsFile);
        const regIndex = pendingRegs.findIndex(r => String(r.id) === String(id));

        if (regIndex === -1) {
            return res.status(404).json({ success: false, error: 'Registration not found' });
        }

        if (pendingRegs[regIndex].status !== 'pending') {
            return res.status(400).json({ success: false, error: 'Registration already processed' });
        }

        pendingRegs[regIndex].status = 'rejected';
        pendingRegs[regIndex].rejectionReason = reason || 'No reason provided';
        pendingRegs[regIndex].processedAt = new Date().toISOString();
        pendingRegs[regIndex].processedBy = actualProcessedBy;
        writeJSON(pendingRegistrationsFile, pendingRegs);

        // Log registration rejection
        logActivity('REGISTRATION_REJECTED', 'it', {
            userEmail: pendingRegs[regIndex].email,
            fullName: pendingRegs[regIndex].fullName || pendingRegs[regIndex].name,
            portal: pendingRegs[regIndex].portal,
            reason: reason || 'No reason provided',
            processedBy: actualProcessedBy,
            ip: getClientIp(req),
            userAgent: req.get('user-agent')
        });

        res.json({ success: true, message: 'Registration rejected' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Fetch items for a specific data category (for selective deletion)
app.get('/api/data-items/:category', requireAuth('it'), (req, res) => {
    try {
        const category = req.params.category;
        const categoryToFile = {
            'employeeUsers': usersFile,
            'aoUsers': aoUsersFile,
            'hrUsers': hrUsersFile,
            'asdsUsers': asdsUsersFile,
            'sdsUsers': sdsUsersFile,
            'applications': applicationsFile,
            'leavecards': leavecardsFile,
            'pendingRegistrations': pendingRegistrationsFile,
            'schools': schoolsFile
        };

        const filePath = categoryToFile[category];
        if (!filePath) {
            return res.status(400).json({ success: false, error: 'Invalid category' });
        }

        if (!fs.existsSync(filePath)) {
            return res.json({ success: true, items: [], category });
        }

        const data = readJSON(filePath);

        // For schools, it's an object with districts array, flatten for display
        if (category === 'schools' && data && data.districts) {
            const items = [];
            data.districts.forEach(d => {
                d.schools.forEach(s => {
                    items.push({ id: s.id, displayName: s.name, district: d.name });
                });
            });
            return res.json({ success: true, items, category, isSchoolFormat: true });
        }

        // For arrays, map each item to include a display name
        const items = Array.isArray(data) ? data.map(item => {
            let displayName = '';
            if (category === 'employeeUsers' || category === 'aoUsers' || category === 'hrUsers' || category === 'asdsUsers' || category === 'sdsUsers') {
                displayName = `${item.fullName || item.name || 'N/A'} (${item.email || 'N/A'})`;
            } else if (category === 'applications') {
                displayName = `${item.applicationId || item.id || 'N/A'} - ${item.employeeName || item.name || 'N/A'} (${item.leaveType || 'N/A'})`;
            } else if (category === 'leavecards') {
                displayName = `${item.email || item.employeeId || 'N/A'} - VL: ${item.vl ?? 'N/A'}, SL: ${item.sl ?? 'N/A'}`;
            } else if (category === 'pendingRegistrations') {
                displayName = `${item.fullName || item.name || 'N/A'} (${item.email || 'N/A'}) [${item.status || 'N/A'}]`;
            } else {
                displayName = item.name || item.email || item.id || JSON.stringify(item).substring(0, 50);
            }
            return { id: item.id, email: item.email, displayName };
        }) : [];

        res.json({ success: true, items, category });
    } catch (error) {
        console.error('[SYSTEM] Error fetching data items:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete specific items by IDs from a data category
app.post('/api/delete-specific-items', requireAuth('it'), (req, res) => {
    try {
        const { category, itemIds } = req.body;
        const ip = getClientIp(req);
        
        if (!category || !itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
            return res.status(400).json({ success: false, error: 'Category and itemIds are required' });
        }

        const categoryToFile = {
            'employeeUsers': usersFile,
            'aoUsers': aoUsersFile,
            'hrUsers': hrUsersFile,
            'asdsUsers': asdsUsersFile,
            'sdsUsers': sdsUsersFile,
            'applications': applicationsFile,
            'leavecards': leavecardsFile,
            'pendingRegistrations': pendingRegistrationsFile,
            'schools': schoolsFile
        };

        const filePath = categoryToFile[category];
        if (!filePath) {
            return res.status(400).json({ success: false, error: 'Invalid category' });
        }

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ success: false, error: 'Data file not found' });
        }

        const data = readJSON(filePath);
        let deletedCount = 0;

        // Special handling for schools (object with districts)
        if (category === 'schools' && data && data.districts) {
            const idsToDelete = new Set(itemIds.map(String));
            data.districts.forEach(d => {
                const before = d.schools.length;
                d.schools = d.schools.filter(s => !idsToDelete.has(String(s.id)));
                deletedCount += before - d.schools.length;
            });
            // Remove empty districts
            data.districts = data.districts.filter(d => d.schools.length > 0);
            writeJSON(filePath, data);
        } else if (Array.isArray(data)) {
            const idsToDelete = new Set(itemIds.map(String));
            const filtered = data.filter(item => {
                const itemId = String(item.id || '');
                const itemEmail = String(item.email || '');
                if (idsToDelete.has(itemId) || idsToDelete.has(itemEmail)) {
                    deletedCount++;
                    return false;
                }
                return true;
            });
            writeJSON(filePath, filtered);
        }

        // Log deletion activity
        logActivity('DATA_DELETION', 'it', {
            userEmail: 'system-admin',
            ip,
            userAgent: req.get('user-agent'),
            category,
            deletedCount,
            itemsDeleted: itemIds
        });

        console.log(`[SYSTEM] Deleted ${deletedCount} item(s) from ${category}`);
        res.json({ success: true, deletedCount, category });
    } catch (error) {
        console.error('[SYSTEM] Error deleting specific items:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/delete-selected-data', requireAuth('it'), (req, res) => {
    try {
        console.log('[SYSTEM] Delete selected data request received');

        const deleteOptions = req.body;
        
        // Map of options to file paths
        const fileMapping = {
            deleteEmployeeUsers: usersFile,
            deleteAOUsers: aoUsersFile,
            deleteHRUsers: hrUsersFile,
            deleteASDSUsers: asdsUsersFile,
            deleteSDSUsers: sdsUsersFile,
            deleteApplications: applicationsFile,
            deleteLeavecards: leavecardsFile,
            deletePendingRegistrations: pendingRegistrationsFile,
            deleteSchools: schoolsFile
        };

        let filesDeleted = 0;

        // Clear selected files
        Object.keys(deleteOptions).forEach(key => {
            if (deleteOptions[key] === true && fileMapping[key]) {
                const filePath = fileMapping[key];
                if (fs.existsSync(filePath)) {
                    writeJSON(filePath, []);
                    filesDeleted++;
                    console.log(`[SYSTEM] Cleared: ${filePath}`);
                }
            }
        });

        console.log(`[SYSTEM] Deleted ${filesDeleted} data file(s)`);

        // Log bulk deletion activity
        const deletedCategories = Object.keys(deleteOptions).filter(k => deleteOptions[k] === true && fileMapping[k]);
        logActivity('DATA_DELETION', 'it', {
            userEmail: 'system-admin',
            action: 'delete-selected-data',
            deletedCategories: deletedCategories,
            filesDeleted: filesDeleted,
            ip: getClientIp(req),
            userAgent: req.get('user-agent')
        });

        res.json({ 
            success: true, 
            message: `Deleted ${filesDeleted} data type(s)`,
            filesDeleted: filesDeleted
        });
    } catch (error) {
        console.error('[SYSTEM] Error deleting selected data:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// DANGEROUS: Delete all data - requires confirmation key
app.post('/api/delete-all-data', requireAuth('it'), loginRateLimiter, (req, res) => {
    try {
        // Require confirmation key to prevent accidental deletion
        const { confirmationKey } = req.body || {};
        if (confirmationKey !== 'DELETE_ALL_DATA_CONFIRM') {
            return res.status(403).json({ 
                success: false, 
                error: 'Confirmation key required. This action cannot be undone.' 
            });
        }
        
        console.log('[SYSTEM] Delete all data request received');

        // List of all data files to clear
        const dataFilesToClear = [
            usersFile,                  // Employee users
            aoUsersFile,                // AO users
            hrUsersFile,                // HR users
            asdsUsersFile,              // ASDS users
            sdsUsersFile,               // SDS users
            applicationsFile,           // Leave applications
            leavecardsFile,             // Leave cards
            pendingRegistrationsFile,   // Pending registrations
            schoolsFile                 // Schools data
        ];

        // Clear each file by writing empty array
        dataFilesToClear.forEach(filePath => {
            if (fs.existsSync(filePath)) {
                writeJSON(filePath, []);
                console.log(`[SYSTEM] Cleared: ${filePath}`);
            }
        });

        console.log('[SYSTEM] All system data has been deleted');

        // Log delete-all activity
        logActivity('DATA_DELETION', 'it', {
            userEmail: 'system-admin',
            action: 'delete-all-data',
            filesCleared: dataFilesToClear.length,
            ip: getClientIp(req),
            userAgent: req.get('user-agent')
        });

        res.json({ 
            success: true, 
            message: 'All system data has been successfully deleted',
            filesCleared: dataFilesToClear.length
        });
    } catch (error) {
        console.error('[SYSTEM] Error deleting all data:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/delete-user', requireAuth('it'), (req, res) => {
    try {
        const { id, email, portal } = req.body;
        // SECURITY: Use session email for audit trail
        const deletedBy = req.session.email || 'IT Admin';

        if (!email || !portal) {
            return res.status(400).json({ success: false, error: 'Email and portal are required' });
        }

        const portalToFile = {
            'employee': usersFile,
            'ao': aoUsersFile,
            'hr': hrUsersFile,
            'asds': asdsUsersFile,
            'sds': sdsUsersFile
        };

        const userFile = portalToFile[portal.toLowerCase()];
        if (!userFile) {
            return res.status(400).json({ success: false, error: 'Invalid portal type' });
        }

        let userDeleted = false;

        if (fs.existsSync(userFile)) {
            let users = readJSON(userFile);
            const userIndex = users.findIndex(u => u.email === email);
            if (userIndex !== -1) {
                users.splice(userIndex, 1);
                writeJSON(userFile, users);
                userDeleted = true;
                console.log(`User ${email} deleted from ${userFile} by ${deletedBy}`);
            }
        }

        // Permanently delete from pending registrations
        let regDeleted = false;
        let pendingRegs = readJSON(pendingRegistrationsFile);
        // Try to find by email+portal first, then fallback to id
        let regIndex = pendingRegs.findIndex(r => r.email === email && r.portal === portal);
        if (regIndex === -1 && id) {
            regIndex = pendingRegs.findIndex(r => String(r.id) === String(id));
        }
        if (regIndex !== -1) {
            pendingRegs.splice(regIndex, 1);
            writeJSON(pendingRegistrationsFile, pendingRegs);
            regDeleted = true;
            console.log(`Registration record for ${email} permanently deleted from pending-registrations by ${deletedBy}`);
        }

        if (userDeleted || regDeleted) {
            // Log user deletion
            logActivity('DATA_DELETION', 'it', {
                userEmail: email,
                action: 'delete-user',
                portal: portal,
                deletedBy: deletedBy,
                userAccountDeleted: userDeleted,
                registrationDeleted: regDeleted,
                ip: getClientIp(req),
                userAgent: req.get('user-agent')
            });
            res.json({ success: true, message: 'User deleted successfully' });
        } else {
            res.status(404).json({ success: false, error: 'User not found in database' });
        }
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Bulk delete multiple users
app.post('/api/delete-multiple-users', requireAuth('it'), async (req, res) => {
    try {
        const { users, registrations } = req.body;
        // SECURITY: Use session email for audit trail
        const deletedBy = req.session.email || 'IT Admin';
        const deleteList = users || registrations;

        if (!deleteList || !Array.isArray(deleteList) || deleteList.length === 0) {
            return res.status(400).json({ success: false, error: 'No users specified for deletion' });
        }

        const portalToFile = {
            'employee': usersFile,
            'ao': aoUsersFile,
            'hr': hrUsersFile,
            'asds': asdsUsersFile,
            'sds': sdsUsersFile,
            'it': itUsersFile
        };

        let deletedCount = 0;
        const errors = [];

        for (const user of deleteList) {
            try {
                const { email, portal } = user;
                if (!email || !portal) {
                    errors.push(`Missing email or portal for user: ${JSON.stringify(user)}`);
                    continue;
                }

                const userFile = portalToFile[portal];
                if (!userFile) {
                    errors.push(`Invalid portal '${portal}' for user ${email}`);
                    continue;
                }

                // Remove from user file
                let userData = readJSON(userFile);
                const originalLength = userData.length;
                userData = userData.filter(u => u.email !== email);

                if (userData.length < originalLength) {
                    writeJSON(userFile, userData);
                    deletedCount++;

                    // Also remove from pending registrations
                    let pendingRegs = readJSON(pendingRegistrationsFile);
                    const regIndex = pendingRegs.findIndex(r => r.email === email);
                    if (regIndex !== -1) {
                        pendingRegs[regIndex].status = 'deleted';
                        pendingRegs[regIndex].deletedAt = new Date().toISOString();
                        pendingRegs[regIndex].deletedBy = deletedBy || 'IT Admin';
                        writeJSON(pendingRegistrationsFile, pendingRegs);
                    }

                    // Remove leave card
                    let leavecards = readJSON(leavecardsFile);
                    leavecards = leavecards.filter(lc => lc.email !== email);
                    writeJSON(leavecardsFile, leavecards);

                    // Remove from employees
                    let employees = readJSON(employeesFile);
                    employees = employees.filter(emp => emp.email !== email);
                    writeJSON(employeesFile, employees);

                    console.log(`[BULK DELETE] Deleted user: ${email} (${portal})`);
                } else {
                    errors.push(`User ${email} not found in ${portal} database`);
                }
            } catch (userError) {
                errors.push(`Error deleting ${user.email}: ${userError.message}`);
            }
        }

        // Log bulk delete activity
        logActivity('BULK_USER_DELETE', 'it', {
            userEmail: deletedBy || 'IT Admin',
            action: 'bulk-delete-users',
            requestedCount: deleteList.length,
            deletedCount,
            errors: errors.length > 0 ? errors : undefined,
            ip: getClientIp(req),
            userAgent: req.get('user-agent')
        });

        res.json({
            success: true,
            message: `Successfully deleted ${deletedCount} of ${deleteList.length} users`,
            deletedCount,
            errors: errors.length > 0 ? errors : undefined
        });
    } catch (error) {
        console.error('Error in bulk delete:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== LEAVE APPLICATION ENDPOINTS ==========

// Helper function to determine if user is school-based
function isSchoolBased(office) {
    if (!office) return false;
    const officeLower = office.toLowerCase();
    // School-based if contains "school" but NOT "schools division"
    return officeLower.includes('school') && !officeLower.includes('schools division');
}

// Helper function to generate sequential Application ID (SDO Sipalay-01, SDO Sipalay-02, etc.)
// Includes timestamp suffix to prevent race condition conflicts
function generateApplicationId(applications) {
    const prefix = 'SDO Sipalay-';
    
    // Find the highest existing number
    let maxNumber = 0;
    applications.forEach(app => {
        if (typeof app.id === 'string' && app.id.startsWith(prefix)) {
            // Extract the numeric part (before any hyphen suffix)
            const afterPrefix = app.id.replace(prefix, '');
            const numPart = parseInt(afterPrefix.split('-')[0]);
            if (!isNaN(numPart) && numPart > maxNumber) {
                maxNumber = numPart;
            }
        }
    });
    
    // Generate next number with leading zeros (minimum 2 digits)
    const nextNumber = maxNumber + 1;
    const paddedNumber = nextNumber.toString().padStart(2, '0');
    
    // Add short timestamp suffix to guarantee uniqueness in case of simultaneous requests
    const uniqueSuffix = Date.now().toString(36).slice(-4).toUpperCase();
    
    return prefix + paddedNumber + '-' + uniqueSuffix;
}

// Submit leave application
app.post('/api/submit-leave', requireAuth(), (req, res) => {
    try {
        const applicationData = req.body;
        const applications = readJSONArray(applicationsFile);
        const ip = getClientIp(req);
        
        // SECURITY: Use session email instead of trusting client-provided employeeEmail
        const employeeEmail = req.session.email;
        if (!employeeEmail) {
            return res.status(401).json({ success: false, error: 'Session expired. Please log in again.' });
        }
        // Override client-provided email with session email
        applicationData.employeeEmail = employeeEmail;
        
        // ===== VALIDATION: Check Force/SPL leave balance =====
        const leaveType = applicationData.leaveType;
        const numDays = parseFloat(applicationData.numDays) || 0;
        
        if (numDays <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid number of days',
                message: 'Number of leave days must be greater than zero.'
            });
        }
        
        // ===== COMPREHENSIVE LEAVE BALANCE VALIDATION =====
        // Read leave card to check balance for ALL leave types
        const leavecards = readJSON(leavecardsFile);
        const employeeLeave = leavecards.find(lc => lc.email === employeeEmail || lc.employeeId === employeeEmail);
        
        if (leaveType === 'leave_vl' || leaveType === 'leave_sl') {
            // Calculate current VL/SL balance from leave card
            if (employeeLeave) {
                const vacationLeaveEarned = employeeLeave.vacationLeaveEarned || employeeLeave.vl || 0;
                const sickLeaveEarned = employeeLeave.sickLeaveEarned || employeeLeave.sl || 0;
                
                // Get balance from leaveUsageHistory if available (most accurate)
                let vlBalance = null;
                let slBalance = null;
                
                if (employeeLeave.leaveUsageHistory && Array.isArray(employeeLeave.leaveUsageHistory) && employeeLeave.leaveUsageHistory.length > 0) {
                    const latestUsage = employeeLeave.leaveUsageHistory[employeeLeave.leaveUsageHistory.length - 1];
                    if (latestUsage.balanceAfterVL !== undefined) vlBalance = latestUsage.balanceAfterVL;
                    if (latestUsage.balanceAfterSL !== undefined) slBalance = latestUsage.balanceAfterSL;
                }
                
                // Fall back to earned - spent calculation
                if (vlBalance === null) {
                    vlBalance = Math.max(0, vacationLeaveEarned - (employeeLeave.vacationLeaveSpent || 0));
                }
                if (slBalance === null) {
                    slBalance = Math.max(0, sickLeaveEarned - (employeeLeave.sickLeaveSpent || 0));
                }
                
                // Also deduct pending/approved applications not yet reflected in leave card
                const allApplications = readJSONArray(applicationsFile);
                const reflectedAppIds = new Set();
                if (employeeLeave.leaveUsageHistory && Array.isArray(employeeLeave.leaveUsageHistory)) {
                    employeeLeave.leaveUsageHistory.forEach(h => { if (h.applicationId) reflectedAppIds.add(h.applicationId); });
                }
                if (employeeLeave.transactions && Array.isArray(employeeLeave.transactions)) {
                    employeeLeave.transactions.forEach(t => { if (t.applicationId) reflectedAppIds.add(t.applicationId); });
                }
                
                allApplications.forEach(app => {
                    if (reflectedAppIds.has(app.id)) return;
                    if ((app.employeeEmail !== employeeEmail && app.email !== employeeEmail)) return;
                    if (app.status !== 'pending' && app.status !== 'approved') return;
                    const appDays = parseFloat(app.numDays) || 0;
                    if (appDays <= 0) return;
                    const appType = (app.leaveType || '').toLowerCase();
                    if (appType.includes('vl') || appType.includes('vacation')) {
                        vlBalance = Math.max(0, vlBalance - appDays);
                    } else if (appType.includes('sl') || appType.includes('sick')) {
                        slBalance = Math.max(0, slBalance - appDays);
                    }
                });
                
                // Check VL balance
                if (leaveType === 'leave_vl' && numDays > vlBalance) {
                    console.log(`[VALIDATION] VL rejected for ${employeeEmail}: Requested ${numDays} days but only ${vlBalance.toFixed(3)} available`);
                    return res.status(400).json({
                        success: false,
                        error: 'Insufficient Vacation Leave balance',
                        message: `You cannot apply for ${numDays} day(s) of Vacation Leave. Your current balance is ${vlBalance.toFixed(3)} day(s). The leave card balance cannot go negative.`
                    });
                }
                
                // Check SL balance — per CSC Rule XVI Sec. 15, exhausted SL may be charged against VL
                if (leaveType === 'leave_sl' && numDays > slBalance) {
                    if (numDays <= (slBalance + vlBalance)) {
                        // SL exhausted but VL can cover the remainder — allow with note
                        console.log(`[VALIDATION] SL for ${employeeEmail}: ${numDays} days requested, SL balance ${slBalance.toFixed(3)}, remainder charged to VL`);
                    } else {
                        console.log(`[VALIDATION] SL rejected for ${employeeEmail}: Requested ${numDays} days but only ${slBalance.toFixed(3)} SL + ${vlBalance.toFixed(3)} VL available`);
                        return res.status(400).json({
                            success: false,
                            error: 'Insufficient Sick Leave balance',
                            message: `You cannot apply for ${numDays} day(s) of Sick Leave. Your SL balance is ${slBalance.toFixed(3)} and VL balance is ${vlBalance.toFixed(3)} day(s). Per CSC rules, SL may be charged against VL when exhausted, but your combined balance is insufficient.`
                        });
                    }
                }
            } else {
                // No leave card found — reject VL/SL applications (no balance means 0)
                console.log(`[VALIDATION] ${leaveType} rejected for ${employeeEmail}: No leave card found (balance is 0)`);
                return res.status(400).json({
                    success: false,
                    error: 'No leave card found',
                    message: 'You do not have a leave card on file. Please contact the Administrative Officer to create your leave card before applying for leave.'
                });
            }
        }
        
        if (leaveType === 'leave_mfl' || leaveType === 'leave_spl') {
            if (employeeLeave) {
                const forceLeaveSpent = employeeLeave.forceLeaveSpent || 0;
                const splSpent = employeeLeave.splSpent || 0;
                
                // Also count pending FL/SPL applications not yet reflected in leave card
                const allApplications = readJSONArray(applicationsFile);
                // Build set of application IDs already reflected in leave card to avoid double-counting
                const reflectedAppIds = new Set();
                if (employeeLeave.leaveUsageHistory && Array.isArray(employeeLeave.leaveUsageHistory)) {
                    employeeLeave.leaveUsageHistory.forEach(h => { if (h.applicationId) reflectedAppIds.add(h.applicationId); });
                }
                if (employeeLeave.transactions && Array.isArray(employeeLeave.transactions)) {
                    employeeLeave.transactions.forEach(t => { if (t.applicationId) reflectedAppIds.add(t.applicationId); });
                }
                let pendingForceSpent = 0;
                let pendingSplSpent = 0;
                allApplications.forEach(app => {
                    if (reflectedAppIds.has(app.id)) return; // Already counted in forceLeaveSpent/splSpent
                    if ((app.employeeEmail !== employeeEmail && app.email !== employeeEmail)) return;
                    if (app.status !== 'pending' && app.status !== 'approved') return;
                    const appDays = parseFloat(app.numDays) || 0;
                    const appType = (app.leaveType || '').toLowerCase();
                    if (appType.includes('mfl') || appType.includes('mandatory') || appType.includes('forced')) {
                        pendingForceSpent += appDays;
                    } else if (appType.includes('spl') || appType.includes('special')) {
                        pendingSplSpent += appDays;
                    }
                });
                
                const totalForceUsed = forceLeaveSpent + pendingForceSpent;
                const totalSplUsed = splSpent + pendingSplSpent;
                
                if (leaveType === 'leave_mfl') {
                    // ===== CSC MC No. 6 s.1996: Force Leave / Mandatory Leave Rules =====
                    // 1. FL is mandatory only for employees with 10+ accumulated VL days
                    // 2. FL is charged AGAINST VL balance (it IS vacation leave, just the mandatory portion)
                    // 3. FL yearly cap is 5 days
                    // 4. FL should ideally be taken as consecutive days (no restriction on consecutive days)
                    
                    // Compute effective VL balance for FL check
                    let flVlBalance = null;
                    if (employeeLeave.leaveUsageHistory && Array.isArray(employeeLeave.leaveUsageHistory) && employeeLeave.leaveUsageHistory.length > 0) {
                        const latestUsage = employeeLeave.leaveUsageHistory[employeeLeave.leaveUsageHistory.length - 1];
                        if (latestUsage.balanceAfterVL !== undefined) flVlBalance = latestUsage.balanceAfterVL;
                    }
                    if (flVlBalance === null) {
                        const vlEarned = parseFloat(employeeLeave.vacationLeaveEarned) || parseFloat(employeeLeave.vl) || 0;
                        flVlBalance = Math.max(0, vlEarned - (employeeLeave.vacationLeaveSpent || 0));
                    }
                    // Deduct pending VL and FL applications not yet reflected
                    allApplications.forEach(app => {
                        if ((app.employeeEmail !== employeeEmail && app.email !== employeeEmail)) return;
                        if (app.status !== 'pending' && app.status !== 'approved') return;
                        const appDays = parseFloat(app.numDays) || 0;
                        if (appDays <= 0) return;
                        const appType = (app.leaveType || '').toLowerCase();
                        // Both VL and FL deduct from VL balance
                        if (appType.includes('vl') || appType.includes('vacation') || appType.includes('mfl') || appType.includes('mandatory') || appType.includes('forced')) {
                            // Skip FL apps already counted in pendingForceSpent to avoid double-counting
                            if (!(appType.includes('mfl') || appType.includes('mandatory') || appType.includes('forced'))) {
                                flVlBalance = Math.max(0, flVlBalance - appDays);
                            }
                        }
                    });
                    // Deduct pending FL from VL balance
                    flVlBalance = Math.max(0, flVlBalance - pendingForceSpent);
                    
                    // Check 10-day VL threshold (CSC MC No. 6, s. 1996)
                    if (flVlBalance < 10) {
                        console.log(`[VALIDATION] Force Leave rejected for ${employeeEmail}: VL balance ${flVlBalance.toFixed(3)} is below 10-day threshold`);
                        return res.status(400).json({
                            success: false,
                            error: 'Force Leave not applicable',
                            message: `Mandatory/Forced Leave is only required for employees with 10 or more accumulated Vacation Leave days (CSC MC No. 6, s. 1996). Your current VL balance is ${flVlBalance.toFixed(3)} day(s).`
                        });
                    }
                    
                    // Check FL yearly cap (5 days)
                    if ((totalForceUsed + numDays) > 5) {
                        const remaining = Math.max(0, 5 - totalForceUsed);
                        console.log(`[VALIDATION] Force Leave rejected for ${employeeEmail}: Already used ${totalForceUsed}/5 days, requested ${numDays}`);
                        return res.status(400).json({ 
                            success: false, 
                            error: 'Insufficient Force Leave balance',
                            message: `You cannot apply for ${numDays} day(s) of Force Leave. You have ${remaining.toFixed(0)} day(s) remaining out of your 5-day yearly allocation.`
                        });
                    }
                    
                    // Check VL balance can cover this FL application (FL deducts from VL)
                    if (numDays > flVlBalance) {
                        console.log(`[VALIDATION] Force Leave rejected for ${employeeEmail}: Requested ${numDays} FL days but only ${flVlBalance.toFixed(3)} VL available`);
                        return res.status(400).json({
                            success: false,
                            error: 'Insufficient VL balance for Force Leave',
                            message: `Force Leave is charged against your Vacation Leave balance. You cannot apply for ${numDays} day(s) of FL. Your current VL balance is ${flVlBalance.toFixed(3)} day(s).`
                        });
                    }
                }
                
                // Check if SPL is exhausted (including pending)
                if (leaveType === 'leave_spl' && (totalSplUsed + numDays) > 3) {
                    const remaining = Math.max(0, 3 - totalSplUsed);
                    console.log(`[VALIDATION] SPL rejected for ${employeeEmail}: Already used ${totalSplUsed}/3 days, requested ${numDays}`);
                    return res.status(400).json({ 
                        success: false, 
                        error: 'Insufficient Special Privilege Leave balance',
                        message: `You cannot apply for ${numDays} day(s) of Special Privilege Leave. You have ${remaining.toFixed(0)} day(s) remaining out of your 3-day yearly allocation.`
                    });
                }
            }
        }
        
        // Determine initial status and current approver based on office
        const office = applicationData.office || '';
        const schoolBased = isSchoolBased(office);
        
        // Generate sequential Application ID (SDO Sipalay-01, SDO Sipalay-02, etc.)
        const applicationId = generateApplicationId(applications);
        
        // ALL applications go to AO first, regardless of whether they're school-based or not
        // Unified workflow: AO â†’ HR â†’ ASDS â†’ SDS
        const newApplication = {
            id: applicationId,
            // SECURITY: Whitelist only expected fields (prevent mass assignment attack)
            employeeEmail: applicationData.employeeEmail || '',
            employeeName: applicationData.employeeName || '',
            office: applicationData.office || '',
            position: applicationData.position || '',
            salary: applicationData.salary || '',
            dateOfFiling: applicationData.dateOfFiling || '',
            leaveType: applicationData.leaveType || '',
            dateFrom: applicationData.dateFrom || '',
            dateTo: applicationData.dateTo || '',
            numDays: applicationData.numDays || '',
            vlEarned: applicationData.vlEarned || '',
            slEarned: applicationData.slEarned || '',
            vlLess: applicationData.vlLess || '',
            slLess: applicationData.slLess || '',
            vlBalance: applicationData.vlBalance || '',
            slBalance: applicationData.slBalance || '',
            commutation: applicationData.commutation || '',
            employeeSignature: applicationData.employeeSignature || '',
            locationPH: applicationData.locationPH || false,
            locationAbroad: applicationData.locationAbroad || false,
            abroadSpecify: applicationData.abroadSpecify || '',
            sickHospital: applicationData.sickHospital || false,
            sickOutpatient: applicationData.sickOutpatient || false,
            hospitalIllness: applicationData.hospitalIllness || '',
            outpatientIllness: applicationData.outpatientIllness || '',
            studyMasters: applicationData.studyMasters || false,
            studyBar: applicationData.studyBar || false,
            womenIllness: applicationData.womenIllness || '',
            otherLeaveSpecify: applicationData.otherLeaveSpecify || '',
            soFileData: applicationData.soFileData || null,
            soFileName: applicationData.soFileName || '',
            isSchoolBased: schoolBased,
            status: 'pending',
            currentApprover: 'AO',
            approvalHistory: [],
            submittedAt: new Date().toISOString()
        };
        
        applications.push(newApplication);
        writeJSON(applicationsFile, applications);
        
        // Log activity
        logActivity('LEAVE_APPLICATION_SUBMITTED', 'employee', {
            userEmail: applicationData.employeeEmail,
            ip,
            userAgent: req.get('user-agent'),
            applicationId: newApplication.id,
            leaveType,
            numDays,
            officeType: schoolBased ? 'School-based' : 'Division Office'
        });
        
        const officeType = schoolBased ? 'School-based' : 'Division Office';
        console.log(`[LEAVE] New application submitted by ${applicationData.employeeName} - ${officeType} (AO first)`);
        
        res.json({ 
            success: true, 
            message: 'Application submitted successfully',
            applicationId: newApplication.id,
            currentApprover: newApplication.currentApprover,
            isSchoolBased: schoolBased
        });
    } catch (error) {
        console.error('Error submitting leave application:', error);
        res.status(500).json({ success: false, error: 'An error occurred while submitting your leave application. Please try again.' });
    }
});

// Get application status for tracker
app.get('/api/application-status/:id', requireAuth(), (req, res) => {
    try {
        const idParam = req.params.id;
        let appId = parseInt(idParam);
        if (isNaN(appId)) {
            appId = idParam; // Try as string if not a valid number
        }
        
        const applications = readJSONArray(applicationsFile);
        const app = applications.find(a => a.id === appId || a.id === parseInt(appId) || String(a.id) === idParam);
        
        if (!app) {
            console.error('Application not found:', { idParam, appId, totalApps: applications.length });
            return res.status(404).json({ success: false, error: 'Application not found' });
        }
        
        // SECURITY: Only allow access to own application unless admin role
        const adminRoles = ['ao', 'hr', 'asds', 'sds', 'it'];
        if (!adminRoles.includes(req.session.role) && req.session.email !== app.employeeEmail) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }
        
        res.json({ success: true, application: app });
    } catch (error) {
        console.error('Error in application-status:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get applications by email (for employee to track their own)
app.get('/api/my-applications/:email', requireAuth(), (req, res) => {
    try {
        const email = req.params.email;
        // SECURITY: Only allow access to own applications unless admin role
        const adminRoles = ['ao', 'hr', 'asds', 'sds', 'it'];
        if (!adminRoles.includes(req.session.role) && req.session.email !== email) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }
        const applications = readJSONArray(applicationsFile);
        const myApps = applications.filter(a => a.employeeEmail === email);
        
        res.json({ success: true, applications: myApps });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get application details by ID
app.get('/api/application-details/:id', requireAuth(), (req, res) => {
    try {
        const idParam = req.params.id;
        const applications = readJSONArray(applicationsFile);
        const application = applications.find(a => a.id === idParam || a.id === parseInt(idParam) || String(a.id) === idParam);
        
        if (!application) {
            return res.status(404).json({ success: false, error: 'Application not found' });
        }
        
        // SECURITY: Only allow access to own application unless admin role
        const adminRoles = ['ao', 'hr', 'asds', 'sds', 'it'];
        if (!adminRoles.includes(req.session.role) && req.session.email !== application.employeeEmail) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }
        
        res.json({ success: true, application: application });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get applications pending for a specific portal (includes returned applications)
app.get('/api/pending-applications/:portal', requireAuth('ao', 'hr', 'asds', 'sds', 'it'), (req, res) => {
    try {
        const portal = req.params.portal.toUpperCase();
        const applications = readJSONArray(applicationsFile);
        
        let pendingApps = applications.filter(a => 
            (a.status === 'pending' || a.status === 'returned') && a.currentApprover === portal
        );
        
        res.json({ success: true, applications: pendingApps });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get approved applications for a specific portal (SDS or ASDS)
app.get('/api/approved-applications/:portal', requireAuth('ao', 'hr', 'asds', 'sds', 'it'), (req, res) => {
    try {
        const portal = req.params.portal.toUpperCase();
        const applications = readJSONArray(applicationsFile);
        
        // Get applications approved by this portal
        let approvedApps = applications.filter(a => {
            if (portal === 'SDS') {
                return a.status === 'approved' && a.sdsApprovedAt;
            } else if (portal === 'ASDS') {
                return a.status === 'approved' && a.asdsApprovedAt;
            }
            return false;
        });
        
        res.json({ success: true, applications: approvedApps });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get HR-approved applications (applications that HR has processed and forwarded to next level)
app.get('/api/hr-approved-applications', requireAuth('asds', 'sds', 'it'), (req, res) => {
    try {
        const applications = readJSONArray(applicationsFile);
        
        // Get applications where HR has approved them (hrApprovedAt exists and currentApprover is not HR)
        let hrApprovedApps = applications.filter(a => {
            return a.hrApprovedAt && a.currentApprover !== 'HR';
        });
        
        res.json({ success: true, applications: hrApprovedApps });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get all users for demographics
app.get('/api/all-users', requireAuth('ao', 'hr', 'it'), (req, res) => {
    try {
        const users = readJSON(usersFile);
        // SECURITY: Strip password hashes before sending to client
        const safeUsers = users.map(({ password, ...rest }) => rest);
        res.json({ success: true, users: safeUsers });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get all applications for demographics
app.get('/api/all-applications', requireAuth('ao', 'hr', 'asds', 'sds', 'it'), (req, res) => {
    try {
        const applications = readJSONArray(applicationsFile);
        res.json({ success: true, applications: applications });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get all registered employees (for AO to manage their cards)
// Merges registered user accounts with leave card holders so that
// employees from Excel migration also appear even if they haven't
// registered an account yet.
app.get('/api/all-employees', requireAuth('ao', 'hr', 'it'), (req, res) => {
    try {
        const users = readJSON(usersFile);
        const leavecards = readJSON(leavecardsFile);

        // Start with registered users
        const employeeMap = new Map();
        users.forEach(user => {
            const email = (user.email || '').toLowerCase();
            employeeMap.set(email, {
                id: user.id,
                email: user.email,
                name: user.name || user.fullName || `${user.firstName || ''} ${user.lastName || ''}`.trim(),
                fullName: user.fullName || user.name,
                position: user.position || 'N/A',
                office: user.office || user.school || 'N/A',
                employeeNo: user.employeeNo || 'N/A',
                source: 'registered'
            });
        });

        // Add leave card holders that aren't already in the map
        leavecards.forEach(lc => {
            const email = (lc.email || '').toLowerCase();
            const key = email || `leavecard-${lc.name}`;
            if (!employeeMap.has(key)) {
                employeeMap.set(key, {
                    id: lc.employeeId || lc.email || lc.name,
                    email: lc.email || '',
                    name: lc.name || `${lc.firstName || ''} ${lc.lastName || ''}`.trim() || 'Unknown',
                    fullName: lc.name || `${lc.firstName || ''} ${lc.lastName || ''}`.trim(),
                    position: 'N/A',
                    office: 'N/A',
                    employeeNo: lc.employeeNo || 'N/A',
                    source: lc.email ? 'leavecard' : 'leavecard-unlinked'
                });
            }
        });

        const employees = Array.from(employeeMap.values());
        res.json({ success: true, employees: employees });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get all applications for a portal (pending, approved, and rejected by this portal)
app.get('/api/portal-applications/:portal', requireAuth('ao', 'hr', 'asds', 'sds', 'it'), (req, res) => {
    try {
        const portal = req.params.portal.toUpperCase();
        const applications = readJSONArray(applicationsFile);
        
        let portalApps = applications.filter(a => {
            const approvalKey = portal.toLowerCase() + 'ApprovedAt';
            const isCurrentApprover = a.currentApprover === portal;
            const hasApprovedByPortal = a[approvalKey] !== undefined;
            const isRejectedByPortal = (a.status === 'disapproved' || a.status === 'rejected') && 
                                     (a.disapprovedBy === portal || a.rejectedBy === portal);
            
            return isCurrentApprover || hasApprovedByPortal || isRejectedByPortal;
        });
        
        res.json({ success: true, applications: portalApps });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get leave credits for an employee
app.get('/api/leave-credits', requireAuth(), (req, res) => {
    try {
        const employeeId = req.query.employeeId;
        if (!employeeId) {
            return res.status(400).json({ success: false, error: 'Employee ID is required' });
        }
        
        // SECURITY: Only allow access to own leave credits unless admin role
        const adminRoles = ['ao', 'hr', 'asds', 'sds', 'it'];
        if (!adminRoles.includes(req.session.role) && req.session.email !== employeeId) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }
        
        const leavecards = readJSON(leavecardsFile);
        // Find all records for this employee — by email, employeeId, name, or employee number
        let employeeRecords = leavecards.filter(lc => lc.employeeId === employeeId || lc.email === employeeId);
        
        // Fallback: if not found by email, try matching by name (for unlinked Excel-migrated cards)
        if (employeeRecords.length === 0) {
            const normalizedId = employeeId.toUpperCase().replace(/\s+/g, ' ').trim();
            employeeRecords = leavecards.filter(lc => {
                const lcName = (lc.name || '').toUpperCase().replace(/\s+/g, ' ').trim();
                return lcName === normalizedId;
            });
        }
        
        // Fallback: try matching by employee number
        if (employeeRecords.length === 0) {
            employeeRecords = leavecards.filter(lc => lc.employeeNo && lc.employeeNo === employeeId);
        }
        
        if (employeeRecords.length === 0) {
            // Return default leave credits (0 until monthly accrual adds credits)
            return res.json({ 
                success: true, 
                credits: {
                    employeeId: employeeId,
                    email: employeeId,
                    vl: 0,
                    sl: 0,
                    spl: 3,
                    forceLeaveSpent: 0,
                    splSpent: 0,
                    others: 0,
                    vacationLeaveEarned: 0,
                    sickLeaveEarned: 0,
                    vacationLeaveSpent: 0,
                    sickLeaveSpent: 0,
                    leaveUsageHistory: []
                }
            });
        }
        
        // Get the latest record (most recent based on updatedAt or createdAt)
        let latestRecord = employeeRecords[0];
        employeeRecords.forEach(record => {
            const latestTime = new Date(latestRecord.updatedAt || latestRecord.createdAt || 0).getTime();
            const currentTime = new Date(record.updatedAt || record.createdAt || 0).getTime();
            if (currentTime > latestTime) {
                latestRecord = record;
            }
        });
        
        const currentYear = new Date().getFullYear();
        
        // Check if Force Leave or SPL year needs reset
        let forceLeaveSpent = latestRecord.forceLeaveSpent || 0;
        let splSpent = latestRecord.splSpent || 0;
        
        // Reset Force Leave if year changed
        if (latestRecord.forceLeaveYear && latestRecord.forceLeaveYear !== currentYear) {
            forceLeaveSpent = 0;
        }
        
        // Reset Special Privilege Leave if year changed
        if (latestRecord.splYear && latestRecord.splYear !== currentYear) {
            splSpent = 0;
        }
        
        // Determine current balance from transactions (AO leave card entries) first,
        // then fall back to leaveUsageHistory, then to earned-spent fields
        let vlBalance = null;
        let slBalance = null;
        let totalForceSpent = forceLeaveSpent;
        let totalSplSpent = splSpent;
        
        // Check transactions array (from AO "Add Leave Entry") - most authoritative source
        if (latestRecord.transactions && Array.isArray(latestRecord.transactions) && latestRecord.transactions.length > 0) {
            // The last transaction's vlBalance/slBalance is the current running balance
            const lastTx = latestRecord.transactions[latestRecord.transactions.length - 1];
            if (lastTx.vlBalance !== undefined) vlBalance = lastTx.vlBalance;
            if (lastTx.slBalance !== undefined) slBalance = lastTx.slBalance;
            
            // Sum up force and special leave usage from all transactions
            totalForceSpent = 0;
            totalSplSpent = 0;
            latestRecord.transactions.forEach(tx => {
                totalForceSpent += parseFloat(tx.forcedLeave) || 0;
                totalSplSpent += parseFloat(tx.splUsed) || 0;
            });
            
            console.log('[LEAVE-CREDITS API] Using transactions balance: VL=', vlBalance, 'SL=', slBalance);
        }
        
        // If no transaction data, check leaveUsageHistory (from SDS approval flow)
        if (vlBalance === null || slBalance === null) {
            if (latestRecord.leaveUsageHistory && Array.isArray(latestRecord.leaveUsageHistory) && latestRecord.leaveUsageHistory.length > 0) {
                const latestUsage = latestRecord.leaveUsageHistory[latestRecord.leaveUsageHistory.length - 1];
                if (vlBalance === null && latestUsage.balanceAfterVL !== undefined) {
                    vlBalance = latestUsage.balanceAfterVL;
                }
                if (slBalance === null && latestUsage.balanceAfterSL !== undefined) {
                    slBalance = latestUsage.balanceAfterSL;
                }
            }
        }
        
        // Fall back to earned - spent calculation
        const vacationLeaveEarned = latestRecord.vacationLeaveEarned || latestRecord.vl || 0;
        const sickLeaveEarned = latestRecord.sickLeaveEarned || latestRecord.sl || 0;
        
        if (vlBalance === null) {
            vlBalance = Math.max(0, vacationLeaveEarned - (latestRecord.vacationLeaveSpent || 0));
        }
        if (slBalance === null) {
            slBalance = Math.max(0, sickLeaveEarned - (latestRecord.sickLeaveSpent || 0));
        }
        
        // Compute "spent" values from the balance for backward compat
        let vacationLeaveSpent = Math.max(0, vacationLeaveEarned - vlBalance);
        let sickLeaveSpent = Math.max(0, sickLeaveEarned - slBalance);
        
        // Also account for pending/approved applications that haven't been reflected in leave card yet
        // This ensures the dashboard shows the same balance as the leave card
        try {
            const applications = readJSONArray(applicationsFile);
            const employeeApps = applications.filter(a => 
                (a.employeeEmail === employeeId || a.email === employeeId) &&
                (a.status === 'pending' || a.status === 'approved')
            );
            
            // Track which application IDs are already reflected in leaveUsageHistory
            const reflectedAppIds = new Set();
            if (latestRecord.leaveUsageHistory && Array.isArray(latestRecord.leaveUsageHistory)) {
                latestRecord.leaveUsageHistory.forEach(h => {
                    if (h.applicationId) reflectedAppIds.add(h.applicationId);
                });
            }
            // Also check transactions
            if (latestRecord.transactions && Array.isArray(latestRecord.transactions)) {
                latestRecord.transactions.forEach(t => {
                    if (t.applicationId) reflectedAppIds.add(t.applicationId);
                });
            }
            
            employeeApps.forEach(app => {
                // Skip if already reflected in leave card history
                if (reflectedAppIds.has(app.id)) return;
                
                const numDays = parseFloat(app.numDays) || 0;
                if (numDays <= 0) return;
                
                const leaveType = (app.leaveType || '').toLowerCase();
                
                // Deduct from appropriate balance based on leave type
                if (leaveType.includes('vl') || leaveType.includes('vacation')) {
                    vlBalance = Math.max(0, vlBalance - numDays);
                } else if (leaveType.includes('mfl') || leaveType.includes('mandatory') || leaveType.includes('forced')) {
                    totalForceSpent += numDays;
                } else if (leaveType.includes('sl') || leaveType.includes('sick')) {
                    slBalance = Math.max(0, slBalance - numDays);
                } else if (leaveType.includes('spl') || leaveType.includes('special')) {
                    totalSplSpent += numDays;
                }
                // Other leave types - don't deduct from VL/SL (they use their own allocation)
            });
            
            // Recompute spent after app deductions
            vacationLeaveSpent = Math.max(0, vacationLeaveEarned - vlBalance);
            sickLeaveSpent = Math.max(0, sickLeaveEarned - slBalance);
            
            if (employeeApps.length > 0) {
                console.log('[LEAVE-CREDITS API] After pending apps deduction: VL=', vlBalance, 'SL=', slBalance, 'apps checked=', employeeApps.length);
            }
        } catch (appErr) {
            console.log('[LEAVE-CREDITS API] Could not read applications for deduction:', appErr.message);
        }
        
        // Ensure the credits object has all required fields with defaults
        const enrichedCredits = {
            ...latestRecord,
            vacationLeaveEarned: vacationLeaveEarned,
            sickLeaveEarned: sickLeaveEarned,
            forceLeaveEarned: latestRecord.forceLeaveEarned || latestRecord.mandatoryForced || latestRecord.others || 5,
            splEarned: latestRecord.splEarned || latestRecord.spl || 3,
            vacationLeaveSpent: vacationLeaveSpent,
            sickLeaveSpent: sickLeaveSpent,
            forceLeaveSpent: totalForceSpent,
            splSpent: totalSplSpent,
            forceLeaveYear: currentYear,
            splYear: currentYear,
            leaveUsageHistory: latestRecord.leaveUsageHistory || [],
            // Direct balance values for dashboard convenience
            currentVlBalance: vlBalance,
            currentSlBalance: slBalance
        };
        
        console.log('[LEAVE-CREDITS API] Returning:', JSON.stringify({
            vlBalance, slBalance,
            vacationLeaveEarned: enrichedCredits.vacationLeaveEarned,
            vacationLeaveSpent: enrichedCredits.vacationLeaveSpent,
            sickLeaveEarned: enrichedCredits.sickLeaveEarned,
            sickLeaveSpent: enrichedCredits.sickLeaveSpent,
            forceLeaveSpent: enrichedCredits.forceLeaveSpent,
            splSpent: enrichedCredits.splSpent,
            txCount: (latestRecord.transactions || []).length
        }));
        
        res.json({ success: true, credits: enrichedCredits });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get actual leave card allocation (for return/compliance preview)
app.get('/api/leave-card', requireAuth(), (req, res) => {
    try {
        const employeeId = req.query.employeeId;
        
        if (!employeeId) {
            return res.status(400).json({ success: false, error: 'Employee ID is required' });
        }
        
        // SECURITY: Only allow access to own leave card unless admin role
        const adminRoles = ['ao', 'hr', 'asds', 'sds', 'it'];
        if (!adminRoles.includes(req.session.role) && req.session.email !== employeeId) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }
        
        const leavecards = readJSON(leavecardsFile);
        
        // Find all records for this employee to get the latest one
        const employeeRecords = leavecards.filter(lc => lc.employeeId === employeeId || lc.email === employeeId);
        
        if (employeeRecords.length === 0) {
            // Return default leave card allocation (0 until monthly accrual)
            return res.json({ 
                success: true, 
                credits: {
                    employeeId: employeeId,
                    email: employeeId,
                    vl: 0,
                    sl: 0,
                    spl: 3,
                    forceLeave: 5
                }
            });
        }
        
        // Get the latest record
        let latestRecord = employeeRecords[0];
        employeeRecords.forEach(record => {
            const latestTime = new Date(latestRecord.updatedAt || latestRecord.createdAt || 0).getTime();
            const currentTime = new Date(record.updatedAt || record.createdAt || 0).getTime();
            if (currentTime > latestTime) {
                latestRecord = record;
            }
        });
        
        // Return the actual allocation values from the leave card (earned values = the allocation set in edit)
        res.json({ 
            success: true, 
            credits: {
                employeeId: latestRecord.employeeId,
                email: latestRecord.email,
                vl: latestRecord.vacationLeaveEarned || latestRecord.vl || 0,
                sl: latestRecord.sickLeaveEarned || latestRecord.sl || 0,
                spl: latestRecord.splEarned || latestRecord.spl || 3,
                forceLeave: latestRecord.forceLeaveEarned || latestRecord.others || 5
            }
        });
    } catch (error) {
        console.error('[LEAVE-CARD API] Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get employee leave card with earned and spent data
app.get('/api/employee-leavecard', requireAuth(), (req, res) => {
    try {
        const employeeId = req.query.employeeId;
        if (!employeeId) {
            return res.status(400).json({ success: false, error: 'Employee ID is required' });
        }
        
        // SECURITY: Only allow access to own leave card unless admin role
        const adminRoles = ['ao', 'hr', 'asds', 'sds', 'it'];
        if (!adminRoles.includes(req.session.role) && req.session.email !== employeeId) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }
        
        const leavecards = readJSON(leavecardsFile);
        
        // Try to find by employeeId first, then by email (since we use email as ID now)
        let leavecard = leavecards.find(lc => lc.employeeId === employeeId || lc.email === employeeId);
        
        console.log(`[EMPLOYEE LEAVECARD] Looking for: id=${employeeId}, Found: ${!!leavecard}`);
        
        if (!leavecard) {
            // Return empty leave card if not found
            return res.json({ 
                success: true, 
                leavecard: {
                    employeeId: employeeId,
                    email: employeeId,
                    vacationLeaveEarned: 0,
                    sickLeaveEarned: 0,
                    forceLeaveEarned: 0,
                    splEarned: 0,
                    vacationLeaveSpent: 0,
                    sickLeaveSpent: 0,
                    forceLeaveSpent: 0,
                    splSpent: 0
                }
            });
        }
        
        res.json({ success: true, leavecard });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get returned applications for employee to resubmit
app.get('/api/returned-applications/:email', requireAuth(), (req, res) => {
    try {
        const email = req.params.email;
        // SECURITY: Only allow access to own returned applications unless admin role
        const adminRoles = ['ao', 'hr', 'asds', 'sds', 'it'];
        if (!adminRoles.includes(req.session.role) && req.session.email !== email) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }
        const applications = readJSONArray(applicationsFile);
        
        let returnedApps = applications.filter(a => 
            a.employeeEmail === email && 
            a.status === 'returned' && 
            a.currentApprover === 'EMPLOYEE'
        );
        
        res.json({ success: true, applications: returnedApps });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Resubmit application after compliance
app.post('/api/resubmit-leave', requireAuth(), (req, res) => {
    try {
        const { applicationId, updatedData } = req.body;
        // SECURITY: Use session email instead of trusting client-provided employeeEmail
        const employeeEmail = req.session.email;
        if (!employeeEmail) {
            return res.status(401).json({ success: false, error: 'Session expired. Please log in again.' });
        }
        const applications = readJSONArray(applicationsFile);
        const appIndex = applications.findIndex(a => a.id === applicationId);
        
        if (appIndex === -1) {
            return res.status(404).json({ success: false, error: 'Application not found' });
        }
        
        const app = applications[appIndex];
        
        // Verify the employee owns this application (using session email)
        if (app.employeeEmail !== employeeEmail) {
            return res.status(403).json({ success: false, error: 'Unauthorized to resubmit this application' });
        }
        
        // Verify application is in returned status
        if (app.status !== 'returned' || app.currentApprover !== 'EMPLOYEE') {
            return res.status(400).json({ success: false, error: 'Application is not awaiting resubmission' });
        }
        
        // ===== VALIDATION: Check Force/SPL leave balance for resubmitted applications =====
        const leaveType = app.leaveType;
        const numDays = parseFloat(updatedData?.numDays || app.numDays) || 0;
        
        if (leaveType === 'leave_mfl' || leaveType === 'leave_spl') {
            const leavecards = readJSON(leavecardsFile);
            const employeeLeave = leavecards.find(lc => lc.email === employeeEmail);
            
            if (employeeLeave) {
                const forceLeaveSpent = employeeLeave.forceLeaveSpent || 0;
                const splSpent = employeeLeave.splSpent || 0;
                
                // Check if Force Leave is exhausted
                if (leaveType === 'leave_mfl' && forceLeaveSpent >= 5) {
                    console.log(`[VALIDATION] Force Leave rejected for resubmit ${employeeEmail}: Already spent ${forceLeaveSpent}/5 days`);
                    return res.status(400).json({ 
                        success: false, 
                        error: 'Force Leave exhausted',
                        message: 'You have already used all 5 days of your yearly Force Leave allocation. Cannot resubmit this application.'
                    });
                }
                
                // Check if SPL is exhausted
                if (leaveType === 'leave_spl' && splSpent >= 3) {
                    console.log(`[VALIDATION] SPL rejected for resubmit ${employeeEmail}: Already spent ${splSpent}/3 days`);
                    return res.status(400).json({ 
                        success: false, 
                        error: 'SPL exhausted',
                        message: 'You have already used all 3 days of your yearly Special Privilege Leave allocation. Cannot resubmit this application.'
                    });
                }
            }
        }
        
        // CSC MC No. 6 s.1996: FL consecutive-day restriction removed
        // Force Leave should ideally be taken as consecutive days (not restricted)
        
        // Update application with only allowed fields from resubmission (prevent mass assignment)
        if (updatedData) {
            const allowedResubmitFields = ['complianceDocuments', 'supportingDocuments', 'soFileData', 'soFileName', 'remarks'];
            for (const field of allowedResubmitFields) {
                if (updatedData[field] !== undefined) {
                    app[field] = updatedData[field];
                }
            }
        }
        
        // Add to approval history
        app.approvalHistory.push({
            portal: 'EMPLOYEE',
            action: 'resubmitted',
            approverName: app.employeeName,
            remarks: 'Application resubmitted with compliance documents',
            timestamp: new Date().toISOString()
        });
        
        // Reset status and send back to AO
        app.status = 'pending';
        app.currentApprover = 'AO';
        app.resubmittedAt = new Date().toISOString();
        
        applications[appIndex] = app;
        writeJSON(applicationsFile, applications);
        
        console.log(`[LEAVE] Application ${applicationId} resubmitted by ${app.employeeName}`);
        
        res.json({ 
            success: true, 
            message: 'Application resubmitted successfully',
            application: app
        });
    } catch (error) {
        console.error('Error resubmitting application:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update leave credits for an employee
app.post('/api/update-leave-credits', requireAuth('ao', 'it'), (req, res) => {
    try {
        const { 
            applicationId, 
            employeeId,
            employeeEmail,
            transactions,
            vacationLeaveEarned, 
            sickLeaveEarned, 
            forceLeaveEarned, 
            splEarned,
            vacationLeaveSpent, 
            sickLeaveSpent, 
            forceLeaveSpent, 
            splSpent,
            vl, sl, spl, others, mandatoryForced 
        } = req.body;
        
        let leavecards = readJSON(leavecardsFile);
        
        // Use email as primary lookup key since that's what we have from applications
        console.log(`[UPDATE LEAVE] Received: email=${employeeEmail}, applicationId=${applicationId}`);
        
        // Find existing leave card by email, name, or employee number
        let employeeLeave = leavecards.find(lc => lc.email === employeeEmail);
        
        // Fallback: match by name if no email match (for unlinked Excel-migrated cards)
        if (!employeeLeave && employeeEmail) {
            const normalizedId = employeeEmail.toUpperCase().replace(/\s+/g, ' ').trim();
            employeeLeave = leavecards.find(lc => {
                const lcName = (lc.name || '').toUpperCase().replace(/\s+/g, ' ').trim();
                return lcName === normalizedId;
            });
        }
        
        // Fallback: match by employee number
        if (!employeeLeave && employeeEmail) {
            employeeLeave = leavecards.find(lc => lc.employeeNo && lc.employeeNo === employeeEmail);
        }
        
        console.log(`[UPDATE LEAVE] Found existing record: ${!!employeeLeave}`);
        
        if (!employeeLeave) {
            // Create new leave card record with transaction history
            employeeLeave = {
                applicationId: applicationId,
                employeeId: employeeEmail, // Use email as ID since we don't have explicit ID from application
                email: employeeEmail,
                transactions: transactions || [],
                // Legacy fields for backward compatibility
                vacationLeaveEarned: vacationLeaveEarned || 0,
                sickLeaveEarned: sickLeaveEarned || 0,
                forceLeaveEarned: forceLeaveEarned || 0,
                splEarned: splEarned || 0,
                vacationLeaveSpent: vacationLeaveSpent || 0,
                sickLeaveSpent: sickLeaveSpent || 0,
                forceLeaveSpent: forceLeaveSpent || 0,
                splSpent: splSpent || 0,
                vl: vl || 0,
                sl: sl || 0,
                spl: spl || 0,
                others: others || mandatoryForced || 0,
                mandatoryForced: mandatoryForced || others || 0,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            leavecards.push(employeeLeave);
            console.log('[UPDATE LEAVE] Created new leave card record for:', employeeEmail);
        } else {
            // Update with new transactions
            if (transactions && Array.isArray(transactions)) {
                // Add new transactions to history
                employeeLeave.transactions = employeeLeave.transactions || [];
                employeeLeave.transactions.push(...transactions);
                console.log('[UPDATE LEAVE] Added', transactions.length, 'transactions to history');
            }
            
            // Update legacy fields for backward compatibility
            if (vacationLeaveEarned !== undefined) employeeLeave.vacationLeaveEarned = vacationLeaveEarned;
            if (sickLeaveEarned !== undefined) employeeLeave.sickLeaveEarned = sickLeaveEarned;
            if (forceLeaveEarned !== undefined) employeeLeave.forceLeaveEarned = forceLeaveEarned;
            if (splEarned !== undefined) employeeLeave.splEarned = splEarned;
            if (vacationLeaveSpent !== undefined) employeeLeave.vacationLeaveSpent = vacationLeaveSpent;
            if (sickLeaveSpent !== undefined) employeeLeave.sickLeaveSpent = sickLeaveSpent;
            if (forceLeaveSpent !== undefined) employeeLeave.forceLeaveSpent = forceLeaveSpent;
            if (splSpent !== undefined) employeeLeave.splSpent = splSpent;
            if (vl !== undefined) {
                employeeLeave.vl = vl;
                // If this is a direct balance edit (from AO), also update vacationLeaveEarned
                // so the employee dashboard's earned-spent calculation stays in sync
                if (!transactions && !vacationLeaveEarned) {
                    const currentSpent = employeeLeave.vacationLeaveSpent || 0;
                    employeeLeave.vacationLeaveEarned = vl + currentSpent;
                }
            }
            if (sl !== undefined) {
                employeeLeave.sl = sl;
                if (!transactions && !sickLeaveEarned) {
                    const currentSpent = employeeLeave.sickLeaveSpent || 0;
                    employeeLeave.sickLeaveEarned = sl + currentSpent;
                }
            }
            if (spl !== undefined) {
                employeeLeave.spl = spl;
                employeeLeave.splEarned = spl;
            }
            if (others !== undefined) employeeLeave.others = others;
            if (mandatoryForced !== undefined) {
                employeeLeave.mandatoryForced = mandatoryForced;
                employeeLeave.others = mandatoryForced;
                employeeLeave.forceLeaveEarned = mandatoryForced;
            }
            
            employeeLeave.updatedAt = new Date().toISOString();
            console.log('[UPDATE LEAVE] Updated existing leave card for:', employeeEmail);
        }
        
        writeJSON(leavecardsFile, leavecards);
        console.log('[UPDATE LEAVE] Successfully saved leave card data');
        
        // Log leave credits update
        logActivity('LEAVE_CREDITS_UPDATED', 'employee', {
            userEmail: employeeEmail,
            applicationId: applicationId,
            vl: employeeLeave.vl,
            sl: employeeLeave.sl,
            spl: employeeLeave.spl,
            ip: getClientIp(req),
            userAgent: req.get('user-agent')
        });

        res.json({ 
            success: true, 
            message: 'Leave card updated successfully',
            leavecard: employeeLeave
        });
    } catch (error) {
        console.error('[UPDATE LEAVE] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Approve, return, or reject application
app.post('/api/approve-leave', requireAuth('hr', 'ao', 'asds', 'sds'), (req, res) => {
    try {
        const { applicationId, action, approverPortal, approverName, remarks, authorizedOfficerName, authorizedOfficerSignature, asdsOfficerName, asdsOfficerSignature, sdsOfficerName, sdsOfficerSignature, vlEarned, vlLess, vlBalance, slEarned, slLess, slBalance, splEarned, splLess, splBalance, flEarned, flLess, flBalance, ctoEarned, ctoLess, ctoBalance } = req.body;
        const ip = getClientIp(req);
        console.log('[APPROVE-LEAVE] Request received:', { applicationId, action, approverPortal, approverName });
        
        const applications = readJSONArray(applicationsFile);
        // Handle both string and number applicationId
        const appIndex = applications.findIndex(a => a.id === applicationId || a.id === parseInt(applicationId));
        
        if (appIndex === -1) {
            console.error('[APPROVE-LEAVE] Application not found:', applicationId);
            return res.status(404).json({ success: false, error: 'Application not found' });
        }
        
        const app = applications[appIndex];
        console.log('[APPROVE-LEAVE] Found application:', { id: app.id, employee: app.employeeName, currentApprover: app.currentApprover });
        
        // SECURITY: Use session role instead of trusting client-provided portal
        // Map session role to portal name (prevents portal spoofing attack)
        const roleToPortal = { 'ao': 'AO', 'hr': 'HR', 'asds': 'ASDS', 'sds': 'SDS' };
        const sessionRole = req.session?.role;
        const currentApprover = roleToPortal[sessionRole] || (approverPortal || '').toUpperCase();
        
        // Validate that the session role matches what the application expects
        if (currentApprover !== app.currentApprover) {
            console.log(`[APPROVE-LEAVE] Portal mismatch: session role=${sessionRole} (${currentApprover}), app expects=${app.currentApprover}`);
            return res.status(403).json({ 
                success: false, 
                error: `This application is currently waiting for ${app.currentApprover} approval. You cannot act on it as ${currentApprover}.`
            });
        }
        
        // Validate that reason is provided for return or reject actions
        if ((action === 'returned' || action === 'rejected') && (!remarks || !remarks.trim())) {
            return res.status(400).json({ 
                success: false, 
                error: 'Please provide a reason for ' + (action === 'returned' ? 'returning' : 'rejecting') + ' this application' 
            });
        }
        
        // Add to approval history — use session-derived portal for audit integrity
        app.approvalHistory.push({
            portal: currentApprover,
            action: action,
            approverName: req.session.email || approverName,
            remarks: remarks || '',
            timestamp: new Date().toISOString()
        });
        
        if (action === 'returned') {
            // Return application to a specific step or previous step for compliance
            // Workflow: Employee <- AO <- HR <- ASDS <- SDS
            // With returnTo parameter, approver can send directly to any lower step
            const returnTo = req.body.returnTo; // Optional: 'EMPLOYEE', 'AO', 'HR', 'ASDS'
            let returnedTo = null;
            
            // Define the workflow hierarchy (lower index = lower in chain)
            const workflowOrder = ['EMPLOYEE', 'AO', 'HR', 'ASDS', 'SDS'];
            const currentIndex = workflowOrder.indexOf(currentApprover);
            
            if (returnTo && workflowOrder.indexOf(returnTo) < currentIndex) {
                // Return to specific target (must be below current approver in hierarchy)
                if (returnTo === 'EMPLOYEE') {
                    app.status = 'returned';
                    app.currentApprover = 'EMPLOYEE';
                } else {
                    app.status = 'pending';
                    app.currentApprover = returnTo;
                }
                returnedTo = returnTo === 'EMPLOYEE' ? 'Employee' : returnTo;
            } else {
                // Default: return to previous step
                if (currentApprover === 'AO') {
                    app.status = 'returned';
                    app.currentApprover = 'EMPLOYEE';
                    returnedTo = 'Employee';
                } else if (currentApprover === 'HR') {
                    app.status = 'pending';
                    app.currentApprover = 'AO';
                    returnedTo = 'AO';
                } else if (currentApprover === 'ASDS') {
                    app.status = 'pending';
                    app.currentApprover = 'HR';
                    returnedTo = 'HR';
                } else if (currentApprover === 'SDS') {
                    app.status = 'pending';
                    app.currentApprover = 'ASDS';
                    returnedTo = 'ASDS';
                }
            }
            
            app.returnedAt = new Date().toISOString();
            app.returnedBy = currentApprover;
            app.returnRemarks = remarks;
            
            console.log(`[LEAVE] Application ${applicationId} returned by ${approverPortal} to ${returnedTo} - Reason: ${remarks}`);
            
        } else if (action === 'rejected') {
            // Final rejection - application is permanently rejected
            app.status = 'rejected';
            app.currentApprover = null;
            app.rejectedAt = new Date().toISOString();
            app.rejectedBy = currentApprover;
            app.rejectedByName = req.session.email || approverName;
            app.rejectionReason = remarks;
            
            console.log(`[LEAVE] Application ${applicationId} REJECTED by ${approverPortal} - Reason: ${remarks}`);
            
        } else if (action === 'approved') {
            // Determine next approver based on workflow
            if (currentApprover === 'AO') {
                // AO approved -> goes to HR
                app.currentApprover = 'HR';
                app.aoApprovedAt = new Date().toISOString();
                console.log(`[WORKFLOW] AO approved - Moving to HR`);
            } else if (currentApprover === 'HR') {
                // HR approved -> goes to ASDS
                app.currentApprover = 'ASDS';
                app.hrApprovedAt = new Date().toISOString();
                
                // Store authorized officer info for Section 7.A of the final form
                if (authorizedOfficerName) {
                    app.authorizedOfficerName = authorizedOfficerName;
                }
                if (authorizedOfficerSignature) {
                    app.authorizedOfficerSignature = authorizedOfficerSignature;
                }
                
                // Store leave credits certified by HR
                if (vlEarned !== undefined) app.vlEarned = vlEarned;
                if (vlLess !== undefined) app.vlLess = vlLess;
                if (vlBalance !== undefined) app.vlBalance = vlBalance;
                if (slEarned !== undefined) app.slEarned = slEarned;
                if (slLess !== undefined) app.slLess = slLess;
                if (slBalance !== undefined) app.slBalance = slBalance;
                if (splEarned !== undefined) app.splEarned = splEarned;
                if (splLess !== undefined) app.splLess = splLess;
                if (splBalance !== undefined) app.splBalance = splBalance;
                if (flEarned !== undefined) app.flEarned = flEarned;
                if (flLess !== undefined) app.flLess = flLess;
                if (flBalance !== undefined) app.flBalance = flBalance;
                if (ctoEarned !== undefined) app.ctoEarned = ctoEarned;
                if (ctoLess !== undefined) app.ctoLess = ctoLess;
                if (ctoBalance !== undefined) app.ctoBalance = ctoBalance;
                
                console.log(`[WORKFLOW] HR approved - Moving to ASDS. Authorized Officer: ${authorizedOfficerName || 'Not specified'}`);
            } else if (currentApprover === 'ASDS') {
                // ASDS approved -> goes to SDS
                app.currentApprover = 'SDS';
                app.asdsApprovedAt = new Date().toISOString();
                
                // Store ASDS/OIC-ASDS officer info for Section 7.B of the final form
                if (asdsOfficerName) {
                    app.asdsOfficerName = asdsOfficerName;
                }
                if (asdsOfficerSignature) {
                    app.asdsOfficerSignature = asdsOfficerSignature;
                }
                
                console.log(`[WORKFLOW] ASDS approved - Moving to SDS. OIC-ASDS: ${asdsOfficerName || 'Not specified'}`);
            } else if (currentApprover === 'SDS') {
                // SDS approved -> FINAL APPROVAL
                app.status = 'approved';
                app.currentApprover = null;
                app.sdsApprovedAt = new Date().toISOString();
                app.finalApprovalAt = new Date().toISOString();
                
                // Store SDS officer info
                if (sdsOfficerName) {
                    app.sdsOfficerName = sdsOfficerName;
                }
                if (sdsOfficerSignature) {
                    app.sdsOfficerSignature = sdsOfficerSignature;
                }
                
                console.log(`[WORKFLOW] SDS approved - FINAL APPROVAL. OIC-SDS: ${sdsOfficerName || 'Not specified'}`);
                
                // Update employee's leave balance
                updateEmployeeLeaveBalance(app);
            }
            
            console.log(`[LEAVE] Application ${applicationId} approved by ${approverPortal}, new currentApprover: ${app.currentApprover}`);
        }
        
        applications[appIndex] = app;
        writeJSON(applicationsFile, applications);
        
        console.log('[APPROVE-LEAVE] Application updated successfully', { 
            applicationId: app.id, 
            newStatus: app.status, 
            newCurrentApprover: app.currentApprover,
            action: action 
        });
        
        res.json({ 
            success: true, 
            message: `Application ${action} successfully`,
            application: app
        });
        
        // Log activity after successful action — use session-derived values
        logActivity(`LEAVE_APPLICATION_${action.toUpperCase()}`, currentApprover.toLowerCase(), {
            userEmail: req.session.email || approverName,
            ip,
            userAgent: req.get('user-agent'),
            applicationId: app.id,
            employeeEmail: app.employeeEmail,
            remarks,
            action
        });
    } catch (error) {
        console.error('Error processing approval:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Function to update employee leave balance after final approval
function updateEmployeeLeaveBalance(application) {
    try {
        const employees = readJSON(employeesFile);
        const empIndex = employees.findIndex(e => e.email === application.employeeEmail);
        
        if (empIndex === -1) {
            console.error('Employee not found for balance update:', application.employeeEmail);
            return;
        }
        
        const employee = employees[empIndex];
        
        // Initialize leave credits if not present
        if (!employee.leaveCredits) {
            employee.leaveCredits = {
                vacationLeave: 0,
                sickLeave: 0
            };
        }
        
        // Deduct based on leave type and days
        const vlLess = parseFloat(application.vlLess) || 0;
        const slLess = parseFloat(application.slLess) || 0;
        const leaveType = application.typeOfLeave || application.leaveType || '';
        const leaveTypeLower = String(leaveType).toLowerCase();
        
        const isForceLeave = leaveTypeLower.includes('force') || leaveTypeLower.includes('mandatory') || leaveTypeLower.includes('leave_mfl');
        const isSpecialLeave = leaveTypeLower.includes('special') || leaveTypeLower.includes('leave_spl');
        
        if (isForceLeave) {
            // CSC MC No. 6 s.1996: Force Leave is charged against VL balance
            const flDays = parseFloat(application.numDays) || parseFloat(application.daysApplied) || vlLess || 1;
            employee.leaveCredits.vacationLeave = Math.max(0, (employee.leaveCredits.vacationLeave || 0) - flDays);
        } else if (!isSpecialLeave) {
            if (vlLess > 0) {
                employee.leaveCredits.vacationLeave = Math.max(0, (employee.leaveCredits.vacationLeave || 0) - vlLess);
            }
            if (slLess > 0) {
                employee.leaveCredits.sickLeave = Math.max(0, (employee.leaveCredits.sickLeave || 0) - slLess);
            }
        }
        
        employee.lastLeaveUpdate = new Date().toISOString();
        employees[empIndex] = employee;
        writeJSON(employeesFile, employees);
        
        // Update leave card with leave usage history
        updateLeaveCardWithUsage(application, vlLess, slLess);
        
        console.log(`[LEAVE] Updated leave balance for ${application.employeeEmail}: VL=${employee.leaveCredits.vacationLeave}, SL=${employee.leaveCredits.sickLeave}, LeaveType=${leaveType}`);
    } catch (error) {
        console.error('Error updating leave balance:', error);
    }
}

function updateLeaveCardWithUsage(application, vlUsed, slUsed) {
    try {
        const leavecards = readJSON(leavecardsFile);
        let leavecard = leavecards.find(lc => lc.email === application.employeeEmail || lc.employeeId === application.employeeEmail);
        const currentYear = new Date().getFullYear();
        
        if (!leavecard) {
            // Create new leave card if not found (VL/SL start at 0, earned via monthly accrual)
            leavecard = {
                email: application.employeeEmail,
                employeeId: application.employeeEmail,
                vacationLeaveEarned: 0,
                sickLeaveEarned: 0,
                forceLeaveEarned: 5,
                splEarned: 3,
                vacationLeaveSpent: 0,
                sickLeaveSpent: 0,
                forceLeaveSpent: 0,
                splSpent: 0,
                forceLeaveYear: currentYear,
                splYear: currentYear,
                vl: 0,
                sl: 0,
                spl: 3,
                others: 0,
                leaveUsageHistory: [],
                createdAt: new Date().toISOString()
            };
            leavecards.push(leavecard);
        }
        
        // Initialize earned values if not present (for existing cards without these fields)
        if (leavecard.vacationLeaveEarned === undefined) leavecard.vacationLeaveEarned = 0;
        if (leavecard.sickLeaveEarned === undefined) leavecard.sickLeaveEarned = 0;
        
        // Initialize year tracking if not present
        if (!leavecard.forceLeaveYear) leavecard.forceLeaveYear = currentYear;
        if (!leavecard.splYear) leavecard.splYear = currentYear;
        
        // Reset Force Leave balance if year has changed
        if (leavecard.forceLeaveYear !== currentYear) {
            leavecard.forceLeaveSpent = 0;
            leavecard.forceLeaveYear = currentYear;
        }
        
        // Reset Special Privilege Leave balance if year has changed
        if (leavecard.splYear !== currentYear) {
            leavecard.splSpent = 0;
            leavecard.splYear = currentYear;
        }
        
        // Initialize balance if not set (use earned values)
        if (leavecard.vl === undefined || leavecard.vl === null) {
            leavecard.vl = leavecard.vacationLeaveEarned - (leavecard.vacationLeaveSpent || 0);
        }
        if (leavecard.sl === undefined || leavecard.sl === null) {
            leavecard.sl = leavecard.sickLeaveEarned - (leavecard.sickLeaveSpent || 0);
        }
        
        // Initialize usage history if not present
        if (!leavecard.leaveUsageHistory) {
            leavecard.leaveUsageHistory = [];
        }
        
        // Determine leave type from application
        let leaveType = 'Leave';
        let daysUsed = 0;
        let forceLeaveUsed = 0;
        let splUsed = 0;
        
        if (application.typeOfLeave || application.leaveType) {
            const lType = application.typeOfLeave || application.leaveType;
            if (lType === 'leave_mfl' || String(lType).toLowerCase().includes('force')) {
                leaveType = 'Force Leave';
                daysUsed = parseFloat(application.numDays) || parseFloat(application.forceLeaveCount) || parseFloat(application.daysApplied) || 1;
                forceLeaveUsed = daysUsed;
            } else if (lType === 'leave_spl' || String(lType).toLowerCase().includes('special')) {
                leaveType = 'Special Privilege Leave';
                daysUsed = parseFloat(application.numDays) || parseFloat(application.splCount) || parseFloat(application.daysApplied) || 1;
                splUsed = daysUsed;
            }
        }
        
        // If no specific leave type matched, use VL/SL
        if (!forceLeaveUsed && !splUsed) {
            if (vlUsed > 0) {
                leaveType = 'Vacation Leave';
                daysUsed = vlUsed;
            } else if (slUsed > 0) {
                leaveType = 'Sick Leave';
                daysUsed = slUsed;
            }
        }
        
        // Deduct from balance based on leave type
        if (forceLeaveUsed > 0) {
            // CSC MC No. 6 s.1996: Force Leave is charged AGAINST VL balance
            leavecard.forceLeaveSpent = (leavecard.forceLeaveSpent || 0) + forceLeaveUsed;
            leavecard.vl = Math.max(0, (leavecard.vl || 0) - forceLeaveUsed);
            leavecard.vacationLeaveSpent = (leavecard.vacationLeaveSpent || 0) + forceLeaveUsed;
        } else if (splUsed > 0) {
            leavecard.splSpent = (leavecard.splSpent || 0) + splUsed;
        } else if (application.leaveType === 'leave_others' || String(application.leaveType || '').toLowerCase().includes('others')) {
            // CTO/Others leave - deduct from CTO records
            const ctoUsed = parseFloat(application.numDays) || parseFloat(application.daysApplied) || 1;
            leaveType = 'CTO';
            daysUsed = ctoUsed;
            try {
                ensureFile(ctoRecordsFile);
                const ctoRecords = readJSON(ctoRecordsFile);
                const empCtoRecords = ctoRecords.filter(r => r.employeeId === application.employeeEmail);
                if (empCtoRecords.length > 0) {
                    // Find the most recent CTO record with remaining balance
                    let remaining = ctoUsed;
                    for (let i = empCtoRecords.length - 1; i >= 0 && remaining > 0; i--) {
                        const rec = empCtoRecords[i];
                        const recIndex = ctoRecords.indexOf(rec);
                        const granted = parseFloat(rec.daysGranted) || 0;
                        const used = parseFloat(rec.daysUsed) || 0;
                        const available = granted - used;
                        if (available > 0) {
                            const deduct = Math.min(remaining, available);
                            ctoRecords[recIndex].daysUsed = (used + deduct);
                            remaining -= deduct;
                        }
                    }
                    writeJSON(ctoRecordsFile, ctoRecords);
                    console.log(`[LEAVECARD] Deducted ${ctoUsed} CTO days from records for ${application.employeeEmail}`);
                }
            } catch (ctoErr) {
                console.error('Error deducting CTO:', ctoErr);
            }
        } else {
            // VL/SL deduction — with SL-to-VL fallback per CSC Rule XVI Sec. 15
            if (slUsed > 0) {
                const currentSl = leavecard.sl || 0;
                if (slUsed > currentSl) {
                    // SL exhausted — deduct what SL can cover, charge remainder to VL
                    const slPortion = currentSl;
                    const vlPortion = slUsed - slPortion;
                    leavecard.sl = 0;
                    leavecard.sickLeaveSpent = (leavecard.sickLeaveSpent || 0) + slPortion;
                    leavecard.vl = Math.max(0, (leavecard.vl || 0) - vlPortion);
                    leavecard.vacationLeaveSpent = (leavecard.vacationLeaveSpent || 0) + vlPortion;
                    console.log(`[LEAVECARD] SL-to-VL fallback: ${slPortion} from SL, ${vlPortion} from VL for ${application.employeeEmail}`);
                } else {
                    leavecard.sl = Math.max(0, currentSl - slUsed);
                    leavecard.sickLeaveSpent = (leavecard.sickLeaveSpent || 0) + slUsed;
                }
            }
            if (vlUsed > 0) {
                leavecard.vl = Math.max(0, (leavecard.vl || 0) - vlUsed);
                leavecard.vacationLeaveSpent = (leavecard.vacationLeaveSpent || 0) + vlUsed;
            }
        }
        
        // Record usage with period covered
        const dateFrom = application.dateFrom || application.date_from || application.inclusiveDatesFrom || '';
        const dateTo = application.dateTo || application.date_to || application.inclusiveDatesTo || '';
        
        // balanceAfterVL/SL should always reflect the current VL/SL balance, regardless of leave type
        const balanceAfterVL = leavecard.vl;
        const balanceAfterSL = leavecard.sl;
        
        leavecard.leaveUsageHistory.push({
            applicationId: application.id,
            leaveType: leaveType,
            daysUsed: daysUsed,
            periodFrom: dateFrom,
            periodTo: dateTo,
            dateApproved: new Date().toISOString(),
            approvedBy: 'SDS',
            remarks: application.remarks || '',
            balanceAfterVL: balanceAfterVL,
            balanceAfterSL: balanceAfterSL
        });
        
        leavecard.updatedAt = new Date().toISOString();
        
        // Find and update the leavecard entry
        const lcIndex = leavecards.findIndex(lc => lc.email === application.employeeEmail || lc.employeeId === application.employeeEmail);
        if (lcIndex !== -1) {
            leavecards[lcIndex] = leavecard;
        }
        
        writeJSON(leavecardsFile, leavecards);
        console.log(`[LEAVECARD] Updated leave card for ${application.employeeEmail}: VL Balance=${leavecard.vl}, SL Balance=${leavecard.sl}, Force Spent=${leavecard.forceLeaveSpent}, SPL Spent=${leavecard.splSpent}, Year=${currentYear}`);
    } catch (error) {
        console.error('Error updating leave card:', error);
    }
}

// ========== LEAVE CARD ENDPOINTS ==========

// ========== CTO RECORDS API ==========
// Get CTO records for an employee
app.get('/api/cto-records', requireAuth(), (req, res) => {
    try {
        const { employeeId } = req.query;
        ensureFile(ctoRecordsFile);
        
        // SECURITY: Only allow access to own CTO records unless admin role
        const adminRoles = ['ao', 'hr', 'asds', 'sds', 'it'];
        if (employeeId && !adminRoles.includes(req.session.role) && req.session.email !== employeeId) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }
        let ctoRecords = readJSON(ctoRecordsFile);

        if (employeeId) {
            ctoRecords = ctoRecords.filter(r => {
                if (r.employeeId === employeeId || r.email === employeeId) return true;
                // Fallback: match by name or employee number (for unlinked Excel-migrated cards)
                const rName = (r.name || '').toUpperCase().replace(/\s+/g, ' ').trim();
                const normalizedId = employeeId.toUpperCase().replace(/\s+/g, ' ').trim();
                if (rName && rName === normalizedId) return true;
                if (r.employeeNo && r.employeeNo === employeeId) return true;
                return false;
            });
        }

        res.json({ success: true, records: ctoRecords });
    } catch (error) {
        console.error('Error fetching CTO records:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Add/Update CTO record
app.post('/api/update-cto-records', requireAuth('ao', 'it'), (req, res) => {
    try {
        const { employeeId, type, soDetails, daysGranted, daysUsed, periodCovered, soImage } = req.body;
        
        if (!employeeId) {
            return res.status(400).json({ success: false, error: 'Employee ID is required' });
        }

        // Validate soImage size (max 5MB base64 ≈ ~6.7MB string length)
        if (soImage && soImage.length > 7 * 1024 * 1024) {
            return res.status(400).json({ success: false, error: 'SO image too large. Maximum 5MB allowed.' });
        }

        ensureFile(ctoRecordsFile);
        let ctoRecords = readJSON(ctoRecordsFile);

        const newRecord = {
            id: crypto.randomUUID(),
            employeeId,
            email: employeeId,
            type: type || 'ADD',
            soDetails: soDetails || '',
            periodCovered: periodCovered || new Date().toISOString(),
            daysGranted: Number(daysGranted) || 0,
            daysUsed: Number(daysUsed) || 0,
            balance: 0,
            soImage: soImage || '',
            createdAt: new Date().toISOString()
        };

        ctoRecords.push(newRecord);
        
        writeJSON(ctoRecordsFile, ctoRecords);

        console.log(`[CTO RECORDS] Added for ${employeeId} - Type: ${type}, SO: ${soDetails}, Days Granted: ${daysGranted}, Days Used: ${daysUsed}`);

        res.json({ 
            success: true, 
            message: 'CTO record added successfully',
            record: newRecord
        });
    } catch (error) {
        console.error('Error adding CTO record:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update CTO record (deduct days used)
app.put('/api/cto-records/:recordId', requireAuth('ao', 'it'), (req, res) => {
    try {
        const recordId = req.params.recordId;
        const { daysUsed } = req.body;

        ensureFile(ctoRecordsFile);
        let ctoRecords = readJSON(ctoRecordsFile);
        const index = ctoRecords.findIndex(r => String(r.id) === String(recordId));

        if (index === -1) {
            return res.status(404).json({ success: false, error: 'Record not found' });
        }

        ctoRecords[index].daysUsed = (ctoRecords[index].daysUsed || 0) + Number(daysUsed);
        writeJSON(ctoRecordsFile, ctoRecords);

        res.json({ 
            success: true, 
            message: 'CTO record updated successfully',
            record: ctoRecords[index]
        });
    } catch (error) {
        console.error('Error updating CTO record:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== ACTIVITY LOG ENDPOINTS ==========

// Get all activity logs with pagination and filtering
app.get('/api/activity-logs', requireAuth('it'), (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const action = req.query.action;
        const portal = req.query.portal;
        const userEmail = req.query.userEmail;
        const startDate = req.query.startDate;
        const endDate = req.query.endDate;
        
        let logs = [];
        if (fs.existsSync(activityLogsFile)) {
            try {
                const content = fs.readFileSync(activityLogsFile, 'utf-8');
                logs = JSON.parse(content);
                if (!Array.isArray(logs)) logs = [];
            } catch (e) {
                logs = [];
            }
        }
        
        // Apply filters
        let filtered = logs;
        if (action) {
            filtered = filtered.filter(log => log.action.includes(action.toUpperCase()));
        }
        if (portal) {
            filtered = filtered.filter(log => log.portalType === portal.toLowerCase());
        }
        if (userEmail) {
            filtered = filtered.filter(log => log.userEmail.toLowerCase().includes(userEmail.toLowerCase()));
        }
        if (startDate) {
            const start = new Date(startDate);
            filtered = filtered.filter(log => new Date(log.timestamp) >= start);
        }
        if (endDate) {
            const end = new Date(endDate);
            filtered = filtered.filter(log => new Date(log.timestamp) <= end);
        }
        
        // Sort by timestamp descending (newest first)
        filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        // Pagination
        const totalItems = filtered.length;
        const totalPages = Math.ceil(totalItems / limit);
        const start = (page - 1) * limit;
        const paginated = filtered.slice(start, start + limit);
        
        res.json({
            success: true,
            logs: paginated,
            pagination: {
                page,
                limit,
                totalItems,
                totalPages
            }
        });
    } catch (error) {
        console.error('Error fetching activity logs:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get activity log summary (stats)
app.get('/api/activity-logs-summary', requireAuth('it'), (req, res) => {
    try {
        let logs = [];
        if (fs.existsSync(activityLogsFile)) {
            try {
                const content = fs.readFileSync(activityLogsFile, 'utf-8');
                logs = JSON.parse(content);
                if (!Array.isArray(logs)) logs = [];
            } catch (e) {
                logs = [];
            }
        }
        
        // Calculate statistics
        const stats = {
            totalActivities: logs.length,
            activitiesByAction: {},
            activitiesByPortal: {},
            activitiesByIp: {},
            recentActivities: logs.slice(-10),
            last24Hours: logs.filter(log => {
                const logTime = new Date(log.timestamp);
                const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
                return logTime >= oneDayAgo;
            }).length,
            uniqueUsers: new Set(logs.map(log => log.userEmail)).size,
            uniqueIps: new Set(logs.map(log => log.ip)).size
        };
        
        // Group by action
        logs.forEach(log => {
            if (!stats.activitiesByAction[log.action]) {
                stats.activitiesByAction[log.action] = 0;
            }
            stats.activitiesByAction[log.action]++;
        });
        
        // Group by portal
        logs.forEach(log => {
            if (!stats.activitiesByPortal[log.portalType]) {
                stats.activitiesByPortal[log.portalType] = 0;
            }
            stats.activitiesByPortal[log.portalType]++;
        });
        
        // Group by IP
        logs.forEach(log => {
            if (!stats.activitiesByIp[log.ip]) {
                stats.activitiesByIp[log.ip] = 0;
            }
            stats.activitiesByIp[log.ip]++;
        });
        
        res.json({ success: true, stats });
    } catch (error) {
        console.error('Error fetching activity logs summary:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Export activity logs as CSV
app.get('/api/export-activity-logs', requireAuth('it'), (req, res) => {
    try {
        let logs = [];
        if (fs.existsSync(activityLogsFile)) {
            try {
                const content = fs.readFileSync(activityLogsFile, 'utf-8');
                logs = JSON.parse(content);
                if (!Array.isArray(logs)) logs = [];
            } catch (e) {
                logs = [];
            }
        }
        
        // Convert to CSV
        const headers = ['ID', 'Timestamp', 'Action', 'Portal', 'User Email', 'User ID', 'IP Address', 'User Agent', 'Details'];
        const csvContent = [
            headers.join(','),
            ...logs.map(log => [
                log.id,
                log.timestamp,
                log.action,
                log.portalType,
                log.userEmail,
                log.userId || '',
                log.ip,
                (log.userAgent || '').replace(/,/g, ';'),
                JSON.stringify(log.details).replace(/,/g, ';')
            ].map(field => `"${String(field || '').replace(/"/g, '""')}"` ).join(','))
        ].join('\n');
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="activity-logs.csv"');
        res.send(csvContent);
    } catch (error) {
        console.error('Error exporting activity logs:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== DATA BACKUP & RESTORE SYSTEM ==========
// Prevents data loss during redeployments

const backupDir = path.join(dataDir, 'backups');
if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
}

// List of all data files to backup/restore
const DATA_FILES = [
    'users.json', 'employees.json', 'applications.json', 'leavecards.json',
    'ao-users.json', 'hr-users.json', 'asds-users.json', 'sds-users.json',
    'it-users.json', 'pending-registrations.json',
    'cto-records.json', 'schools.json', 'initial-credits.json',
    'activity-logs.json', 'applications.backup.json'
];

// POST /api/data/backup - Create a timestamped backup of all data
app.post('/api/data/backup', requireAuth('it'), (req, res) => {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFolder = path.join(backupDir, `backup-${timestamp}`);
        fs.mkdirSync(backupFolder, { recursive: true });

        const backedUp = [];
        for (const file of DATA_FILES) {
            const src = path.join(dataDir, file);
            if (fs.existsSync(src)) {
                fs.copyFileSync(src, path.join(backupFolder, file));
                backedUp.push(file);
            }
        }

        logActivity('data_backup', 'it', {
            userEmail: req.session.email,
            userId: req.session.userId,
            ip: getClientIp(req),
            details: { backupFolder: `backup-${timestamp}`, filesCount: backedUp.length }
        });

        res.json({
            success: true,
            message: `Backup created successfully with ${backedUp.length} files`,
            backupId: `backup-${timestamp}`,
            files: backedUp
        });
    } catch (error) {
        console.error('Backup error:', error);
        res.status(500).json({ success: false, error: 'Failed to create backup: ' + error.message });
    }
});

// GET /api/data/backups - List available backups
app.get('/api/data/backups', requireAuth('it'), (req, res) => {
    try {
        if (!fs.existsSync(backupDir)) {
            return res.json({ success: true, backups: [] });
        }
        const backups = fs.readdirSync(backupDir)
            .filter(f => f.startsWith('backup-'))
            .map(name => {
                const backupPath = path.join(backupDir, name);
                const stat = fs.statSync(backupPath);
                const files = fs.readdirSync(backupPath);
                return { id: name, createdAt: stat.mtime.toISOString(), filesCount: files.length, files };
            })
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

        res.json({ success: true, backups });
    } catch (error) {
        console.error('List backups error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});


// DELETE /api/data/backup/:backupId - Delete a specific backup
app.delete('/api/data/backup/:backupId', requireAuth('it'), (req, res) => {
    try {
        const { backupId } = req.params;
        const validPrefixes = ['backup-', 'auto-startup-', 'pre-restore-', 'pre-import-'];
        if (!validPrefixes.some(p => backupId.startsWith(p))) {
            return res.status(400).json({ success: false, error: 'Invalid backup ID format' });
        }
        // SECURITY: Sanitize backupId to prevent path traversal
        const safeName = path.basename(backupId);
        if (safeName !== backupId || /[\/\\]/.test(backupId)) {
            return res.status(400).json({ success: false, error: 'Invalid backup ID' });
        }
        const backupPath = path.join(backupDir, safeName);
        if (!fs.existsSync(backupPath)) {
            return res.status(404).json({ success: false, error: 'Backup not found' });
        }
        fs.rmSync(backupPath, { recursive: true, force: true });
        logActivity('data_backup_delete', 'it', {
            userEmail: req.session.email,
            userId: req.session.userId,
            ip: getClientIp(req),
            details: { backupId, deletedAt: new Date().toISOString() }
        });
        res.json({ success: true, message: 'Backup deleted successfully' });
    } catch (error) {
        console.error('Delete backup error:', error);
        res.status(500).json({ success: false, error: 'Failed to delete backup: ' + error.message });
    }
});
// POST /api/data/restore - Restore data from a specific backup
app.post('/api/data/restore', requireAuth('it'), (req, res) => {
    try {
        const { backupId } = req.body;
        if (!backupId) {
            return res.status(400).json({ success: false, error: 'backupId is required' });
        }

        // Prevent path traversal
        const safeName = path.basename(backupId);
        const backupFolder = path.join(backupDir, safeName);
        if (!fs.existsSync(backupFolder)) {
            return res.status(404).json({ success: false, error: 'Backup not found' });
        }

        // Create a pre-restore backup first (safety net)
        const preRestoreTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const preRestoreFolder = path.join(backupDir, `pre-restore-${preRestoreTimestamp}`);
        fs.mkdirSync(preRestoreFolder, { recursive: true });
        for (const file of DATA_FILES) {
            const src = path.join(dataDir, file);
            if (fs.existsSync(src)) {
                fs.copyFileSync(src, path.join(preRestoreFolder, file));
            }
        }

        // Restore files from backup
        const restored = [];
        const backupFiles = fs.readdirSync(backupFolder);
        for (const file of backupFiles) {
            if (file.endsWith('.json')) {
                fs.copyFileSync(path.join(backupFolder, file), path.join(dataDir, file));
                restored.push(file);
            }
        }

        logActivity('data_restore', 'it', {
            userEmail: req.session.email,
            userId: req.session.userId,
            ip: getClientIp(req),
            details: { backupId: safeName, filesRestored: restored.length }
        });

        res.json({
            success: true,
            message: `Restored ${restored.length} files from ${safeName}`,
            preRestoreBackup: `pre-restore-${preRestoreTimestamp}`,
            files: restored
        });
    } catch (error) {
        console.error('Restore error:', error);
        res.status(500).json({ success: false, error: 'Failed to restore: ' + error.message });
    }
});

// GET /api/data/export - Download all data as a single JSON bundle
app.get('/api/data/export', requireAuth('it'), (req, res) => {
    try {
        const bundle = {};
        // Files that contain user authentication data (passwords must be stripped)
        const sensitiveFiles = ['users.json', 'ao-users.json', 'hr-users.json', 'asds-users.json', 'sds-users.json', 'it-users.json'];
        for (const file of DATA_FILES) {
            const filePath = path.join(dataDir, file);
            if (fs.existsSync(filePath)) {
                let data = readJSON(filePath);
                // SECURITY: Strip password hashes from exported user data
                if (sensitiveFiles.includes(file) && Array.isArray(data)) {
                    data = data.map(record => {
                        const { password, ...safe } = record;
                        return safe;
                    });
                }
                bundle[file] = data;
            }
        }
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="data-export-${timestamp}.json"`);
        res.json({ exportDate: new Date().toISOString(), data: bundle });
    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/data/import - Import data from a previously exported JSON bundle
app.post('/api/data/import', requireAuth('it'), (req, res) => {
    try {
        const { data } = req.body;
        if (!data || typeof data !== 'object') {
            return res.status(400).json({ success: false, error: 'Invalid import data. Expected { data: { "filename.json": [...], ... } }' });
        }

        // Create safety backup before import
        const safetyTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const safetyFolder = path.join(backupDir, `pre-import-${safetyTimestamp}`);
        fs.mkdirSync(safetyFolder, { recursive: true });
        for (const file of DATA_FILES) {
            const src = path.join(dataDir, file);
            if (fs.existsSync(src)) {
                fs.copyFileSync(src, path.join(safetyFolder, file));
            }
        }

        const imported = [];
        for (const [filename, content] of Object.entries(data)) {
            // Only allow known data files (prevent writing to arbitrary paths)
            if (DATA_FILES.includes(filename)) {
                writeJSON(path.join(dataDir, filename), content);
                imported.push(filename);
            }
        }

        logActivity('data_import', 'it', {
            userEmail: req.session.email,
            userId: req.session.userId,
            ip: getClientIp(req),
            details: { filesImported: imported.length, safetyBackup: `pre-import-${safetyTimestamp}` }
        });

        res.json({
            success: true,
            message: `Imported ${imported.length} data files`,
            safetyBackup: `pre-import-${safetyTimestamp}`,
            files: imported
        });
    } catch (error) {
        console.error('Import error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== EXCEL LEAVE CARD MIGRATION ==========
// Multer config: store uploaded files in memory (max 10MB per file, max 200 files)
const migrationUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 500 },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (['.xlsx', '.xls'].includes(ext)) cb(null, true);
        else cb(new Error('Only .xlsx and .xls files are allowed'));
    }
});

/**
 * Extract VL/SL balance from a single Excel leave card buffer.
 * Mirrors the logic from scripts/extract_initial_credits.js.
 *
 * Excel leave-card layout (DepEd standard):
 *  - Filename = "LASTNAME, FIRSTNAME.xlsx"
 *  - First sheet = the leave card
 *  - Row 7, Col 9 (0-indexed: [6][8]) = employee number
 *  - Data rows contain periodic entries; the LAST row with numeric
 *    values in columns 8 & 9 (0-indexed 7 & 8) = latest VL & SL balance.
 *  - Teaching personnel may use VSC format where a single balance is
 *    in column 8 (index 7).
 */
function extractCreditsFromBuffer(buffer, fileName) {
    try {
        const wb = xlsx.read(buffer, { type: 'buffer' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = xlsx.utils.sheet_to_json(ws, { header: 1 });

        const baseName = path.basename(fileName, path.extname(fileName));

        let vacationBalance = null;
        let sickBalance = null;
        let lastDataRow = null;

        // Scan bottom-up for last row with numeric VL & SL in columns 7,8
        for (let i = data.length - 1; i >= 0; i--) {
            const row = data[i];
            if (row && row.length >= 9) {
                const vac = row[7];
                const sick = row[8];
                if (typeof vac === 'number' && typeof sick === 'number') {
                    vacationBalance = vac;
                    sickBalance = sick;
                    lastDataRow = i;
                    break;
                }
            }
        }

        // Fallback: check for VSC (teaching) format
        if (lastDataRow === null) {
            let isVSC = false;
            for (let i = 0; i < Math.min(20, data.length); i++) {
                if (data[i] && data[i][0] && String(data[i][0]).toUpperCase().includes('VSC')) {
                    isVSC = true;
                    break;
                }
            }
            if (isVSC) {
                for (let i = data.length - 1; i >= 0; i--) {
                    const row = data[i];
                    if (row && row.length >= 8 && typeof row[7] === 'number') {
                        vacationBalance = row[7];
                        sickBalance = row[7];
                        lastDataRow = i;
                        break;
                    }
                }
            }
        }

        if (lastDataRow === null) return null;

        let empNo = '';
        if (data[6] && data[6][8]) empNo = String(data[6][8]);

        // Try to extract transaction rows (periodCovered, earned, spent, balance)
        // Data rows typically start around row 12 (index 11) and go until lastDataRow
        const transactions = [];
        const headerRowIdx = findHeaderRow(data);
        const startRow = headerRowIdx !== null ? headerRowIdx + 1 : 11;

        for (let i = startRow; i <= lastDataRow; i++) {
            const row = data[i];
            if (!row || row.length < 9) continue;

            const period = row[0] ? String(row[0]).trim() : '';
            const vlEarned = typeof row[1] === 'number' ? row[1] : (typeof row[2] === 'number' ? row[2] : 0);
            const slEarned = typeof row[3] === 'number' ? row[3] : (typeof row[4] === 'number' ? row[4] : 0);
            const vlSpent = typeof row[3] === 'number' && typeof row[1] === 'number' ? row[3] : 0;
            const slSpent = typeof row[5] === 'number' ? row[5] : 0;
            const vlBal = typeof row[7] === 'number' ? row[7] : null;
            const slBal = typeof row[8] === 'number' ? row[8] : null;

            if (period || vlBal !== null || slBal !== null) {
                transactions.push({
                    type: 'ADD',
                    periodCovered: period || `Row ${i + 1}`,
                    vlEarned: +(vlEarned || 0).toFixed ? parseFloat((vlEarned || 0).toFixed(3)) : 0,
                    slEarned: +(slEarned || 0).toFixed ? parseFloat((slEarned || 0).toFixed(3)) : 0,
                    vlSpent: parseFloat((vlSpent || 0).toFixed ? (vlSpent || 0).toFixed(3) : '0'),
                    slSpent: parseFloat((slSpent || 0).toFixed ? (slSpent || 0).toFixed(3) : '0'),
                    forcedLeave: 0,
                    splUsed: 0,
                    vlBalance: vlBal !== null ? parseFloat(vlBal.toFixed(3)) : null,
                    slBalance: slBal !== null ? parseFloat(slBal.toFixed(3)) : null,
                    total: vlBal !== null && slBal !== null ? parseFloat((vlBal + slBal).toFixed(3)) : null,
                    source: 'excel-migration',
                    date: new Date().toISOString()
                });
            }
        }

        return {
            name: baseName,
            employeeNo: empNo,
            vacationLeave: Math.round(vacationBalance * 1000) / 1000,
            sickLeave: Math.round(sickBalance * 1000) / 1000,
            transactions
        };
    } catch (err) {
        console.error(`  Error parsing ${fileName}: ${err.message}`);
        return null;
    }
}

function findHeaderRow(data) {
    for (let i = 0; i < Math.min(20, data.length); i++) {
        const row = data[i];
        if (!row) continue;
        const joined = row.map(c => String(c || '').toUpperCase()).join(' ');
        if (joined.includes('PERIOD') && (joined.includes('EARNED') || joined.includes('BALANCE'))) {
            return i;
        }
    }
    return null;
}

/**
 * POST /api/migrate-leave-cards
 * Accepts multipart upload of Excel leave-card files.
 * Each file becomes a leave card entry in leavecards.json.
 *
 * Query params:
 *   mode=preview  — parse & return results without writing (dry run)
 *   mode=import   — parse & write to leavecards.json
 *   overwrite=true — if a card with same name already exists, overwrite it
 */
app.post('/api/migrate-leave-cards', requireAuth('it'), (req, res, next) => {
    migrationUpload.array('files', 500)(req, res, (err) => {
        if (err) {
            if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
                return res.status(400).json({ success: false, error: `Too many files. Maximum is 500 per upload. You sent ${req.headers['x-file-count'] || 'more than 500'}.` });
            }
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ success: false, error: 'One or more files exceed the 10MB size limit.' });
            }
            return res.status(400).json({ success: false, error: err.message || 'File upload error' });
        }
        next();
    });
}, (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, error: 'No Excel files uploaded' });
        }

        const mode = req.query.mode || 'preview';
        const allowOverwrite = req.query.overwrite === 'true';
        const results = [];
        const errors = [];

        for (const file of req.files) {
            // Multer decodes filenames as latin1; re-decode as UTF-8 to handle Ñ, accents, etc.
            const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
            const extracted = extractCreditsFromBuffer(file.buffer, originalName);
            if (extracted) {
                results.push(extracted);
            } else {
                errors.push({ file: originalName, error: 'Could not parse VL/SL balance from file' });
            }
        }

        if (mode === 'preview') {
            return res.json({
                success: true,
                mode: 'preview',
                message: `Parsed ${results.length} leave cards from ${req.files.length} files`,
                parsed: results,
                errors,
                totalFiles: req.files.length,
                successCount: results.length,
                errorCount: errors.length
            });
        }

        // Import mode — write to leavecards.json
        // Create safety backup first
        const safetyTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const safetyFolder = path.join(backupDir, `pre-migration-${safetyTimestamp}`);
        fs.mkdirSync(safetyFolder, { recursive: true });
        if (fs.existsSync(leavecardsFile)) {
            fs.copyFileSync(leavecardsFile, path.join(safetyFolder, 'leavecards.json'));
        }

        let leavecards = readJSON(leavecardsFile);
        let created = 0, updated = 0, skipped = 0;
        const importDetails = [];

        for (const entry of results) {
            const normalizedName = entry.name.toUpperCase().replace(/\s+/g, ' ').trim();

            // Check if a card with this name already exists
            const existingIdx = leavecards.findIndex(lc => {
                const lcName = (lc.name || '').toUpperCase().replace(/\s+/g, ' ').trim();
                return lcName === normalizedName;
            });

            if (existingIdx !== -1 && !allowOverwrite) {
                skipped++;
                importDetails.push({ name: entry.name, action: 'skipped', reason: 'Already exists (use overwrite to replace)' });
                continue;
            }

            // Parse name into parts
            const nameParts = parseFullNameIntoParts(entry.name);

            const newCard = {
                employeeId: '', // Will be linked when employee registers
                email: '',
                name: entry.name,
                firstName: nameParts.firstName || '',
                lastName: nameParts.lastName || '',
                middleName: nameParts.middleName || '',
                suffix: nameParts.suffix || '',
                employeeNo: entry.employeeNo || '',
                vacationLeaveEarned: entry.vacationLeave,
                sickLeaveEarned: entry.sickLeave,
                forceLeaveEarned: 5,
                splEarned: 3,
                vacationLeaveSpent: 0,
                sickLeaveSpent: 0,
                forceLeaveSpent: 0,
                splSpent: 0,
                vl: entry.vacationLeave,
                sl: entry.sickLeave,
                spl: 3,
                others: 0,
                forceLeaveYear: new Date().getFullYear(),
                splYear: new Date().getFullYear(),
                leaveUsageHistory: [],
                transactions: entry.transactions || [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                initialCreditsSource: 'excel-migration'
            };

            if (existingIdx !== -1) {
                // Overwrite existing
                const existing = leavecards[existingIdx];
                newCard.employeeId = existing.employeeId || '';
                newCard.email = existing.email || '';
                leavecards[existingIdx] = newCard;
                updated++;
                importDetails.push({ name: entry.name, action: 'updated', vl: entry.vacationLeave, sl: entry.sickLeave });
            } else {
                leavecards.push(newCard);
                created++;
                importDetails.push({ name: entry.name, action: 'created', vl: entry.vacationLeave, sl: entry.sickLeave });
            }
        }

        writeJSON(leavecardsFile, leavecards);

        logActivity('EXCEL_MIGRATION', 'it', {
            userEmail: req.session.email,
            userId: req.session.userId,
            ip: getClientIp(req),
            details: { totalFiles: req.files.length, created, updated, skipped, errors: errors.length }
        });

        console.log(`[MIGRATION] Excel leave card import complete: ${created} created, ${updated} updated, ${skipped} skipped, ${errors.length} errors`);

        res.json({
            success: true,
            mode: 'import',
            message: `Migration complete: ${created} created, ${updated} updated, ${skipped} skipped`,
            safetyBackup: `pre-migration-${safetyTimestamp}`,
            created,
            updated,
            skipped,
            errors,
            details: importDetails,
            totalCards: leavecards.length
        });
    } catch (error) {
        console.error('[MIGRATION] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/migrate-leave-card-json
 * Manual JSON migration for when you have pre-processed data (e.g., from a spreadsheet
 * you've manually read). Accepts an array of { name, vacationLeave, sickLeave, employeeNo }.
 */
app.post('/api/migrate-leave-card-json', requireAuth('it'), (req, res) => {
    try {
        const { records, overwrite } = req.body;
        if (!Array.isArray(records) || records.length === 0) {
            return res.status(400).json({ success: false, error: 'Expected { records: [{ name, vacationLeave, sickLeave }] }' });
        }

        // Safety backup
        const safetyTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const safetyFolder = path.join(backupDir, `pre-json-migration-${safetyTimestamp}`);
        fs.mkdirSync(safetyFolder, { recursive: true });
        if (fs.existsSync(leavecardsFile)) {
            fs.copyFileSync(leavecardsFile, path.join(safetyFolder, 'leavecards.json'));
        }

        let leavecards = readJSON(leavecardsFile);
        let created = 0, updated = 0, skipped = 0;
        const details = [];

        for (const rec of records) {
            if (!rec.name) {
                details.push({ name: '(empty)', action: 'skipped', reason: 'No name provided' });
                skipped++;
                continue;
            }

            const normalizedName = rec.name.toUpperCase().replace(/\s+/g, ' ').trim();
            const existingIdx = leavecards.findIndex(lc => {
                const lcName = (lc.name || '').toUpperCase().replace(/\s+/g, ' ').trim();
                return lcName === normalizedName;
            });

            if (existingIdx !== -1 && !overwrite) {
                skipped++;
                details.push({ name: rec.name, action: 'skipped', reason: 'Already exists' });
                continue;
            }

            const nameParts = parseFullNameIntoParts(rec.name);
            const vlCredits = parseFloat(rec.vacationLeave) || 0;
            const slCredits = parseFloat(rec.sickLeave) || 0;

            const newCard = {
                employeeId: rec.email || '',
                email: rec.email || '',
                name: rec.name,
                firstName: nameParts.firstName || '',
                lastName: nameParts.lastName || '',
                middleName: nameParts.middleName || '',
                suffix: nameParts.suffix || '',
                employeeNo: rec.employeeNo || '',
                vacationLeaveEarned: vlCredits,
                sickLeaveEarned: slCredits,
                forceLeaveEarned: 5,
                splEarned: 3,
                vacationLeaveSpent: 0,
                sickLeaveSpent: 0,
                forceLeaveSpent: 0,
                splSpent: 0,
                vl: vlCredits,
                sl: slCredits,
                spl: 3,
                others: 0,
                forceLeaveYear: new Date().getFullYear(),
                splYear: new Date().getFullYear(),
                leaveUsageHistory: [],
                transactions: [{
                    type: 'ADD',
                    periodCovered: 'Initial Balance (Manual Migration)',
                    vlEarned: vlCredits,
                    slEarned: slCredits,
                    vlSpent: 0,
                    slSpent: 0,
                    forcedLeave: 0,
                    splUsed: 0,
                    vlBalance: vlCredits,
                    slBalance: slCredits,
                    total: +(vlCredits + slCredits).toFixed(3),
                    source: 'manual-migration',
                    date: new Date().toISOString()
                }],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                initialCreditsSource: 'manual-migration'
            };

            if (existingIdx !== -1) {
                const existing = leavecards[existingIdx];
                newCard.employeeId = existing.employeeId || newCard.employeeId;
                newCard.email = existing.email || newCard.email;
                leavecards[existingIdx] = newCard;
                updated++;
                details.push({ name: rec.name, action: 'updated', vl: vlCredits, sl: slCredits });
            } else {
                leavecards.push(newCard);
                created++;
                details.push({ name: rec.name, action: 'created', vl: vlCredits, sl: slCredits });
            }
        }

        writeJSON(leavecardsFile, leavecards);

        logActivity('MANUAL_MIGRATION', 'it', {
            userEmail: req.session.email,
            userId: req.session.userId,
            ip: getClientIp(req),
            details: { totalRecords: records.length, created, updated, skipped }
        });

        res.json({
            success: true,
            message: `Migration complete: ${created} created, ${updated} updated, ${skipped} skipped`,
            safetyBackup: `pre-json-migration-${safetyTimestamp}`,
            created, updated, skipped, details,
            totalCards: leavecards.length
        });
    } catch (error) {
        console.error('[JSON MIGRATION] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== AUTO-BACKUP ON SERVER START ==========
// Automatically create a backup when the server starts (protects against redeployment data loss)
(function autoBackupOnStart() {
    try {
        // Check if any data files exist with actual data
        const hasData = DATA_FILES.some(file => {
            const filePath = path.join(dataDir, file);
            if (!fs.existsSync(filePath)) return false;
            try {
                const content = fs.readFileSync(filePath, 'utf8').trim();
                const parsed = JSON.parse(content);
                return Array.isArray(parsed) ? parsed.length > 0 : Object.keys(parsed).length > 0;
            } catch { return false; }
        });

        if (hasData) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const autoBackupFolder = path.join(backupDir, `auto-startup-${timestamp}`);
            fs.mkdirSync(autoBackupFolder, { recursive: true });

            let count = 0;
            for (const file of DATA_FILES) {
                const src = path.join(dataDir, file);
                if (fs.existsSync(src)) {
                    fs.copyFileSync(src, path.join(autoBackupFolder, file));
                    count++;
                }
            }
            console.log(`[STARTUP] Auto-backup created: ${autoBackupFolder} (${count} files)`);

            // Keep only last 5 auto-startup backups to save disk space
            const autoBackups = fs.readdirSync(backupDir)
                .filter(f => f.startsWith('auto-startup-'))
                .sort()
                .reverse();
            if (autoBackups.length > 5) {
                for (const old of autoBackups.slice(5)) {
                    const oldPath = path.join(backupDir, old);
                    fs.rmSync(oldPath, { recursive: true, force: true });
                }
                console.log(`[STARTUP] Cleaned up ${autoBackups.length - 5} old auto-backups`);
            }
        }
    } catch (err) {
        console.error('[STARTUP] Auto-backup failed:', err.message);
    }
})();

// ========== ERROR HANDLERS (Must be last before server start) ==========
// Diagnostic endpoint to check data persistence status
app.get('/api/system-status', requireAuth('it'), (req, res) => {
    try {
        const itUsers = readJSON(itUsersFile);
        const users = readJSON(usersFile);
        const aoUsers = readJSON(aoUsersFile);
        const hrUsers = readJSON(hrUsersFile);
        const leavecards = readJSON(leavecardsFile);
        const ctoRecords = readJSON(path.join(dataDir, 'cto-records.json'));
        res.json({
            success: true,
            volumeMounted: !!process.env.RAILWAY_VOLUME_MOUNT_PATH,
            volumePath: process.env.RAILWAY_VOLUME_MOUNT_PATH || 'NOT SET',
            dataDir: dataDir,
            dataDirExists: fs.existsSync(dataDir),
            fileCounts: {
                itUsers: itUsers.length,
                users: users.length,
                aoUsers: aoUsers.length,
                hrUsers: hrUsers.length,
                leavecards: leavecards.length,
                ctoRecords: ctoRecords.length
            },
            itUserEmails: itUsers.map(u => u.email),
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// One-time data upload endpoint (protected by secret key)
app.post('/api/data/seed', requireAuth('it'), express.json({limit: '50mb'}), (req, res) => {
    try {
        const { secretKey, dataType, data } = req.body;
        
        // SECURITY: Require both IT auth AND secret key. No default fallback.
        const SEED_KEY = process.env.DATA_SEED_KEY;
        if (!SEED_KEY) {
            return res.status(503).json({ success: false, error: 'Data seeding is disabled. Set DATA_SEED_KEY environment variable to enable.' });
        }
        // Use timing-safe comparison to prevent timing attacks
        const keyBuffer = Buffer.from(secretKey || '');
        const seedBuffer = Buffer.from(SEED_KEY);
        if (keyBuffer.length !== seedBuffer.length || !crypto.timingSafeEqual(keyBuffer, seedBuffer)) {
            return res.status(403).json({ success: false, error: 'Invalid secret key' });
        }
        
        const fileMap = {
            'users': usersFile,
            'leavecards': leavecardsFile,
            'cto-records': path.join(dataDir, 'cto-records.json'),
            'employees': path.join(dataDir, 'employees.json')
        };
        
        const targetFile = fileMap[dataType];
        if (!targetFile) {
            return res.status(400).json({ success: false, error: 'Invalid dataType. Use: ' + Object.keys(fileMap).join(', ') });
        }
        
        writeJSON(targetFile, data);
        console.log(`[SEED] Wrote ${Array.isArray(data) ? data.length : 'N/A'} records to ${dataType}`);
        
        res.json({ 
            success: true, 
            message: `Seeded ${dataType} with ${Array.isArray(data) ? data.length : 'N/A'} records` 
        });
    } catch (error) {
        console.error('Seed error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Only catch API routes - let static files pass through
app.use('/api/*', (req, res) => {
    res.status(404).json({ success: false, error: 'API endpoint not found' });
});

// General error handler
app.use((err, req, res, next) => {
    console.error('Express error handler caught:', err.message || err);
    res.status(500).json({ success: false, error: 'Internal Server Error. Please try again later.' });
});

// ========== START SERVER ==========
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('==========================================================');
    console.log('     CS Form No. 6 - Application for Leave Server');
    console.log('==========================================================');
    console.log('  Server running at: http://localhost:' + PORT);
    console.log('  Login Page: http://localhost:' + PORT);
    console.log('  Database: http://localhost:' + PORT + '/database');
    console.log('  PID: ' + process.pid);
    console.log('  Data Dir: ' + dataDir);
    if (process.env.RAILWAY_VOLUME_MOUNT_PATH) {
        console.log('  Storage: âœ… Railway Volume (data persists across deploys)');
    } else {
        console.log('  Storage: âš ï¸  Local filesystem (data lost on redeploy!)');
    }
    console.log('==========================================================');
    console.log('');
    console.log('[STARTUP] Server started successfully at', new Date().toISOString());

    // One-time migration: Fix old applications that have commutation='not-requested' 
    // when user didn't actually select anything (old code always defaulted to 'not-requested')
    try {
        const appsPath = path.join(dataDir, 'applications.json');
        if (fs.existsSync(appsPath)) {
            let appsData = JSON.parse(fs.readFileSync(appsPath, 'utf8'));
            // Normalize: extract array if wrapped in {applications: [...]}
            let apps = Array.isArray(appsData) ? appsData : (appsData.applications || []);
            let fixedCount = 0;
            apps.forEach(app => {
                if (app.commutation === 'not-requested') {
                    app.commutation = '';
                    fixedCount++;
                }
            });
            // Always check if file needs format normalization (object â†’ array)
            const needsNormalize = !Array.isArray(appsData);
            if (fixedCount > 0 || needsNormalize) {
                writeJSON(appsPath, apps);
                if (fixedCount > 0) console.log(`[MIGRATION] Fixed commutation on ${fixedCount} old applications`);
                if (needsNormalize) console.log(`[MIGRATION] Normalized applications.json from object to array format`);
            }
        }
    } catch (migrationErr) {
        console.error('[MIGRATION] Error fixing commutation data:', migrationErr.message);
    }
});

server.on('error', (err) => {
    console.error('Server "error" event:', err.message || err);
});

server.on('clientError', (err, socket) => {
    console.error('Client error:', err);
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err.message || err);
    console.error(err.stack);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('UNHANDLED REJECTION at:', promise, 'reason:', reason);
});

// Keep the server running
server.setTimeout(0);

// Periodic heartbeat
setInterval(() => {
    console.log('âœ“ Server still running - ' + new Date().toISOString());
}, 60000);
