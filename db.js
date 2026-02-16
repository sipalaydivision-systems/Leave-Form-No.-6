// ============================================================
// Database Module – PostgreSQL (Neon) via `pg`
// Replaces all JSON flat-file operations in server.js
// ============================================================
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Connection pool ─────────────────────────────────────────
if (!process.env.DATABASE_URL) {
    console.error('[DB] ERROR: DATABASE_URL environment variable is not set.');
    console.error('[DB] Set it to your Neon PostgreSQL connection string.');
    console.error('[DB] Example: postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/dbname?sslmode=require');
    process.exit(1);
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
    console.error('[DB] Unexpected pool error:', err.message);
});

// ── Schema initialisation ───────────────────────────────────
async function initialize() {
    try {
        const schemaPath = path.join(__dirname, 'schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');
        await pool.query(schema);
        console.log('[DB] Schema initialised ✓');
    } catch (err) {
        console.error('[DB] Schema initialisation failed:', err.message);
        throw err;
    }
}

// ═════════════════════════════════════════════════════════════
//  USERS  (merges 6 former JSON files via `role` column)
// ═════════════════════════════════════════════════════════════

async function getUsers(role) {
    const { rows } = await pool.query(
        'SELECT data FROM users WHERE role = $1 ORDER BY created_at',
        [role]
    );
    return rows.map(r => r.data);
}

async function findUserByEmail(email, role) {
    const { rows } = await pool.query(
        'SELECT data FROM users WHERE email = $1 AND role = $2',
        [email, role]
    );
    return rows.length ? rows[0].data : null;
}

async function findUserById(id, role) {
    const { rows } = await pool.query(
        'SELECT data FROM users WHERE id = $1 AND role = $2',
        [id, role]
    );
    return rows.length ? rows[0].data : null;
}

async function insertUser(userData, role) {
    await pool.query(
        `INSERT INTO users (id, email, role, data, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id, role) DO UPDATE SET data = $4, email = $2`,
        [
            userData.id,
            userData.email,
            role,
            JSON.stringify(userData),
            userData.createdAt || new Date().toISOString(),
        ]
    );
}

async function updateUserById(id, role, updatedData) {
    await pool.query(
        'UPDATE users SET email = $3, data = $4 WHERE id = $1 AND role = $2',
        [id, role, updatedData.email, JSON.stringify(updatedData)]
    );
}

async function updateUserByEmail(email, role, updatedData) {
    await pool.query(
        'UPDATE users SET data = $3 WHERE email = $1 AND role = $2',
        [email, role, JSON.stringify(updatedData)]
    );
}

async function deleteUserById(id, role) {
    await pool.query('DELETE FROM users WHERE id = $1 AND role = $2', [id, role]);
}

async function deleteUserByEmail(email, role) {
    await pool.query('DELETE FROM users WHERE email = $1 AND role = $2', [email, role]);
}

async function deleteAllUsers(role) {
    if (role) {
        await pool.query('DELETE FROM users WHERE role = $1', [role]);
    } else {
        await pool.query('DELETE FROM users');
    }
}

async function countUsers(role) {
    const { rows } = await pool.query(
        'SELECT COUNT(*)::int AS count FROM users WHERE role = $1',
        [role]
    );
    return rows[0].count;
}

async function getAllRegisteredUsers() {
    const { rows } = await pool.query('SELECT data FROM users ORDER BY created_at');
    return rows.map(r => r.data);
}

// ═════════════════════════════════════════════════════════════
//  PENDING REGISTRATIONS
// ═════════════════════════════════════════════════════════════

async function getPendingRegistrations() {
    const { rows } = await pool.query(
        'SELECT data FROM pending_registrations ORDER BY created_at'
    );
    return rows.map(r => r.data);
}

async function findPendingByEmail(email, role) {
    if (role) {
        const { rows } = await pool.query(
            'SELECT data FROM pending_registrations WHERE email = $1 AND role = $2',
            [email, role]
        );
        return rows.length ? rows[0].data : null;
    }
    const { rows } = await pool.query(
        'SELECT data FROM pending_registrations WHERE email = $1',
        [email]
    );
    return rows.length ? rows[0].data : null;
}

async function insertPendingRegistration(reg) {
    await pool.query(
        `INSERT INTO pending_registrations (id, email, role, data, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email, role) DO UPDATE SET data = $4`,
        [
            reg.id,
            reg.email,
            reg.role || 'user',
            JSON.stringify(reg),
            reg.createdAt || new Date().toISOString(),
        ]
    );
}

async function deletePendingByEmail(email, role) {
    if (role) {
        await pool.query(
            'DELETE FROM pending_registrations WHERE email = $1 AND role = $2',
            [email, role]
        );
    } else {
        await pool.query(
            'DELETE FROM pending_registrations WHERE email = $1',
            [email]
        );
    }
}

async function deleteAllPending() {
    await pool.query('DELETE FROM pending_registrations');
}

// ═════════════════════════════════════════════════════════════
//  APPLICATIONS
// ═════════════════════════════════════════════════════════════

async function getApplications() {
    const { rows } = await pool.query(
        'SELECT data FROM applications ORDER BY submitted_at DESC'
    );
    return rows.map(r => r.data);
}

async function getApplicationById(id) {
    const { rows } = await pool.query(
        'SELECT data FROM applications WHERE id = $1',
        [id]
    );
    return rows.length ? rows[0].data : null;
}

async function getApplicationsByEmail(email) {
    const { rows } = await pool.query(
        'SELECT data FROM applications WHERE employee_email = $1 ORDER BY submitted_at DESC',
        [email]
    );
    return rows.map(r => r.data);
}

async function getApplicationsByStatus(status, approver) {
    if (approver) {
        const { rows } = await pool.query(
            'SELECT data FROM applications WHERE status = $1 AND current_approver = $2 ORDER BY submitted_at DESC',
            [status, approver]
        );
        return rows.map(r => r.data);
    }
    const { rows } = await pool.query(
        'SELECT data FROM applications WHERE status = $1 ORDER BY submitted_at DESC',
        [status]
    );
    return rows.map(r => r.data);
}

async function getApplicationsByFilter(filterFn) {
    const all = await getApplications();
    return all.filter(filterFn);
}

async function insertApplication(app) {
    await pool.query(
        `INSERT INTO applications (id, employee_email, status, current_approver, leave_type, data, submitted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING`,
        [
            app.id,
            app.employeeEmail || app.employee_email || '',
            app.status || 'pending',
            app.currentApprover || app.current_approver || 'AO',
            app.leaveType || app.typeOfLeave || app.leave_type || '',
            JSON.stringify(app),
            app.submittedAt || app.submitted_at || new Date().toISOString(),
        ]
    );
}

async function updateApplication(id, updatedApp) {
    await pool.query(
        `UPDATE applications
         SET employee_email = $2, status = $3, current_approver = $4,
             leave_type = $5, data = $6
         WHERE id = $1`,
        [
            id,
            updatedApp.employeeEmail || updatedApp.employee_email || '',
            updatedApp.status || 'pending',
            updatedApp.currentApprover || updatedApp.current_approver || '',
            updatedApp.leaveType || updatedApp.typeOfLeave || updatedApp.leave_type || '',
            JSON.stringify(updatedApp),
        ]
    );
}

async function deleteAllApplications() {
    await pool.query('DELETE FROM applications');
}

async function countApplications() {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM applications');
    return rows[0].count;
}

// ═════════════════════════════════════════════════════════════
//  LEAVE CARDS
// ═════════════════════════════════════════════════════════════

async function getLeavecards() {
    const { rows } = await pool.query('SELECT data FROM leavecards ORDER BY created_at');
    return rows.map(r => r.data);
}

async function getLeavecardByEmail(email) {
    const { rows } = await pool.query(
        'SELECT data FROM leavecards WHERE email = $1',
        [email]
    );
    return rows.length ? rows[0].data : null;
}

async function upsertLeavecard(email, data) {
    await pool.query(
        `INSERT INTO leavecards (email, data, created_at, updated_at)
         VALUES ($1, $2, NOW(), NOW())
         ON CONFLICT (email) DO UPDATE SET data = $2, updated_at = NOW()`,
        [email, JSON.stringify(data)]
    );
}

async function deleteAllLeavecards() {
    await pool.query('DELETE FROM leavecards');
}

async function countLeavecards() {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM leavecards');
    return rows[0].count;
}

// ═════════════════════════════════════════════════════════════
//  CTO RECORDS
// ═════════════════════════════════════════════════════════════

async function getCtoRecordsByEmployee(employeeId) {
    const { rows } = await pool.query(
        'SELECT data FROM cto_records WHERE employee_id = $1 ORDER BY created_at',
        [employeeId]
    );
    return rows.map(r => r.data);
}

async function getAllCtoRecords() {
    const { rows } = await pool.query('SELECT data FROM cto_records ORDER BY created_at');
    return rows.map(r => r.data);
}

async function insertCtoRecord(record) {
    const id = record.id || crypto.randomUUID();
    await pool.query(
        `INSERT INTO cto_records (id, employee_id, data, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET data = $3, employee_id = $2`,
        [
            id,
            record.employeeId || record.employee_id || '',
            JSON.stringify({ ...record, id }),
            record.createdAt || new Date().toISOString(),
        ]
    );
}

async function updateCtoRecord(recordId, updatedRecord) {
    await pool.query(
        'UPDATE cto_records SET employee_id = $2, data = $3 WHERE id = $1',
        [recordId, updatedRecord.employeeId || updatedRecord.employee_id || '', JSON.stringify(updatedRecord)]
    );
}

async function deleteAllCtoRecords() {
    await pool.query('DELETE FROM cto_records');
}

async function countCtoRecords() {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM cto_records');
    return rows[0].count;
}

// ═════════════════════════════════════════════════════════════
//  EMPLOYEES
// ═════════════════════════════════════════════════════════════

async function getEmployees() {
    const { rows } = await pool.query('SELECT data FROM employees ORDER BY created_at');
    return rows.map(r => r.data);
}

async function getEmployeeByEmail(email) {
    const { rows } = await pool.query(
        'SELECT data FROM employees WHERE email = $1',
        [email]
    );
    return rows.length ? rows[0].data : null;
}

async function upsertEmployee(email, data) {
    await pool.query(
        `INSERT INTO employees (email, data, created_at, updated_at)
         VALUES ($1, $2, NOW(), NOW())
         ON CONFLICT (email) DO UPDATE SET data = $2, updated_at = NOW()`,
        [email, JSON.stringify(data)]
    );
}

async function deleteAllEmployees() {
    await pool.query('DELETE FROM employees');
}

// ═════════════════════════════════════════════════════════════
//  ACTIVITY LOGS
// ═════════════════════════════════════════════════════════════

async function insertActivityLog(logEntry) {
    try {
        await pool.query(
            `INSERT INTO activity_logs (id, action, portal_type, user_email, log_timestamp, data)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (id) DO NOTHING`,
            [
                logEntry.id || crypto.randomUUID(),
                logEntry.action || '',
                logEntry.portalType || '',
                logEntry.userEmail || '',
                logEntry.timestamp || new Date().toISOString(),
                JSON.stringify(logEntry),
            ]
        );
    } catch (err) {
        console.error('[DB] Error inserting activity log:', err.message);
    }
}

async function getActivityLogs({ action, portal, email, startDate, endDate, page, limit } = {}) {
    let sql = 'SELECT data FROM activity_logs WHERE 1=1';
    const params = [];
    let n = 0;

    if (action)    { params.push(action);    sql += ` AND action = $${++n}`; }
    if (portal)    { params.push(portal);    sql += ` AND portal_type = $${++n}`; }
    if (email)     { params.push(email);     sql += ` AND user_email = $${++n}`; }
    if (startDate) { params.push(startDate); sql += ` AND log_timestamp >= $${++n}`; }
    if (endDate)   { params.push(endDate);   sql += ` AND log_timestamp <= $${++n}`; }

    sql += ' ORDER BY log_timestamp DESC';

    if (limit) {
        params.push(limit);
        sql += ` LIMIT $${++n}`;
        if (page && page > 1) {
            params.push((page - 1) * limit);
            sql += ` OFFSET $${++n}`;
        }
    }

    const { rows } = await pool.query(sql, params);
    return rows.map(r => r.data);
}

async function getActivityLogCount(filters = {}) {
    let sql = 'SELECT COUNT(*)::int AS count FROM activity_logs WHERE 1=1';
    const params = [];
    let n = 0;

    if (filters.action)    { params.push(filters.action);    sql += ` AND action = $${++n}`; }
    if (filters.portal)    { params.push(filters.portal);    sql += ` AND portal_type = $${++n}`; }
    if (filters.email)     { params.push(filters.email);     sql += ` AND user_email = $${++n}`; }
    if (filters.startDate) { params.push(filters.startDate); sql += ` AND log_timestamp >= $${++n}`; }
    if (filters.endDate)   { params.push(filters.endDate);   sql += ` AND log_timestamp <= $${++n}`; }

    const { rows } = await pool.query(sql, params);
    return rows[0].count;
}

async function getAllActivityLogs() {
    const { rows } = await pool.query(
        'SELECT data FROM activity_logs ORDER BY log_timestamp DESC'
    );
    return rows.map(r => r.data);
}

async function deleteAllActivityLogs() {
    await pool.query('DELETE FROM activity_logs');
}

// Keep only the last N logs (mimics the old 10 000-cap)
async function trimActivityLogs(maxCount = 10000) {
    await pool.query(
        `DELETE FROM activity_logs
         WHERE _pk NOT IN (
             SELECT _pk FROM activity_logs ORDER BY log_timestamp DESC LIMIT $1
         )`,
        [maxCount]
    );
}

// ═════════════════════════════════════════════════════════════
//  SCHOOLS
// ═════════════════════════════════════════════════════════════

async function getSchools() {
    const { rows } = await pool.query('SELECT data FROM schools WHERE id = 1');
    return rows.length ? rows[0].data : { districts: [] };
}

async function setSchools(data) {
    await pool.query(
        'INSERT INTO schools (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = $1',
        [JSON.stringify(data)]
    );
}

// ═════════════════════════════════════════════════════════════
//  INITIAL CREDITS
// ═════════════════════════════════════════════════════════════

async function getInitialCredits() {
    const { rows } = await pool.query('SELECT data FROM initial_credits WHERE id = 1');
    return rows.length ? rows[0].data : [];
}

async function setInitialCredits(data) {
    await pool.query(
        'INSERT INTO initial_credits (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = $1',
        [JSON.stringify(data)]
    );
}

// ═════════════════════════════════════════════════════════════
//  SO RECORDS
// ═════════════════════════════════════════════════════════════

async function getSoRecords() {
    const { rows } = await pool.query('SELECT data FROM so_records ORDER BY created_at');
    return rows.map(r => r.data);
}

async function setSoRecords(records) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM so_records');
        for (const rec of records) {
            await client.query(
                'INSERT INTO so_records (data, created_at) VALUES ($1, NOW())',
                [JSON.stringify(rec)]
            );
        }
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

// ═════════════════════════════════════════════════════════════
//  FILE UPLOADS  (R2 metadata tracking)
// ═════════════════════════════════════════════════════════════

async function insertFileUpload(upload) {
    const { rows } = await pool.query(
        `INSERT INTO file_uploads (application_id, file_name, content_type, r2_key, file_size)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [upload.applicationId, upload.fileName, upload.contentType || 'application/pdf', upload.r2Key, upload.fileSize || 0]
    );
    return rows[0].id;
}

async function getFileUploadsByApp(applicationId) {
    const { rows } = await pool.query(
        'SELECT * FROM file_uploads WHERE application_id = $1 ORDER BY created_at',
        [applicationId]
    );
    return rows;
}

// ═════════════════════════════════════════════════════════════
//  BULK  (export / import / backup helpers)
// ═════════════════════════════════════════════════════════════

async function exportAllData() {
    return {
        'users':                  await getUsers('user'),
        'ao-users':               await getUsers('ao'),
        'hr-users':               await getUsers('hr'),
        'asds-users':             await getUsers('asds'),
        'sds-users':              await getUsers('sds'),
        'it-users':               await getUsers('it'),
        'applications':           await getApplications(),
        'leavecards':             await getLeavecards(),
        'employees':              await getEmployees(),
        'cto-records':            await getAllCtoRecords(),
        'pending-registrations':  await getPendingRegistrations(),
        'activity-logs':          await getAllActivityLogs(),
        'schools':                await getSchools(),
        'initial-credits':        await getInitialCredits(),
        'so-records':             await getSoRecords(),
    };
}

/**
 * Import data for a specific "table" (matches legacy JSON file names).
 * Used by the data-management import endpoint.
 */
async function importDataForKey(key, records) {
    const roleMap = {
        'users': 'user', 'ao-users': 'ao', 'hr-users': 'hr',
        'asds-users': 'asds', 'sds-users': 'sds', 'it-users': 'it',
    };

    if (roleMap[key]) {
        const role = roleMap[key];
        await deleteAllUsers(role);
        if (Array.isArray(records)) {
            for (const u of records) await insertUser(u, role);
        }
        return;
    }

    switch (key) {
        case 'pending-registrations':
            await deleteAllPending();
            if (Array.isArray(records)) for (const r of records) await insertPendingRegistration(r);
            break;
        case 'applications':
            await deleteAllApplications();
            if (Array.isArray(records)) for (const a of records) await insertApplication(a);
            break;
        case 'leavecards':
            await deleteAllLeavecards();
            if (Array.isArray(records)) for (const lc of records) await upsertLeavecard(lc.email || lc.employeeId, lc);
            break;
        case 'cto-records':
            await deleteAllCtoRecords();
            if (Array.isArray(records)) for (const r of records) await insertCtoRecord(r);
            break;
        case 'employees':
            await deleteAllEmployees();
            if (Array.isArray(records)) for (const e of records) await upsertEmployee(e.email, e);
            break;
        case 'activity-logs':
            await deleteAllActivityLogs();
            if (Array.isArray(records)) for (const l of records) await insertActivityLog(l);
            break;
        case 'schools':
            await setSchools(records);
            break;
        case 'initial-credits':
            await setInitialCredits(Array.isArray(records) ? records : []);
            break;
        case 'so-records':
            if (Array.isArray(records)) await setSoRecords(records);
            break;
        default:
            console.warn(`[DB] importDataForKey: unknown key "${key}"`);
    }
}

/**
 * Clear specific tables (used by delete-all-data endpoints).
 * @param {string[]} keys  – legacy JSON file base-names (without .json)
 */
async function clearDataForKeys(keys) {
    const roleMap = {
        'users': 'user', 'ao-users': 'ao', 'hr-users': 'hr',
        'asds-users': 'asds', 'sds-users': 'sds', 'it-users': 'it',
    };

    for (const key of keys) {
        if (roleMap[key]) { await deleteAllUsers(roleMap[key]); continue; }
        switch (key) {
            case 'pending-registrations': await deleteAllPending(); break;
            case 'applications':          await deleteAllApplications(); break;
            case 'leavecards':            await deleteAllLeavecards(); break;
            case 'cto-records':           await deleteAllCtoRecords(); break;
            case 'employees':             await deleteAllEmployees(); break;
            case 'activity-logs':         await deleteAllActivityLogs(); break;
            case 'schools':               await pool.query('DELETE FROM schools'); break;
            case 'initial-credits':       await pool.query('DELETE FROM initial_credits'); break;
            case 'so-records':            await pool.query('DELETE FROM so_records'); break;
        }
    }
}

// ═════════════════════════════════════════════════════════════
//  SYSTEM STATUS
// ═════════════════════════════════════════════════════════════

async function getSystemStatus() {
    const [it, users, ao, hr, lc, cto] = await Promise.all([
        countUsers('it'),
        countUsers('user'),
        countUsers('ao'),
        countUsers('hr'),
        countLeavecards(),
        countCtoRecords(),
    ]);
    return {
        'it-users': it,
        'users': users,
        'ao-users': ao,
        'hr-users': hr,
        'leavecards': lc,
        'cto-records': cto,
    };
}

// ═════════════════════════════════════════════════════════════
//  EXPORTS
// ═════════════════════════════════════════════════════════════

module.exports = {
    pool,
    initialize,

    // Users
    getUsers,
    findUserByEmail,
    findUserById,
    insertUser,
    updateUserById,
    updateUserByEmail,
    deleteUserById,
    deleteUserByEmail,
    deleteAllUsers,
    countUsers,
    getAllRegisteredUsers,

    // Pending Registrations
    getPendingRegistrations,
    findPendingByEmail,
    insertPendingRegistration,
    deletePendingByEmail,
    deleteAllPending,

    // Applications
    getApplications,
    getApplicationById,
    getApplicationsByEmail,
    getApplicationsByStatus,
    getApplicationsByFilter,
    insertApplication,
    updateApplication,
    deleteAllApplications,
    countApplications,

    // Leave Cards
    getLeavecards,
    getLeavecardByEmail,
    upsertLeavecard,
    deleteAllLeavecards,
    countLeavecards,

    // CTO Records
    getCtoRecordsByEmployee,
    getAllCtoRecords,
    insertCtoRecord,
    updateCtoRecord,
    deleteAllCtoRecords,
    countCtoRecords,

    // Employees
    getEmployees,
    getEmployeeByEmail,
    upsertEmployee,
    deleteAllEmployees,

    // Activity Logs
    insertActivityLog,
    getActivityLogs,
    getActivityLogCount,
    getAllActivityLogs,
    deleteAllActivityLogs,
    trimActivityLogs,

    // Schools
    getSchools,
    setSchools,

    // Initial Credits
    getInitialCredits,
    setInitialCredits,

    // SO Records
    getSoRecords,
    setSoRecords,

    // File Uploads
    insertFileUpload,
    getFileUploadsByApp,

    // Bulk
    exportAllData,
    importDataForKey,
    clearDataForKeys,

    // System
    getSystemStatus,
};
