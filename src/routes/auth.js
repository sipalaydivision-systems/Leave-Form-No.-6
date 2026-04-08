/**
 * Auth routes — page routes, session management, login handlers.
 *
 * Extracted from server.js lines 2297-2384 (pages, session, logout)
 * and 2675-2678, 2857-2897 (portal login/register via DRY factories).
 */

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const router = express.Router();

const { APP_VERSION, SESSION_COOKIE_OPTIONS } = require('../config');
const { readJSON, writeJSON } = require('../data/json-store');
const {
    extractToken, validateSession, destroySession, createSession,
    requireAuth
} = require('../middleware/auth');
const { loginRateLimiter, apiRateLimiter } = require('../middleware/rate-limit');
const { hashPasswordWithSalt, verifyPassword, verifyPasswordDetailed } = require('../utils/password');
const { validateDepEdEmail, validatePortalPassword } = require('../utils/validation');
const { parseFullNameIntoParts } = require('../utils/name-parser');

// ---------------------------------------------------------------------------
// Data file paths
// ---------------------------------------------------------------------------
const dataDir = require('../config').dataDir;

const usersFile                = path.join(dataDir, 'users.json');
const aoUsersFile              = path.join(dataDir, 'ao-users.json');
const hrUsersFile              = path.join(dataDir, 'hr-users.json');
const asdsUsersFile            = path.join(dataDir, 'asds-users.json');
const sdsUsersFile             = path.join(dataDir, 'sds-users.json');
const itUsersFile              = path.join(dataDir, 'it-users.json');
const pendingRegistrationsFile = path.join(dataDir, 'pending-registrations.json');
const activityLogsFile         = path.join(dataDir, 'activity-logs.json');

// ---------------------------------------------------------------------------
// Activity logging helpers (inline — avoid circular dependency with services)
// ---------------------------------------------------------------------------

/**
 * Extract real client IP from request, respecting X-Forwarded-For.
 */
function getClientIp(req) {
    return (req.headers['x-forwarded-for'] || '').split(',')[0] ||
           req.connection.remoteAddress ||
           req.socket.remoteAddress ||
           req.connection.socket?.remoteAddress ||
           'unknown';
}

/**
 * Log user activity to activity-logs.json.
 */
function logActivity(action, portalType, details = {}) {
    try {
        const ip = details.ip || 'unknown';
        const userEmail = details.userEmail || 'anonymous';
        const userId = details.userId || null;
        const timestamp = new Date().toISOString();
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

        const fs = require('fs');
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

        logs.push(logEntry);
        if (logs.length > 10000) {
            const archivePath = activityLogsFile.replace('.json',
                `-archive-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
            try { writeJSON(archivePath, logs.slice(0, logs.length - 10000)); } catch (e) { /* best-effort */ }
            logs = logs.slice(-10000);
        }

        writeJSON(activityLogsFile, logs);
    } catch (error) {
        console.error('Error logging activity:', error);
    }
}

// ---------------------------------------------------------------------------
// Rehash helper (operates on the user array + file directly)
// ---------------------------------------------------------------------------

function rehashIfNeeded(password, storedHash, userRecord, usersArray, usersFile) {
    const { needsRehash } = verifyPasswordDetailed(password, storedHash);
    if (needsRehash) {
        userRecord.password = hashPasswordWithSalt(password);
        userRecord.passwordUpgradedAt = new Date().toISOString();
        writeJSON(usersFile, usersArray);
        console.log(`[SECURITY] Password rehashed to bcrypt for ${userRecord.email}`);
    }
}

// ---------------------------------------------------------------------------
// Cross-portal email check
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// DRY: Generic admin portal registration handler
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// DRY: Generic portal login handler
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// DRY: Generic portal profile update handler
// ---------------------------------------------------------------------------

function createProfileUpdateHandler(config) {
    const { portalName, portalLabel, userFile, updatableFields = [],
            usesPin = false, syncToEmployees = false, syncToLeaveCards = false,
            responseFields } = config;

    const employeesFile  = path.join(dataDir, 'employees.json');
    const leavecardsFile = path.join(dataDir, 'leavecards.json');

    return (req, res) => {
        try {
            let { email, fullName, newPassword, newPin } = req.body;
            // Compute fullName from structured name parts if provided
            if (req.body.lastName && req.body.firstName) {
                const ln = req.body.lastName.trim();
                const fn = req.body.firstName.trim();
                const mn = (req.body.middleName || '').trim();
                const sfx = (req.body.suffix || '').trim();
                fullName = `${ln}${sfx ? ' ' + sfx : ''}, ${fn}${mn ? ' ' + mn : ''}`;
            }
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
            if (req.body.lastName && req.body.firstName) {
                users[userIndex].firstName = req.body.firstName.trim();
                users[userIndex].lastName = req.body.lastName.trim();
                users[userIndex].middleName = (req.body.middleName || '').trim();
                users[userIndex].suffix = (req.body.suffix || '').trim();
            } else {
                const nameParts = parseFullNameIntoParts(fullName);
                users[userIndex].firstName = nameParts.firstName || '';
                users[userIndex].lastName = nameParts.lastName || '';
                users[userIndex].middleName = nameParts.middleName || '';
                users[userIndex].suffix = nameParts.suffix || '';
            }
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

// =========================================================================
// PAGE ROUTES
// =========================================================================

// Resolve public dir relative to project root (two levels up from src/routes/)
const publicDir = path.join(__dirname, '..', '..', 'public');

router.get('/',               (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
router.get('/login',          (req, res) => res.sendFile(path.join(publicDir, 'login.html')));
router.get('/hr-login',       (req, res) => res.sendFile(path.join(publicDir, 'hr-login.html')));
router.get('/asds-login',     (req, res) => res.sendFile(path.join(publicDir, 'asds-login.html')));
router.get('/sds-login',      (req, res) => res.sendFile(path.join(publicDir, 'sds-login.html')));
router.get('/ao-login',       (req, res) => res.sendFile(path.join(publicDir, 'ao-login.html')));
router.get('/ao-register',    (req, res) => res.sendFile(path.join(publicDir, 'ao-register.html')));
router.get('/it-login',       (req, res) => res.sendFile(path.join(publicDir, 'it-login.html')));
router.get('/it-dashboard',   (req, res) => res.sendFile(path.join(publicDir, 'it-dashboard.html')));
router.get('/dashboard',      (req, res) => res.sendFile(path.join(publicDir, 'dashboard.html')));
router.get('/ao-dashboard',   (req, res) => res.sendFile(path.join(publicDir, 'ao-dashboard.html')));
router.get('/leave-form',     (req, res) => res.sendFile(path.join(publicDir, 'leave-application.html')));
router.get('/leave-form-legacy', (req, res) => res.sendFile(path.join(publicDir, 'leave_form.html')));
router.get('/hr-approval',    (req, res) => res.sendFile(path.join(publicDir, 'hr-approval.html')));
router.get('/asds-dashboard', (req, res) => res.sendFile(path.join(publicDir, 'asds-dashboard.html')));
router.get('/sds-dashboard',  (req, res) => res.sendFile(path.join(publicDir, 'sds-dashboard.html')));
router.get('/activity-logs',  (req, res) => res.sendFile(path.join(publicDir, 'activity-logs.html')));
router.get('/data-management',(req, res) => res.sendFile(path.join(publicDir, 'data-management.html')));

// =========================================================================
// VERSION & HEALTH CHECK
// =========================================================================

router.get('/api/version', (req, res) => res.json({ version: APP_VERSION }));

router.get('/api/health', (req, res) => {
    res.json({ success: true, uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// =========================================================================
// SESSION VALIDATION & LOGOUT
// =========================================================================

router.get('/api/validate-session', (req, res) => {
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

router.get('/api/me', (req, res) => {
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
            employeeNo: session.employeeNo || ''
        }
    });
});

router.post('/api/logout', (req, res) => {
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

// =========================================================================
// EMPLOYEE LOGIN (DRY: uses createLoginHandler factory)
// =========================================================================

router.post('/api/login', loginRateLimiter, createLoginHandler({
    portalName: 'employee', userFile: usersFile, sessionRole: 'user',
    responseFields: ['id', 'email', 'name', 'office', 'position', 'employeeNo', 'salaryGrade', 'step', 'salary']
}));

// =========================================================================
// ADMIN PORTAL REGISTRATION & LOGIN (DRY: uses factories)
// =========================================================================

// HR
router.post('/api/hr-register', apiRateLimiter, createAdminRegisterHandler({
    portalName: 'hr', portalLabel: 'HR', userFile: hrUsersFile,
    excludePortals: ['hr', 'user'],
    defaultValues: { office: 'Schools Division', position: 'HR Staff' }
}));
router.post('/api/hr-login', loginRateLimiter, createLoginHandler({
    portalName: 'hr', userFile: hrUsersFile, sessionRole: 'hr',
    responseFields: ['id', 'email', 'name', 'office', 'position']
}));

// ASDS
router.post('/api/asds-register', apiRateLimiter, createAdminRegisterHandler({
    portalName: 'asds', portalLabel: 'ASDS', userFile: asdsUsersFile,
    excludePortals: ['asds', 'user']
}));
router.post('/api/asds-login', loginRateLimiter, createLoginHandler({
    portalName: 'asds', userFile: asdsUsersFile, sessionRole: 'asds',
    responseFields: ['id', 'email', 'name', 'office', 'position']
}));

// SDS
router.post('/api/sds-register', apiRateLimiter, createAdminRegisterHandler({
    portalName: 'sds', portalLabel: 'SDS', userFile: sdsUsersFile,
    excludePortals: ['sds', 'user'],
    defaultValues: { office: 'Office of the Schools Division Superintendent' }
}));
router.post('/api/sds-login', loginRateLimiter, createLoginHandler({
    portalName: 'sds', userFile: sdsUsersFile, sessionRole: 'sds',
    responseFields: ['id', 'email', 'name', 'office', 'position']
}));

// AO
router.post('/api/ao-register', apiRateLimiter, createAdminRegisterHandler({
    portalName: 'ao', portalLabel: 'AO', userFile: aoUsersFile,
    excludePortals: ['ao', 'user']
}));
router.post('/api/ao-login', loginRateLimiter, createLoginHandler({
    portalName: 'ao', userFile: aoUsersFile, sessionRole: 'ao',
    responseFields: ['id', 'email', 'name', 'office', 'position']
}));

// =========================================================================
// PROFILE UPDATE ENDPOINTS (DRY: uses createProfileUpdateHandler factory)
// =========================================================================

router.post('/api/update-ao-profile', requireAuth('ao'), createProfileUpdateHandler({
    portalName: 'ao', portalLabel: 'AO', userFile: aoUsersFile,
    updatableFields: ['school', 'position'],
    responseFields: ['id', 'email', 'name', 'school', 'position']
}));

router.post('/api/update-hr-profile', requireAuth('hr'), createProfileUpdateHandler({
    portalName: 'hr', portalLabel: 'HR', userFile: hrUsersFile,
    updatableFields: ['office', 'position'],
    responseFields: ['id', 'email', 'name', 'office', 'position']
}));

router.post('/api/update-asds-profile', requireAuth('asds'), createProfileUpdateHandler({
    portalName: 'asds', portalLabel: 'ASDS', userFile: asdsUsersFile,
    updatableFields: ['office', 'position'],
    responseFields: ['id', 'email', 'name', 'office', 'position']
}));

router.post('/api/update-sds-profile', requireAuth('sds'), createProfileUpdateHandler({
    portalName: 'sds', portalLabel: 'SDS', userFile: sdsUsersFile,
    updatableFields: ['office', 'position'],
    responseFields: ['id', 'email', 'name', 'office', 'position']
}));

// =========================================================================
// Exported for reuse in other route modules
// =========================================================================

module.exports = router;
module.exports.createLoginHandler = createLoginHandler;
module.exports.createAdminRegisterHandler = createAdminRegisterHandler;
module.exports.createProfileUpdateHandler = createProfileUpdateHandler;
module.exports.logActivity = logActivity;
module.exports.getClientIp = getClientIp;
module.exports.isEmailRegisteredInAnyPortal = isEmailRegisteredInAnyPortal;
module.exports.rehashIfNeeded = rehashIfNeeded;
