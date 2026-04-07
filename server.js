// CS Form No. 6 - Application for Leave Server
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const multer = require('multer');
const ExcelJS = require('exceljs');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');

const app = express();

// Trust first proxy (Railway, Render, etc.) so req.ip returns the real client IP
// Without this, rate limiting and activity logs use the proxy IP for ALL users
app.set('trust proxy', 1);

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const PRODUCTION_DOMAIN = process.env.PRODUCTION_DOMAIN || 'http://localhost:3000';

// Shared constant — used in accrual period labels (DRY: defined once, used everywhere)
const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

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

// Login rate limiter: 10 attempts per 15 minutes
const loginRateLimiter = createRateLimiter(10, 15 * 60 * 1000);

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
// isValidDate used in validateLeaveBalance() for date field validation

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

// HttpOnly cookie options for secure session management
const SESSION_COOKIE_OPTIONS = {
    httpOnly: true,
    secure: NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_DURATION_MS
};

// Extract session token from HttpOnly cookie
function extractToken(req) {
    if (req.cookies && req.cookies.session) {
        return req.cookies.session;
    }
    return null;
}

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
        mustChangePassword: user.mustChangePassword || false,
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

// Auth middleware - validates session token from HttpOnly cookie
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

// ========== AO SCHOOL-BASED ACCESS CONTROL ==========
// Division office AOs (CID, OSDS, SGOD, ASDS) can see ALL employees.
// School-level AOs can only see employees from their own school.
const DIVISION_OFFICES = ['CID', 'OSDS', 'SGOD', 'ASDS', 'ASDS - Assistant Schools Division Superintendent'];

function isAoDivisionLevel(aoOffice) {
    if (!aoOffice) return false;
    return DIVISION_OFFICES.some(d => aoOffice.toUpperCase().includes(d));
}

function isEmployeeInAoSchool(employeeOffice, aoOffice) {
    if (!aoOffice || !employeeOffice) return false;
    // Division-level AOs see everyone
    if (isAoDivisionLevel(aoOffice)) return true;
    // Exact match
    if (employeeOffice === aoOffice) return true;
    // Normalize for comparison (strip whitespace, case)
    const normAo = aoOffice.toUpperCase().replace(/\s+/g, ' ').trim();
    const normEmp = employeeOffice.toUpperCase().replace(/\s+/g, ' ').trim();
    return normAo === normEmp;
}

/**
 * Look up an employee's office from users or employees data.
 * Accepts optional pre-loaded arrays to avoid redundant disk reads
 * when called inside .filter() loops (CRITICAL perf fix — was O(N×2) disk reads).
 */
function getEmployeeOffice(email, usersCache, employeesCache) {
    if (!email) return null;
    const users = usersCache || readJSON(usersFile);
    const user = users.find(u => u.email === email);
    if (user && user.office) return user.office;
    const employees = employeesCache || readJSON(employeesFile);
    const emp = employees.find(e => e.email === email);
    if (emp && emp.office) return emp.office;
    return null;
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
const SESSION_SECRET_LEGACY = process.env.SESSION_SECRET || require('crypto').randomBytes(32).toString('hex');
app.use(cookieParser(SESSION_SECRET_LEGACY));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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
app.use('/deped%20logo.png', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
});

// Prevent caching of HTML, JS, CSS, and API responses — ensures clients always get fresh data
app.use((req, res, next) => {
    const p = req.path;
    if (p.startsWith('/api/') || p.endsWith('.html') || p.endsWith('.js') || p.endsWith('.css') || (!p.includes('.') && p !== '/')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
    next();
});
app.use(express.static('public', { index: false, etag: false, lastModified: false }));
app.use('/filled', express.static(path.join(__dirname, 'filled')));

// App version — used for cache-busting. Increment on every deploy.
const APP_VERSION = '2026.03.09.3';
app.get('/api/version', (req, res) => res.json({ version: APP_VERSION }));

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

// Upload directories (inside dataDir so they persist on Railway Volume)
const uploadsDir = path.join(dataDir, 'uploads');
const soPdfsDir = path.join(uploadsDir, 'so-pdfs');
const leaveFormPdfsDir = path.join(uploadsDir, 'leave-forms');

// Ensure data directory exists
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Ensure upload directories exist
[uploadsDir, soPdfsDir, leaveFormPdfsDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`[DATA] Created upload directory: ${dir}`);
    }
});

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
        
        // APPEND-ONLY: Write new entry by appending to array, then atomic-write
        // This preserves full audit trail integrity — entries are never modified/deleted
        logs.push(logEntry);
        if (logs.length > 10000) {
            // Archive old logs before trimming (keeps audit trail recoverable)
            const archivePath = activityLogsFile.replace('.json', `-archive-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
            try { writeJSON(archivePath, logs.slice(0, logs.length - 10000)); } catch (e) { /* best-effort archive */ }
            logs = logs.slice(-10000);
        }
        
        writeJSON(activityLogsFile, logs);
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
// Previously missing — these 5 files were only ensured lazily in handlers (D8/S19 fix)
ensureFile(ctoRecordsFile);
ensureFile(activityLogsFile);
ensureFile(schoolsFile, '{}'); // schools.json is object-shaped, not array
ensureFile(initialCreditsFile, '{}'); // expects {lookupMap:{}, credits:[]} shape, not []
ensureFile(systemStateFile, '{}'); // stores object {lastAccruedMonth:...}, NOT array

// Helper functions

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
    // CONCURRENCY NOTE: All route handlers that read→modify→write use synchronous
    // readFileSync/writeFileSync with no await between them. Since Node.js is single-threaded,
    // the entire read-modify-write cycle completes in one event loop tick, making it
    // inherently safe against concurrent HTTP requests (no race conditions).
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

// ========== SHARED HELPERS (DRY: extracted from repeated inline patterns) ==========

/** Admin role names — used for self-or-admin access checks throughout the API */
const ADMIN_ROLES = ['ao', 'hr', 'asds', 'sds', 'it'];

/** Portal-to-file mapping for approve-registration (DRY: config-driven portal routing) */
const PORTAL_TO_FILE = {
    employee: () => usersFile,
    ao: () => aoUsersFile,
    hr: () => hrUsersFile,
    asds: () => asdsUsersFile,
    sds: () => sdsUsersFile
};

/**
 * Category-to-file mapping for data management endpoints.
 * DRY: Defined once, used in /api/data-items/:category and /api/delete-specific-items.
 */
const CATEGORY_TO_FILE = {
    'employeeUsers': () => usersFile,
    'aoUsers': () => aoUsersFile,
    'hrUsers': () => hrUsersFile,
    'asdsUsers': () => asdsUsersFile,
    'sdsUsers': () => sdsUsersFile,
    'applications': () => applicationsFile,
    'leavecards': () => leavecardsFile,
    'pendingRegistrations': () => pendingRegistrationsFile,
    'schools': () => schoolsFile
};

/**
 * Resolve a category name to its data file path.
 * @param {string} category - Category key (e.g., 'employeeUsers')
 * @returns {string|null} File path, or null if invalid category
 */
function getCategoryFile(category) {
    const getter = CATEGORY_TO_FILE[category];
    return getter ? getter() : null;
}

/**
 * Find an application by ID, handling both string and numeric ID formats.
 * DRY: Replaces the triple-comparison pattern used in 4+ endpoints.
 * @param {Array} applications - Array of application objects
 * @param {string|number} idParam - The ID to search for
 * @returns {object|undefined} The matching application, or undefined
 */
function findApplicationById(applications, idParam) {
    return applications.find(a =>
        a.id === idParam || a.id === parseInt(idParam) || String(a.id) === String(idParam)
    );
}

/**
 * Find index of an application by ID.
 * @param {Array} applications - Array of application objects
 * @param {string|number} idParam - The ID to search for
 * @returns {number} Index, or -1 if not found
 */
function findApplicationIndexById(applications, idParam) {
    return applications.findIndex(a =>
        a.id === idParam || a.id === parseInt(idParam) || String(a.id) === String(idParam)
    );
}

/**
 * Look up a user's full name by email across all portal user files.
 * Falls back to the email itself if no match is found.
 * @param {string} email - The user's email address
 * @returns {string} The user's full name or the email if not found
 */
function lookupUserName(email) {
    if (!email) return 'Unknown';
    const portalFiles = [
        aoUsersFile, hrUsersFile, asdsUsersFile, sdsUsersFile, usersFile, itUsersFile
    ];
    for (const file of portalFiles) {
        const users = readJSON(file);
        const user = users.find(u => (u.email || '').toLowerCase() === email.toLowerCase());
        if (user && (user.fullName || user.name)) return user.fullName || user.name;
    }
    return email;
}

/**
 * Assert that the requesting user has access: either they own the resource or are an admin.
 * DRY: Replaces 10+ identical inline admin-role checks.
 * @param {object} req - Express request with req.session
 * @param {string} targetEmail - The email of the resource owner
 * @returns {boolean} true if access is allowed
 */
function isSelfOrAdmin(req, targetEmail) {
    return ADMIN_ROLES.includes(req.session.role) || req.session.email === targetEmail;
}

/**
 * Check AO school-based access for a specific employee.
 * DRY: Replaces 10+ identical inline AO-school guard blocks.
 * @param {object} req - Express request with req.session
 * @param {string} employeeEmail - The employee being accessed
 * @param {Array} [usersCache] - Optional pre-loaded users array
 * @param {Array} [employeesCache] - Optional pre-loaded employees array
 * @returns {boolean} true if access is allowed (division AO, or employee is in AO's school, or not AO role)
 */
function isAoAccessAllowed(req, employeeEmail, usersCache, employeesCache) {
    if (req.session.role !== 'ao') return true;
    if (!req.session.office) return true;
    if (isAoDivisionLevel(req.session.office)) return true;
    const empOffice = getEmployeeOffice(employeeEmail, usersCache, employeesCache);
    return isEmployeeInAoSchool(empOffice, req.session.office);
}

/**
 * Build the set of application IDs already reflected in a leave card's history.
 * DRY: This pattern was copy-pasted in submit-leave, resubmit-leave, and leave-credits.
 * @param {object} leaveCard - The employee's leave card object
 * @returns {Set<string>} Set of reflected application IDs
 */
function getReflectedAppIds(leaveCard) {
    const ids = new Set();
    if (leaveCard && leaveCard.leaveUsageHistory && Array.isArray(leaveCard.leaveUsageHistory)) {
        leaveCard.leaveUsageHistory.forEach(h => { if (h.applicationId) ids.add(h.applicationId); });
    }
    if (leaveCard && leaveCard.transactions && Array.isArray(leaveCard.transactions)) {
        leaveCard.transactions.forEach(t => { if (t.applicationId) ids.add(t.applicationId); });
    }
    return ids;
}

/**
 * Calculate effective VL/SL balance after deducting pending/approved applications.
 * DRY: Consolidates the balance calculation from submit-leave, resubmit-leave, and leave-credits.
 * @param {string} employeeEmail - Employee email
 * @param {object|null} leaveCard - The employee's leave card (or null)
 * @param {string|null} excludeAppId - Application ID to exclude (for resubmissions)
 * @returns {{ vlBalance: number, slBalance: number, forceSpent: number, splSpent: number, ctoBalance: number, hasCard: boolean }}
 */
function calculateEffectiveBalance(employeeEmail, leaveCard, excludeAppId) {
    const result = { vlBalance: 0, slBalance: 0, forceSpent: 0, splSpent: 0, ctoBalance: 0, hasCard: false };

    if (!leaveCard) return result;
    result.hasCard = true;

    // VL/SL from summary fields (single source of truth)
    let vl = (leaveCard.vl !== undefined) ? leaveCard.vl : null;
    let sl = (leaveCard.sl !== undefined) ? leaveCard.sl : null;
    // Fallback for legacy cards
    if (vl === null) vl = Math.max(0, (leaveCard.vacationLeaveEarned || 0) - (leaveCard.vacationLeaveSpent || 0));
    if (sl === null) sl = Math.max(0, (leaveCard.sickLeaveEarned || 0) - (leaveCard.sickLeaveSpent || 0));

    // FL / SPL are annual quotas — compute entirely from current-year applications.
    // Do NOT read leaveCard.forceLeaveSpent/splSpent: those fields can hold cumulative
    // multi-year totals (especially for Excel-imported cards) even when forceLeaveYear
    // is already stamped as the current year.
    const currentYearLocal = new Date().getFullYear();
    const allApps = readJSONArray(applicationsFile);
    const reflected = getReflectedAppIds(leaveCard);
    let forceThisYear = 0, splThisYear = 0;

    allApps.forEach(app => {
        if (excludeAppId && app.id === excludeAppId) return;
        if (app.employeeEmail !== employeeEmail && app.email !== employeeEmail) return;
        if (app.status !== 'pending' && app.status !== 'approved') return;
        const days = parseFloat(app.numDays) || 0;
        if (days <= 0) return;
        const type = (app.leaveType || '').toLowerCase();
        const appYear = new Date(app.dateOfFiling || app.createdAt || Date.now()).getFullYear();

        if (type.includes('vl') || type.includes('vacation')) {
            if (!reflected.has(app.id)) vl = Math.max(0, vl - days);
        } else if (type.includes('sl') || type.includes('sick')) {
            if (!reflected.has(app.id)) sl = Math.max(0, sl - days);
        } else if (type.includes('mfl') || type.includes('mandatory') || type.includes('forced')) {
            if (appYear === currentYearLocal) forceThisYear += days;
            if (!reflected.has(app.id)) vl = Math.max(0, vl - days);
        } else if (type.includes('spl') || type.includes('special')) {
            if (appYear === currentYearLocal) splThisYear += days;
        }
    });

    result.vlBalance = vl;
    result.slBalance = sl;
    result.forceSpent = forceThisYear;
    result.splSpent = splThisYear;

    return result;
}

/**
 * Calculate CTO balance after deducting pending/approved CTO applications.
 * @param {string} employeeEmail
 * @param {object|null} leaveCard - Optional, used for reflected IDs
 * @param {string|null} excludeAppId - Application ID to exclude
 * @returns {number} Effective CTO balance
 */
function calculateCtoBalance(employeeEmail, leaveCard, excludeAppId) {
    ensureFile(ctoRecordsFile);
    const ctoRecords = readJSON(ctoRecordsFile);
    const empRecords = ctoRecords.filter(r => r.employeeId === employeeEmail);
    let balance = 0;
    empRecords.forEach(rec => { balance += (parseFloat(rec.daysGranted) || 0) - (parseFloat(rec.daysUsed) || 0); });
    balance = Math.max(0, balance);

    // Build reflected IDs from both CTO records and leave card
    const reflectedIds = new Set();
    empRecords.forEach(rec => {
        if (rec.applicationIds && Array.isArray(rec.applicationIds)) {
            rec.applicationIds.forEach(id => reflectedIds.add(id));
        }
    });
    if (leaveCard) {
        const lcIds = getReflectedAppIds(leaveCard);
        lcIds.forEach(id => reflectedIds.add(id));
    }

    const allApps = readJSONArray(applicationsFile);
    allApps.forEach(app => {
        if (excludeAppId && app.id === excludeAppId) return;
        if (reflectedIds.has(app.id)) return;
        if (app.employeeEmail !== employeeEmail && app.email !== employeeEmail) return;
        if (app.status !== 'pending' && app.status !== 'approved') return;
        const type = (app.leaveType || '').toLowerCase();
        if (type.includes('others') || type.includes('cto')) {
            balance = Math.max(0, balance - (parseFloat(app.numDays) || 0));
        }
    });

    return balance;
}

/**
 * Get the latest leave card record for an employee (by updatedAt/createdAt).
 * DRY: Replaces 2+ identical "find latest" loops.
 * @param {Array} records - Array of leave card records
 * @returns {object} The most recently updated record
 */
function getLatestLeaveCard(records) {
    if (!records || records.length === 0) return null;
    let latest = records[0];
    records.forEach(record => {
        const latestTime = new Date(latest.updatedAt || latest.createdAt || 0).getTime();
        const currentTime = new Date(record.updatedAt || record.createdAt || 0).getTime();
        if (currentTime > latestTime) latest = record;
    });
    return latest;
}

/**
 * Create a default leave card object for a new employee.
 * DRY: Replaces 4+ identical ~25-field object literals.
 * @param {string} email
 * @param {string} name
 * @param {object} [nameFields] - Optional { firstName, lastName, middleName, suffix }
 * @param {number} [vlCredits=0] - Initial VL credits
 * @param {number} [slCredits=0] - Initial SL credits
 * @returns {object} Leave card object
 */
function createDefaultLeaveCard(email, name, nameFields, vlCredits, slCredits) {
    const vl = vlCredits || 0;
    const sl = slCredits || 0;
    return {
        employeeId: email,
        email: email,
        name: name,
        firstName: (nameFields && nameFields.firstName) || '',
        lastName: (nameFields && nameFields.lastName) || '',
        middleName: (nameFields && nameFields.middleName) || '',
        suffix: (nameFields && nameFields.suffix) || '',
        vacationLeaveEarned: vl,
        sickLeaveEarned: sl,
        forceLeaveEarned: 5,
        splEarned: 3,
        wellnessEarned: 5,
        vacationLeaveSpent: 0,
        sickLeaveSpent: 0,
        forceLeaveSpent: 0,
        splSpent: 0,
        wellnessSpent: 0,
        vl: vl,
        sl: sl,
        spl: 3,
        others: 0,
        forceLeaveYear: new Date().getFullYear(),
        splYear: new Date().getFullYear(),
        wellnessYear: new Date().getFullYear(),
        leaveUsageHistory: [],
        transactions: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        initialCreditsSource: 'accrual'
    };
}

/**
 * Create a monthly accrual transaction entry.
 * DRY: Replaces 4+ identical transaction object literals in catchUpNewCards,
 * runMonthlyAccrual, approve-registration, and JSON migration.
 * @param {number} month - Month number (1-12)
 * @param {number} year
 * @param {number} runningVL - Running VL balance after this accrual
 * @param {number} runningSL - Running SL balance after this accrual
 * @param {string} source - e.g., 'system-accrual', 'system-accrual-catchup'
 * @param {number} [accrual=1.25] - Monthly accrual amount
 * @returns {object} Transaction entry
 */
function createAccrualTransaction(month, year, runningVL, runningSL, source, accrual) {
    const amt = accrual || 1.25;
    return {
        id: crypto.randomUUID(),
        type: 'ADD',
        periodCovered: `${MONTH_NAMES[month]} ${year} (Monthly Accrual)`,
        vlEarned: amt,
        slEarned: amt,
        vlSpent: 0,
        slSpent: 0,
        forcedLeave: 0,
        splUsed: 0,
        vlBalance: runningVL,
        slBalance: runningSL,
        total: +(runningVL + runningSL).toFixed(3),
        source: source,
        date: new Date().toISOString()
    };
}

function hasMonthlyAccrualTransaction(card, month, year) {
    const expectedPeriod = `${MONTH_NAMES[month]} ${year} (Monthly Accrual)`;
    const transactions = Array.isArray(card?.transactions) ? card.transactions : [];
    return transactions.some(tx => {
        const period = String(tx?.periodCovered || '').trim();
        const source = String(tx?.source || '').toLowerCase();
        return period === expectedPeriod && source.startsWith('system-accrual');
    });
}

function dedupeMonthlyAccrualEntries(dryRun = true) {
    ensureFile(leavecardsFile);
    const leavecards = readJSON(leavecardsFile);
    const nowIso = new Date().toISOString();

    let cardsScanned = 0;
    let cardsChanged = 0;
    let duplicatesRemoved = 0;
    const changedCards = [];

    for (const card of leavecards) {
        cardsScanned++;
        const txns = Array.isArray(card.transactions) ? card.transactions : [];
        if (txns.length === 0) continue;

        const seenAccrualPeriods = new Set();
        const filtered = [];
        let removedForCard = 0;

        for (const tx of txns) {
            const periodCovered = String(tx?.periodCovered || '').trim();
            const source = String(tx?.source || '').toLowerCase();
            const isMonthlyAccrual = /\(monthly accrual\)$/i.test(periodCovered) && source.startsWith('system-accrual');

            if (!isMonthlyAccrual) {
                filtered.push(tx);
                continue;
            }

            const key = periodCovered.toUpperCase();
            if (seenAccrualPeriods.has(key)) {
                removedForCard++;
                continue;
            }

            seenAccrualPeriods.add(key);
            filtered.push(tx);
        }

        if (removedForCard <= 0) continue;

        const normalized = normalizeLeaveCardTransactions(filtered);
        duplicatesRemoved += removedForCard;
        cardsChanged++;
        changedCards.push({
            employee: card.email || card.employeeId || card.name || 'unknown',
            duplicatesRemoved: removedForCard
        });

        if (!dryRun) {
            card.transactions = normalized.transactions;
            card.vl = normalized.summary.vl;
            card.sl = normalized.summary.sl;
            card.vacationLeaveEarned = normalized.summary.vacationLeaveEarned;
            card.sickLeaveEarned = normalized.summary.sickLeaveEarned;
            card.vacationLeaveSpent = normalized.summary.vacationLeaveSpent;
            card.sickLeaveSpent = normalized.summary.sickLeaveSpent;
            card.forceLeaveSpent = normalized.summary.forceLeaveSpent;
            card.splSpent = normalized.summary.splSpent;
            card.pvpDeductionTotal = normalized.summary.pvpDeductionTotal;
            card.updatedAt = nowIso;
        }
    }

    if (!dryRun && cardsChanged > 0) {
        writeJSON(leavecardsFile, leavecards);
    }

    return {
        dryRun,
        cardsScanned,
        cardsChanged,
        duplicatesRemoved,
        changedCards
    };
}

function normalizeLeaveCardTransactions(transactions) {
    const normalized = [];
    let runningVL = 0;
    let runningSL = 0;
    let vlEarnedTotal = 0;
    let slEarnedTotal = 0;
    let vlSpentTotal = 0;
    let slSpentTotal = 0;
    let forceSpentTotal = 0;
    let splSpentTotal = 0;
    let pvpDeductionTotal = 0;

    for (const rawTx of (transactions || [])) {
        const rawTypeUpper = String(rawTx.type || '').toUpperCase();
        const txTypeResolved = rawTypeUpper === 'LAWOP' ? 'LAWOP' : (rawTypeUpper === 'LESS' ? 'LESS' : 'ADD');
        const tx = {
            id: rawTx.id || crypto.randomUUID(),
            type: txTypeResolved,
            periodCovered: rawTx.periodCovered || '-',
            vlEarned: Math.max(0, parseFloat(rawTx.vlEarned) || 0),
            slEarned: Math.max(0, parseFloat(rawTx.slEarned) || 0),
            vlSpent: Math.max(0, parseFloat(rawTx.vlSpent) || 0),
            slSpent: Math.max(0, parseFloat(rawTx.slSpent) || 0),
            forcedLeave: Math.max(0, parseFloat(rawTx.forcedLeave) || 0),
            splUsed: Math.max(0, parseFloat(rawTx.splUsed) || 0),
            source: rawTx.source || '',
            dateRecorded: rawTx.dateRecorded || rawTx.date || new Date().toISOString()
        };

        let pvpDeductionDays = 0;

        if (tx.type === 'LAWOP') {
            // LAWOP is record-keeping only — no balance impact
        } else if (tx.type === 'ADD') {
            runningVL += tx.vlEarned;
            runningSL += tx.slEarned;
            vlEarnedTotal += tx.vlEarned;
            slEarnedTotal += tx.slEarned;
        } else {
            const requestedVlLess = tx.vlSpent;
            const requestedSlLess = tx.slSpent;

            const actualVlLess = Math.min(requestedVlLess, runningVL);
            const actualSlLess = Math.min(requestedSlLess, runningSL);

            const vlOverflow = Math.max(0, requestedVlLess - actualVlLess);
            const slOverflow = Math.max(0, requestedSlLess - actualSlLess);
            pvpDeductionDays = +(vlOverflow + slOverflow).toFixed(3);

            runningVL = +(runningVL - actualVlLess).toFixed(3);
            runningSL = +(runningSL - actualSlLess).toFixed(3);
            tx.vlSpent = actualVlLess;
            tx.slSpent = actualSlLess;

            vlSpentTotal += actualVlLess;
            slSpentTotal += actualSlLess;
            pvpDeductionTotal += pvpDeductionDays;
        }

        if (tx.type !== 'LAWOP') {
            // FL / SPL are annual quotas — only accumulate totals for the current year.
            const txYear = new Date(tx.dateRecorded || Date.now()).getFullYear();
            if (txYear === new Date().getFullYear()) {
                forceSpentTotal += tx.forcedLeave;
                splSpentTotal += tx.splUsed;
            }
        }

        tx.pvpDeductionDays = pvpDeductionDays;
        tx.vlBalance = +runningVL.toFixed(3);
        tx.slBalance = +runningSL.toFixed(3);
        tx.total = +(runningVL + runningSL).toFixed(3);
        normalized.push(tx);
    }

    return {
        transactions: normalized,
        summary: {
            vl: +runningVL.toFixed(3),
            sl: +runningSL.toFixed(3),
            vacationLeaveEarned: +vlEarnedTotal.toFixed(3),
            sickLeaveEarned: +slEarnedTotal.toFixed(3),
            vacationLeaveSpent: +vlSpentTotal.toFixed(3),
            sickLeaveSpent: +slSpentTotal.toFixed(3),
            forceLeaveSpent: +forceSpentTotal.toFixed(3),
            splSpent: +splSpentTotal.toFixed(3),
            pvpDeductionTotal: +pvpDeductionTotal.toFixed(3)
        }
    };
}

/**
 * Build a portal user object from a registration record.
 * DRY: Replaces the 5-case switch in approve-registration where 90% of fields are identical.
 * @param {object} registration - The pending registration record
 * @param {string} role - Portal role ('user', 'ao', 'hr', 'asds', 'sds')
 * @returns {object} User object ready to push into portal's user file
 */
function buildPortalUser(registration, role) {
    return {
        id: registration.id,
        email: registration.email,
        password: registration.password,
        name: registration.fullName || registration.name,
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
        role: role,
        createdAt: registration.createdAt
    };
}

/**
 * Validate leave balance for a given leave type and return error response if insufficient.
 * DRY: Consolidates validation from submit-leave and resubmit-leave.
 * @param {string} leaveType - Leave type code (e.g., 'leave_vl')
 * @param {number} numDays - Requested number of days
 * @param {string} employeeEmail
 * @param {string|null} excludeAppId - App ID to skip (for resubmissions)
 * @returns {{ valid: boolean, error?: string, message?: string }}
 */
function validateLeaveBalance(leaveType, numDays, employeeEmail, excludeAppId) {
    const leavecards = readJSON(leavecardsFile);
    const leaveCard = leavecards.find(lc => lc.email === employeeEmail || lc.employeeId === employeeEmail);

    if (leaveType === 'leave_vl' || leaveType === 'leave_sl') {
        if (!leaveCard) {
            return { valid: false, error: 'No leave card found', message: 'You do not have a leave card on file. Please contact the Administrative Officer to create your leave card before applying for leave.' };
        }
        const bal = calculateEffectiveBalance(employeeEmail, leaveCard, excludeAppId);
        if (leaveType === 'leave_vl' && numDays > bal.vlBalance) {
            console.log(`[VALIDATION] VL rejected for ${employeeEmail}: Requested ${numDays} but only ${bal.vlBalance.toFixed(3)} available`);
            return { valid: false, error: 'Insufficient Vacation Leave balance', message: `You cannot apply for ${numDays} day(s) of Vacation Leave. Your current balance is ${bal.vlBalance.toFixed(3)} day(s). The leave card balance cannot go negative.` };
        }
        if (leaveType === 'leave_sl' && numDays > bal.slBalance) {
            console.log(`[VALIDATION] SL rejected for ${employeeEmail}: Requested ${numDays} but only ${bal.slBalance.toFixed(3)} available`);
            return { valid: false, error: 'Insufficient Sick Leave balance', message: `You cannot apply for ${numDays} day(s) of Sick Leave. Your SL balance is ${bal.slBalance.toFixed(3)} day(s). The balance cannot go negative.` };
        }
        return { valid: true };
    }

    if (leaveType === 'leave_mfl' || leaveType === 'leave_spl') {
        const bal = calculateEffectiveBalance(employeeEmail, leaveCard, excludeAppId);
        if (leaveType === 'leave_mfl') {
            if ((bal.forceSpent + numDays) > 5) {
                const remaining = Math.max(0, 5 - bal.forceSpent);
                console.log(`[VALIDATION] FL rejected for ${employeeEmail}: Already used ${bal.forceSpent}/5, requested ${numDays}`);
                return { valid: false, error: 'Insufficient Force Leave balance', message: `You cannot apply for ${numDays} day(s) of Force Leave. You have ${remaining.toFixed(0)} day(s) remaining out of your 5-day yearly allocation.` };
            }
            if (numDays >= 5) {
                return { valid: false, error: 'Force Leave filing restriction', message: 'Force Leave should not be filed as 5 consecutive days. Please file fewer days per application.' };
            }
            // FL draws from VL balance
            if (numDays > bal.vlBalance) {
                console.log(`[VALIDATION] FL rejected for ${employeeEmail}: VL balance insufficient (${bal.vlBalance.toFixed(3)}) for ${numDays} FL days`);
                return { valid: false, error: 'Insufficient Vacation Leave balance for Force Leave', message: `Force Leave is deducted from your Vacation Leave balance. You need ${numDays} day(s) but only have ${bal.vlBalance.toFixed(3)} VL day(s) available.` };
            }
        }
        if (leaveType === 'leave_spl') {
            if ((bal.splSpent + numDays) > 3) {
                const remaining = Math.max(0, 3 - bal.splSpent);
                console.log(`[VALIDATION] SPL rejected for ${employeeEmail}: Already used ${bal.splSpent}/3, requested ${numDays}`);
                return { valid: false, error: 'Insufficient Special Privilege Leave balance', message: `You cannot apply for ${numDays} day(s) of Special Privilege Leave. You have ${remaining.toFixed(0)} day(s) remaining out of your 3-day yearly allocation.` };
            }
        }
        return { valid: true };
    }

    if (leaveType === 'leave_others') {
        try {
            const ctoBalance = calculateCtoBalance(employeeEmail, leaveCard, excludeAppId);
            if (ctoBalance <= 0) {
                console.log(`[VALIDATION] CTO rejected for ${employeeEmail}: No CTO records (balance is 0)`);
                return { valid: false, error: 'No CTO balance available', message: 'You do not have any CTO (Compensatory Time-Off) balance. Please ensure a Special Order has been filed and CTO days have been granted before applying.' };
            }
            if (numDays > ctoBalance) {
                console.log(`[VALIDATION] CTO rejected for ${employeeEmail}: Requested ${numDays} but only ${ctoBalance.toFixed(3)} available`);
                return { valid: false, error: 'Insufficient CTO balance', message: `You cannot apply for ${numDays} day(s) of CTO leave. Your current CTO balance is ${ctoBalance.toFixed(3)} day(s). The balance cannot go negative.` };
            }
            return { valid: true };
        } catch (err) {
            console.error('[VALIDATION] Error checking CTO balance:', err);
            return { valid: false, error: 'Unable to verify CTO balance', message: 'Could not verify your CTO balance. Please try again or contact the Administrative Officer.' };
        }
    }

    // Other leave types — no balance check needed
    return { valid: true };
}

// ========== MONTHLY LEAVE CREDIT ACCRUAL (1.25/month) ==========

/**
 * Check if an employee's position is a teaching role.
 * Teachers do NOT receive monthly 1.25-day VL/SL accrual — they get proportional
 * vacation service credits (VSC) at the end of the school year instead.
 * Only non-teaching personnel accrue 1.25 VL + 1.25 SL per month.
 * @param {string} position - The employee's position title
 * @returns {boolean} true if position is teaching (should SKIP monthly accrual)
 */
function isTeachingPosition(position) {
    if (!position) return false;
    const p = position.toLowerCase().trim();
    // Teaching roles: Teacher I-III, Master Teacher I-IV, Head Teacher I-VI
    if (/\bteacher\b/.test(p)) return true;
    if (/\bmaster\s*teacher\b/.test(p)) return true;
    if (/\bhead\s*teacher\b/.test(p)) return true;
    return false;
}

/**
 * Build email→position lookup map from users.json for accrual filtering.
 * @returns {Map<string, string>} email → position
 */
function buildPositionMap() {
    const users = readJSON(usersFile);
    const map = new Map();
    users.forEach(u => {
        if (u.email && u.position) map.set(u.email, u.position);
    });
    return map;
}

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

        // Build position map to skip teaching personnel
        const positionMap = buildPositionMap();

        const accrualPerMonth = 1.25;
        let updatedCount = 0;
        let skippedTeachers = 0;

        leavecards.forEach(lc => {
            // Skip teaching personnel — teachers do NOT get monthly accrual
            const empEmail = lc.email || lc.employeeId;
            const position = positionMap.get(empEmail) || '';
            if (isTeachingPosition(position)) {
                skippedTeachers++;
                return;
            }

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

            // Prepare earned values and accrual dedupe
            const prevVL = parseFloat(lc.vacationLeaveEarned) || parseFloat(lc.vl) || 0;
            const prevSL = parseFloat(lc.sickLeaveEarned) || parseFloat(lc.sl) || 0;

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

            let actualMonthsAdded = 0;
            for (let m = 0; m < monthsToAccrue; m++) {
                let entryMonth = startMonth + m;
                let entryYear = startYear;
                while (entryMonth > 12) { entryMonth -= 12; entryYear++; }

                if (hasMonthlyAccrualTransaction(lc, entryMonth, entryYear)) {
                    continue;
                }

                runningVL = +(runningVL + accrualPerMonth).toFixed(3);
                runningSL = +(runningSL + accrualPerMonth).toFixed(3);

                lc.transactions.push(
                    createAccrualTransaction(entryMonth, entryYear, runningVL, runningSL, 'system-accrual-catchup')
                );
                actualMonthsAdded++;
            }

            if (actualMonthsAdded <= 0) {
                lc.lastAccrualDate = globalLastAccruedMonth;
                lc.updatedAt = now.toISOString();
                return;
            }

            const totalAccrual = accrualPerMonth * actualMonthsAdded;
            lc.vacationLeaveEarned = +(prevVL + totalAccrual).toFixed(3);
            lc.sickLeaveEarned = +(prevSL + totalAccrual).toFixed(3);
            lc.vl = lc.vacationLeaveEarned;
            lc.sl = lc.sickLeaveEarned;

            lc.lastAccrualDate = globalLastAccruedMonth;
            lc.updatedAt = now.toISOString();
            updatedCount++;
            console.log(`[ACCRUAL CATCH-UP] ${lc.email || lc.name}: +${totalAccrual.toFixed(3)} VL/SL (${actualMonthsAdded} month(s))`);
        });

        if (updatedCount > 0) {
            writeJSON(leavecardsFile, leavecards);
            console.log(`[ACCRUAL CATCH-UP] Updated ${updatedCount} card(s) that missed previous accrual. Skipped ${skippedTeachers} teacher(s).`);

            // Log activity
            try {
                ensureFile(activityLogsFile);
                const logs = readJSON(activityLogsFile);
                logs.push({
                    id: crypto.randomUUID(),
                    action: 'ACCRUAL_CATCHUP',
                    portalType: 'system',
                    userEmail: 'system',
                    userId: 'system',
                    ip: '127.0.0.1',
                    userAgent: 'server-accrual-catchup',
                    timestamp: now.toISOString(),
                    details: {
                        employeesUpdated: updatedCount,
                        teachersSkipped: skippedTeachers,
                        globalLastAccruedMonth: globalLastAccruedMonth
                    }
                });
                writeJSON(activityLogsFile, logs);
            } catch (logErr) {
                console.error('[ACCRUAL CATCH-UP] Could not log activity:', logErr.message);
            }
        } else {
            console.log(`[ACCRUAL CATCH-UP] All cards are up to date. (${skippedTeachers} teacher(s) excluded from accrual)`);
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

        // Build position map to skip teaching personnel
        const positionMap = buildPositionMap();

        let updatedCount = 0;
        let skippedTeachers = 0;
        leavecards.forEach(lc => {
            // Skip teaching personnel — teachers do NOT get monthly 1.25 VL/SL accrual
            const empEmail = lc.email || lc.employeeId;
            const position = positionMap.get(empEmail) || '';
            if (isTeachingPosition(position)) {
                skippedTeachers++;
                return;
            }

            // Add to vacationLeaveEarned and sickLeaveEarned
            const prevVL = parseFloat(lc.vacationLeaveEarned) || parseFloat(lc.vl) || 0;
            const prevSL = parseFloat(lc.sickLeaveEarned) || parseFloat(lc.sl) || 0;

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

            // Add one transaction per accrued month (deduped)
            let actualMonthsAdded = 0;
            for (let m = 1; m <= monthsToAccrue; m++) {
                // Calculate which month this entry is for
                const parts = (lastAccruedMonth || lastCompletedKey).split('-').map(Number);
                let entryYear = parts[0];
                let entryMonth = parts[1] + (lastAccruedMonth ? m : m - 1);
                while (entryMonth > 12) { entryMonth -= 12; entryYear++; }

                if (hasMonthlyAccrualTransaction(lc, entryMonth, entryYear)) {
                    continue;
                }

                // Running balance after this month's accrual
                runningVL = +(runningVL + accrualPerMonth).toFixed(3);
                runningSL = +(runningSL + accrualPerMonth).toFixed(3);

                lc.transactions.push(
                    createAccrualTransaction(entryMonth, entryYear, runningVL, runningSL, 'system-accrual')
                );
                actualMonthsAdded++;
            }

            const totalAccrualForCard = accrualPerMonth * actualMonthsAdded;
            lc.vacationLeaveEarned = +(prevVL + totalAccrualForCard).toFixed(3);
            lc.sickLeaveEarned = +(prevSL + totalAccrualForCard).toFixed(3);

            // Also update the shorthand fields for consistency
            lc.vl = lc.vacationLeaveEarned;
            lc.sl = lc.sickLeaveEarned;

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

        console.log(`[ACCRUAL] Added ${totalAccrual.toFixed(3)} days (${monthsToAccrue} month(s) x 1.25) to VL and SL for ${updatedCount} non-teaching employee(s). Skipped ${skippedTeachers} teacher(s).`);

        // Log activity
        try {
            ensureFile(activityLogsFile);
            const logs = readJSON(activityLogsFile);
            logs.push({
                id: crypto.randomUUID(),
                action: 'MONTHLY_ACCRUAL',
                portalType: 'system',
                userEmail: 'system',
                userId: 'system',
                ip: '127.0.0.1',
                userAgent: 'server-accrual',
                timestamp: now.toISOString(),
                details: {
                    monthsAccrued: monthsToAccrue,
                    totalAccrual: totalAccrual,
                    employeesUpdated: updatedCount,
                    teachersSkipped: skippedTeachers,
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

// ========== LEAVE BALANCE RECONCILIATION JOB ==========
// Runs weekly: Cross-checks leave card balances against application history to detect drift.
function runBalanceReconciliation() {
    try {
        console.log('[RECONCILIATION] Starting weekly balance reconciliation...');
        const leavecards = readJSON(leavecardsFile);
        const applications = readJSONArray(applicationsFile);
        const discrepancies = [];
        
        for (const card of leavecards) {
            const email = card.email || card.employeeId;
            if (!email) continue;
            
            // Sum up all approved VL/SL usage from applications for this employee
            const approvedApps = applications.filter(a => 
                a.employeeEmail === email && a.status === 'approved'
            );
            
            let totalVlUsed = 0, totalSlUsed = 0;
            approvedApps.forEach(a => {
                totalVlUsed += parseFloat(a.vlLess) || 0;
                totalSlUsed += parseFloat(a.slLess) || 0;
            });
            
            // Compare with leave card spent values
            const cardVlSpent = parseFloat(card.vacationLeaveSpent) || 0;
            const cardSlSpent = parseFloat(card.sickLeaveSpent) || 0;
            
            const vlDrift = Math.abs(cardVlSpent - totalVlUsed);
            const slDrift = Math.abs(cardSlSpent - totalSlUsed);
            
            if (vlDrift > 0.01 || slDrift > 0.01) {
                discrepancies.push({
                    email,
                    vlCardSpent: cardVlSpent,
                    vlAppSum: totalVlUsed,
                    vlDrift: vlDrift.toFixed(3),
                    slCardSpent: cardSlSpent,
                    slAppSum: totalSlUsed,
                    slDrift: slDrift.toFixed(3)
                });
            }
        }
        
        if (discrepancies.length > 0) {
            console.warn(`[RECONCILIATION] Found ${discrepancies.length} balance discrepancies:`);
            discrepancies.forEach(d => {
                console.warn(`  - ${d.email}: VL drift=${d.vlDrift}, SL drift=${d.slDrift}`);
            });
            logActivity('BALANCE_RECONCILIATION', 'system', {
                discrepancyCount: discrepancies.length,
                discrepancies: discrepancies.slice(0, 20) // Log first 20
            });
        } else {
            console.log('[RECONCILIATION] All balances consistent. No discrepancies found.');
        }
        
        // Update system state
        const systemState = readJSON(systemStateFile);
        systemState.lastReconciliation = new Date().toISOString();
        systemState.lastReconciliationResult = discrepancies.length === 0 ? 'clean' : `${discrepancies.length} discrepancies`;
        fs.writeFileSync(systemStateFile, JSON.stringify(systemState, null, 2));
        
        return discrepancies;
    } catch (error) {
        console.error('[RECONCILIATION] Error:', error.message);
        return [];
    }
}

// Run reconciliation on startup (delayed) and then weekly
setTimeout(() => { runBalanceReconciliation(); }, 15000);
setInterval(() => {
    console.log('[RECONCILIATION] Running weekly balance reconciliation...');
    runBalanceReconciliation();
}, 7 * 24 * 60 * 60 * 1000);

// ========== MAINTENANCE MODE ==========
// When enabled, all non-IT API requests return a maintenance message.
// IT admins can still access the system to manage it.
let maintenanceMode = false;
let maintenanceMessage = 'The system is currently undergoing maintenance. Please try again later.';

// Load maintenance state from system-state.json
try {
    const sysState = readJSON(systemStateFile);
    if (sysState.maintenanceMode) {
        maintenanceMode = true;
        maintenanceMessage = sysState.maintenanceMessage || maintenanceMessage;
        console.log('[MAINTENANCE] System started in maintenance mode');
    }
} catch (e) { /* ignore */ }

// Maintenance mode middleware — applied to all API routes except IT and health
app.use('/api', (req, res, next) => {
    if (!maintenanceMode) return next();
    // Allow IT admin actions, health checks, and login endpoints through
    const exemptPaths = ['/health', '/system-maintenance', '/system-state', '/run-reconciliation', '/me'];
    if (exemptPaths.includes(req.path) || req.path.startsWith('/login')) return next();
    const token = extractToken(req);
    if (token) {
        const session = validateSession(token);
        if (session && session.role === 'it') return next();
    }
    return res.status(503).json({ success: false, error: maintenanceMessage });
});

// IT endpoint to toggle maintenance mode
app.post('/api/system-maintenance', requireAuth('it'), (req, res) => {
    const { enabled, message } = req.body;
    maintenanceMode = !!enabled;
    if (message) maintenanceMessage = message;
    
    // Persist to system-state.json
    const systemState = readJSON(systemStateFile);
    systemState.maintenanceMode = maintenanceMode;
    systemState.maintenanceMessage = maintenanceMode ? maintenanceMessage : undefined;
    systemState.maintenanceToggledAt = new Date().toISOString();
    systemState.maintenanceToggledBy = req.session.email;
    fs.writeFileSync(systemStateFile, JSON.stringify(systemState, null, 2));
    
    logActivity(maintenanceMode ? 'MAINTENANCE_ENABLED' : 'MAINTENANCE_DISABLED', 'it', {
        userEmail: req.session.email,
        message: maintenanceMode ? maintenanceMessage : 'Maintenance mode disabled',
        ip: getClientIp(req)
    });
    
    console.log(`[MAINTENANCE] ${maintenanceMode ? 'ENABLED' : 'DISABLED'} by ${req.session.email}`);
    res.json({ success: true, maintenanceMode, message: maintenanceMode ? maintenanceMessage : 'System is operational' });
});

// IT endpoint to get system health & state
app.get('/api/system-state', requireAuth('it'), (req, res) => {
    const systemState = readJSON(systemStateFile);
    res.json({
        success: true,
        state: {
            ...systemState,
            maintenanceMode,
            activeSessions: activeSessions.size,
            rateLimitEntries: rateLimitStore.size,
            uptime: process.uptime(),
            memoryUsage: process.memoryUsage(),
            nodeVersion: process.version
        }
    });
});

// IT endpoint to trigger manual reconciliation
app.post('/api/run-reconciliation', requireAuth('it'), (req, res) => {
    const discrepancies = runBalanceReconciliation();
    res.json({ 
        success: true, 
        message: discrepancies.length === 0 ? 'All balances are consistent.' : `Found ${discrepancies.length} discrepancies.`,
        discrepancies 
    });
});

// IT endpoint to dedupe duplicate monthly accrual rows in leave cards
app.post('/api/cleanup-accrual-duplicates', requireAuth('it'), (req, res) => {
    try {
        const dryRun = req.query.dryRun !== 'false';
        const result = dedupeMonthlyAccrualEntries(dryRun);

        logActivity('ACCRUAL_DUPLICATES_CLEANUP', 'it', {
            userEmail: req.session.email,
            dryRun: result.dryRun,
            cardsChanged: result.cardsChanged,
            duplicatesRemoved: result.duplicatesRemoved,
            ip: getClientIp(req)
        });

        return res.json({
            success: true,
            message: result.cardsChanged > 0
                ? `${result.duplicatesRemoved} duplicate monthly accrual entr${result.duplicatesRemoved === 1 ? 'y' : 'ies'} ${result.dryRun ? 'would be removed' : 'removed'} across ${result.cardsChanged} leave card(s).`
                : `No duplicate monthly accrual entries ${result.dryRun ? 'found' : 'remaining'}.`,
            result
        });
    } catch (error) {
        console.error('[CLEANUP ACCRUAL DUPLICATES] Error:', error);
        return res.status(500).json({ success: false, error: error.message || 'Failed to cleanup duplicates' });
    }
});

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
    if (!/[a-zA-ZÀ-ÖØ-öø-ÿ\u00C0-\u024F]/.test(password)) {
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

function buildEmployeeRecord(office, fullName, email, position, salaryGrade, step, salary, district, suffix, employeeNo) {
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
        suffix: suffix || '',         // D10 fix: was missing from employee records
        employeeNo: employeeNo || '', // D10 fix: was missing from employee records
        fullName: fullName || '',
        position: position || '',
        salaryGrade: salaryGrade ? parseInt(salaryGrade) : null,
        step: step ? parseInt(step) : null,
        salary: salary ? Number(salary) : null,
        email: email || '',
        createdAt: new Date().toISOString()
    };
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

// ========== EMAIL NOTIFICATION SYSTEM ==========
// Fire-and-forget email helpers for leave workflow events.
// If MAILERSEND_API_KEY is not set, these silently no-op.

/**
 * Notify the employee that their leave application has been submitted.
 */
function notifyLeaveSubmitted(app) {
    if (!MAILERSEND_API_KEY) return;
    const empEmail = app.employeeEmail;
    if (!empEmail) return;
    const subject = `Leave Application Submitted — ${app.id}`;
    const html = generateWorkflowEmail(
        'Application Submitted',
        app.employeeName || empEmail,
        `Your leave application <strong>${app.id}</strong> (${formatLeaveType(app.leaveType)}) for ${app.numDays} day(s) from ${app.dateFrom} to ${app.dateTo} has been submitted successfully.`,
        'Your application is now with the <strong>Administrative Officer (AO)</strong> for initial review.',
        '#28a745'
    );
    sendEmail(empEmail, app.employeeName || '', subject, html).catch(e => console.error('[EMAIL] Submit notification failed:', e.message));
}

/**
 * Notify the employee (and optionally next approver) when an application is approved at a stage.
 */
function notifyLeaveApproved(app, approverPortal, nextApprover) {
    if (!MAILERSEND_API_KEY) return;
    const empEmail = app.employeeEmail;
    if (!empEmail) return;
    
    const isFinal = !nextApprover;
    const subject = isFinal
        ? `✅ Leave Application APPROVED — ${app.id}`
        : `Leave Application Approved by ${approverPortal} — ${app.id}`;
    
    const message = isFinal
        ? `Great news! Your leave application <strong>${app.id}</strong> (${formatLeaveType(app.leaveType)}) has received <strong>final approval</strong> from the Schools Division Superintendent.`
        : `Your leave application <strong>${app.id}</strong> (${formatLeaveType(app.leaveType)}) has been approved by <strong>${approverPortal}</strong>.`;
    
    const nextSteps = isFinal
        ? 'Your leave is now officially approved. You may view and print the final form from your dashboard.'
        : `Your application is now with <strong>${nextApprover}</strong> for the next review step.`;
    
    const color = isFinal ? '#28a745' : '#1976D2';
    const html = generateWorkflowEmail(isFinal ? 'Final Approval' : `Approved by ${approverPortal}`, app.employeeName || empEmail, message, nextSteps, color);
    sendEmail(empEmail, app.employeeName || '', subject, html).catch(e => console.error('[EMAIL] Approval notification failed:', e.message));
    
    // Notify next approver if applicable
    if (nextApprover) {
        notifyNextApprover(app, nextApprover);
    }
}

/**
 * Notify the employee when their application is returned.
 */
function notifyLeaveReturned(app, returnedBy, remarks) {
    if (!MAILERSEND_API_KEY) return;
    const empEmail = app.employeeEmail;
    if (!empEmail) return;
    const subject = `⚠️ Leave Application Returned — ${app.id}`;
    const html = generateWorkflowEmail(
        'Application Returned',
        app.employeeName || empEmail,
        `Your leave application <strong>${app.id}</strong> (${formatLeaveType(app.leaveType)}) has been returned by <strong>${returnedBy}</strong>.`,
        `<strong>Reason:</strong> ${remarks || 'Please review and resubmit.'}<br><br>Please log in to your dashboard to view details and resubmit.`,
        '#F57C00'
    );
    sendEmail(empEmail, app.employeeName || '', subject, html).catch(e => console.error('[EMAIL] Return notification failed:', e.message));
}

/**
 * Notify the employee when their application is rejected.
 */
function notifyLeaveRejected(app, rejectedBy, reason) {
    if (!MAILERSEND_API_KEY) return;
    const empEmail = app.employeeEmail;
    if (!empEmail) return;
    const subject = `❌ Leave Application Rejected — ${app.id}`;
    const html = generateWorkflowEmail(
        'Application Rejected',
        app.employeeName || empEmail,
        `Your leave application <strong>${app.id}</strong> (${formatLeaveType(app.leaveType)}) has been <strong>rejected</strong> by <strong>${rejectedBy}</strong>.`,
        `<strong>Reason:</strong> ${reason || 'No specific reason provided.'}<br><br>If you believe this was in error, please contact the ${rejectedBy} office or submit a new application.`,
        '#d32f2f'
    );
    sendEmail(empEmail, app.employeeName || '', subject, html).catch(e => console.error('[EMAIL] Rejection notification failed:', e.message));
}

/**
 * Notify the next approver in the chain that an application is waiting for them.
 */
function notifyNextApprover(app, approverRole) {
    if (!MAILERSEND_API_KEY) return;
    const portalToFile = { 'HR': hrUsersFile, 'AO': aoUsersFile, 'ASDS': asdsUsersFile, 'SDS': sdsUsersFile };
    const file = portalToFile[approverRole];
    if (!file) return;
    
    const approvers = readJSON(file);
    // Notify all users in that portal (they share responsibility)
    approvers.forEach(user => {
        if (!user.email) return;
        const subject = `📋 New Leave Application Pending Your Review — ${app.id}`;
        const html = generateWorkflowEmail(
            'Action Required',
            user.name || user.email,
            `A leave application from <strong>${app.employeeName || app.employeeEmail}</strong> (${formatLeaveType(app.leaveType)}, ${app.numDays} days) is now waiting for your review.`,
            `Please log in to your <strong>${approverRole}</strong> dashboard to review and take action on application <strong>${app.id}</strong>.`,
            '#003366'
        );
        sendEmail(user.email, user.name || '', subject, html).catch(e => console.error(`[EMAIL] Next-approver notification to ${user.email} failed:`, e.message));
    });
}

/** Format leave type code for display */
function formatLeaveType(leaveType) {
    const map = {
        'leave_vacation': 'Vacation Leave', 'leave_mandatory': 'Mandatory/Forced Leave',
        'leave_sick': 'Sick Leave', 'leave_maternity': 'Maternity Leave',
        'leave_paternity': 'Paternity Leave', 'leave_spl': 'Special Privilege Leave',
        'leave_solo_parent': 'Solo Parent Leave', 'leave_study': 'Study Leave',
        'leave_vawc': '10-Day VAWC Leave', 'leave_rehab': 'Rehabilitation Leave',
        'leave_women': 'Special Leave Benefits for Women', 'leave_calamity': 'Calamity Leave',
        'leave_adoption': 'Adoption Leave', 'leave_others': 'Others (CTO)',
        'leave_mfl': 'Mandatory/Forced Leave'
    };
    return map[leaveType] || leaveType || 'Leave';
}

/** Reusable workflow email template */
function generateWorkflowEmail(heading, recipientName, mainMessage, nextSteps, accentColor) {
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5; }
            .email-wrapper { background-color: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            .header { background: ${accentColor}; color: white; padding: 20px; text-align: center; }
            .header h1 { margin: 0; font-size: 22px; }
            .header p { margin: 5px 0 0; opacity: 0.9; font-size: 13px; }
            .content { padding: 25px; }
            .info-box { background: #f9f9f9; border-left: 4px solid ${accentColor}; padding: 12px 15px; margin: 15px 0; border-radius: 0 4px 4px 0; }
            .footer { text-align: center; padding: 15px 25px; border-top: 1px solid #eee; font-size: 12px; color: #999; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="email-wrapper">
                <div class="header">
                    <h1>${heading}</h1>
                    <p>CS Form No. 6 — Leave Application System</p>
                </div>
                <div class="content">
                    <p>Dear <strong>${recipientName}</strong>,</p>
                    <p>${mainMessage}</p>
                    <div class="info-box">
                        <p style="margin:0;"><strong>Next Steps:</strong></p>
                        <p style="margin:5px 0 0;">${nextSteps}</p>
                    </div>
                    <p style="font-size:13px; color:#666;">If you have questions, contact your immediate supervisor or the IT Department.</p>
                    <p>Best regards,<br><strong>DepEd Sipalay Division</strong></p>
                </div>
                <div class="footer">
                    <p>This is an automated notification. Please do not reply to this email.<br>&copy; 2026 DepEd Sipalay Division</p>
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
app.get('/ao-dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'ao-dashboard.html')));
app.get('/leave-form', (req, res) => res.sendFile(path.join(__dirname, 'public', 'leave-application.html')));
app.get('/leave-form-legacy', (req, res) => res.sendFile(path.join(__dirname, 'public', 'leave_form.html')));
app.get('/hr-approval', (req, res) => res.sendFile(path.join(__dirname, 'public', 'hr-approval.html')));
app.get('/asds-dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'asds-dashboard.html')));
app.get('/sds-dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'sds-dashboard.html')));
app.get('/activity-logs', (req, res) => res.sendFile(path.join(__dirname, 'public', 'activity-logs.html')));
app.get('/data-management', (req, res) => res.sendFile(path.join(__dirname, 'public', 'data-management.html')));

// ========== HEALTH CHECK ==========
app.get('/api/health', (req, res) => {
    res.json({ success: true, uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// ========== SESSION VALIDATION & LOGOUT ==========
app.get('/api/validate-session', (req, res) => {
    const token = extractToken(req);
    if (!token) {
        return res.status(401).json({ success: false, error: 'No session' });
    }
    const session = validateSession(token);
    if (!session) {
        return res.status(401).json({ success: false, error: 'Session expired' });
    }
    res.json({ success: true, session: { email: session.email, role: session.role, portal: session.portal } });
});

// GET /api/me — cookie-based session check (preferred over validate-session)
app.get('/api/me', (req, res) => {
    const token = extractToken(req);
    if (!token) {
        return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const session = validateSession(token);
    if (!session) {
        res.clearCookie('session', { path: '/' });
        return res.status(401).json({ success: false, error: 'Session expired' });
    }
    res.json({
        success: true,
        user: {
            id: session.userId,
            email: session.email,
            role: session.role,
            portal: session.portal,
            name: session.name || '',
            fullName: session.fullName || '',
            firstName: session.firstName || '',
            lastName: session.lastName || '',
            middleName: session.middleName || '',
            suffix: session.suffix || '',
            office: session.office || '',
            position: session.position || '',
            salary: session.salary || '',
            salaryGrade: session.salaryGrade || '',
            step: session.step || '',
            employeeNo: session.employeeNo || '',
            mustChangePassword: session.mustChangePassword || false
        }
    });
});

// POST /api/change-password — Mandatory password change after IT reset
app.post('/api/change-password', requireAuth(), (req, res) => {
    try {
        const token = extractToken(req);
        const session = validateSession(token);
        if (!session) return res.status(401).json({ success: false, error: 'Not authenticated' });

        const { newPassword, confirmPassword } = req.body;
        if (!newPassword || !confirmPassword) {
            return res.status(400).json({ success: false, error: 'Both fields are required' });
        }
        if (newPassword !== confirmPassword) {
            return res.status(400).json({ success: false, error: 'Passwords do not match' });
        }
        const validation = validatePortalPassword(newPassword);
        if (!validation.valid) {
            return res.status(400).json({ success: false, error: validation.error });
        }

        const email  = session.email;
        const portal = session.portal;
        const allPortalFiles = [
            { name: 'user', file: usersFile },
            { name: 'ao', file: aoUsersFile },
            { name: 'hr', file: hrUsersFile },
            { name: 'asds', file: asdsUsersFile },
            { name: 'sds', file: sdsUsersFile }
        ];
        const filesToSearch = portal && portal !== 'it'
            ? allPortalFiles.filter(p => p.name === portal.toLowerCase() || (portal === 'user' && p.name === 'user'))
            : allPortalFiles;

        const hashed = hashPasswordWithSalt(newPassword);
        let updated = false;
        for (const { file } of filesToSearch) {
            if (!fs.existsSync(file)) continue;
            const users = readJSON(file);
            const idx = users.findIndex(u => (u.email || '').toLowerCase() === email.toLowerCase());
            if (idx !== -1) {
                users[idx].password = hashed;
                users[idx].mustChangePassword = false;
                users[idx].passwordChangedAt = new Date().toISOString();
                writeJSON(file, users);
                updated = true;
                break;
            }
        }
        if (!updated) return res.status(404).json({ success: false, error: 'User not found' });

        // Update the active session to clear the flag
        session.mustChangePassword = false;
        persistSessions();

        logActivity('PASSWORD_CHANGED', portal, { userEmail: email, ip: getClientIp(req) });
        res.json({ success: true, message: 'Password changed successfully' });
    } catch (err) {
        console.error('Error changing password:', err);
        res.status(500).json({ success: false, error: 'An error occurred' });
    }
});

app.post('/api/logout', (req, res) => {
    const token = extractToken(req);
    if (token) {
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
    res.clearCookie('session', { path: '/' });
    res.json({ success: true, message: 'Logged out successfully' });
});

// ========== DRY HANDLER FACTORIES (S4/S5/S6 fix) ==========
// Instead of 5 nearly identical registration handlers, 5 login handlers,
// and 6 profile update handlers, these factories produce them from config.

/**
 * DRY: Generic admin portal registration handler (S4 fix)
 * All admin portals (HR, ASDS, SDS, AO) follow the same registration flow.
 * Employee registration is kept separate due to unique field requirements.
 */
function createAdminRegisterHandler(config) {
    const { portalName, portalLabel, userFile, excludePortals, defaultValues = {} } = config;
    return (req, res) => {
        try {
            const { email, password, fullName, firstName, lastName, middleName, suffix,
                    office, position, salaryGrade, step, salary, employeeNo, name } = req.body || {};
            const userName = fullName || name;
            if (!email || !password || !userName) {
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
            let portalUsers = readJSON(userFile);
            let pendingRegs = readJSON(pendingRegistrationsFile);
            if (portalUsers.find(u => u.email === email)) {
                return res.status(400).json({ success: false, error: `${portalLabel} account already exists` });
            }
            const existingPortal = isEmailRegisteredInAnyPortal(email, excludePortals);
            if (existingPortal) {
                return res.status(400).json({ success: false, error: `This email is already registered in the ${existingPortal} portal. Each email can only be used in one portal.` });
            }
            if (pendingRegs.find(r => r.email === email && r.portal === portalName && r.status === 'pending')) {
                return res.status(400).json({ success: false, error: 'Registration already pending IT approval' });
            }
            const pendingRegistration = {
                id: crypto.randomUUID(),
                portal: portalName,
                fullName: userName, name: userName,
                firstName: firstName || '', lastName: lastName || '',
                middleName: middleName || '', suffix: suffix || '',
                email,
                password: hashPasswordWithSalt(password),
                office: office || defaultValues.office || '',
                position: position || defaultValues.position || '',
                salaryGrade: salaryGrade ? parseInt(salaryGrade) : null,
                step: step ? parseInt(step) : null,
                salary: salary ? Number(salary) : null,
                employeeNo: employeeNo || '',
                role: portalName,
                status: 'pending',
                createdAt: new Date().toISOString()
            };
            pendingRegs.push(pendingRegistration);
            writeJSON(pendingRegistrationsFile, pendingRegs);
            logActivity('REGISTRATION_SUBMITTED', portalName, {
                userEmail: email, fullName: userName, portal: portalName,
                ip: getClientIp(req), userAgent: req.get('user-agent')
            });
            res.json({ success: true, message: 'Registration submitted! Please wait for IT department approval.' });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    };
}

/**
 * DRY: Generic portal login handler (S5 fix)
 * All portals (except IT which uses PIN) follow the same login flow.
 * Fixes: ASDS, SDS, AO were missing LOGIN_SUCCESS activity logs.
 */
function createLoginHandler(config) {
    const { portalName, userFile, sessionRole, responseFields } = config;
    return (req, res) => {
        try {
            const { email, password } = req.body;
            const ip = getClientIp(req);
            let users = readJSON(userFile);
            const user = users.find(u => u.email === email && verifyPassword(password, u.password));
            if (!user) {
                logActivity('LOGIN_FAILED', portalName, {
                    userEmail: email, ip, userAgent: req.get('user-agent')
                });
                let pendingRegs = readJSON(pendingRegistrationsFile);
                const pending = pendingRegs.find(r => r.email === email && r.portal === portalName && r.status === 'pending');
                if (pending) {
                    return res.status(401).json({ success: false, error: 'Your registration is still pending IT approval.' });
                }
                return res.status(401).json({ success: false, error: 'Invalid email or password' });
            }
            rehashIfNeeded(password, user.password, user, users, userFile);
            const token = createSession(user, sessionRole);
            logActivity('LOGIN_SUCCESS', portalName, {
                userEmail: user.email, userId: user.id, ip,
                userAgent: req.get('user-agent'), userName: user.name
            });
            const responseUser = {};
            for (const field of responseFields) {
                if (user[field] !== undefined) responseUser[field] = user[field];
            }
            responseUser.role = sessionRole;
            res.cookie('session', token, SESSION_COOKIE_OPTIONS);
            res.json({ success: true, user: responseUser });
        } catch (error) {
            res.status(500).json({ success: false, error: 'An error occurred. Please try again.' });
        }
    };
}

/**
 * DRY: Generic portal profile update handler (S6 fix)
 * All portals follow the same profile update flow with minor variations.
 */
function createProfileUpdateHandler(config) {
    const { portalName, portalLabel, userFile, updatableFields = [],
            usesPin = false, syncToEmployees = false, syncToLeaveCards = false,
            responseFields } = config;
    return (req, res) => {
        try {
            const { email, fullName, newPassword, newPin } = req.body;
            if (!email || !fullName) {
                return res.status(400).json({ success: false, error: 'Email and full name are required' });
            }
            // SECURITY: Verify the authenticated user is updating their own profile
            if (req.session.email !== email) {
                return res.status(403).json({ success: false, error: 'You can only update your own profile' });
            }
            let users = readJSON(userFile);
            const userIndex = users.findIndex(u => u.email === email);
            if (userIndex === -1) {
                return res.status(404).json({ success: false, error: `${portalLabel} user not found` });
            }
            const oldName = users[userIndex].name;
            users[userIndex].name = fullName;
            users[userIndex].fullName = fullName;
            // Keep segregated name fields in sync
            const nameParts = parseFullNameIntoParts(fullName);
            users[userIndex].firstName = nameParts.firstName || '';
            users[userIndex].lastName = nameParts.lastName || '';
            users[userIndex].middleName = nameParts.middleName || '';
            users[userIndex].suffix = nameParts.suffix || '';
            // Update portal-specific fields
            for (const field of updatableFields) {
                if (req.body[field]) users[userIndex][field] = req.body[field];
            }
            // Handle password/PIN change
            if (usesPin && newPin) {
                if (!/^\d{6}$/.test(newPin)) {
                    return res.status(400).json({ success: false, error: 'PIN must be exactly 6 digits' });
                }
                users[userIndex].password = hashPasswordWithSalt(newPin);
            } else if (!usesPin && newPassword) {
                const passwordValidation = validatePortalPassword(newPassword);
                if (!passwordValidation.valid) {
                    return res.status(400).json({ success: false, error: passwordValidation.error });
                }
                users[userIndex].password = hashPasswordWithSalt(newPassword);
            }
            users[userIndex].updatedAt = new Date().toISOString();
            writeJSON(userFile, users);
            // Sync name/fields to employees.json if employee portal
            if (syncToEmployees) {
                let employees = readJSON(employeesFile);
                const empIndex = employees.findIndex(e => e.email === email);
                if (empIndex !== -1) {
                    employees[empIndex].name = fullName;
                    for (const field of updatableFields) {
                        if (req.body[field]) employees[empIndex][field] = req.body[field];
                    }
                    employees[empIndex].updatedAt = new Date().toISOString();
                    writeJSON(employeesFile, employees);
                }
            }
            // Sync name change to leave cards
            if (syncToLeaveCards && oldName !== fullName) {
                let leaveCards = readJSON(leavecardsFile);
                leaveCards.forEach(card => { if (card.email === email) card.name = fullName; });
                writeJSON(leavecardsFile, leaveCards);
            }
            logActivity('PROFILE_UPDATED', portalName, { userEmail: email, userName: fullName });
            const responseUser = {};
            for (const field of responseFields) {
                if (users[userIndex][field] !== undefined) responseUser[field] = users[userIndex][field];
            }
            responseUser.role = portalName === 'employee' ? 'user' : portalName;
            res.json({ success: true, message: 'Profile updated successfully', user: responseUser });
        } catch (error) {
            console.error(`Error updating ${portalLabel} profile:`, error);
            res.status(500).json({ success: false, error: error.message });
        }
    };
}

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

        // NOTE: Cross-portal check removed — all 6 portals were excluded, making it a no-op.
        // Employee-duplicate check above is sufficient. Admins ARE employees per policy.

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
app.post('/api/login', loginRateLimiter, createLoginHandler({
    portalName: 'employee', userFile: usersFile, sessionRole: 'user',
    responseFields: ['id', 'email', 'name', 'office', 'position', 'employeeNo', 'salaryGrade', 'step', 'salary']
}));

// IT Admin: Reset any user's password (forgot password - user asks IT staff for help)
app.post('/api/it/reset-password', requireAuth('it'), (req, res) => {
    try {
        const { email, portal } = req.body;
        let { newPassword } = req.body;
        const resetBy = req.session.email || 'IT Admin';

        if (!email) {
            return res.status(400).json({ success: false, error: 'Email is required' });
        }

        // Auto-generate a temp password guaranteed to pass validation (letters+digits+special)
        if (!newPassword) {
            const upper   = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
            const lower   = 'abcdefghjkmnpqrstuvwxyz';
            const digits  = '23456789';
            const special = '!@#$';
            const all     = upper + lower + digits + special;
            const rand    = (s) => s[Math.floor(Math.random() * s.length)];
            const base    = Array.from({ length: 8 }, () => rand(all)).join('');
            newPassword   = rand(upper) + rand(lower) + rand(digits) + rand(special) + base;
            // Shuffle to avoid predictable prefix
            newPassword = newPassword.split('').sort(() => Math.random() - 0.5).join('');
        }

        const passwordValidation = validatePortalPassword(newPassword);
        if (!passwordValidation.valid) {
            return res.status(400).json({ success: false, error: passwordValidation.error });
        }

        // Search all portal files for this email
        // NOTE: IT portal uses numeric PINs (not passwords), so exclude it from password resets
        const allPortalFiles = [
            { name: 'employee', file: usersFile },
            { name: 'ao', file: aoUsersFile },
            { name: 'hr', file: hrUsersFile },
            { name: 'asds', file: asdsUsersFile },
            { name: 'sds', file: sdsUsersFile }
        ];

        // If portal specified, search only that file; otherwise search all
        const filesToSearch = portal 
            ? allPortalFiles.filter(p => p.name === portal.toLowerCase())
            : allPortalFiles;

        let resetCount = 0;
        const resetPortals = [];
        const hashedPassword = hashPasswordWithSalt(newPassword);

        for (const { name, file } of filesToSearch) {
            if (!fs.existsSync(file)) continue;
            let users = readJSON(file);
            const userIdx = users.findIndex(u => (u.email || '').toLowerCase() === email.toLowerCase());
            if (userIdx !== -1) {
                users[userIdx].password = hashedPassword;
                users[userIdx].passwordResetAt = new Date().toISOString();
                users[userIdx].passwordResetBy = resetBy;
                users[userIdx].mustChangePassword = true;
                writeJSON(file, users);
                resetCount++;
                resetPortals.push(name);
                console.log(`[IT] Password reset for ${email} in ${name} portal by ${resetBy}`);
            }
        }

        if (resetCount === 0) {
            return res.status(404).json({ success: false, error: 'User not found in any portal' });
        }

        // Destroy existing sessions for this user (force re-login with new password)
        let sessionsDestroyed = 0;
        for (const [token, session] of activeSessions) {
            if (session.email && session.email.toLowerCase() === email.toLowerCase()) {
                activeSessions.delete(token);
                sessionsDestroyed++;
            }
        }
        if (sessionsDestroyed > 0) persistSessions();

        logActivity('PASSWORD_RESET_BY_IT', 'it', {
            userEmail: email,
            resetBy: resetBy,
            portalsReset: resetPortals,
            sessionsDestroyed,
            ip: getClientIp(req),
            userAgent: req.get('user-agent')
        });

        res.json({
            success: true,
            message: `Password reset for ${email} in ${resetPortals.join(', ')} portal(s).`,
            portalsReset: resetPortals,
            tempPassword: newPassword
        });
    } catch (error) {
        console.error('Error resetting password:', error);
        res.status(500).json({ success: false, error: 'An error occurred. Please try again.' });
    }
});

// Reset IT staff PIN (separate from password reset because IT uses numeric PINs)
app.post('/api/it/reset-pin', requireAuth('it'), (req, res) => {
    try {
        const { email, newPin } = req.body;
        const resetBy = req.session.email || 'IT Admin';

        if (!email || !newPin) {
            return res.status(400).json({ success: false, error: 'Email and new PIN are required' });
        }

        if (!/^\d{6}$/.test(newPin)) {
            return res.status(400).json({ success: false, error: 'PIN must be exactly 6 digits' });
        }

        let itUsers = readJSON(itUsersFile);
        const userIdx = itUsers.findIndex(u => (u.email || '').toLowerCase() === email.toLowerCase());

        if (userIdx === -1) {
            return res.status(404).json({ success: false, error: 'IT staff not found' });
        }

        itUsers[userIdx].password = hashPasswordWithSalt(newPin);
        itUsers[userIdx].pinResetAt = new Date().toISOString();
        itUsers[userIdx].pinResetBy = resetBy;
        writeJSON(itUsersFile, itUsers);

        // Destroy existing sessions for this IT user
        let sessionsDestroyed = 0;
        for (const [token, session] of activeSessions) {
            if (session.email && session.email.toLowerCase() === email.toLowerCase() && session.role === 'it') {
                activeSessions.delete(token);
                sessionsDestroyed++;
            }
        }
        if (sessionsDestroyed > 0) persistSessions();

        console.log(`[IT] PIN reset for ${email} by ${resetBy}`);
        logActivity('PIN_RESET_BY_IT', 'it', {
            userEmail: email,
            resetBy: resetBy,
            sessionsDestroyed,
            ip: getClientIp(req),
            userAgent: req.get('user-agent')
        });

        res.json({ 
            success: true, 
            message: `PIN reset successfully for ${email}.`
        });
    } catch (error) {
        console.error('Error resetting IT PIN:', error);
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
        if (!isSelfOrAdmin(req, email)) {
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

// ========== HR REGISTRATION & LOGIN (DRY: uses factory) ==========
app.post('/api/hr-register', apiRateLimiter, createAdminRegisterHandler({
    portalName: 'hr', portalLabel: 'HR', userFile: hrUsersFile,
    excludePortals: ['hr', 'user'],
    defaultValues: { office: 'Schools Division', position: 'HR Staff' }
}));
app.post('/api/hr-login', loginRateLimiter, createLoginHandler({
    portalName: 'hr', userFile: hrUsersFile, sessionRole: 'hr',
    responseFields: ['id', 'email', 'name', 'office', 'position']
}));

// ========== ASDS REGISTRATION & LOGIN (DRY: uses factory) ==========
app.post('/api/asds-register', apiRateLimiter, createAdminRegisterHandler({
    portalName: 'asds', portalLabel: 'ASDS', userFile: asdsUsersFile,
    excludePortals: ['asds', 'user']
}));
app.post('/api/asds-login', loginRateLimiter, createLoginHandler({
    portalName: 'asds', userFile: asdsUsersFile, sessionRole: 'asds',
    responseFields: ['id', 'email', 'name', 'office', 'position']
}));

// ========== SDS REGISTRATION & LOGIN (DRY: uses factory) ==========
app.post('/api/sds-register', apiRateLimiter, createAdminRegisterHandler({
    portalName: 'sds', portalLabel: 'SDS', userFile: sdsUsersFile,
    excludePortals: ['sds', 'user'],
    defaultValues: { office: 'Office of the Schools Division Superintendent' }
}));
app.post('/api/sds-login', loginRateLimiter, createLoginHandler({
    portalName: 'sds', userFile: sdsUsersFile, sessionRole: 'sds',
    responseFields: ['id', 'email', 'name', 'office', 'position']
}));

// ========== AO REGISTRATION & LOGIN (DRY: uses factory) ==========
app.post('/api/ao-register', apiRateLimiter, createAdminRegisterHandler({
    portalName: 'ao', portalLabel: 'AO', userFile: aoUsersFile,
    excludePortals: ['ao', 'user']
}));
app.post('/api/ao-login', loginRateLimiter, createLoginHandler({
    portalName: 'ao', userFile: aoUsersFile, sessionRole: 'ao',
    responseFields: ['id', 'email', 'name', 'office', 'position']
}));

// ========== IT DEPARTMENT ==========

// Bootstrap: Create the first IT user on a fresh deploy (no IT users exist yet).
// SECURITY: Only works when IT_BOOTSTRAP_KEY env var is set AND it-users.json is empty.
// Usage: POST /api/it-bootstrap { "bootstrapKey": "<your-key>", "email": "...", "pin": "123456", "fullName": "..." }
// After creating the first IT user, REMOVE the IT_BOOTSTRAP_KEY env var to disable this endpoint.
app.post('/api/it-bootstrap', loginRateLimiter, (req, res) => {
    try {
        const BOOTSTRAP_KEY = process.env.IT_BOOTSTRAP_KEY;
        if (!BOOTSTRAP_KEY) {
            return res.status(503).json({ success: false, error: 'Bootstrap is disabled. Set IT_BOOTSTRAP_KEY environment variable to enable.' });
        }

        const { bootstrapKey, email, pin, fullName } = req.body || {};

        // Timing-safe key comparison
        const keyBuffer = Buffer.from(bootstrapKey || '');
        const expectedBuffer = Buffer.from(BOOTSTRAP_KEY);
        if (keyBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(keyBuffer, expectedBuffer)) {
            return res.status(403).json({ success: false, error: 'Invalid bootstrap key' });
        }

        // Only allow when no IT users exist (first-time setup)
        const itUsers = readJSON(itUsersFile);
        if (itUsers.length > 0) {
            return res.status(400).json({ success: false, error: 'IT users already exist. Bootstrap is only for first-time setup.' });
        }

        if (!email || !pin || !fullName) {
            return res.status(400).json({ success: false, error: 'Email, PIN, and fullName are required' });
        }
        if (!/^\d{6}$/.test(pin)) {
            return res.status(400).json({ success: false, error: 'PIN must be exactly 6 digits' });
        }

        const newITUser = {
            id: crypto.randomUUID(),
            email: email.trim().toLowerCase(),
            password: hashPasswordWithSalt(pin),
            name: fullName.trim(),
            fullName: fullName.trim(),
            role: 'it',
            createdAt: new Date().toISOString()
        };

        writeJSON(itUsersFile, [newITUser]);
        logActivity('IT_BOOTSTRAP', 'system', { email: newITUser.email, ip: getClientIp(req) });
        console.log(`[BOOTSTRAP] First IT user created: ${newITUser.email}`);

        res.json({ success: true, message: 'First IT user created successfully. Remove IT_BOOTSTRAP_KEY env var to disable this endpoint.' });
    } catch (error) {
        console.error('Bootstrap error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/it-login', loginRateLimiter, (req, res) => {
    try {
        const rawEmail = req.body?.email;
        const rawPin = req.body?.pin;
        const email = (rawEmail || '').trim().toLowerCase();
        const pin = (rawPin || '').trim();

        if (!email || !pin) {
            return res.status(400).json({ success: false, error: 'Email and PIN are required' });
        }

        if (!/^\d{6}$/.test(pin)) {
            return res.status(400).json({ success: false, error: 'PIN must be exactly 6 digits' });
        }

        let itUsers = readJSON(itUsersFile);
        const itUser = itUsers.find(u => (u.email || '').toLowerCase() === email && verifyPassword(pin, u.password));

        if (!itUser) {
            return res.status(401).json({ success: false, error: 'Invalid IT email or PIN' });
        }

        // Transparently upgrade password hash to bcrypt on successful login
        rehashIfNeeded(pin, itUser.password, itUser, itUsers, itUsersFile);

        const token = createSession(itUser, 'it');

        res.cookie('session', token, SESSION_COOKIE_OPTIONS);
        res.json({
            success: true,
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
app.post('/api/update-it-profile', requireAuth('it'), createProfileUpdateHandler({
    portalName: 'it', portalLabel: 'IT', userFile: itUsersFile,
    usesPin: true, responseFields: ['id', 'email', 'fullName', 'name']
}));


// ========== SELF-SERVICE PROFILE EDITING ==========

// Update Employee Profile
app.post('/api/update-employee-profile', requireAuth('user'), createProfileUpdateHandler({
    portalName: 'employee', portalLabel: 'Employee', userFile: usersFile,
    updatableFields: ['office', 'position', 'employeeNo', 'salaryGrade', 'step', 'salary'],
    syncToEmployees: true, syncToLeaveCards: true,
    responseFields: ['id', 'email', 'name', 'office', 'position', 'employeeNo', 'salaryGrade', 'step', 'salary']
}));

// Update AO Profile
app.post('/api/update-ao-profile', requireAuth('ao'), createProfileUpdateHandler({
    portalName: 'ao', portalLabel: 'AO', userFile: aoUsersFile,
    updatableFields: ['school', 'position'],
    responseFields: ['id', 'email', 'name', 'school', 'position']
}));

// Update HR Profile
app.post('/api/update-hr-profile', requireAuth('hr'), createProfileUpdateHandler({
    portalName: 'hr', portalLabel: 'HR', userFile: hrUsersFile,
    updatableFields: ['office', 'position'],
    responseFields: ['id', 'email', 'name', 'office', 'position']
}));

// Update ASDS Profile
app.post('/api/update-asds-profile', requireAuth('asds'), createProfileUpdateHandler({
    portalName: 'asds', portalLabel: 'ASDS', userFile: asdsUsersFile,
    updatableFields: ['office', 'position'],
    responseFields: ['id', 'email', 'name', 'office', 'position']
}));

// Update SDS Profile
app.post('/api/update-sds-profile', requireAuth('sds'), createProfileUpdateHandler({
    portalName: 'sds', portalLabel: 'SDS', userFile: sdsUsersFile,
    updatableFields: ['office', 'position'],
    responseFields: ['id', 'email', 'name', 'office', 'position']
}));

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

        // SECURITY: Strip password hashes before sending to client (prevents leaking bcrypt hashes)
        const safeRegs = activeRegs.map(({ password, ...rest }) => rest);
        res.json({ success: true, registrations: safeRegs });
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
        const { id, email, processedBy } = req.body;
        // SECURITY: Use session email for audit trail instead of trusting client
        const actualProcessedBy = req.session.email || processedBy;

        let pendingRegs = readJSON(pendingRegistrationsFile);
        const regIndex = pendingRegs.findIndex(r =>
            (id && String(r.id) === String(id)) ||
            (email && r.email === email)
        );

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
                    const normalizedRegName = (registration.fullName || registration.name || '').toUpperCase().replace(/\s+/g, ' ').trim();
                    const regParts = parseFullNameIntoParts(registration.fullName || registration.name || '');
                    const regFirst = (registration.firstName || regParts.firstName || '').toUpperCase().trim();
                    const regLast = (registration.lastName || regParts.lastName || '').toUpperCase().trim();

                    let matchingCard = leavecards.find(lc => {
                        if (lc.email) return false; // Already linked to another user
                        const cardName = (lc.name || lc.fullName || '').toUpperCase().replace(/\s+/g, ' ').trim();
                        // Primary: exact normalized name match
                        if (cardName === normalizedRegName) return true;
                        // Extended: firstName + lastName component match
                        const lcFirst = (lc.firstName || '').toUpperCase().trim();
                        const lcLast = (lc.lastName || '').toUpperCase().trim();
                        if (regFirst && regLast && lcFirst && lcLast &&
                            regFirst === lcFirst && regLast === lcLast) return true;
                        return false;
                    });

                    // Fallback: match by employeeNo if name match failed and registrant provided one
                    let matchMethod = 'name';
                    if (!matchingCard && registration.employeeNo) {
                        const regEmpNo = String(registration.employeeNo).trim();
                        if (regEmpNo) {
                            matchingCard = leavecards.find(lc => {
                                const cardEmpNo = String(lc.employeeNo || '').trim();
                                return cardEmpNo && cardEmpNo === regEmpNo && !lc.email;
                            });
                            if (matchingCard) matchMethod = 'employeeNo';
                        }
                    }
                    
                    if (matchingCard) {
                        // Update existing leave card with new user's email and name fields
                        matchingCard.email = registration.email;
                        matchingCard.employeeId = registration.email;
                        matchingCard.firstName = registration.firstName || matchingCard.firstName || '';
                        matchingCard.lastName = registration.lastName || matchingCard.lastName || '';
                        matchingCard.middleName = registration.middleName || matchingCard.middleName || '';
                        matchingCard.suffix = registration.suffix || matchingCard.suffix || '';
                        matchingCard.updatedAt = new Date().toISOString();
                        writeJSON(leavecardsFile, leavecards);
                        console.log(`[REGISTRATION] Assigned existing leave card to ${registration.email} (matched by ${matchMethod}: ${matchMethod === 'name' ? normalizedRegName : registration.employeeNo})`);

                        // Also link any unlinked CTO records matching this employee's name
                        try {
                            ensureFile(ctoRecordsFile);
                            const ctoRecords = readJSON(ctoRecordsFile);
                            let ctoLinked = 0;
                            ctoRecords.forEach(rec => {
                                if (rec.employeeId || rec.email) return; // Already linked
                                const recName = (rec.name || '').toUpperCase().replace(/\s+/g, ' ').trim();
                                if (recName === normalizedRegName) {
                                    rec.employeeId = registration.email;
                                    rec.email = registration.email;
                                    ctoLinked++;
                                    return;
                                }
                                // Also match by firstName + lastName components
                                const recParts = parseFullNameIntoParts(rec.name || '');
                                const recFirst = (recParts.firstName || '').toUpperCase().trim();
                                const recLast = (recParts.lastName || '').toUpperCase().trim();
                                if (regFirst && regLast && recFirst && recLast &&
                                    regFirst === recFirst && regLast === recLast) {
                                    rec.employeeId = registration.email;
                                    rec.email = registration.email;
                                    ctoLinked++;
                                    return;
                                }
                                // Also try matching by employeeNo
                                if (registration.employeeNo && rec.employeeNo) {
                                    if (String(rec.employeeNo).trim() === String(registration.employeeNo).trim()) {
                                        rec.employeeId = registration.email;
                                        rec.email = registration.email;
                                        ctoLinked++;
                                    }
                                }
                            });
                            if (ctoLinked > 0) {
                                writeJSON(ctoRecordsFile, ctoRecords);
                                console.log(`[REGISTRATION] Linked ${ctoLinked} CTO records to ${registration.email}`);
                            }
                        } catch (ctoLinkErr) {
                            console.error(`[REGISTRATION] CTO linking failed for ${registration.email}:`, ctoLinkErr.message);
                        }
                    } else {
                        // DRY: Use shared helper for default leave card creation
                        const newLeavecard = createDefaultLeaveCard(
                            registration.email,
                            registration.fullName || registration.name,
                            registration,
                            0, 0
                        );
                        leavecards.push(newLeavecard);
                        writeJSON(leavecardsFile, leavecards);
                        console.log(`[REGISTRATION] Created leave card for ${registration.email}: VL=${newLeavecard.vl}, SL=${newLeavecard.sl}, Source=${newLeavecard.initialCreditsSource}`);
                        
                        // Immediately apply catch-up accrual for completed months this year
                        // so the employee doesn't start with VL=0/SL=0
                        // NOTE: Skip for teaching personnel — teachers don't get monthly accrual
                        const regPosition = registration.position || '';
                        const isTeacher = isTeachingPosition(regPosition);
                        if (isTeacher) {
                            console.log(`[REGISTRATION] Skipping catch-up accrual for ${registration.email} (teaching position: ${regPosition})`);
                        }
                        try {
                            ensureFile(systemStateFile);
                            const sysState = readJSON(systemStateFile);
                            const globalLastAccrued = sysState.lastAccruedMonth || null;
                            if (globalLastAccrued && !isTeacher) {
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
                                    if (!newLeavecard.transactions) newLeavecard.transactions = [];
                                    let runningVL = 0, runningSL = 0;
                                    for (let m = 1; m <= monthsToAccrue; m++) {
                                        runningVL = +(runningVL + accrualPerMonth).toFixed(3);
                                        runningSL = +(runningSL + accrualPerMonth).toFixed(3);
                                        newLeavecard.transactions.push(
                                            createAccrualTransaction(m, globalParts[0], runningVL, runningSL, 'system-accrual-catchup')
                                        );
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
            case 'hr':
            case 'asds':
            case 'sds':
                // DRY: All non-employee portals use the same user shape
                targetFile = PORTAL_TO_FILE[registration.portal]();
                newUser = buildPortalUser(registration, registration.portal);
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
        const { id, email, reason, processedBy } = req.body;
        // SECURITY: Use session email for audit trail instead of trusting client
        const actualProcessedBy = req.session.email || processedBy;

        let pendingRegs = readJSON(pendingRegistrationsFile);
        const regIndex = pendingRegs.findIndex(r =>
            (id && String(r.id) === String(id)) ||
            (email && r.email === email)
        );

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
        const filePath = getCategoryFile(category);
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

        const filePath = getCategoryFile(category);
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
            userEmail: req.session?.email || 'IT Admin',
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
            deleteCtoRecords: ctoRecordsFile,
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
            userEmail: req.session?.email || 'IT Admin',
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
            ctoRecordsFile,             // CTO records
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
            userEmail: req.session?.email || 'IT Admin',
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

        // Also remove from ALL other portal user files (full cleanup)
        // This ensures re-registration is possible without orphaned records
        // NOTE: IT portal is excluded — IT accounts use PINs and should only be
        // managed via the dedicated IT staff management (add/remove IT staff).
        // Deleting an employee should NOT delete their IT admin account.
        const allPortalFiles = {
            'employee': usersFile,
            'ao': aoUsersFile,
            'hr': hrUsersFile,
            'asds': asdsUsersFile,
            'sds': sdsUsersFile
        };
        const otherPortalsDeleted = [];
        for (const [pName, pFile] of Object.entries(allPortalFiles)) {
            if (pName === portal.toLowerCase()) continue; // Already handled above
            if (fs.existsSync(pFile)) {
                let pUsers = readJSON(pFile);
                const pIdx = pUsers.findIndex(u => (u.email || '').toLowerCase() === email.toLowerCase());
                if (pIdx !== -1) {
                    pUsers.splice(pIdx, 1);
                    writeJSON(pFile, pUsers);
                    otherPortalsDeleted.push(pName);
                    console.log(`[DELETE] Also removed ${email} from ${pName} portal by ${deletedBy}`);
                }
            }
        }

        // Remove from employees.json
        let empDeleted = false;
        if (fs.existsSync(employeesFile)) {
            let employees = readJSON(employeesFile);
            const empLen = employees.length;
            employees = employees.filter(emp => (emp.email || '').toLowerCase() !== email.toLowerCase());
            if (employees.length < empLen) {
                writeJSON(employeesFile, employees);
                empDeleted = true;
            }
        }

        // Remove leave card
        let lcDeleted = false;
        if (fs.existsSync(leavecardsFile)) {
            let leavecards = readJSON(leavecardsFile);
            const lcLen = leavecards.length;
            leavecards = leavecards.filter(lc => (lc.email || '').toLowerCase() !== email.toLowerCase());
            if (leavecards.length < lcLen) {
                writeJSON(leavecardsFile, leavecards);
                lcDeleted = true;
            }
        }

        // Permanently delete ALL pending registrations for this email
        let regDeleted = false;
        let pendingRegs = readJSON(pendingRegistrationsFile);
        const origRegLen = pendingRegs.length;
        pendingRegs = pendingRegs.filter(r => (r.email || '').toLowerCase() !== email.toLowerCase());
        if (pendingRegs.length < origRegLen) {
            writeJSON(pendingRegistrationsFile, pendingRegs);
            regDeleted = true;
            console.log(`All pending registrations for ${email} permanently deleted by ${deletedBy}`);
        }

        // Remove applications and uploaded files for this user
        let appsDeleted = 0;
        if (fs.existsSync(applicationsFile)) {
            let applications = readJSONArray(applicationsFile);
            const origAppLen = applications.length;
            const userApps = applications.filter(a => (a.employeeEmail || a.email || '').toLowerCase() === email.toLowerCase());
            // Delete uploaded SO PDFs and leave form PDFs for this user's applications
            userApps.forEach(app => {
                try {
                    if (app.soFilePath) {
                        const soFile = path.join(__dirname, 'data', 'uploads', 'so-pdfs', path.basename(app.soFilePath));
                        if (fs.existsSync(soFile)) fs.unlinkSync(soFile);
                    }
                    // Delete generated leave form PDF
                    const safeId = String(app.id).replace(/[^a-zA-Z0-9_-]/g, '_');
                    const leaveFormFile = path.join(leaveFormPdfsDir, `${safeId}.pdf`);
                    if (fs.existsSync(leaveFormFile)) fs.unlinkSync(leaveFormFile);
                } catch (fileErr) {
                    console.error(`[DELETE] Error removing uploaded file for app ${app.id}:`, fileErr.message);
                }
            });
            applications = applications.filter(a => (a.employeeEmail || a.email || '').toLowerCase() !== email.toLowerCase());
            appsDeleted = origAppLen - applications.length;
            if (appsDeleted > 0) {
                writeJSON(applicationsFile, applications);
                console.log(`[DELETE] Removed ${appsDeleted} application(s) for ${email}`);
            }
        }

        // Remove CTO records for this user
        let ctoDeleted = 0;
        if (fs.existsSync(ctoRecordsFile)) {
            let ctoRecords = readJSON(ctoRecordsFile);
            const origCtoLen = ctoRecords.length;
            ctoRecords = ctoRecords.filter(r => (r.employeeId || '').toLowerCase() !== email.toLowerCase());
            ctoDeleted = origCtoLen - ctoRecords.length;
            if (ctoDeleted > 0) {
                writeJSON(ctoRecordsFile, ctoRecords);
                console.log(`[DELETE] Removed ${ctoDeleted} CTO record(s) for ${email}`);
            }
        }

        // Remove initial credits for this user
        let icDeleted = false;
        if (fs.existsSync(initialCreditsFile)) {
            try {
                let icData = readJSON(initialCreditsFile);
                if (icData.credits && Array.isArray(icData.credits)) {
                    const origLen = icData.credits.length;
                    icData.credits = icData.credits.filter(c => (c.email || c.employeeId || '').toLowerCase() !== email.toLowerCase());
                    if (icData.credits.length < origLen) {
                        // Also clean lookupMap
                        if (icData.lookupMap) delete icData.lookupMap[email];
                        writeJSON(initialCreditsFile, icData);
                        icDeleted = true;
                    }
                }
            } catch(e) { /* initial credits may have different shape */ }
        }

        // Destroy active sessions for the deleted user
        // But NEVER destroy the requesting IT admin's own session
        const requestToken = extractToken(req);
        let sessionsDestroyed = 0;
        for (const [token, session] of activeSessions) {
            if (session.email && session.email.toLowerCase() === email.toLowerCase()) {
                // Skip the IT admin's own session token
                if (token === requestToken) continue;
                activeSessions.delete(token);
                sessionsDestroyed++;
            }
        }
        if (sessionsDestroyed > 0) {
            persistSessions();
            console.log(`[DELETE] Destroyed ${sessionsDestroyed} active session(s) for ${email}`);
        }

        if (userDeleted || regDeleted || otherPortalsDeleted.length > 0 || empDeleted || lcDeleted || appsDeleted > 0) {
            // Log user deletion
            logActivity('DATA_DELETION', 'it', {
                userEmail: email,
                action: 'delete-user',
                portal: portal,
                deletedBy: deletedBy,
                userAccountDeleted: userDeleted,
                registrationDeleted: regDeleted,
                employeeRecordDeleted: empDeleted,
                leaveCardDeleted: lcDeleted,
                applicationsDeleted: appsDeleted,
                ctoRecordsDeleted: ctoDeleted,
                initialCreditsDeleted: icDeleted,
                otherPortalsDeleted: otherPortalsDeleted.length > 0 ? otherPortalsDeleted : undefined,
                sessionsDestroyed,
                ip: getClientIp(req),
                userAgent: req.get('user-agent')
            });
            res.json({ success: true, message: 'User and all associated records deleted successfully' });
        } else {
            res.status(404).json({ success: false, error: 'User not found in database' });
        }
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Bulk delete multiple users
// S3 fix: Load shared files ONCE, mutate in memory, write ONCE at the end (was O(N×M) disk I/O)
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

        // Pre-load shared files ONCE instead of re-reading per user
        let pendingRegs = readJSON(pendingRegistrationsFile);
        let leavecards = readJSON(leavecardsFile);
        let employees = readJSON(employeesFile);
        let applications = readJSONArray(applicationsFile);
        let ctoRecords = fs.existsSync(ctoRecordsFile) ? readJSON(ctoRecordsFile) : [];
        let icData = null;
        try { icData = fs.existsSync(initialCreditsFile) ? readJSON(initialCreditsFile) : null; } catch(e) {}
        // Cache portal files: only read each portal file once
        const portalDataCache = {};

        let deletedCount = 0;
        const errors = [];
        let pendingRegsModified = false;
        let leavecardsModified = false;
        let employeesModified = false;
        let applicationsModified = false;
        let ctoModified = false;
        let icModified = false;
        const modifiedPortalFiles = new Set();
        const deletedEmails = new Set();

        // Collect the requesting IT admin's token so we never destroy our own session
        const requestToken = extractToken(req);

        for (const user of deleteList) {
            try {
                const { email, portal } = user;
                if (!email || !portal) {
                    errors.push(`Missing email or portal for user: ${JSON.stringify(user)}`);
                    continue;
                }

                const emailLower = email.toLowerCase();
                const userFile = portalToFile[portal];
                if (!userFile) {
                    errors.push(`Invalid portal '${portal}' for user ${email}`);
                    continue;
                }

                // Load portal file from cache or disk (once per portal)
                if (!portalDataCache[portal]) {
                    portalDataCache[portal] = readJSON(userFile);
                }
                let userData = portalDataCache[portal];
                const originalLength = userData.length;
                userData = userData.filter(u => (u.email || '').toLowerCase() !== emailLower);
                portalDataCache[portal] = userData;

                if (userData.length < originalLength) {
                    modifiedPortalFiles.add(portal);
                    deletedCount++;
                    deletedEmails.add(emailLower);

                    // Also remove from ALL other portal files (full cross-portal cleanup)
                    for (const [pName, pFile] of Object.entries(portalToFile)) {
                        if (pName === portal || pName === 'it') continue;
                        if (!portalDataCache[pName]) portalDataCache[pName] = readJSON(pFile);
                        const pBefore = portalDataCache[pName].length;
                        portalDataCache[pName] = portalDataCache[pName].filter(u => (u.email || '').toLowerCase() !== emailLower);
                        if (portalDataCache[pName].length < pBefore) modifiedPortalFiles.add(pName);
                    }

                    // Permanently remove pending registrations (not just mark deleted)
                    const regBefore = pendingRegs.length;
                    pendingRegs = pendingRegs.filter(r => (r.email || '').toLowerCase() !== emailLower);
                    if (pendingRegs.length < regBefore) pendingRegsModified = true;

                    // Remove leave card
                    const lcBefore = leavecards.length;
                    leavecards = leavecards.filter(lc => (lc.email || '').toLowerCase() !== emailLower);
                    if (leavecards.length < lcBefore) leavecardsModified = true;

                    // Remove from employees
                    const empBefore = employees.length;
                    employees = employees.filter(emp => (emp.email || '').toLowerCase() !== emailLower);
                    if (employees.length < empBefore) employeesModified = true;

                    // Remove applications and uploaded files
                    const userApps = applications.filter(a => (a.employeeEmail || a.email || '').toLowerCase() === emailLower);
                    userApps.forEach(app => {
                        try {
                            if (app.soFilePath) {
                                const soFile = path.join(__dirname, 'data', 'uploads', 'so-pdfs', path.basename(app.soFilePath));
                                if (fs.existsSync(soFile)) fs.unlinkSync(soFile);
                            }
                            const safeId = String(app.id).replace(/[^a-zA-Z0-9_-]/g, '_');
                            const leaveFormFile = path.join(leaveFormPdfsDir, `${safeId}.pdf`);
                            if (fs.existsSync(leaveFormFile)) fs.unlinkSync(leaveFormFile);
                        } catch(e) { /* non-fatal */ }
                    });
                    const appBefore = applications.length;
                    applications = applications.filter(a => (a.employeeEmail || a.email || '').toLowerCase() !== emailLower);
                    if (applications.length < appBefore) applicationsModified = true;

                    // Remove CTO records
                    const ctoBefore = ctoRecords.length;
                    ctoRecords = ctoRecords.filter(r => (r.employeeId || '').toLowerCase() !== emailLower);
                    if (ctoRecords.length < ctoBefore) ctoModified = true;

                    // Remove initial credits
                    if (icData && icData.credits && Array.isArray(icData.credits)) {
                        const icBefore = icData.credits.length;
                        icData.credits = icData.credits.filter(c => (c.email || c.employeeId || '').toLowerCase() !== emailLower);
                        if (icData.credits.length < icBefore) {
                            if (icData.lookupMap) delete icData.lookupMap[email];
                            icModified = true;
                        }
                    }

                    console.log(`[BULK DELETE] Deleted user: ${email} (${portal})`);
                } else {
                    errors.push(`User ${email} not found in ${portal} database`);
                }
            } catch (userError) {
                errors.push(`Error deleting ${user.email}: ${userError.message}`);
            }
        }

        // Destroy active sessions for all deleted users
        let sessionsDestroyed = 0;
        for (const [token, session] of activeSessions) {
            if (session.email && deletedEmails.has(session.email.toLowerCase())) {
                if (token === requestToken) continue;
                activeSessions.delete(token);
                sessionsDestroyed++;
            }
        }
        if (sessionsDestroyed > 0) persistSessions();

        // Write all modified files ONCE at the end
        for (const portal of modifiedPortalFiles) {
            writeJSON(portalToFile[portal], portalDataCache[portal]);
        }
        if (pendingRegsModified) writeJSON(pendingRegistrationsFile, pendingRegs);
        if (leavecardsModified) writeJSON(leavecardsFile, leavecards);
        if (employeesModified) writeJSON(employeesFile, employees);
        if (applicationsModified) writeJSON(applicationsFile, applications);
        if (ctoModified) writeJSON(ctoRecordsFile, ctoRecords);
        if (icModified && icData) writeJSON(initialCreditsFile, icData);

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
        
        // ===== STRUCTURAL VALIDATION: Required fields =====
        const requiredFields = ['leaveType', 'dateFrom', 'dateTo', 'numDays', 'employeeName'];
        for (const field of requiredFields) {
            if (!applicationData[field] || !String(applicationData[field]).trim()) {
                return res.status(400).json({ success: false, error: `Missing required field: ${field}`, message: `Please fill in the ${field} field before submitting.` });
            }
        }
        
        const leaveType = applicationData.leaveType;
        const numDays = parseFloat(applicationData.numDays) || 0;
        
        if (numDays <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid number of days',
                message: 'Number of leave days must be greater than zero.'
            });
        }
        
        // SECURITY: Validate date fields
        if (!isValidDate(applicationData.dateFrom)) {
            return res.status(400).json({ success: false, error: 'Invalid start date format', message: 'Date From must be in YYYY-MM-DD format.' });
        }
        if (!isValidDate(applicationData.dateTo)) {
            return res.status(400).json({ success: false, error: 'Invalid end date format', message: 'Date To must be in YYYY-MM-DD format.' });
        }
        
        // ===== DATE RANGE VALIDATION: dateTo must be >= dateFrom =====
        if (new Date(applicationData.dateTo) < new Date(applicationData.dateFrom)) {
            return res.status(400).json({ success: false, error: 'Invalid date range', message: 'End date must be on or after start date.' });
        }
        
        // ===== DUPLICATE SUBMISSION DETECTION =====
        // Reject if the same employee already has a pending/approved leave overlapping the same dates
        const dupApp = applications.find(a => {
            if (a.employeeEmail !== employeeEmail) return false;
            if (a.status === 'rejected' || a.status === 'returned') return false;
            if (a.leaveType !== leaveType) return false;
            // Check date overlap: A.start <= B.end && A.end >= B.start
            const existStart = new Date(a.dateFrom);
            const existEnd = new Date(a.dateTo);
            const newStart = new Date(applicationData.dateFrom);
            const newEnd = new Date(applicationData.dateTo);
            return existStart <= newEnd && existEnd >= newStart;
        });
        if (dupApp) {
            return res.status(409).json({ success: false, error: 'Duplicate leave application', message: `You already have a ${dupApp.status} ${leaveType.replace('leave_', '').toUpperCase()} leave application (${dupApp.id}) covering overlapping dates. Please check your existing applications.` });
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
            soFileData: null,  // No longer stored inline — saved to disk below
            soFileName: applicationData.soFileName || '',
            soFilePath: null,  // Will be set if SO file was uploaded
            isSchoolBased: schoolBased,
            status: 'pending',
            currentApprover: 'AO',
            approvalHistory: [],
            submittedAt: new Date().toISOString()
        };
        
        applications.push(newApplication);
        
        // Save SO PDF file to disk if provided (instead of keeping base64 in JSON)
        if (applicationData.soFileData && applicationData.soFileName) {
            try {
                const base64Match = applicationData.soFileData.match(/^data:[^;]+;base64,(.+)$/);
                if (base64Match) {
                    const pdfBuffer = Buffer.from(base64Match[1], 'base64');
                    // SECURITY: Validate PDF magic bytes before writing to disk
                    if (pdfBuffer.length < 4 || pdfBuffer.toString('ascii', 0, 4) !== '%PDF') {
                        console.warn('[UPLOAD] Rejected non-PDF file upload for application', applicationId);
                    } else {
                        const ext = path.extname(applicationData.soFileName) || '.pdf';
                        const safeId = applicationId.replace(/[^a-zA-Z0-9_-]/g, '_');
                        const soFilename = `${safeId}_SO${ext}`;
                        const soFilePath = path.join(soPdfsDir, soFilename);
                        fs.writeFileSync(soFilePath, pdfBuffer);
                        newApplication.soFilePath = `/api/uploads/so-pdfs/${soFilename}`;
                        console.log(`[UPLOAD] Saved SO PDF to disk: ${soFilename}`);
                    }
                }
            } catch (soErr) {
                console.error('[UPLOAD] Error saving SO PDF to disk:', soErr);
                // Non-fatal: application is still saved, just without disk file
            }
        }
        
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
        
        // Send email notifications (fire-and-forget)
        notifyLeaveSubmitted(newApplication);
        notifyNextApprover(newApplication, 'AO');
        
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
        
        const applications = readJSONArray(applicationsFile);
        const app = findApplicationById(applications, idParam);
        
        if (!app) {
            console.error('Application not found:', { idParam, totalApps: applications.length });
            return res.status(404).json({ success: false, error: 'Application not found' });
        }
        
        // SECURITY: Only allow access to own application unless admin role
        if (!isSelfOrAdmin(req, app.employeeEmail)) {
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
        if (!isSelfOrAdmin(req, email)) {
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
        const application = findApplicationById(applications, idParam);
        
        if (!application) {
            return res.status(404).json({ success: false, error: 'Application not found' });
        }
        
        // SECURITY: Only allow access to own application unless admin role
        if (!isSelfOrAdmin(req, application.employeeEmail)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }
        
        res.json({ success: true, application: application });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Serve printable CS Form No. 6 view page
app.get('/api/form-no6/:id', requireAuth(), (req, res) => {
    res.redirect(`/form-no6-view.html?id=${encodeURIComponent(req.params.id)}`);
});

// ========== UPLOAD FILE SERVING ==========

// Serve SO PDFs from disk
app.get('/api/uploads/so-pdfs/:filename', requireAuth(), (req, res) => {
    const filename = path.basename(req.params.filename); // prevent path traversal
    const filePath = path.join(soPdfsDir, filename);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ success: false, error: 'File not found' });
    }
    res.sendFile(filePath);
});

// Save client-generated leave form PDF
app.post('/api/save-leave-form-pdf/:id', requireAuth(), (req, res) => {
    try {
        const idParam = req.params.id;
        const { pdfData } = req.body; // base64 data URI
        
        if (!pdfData) {
            return res.status(400).json({ success: false, error: 'No PDF data provided' });
        }
        
        // Verify application exists and user has access
        const applications = readJSONArray(applicationsFile);
        const appIndex = findApplicationIndexById(applications, idParam);
        if (appIndex === -1) {
            return res.status(404).json({ success: false, error: 'Application not found' });
        }
        
        if (!isSelfOrAdmin(req, applications[appIndex].employeeEmail)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }
        
        // Decode base64 and save to disk
        // jsPDF datauristring format: data:application/pdf;filename=generated.pdf;base64,...
        const base64Match = pdfData.match(/;base64,(.+)$/);
        const rawBase64 = base64Match ? base64Match[1] : pdfData;
        const pdfBuffer = Buffer.from(rawBase64, 'base64');
        
        if (pdfBuffer.length < 100) {
            console.error(`[PDF] Generated buffer too small (${pdfBuffer.length} bytes) — likely a decoding error`);
            return res.status(400).json({ success: false, error: 'PDF data appears invalid or empty' });
        }
        
        const safeId = idParam.replace(/[^a-zA-Z0-9_-]/g, '_');
        const pdfFilename = `${safeId}_leave-form.pdf`;
        const pdfFilePath = path.join(leaveFormPdfsDir, pdfFilename);
        
        fs.writeFileSync(pdfFilePath, pdfBuffer);
        
        // Store the path reference in the application record
        applications[appIndex].leaveFormPdfPath = `/api/uploads/leave-forms/${pdfFilename}`;
        applications[appIndex].leaveFormPdfGeneratedAt = new Date().toISOString();
        writeJSON(applicationsFile, applications);
        
        console.log(`[PDF] Saved leave form PDF for ${idParam}: ${pdfFilename}`);
        res.json({ 
            success: true, 
            message: 'PDF saved successfully',
            pdfUrl: `/api/uploads/leave-forms/${pdfFilename}`
        });
    } catch (error) {
        console.error('[PDF] Error saving leave form PDF:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Serve leave form PDFs from disk
app.get('/api/uploads/leave-forms/:filename', requireAuth(), (req, res) => {
    const filename = path.basename(req.params.filename); // prevent path traversal
    const filePath = path.join(leaveFormPdfsDir, filename);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ success: false, error: 'File not found' });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.sendFile(filePath);
});

// Check if a leave form PDF exists for an application
app.get('/api/leave-form-pdf-status/:id', requireAuth(), (req, res) => {
    try {
        const idParam = req.params.id;
        const safeId = idParam.replace(/[^a-zA-Z0-9_-]/g, '_');
        const pdfFilename = `${safeId}_leave-form.pdf`;
        const pdfFilePath = path.join(leaveFormPdfsDir, pdfFilename);
        const exists = fs.existsSync(pdfFilePath);
        res.json({ 
            success: true, 
            exists,
            pdfUrl: exists ? `/api/uploads/leave-forms/${pdfFilename}` : null
        });
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
app.get('/api/hr-approved-applications', requireAuth('hr', 'asds', 'sds', 'it'), (req, res) => {
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
app.get('/api/all-users', requireAuth('ao', 'hr', 'asds', 'sds', 'it'), (req, res) => {
    try {
        const users = readJSON(usersFile);
        // SECURITY: Strip password hashes before sending to client
        let safeUsers = users.map(({ password, ...rest }) => rest);
        
        // AO school-based filtering: AO can only see users from their school
        if (req.session.role === 'ao' && req.session.office && !isAoDivisionLevel(req.session.office)) {
            safeUsers = safeUsers.filter(u => isEmployeeInAoSchool(u.office || u.school, req.session.office));
        }
        
        res.json({ success: true, users: safeUsers });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get all applications for demographics
app.get('/api/all-applications', requireAuth('ao', 'hr', 'asds', 'sds', 'it'), (req, res) => {
    try {
        let applications = readJSONArray(applicationsFile);
        
        // AO school-based filtering: AO can only see applications from their school's employees
        // S2 fix: Pre-load user/employee data once, pass as cache to avoid O(N×2) disk reads
        if (req.session.role === 'ao' && req.session.office && !isAoDivisionLevel(req.session.office)) {
            const aoOffice = req.session.office;
            const usersCache = readJSON(usersFile);
            const employeesCache = readJSON(employeesFile);
            applications = applications.filter(app => {
                const empOffice = getEmployeeOffice(app.employeeEmail || app.email, usersCache, employeesCache);
                return isEmployeeInAoSchool(empOffice, aoOffice);
            });
        }
        
        res.json({ success: true, applications: applications });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Leave calendar data — returns approved leaves with date ranges for calendar display
// Accessible to all admin roles for planning purposes
app.get('/api/leave-calendar', requireAuth('ao', 'hr', 'asds', 'sds', 'it'), (req, res) => {
    try {
        const { month, year } = req.query;
        const applications = readJSONArray(applicationsFile);
        
        // Filter to approved or pending leaves
        let relevantApps = applications.filter(a => a.status === 'approved' || a.status === 'pending');
        
        // If month/year provided, filter to apps that overlap that month
        if (month && year) {
            const m = parseInt(month), y = parseInt(year);
            const monthStart = new Date(y, m - 1, 1);
            const monthEnd = new Date(y, m, 0); // last day of month
            relevantApps = relevantApps.filter(a => {
                const start = new Date(a.dateFrom);
                const end = new Date(a.dateTo);
                return start <= monthEnd && end >= monthStart;
            });
        }
        
        // AO school-based filtering
        if (req.session.role === 'ao' && req.session.office && !isAoDivisionLevel(req.session.office)) {
            const aoOffice = req.session.office;
            const usersCache = readJSON(usersFile);
            const employeesCache = readJSON(employeesFile);
            relevantApps = relevantApps.filter(a => {
                const empOffice = getEmployeeOffice(a.employeeEmail || a.email, usersCache, employeesCache);
                return isEmployeeInAoSchool(empOffice, aoOffice);
            });
        }
        
        // Return minimal data for calendar rendering
        const calendarData = relevantApps.map(a => ({
            id: a.id,
            employeeName: a.employeeName || a.employeeEmail,
            office: a.office || '',
            leaveType: a.leaveType || '',
            dateFrom: a.dateFrom,
            dateTo: a.dateTo,
            numDays: a.numDays,
            status: a.status,
            currentApprover: a.currentApprover
        }));
        
        res.json({ success: true, leaves: calendarData });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Top 5 employees by leave utilization — for ASDS/SDS/IT analytics
app.get('/api/leave-utilization/top5', requireAuth('asds', 'sds', 'it'), (req, res) => {
    try {
        const applications = readJSONArray(applicationsFile);
        const year = parseInt(req.query.year) || new Date().getFullYear();
        const approved = applications.filter(a => {
            if (a.status !== 'approved') return false;
            const d = new Date(a.dateFrom || a.date_from || a.submittedAt || '');
            return d.getFullYear() === year;
        });

        // Aggregate total days by employee
        const byEmployee = {};
        for (const a of approved) {
            const name = a.employeeName || a.employeeEmail || 'Unknown';
            const key = (a.employeeEmail || name).toLowerCase();
            if (!byEmployee[key]) {
                byEmployee[key] = { name, office: a.office || '', position: a.position || '', totalDays: 0, count: 0 };
            }
            byEmployee[key].totalDays += parseFloat(a.numDays) || 0;
            byEmployee[key].count++;
        }

        const sorted = Object.values(byEmployee)
            .sort((a, b) => b.totalDays - a.totalDays)
            .slice(0, 5)
            .map((e, i) => ({ rank: i + 1, ...e, totalDays: +e.totalDays.toFixed(1) }));

        res.json({ success: true, top5: sorted, year });
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

        let employees = Array.from(employeeMap.values());
        
        // AO school-based filtering: AO can only see employees from their own school
        if (req.session.role === 'ao' && req.session.office) {
            const aoOffice = req.session.office;
            if (!isAoDivisionLevel(aoOffice)) {
                employees = employees.filter(emp => isEmployeeInAoSchool(emp.office, aoOffice));

            }
        }
        
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
            const wasReturnedByPortal = a.returnedBy === portal;
            const hasHistoryFromPortal = Array.isArray(a.approvalHistory) &&
                a.approvalHistory.some(h => (h.portal || '').toUpperCase() === portal);

            return isCurrentApprover || hasApprovedByPortal || isRejectedByPortal || wasReturnedByPortal || hasHistoryFromPortal;
        });
        
        // AO school-based filtering: AO can only see applications from their school's employees
        // S2 fix: Pre-load data once for filter loop
        if (req.session.role === 'ao' && req.session.office && !isAoDivisionLevel(req.session.office)) {
            const aoOffice = req.session.office;
            const usersCache = readJSON(usersFile);
            const employeesCache = readJSON(employeesFile);
            portalApps = portalApps.filter(app => {
                const empOffice = getEmployeeOffice(app.employeeEmail || app.email, usersCache, employeesCache);
                return isEmployeeInAoSchool(empOffice, aoOffice);
            });

        }
        
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
        if (!isSelfOrAdmin(req, employeeId)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }
        
        // AO school-based filtering
        if (!isAoAccessAllowed(req, employeeId)) {
            return res.status(403).json({ success: false, error: 'Access denied. This employee is not from your school.' });
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
        const latestRecord = getLatestLeaveCard(employeeRecords);
        
        const currentYear = new Date().getFullYear();

        // Single source of truth: vl/sl summary fields
        // These are updated by accrual, SDS approval, and AO edits — always current
        // transactions[] and leaveUsageHistory[] are audit logs only, not used for balance
        let vlBalance = (latestRecord.vl !== undefined) ? latestRecord.vl : null;
        let slBalance = (latestRecord.sl !== undefined) ? latestRecord.sl : null;

        // FL / SPL / WL are annual quotas — compute from approved leave applications
        // filed in the current calendar year.  We do NOT use the card's forceLeaveSpent /
        // splSpent / wellnessSpent fields because those accumulate across years (especially
        // for Excel-imported cards where forceLeaveYear can already be the current year
        // but the spent value was never reset, or transaction dateRecorded defaults to now).
        const allApplications = readJSONArray(applicationsFile);
        let totalForceSpent = 0, totalSplSpent = 0, totalWellnessSpent = 0;
        allApplications.forEach(app => {
            if (app.employeeEmail !== employeeId && app.email !== employeeId) return;
            if (app.status !== 'approved') return;
            const appYear = new Date(app.dateOfFiling || app.createdAt || 0).getFullYear();
            if (appYear !== currentYear) return;
            const days = parseFloat(app.numDays) || 0;
            if (days <= 0) return;
            const type = (app.leaveType || '').toLowerCase();
            if (type.includes('mfl') || type.includes('mandatory') || type.includes('forced')) totalForceSpent   += days;
            else if (type.includes('spl') || type.includes('special'))                         totalSplSpent     += days;
            else if (type.includes('wellness') || type === 'leave_wl')                         totalWellnessSpent += days;
        });
        
        // Fallback for legacy cards without vl/sl fields
        const vacationLeaveEarned = latestRecord.vacationLeaveEarned || 0;
        const sickLeaveEarned = latestRecord.sickLeaveEarned || 0;
        
        if (vlBalance === null) {
            vlBalance = Math.max(0, vacationLeaveEarned - (latestRecord.vacationLeaveSpent || 0));
        }
        if (slBalance === null) {
            slBalance = Math.max(0, sickLeaveEarned - (latestRecord.sickLeaveSpent || 0));
        }
        

        
        // Compute "spent" values from the balance for backward compat
        let vacationLeaveSpent = Math.max(0, vacationLeaveEarned - vlBalance);
        let sickLeaveSpent = Math.max(0, sickLeaveEarned - slBalance);
        
        // Leave card balances are now strictly based on leave card entries.
        // Leave applications no longer auto-adjust balances.
        
        const flEarned  = latestRecord.forceLeaveEarned || latestRecord.mandatoryForced || latestRecord.others || 5;
        const splEarned = latestRecord.splEarned || latestRecord.spl || 3;
        const wlEarned  = latestRecord.wellnessEarned || 5;

        // Cap spent at annual allotment so balance never goes below 0.
        const safeFlSpent  = Math.min(totalForceSpent,    flEarned);
        const safeSplSpent = Math.min(totalSplSpent,      splEarned);
        const safeWlSpent  = Math.min(totalWellnessSpent, wlEarned);

        // Ensure the credits object has all required fields with defaults
        const enrichedCredits = {
            ...latestRecord,
            vacationLeaveEarned: vacationLeaveEarned,
            sickLeaveEarned: sickLeaveEarned,
            forceLeaveEarned: flEarned,
            splEarned: splEarned,
            wellnessEarned: wlEarned,
            vacationLeaveSpent: vacationLeaveSpent,
            sickLeaveSpent: sickLeaveSpent,
            forceLeaveSpent: safeFlSpent,
            splSpent: safeSplSpent,
            wellnessSpent: safeWlSpent,
            forceLeaveYear: currentYear,
            splYear: currentYear,
            wellnessYear: currentYear,
            leaveUsageHistory: latestRecord.leaveUsageHistory || [],
            // Direct balance values for dashboard convenience
            currentVlBalance: vlBalance,
            currentSlBalance: slBalance
        };
        
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
        if (!isSelfOrAdmin(req, employeeId)) {
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
        const latestRecord = getLatestLeaveCard(employeeRecords);
        
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
        if (!isSelfOrAdmin(req, employeeId)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }
        
        const leavecards = readJSON(leavecardsFile);
        
        // Try to find by employeeId first, then by email (since we use email as ID now)
        let leavecard = leavecards.find(lc => lc.employeeId === employeeId || lc.email === employeeId);
        

        
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
        if (!isSelfOrAdmin(req, email)) {
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
        
        // Update application with only allowed fields from resubmission (prevent mass assignment)
        if (updatedData) {
            const allowedResubmitFields = [
                // Core leave fields (editable on resubmit)
                'leaveType', 'dateFrom', 'dateTo', 'numDays',
                'leaveHours', 'isHalfDay',
                // Conditional fields
                'locationPH', 'locationAbroad', 'abroadSpecify',
                'sickHospital', 'sickOutpatient', 'hospitalIllness', 'outpatientIllness',
                'studyMasters', 'studyBar',
                'womenIllness',
                'otherLeaveSpecify',
                // Documents and signature
                'soFileData', 'soFileName',
                'employeeSignature',
                'complianceDocuments', 'supportingDocuments',
                // Commutation and remarks
                'commutation', 'remarks',
            ];
            for (const field of allowedResubmitFields) {
                if (updatedData[field] !== undefined) {
                    app[field] = updatedData[field];
                }
            }

            // Save SO PDF file to disk if provided on resubmit
            if (updatedData.soFileData && updatedData.soFileName) {
                try {
                    const base64Match = updatedData.soFileData.match(/^data:[^;]+;base64,(.+)$/);
                    if (base64Match) {
                        const pdfBuffer = Buffer.from(base64Match[1], 'base64');
                        if (pdfBuffer.length >= 4 && pdfBuffer.toString('ascii', 0, 4) === '%PDF') {
                            const ext = path.extname(updatedData.soFileName) || '.pdf';
                            const safeId = applicationId.replace(/[^a-zA-Z0-9_-]/g, '_');
                            const soFilename = `${safeId}_SO${ext}`;
                            const soFilePath = path.join(soPdfsDir, soFilename);
                            fs.writeFileSync(soFilePath, pdfBuffer);
                            app.soFilePath = `/api/uploads/so-pdfs/${soFilename}`;
                            app.soFileData = null; // Don't store base64 inline
                            console.log(`[UPLOAD] Saved resubmit SO PDF to disk: ${soFilename}`);
                        }
                    }
                } catch (err) {
                    console.error('[UPLOAD] Failed to save resubmit SO PDF:', err.message);
                }
            }

            // Update dateOfFiling to resubmission date
            app.dateOfFiling = new Date().toISOString().split('T')[0];
        }
        
        // Clear stale approval data from previous round to prevent scrambled formulas
        // These will be re-set by HR when the application is re-processed
        const staleApprovalFields = [
            'vlEarned', 'vlLess', 'vlBalance',
            'slEarned', 'slLess', 'slBalance',
            'splEarned', 'splLess', 'splBalance',
            'flEarned', 'flLess', 'flBalance',
            'ctoEarned', 'ctoLess', 'ctoBalance',
            'authorizedOfficerName', 'authorizedOfficerSignature',
            'asdsOfficerName', 'asdsOfficerSignature',
            'sdsOfficerName', 'sdsOfficerSignature',
            'aoApprovedAt', 'hrApprovedAt', 'asdsApprovedAt', 'sdsApprovedAt',
            'finalApprovalAt', 'rejectedAt', 'rejectedBy', 'rejectedByName', 'rejectionReason'
        ];
        for (const field of staleApprovalFields) {
            delete app[field];
        }
        
        // Add to approval history
        app.approvalHistory.push({
            portal: 'EMPLOYEE',
            action: 'resubmitted',
            approverName: app.employeeName,
            remarks: updatedData?.remarks || 'Application resubmitted after compliance review',
            timestamp: new Date().toISOString()
        });
        
        // Reset status and send back to AO
        app.status = 'pending';
        app.currentApprover = 'AO';
        app.resubmittedAt = new Date().toISOString();
        
        applications[appIndex] = app;
        writeJSON(applicationsFile, applications);
        
        console.log(`[LEAVE] Application ${applicationId} resubmitted by ${app.employeeName}`);
        
        // Log activity for employee resubmission
        logActivity('LEAVE_APPLICATION_RESUBMITTED', 'employee', {
            userEmail: employeeEmail,
            applicationId: applicationId,
            leaveType: app.leaveType,
            returnedBy: app.returnedBy,
            remarks: updatedData?.remarks || 'Resubmitted after compliance review',
            ip: getClientIp(req),
            userAgent: req.get('user-agent')
        });
        
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
            replaceTransactions,
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
        
        // Validate employeeEmail is provided
        if (!employeeEmail) {
            return res.status(400).json({ success: false, error: 'employeeEmail is required' });
        }
        
        // AO school-based filtering
        if (!isAoAccessAllowed(req, employeeEmail)) {
            return res.status(403).json({ success: false, error: 'Access denied. This employee is not from your school.' });
        }
        
        // Verify employee exists in users or employees data
        const users = readJSON(usersFile);
        const employees = readJSON(employeesFile);
        const userExists = users.some(u => u.email === employeeEmail);
        const employeeExists = employees.some(e => e.email === employeeEmail || e.employeeId === employeeEmail);
        if (!userExists && !employeeExists) {
            console.log(`[UPDATE LEAVE] Warning: employeeEmail ${employeeEmail} not found in users or employees - proceeding anyway for legacy cards`);
        }
        
        let leavecards = readJSON(leavecardsFile);
        
        // Use email as primary lookup key since that's what we have from applications

        
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

            const normalized = normalizeLeaveCardTransactions(employeeLeave.transactions);
            employeeLeave.transactions = normalized.transactions;
            employeeLeave.vl = normalized.summary.vl;
            employeeLeave.sl = normalized.summary.sl;
            employeeLeave.vacationLeaveEarned = normalized.summary.vacationLeaveEarned;
            employeeLeave.sickLeaveEarned = normalized.summary.sickLeaveEarned;
            employeeLeave.vacationLeaveSpent = normalized.summary.vacationLeaveSpent;
            employeeLeave.sickLeaveSpent = normalized.summary.sickLeaveSpent;
            employeeLeave.forceLeaveSpent = normalized.summary.forceLeaveSpent;
            employeeLeave.splSpent = normalized.summary.splSpent;
            employeeLeave.pvpDeductionTotal = normalized.summary.pvpDeductionTotal;
            leavecards.push(employeeLeave);
            console.log('[UPDATE LEAVE] Created new leave card record for:', employeeEmail);
        } else {
            // Update with new transactions
            if (transactions && Array.isArray(transactions)) {
                employeeLeave.transactions = employeeLeave.transactions || [];
                const editDate = new Date().toISOString();
                const incoming = transactions.map(txn => ({ ...txn, dateRecorded: txn.dateRecorded || editDate }));
                const mergedTransactions = replaceTransactions ? incoming : [...employeeLeave.transactions, ...incoming];
                const normalized = normalizeLeaveCardTransactions(mergedTransactions);
                employeeLeave.transactions = normalized.transactions;
                employeeLeave.vl = normalized.summary.vl;
                employeeLeave.sl = normalized.summary.sl;
                employeeLeave.vacationLeaveEarned = normalized.summary.vacationLeaveEarned;
                employeeLeave.sickLeaveEarned = normalized.summary.sickLeaveEarned;
                employeeLeave.vacationLeaveSpent = normalized.summary.vacationLeaveSpent;
                employeeLeave.sickLeaveSpent = normalized.summary.sickLeaveSpent;
                employeeLeave.forceLeaveSpent = normalized.summary.forceLeaveSpent;
                employeeLeave.splSpent = normalized.summary.splSpent;
                employeeLeave.pvpDeductionTotal = normalized.summary.pvpDeductionTotal;

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

        }
        
        writeJSON(leavecardsFile, leavecards);

        
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
        const { applicationId, action, approverPortal: _approverPortal, portal, approverName, remarks, authorizedOfficerName, authorizedOfficerSignature, asdsOfficerName, asdsOfficerSignature, sdsOfficerName, sdsOfficerSignature, vlEarned, vlLess, vlBalance, slEarned, slLess, slBalance, splEarned, splLess, splBalance, flEarned, flLess, flBalance, ctoEarned, ctoLess, ctoBalance } = req.body;
        const approverPortal = _approverPortal || portal;
        const ip = getClientIp(req);

        // Validate action against whitelist
        const VALID_ACTIONS = ['approved', 'returned', 'rejected'];
        if (!action || !VALID_ACTIONS.includes(action)) {
            return res.status(400).json({ success: false, error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}` });
        }

        const applications = readJSONArray(applicationsFile);
        // Handle both string and number applicationId
        const appIndex = applications.findIndex(a => a.id === applicationId || a.id === parseInt(applicationId));

        if (appIndex === -1) {
            console.error('[APPROVE-LEAVE] Application not found:', applicationId);
            return res.status(404).json({ success: false, error: 'Application not found' });
        }

        const app = applications[appIndex];


        // AO school-based filtering
        if (!isAoAccessAllowed(req, app.employeeEmail || app.email)) {
            return res.status(403).json({ success: false, error: 'Access denied. This employee is not from your school.' });
        }
        
        // SECURITY: Use session role instead of trusting client-provided portal
        // Map session role to portal name (prevents portal spoofing attack)
        const roleToPortal = { 'ao': 'AO', 'hr': 'HR', 'asds': 'ASDS', 'sds': 'SDS' };
        const sessionRole = req.session?.role;
        const currentApprover = roleToPortal[sessionRole] || (approverPortal || '').toUpperCase();
        
        // Block action on already-finalized applications
        if (app.status === 'approved' || app.status === 'rejected') {
            return res.status(403).json({ 
                success: false, 
                error: `This application has already been ${app.status}. No further action can be taken.`
            });
        }
        
        // Validate that the session role matches what the application expects
        if (currentApprover !== app.currentApprover) {
            console.log(`[APPROVE-LEAVE] Portal mismatch: session role=${sessionRole} (${currentApprover}), app expects=${app.currentApprover}`);
            return res.status(403).json({ 
                success: false, 
                error: `This application is currently waiting for ${app.currentApprover || 'unknown'} approval. You cannot act on it as ${currentApprover}.`
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
        // Resolve the approver's full name from user records (not just email)
        const resolvedApproverName = lookupUserName(req.session.email) || approverName;
        
        app.approvalHistory.push({
            portal: currentApprover,
            action: action,
            approverName: resolvedApproverName,
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
            
            // Email notification for return
            notifyLeaveReturned(app, currentApprover, remarks);
            
        } else if (action === 'rejected') {
            // Final rejection - application is permanently rejected
            app.status = 'rejected';
            app.currentApprover = null;
            app.rejectedAt = new Date().toISOString();
            app.rejectedBy = currentApprover;
            app.rejectedByName = resolvedApproverName;
            app.rejectionReason = remarks;
            
            console.log(`[LEAVE] Application ${applicationId} REJECTED by ${approverPortal} - Reason: ${remarks}`);
            
            // Email notification for rejection
            notifyLeaveRejected(app, currentApprover, remarks);
            
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
            
            // Email notification for approval (fire-and-forget)
            notifyLeaveApproved(app, currentApprover, app.currentApprover);
        }
        
        applications[appIndex] = app;
        writeJSON(applicationsFile, applications);
        
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
/**
 * Update employee leave balance after SDS final approval.
 * YAGNI/S8 fix: Removed dead `leaveCredits` field from employees.json.
 * The single source of truth for balances is leavecards.json (vl/sl fields).
 */
function updateEmployeeLeaveBalance(application) {
    try {
        const leaveType = application.typeOfLeave || application.leaveType || '';
        console.log(`[LEAVE] Auto leave-card update skipped for ${application.employeeEmail} (${leaveType}). AO manual encoding is required.`);
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
                wellnessEarned: 5,
                vacationLeaveSpent: 0,
                sickLeaveSpent: 0,
                forceLeaveSpent: 0,
                splSpent: 0,
                wellnessSpent: 0,
                forceLeaveYear: currentYear,
                splYear: currentYear,
                wellnessYear: currentYear,
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
        if (!leavecard.wellnessYear) leavecard.wellnessYear = currentYear;

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

        // Reset Wellness Leave balance if year has changed
        if (leavecard.wellnessYear !== currentYear) {
            leavecard.wellnessSpent = 0;
            leavecard.wellnessEarned = 5;
            leavecard.wellnessYear = currentYear;
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
        let wellnessUsed = 0;

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
            } else if (lType === 'leave_wl' || lType === 'leave_wellness' || lType === 'wellness' || String(lType).toLowerCase().includes('wellness')) {
                leaveType = 'Wellness Leave';
                daysUsed = parseFloat(application.numDays) || parseFloat(application.daysApplied) || 1;
                wellnessUsed = daysUsed;
            }
        }

        // If no specific leave type matched, use VL/SL
        if (!forceLeaveUsed && !splUsed && !wellnessUsed) {
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
            // Force Leave: 5-day yearly allocation, deducted from VL balance
            leavecard.forceLeaveSpent = (leavecard.forceLeaveSpent || 0) + forceLeaveUsed;
            // Also deduct from VL since FL draws from vacation leave accrual
            leavecard.vl = Math.max(0, (leavecard.vl || 0) - forceLeaveUsed);
            leavecard.vacationLeaveSpent = (leavecard.vacationLeaveSpent || 0) + forceLeaveUsed;
        } else if (splUsed > 0) {
            leavecard.splSpent = (leavecard.splSpent || 0) + splUsed;
        } else if (wellnessUsed > 0) {
            // Wellness Leave is a separate 5-day yearly allocation
            leavecard.wellnessSpent = (leavecard.wellnessSpent || 0) + wellnessUsed;
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
            // VL/SL deduction — negative balances are NOT allowed and NOT charged to other leave types
            if (slUsed > 0) {
                const currentSl = leavecard.sl || 0;
                // Only deduct what SL can cover — do NOT charge remainder to VL
                const actualSlDeduction = Math.min(slUsed, currentSl);
                leavecard.sl = Math.max(0, currentSl - actualSlDeduction);
                leavecard.sickLeaveSpent = (leavecard.sickLeaveSpent || 0) + actualSlDeduction;
                if (slUsed > currentSl) {
                    console.log(`[LEAVECARD] SL capped: requested ${slUsed} but only ${currentSl} available. NOT charging VL for ${application.employeeEmail}`);
                }
            }
            if (vlUsed > 0) {
                const currentVl = leavecard.vl || 0;
                const actualVlDeduction = Math.min(vlUsed, currentVl);
                leavecard.vl = Math.max(0, currentVl - actualVlDeduction);
                leavecard.vacationLeaveSpent = (leavecard.vacationLeaveSpent || 0) + actualVlDeduction;
                if (vlUsed > currentVl) {
                    console.log(`[LEAVECARD] VL capped: requested ${vlUsed} but only ${currentVl} available for ${application.employeeEmail}`);
                }
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
        let { employeeId } = req.query;
        ensureFile(ctoRecordsFile);
        
        // SECURITY: Non-admin users must provide employeeId and can only see their own records
        const isAdmin = ADMIN_ROLES.includes(req.session.role);
        if (!employeeId && !isAdmin) {
            // Default to own records for non-admin users
            employeeId = req.session.email;
        }
        
        // SECURITY: Only allow access to own CTO records unless admin role
        if (employeeId && !isSelfOrAdmin(req, employeeId)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }
        
        // AO school-based filtering
        if (employeeId && !isAoAccessAllowed(req, employeeId)) {
            return res.status(403).json({ success: false, error: 'Access denied. This employee is not from your school.' });
        }
        let ctoRecords = readJSON(ctoRecordsFile);

        if (employeeId) {
            // First try direct match by email/employeeId
            let filtered = ctoRecords.filter(r =>
                r.employeeId === employeeId || r.email === employeeId
            );

            // If no direct match, try linking unlinked records by looking up employee name
            if (filtered.length === 0) {
                // Find employee name from leave cards or employees
                const allCards = readJSON(leavecardsFile);
                const empCard = allCards.find(lc => lc.email === employeeId || lc.employeeId === employeeId);
                if (empCard) {
                    const empName = (empCard.name || '').toUpperCase().replace(/\s+/g, ' ').trim();
                    const empFirst = (empCard.firstName || '').toUpperCase().trim();
                    const empLast = (empCard.lastName || '').toUpperCase().trim();
                    filtered = ctoRecords.filter(r => {
                        const rName = (r.name || '').toUpperCase().replace(/\s+/g, ' ').trim();
                        if (rName === empName) return true;
                        // Fuzzy: last name matches + first name starts the same
                        const rParts = parseFullNameIntoParts(r.name || '');
                        const rFirst = (rParts.firstName || '').toUpperCase().trim();
                        const rLast = (rParts.lastName || '').toUpperCase().trim();
                        if (empLast && rLast && empLast === rLast) {
                            if (empFirst && rFirst &&
                                (empFirst.startsWith(rFirst) || rFirst.startsWith(empFirst))) return true;
                            if (rName.includes(empName) || empName.includes(rName)) return true;
                        }
                        return false;
                    });
                    // Auto-link matched records for future lookups
                    if (filtered.length > 0) {
                        let linked = false;
                        for (const rec of filtered) {
                            const idx = ctoRecords.indexOf(rec);
                            if (idx !== -1 && !ctoRecords[idx].employeeId) {
                                ctoRecords[idx].employeeId = employeeId;
                                ctoRecords[idx].email = employeeId;
                                linked = true;
                            }
                        }
                        if (linked) {
                            writeJSON(ctoRecordsFile, ctoRecords);
                            console.log(`[CTO] Auto-linked ${filtered.length} CTO records to ${employeeId}`);
                        }
                    }
                }
            }
            ctoRecords = filtered;
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

        // AO school-based filtering
        if (!isAoAccessAllowed(req, employeeId)) {
            return res.status(403).json({ success: false, error: 'Access denied. This employee is not from your school.' });
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
        const { daysUsed, fullUpdate, type, soDetails, periodCovered, daysGranted, soImage } = req.body;

        ensureFile(ctoRecordsFile);
        let ctoRecords = readJSON(ctoRecordsFile);
        const index = ctoRecords.findIndex(r => String(r.id) === String(recordId));

        if (index === -1) {
            return res.status(404).json({ success: false, error: 'Record not found' });
        }

        // AO school-based filtering
        if (!isAoAccessAllowed(req, ctoRecords[index].employeeId || ctoRecords[index].email)) {
            return res.status(403).json({ success: false, error: 'Access denied. This employee is not from your school.' });
        }

        if (fullUpdate) {
            // Full record replacement (AO edit form)
            if (type !== undefined) ctoRecords[index].type = type;
            if (soDetails !== undefined) ctoRecords[index].soDetails = soDetails;
            if (periodCovered !== undefined) ctoRecords[index].periodCovered = periodCovered;
            if (daysGranted !== undefined) ctoRecords[index].daysGranted = Number(daysGranted);
            if (daysUsed !== undefined) ctoRecords[index].daysUsed = Number(daysUsed);
            if (soImage !== undefined) ctoRecords[index].soImage = soImage;
            ctoRecords[index].updatedAt = new Date().toISOString();
        } else {
            // Legacy additive behavior
            ctoRecords[index].daysUsed = (ctoRecords[index].daysUsed || 0) + Number(daysUsed);
        }

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

// DELETE /api/cto-records/:recordId — Remove a CTO record
app.delete('/api/cto-records/:recordId', requireAuth('ao', 'it'), (req, res) => {
    try {
        const recordId = req.params.recordId;

        ensureFile(ctoRecordsFile);
        let ctoRecords = readJSON(ctoRecordsFile);
        const index = ctoRecords.findIndex(r => String(r.id) === String(recordId));

        if (index === -1) {
            return res.status(404).json({ success: false, error: 'Record not found' });
        }

        if (!isAoAccessAllowed(req, ctoRecords[index].employeeId || ctoRecords[index].email)) {
            return res.status(403).json({ success: false, error: 'Access denied. This employee is not from your school.' });
        }

        const deleted = ctoRecords.splice(index, 1)[0];
        writeJSON(ctoRecordsFile, ctoRecords);

        logActivity('CTO_RECORD_DELETED', 'ao', {
            userEmail: req.session?.email || 'unknown',
            ip: getClientIp(req),
            recordId,
            employeeId: deleted.employeeId,
            soDetails: deleted.soDetails
        });

        res.json({ success: true, message: 'CTO record deleted successfully' });
    } catch (error) {
        console.error('Error deleting CTO record:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== ACTIVITY LOG ENDPOINTS ==========

// Get all activity logs with pagination and filtering
app.get('/api/activity-logs', requireAuth('it'), (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 50, 500); // S16: Cap at 500 to prevent abuse
        const action = req.query.action;
        const portal = req.query.portal;
        const userEmail = req.query.userEmail;
        const startDate = req.query.startDate;
        const endDate = req.query.endDate;
        
        const logs = readJSONArray(activityLogsFile);
        
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
        const logs = readJSONArray(activityLogsFile);
        
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
        const logs = readJSONArray(activityLogsFile);
        
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
            ].map(field => `"${String(field || '').replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"` ).join(','))
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
    'activity-logs.json', 'system-state.json'
    // NOTE: so-records.json removed — dead file never referenced by any endpoint (D1)
    // NOTE: applications.backup.json removed — not a real data file
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
 * Convert an ExcelJS Worksheet to a 2-D array equivalent to
 * xlsx.utils.sheet_to_json(ws, { header: 1 }).
 * Cells are 0-indexed; empty trailing cells are included.
 */
function worksheetTo2DArray(worksheet) {
    const data = [];
    worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
        const rowData = [];
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
            let val = cell.value;
            if (val !== null && val !== undefined && typeof val === 'object') {
                if ('result' in val) val = val.result;          // formula cell
                else if (val instanceof Date) val = val;        // date cell
                else if (val.text !== undefined) val = val.text; // rich text
                else val = String(val);
            }
            rowData[colNumber - 1] = val ?? null;
        });
        data[rowNumber - 1] = rowData;
    });
    return data;
}

/**
 * Extract VL/SL balance from a single Excel leave card buffer.
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
async function extractCreditsFromBuffer(buffer, fileName) {
    try {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const ws = wb.worksheets[0];
        if (!ws) return null;
        const data = worksheetTo2DArray(ws);

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
            const periodUpper = period.toUpperCase().trimStart();

            // Detect transaction type from period text
            let txType = 'ADD';
            if (periodUpper.startsWith('LESS') || periodUpper.startsWith('LWOP')) {
                txType = 'LESS';
            } else if (periodUpper.startsWith('LAWOP')) {
                txType = 'LAWOP';
            }

            // Column mapping (DepEd SERVICE LEAVE CARD standard):
            // Col 0: Period Covered
            // Col 1: LEAVE EARNED - VACATION
            // Col 2: LEAVE EARNED - SICK
            // Col 3: LEAVE SPENT - VACATION
            // Col 4: LEAVE SPENT - SICK
            // Col 5: LEAVE SPENT - FORCED
            // Col 6: LEAVE SPENT - SPECIAL
            // Col 7: BALANCE - VACATION
            // Col 8: BALANCE - SICK
            // Col 9: TOTAL
            //
            // For ADD rows: cols 1-2 have values (earned), cols 3-6 are empty
            // For LESS rows: cols 1-2 are empty (earned), cols 3-6 have values (spent)
            const vlEarned = txType === 'ADD' ? (typeof row[1] === 'number' ? row[1] : 0) : 0;
            const slEarned = txType === 'ADD' ? (typeof row[2] === 'number' ? row[2] : 0) : 0;
            const vlSpent = txType !== 'ADD' ? (typeof row[3] === 'number' ? row[3] : 0) : 0;
            const slSpent = txType !== 'ADD' ? (typeof row[4] === 'number' ? row[4] : 0) : 0;
            const forcedLeave = txType !== 'ADD' ? (typeof row[5] === 'number' ? row[5] : 0) : 0;
            const splUsed = txType !== 'ADD' ? (typeof row[6] === 'number' ? row[6] : 0) : 0;
            const vlBal = typeof row[7] === 'number' ? row[7] : null;
            const slBal = typeof row[8] === 'number' ? row[8] : null;

            if (period || vlBal !== null || slBal !== null) {
                transactions.push({
                    type: txType,
                    periodCovered: period || `Row ${i + 1}`,
                    vlEarned: parseFloat((vlEarned || 0).toFixed(3)),
                    slEarned: parseFloat((slEarned || 0).toFixed(3)),
                    vlSpent: parseFloat((vlSpent || 0).toFixed(3)),
                    slSpent: parseFloat((slSpent || 0).toFixed(3)),
                    forcedLeave: parseFloat((forcedLeave || 0).toFixed(3)),
                    splUsed: parseFloat((splUsed || 0).toFixed(3)),
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
 * Extract CTO records from an Excel workbook buffer.
 * Looks for a sheet named "CTO", "CTO Card", "CTO Records", or the second sheet.
 * CTO layout (DepEd standard):
 *   Header row contains: SO/Special Order, Period, Days Granted/Earned, Days Used, Balance
 *   Data rows follow the header.
 */
async function extractCtoFromBuffer(buffer, fileName) {
    try {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const baseName = path.basename(fileName, path.extname(fileName));

        // Find the CTO sheet — try named sheets first, then fall back to 2nd sheet
        let ctoSheet = null;
        let ctoSheetName = null;
        const ctoSheetNames = ['CTO', 'CTO CARD', 'CTO RECORDS', 'COMPENSATORY', 'CTO_CARD'];
        for (const ws of wb.worksheets) {
            if (ctoSheetNames.includes(ws.name.toUpperCase().trim())) {
                ctoSheet = ws;
                ctoSheetName = ws.name;
                break;
            }
        }
        // Fallback: if no named match, check if 2nd sheet has CTO-like content
        if (!ctoSheet && wb.worksheets.length >= 2) {
            const secondSheet = wb.worksheets[1];
            const testData = worksheetTo2DArray(secondSheet);
            for (let i = 0; i < Math.min(15, testData.length); i++) {
                const rowStr = (testData[i] || []).map(c => String(c || '').toUpperCase()).join(' ');
                if (rowStr.includes('CTO') || rowStr.includes('COMPENSATORY') || rowStr.includes('SPECIAL ORDER')) {
                    ctoSheet = secondSheet;
                    ctoSheetName = secondSheet.name;
                    break;
                }
            }
        }
        // Also check if the first (only) sheet IS a CTO card
        if (!ctoSheet && wb.worksheets.length > 0) {
            const firstSheet = wb.worksheets[0];
            const firstData = worksheetTo2DArray(firstSheet);
            for (let i = 0; i < Math.min(15, firstData.length); i++) {
                const rowStr = (firstData[i] || []).map(c => String(c || '').toUpperCase()).join(' ');
                if (rowStr.includes('CTO') || rowStr.includes('COMPENSATORY TIME')) {
                    ctoSheet = firstSheet;
                    ctoSheetName = firstSheet.name;
                    break;
                }
            }
        }

        if (!ctoSheet) return null;

        const data = worksheetTo2DArray(ctoSheet);

        // Find the header row for CTO data
        // CTO sheets often have multi-row headers:
        //   Row N:   PERIOD COVERED | LEAVE EARNED (merged)           | TOTAL
        //   Row N+1: (empty)        | SPECIAL ORDER | GRANTED | USED | BALANCE
        // So we scan for the sub-header row (with GRANTED) and also check
        // previous rows for PERIOD COVERED
        let headerIdx = null;
        let colMap = {};
        for (let i = 0; i < Math.min(20, data.length); i++) {
            const row = data[i];
            if (!row) continue;
            const rowUpper = row.map(c => String(c || '').toUpperCase().trim());
            let soCol = -1, periodCol = -1, grantedCol = -1, usedCol = -1;
            for (let j = 0; j < rowUpper.length; j++) {
                const cell = rowUpper[j];
                if (cell.includes('SPECIAL ORDER') || cell.includes('SO NO') || cell === 'SO' || cell.includes('S.O.')) soCol = j;
                if (cell.includes('PERIOD') || cell.includes('INCLUSIVE')) periodCol = j;
                if (cell.includes('GRANTED') || cell.includes('EARNED') || cell.includes('DAYS GRANTED')) grantedCol = j;
                if (cell.includes('USED') || cell.includes('SPENT') || cell.includes('DAYS USED')) usedCol = j;
            }
            if (grantedCol !== -1) {
                headerIdx = i;
                // If PERIOD wasn't in this row, scan previous rows for it
                if (periodCol === -1) {
                    for (let k = Math.max(0, i - 3); k < i; k++) {
                        const prevRow = data[k];
                        if (!prevRow) continue;
                        for (let j = 0; j < prevRow.length; j++) {
                            const cell = String(prevRow[j] || '').toUpperCase().trim();
                            if (cell.includes('PERIOD') || cell.includes('INCLUSIVE')) {
                                periodCol = j;
                                break;
                            }
                        }
                        if (periodCol !== -1) break;
                    }
                }
                colMap = { so: soCol, period: periodCol, granted: grantedCol, used: usedCol };
                break;
            }
        }

        // Fallback: scan for numeric columns that look like CTO data
        if (headerIdx === null) {
            for (let i = 0; i < data.length; i++) {
                const row = data[i];
                if (!row) continue;
                let hasText = false, hasNum = false;
                for (let j = 0; j < row.length; j++) {
                    if (typeof row[j] === 'string' && row[j].trim()) hasText = true;
                    if (typeof row[j] === 'number') hasNum = true;
                }
                if (hasText && hasNum && i > 3) {
                    headerIdx = i - 1;
                    colMap = { so: 1, period: 0, granted: 2, used: 3 };
                    break;
                }
            }
        }

        const ctoRecords = [];
        const startRow = headerIdx !== null ? headerIdx + 1 : 5;

        for (let i = startRow; i < data.length; i++) {
            const row = data[i];
            if (!row || row.length < 2) continue;

            const soDetails = colMap.so >= 0 && row[colMap.so] ? String(row[colMap.so]).trim() : '';
            const periodCovered = colMap.period >= 0 && row[colMap.period] ? String(row[colMap.period]).trim() : '';
            const daysGranted = colMap.granted >= 0 ? (parseFloat(row[colMap.granted]) || 0) : 0;
            const daysUsed = colMap.used >= 0 ? (parseFloat(row[colMap.used]) || 0) : 0;

            // Skip rows with no meaningful data
            if (!soDetails && !periodCovered && daysGranted === 0 && daysUsed === 0) continue;
            // Skip total/summary rows
            const rowText = row.map(c => String(c || '').toUpperCase()).join(' ');
            if (rowText.includes('TOTAL') || rowText.includes('GRAND TOTAL') || rowText.includes('NOTE:') || rowText.includes('CERTIFIED')) continue;

            // Detect transaction type from period text (e.g., "ADD: 12/18/2024" or "LESS: 02/6/2025")
            let txType = 'ADD';
            const periodUpper = periodCovered.toUpperCase();
            if (periodUpper.startsWith('LESS') || periodUpper.startsWith('LWOP')) {
                txType = 'LESS';
            }

            ctoRecords.push({
                type: txType,
                soDetails,
                periodCovered,
                daysGranted: Math.round(daysGranted * 1000) / 1000,
                daysUsed: Math.round(daysUsed * 1000) / 1000,
                source: 'excel-migration'
            });
        }

        if (ctoRecords.length === 0) return null;

        return {
            name: baseName,
            sheetName: ctoSheetName,
            records: ctoRecords,
            totalGranted: ctoRecords.reduce((sum, r) => sum + r.daysGranted, 0),
            totalUsed: ctoRecords.reduce((sum, r) => sum + r.daysUsed, 0)
        };
    } catch (err) {
        console.error(`  Error parsing CTO from ${fileName}: ${err.message}`);
        return null;
    }
}

/**
 * Detect if an Excel file is for a teaching employee.
 * Looks for VSC header, teaching position keywords, or CTO-only content.
 */
async function detectTeachingFromExcel(buffer) {
    try {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        if (!wb.worksheets.length) return false;
        const data = worksheetTo2DArray(wb.worksheets[0]);

        for (let i = 0; i < Math.min(20, data.length); i++) {
            if (!data[i]) continue;
            const rowStr = data[i].map(c => String(c || '').toUpperCase()).join(' ');
            if (rowStr.includes('VSC') || rowStr.includes('VACATION SERVICE CREDIT')) return true;
            if (/\bTEACHER\b/.test(rowStr) || /\bHEAD\s*TEACHER\b/.test(rowStr) || /\bMASTER\s*TEACHER\b/.test(rowStr)) return true;
        }
        return false;
    } catch { return false; }
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
}, async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, error: 'No Excel files uploaded' });
        }

        const mode = req.query.mode || 'preview';
        const allowOverwrite = req.query.overwrite === 'true';
        const results = [];
        const ctoResults = [];
        const errors = [];
        const teachingDetected = [];

        for (const file of req.files) {
            // Multer decodes filenames as latin1; re-decode as UTF-8 to handle Ñ, accents, etc.
            const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
            const [isTeaching, extracted, ctoExtracted] = await Promise.all([
                detectTeachingFromExcel(file.buffer),
                extractCreditsFromBuffer(file.buffer, originalName),
                extractCtoFromBuffer(file.buffer, originalName),
            ]);

            if (isTeaching) teachingDetected.push(originalName);

            if (extracted) {
                extracted.isTeaching = isTeaching;
                extracted.hasCto = !!ctoExtracted;
                results.push(extracted);
            } else if (isTeaching || ctoExtracted) {
                // Teaching personnel or CTO-only file — create empty leave card placeholder
                const baseName = path.basename(originalName, path.extname(originalName));
                results.push({
                    name: baseName,
                    employeeNo: '',
                    vacationLeave: 0,
                    sickLeave: 0,
                    transactions: [],
                    isTeaching: isTeaching,
                    hasCto: !!ctoExtracted,
                    emptyLeaveCard: true
                });
            } else {
                errors.push({ file: originalName, error: 'Could not parse VL/SL balance or CTO records from file' });
            }

            if (ctoExtracted) {
                ctoExtracted.isTeaching = isTeaching;
                ctoResults.push(ctoExtracted);
            }
        }

        if (mode === 'preview') {
            return res.json({
                success: true,
                mode: 'preview',
                message: `Parsed ${results.length} leave cards and ${ctoResults.length} CTO records from ${req.files.length} files`,
                parsed: results,
                ctoRecords: ctoResults,
                teachingDetected,
                errors,
                totalFiles: req.files.length,
                successCount: results.length,
                ctoCount: ctoResults.length,
                teachingCount: teachingDetected.length,
                errorCount: errors.length
            });
        }

        // Import mode — write to leavecards.json AND cto-records.json
        // Create safety backup first
        const safetyTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const safetyFolder = path.join(backupDir, `pre-migration-${safetyTimestamp}`);
        fs.mkdirSync(safetyFolder, { recursive: true });
        if (fs.existsSync(leavecardsFile)) {
            fs.copyFileSync(leavecardsFile, path.join(safetyFolder, 'leavecards.json'));
        }
        if (fs.existsSync(ctoRecordsFile)) {
            fs.copyFileSync(ctoRecordsFile, path.join(safetyFolder, 'cto-records.json'));
        }

        let leavecards = readJSON(leavecardsFile);
        let created = 0, updated = 0, skipped = 0;
        let ctoCreated = 0;
        const importDetails = [];

        for (const entry of results) {
            const normalizedName = entry.name.toUpperCase().replace(/\s+/g, ' ').trim();
            const entryEmpNo = (entry.employeeNo || '').trim();

            // Primary matching: first name + last name from filename
            // Secondary fallback: employee number from Leave Card data
            const existingIdx = leavecards.findIndex(lc => {
                const lcName = (lc.name || '').toUpperCase().replace(/\s+/g, ' ').trim();
                // Primary: match by normalized full name (LASTNAME, FIRSTNAME)
                if (lcName === normalizedName) return true;
                // Extended primary: match by firstName + lastName components
                const entryParts = parseFullNameIntoParts(entry.name);
                const entryFirst = (entryParts.firstName || '').toUpperCase().trim();
                const entryLast = (entryParts.lastName || '').toUpperCase().trim();
                const lcFirst = (lc.firstName || '').toUpperCase().trim();
                const lcLast = (lc.lastName || '').toUpperCase().trim();
                if (entryFirst && entryLast && lcFirst && lcLast &&
                    entryFirst === lcFirst && entryLast === lcLast) return true;
                // Secondary fallback: match by employeeNo
                if (entryEmpNo && lc.employeeNo) {
                    return String(lc.employeeNo).trim() === entryEmpNo;
                }
                return false;
            });

            if (existingIdx !== -1 && !allowOverwrite) {
                skipped++;
                importDetails.push({ name: entry.name, action: 'skipped', reason: 'Already exists (use overwrite to replace)', isTeaching: entry.isTeaching });
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
                wellnessEarned: 5,
                wellnessSpent: 0,
                forceLeaveYear: new Date().getFullYear(),
                splYear: new Date().getFullYear(),
                wellnessYear: new Date().getFullYear(),
                leaveUsageHistory: [],
                transactions: entry.transactions || [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                initialCreditsSource: entry.emptyLeaveCard ? 'excel-migration-empty' : 'excel-migration',
                isTeaching: entry.isTeaching || false,
                emptyLeaveCard: entry.emptyLeaveCard || false
            };

            if (existingIdx !== -1) {
                // Overwrite existing
                const existing = leavecards[existingIdx];
                newCard.employeeId = existing.employeeId || '';
                newCard.email = existing.email || '';
                leavecards[existingIdx] = newCard;
                updated++;
                importDetails.push({ name: entry.name, action: 'updated', vl: entry.vacationLeave, sl: entry.sickLeave, isTeaching: entry.isTeaching, emptyLeaveCard: entry.emptyLeaveCard });
            } else {
                leavecards.push(newCard);
                created++;
                importDetails.push({ name: entry.name, action: 'created', vl: entry.vacationLeave, sl: entry.sickLeave, isTeaching: entry.isTeaching, emptyLeaveCard: entry.emptyLeaveCard });
            }
        }

        writeJSON(leavecardsFile, leavecards);

        // === CTO Records Import ===
        ensureFile(ctoRecordsFile);
        let ctoRecordsAll = readJSON(ctoRecordsFile);
        let ctoRemoved = 0;

        for (const ctoEntry of ctoResults) {
            const normalizedName = ctoEntry.name.toUpperCase().replace(/\s+/g, ' ').trim();
            const entryParts = parseFullNameIntoParts(ctoEntry.name);
            const entryFirst = (entryParts.firstName || '').toUpperCase().trim();
            const entryLast = (entryParts.lastName || '').toUpperCase().trim();

            // When overwrite is enabled, remove previously-migrated CTO records
            // for this person so we don't create duplicates on re-import
            if (allowOverwrite) {
                const beforeCount = ctoRecordsAll.length;
                ctoRecordsAll = ctoRecordsAll.filter(r => {
                    // Only remove excel-migration records; keep manually-added ones
                    if (r.source !== 'excel-migration') return true;
                    const rName = (r.name || '').toUpperCase().replace(/\s+/g, ' ').trim();
                    if (rName === normalizedName) return false;
                    // Also match by first+last name components
                    const rParts = parseFullNameIntoParts(r.name || '');
                    const rFirst = (rParts.firstName || '').toUpperCase().trim();
                    const rLast = (rParts.lastName || '').toUpperCase().trim();
                    if (entryFirst && entryLast && rFirst && rLast &&
                        entryFirst === rFirst && entryLast === rLast) return false;
                    return true;
                });
                ctoRemoved += (beforeCount - ctoRecordsAll.length);
            }

            // Find matching leave card to get employeeId/email
            // Use flexible matching: exact name, first+last components, or substring containment
            const matchedCard = leavecards.find(lc => {
                const lcName = (lc.name || '').toUpperCase().replace(/\s+/g, ' ').trim();
                if (lcName === normalizedName) return true;
                const lcFirst = (lc.firstName || '').toUpperCase().trim();
                const lcLast = (lc.lastName || '').toUpperCase().trim();
                if (entryFirst && entryLast && lcFirst && lcLast &&
                    entryFirst === lcFirst && entryLast === lcLast) return true;
                // Fuzzy: one name contains the other (handles middle initial differences)
                if (lcName && normalizedName && lcLast === entryLast) {
                    if (lcName.includes(normalizedName) || normalizedName.includes(lcName)) return true;
                    // Match if first names start the same (e.g., "MA. ROSANA" vs "MA. ROSANA E.")
                    if (lcFirst && entryFirst &&
                        (lcFirst.startsWith(entryFirst) || entryFirst.startsWith(lcFirst))) return true;
                }
                return false;
            });

            const employeeId = matchedCard ? (matchedCard.email || matchedCard.employeeId || '') : '';

            for (const rec of ctoEntry.records) {
                const newCtoRecord = {
                    id: crypto.randomUUID(),
                    employeeId: employeeId,
                    email: employeeId,
                    name: ctoEntry.name,
                    type: rec.type || 'ADD',
                    soDetails: rec.soDetails || '',
                    periodCovered: rec.periodCovered || '',
                    daysGranted: rec.daysGranted,
                    daysUsed: rec.daysUsed,
                    balance: 0,
                    soImage: '',
                    source: 'excel-migration',
                    createdAt: new Date().toISOString()
                };
                ctoRecordsAll.push(newCtoRecord);
                ctoCreated++;
            }
        }

        if (ctoCreated > 0 || ctoRemoved > 0) {
            writeJSON(ctoRecordsFile, ctoRecordsAll);
        }

        logActivity('EXCEL_MIGRATION', 'it', {
            userEmail: req.session.email,
            userId: req.session.userId,
            ip: getClientIp(req),
            details: {
                totalFiles: req.files.length,
                leaveCardsCreated: created,
                leaveCardsUpdated: updated,
                leaveCardsSkipped: skipped,
                ctoRecordsCreated: ctoCreated,
                ctoRecordsRemoved: ctoRemoved,
                teachingPersonnel: teachingDetected.length,
                errors: errors.length
            }
        });

        console.log(`[MIGRATION] Excel import complete: ${created} LC created, ${updated} LC updated, ${skipped} LC skipped, ${ctoCreated} CTO created${ctoRemoved > 0 ? `, ${ctoRemoved} CTO replaced` : ''}, ${teachingDetected.length} teaching, ${errors.length} errors`);

        res.json({
            success: true,
            mode: 'import',
            message: `Migration complete: ${created} leave cards created, ${updated} updated, ${skipped} skipped, ${ctoCreated} CTO records imported${ctoRemoved > 0 ? ` (${ctoRemoved} replaced)` : ''}`,
            safetyBackup: `pre-migration-${safetyTimestamp}`,
            created,
            updated,
            skipped,
            ctoCreated,
            ctoRemoved,
            teachingCount: teachingDetected.length,
            errors,
            details: importDetails,
            totalCards: leavecards.length,
            totalCtoRecords: ctoRecordsAll.length
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
                wellnessEarned: 5,
                wellnessSpent: 0,
                forceLeaveYear: new Date().getFullYear(),
                splYear: new Date().getFullYear(),
                wellnessYear: new Date().getFullYear(),
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

// ========== MIGRATION VALIDATION ==========
/**
 * POST /api/validate-migration
 * Validates migrated data by comparing uploaded Excel source files against
 * what's currently in leavecards.json and cto-records.json.
 *
 * Returns a detailed report of:
 *  - Matched records (source ↔ system)
 *  - Missing records (in source but not in system)
 *  - Balance discrepancies
 *  - Unlinked records (migrated but not yet associated with a registered employee)
 *  - Transaction count mismatches
 *  - Teaching personnel status
 */
app.post('/api/validate-migration', requireAuth('it'), (req, res, next) => {
    migrationUpload.array('files', 500)(req, res, (err) => {
        if (err) return res.status(400).json({ success: false, error: err.message || 'File upload error' });
        next();
    });
}, (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, error: 'No Excel files uploaded for validation' });
        }

        const leavecards = readJSON(leavecardsFile);
        ensureFile(ctoRecordsFile);
        const ctoRecords = readJSON(ctoRecordsFile);
        const employees = readJSON(employeesFile);

        const validationResults = [];
        let matched = 0, missing = 0, discrepancies = 0, unlinked = 0;
        let ctoMatched = 0, ctoMissing = 0;

        for (const file of req.files) {
            const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
            const baseName = path.basename(originalName, path.extname(originalName));
            const isTeaching = detectTeachingFromExcel(file.buffer);
            const extracted = extractCreditsFromBuffer(file.buffer, originalName);
            const ctoExtracted = extractCtoFromBuffer(file.buffer, originalName);

            const normalizedName = baseName.toUpperCase().replace(/\s+/g, ' ').trim();
            const nameParts = parseFullNameIntoParts(baseName);
            const entryFirst = (nameParts.firstName || '').toUpperCase().trim();
            const entryLast = (nameParts.lastName || '').toUpperCase().trim();
            const entryEmpNo = extracted ? (extracted.employeeNo || '').trim() : '';

            // Find matching leave card in system
            const matchedCard = leavecards.find(lc => {
                const lcName = (lc.name || '').toUpperCase().replace(/\s+/g, ' ').trim();
                if (lcName === normalizedName) return true;
                const lcFirst = (lc.firstName || '').toUpperCase().trim();
                const lcLast = (lc.lastName || '').toUpperCase().trim();
                if (entryFirst && entryLast && lcFirst && lcLast &&
                    entryFirst === lcFirst && entryLast === lcLast) return true;
                if (entryEmpNo && lc.employeeNo && String(lc.employeeNo).trim() === entryEmpNo) return true;
                return false;
            });

            // Find matching employee profile
            const matchedEmployee = employees.find(emp => {
                const empName = (emp.fullName || '').toUpperCase().replace(/\s+/g, ' ').trim();
                if (empName === normalizedName) return true;
                const empFirst = (emp.firstName || '').toUpperCase().trim();
                const empLast = (emp.lastName || '').toUpperCase().trim();
                if (entryFirst && entryLast && empFirst && empLast &&
                    entryFirst === empFirst && entryLast === empLast) return true;
                return false;
            });

            const result = {
                fileName: originalName,
                name: baseName,
                isTeaching,
                matchMethod: null,
                status: 'missing',
                issues: []
            };

            // Leave Card validation
            if (extracted) {
                result.sourceVL = extracted.vacationLeave;
                result.sourceSL = extracted.sickLeave;
                result.sourceTransactions = (extracted.transactions || []).length;
                result.sourceEmpNo = extracted.employeeNo || '';
            } else if (!isTeaching) {
                result.issues.push('Could not parse Leave Card data from Excel');
            }

            if (matchedCard) {
                result.status = 'matched';
                result.matchMethod = matchedCard.email ? 'email-linked' : 'name';
                matched++;

                result.systemVL = matchedCard.vl;
                result.systemSL = matchedCard.sl;
                result.systemTransactions = (matchedCard.transactions || []).length;
                result.systemLinkedEmail = matchedCard.email || '';
                result.systemEmpNo = matchedCard.employeeNo || '';

                // Check for balance discrepancies
                if (extracted) {
                    const vlDiff = Math.abs((matchedCard.vl || 0) - extracted.vacationLeave);
                    const slDiff = Math.abs((matchedCard.sl || 0) - extracted.sickLeave);
                    if (vlDiff > 0.01) {
                        result.issues.push(`VL mismatch: Excel=${extracted.vacationLeave}, System=${matchedCard.vl}`);
                        discrepancies++;
                    }
                    if (slDiff > 0.01) {
                        result.issues.push(`SL mismatch: Excel=${extracted.sickLeave}, System=${matchedCard.sl}`);
                        discrepancies++;
                    }
                    // Check transaction count
                    const srcTx = (extracted.transactions || []).length;
                    const sysTx = (matchedCard.transactions || []).filter(t => t.source === 'excel-migration').length;
                    if (srcTx > 0 && sysTx === 0) {
                        result.issues.push(`No migrated transactions in system (source has ${srcTx})`);
                    } else if (srcTx > 0 && Math.abs(srcTx - sysTx) > 2) {
                        result.issues.push(`Transaction count differs: Excel=${srcTx}, System=${sysTx}`);
                    }
                }

                // Check if linked to a registered employee
                if (!matchedCard.email) {
                    result.issues.push('Leave card not yet linked to a registered employee');
                    unlinked++;
                }

                // Teaching personnel check
                if (isTeaching && !matchedCard.isTeaching && !matchedCard.emptyLeaveCard) {
                    result.issues.push('Detected as teaching in Excel but not flagged in system');
                }
            } else {
                missing++;
                result.issues.push('No matching Leave Card found in system');
            }

            // CTO validation
            if (ctoExtracted) {
                result.sourceCtoRecords = ctoExtracted.records.length;
                result.sourceCtoGranted = ctoExtracted.totalGranted;
                result.sourceCtoUsed = ctoExtracted.totalUsed;

                // Find matching CTO records in system
                const systemCto = ctoRecords.filter(r => {
                    const rName = (r.name || '').toUpperCase().replace(/\s+/g, ' ').trim();
                    if (rName === normalizedName) return true;
                    if (matchedCard && (r.employeeId === matchedCard.email || r.email === matchedCard.email) && matchedCard.email) return true;
                    return false;
                });

                result.systemCtoRecords = systemCto.length;
                result.systemCtoGranted = systemCto.reduce((sum, r) => sum + (parseFloat(r.daysGranted) || 0), 0);
                result.systemCtoUsed = systemCto.reduce((sum, r) => sum + (parseFloat(r.daysUsed) || 0), 0);

                if (systemCto.length > 0) {
                    ctoMatched++;
                    if (Math.abs(result.sourceCtoGranted - result.systemCtoGranted) > 0.01) {
                        result.issues.push(`CTO days granted mismatch: Excel=${result.sourceCtoGranted}, System=${result.systemCtoGranted}`);
                    }
                    if (Math.abs(result.sourceCtoUsed - result.systemCtoUsed) > 0.01) {
                        result.issues.push(`CTO days used mismatch: Excel=${result.sourceCtoUsed}, System=${result.systemCtoUsed}`);
                    }
                } else {
                    ctoMissing++;
                    result.issues.push(`CTO records not found in system (source has ${ctoExtracted.records.length} records)`);
                }
            }

            // Employee profile check
            result.hasEmployeeProfile = !!matchedEmployee;
            if (matchedEmployee) {
                result.employeeEmail = matchedEmployee.email;
                result.employeePosition = matchedEmployee.position;
            }

            validationResults.push(result);
        }

        const summary = {
            totalFiles: req.files.length,
            leaveCards: { matched, missing, discrepancies, unlinked },
            ctoRecords: { matched: ctoMatched, missing: ctoMissing },
            systemTotals: {
                totalLeaveCards: leavecards.length,
                linkedLeaveCards: leavecards.filter(lc => lc.email).length,
                unlinkedLeaveCards: leavecards.filter(lc => !lc.email).length,
                totalCtoRecords: ctoRecords.length,
                totalEmployees: employees.length
            }
        };

        console.log(`[VALIDATION] Migration validation: ${matched} LC matched, ${missing} LC missing, ${discrepancies} discrepancies, ${ctoMatched} CTO matched, ${ctoMissing} CTO missing`);

        res.json({
            success: true,
            summary,
            results: validationResults
        });
    } catch (error) {
        console.error('[VALIDATION] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/migration-status
 * Returns a summary of the current migration state without requiring file uploads.
 * Shows how many leave cards are migrated, linked, unlinked, teaching, and CTO records.
 */
app.get('/api/migration-status', requireAuth('it'), (req, res) => {
    try {
        const leavecards = readJSON(leavecardsFile);
        ensureFile(ctoRecordsFile);
        const ctoRecords = readJSON(ctoRecordsFile);
        const employees = readJSON(employeesFile);

        const migratedCards = leavecards.filter(lc => lc.initialCreditsSource === 'excel-migration' || lc.initialCreditsSource === 'excel-migration-empty');
        const linkedCards = migratedCards.filter(lc => lc.email);
        const unlinkedCards = migratedCards.filter(lc => !lc.email);
        const teachingCards = migratedCards.filter(lc => lc.isTeaching);
        const emptyCards = migratedCards.filter(lc => lc.emptyLeaveCard);
        const migratedCto = ctoRecords.filter(r => r.source === 'excel-migration');
        const linkedCto = migratedCto.filter(r => r.email);
        const unlinkedCto = migratedCto.filter(r => !r.email);

        res.json({
            success: true,
            leaveCards: {
                total: leavecards.length,
                migrated: migratedCards.length,
                linked: linkedCards.length,
                unlinked: unlinkedCards.length,
                teaching: teachingCards.length,
                emptyPlaceholders: emptyCards.length,
                unlinkedNames: unlinkedCards.map(lc => ({
                    name: lc.name,
                    employeeNo: lc.employeeNo || '',
                    vl: lc.vl,
                    sl: lc.sl,
                    isTeaching: lc.isTeaching || false
                }))
            },
            ctoRecords: {
                total: ctoRecords.length,
                migrated: migratedCto.length,
                linked: linkedCto.length,
                unlinked: unlinkedCto.length,
                unlinkedNames: unlinkedCto.map(r => ({
                    name: r.name || '',
                    soDetails: r.soDetails || '',
                    daysGranted: r.daysGranted,
                    daysUsed: r.daysUsed
                }))
            },
            employees: {
                total: employees.length,
                withLeaveCards: employees.filter(emp =>
                    leavecards.some(lc => lc.email === emp.email)
                ).length,
                withoutLeaveCards: employees.filter(emp =>
                    !leavecards.some(lc => lc.email === emp.email)
                ).length
            }
        });
    } catch (error) {
        console.error('[MIGRATION STATUS] Error:', error);
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
    console.log('  Data Management: http://localhost:' + PORT + '/data-management');
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
