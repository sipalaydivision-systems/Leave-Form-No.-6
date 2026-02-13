// CS Form No. 6 - Application for Leave Server
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const https = require('https');

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

// Input sanitization function - prevents XSS and injection
function sanitizeInput(input) {
    if (typeof input !== 'string') return input;
    return input
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;')
        .replace(/\\/g, '&#x5C;')
        .replace(/`/g, '&#x60;');
}

// Deep sanitize object
function sanitizeObject(obj) {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'string') return sanitizeInput(obj);
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

// Validate date format (YYYY-MM-DD)
function isValidDate(dateStr) {
    if (!dateStr) return false;
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(dateStr)) return false;
    const date = new Date(dateStr);
    return date instanceof Date && !isNaN(date);
}

// Security middleware - sanitize all incoming requests
app.use((req, res, next) => {
    if (req.body && typeof req.body === 'object') {
        req.body = sanitizeObject(req.body);
    }
    if (req.query && typeof req.query === 'object') {
        req.query = sanitizeObject(req.query);
    }
    next();
});

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
    return token;
}

function validateSession(token) {
    if (!token) return null;
    const session = activeSessions.get(token);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
        activeSessions.delete(token);
        return null;
    }
    return session;
}

function destroySession(token) {
    activeSessions.delete(token);
}

// Clean up expired sessions every 15 minutes
setInterval(() => {
    const now = Date.now();
    for (const [token, session] of activeSessions) {
        if (now > session.expiresAt) {
            activeSessions.delete(token);
        }
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
        
        fs.writeFileSync(activityLogsFile, JSON.stringify(logs, null, 2));
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

// Ensure all data files exist — seeds from bundled defaults on first deploy
const defaultsDir = path.join(__dirname, 'data', 'defaults');

function ensureFile(filepath, defaultContent = '[]') {
    const filename = path.basename(filepath);
    const defaultFile = path.join(defaultsDir, filename);
    
    if (!fs.existsSync(filepath)) {
        // File doesn't exist — seed from bundled defaults (useful for Railway Volume first deploy)
        if (fs.existsSync(defaultFile)) {
            const content = fs.readFileSync(defaultFile, 'utf8');
            fs.writeFileSync(filepath, content);
            console.log(`[DATA] Seeded ${filename} from defaults`);
        } else {
            fs.writeFileSync(filepath, defaultContent);
            console.log(`[DATA] Created empty ${filename}`);
        }
    } else {
        // File exists — but if it's empty/just "[]" and defaults have real data, reseed
        try {
            const existing = fs.readFileSync(filepath, 'utf8').trim();
            const existingData = JSON.parse(existing);
            if (Array.isArray(existingData) && existingData.length === 0 && fs.existsSync(defaultFile)) {
                const defaultContent = fs.readFileSync(defaultFile, 'utf8').trim();
                const defaultData = JSON.parse(defaultContent);
                if (Array.isArray(defaultData) && defaultData.length > 0) {
                    fs.writeFileSync(filepath, defaultContent);
                    console.log(`[DATA] Re-seeded empty ${filename} from defaults (${defaultData.length} records)`);
                }
            }
        } catch (e) {
            console.log(`[DATA] ${filename} exists, keeping as-is`);
        }
    }
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
        return JSON.parse(content);
    } catch (error) {
        console.error(`Error reading JSON file ${filepath}:`, error.message);
        return [];
    }
}

function writeJSON(filepath, data) {
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

// Hash password with salt for new registrations
function hashPasswordWithSalt(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.createHash('sha256').update(salt + password).digest('hex');
    return `${salt}:${hash}`;
}

// Legacy hash for backward compatibility with existing accounts
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// Verify password - supports both salted and legacy formats
function verifyPassword(password, storedHash) {
    if (storedHash.includes(':')) {
        // New salted format: salt:hash
        const [salt, hash] = storedHash.split(':');
        const computed = crypto.createHash('sha256').update(salt + password).digest('hex');
        return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(hash, 'hex'));
    }
    // Legacy unsalted format
    const legacyHash = crypto.createHash('sha256').update(password).digest('hex');
    try {
        return crypto.timingSafeEqual(Buffer.from(legacyHash, 'hex'), Buffer.from(storedHash, 'hex'));
    } catch {
        return false;
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
        id: Date.now(),
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
                        ${temporaryPassword ? `<p><strong>Temporary Password:</strong> ${temporaryPassword}</p><p style="color: #d9534f; margin-top: 10px;"><em>⚠️ Please change this password on your first login for security reasons.</em></p>` : '<p><strong>Password:</strong> Use the password you registered with</p>'}
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
        const { fullName, email, password, office, position, salaryGrade, step, salary, employeeNo } = req.body || {};

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

        if (pendingRegs.find(r => r.email === email && r.status === 'pending')) {
            return res.status(400).json({ success: false, error: 'Registration already pending IT approval' });
        }

        const pendingRegistration = {
            id: Date.now(),
            portal: 'employee',
            fullName: fullName || '',
            name: fullName || '',
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

        // Upgrade legacy password hash to salted hash on successful login
        if (!user.password.includes(':')) {
            const idx = users.findIndex(u => u.email === email);
            if (idx !== -1) {
                users[idx].password = hashPasswordWithSalt(password);
                writeJSON(usersFile, users);
            }
        }

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
app.post('/api/change-password', (req, res) => {
    try {
        const { email, currentPassword, newPassword } = req.body;
        
        if (!email || !currentPassword || !newPassword) {
            return res.status(400).json({ success: false, error: 'All fields are required' });
        }
        
        if (newPassword.length < 8) {
            return res.status(400).json({ success: false, error: 'New password must be at least 8 characters' });
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
app.get('/api/user-details', (req, res) => {
    try {
        const email = req.query.email;
        if (!email) {
            return res.status(400).json({ success: false, error: 'Email is required' });
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
        const { email, password, fullName, name, office, position, salaryGrade, step, salary, employeeNo } = req.body;

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

        if (pendingRegs.find(r => r.email === email && r.portal === 'hr' && r.status === 'pending')) {
            return res.status(400).json({ success: false, error: 'Registration already pending IT approval' });
        }

        const pendingRegistration = {
            id: Date.now(),
            portal: 'hr',
            fullName: userName,
            name: userName,
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

        // Upgrade legacy hash
        if (!hrUser.password.includes(':')) {
            const idx = hrUsers.findIndex(u => u.email === email);
            if (idx !== -1) {
                hrUsers[idx].password = hashPasswordWithSalt(password);
                writeJSON(hrUsersFile, hrUsers);
            }
        }

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
        const { email, password, fullName, office, position, salaryGrade, step, salary, employeeNo } = req.body;

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

        if (pendingRegs.find(r => r.email === email && r.portal === 'asds' && r.status === 'pending')) {
            return res.status(400).json({ success: false, error: 'Registration already pending IT approval' });
        }

        const pendingRegistration = {
            id: Date.now(),
            portal: 'asds',
            fullName,
            name: fullName,
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

        if (!asdsUser.password.includes(':')) {
            const idx = asdsUsers.findIndex(u => u.email === email);
            if (idx !== -1) {
                asdsUsers[idx].password = hashPasswordWithSalt(password);
                writeJSON(asdsUsersFile, asdsUsers);
            }
        }

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
        const { email, fullName, office, position, salaryGrade, step, salary, password, employeeNo } = req.body;

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

        if (pendingRegs.find(r => r.email === email && r.portal === 'sds' && r.status === 'pending')) {
            return res.status(400).json({ success: false, message: 'Registration already pending IT approval' });
        }

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

        const pendingRegistration = {
            id: Date.now(),
            portal: 'sds',
            email,
            password: hashPasswordWithSalt(password),
            firstName,
            lastName,
            middleName,
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

        if (!sdsUser.password.includes(':')) {
            const idx = sdsUsers.findIndex(u => u.email === email);
            if (idx !== -1) {
                sdsUsers[idx].password = hashPasswordWithSalt(password);
                writeJSON(sdsUsersFile, sdsUsers);
            }
        }

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
        const { fullName, email, password, office, position, salaryGrade, step, employeeNo } = req.body;

        if (!fullName || !email || !password || !office || !position || !step) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }
        
        if (!employeeNo || !employeeNo.trim()) {
            return res.status(400).json({ success: false, error: 'Employee Number is required' });
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

        if (pendingRegs.find(r => r.email === email && r.portal === 'ao' && r.status === 'pending')) {
            return res.status(400).json({ success: false, error: 'Registration already pending IT approval' });
        }

        const pendingRegistration = {
            id: Date.now(),
            portal: 'ao',
            fullName,
            name: fullName,
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

        if (!aoUser.password.includes(':')) {
            const idx = aoUsers.findIndex(u => u.email === email);
            if (idx !== -1) {
                aoUsers[idx].password = hashPasswordWithSalt(password);
                writeJSON(aoUsersFile, aoUsers);
            }
        }

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

        if (!itUser.password.includes(':')) {
            const idx = itUsers.findIndex(u => (u.email || '').toLowerCase() === email);
            if (idx !== -1) {
                itUsers[idx].password = hashPasswordWithSalt(pin);
                writeJSON(itUsersFile, itUsers);
            }
        }

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
            id: Date.now(),
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

        let itUsers = readJSON(itUsersFile);
        const userIndex = itUsers.findIndex(u => u.email === email);

        if (userIndex === -1) {
            return res.status(404).json({ success: false, error: 'IT staff not found' });
        }

        itUsers[userIndex].fullName = fullName;
        itUsers[userIndex].name = fullName;
        
        if (newPin) {
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

        let pendingRegs = readJSON(pendingRegistrationsFile);
        const regIndex = pendingRegs.findIndex(r => r.id == id);

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
                
                // Create initial leave card with credits from Excel data
                const initialCredits = lookupInitialCredits(registration.fullName || registration.name);
                const defaultVL = 100;
                const defaultSL = 100;
                
                const leavecards = readJSON(leavecardsFile);
                const existingLeavecard = leavecards.find(lc => lc.email === registration.email);
                
                if (!existingLeavecard) {
                    const newLeavecard = {
                        employeeId: registration.email,
                        email: registration.email,
                        vacationLeaveEarned: initialCredits ? initialCredits.vacationLeave : defaultVL,
                        sickLeaveEarned: initialCredits ? initialCredits.sickLeave : defaultSL,
                        forceLeaveEarned: 5,
                        splEarned: 3,
                        vacationLeaveSpent: 0,
                        sickLeaveSpent: 0,
                        forceLeaveSpent: 0,
                        splSpent: 0,
                        vl: initialCredits ? initialCredits.vacationLeave : defaultVL,
                        sl: initialCredits ? initialCredits.sickLeave : defaultSL,
                        spl: 3,
                        others: 0,
                        forceLeaveYear: new Date().getFullYear(),
                        splYear: new Date().getFullYear(),
                        leaveUsageHistory: [],
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                        initialCreditsSource: initialCredits ? 'excel' : 'default'
                    };
                    leavecards.push(newLeavecard);
                    writeJSON(leavecardsFile, leavecards);
                    console.log(`[REGISTRATION] Created leave card for ${registration.email}: VL=${newLeavecard.vl}, SL=${newLeavecard.sl}, Source=${newLeavecard.initialCreditsSource}`);
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
        registration.processedBy = processedBy;

        pendingRegs[regIndex] = registration;
        writeJSON(pendingRegistrationsFile, pendingRegs);

        // Log registration approval
        logActivity('REGISTRATION_APPROVED', 'it', {
            userEmail: registration.email,
            fullName: registration.fullName || registration.name,
            portal: registration.portal,
            processedBy: processedBy,
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

        let pendingRegs = readJSON(pendingRegistrationsFile);
        const regIndex = pendingRegs.findIndex(r => r.id == id);

        if (regIndex === -1) {
            return res.status(404).json({ success: false, error: 'Registration not found' });
        }

        if (pendingRegs[regIndex].status !== 'pending') {
            return res.status(400).json({ success: false, error: 'Registration already processed' });
        }

        pendingRegs[regIndex].status = 'rejected';
        pendingRegs[regIndex].rejectionReason = reason || 'No reason provided';
        pendingRegs[regIndex].processedAt = new Date().toISOString();
        pendingRegs[regIndex].processedBy = processedBy;
        writeJSON(pendingRegistrationsFile, pendingRegs);

        // Log registration rejection
        logActivity('REGISTRATION_REJECTED', 'it', {
            userEmail: pendingRegs[regIndex].email,
            fullName: pendingRegs[regIndex].fullName || pendingRegs[regIndex].name,
            portal: pendingRegs[regIndex].portal,
            reason: reason || 'No reason provided',
            processedBy: processedBy,
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
app.post('/api/delete-all-data', loginRateLimiter, (req, res) => {
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
        const { id, email, portal, deletedBy } = req.body;

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
            regIndex = pendingRegs.findIndex(r => r.id == id);
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
app.post('/api/submit-leave', (req, res) => {
    try {
        const applicationData = req.body;
        const applications = readJSON(applicationsFile);
        const ip = getClientIp(req);
        
        // ===== VALIDATION: Check Force/SPL leave balance =====
        const leaveType = applicationData.leaveType;
        const employeeEmail = applicationData.employeeEmail;
        const numDays = parseFloat(applicationData.numDays) || 0;
        
        if (leaveType === 'leave_mfl' || leaveType === 'leave_spl') {
            const leavecards = readJSON(leavecardsFile);
            const employeeLeave = leavecards.find(lc => lc.email === employeeEmail);
            
            if (employeeLeave) {
                const forceLeaveSpent = employeeLeave.forceLeaveSpent || 0;
                const splSpent = employeeLeave.splSpent || 0;
                
                // Check if Force Leave is exhausted
                if (leaveType === 'leave_mfl' && forceLeaveSpent >= 5) {
                    console.log(`[VALIDATION] Force Leave rejected for ${employeeEmail}: Already spent ${forceLeaveSpent}/5 days`);
                    return res.status(400).json({ 
                        success: false, 
                        error: 'Force Leave exhausted',
                        message: 'You have already used all 5 days of your yearly Force Leave allocation.'
                    });
                }
                
                // Check if SPL is exhausted
                if (leaveType === 'leave_spl' && splSpent >= 3) {
                    console.log(`[VALIDATION] SPL rejected for ${employeeEmail}: Already spent ${splSpent}/3 days`);
                    return res.status(400).json({ 
                        success: false, 
                        error: 'SPL exhausted',
                        message: 'You have already used all 3 days of your yearly Special Privilege Leave allocation.'
                    });
                }
            }
        }
        
        // ===== VALIDATION: Prevent 5+ consecutive days of Force Leave =====
        if (leaveType === 'leave_mfl' && numDays >= 5) {
            console.log(`[VALIDATION] Force Leave rejected for ${employeeEmail}: Attempted ${numDays} consecutive days (max 4 allowed)`);
            return res.status(400).json({
                success: false,
                error: 'Force Leave restriction',
                message: `Force Leave cannot be taken for 5 or more consecutive working days. You submitted ${numDays} days. Maximum: 4 days per application.`
            });
        }
        
        // Determine initial status and current approver based on office
        const office = applicationData.office || '';
        const schoolBased = isSchoolBased(office);
        
        // Generate sequential Application ID (SDO Sipalay-01, SDO Sipalay-02, etc.)
        const applicationId = generateApplicationId(applications);
        
        // ALL applications go to AO first, regardless of whether they're school-based or not
        // Unified workflow: AO → HR → ASDS → SDS
        const newApplication = {
            id: applicationId,
            ...applicationData,
            isSchoolBased: schoolBased,
            status: 'pending',
            currentApprover: 'AO', // All applications go to AO first
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
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get application status for tracker
app.get('/api/application-status/:id', (req, res) => {
    try {
        const idParam = req.params.id;
        let appId = parseInt(idParam);
        if (isNaN(appId)) {
            appId = idParam; // Try as string if not a valid number
        }
        
        const applications = readJSON(applicationsFile);
        const app = applications.find(a => a.id === appId || a.id === parseInt(appId) || String(a.id) === idParam);
        
        if (!app) {
            console.error('Application not found:', { idParam, appId, totalApps: applications.length });
            return res.status(404).json({ success: false, error: 'Application not found' });
        }
        
        res.json({ success: true, application: app });
    } catch (error) {
        console.error('Error in application-status:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get applications by email (for employee to track their own)
app.get('/api/my-applications/:email', (req, res) => {
    try {
        const email = req.params.email;
        const applications = readJSON(applicationsFile);
        const myApps = applications.filter(a => a.employeeEmail === email);
        
        res.json({ success: true, applications: myApps });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get application details by ID
app.get('/api/application-details/:id', (req, res) => {
    try {
        const idParam = req.params.id;
        const applications = readJSON(applicationsFile);
        const application = applications.find(a => a.id === idParam || a.id === parseInt(idParam) || String(a.id) === idParam);
        
        if (!application) {
            return res.status(404).json({ success: false, error: 'Application not found' });
        }
        
        res.json({ success: true, application: application });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get applications pending for a specific portal (includes returned applications)
app.get('/api/pending-applications/:portal', (req, res) => {
    try {
        const portal = req.params.portal.toUpperCase();
        const applications = readJSON(applicationsFile);
        
        let pendingApps = applications.filter(a => 
            (a.status === 'pending' || a.status === 'returned') && a.currentApprover === portal
        );
        
        res.json({ success: true, applications: pendingApps });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get approved applications for a specific portal (SDS or ASDS)
app.get('/api/approved-applications/:portal', (req, res) => {
    try {
        const portal = req.params.portal.toUpperCase();
        const applications = readJSON(applicationsFile);
        
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
app.get('/api/hr-approved-applications', (req, res) => {
    try {
        const applications = readJSON(applicationsFile);
        
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
app.get('/api/all-users', (req, res) => {
    try {
        const users = readJSON(usersFile);
        res.json({ success: true, users: users });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get all applications for demographics
app.get('/api/all-applications', (req, res) => {
    try {
        const applications = readJSON(applicationsFile);
        res.json({ success: true, applications: applications });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get all registered employees (for AO to manage their cards)
app.get('/api/all-employees', (req, res) => {
    try {
        const users = readJSON(usersFile);
        // Return only necessary fields for privacy
        const employees = users.map(user => ({
            id: user.id,
            email: user.email,
            name: user.name || user.fullName || `${user.firstName || ''} ${user.lastName || ''}`.trim(),
            fullName: user.fullName || user.name,
            position: user.position || 'N/A',
            office: user.office || user.school || 'N/A',
            employeeNo: user.employeeNo || 'N/A'
        }));
        res.json({ success: true, employees: employees });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get all applications for a portal (pending, approved, and rejected by this portal)
app.get('/api/portal-applications/:portal', (req, res) => {
    try {
        const portal = req.params.portal.toUpperCase();
        const applications = readJSON(applicationsFile);
        
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
app.get('/api/leave-credits', (req, res) => {
    try {
        const employeeId = req.query.employeeId;
        if (!employeeId) {
            return res.status(400).json({ success: false, error: 'Employee ID is required' });
        }
        
        const leavecards = readJSON(leavecardsFile);
        // Find all records for this employee to get the latest one
        const employeeRecords = leavecards.filter(lc => lc.employeeId === employeeId || lc.email === employeeId);
        
        if (employeeRecords.length === 0) {
            // Return default leave credits with proper earned values
            return res.json({ 
                success: true, 
                credits: {
                    employeeId: employeeId,
                    email: employeeId,
                    vl: 100,
                    sl: 100,
                    spl: 3,
                    forceLeaveSpent: 0,
                    splSpent: 0,
                    others: 0,
                    vacationLeaveEarned: 100,
                    sickLeaveEarned: 100,
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
        
        // Get the latest balance from leaveUsageHistory if available
        let vacationLeaveSpent = latestRecord.vacationLeaveSpent || 0;
        let sickLeaveSpent = latestRecord.sickLeaveSpent || 0;
        
        // If there's leave usage history, use the latest entry
        if (latestRecord.leaveUsageHistory && Array.isArray(latestRecord.leaveUsageHistory) && latestRecord.leaveUsageHistory.length > 0) {
            const latestUsage = latestRecord.leaveUsageHistory[latestRecord.leaveUsageHistory.length - 1];
            if (latestUsage.balanceAfterVL !== undefined) {
                vacationLeaveSpent = latestRecord.vacationLeaveEarned - latestUsage.balanceAfterVL;
            }
            if (latestUsage.balanceAfterSL !== undefined) {
                sickLeaveSpent = latestRecord.sickLeaveEarned - latestUsage.balanceAfterSL;
            }
        }
        
        // Ensure the credits object has all required fields with defaults
        const enrichedCredits = {
            ...latestRecord,
            vacationLeaveEarned: latestRecord.vacationLeaveEarned || latestRecord.vl || 100,
            sickLeaveEarned: latestRecord.sickLeaveEarned || latestRecord.sl || 100,
            forceLeaveEarned: latestRecord.forceLeaveEarned || latestRecord.mandatoryForced || latestRecord.others || 5,
            splEarned: latestRecord.splEarned || latestRecord.spl || 3,
            vacationLeaveSpent: vacationLeaveSpent,
            sickLeaveSpent: sickLeaveSpent,
            forceLeaveSpent: forceLeaveSpent,
            splSpent: splSpent,
            forceLeaveYear: currentYear,
            splYear: currentYear,
            leaveUsageHistory: latestRecord.leaveUsageHistory || []
        };
        
        console.log('[LEAVE-CREDITS API] Returning:', JSON.stringify({
            vacationLeaveEarned: enrichedCredits.vacationLeaveEarned,
            vacationLeaveSpent: enrichedCredits.vacationLeaveSpent,
            sickLeaveEarned: enrichedCredits.sickLeaveEarned,
            sickLeaveSpent: enrichedCredits.sickLeaveSpent,
            forceLeaveSpent: enrichedCredits.forceLeaveSpent,
            splSpent: enrichedCredits.splSpent
        }));
        
        res.json({ success: true, credits: enrichedCredits });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get actual leave card allocation (for return/compliance preview)
app.get('/api/leave-card', (req, res) => {
    try {
        const employeeId = req.query.employeeId;
        
        if (!employeeId) {
            return res.status(400).json({ success: false, error: 'Employee ID is required' });
        }
        
        const leavecards = readJSON(leavecardsFile);
        
        // Find all records for this employee to get the latest one
        const employeeRecords = leavecards.filter(lc => lc.employeeId === employeeId || lc.email === employeeId);
        
        if (employeeRecords.length === 0) {
            // Return default leave card allocation
            return res.json({ 
                success: true, 
                credits: {
                    employeeId: employeeId,
                    email: employeeId,
                    vl: 100,
                    sl: 100,
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
                vl: latestRecord.vacationLeaveEarned || latestRecord.vl || 100,
                sl: latestRecord.sickLeaveEarned || latestRecord.sl || 100,
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
app.get('/api/employee-leavecard', (req, res) => {
    try {
        const employeeId = req.query.employeeId;
        if (!employeeId) {
            return res.status(400).json({ success: false, error: 'Employee ID is required' });
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
app.get('/api/returned-applications/:email', (req, res) => {
    try {
        const email = req.params.email;
        const applications = readJSON(applicationsFile);
        
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
app.post('/api/resubmit-leave', (req, res) => {
    try {
        const { applicationId, updatedData, employeeEmail } = req.body;
        const applications = readJSON(applicationsFile);
        const appIndex = applications.findIndex(a => a.id === applicationId);
        
        if (appIndex === -1) {
            return res.status(404).json({ success: false, error: 'Application not found' });
        }
        
        const app = applications[appIndex];
        
        // Verify the employee owns this application
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
        
        // ===== VALIDATION: Prevent 5+ consecutive days of Force Leave on resubmit =====
        if (leaveType === 'leave_mfl' && numDays >= 5) {
            console.log(`[VALIDATION] Force Leave rejected for resubmit ${employeeEmail}: Attempted ${numDays} consecutive days (max 4 allowed)`);
            return res.status(400).json({
                success: false,
                error: 'Force Leave restriction',
                message: `Force Leave cannot be taken for 5 or more consecutive working days. You submitted ${numDays} days. Maximum: 4 days per application.`
            });
        }
        
        // Update application with any new data (e.g., additional documents)
        if (updatedData) {
            Object.assign(app, updatedData);
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
app.post('/api/update-leave-credits', (req, res) => {
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
        
        // Find existing leave card by email
        let employeeLeave = leavecards.find(lc => lc.email === employeeEmail);
        
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
app.post('/api/approve-leave', (req, res) => {
    try {
        const { applicationId, action, approverPortal, approverName, remarks, authorizedOfficerName, authorizedOfficerSignature, asdsOfficerName, asdsOfficerSignature, sdsOfficerName, sdsOfficerSignature } = req.body;
        const ip = getClientIp(req);
        console.log('[APPROVE-LEAVE] Request received:', { applicationId, action, approverPortal, approverName });
        
        const applications = readJSON(applicationsFile);
        // Handle both string and number applicationId
        const appIndex = applications.findIndex(a => a.id === applicationId || a.id === parseInt(applicationId));
        
        if (appIndex === -1) {
            console.error('[APPROVE-LEAVE] Application not found:', applicationId);
            return res.status(404).json({ success: false, error: 'Application not found' });
        }
        
        const app = applications[appIndex];
        console.log('[APPROVE-LEAVE] Found application:', { id: app.id, employee: app.employeeName, currentApprover: app.currentApprover });
        const currentApprover = approverPortal.toUpperCase();
        
        // Validate that reason is provided for return or reject actions
        if ((action === 'returned' || action === 'rejected') && (!remarks || !remarks.trim())) {
            return res.status(400).json({ 
                success: false, 
                error: 'Please provide a reason for ' + (action === 'returned' ? 'returning' : 'rejecting') + ' this application' 
            });
        }
        
        // Add to approval history
        app.approvalHistory.push({
            portal: approverPortal,
            action: action,
            approverName: approverName,
            remarks: remarks || '',
            timestamp: new Date().toISOString()
        });
        
        if (action === 'returned') {
            // Return application to previous step for compliance (lacking documents)
            // Workflow: Employee <- AO <- HR <- ASDS <- SDS
            let returnedTo = null;
            
            if (currentApprover === 'AO') {
                // AO returns -> back to Employee for compliance
                app.status = 'returned';
                app.currentApprover = 'EMPLOYEE';
                returnedTo = 'Employee';
            } else if (currentApprover === 'HR') {
                // HR returns -> back to AO
                app.status = 'pending';
                app.currentApprover = 'AO';
                returnedTo = 'AO';
            } else if (currentApprover === 'ASDS') {
                // ASDS returns -> back to HR
                app.status = 'pending';
                app.currentApprover = 'HR';
                returnedTo = 'HR';
            } else if (currentApprover === 'SDS') {
                // SDS returns -> back to ASDS
                app.status = 'pending';
                app.currentApprover = 'ASDS';
                returnedTo = 'ASDS';
            }
            
            app.returnedAt = new Date().toISOString();
            app.returnedBy = approverPortal;
            app.returnRemarks = remarks;
            
            console.log(`[LEAVE] Application ${applicationId} returned by ${approverPortal} to ${returnedTo} - Reason: ${remarks}`);
            
        } else if (action === 'rejected') {
            // Final rejection - application is permanently rejected
            app.status = 'rejected';
            app.currentApprover = null;
            app.rejectedAt = new Date().toISOString();
            app.rejectedBy = approverPortal;
            app.rejectedByName = approverName;
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
        
        // Log activity after successful action
        logActivity(`LEAVE_APPLICATION_${action.toUpperCase()}`, approverPortal.toLowerCase(), {
            userEmail: approverName,
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
        
        // Only deduct VL/SL if it's not a Force or Special Privilege leave
        const isForceLeave = leaveTypeLower.includes('force') || leaveTypeLower.includes('mandatory') || leaveTypeLower.includes('leave_mfl');
        const isSpecialLeave = leaveTypeLower.includes('special') || leaveTypeLower.includes('leave_spl');
        
        if (vlLess > 0 && !isForceLeave && !isSpecialLeave) {
            employee.leaveCredits.vacationLeave = Math.max(0, (employee.leaveCredits.vacationLeave || 0) - vlLess);
        }
        if (slLess > 0 && !isForceLeave && !isSpecialLeave) {
            employee.leaveCredits.sickLeave = Math.max(0, (employee.leaveCredits.sickLeave || 0) - slLess);
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
            // Create new leave card if not found with proper initial values
            leavecard = {
                email: application.employeeEmail,
                employeeId: application.employeeEmail,
                vacationLeaveEarned: 100,
                sickLeaveEarned: 100,
                forceLeaveEarned: 0,
                splEarned: 3,
                vacationLeaveSpent: 0,
                sickLeaveSpent: 0,
                forceLeaveSpent: 0,
                splSpent: 0,
                forceLeaveYear: currentYear,
                splYear: currentYear,
                vl: 100,  // Start with full balance
                sl: 100,  // Start with full balance
                spl: 3,
                others: 0,
                leaveUsageHistory: [],
                createdAt: new Date().toISOString()
            };
            leavecards.push(leavecard);
        }
        
        // Initialize earned values if not present (for existing cards)
        if (!leavecard.vacationLeaveEarned) leavecard.vacationLeaveEarned = 100;
        if (!leavecard.sickLeaveEarned) leavecard.sickLeaveEarned = 100;
        
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
            leavecard.forceLeaveSpent = (leavecard.forceLeaveSpent || 0) + forceLeaveUsed;
        } else if (splUsed > 0) {
            leavecard.splSpent = (leavecard.splSpent || 0) + splUsed;
        } else {
            leavecard.vl = Math.max(0, (leavecard.vl || 100) - vlUsed);
            leavecard.sl = Math.max(0, (leavecard.sl || 100) - slUsed);
            leavecard.vacationLeaveSpent = (leavecard.vacationLeaveSpent || 0) + vlUsed;
            leavecard.sickLeaveSpent = (leavecard.sickLeaveSpent || 0) + slUsed;
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
app.get('/api/cto-records', (req, res) => {
    try {
        const { employeeId } = req.query;
        ensureFile(ctoRecordsFile);
        let ctoRecords = readJSON(ctoRecordsFile);

        if (employeeId) {
            ctoRecords = ctoRecords.filter(r => r.employeeId === employeeId);
        }

        res.json({ success: true, records: ctoRecords });
    } catch (error) {
        console.error('Error fetching CTO records:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Add/Update CTO record
app.post('/api/update-cto-records', (req, res) => {
    try {
        const { employeeId, type, soDetails, daysGranted, daysUsed, periodCovered, soImage } = req.body;
        
        if (!employeeId) {
            return res.status(400).json({ success: false, error: 'Employee ID is required' });
        }

        ensureFile(ctoRecordsFile);
        let ctoRecords = readJSON(ctoRecordsFile);

        const newRecord = {
            id: Date.now().toString(),
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
app.put('/api/cto-records/:recordId', (req, res) => {
    try {
        const recordId = req.params.recordId;
        const { daysUsed } = req.body;

        ensureFile(ctoRecordsFile);
        let ctoRecords = readJSON(ctoRecordsFile);
        const index = ctoRecords.findIndex(r => r.id == recordId);

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
app.get('/api/activity-logs', (req, res) => {
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
app.get('/api/activity-logs-summary', (req, res) => {
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
app.get('/api/export-activity-logs', (req, res) => {
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
        for (const file of DATA_FILES) {
            const filePath = path.join(dataDir, file);
            if (fs.existsSync(filePath)) {
                bundle[file] = readJSON(filePath);
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
app.get('/api/system-status', (req, res) => {
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
app.post('/api/data/seed', express.json({limit: '50mb'}), (req, res) => {
    try {
        const { secretKey, dataType, data } = req.body;
        
        // Only allow with correct secret key
        const SEED_KEY = process.env.DATA_SEED_KEY || 'sipalay-sdo-2026-seed';
        if (secretKey !== SEED_KEY) {
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
        
        fs.writeFileSync(targetFile, JSON.stringify(data, null, 2));
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
        console.log('  Storage: ✅ Railway Volume (data persists across deploys)');
    } else {
        console.log('  Storage: ⚠️  Local filesystem (data lost on redeploy!)');
    }
    console.log('==========================================================');
    console.log('');
    console.log('[STARTUP] Server started successfully at', new Date().toISOString());
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
    console.log('✓ Server still running - ' + new Date().toISOString());
}, 60000);
