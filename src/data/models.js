/**
 * Data-model builder functions.
 *
 * Pure factory helpers that return plain objects — no I/O, no side
 * effects.  Extracted from server.js so every call-site constructs
 * identical shapes without copy-pasting 20+ field object literals.
 */

const crypto = require('crypto');

// Shared constant — month labels indexed 1-12 (index 0 is intentionally empty).
const MONTH_NAMES = [
    '', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Create a default leave card object for a new employee.
 *
 * @param {string}  email       - Employee email (used as employeeId).
 * @param {string}  name        - Full display name.
 * @param {object}  [nameFields]  - Optional `{ firstName, lastName, middleName, suffix }`.
 * @param {number}  [vlCredits=0] - Initial Vacation Leave credits.
 * @param {number}  [slCredits=0] - Initial Sick Leave credits.
 * @returns {object} Leave card object ready for persistence.
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
        vacationLeaveSpent: 0,
        sickLeaveSpent: 0,
        forceLeaveSpent: 0,
        splSpent: 0,
        vl: vl,
        sl: sl,
        spl: 3,
        others: 0,
        forceLeaveYear: new Date().getFullYear(),
        splYear: new Date().getFullYear(),
        leaveUsageHistory: [],
        transactions: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        initialCreditsSource: 'accrual',
    };
}

/**
 * Create a monthly accrual transaction entry.
 *
 * @param {number}  month      - Month number (1-12).
 * @param {number}  year       - Calendar year.
 * @param {number}  runningVL  - Running VL balance *after* this accrual.
 * @param {number}  runningSL  - Running SL balance *after* this accrual.
 * @param {string}  source     - Origin tag, e.g. `'system-accrual'`, `'system-accrual-catchup'`.
 * @param {number}  [accrual=1.25] - Monthly accrual amount.
 * @returns {object} Transaction entry.
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
        date: new Date().toISOString(),
    };
}

/**
 * Build a portal user object from a pending registration record.
 *
 * @param {object} registration - The pending registration record.
 * @param {string} role         - Portal role (`'user'`, `'ao'`, `'hr'`, `'asds'`, `'sds'`).
 * @returns {object} User object ready for insertion into the portal's user file.
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
        createdAt: registration.createdAt,
    };
}

/**
 * Build a new employee record from raw field values.
 *
 * Parses a comma-separated full name (`"Last, First Middle"`) or a
 * space-separated name (`"First Middle Last"`) into constituent parts.
 *
 * @param {string} office      - School/office name.
 * @param {string} fullName    - Employee full name.
 * @param {string} email       - Employee email.
 * @param {string} position    - Job title / position.
 * @param {string|number} salaryGrade - Salary grade number.
 * @param {string|number} step        - Step increment.
 * @param {string|number} salary      - Monthly salary.
 * @param {string} district    - District designation.
 * @param {string} suffix      - Name suffix (Jr., III, etc.).
 * @param {string} employeeNo  - Employee number / ID.
 * @returns {object} Employee record ready for persistence.
 */
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
        suffix: suffix || '',
        employeeNo: employeeNo || '',
        fullName: fullName || '',
        position: position || '',
        salaryGrade: salaryGrade ? parseInt(salaryGrade) : null,
        step: step ? parseInt(step) : null,
        salary: salary ? Number(salary) : null,
        email: email || '',
        createdAt: new Date().toISOString(),
    };
}

module.exports = {
    MONTH_NAMES,
    createDefaultLeaveCard,
    createAccrualTransaction,
    buildPortalUser,
    buildEmployeeRecord,
};
