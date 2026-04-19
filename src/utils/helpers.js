/**
 * Shared helper functions used across route modules.
 *
 * Extracted from server.js — these are pure utility functions that
 * multiple route handlers depend on for access control, application
 * lookup, activity logging, and AO school-based filtering.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ADMIN_ROLES, DIVISION_OFFICES } = require('../config/constants');
const { readJSON, readJSONArray, writeJSON } = require('../data/json-store');
const { dataDir } = require('../config');

// Data file paths
const usersFile = path.join(dataDir, 'users.json');
const employeesFile = path.join(dataDir, 'employees.json');
const applicationsFile = path.join(dataDir, 'applications.json');
const leavecardsFile = path.join(dataDir, 'leavecards.json');
const hrUsersFile = path.join(dataDir, 'hr-users.json');
const aovUsersFile = path.join(dataDir, 'aov-users.json');
const asdsUsersFile = path.join(dataDir, 'asds-users.json');
const sdsUsersFile = path.join(dataDir, 'sds-users.json');
const itUsersFile = path.join(dataDir, 'it-users.json');
const pendingRegistrationsFile = path.join(dataDir, 'pending-registrations.json');
const ctoRecordsFile = path.join(dataDir, 'cto-records.json');
const schoolsFile = path.join(dataDir, 'schools.json');
const initialCreditsFile = path.join(dataDir, 'initial-credits.json');
const activityLogsFile = path.join(dataDir, 'activity-logs.json');
const systemStateFile = path.join(dataDir, 'system-state.json');

// ---------------------------------------------------------------------------
// AO school-based filtering helpers
// ---------------------------------------------------------------------------

function isHrDivisionLevel(hrOffice) {
    if (!hrOffice) return false;
    return DIVISION_OFFICES.some(d => hrOffice.toUpperCase().includes(d));
}

function isEmployeeInAoSchool(employeeOffice, hrOffice) {
    if (!hrOffice || !employeeOffice) return false;
    // Division-level AOs see everyone
    if (isHrDivisionLevel(hrOffice)) return true;
    // Exact match
    if (employeeOffice === hrOffice) return true;
    // Normalize for comparison (strip whitespace, case)
    const normAo = hrOffice.toUpperCase().replace(/\s+/g, ' ').trim();
    const normEmp = employeeOffice.toUpperCase().replace(/\s+/g, ' ').trim();
    return normAo === normEmp;
}

/**
 * Look up an employee's office from users or employees data.
 * Accepts optional pre-loaded arrays to avoid redundant disk reads
 * when called inside .filter() loops (CRITICAL perf fix — was O(N*2) disk reads).
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

// ---------------------------------------------------------------------------
// Activity logging
// ---------------------------------------------------------------------------

/**
 * Log user activity with detailed information.
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
 * Extract IP address from request.
 */
function getClientIp(req) {
    return (req.headers['x-forwarded-for'] || '').split(',')[0] ||
           req.connection.remoteAddress ||
           req.socket.remoteAddress ||
           req.connection.socket?.remoteAddress ||
           'unknown';
}

// ---------------------------------------------------------------------------
// Application lookup helpers
// ---------------------------------------------------------------------------

/**
 * Find an application by ID, handling both string and numeric ID formats.
 */
function findApplicationById(applications, idParam) {
    return applications.find(a =>
        a.id === idParam || a.id === parseInt(idParam) || String(a.id) === String(idParam)
    );
}

/**
 * Find index of an application by ID.
 */
function findApplicationIndexById(applications, idParam) {
    return applications.findIndex(a =>
        a.id === idParam || a.id === parseInt(idParam) || String(a.id) === String(idParam)
    );
}

/**
 * Look up a user's full name by email across all portal user files.
 * Falls back to the email itself if no match is found.
 */
function lookupUserName(email) {
    if (!email) return 'Unknown';
    const portalFiles = [
        hrUsersFile, aovUsersFile, asdsUsersFile, sdsUsersFile, usersFile, itUsersFile
    ];
    for (const file of portalFiles) {
        const users = readJSON(file);
        const user = users.find(u => (u.email || '').toLowerCase() === email.toLowerCase());
        if (user && (user.fullName || user.name)) return user.fullName || user.name;
    }
    return email;
}

// ---------------------------------------------------------------------------
// Access control helpers
// ---------------------------------------------------------------------------

/**
 * Assert that the requesting user has access: either they own the resource or are an admin.
 */
function isSelfOrAdmin(req, targetEmail) {
    return ADMIN_ROLES.includes(req.session.role) || req.session.email === targetEmail;
}

/**
 * Check AO school-based access for a specific employee.
 */
function isHrAccessAllowed(req, employeeEmail, usersCache, employeesCache) {
    if (req.session.role !== 'hr') return true;
    if (!req.session.office) return true;
    if (isHrDivisionLevel(req.session.office)) return true;
    const empOffice = getEmployeeOffice(employeeEmail, usersCache, employeesCache);
    return isEmployeeInAoSchool(empOffice, req.session.office);
}

// ---------------------------------------------------------------------------
// Leave helpers
// ---------------------------------------------------------------------------

/**
 * Helper function to determine if user is school-based.
 */
function isSchoolBased(office) {
    if (!office) return false;
    const officeLower = office.toLowerCase();
    // School-based if contains "school" but NOT "schools division"
    return officeLower.includes('school') && !officeLower.includes('schools division');
}

/**
 * Helper function to generate sequential Application ID (SDO Sipalay-01, SDO Sipalay-02, etc.)
 * Includes timestamp suffix to prevent race condition conflicts.
 */
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

// ---------------------------------------------------------------------------
// Data file paths (exported for route modules that need direct file access)
// ---------------------------------------------------------------------------

module.exports = {
    // File paths
    usersFile,
    employeesFile,
    applicationsFile,
    leavecardsFile,
    hrUsersFile,
    aovUsersFile,
    asdsUsersFile,
    sdsUsersFile,
    itUsersFile,
    pendingRegistrationsFile,
    ctoRecordsFile,
    schoolsFile,
    initialCreditsFile,
    activityLogsFile,
    systemStateFile,

    // AO filtering
    isHrDivisionLevel,
    isEmployeeInAoSchool,
    getEmployeeOffice,

    // Activity logging
    logActivity,
    getClientIp,

    // Application helpers
    findApplicationById,
    findApplicationIndexById,
    lookupUserName,

    // Access control
    isSelfOrAdmin,
    isHrAccessAllowed,

    // Leave helpers
    isSchoolBased,
    generateApplicationId,
};
