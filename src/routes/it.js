/**
 * IT admin routes — bootstrap, login, staff management, registration
 * approval/rejection, data management, and user deletion.
 *
 * Extracted from server.js:
 *   - POST /api/it-bootstrap           (lines 2905-2953)
 *   - POST /api/it-login               (lines 2955-2990)
 *   - POST /api/add-it-staff           (lines 2992-3035)
 *   - POST /api/update-it-profile      (line 3037)
 *   - GET  /api/pending-registrations  (lines 3082-3090)
 *   - GET  /api/all-registered-users   (lines 3092-3142)
 *   - GET  /api/registration-stats     (lines 3143-3172)
 *   - POST /api/approve-registration   (lines 3175-3418)
 *   - POST /api/reject-registration    (lines 3420-3459)
 *   - GET  /api/data-items/:category   (lines 3461-3509)
 *   - POST /api/delete-specific-items  (lines 3511-3573)
 *   - POST /api/delete-selected-data   (lines 3575-3632)
 *   - POST /api/delete-all-data        (lines 3634-3689)
 *   - POST /api/delete-user            (lines 3691-3895)
 *   - POST /api/delete-multiple-users  (lines 3897-4079)
 *   - POST /api/it/reset-password      (lines 2681-2762)
 *   - POST /api/it/reset-pin           (lines 2764-2817)
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const router = express.Router();

const { dataDir, SESSION_COOKIE_OPTIONS } = require('../config');
const { readJSON, readJSONArray, writeJSON, ensureFile } = require('../data/json-store');
const {
    extractToken, createSession, activeSessions, persistSessions,
    requireAuth
} = require('../middleware/auth');
const { loginRateLimiter } = require('../middleware/rate-limit');
const { hashPasswordWithSalt, verifyPassword, verifyPasswordDetailed } = require('../utils/password');
const { validateDepEdEmail, validatePortalPassword } = require('../utils/validation');
const { buildPortalUser, buildEmployeeRecord, createDefaultLeaveCard, createAccrualTransaction } = require('../data/models');
const { sendEmail, generateLoginFormEmail } = require('../services/email');
const { isTeachingPosition } = require('../services/accrual');

// Reuse shared helpers from auth routes
const {
    logActivity, getClientIp,
    createProfileUpdateHandler, rehashIfNeeded
} = require('./auth');

// ---------------------------------------------------------------------------
// Data file paths
// ---------------------------------------------------------------------------

const usersFile                = path.join(dataDir, 'users.json');
const employeesFile            = path.join(dataDir, 'employees.json');
const applicationsFile         = path.join(dataDir, 'applications.json');
const leavecardsFile           = path.join(dataDir, 'leavecards.json');
const aoUsersFile              = path.join(dataDir, 'ao-users.json');
const hrUsersFile              = path.join(dataDir, 'hr-users.json');
const asdsUsersFile            = path.join(dataDir, 'asds-users.json');
const sdsUsersFile             = path.join(dataDir, 'sds-users.json');
const itUsersFile              = path.join(dataDir, 'it-users.json');
const pendingRegistrationsFile = path.join(dataDir, 'pending-registrations.json');
const ctoRecordsFile           = path.join(dataDir, 'cto-records.json');
const schoolsFile              = path.join(dataDir, 'schools.json');
const initialCreditsFile       = path.join(dataDir, 'initial-credits.json');
const systemStateFile          = path.join(dataDir, 'system-state.json');
const leaveFormPdfsDir         = require('../config').leaveFormPdfsDir;

// ---------------------------------------------------------------------------
// Lookup maps (DRY: defined once, used by approve-registration and delete)
// ---------------------------------------------------------------------------

/** Portal-to-file mapping for approve-registration (DRY: config-driven portal routing) */
const PORTAL_TO_FILE = {
    employee: () => usersFile,
    ao:       () => aoUsersFile,
    hr:       () => hrUsersFile,
    asds:     () => asdsUsersFile,
    sds:      () => sdsUsersFile
};

/**
 * Category-to-file mapping for data management endpoints.
 */
const CATEGORY_TO_FILE = {
    'employeeUsers':          () => usersFile,
    'aoUsers':                () => aoUsersFile,
    'hrUsers':                () => hrUsersFile,
    'asdsUsers':              () => asdsUsersFile,
    'sdsUsers':               () => sdsUsersFile,
    'applications':           () => applicationsFile,
    'leavecards':             () => leavecardsFile,
    'pendingRegistrations':   () => pendingRegistrationsFile,
    'schools':                () => schoolsFile
};

function getCategoryFile(category) {
    const getter = CATEGORY_TO_FILE[category];
    return getter ? getter() : null;
}

// =========================================================================
// POST /api/it-bootstrap — First-time IT user creation
// =========================================================================

router.post('/api/it-bootstrap', loginRateLimiter, (req, res) => {
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

// =========================================================================
// POST /api/it-login — IT staff login (PIN-based)
// =========================================================================

router.post('/api/it-login', loginRateLimiter, (req, res) => {
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

// =========================================================================
// POST /api/add-it-staff — Add a new IT staff member (requires existing IT auth)
// =========================================================================

router.post('/api/add-it-staff', requireAuth('it'), (req, res) => {
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

// =========================================================================
// POST /api/update-it-profile — IT staff profile update (PIN-based)
// =========================================================================

router.post('/api/update-it-profile', requireAuth('it'), createProfileUpdateHandler({
    portalName: 'it', portalLabel: 'IT', userFile: itUsersFile,
    usesPin: true, responseFields: ['id', 'email', 'fullName', 'name']
}));

// =========================================================================
// POST /api/it/reset-password — Reset any user's password (IT admin only)
// =========================================================================

router.post('/api/it/reset-password', requireAuth('it'), (req, res) => {
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
            newPassword   = newPassword.split('').sort(() => Math.random() - 0.5).join('');
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

// =========================================================================
// POST /api/it/reset-pin — Reset IT staff PIN
// =========================================================================

router.post('/api/it/reset-pin', requireAuth('it'), (req, res) => {
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

// =========================================================================
// GET /api/pending-registrations — List pending registrations
// =========================================================================

router.get('/api/pending-registrations', requireAuth('it'), (req, res) => {
    try {
        const pendingRegs = readJSON(pendingRegistrationsFile);
        const pending = pendingRegs.filter(r => r.status === 'pending');
        res.json(pending);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// =========================================================================
// GET /api/all-registered-users — List all registered users across portals
// =========================================================================

router.get('/api/all-registered-users', requireAuth('it'), (req, res) => {
    try {
        const pendingRegs = readJSON(pendingRegistrationsFile);
        // Filter out deleted records
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

        // SECURITY: Strip password hashes before sending to client
        const safeRegs = activeRegs.map(({ password, ...rest }) => rest);
        res.json({ success: true, registrations: safeRegs });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// =========================================================================
// GET /api/registration-stats — Summary stats for IT dashboard
// =========================================================================

router.get('/api/registration-stats', requireAuth('it'), (req, res) => {
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

// =========================================================================
// POST /api/approve-registration — Approve a pending registration
// =========================================================================

router.post('/api/approve-registration', requireAuth('it'), (req, res) => {
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
                    // Normalize name: NFC so Ñ/ñ (NFD composed vs precomposed) always match
                    const normReg = (s) => (s || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
                    // Check if there's a leave card with matching name (name-based auto-assignment)
                    const normalizedRegName = normReg(registration.fullName || registration.name || '');
                    let matchingCard = leavecards.find(lc => {
                        return normReg(lc.name || lc.fullName || '') === normalizedRegName;
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
                                const recName = normReg(rec.name || '');
                                if (recName === normalizedRegName) {
                                    rec.employeeId = registration.email;
                                    rec.email = registration.email;
                                    ctoLinked++;
                                }
                                // Also try matching by employeeNo
                                if (!rec.employeeId && registration.employeeNo && rec.employeeNo) {
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

// =========================================================================
// POST /api/reject-registration — Reject a pending registration
// =========================================================================

router.post('/api/reject-registration', requireAuth('it'), (req, res) => {
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

// =========================================================================
// GET /api/data-items/:category — Fetch items for selective deletion
// =========================================================================

router.get('/api/data-items/:category', requireAuth('it'), (req, res) => {
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

// =========================================================================
// POST /api/delete-specific-items — Delete items by IDs from a category
// =========================================================================

router.post('/api/delete-specific-items', requireAuth('it'), (req, res) => {
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

// =========================================================================
// POST /api/delete-selected-data — Bulk clear selected data categories
// =========================================================================

router.post('/api/delete-selected-data', requireAuth('it'), (req, res) => {
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

// =========================================================================
// POST /api/delete-all-data — DANGEROUS: Delete all system data
// =========================================================================

router.post('/api/delete-all-data', requireAuth('it'), loginRateLimiter, (req, res) => {
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
            usersFile,
            aoUsersFile,
            hrUsersFile,
            asdsUsersFile,
            sdsUsersFile,
            applicationsFile,
            leavecardsFile,
            ctoRecordsFile,
            pendingRegistrationsFile,
            schoolsFile
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

// =========================================================================
// POST /api/delete-user — Delete a single user and all associated records
// =========================================================================

router.post('/api/delete-user', requireAuth('it'), (req, res) => {
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
        // NOTE: IT portal is excluded — IT accounts use PINs and should only be
        // managed via the dedicated IT staff management (add/remove IT staff).
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
                        const soFile = path.join(dataDir, 'uploads', 'so-pdfs', path.basename(app.soFilePath));
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

// =========================================================================
// POST /api/delete-multiple-users — Bulk delete users
// S3 fix: Load shared files ONCE, mutate in memory, write ONCE at the end
// =========================================================================

router.post('/api/delete-multiple-users', requireAuth('it'), async (req, res) => {
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
                                const soFile = path.join(dataDir, 'uploads', 'so-pdfs', path.basename(app.soFilePath));
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

module.exports = router;
