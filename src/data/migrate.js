/**
 * Database Migration — Creates schema and migrates JSON data to PostgreSQL.
 *
 * Usage:
 *   const { runMigration } = require('./src/data/migrate');
 *   await runMigration();
 *
 * Idempotent: safe to run multiple times. Checks system_state for
 * 'db_migrated' flag before importing data.
 */

const fs = require('fs');
const path = require('path');
const db = require('./db');
const { readJSONArray, readJSON } = require('./json-store');
const { dataDir } = require('../config');

/**
 * Run the full migration: create schema, then migrate JSON data.
 */
async function runMigration() {
    if (!db.isDbConnected()) {
        console.log('[MIGRATE] Skipping — no database connection');
        return false;
    }

    console.log('[MIGRATE] Starting database migration...');

    // Step 1: Create tables
    await createSchema();

    // Step 2: Check if already migrated
    const migrated = await isMigrated();
    if (migrated) {
        console.log('[MIGRATE] Data already migrated — skipping import');
        return true;
    }

    // Step 3: Migrate JSON data
    await migrateData();

    // Step 4: Mark as migrated
    await markMigrated();

    console.log('[MIGRATE] Migration complete');
    return true;
}

/**
 * Create all tables from schema.sql (idempotent via IF NOT EXISTS).
 */
async function createSchema() {
    const schemaPath = path.join(__dirname, '..', '..', 'scripts', 'schema.sql');
    if (!fs.existsSync(schemaPath)) {
        console.error('[MIGRATE] schema.sql not found at:', schemaPath);
        throw new Error('Schema file not found');
    }

    const sql = fs.readFileSync(schemaPath, 'utf8');
    await db.query(sql);
    console.log('[MIGRATE] Schema created/verified');
}

/**
 * Check system_state for migration flag.
 */
async function isMigrated() {
    try {
        const { rows } = await db.query(
            "SELECT value FROM system_state WHERE key = 'db_migrated'"
        );
        return rows.length > 0 && rows[0].value === 'true';
    } catch (err) {
        // Table might not exist yet on first run
        return false;
    }
}

/**
 * Mark migration as complete.
 */
async function markMigrated() {
    await db.query(
        `INSERT INTO system_state (key, value, updated_at)
         VALUES ('db_migrated', 'true', NOW())
         ON CONFLICT (key) DO UPDATE SET value = 'true', updated_at = NOW()`
    );
}

/**
 * Migrate all JSON data files to PostgreSQL.
 */
async function migrateData() {
    console.log('[MIGRATE] Migrating JSON data to PostgreSQL...');

    await migrateSchools();
    await migrateUsers();
    await migrateLeaveCards();
    await migrateApplications();
    await migrateCtoRecords();
    await migratePendingRegistrations();
    await migrateActivityLogs();
    await migrateSystemState();

    console.log('[MIGRATE] All JSON data migrated');
}

// ------------------------------------------------------------------
// Individual migration functions
// ------------------------------------------------------------------

async function migrateSchools() {
    const file = path.join(dataDir, 'schools.json');
    if (!fs.existsSync(file)) return;

    const schools = readJSONArray(file);
    if (schools.length === 0) return;

    console.log(`[MIGRATE] Migrating ${schools.length} schools...`);
    for (const s of schools) {
        await db.query(
            `INSERT INTO schools (id, name, district_id, district_name)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (id) DO NOTHING`,
            [s.id || s.schoolId, s.name || s.schoolName, s.districtId || s.district_id, s.districtName || s.district_name]
        );
    }
}

async function migrateUsers() {
    const roleFiles = {
        user: 'users.json',
        ao:   'ao-users.json',
        hr:   'hr-users.json',
        asds: 'asds-users.json',
        sds:  'sds-users.json',
        it:   'it-users.json',
    };

    let totalUsers = 0;
    for (const [role, filename] of Object.entries(roleFiles)) {
        const file = path.join(dataDir, filename);
        if (!fs.existsSync(file)) continue;

        const users = readJSONArray(file);
        for (const u of users) {
            const name = u.fullName || u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim();
            await db.query(
                `INSERT INTO users (email, password_hash, name, first_name, last_name, middle_name,
                 suffix, role, office, position, salary_grade, step, salary, employee_number,
                 pin_hash, district, school, created_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
                 ON CONFLICT (email) DO NOTHING`,
                [
                    u.email,
                    u.password || u.passwordHash || u.password_hash || '',
                    name,
                    u.firstName || u.first_name,
                    u.lastName || u.last_name,
                    u.middleName || u.middle_name,
                    u.suffix,
                    role,
                    u.office,
                    u.position,
                    u.salaryGrade || u.salary_grade,
                    u.step,
                    u.salary ? parseFloat(u.salary) || null : null,
                    u.employeeNo || u.employeeNumber || u.employee_number,
                    u.pin || u.pinHash || u.pin_hash,
                    u.district,
                    u.school,
                    u.createdAt || u.created_at || new Date().toISOString(),
                ]
            );
            totalUsers++;
        }
    }
    console.log(`[MIGRATE] Migrated ${totalUsers} users`);
}

async function migrateLeaveCards() {
    const file = path.join(dataDir, 'leavecards.json');
    if (!fs.existsSync(file)) return;

    const cards = readJSONArray(file);
    console.log(`[MIGRATE] Migrating ${cards.length} leave cards...`);

    for (const c of cards) {
        // Find user_id
        let userId = null;
        try {
            const { rows } = await db.query('SELECT id FROM users WHERE email = $1 LIMIT 1', [c.email || c.employeeId]);
            if (rows.length > 0) userId = rows[0].id;
        } catch (e) { /* skip */ }

        const { rows } = await db.query(
            `INSERT INTO leave_cards (user_id, email, name, employee_number,
             vacation_leave_earned, sick_leave_earned, vacation_leave_spent, sick_leave_spent,
             force_leave_earned, force_leave_spent, force_leave_year,
             spl_earned, spl_spent, spl_year, others_balance,
             initial_credits_source, last_accrual_date, pvp_deduction_total,
             created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
             ON CONFLICT (email) DO NOTHING
             RETURNING id`,
            [
                userId,
                c.email || c.employeeId,
                c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim(),
                c.employeeNumber || c.employee_number,
                parseFloat(c.vacationLeaveEarned) || 0,
                parseFloat(c.sickLeaveEarned) || 0,
                parseFloat(c.vacationLeaveSpent) || 0,
                parseFloat(c.sickLeaveSpent) || 0,
                parseFloat(c.forceLeaveEarned) || 5,
                parseFloat(c.forceLeaveSpent) || 0,
                c.forceLeaveYear || null,
                parseFloat(c.splEarned) || 3,
                parseFloat(c.splSpent) || 0,
                c.splYear || null,
                parseFloat(c.others) || 0,
                c.initialCreditsSource || c.initial_credits_source,
                c.lastAccrualDate || c.last_accrual_date,
                parseFloat(c.pvpDeductionTotal) || 0,
                c.createdAt || c.created_at || new Date().toISOString(),
                c.updatedAt || c.updated_at || new Date().toISOString(),
            ]
        );

        if (rows.length === 0) continue; // Already exists
        const cardId = rows[0].id;

        // Migrate transactions
        const txns = c.transactions || [];
        for (const t of txns) {
            await db.query(
                `INSERT INTO leave_transactions (leave_card_id, type, period_covered,
                 vl_earned, sl_earned, vl_spent, sl_spent, forced_leave, spl_used,
                 vl_balance, sl_balance, total, source, application_id, notes, date_recorded)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
                [
                    cardId,
                    t.type || 'ADD',
                    t.periodCovered || t.period_covered,
                    parseFloat(t.vlEarned) || 0,
                    parseFloat(t.slEarned) || 0,
                    parseFloat(t.vlSpent) || 0,
                    parseFloat(t.slSpent) || 0,
                    parseFloat(t.forcedLeave || t.forced_leave) || 0,
                    parseFloat(t.splUsed || t.spl_used) || 0,
                    parseFloat(t.vlBalance) || null,
                    parseFloat(t.slBalance) || null,
                    parseFloat(t.total) || null,
                    t.source,
                    t.applicationId || t.application_id,
                    t.notes,
                    t.dateRecorded || t.date_recorded || t.date || new Date().toISOString(),
                ]
            );
        }

        // Migrate usage history
        const usages = c.leaveUsageHistory || [];
        for (const u of usages) {
            await db.query(
                `INSERT INTO leave_usage_history (leave_card_id, application_id, leave_type,
                 days_used, period_from, period_to, date_approved, approved_by, remarks,
                 balance_after_vl, balance_after_sl)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
                [
                    cardId,
                    u.applicationId || u.application_id,
                    u.leaveType || u.leave_type,
                    parseFloat(u.daysUsed || u.days_used) || 0,
                    u.periodFrom || u.period_from || null,
                    u.periodTo || u.period_to || null,
                    u.dateApproved || u.date_approved || null,
                    u.approvedBy || u.approved_by,
                    u.remarks,
                    parseFloat(u.balanceAfterVL || u.balance_after_vl) || null,
                    parseFloat(u.balanceAfterSL || u.balance_after_sl) || null,
                ]
            );
        }
    }
}

async function migrateApplications() {
    const file = path.join(dataDir, 'applications.json');
    if (!fs.existsSync(file)) return;

    const apps = readJSONArray(file);
    console.log(`[MIGRATE] Migrating ${apps.length} applications...`);

    for (const a of apps) {
        // Build leave_details JSONB
        const details = {};
        const detailKeys = ['locationPh', 'locationAbroad', 'abroadSpecify', 'sickHospital',
            'sickOutpatient', 'hospitalIllness', 'outpatientIllness', 'womenIllness',
            'studyMasters', 'studyBar', 'location_ph', 'location_abroad'];
        for (const k of detailKeys) {
            if (a[k]) details[k] = a[k];
        }

        await db.query(
            `INSERT INTO applications (id, employee_email, employee_name, office, position,
             salary, leave_type, leave_details, num_days, date_from, date_to, inclusive_dates,
             commutation, status, current_approver, is_school_based,
             vl_earned, vl_less, vl_balance, sl_earned, sl_less, sl_balance,
             ao_approved_at, ao_name, ao_recommendation, ao_signature,
             hr_approved_at, hr_officer_name, hr_certification, hr_signature,
             hr_days_with_pay, hr_days_without_pay,
             asds_approved_at, asds_officer_name, asds_recommendation, asds_signature,
             final_approval_at, sds_officer_name, sds_disapproval_reason, sds_signature,
             employee_signature, return_reason, rejection_reason, pdf_url,
             so_file_path, so_file_name, approval_history, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
                     $17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,
                     $33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49)
             ON CONFLICT (id) DO NOTHING`,
            [
                a.id,
                a.employeeEmail || a.employee_email,
                a.employeeName || a.employee_name,
                a.office,
                a.position,
                a.salary,
                a.leaveType || a.leave_type,
                JSON.stringify(details),
                parseFloat(a.numDays || a.num_days) || 0,
                a.dateFrom || a.date_from || null,
                a.dateTo || a.date_to || null,
                a.inclusiveDates || a.inclusive_dates,
                a.commutation,
                a.status || 'pending',
                a.currentApprover || a.current_approver,
                a.isSchoolBased || a.is_school_based || false,
                parseFloat(a.vlEarned) || null,
                parseFloat(a.vlLess) || null,
                parseFloat(a.vlBalance) || null,
                parseFloat(a.slEarned) || null,
                parseFloat(a.slLess) || null,
                parseFloat(a.slBalance) || null,
                a.aoApprovedAt || a.ao_approved_at || null,
                a.aoName || a.ao_name,
                a.aoRecommendation || a.ao_recommendation,
                a.aoSignature || a.ao_signature,
                a.hrApprovedAt || a.hr_approved_at || null,
                a.hrOfficerName || a.hr_officer_name,
                a.hrCertification || a.hr_certification,
                a.hrSignature || a.hr_signature,
                parseFloat(a.hrDaysWithPay || a.hr_days_with_pay) || null,
                parseFloat(a.hrDaysWithoutPay || a.hr_days_without_pay) || null,
                a.asdsApprovedAt || a.asds_approved_at || null,
                a.asdsOfficerName || a.asds_officer_name,
                a.asdsRecommendation || a.asds_recommendation,
                a.asdsSignature || a.asds_signature,
                a.finalApprovalAt || a.final_approval_at || a.sdsApprovedAt || null,
                a.sdsOfficerName || a.sds_officer_name,
                a.sdsDisapprovalReason || a.sds_disapproval_reason,
                a.sdsSignature || a.sds_signature,
                a.employeeSignature || a.employee_signature,
                a.returnReason || a.return_reason,
                a.rejectionReason || a.rejection_reason,
                a.pdfUrl || a.pdf_url,
                a.soFilePath || a.so_file_path,
                a.soFileName || a.so_file_name,
                JSON.stringify(a.approvalHistory || a.approval_history || []),
                a.submittedAt || a.created_at || new Date().toISOString(),
                a.updatedAt || a.updated_at || new Date().toISOString(),
            ]
        );
    }
}

async function migrateCtoRecords() {
    const file = path.join(dataDir, 'cto-records.json');
    if (!fs.existsSync(file)) return;

    const records = readJSONArray(file);
    console.log(`[MIGRATE] Migrating ${records.length} CTO records...`);

    for (const r of records) {
        await db.query(
            `INSERT INTO cto_records (id, email, employee_id, employee_name, type,
             so_details, period_covered, days_granted, days_used, balance,
             so_image, notes, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             ON CONFLICT (id) DO NOTHING`,
            [
                r.id,
                r.email || r.employeeId,
                r.employeeId || r.employee_id,
                r.employeeName || r.employee_name,
                r.type || 'ADD',
                r.soDetails || r.so_details,
                r.periodCovered || r.period_covered,
                parseFloat(r.daysGranted || r.days_granted) || 0,
                parseFloat(r.daysUsed || r.days_used) || 0,
                parseFloat(r.balance) || 0,
                r.soImage || r.so_image,
                r.notes,
                r.createdAt || r.created_at || new Date().toISOString(),
            ]
        );
    }
}

async function migratePendingRegistrations() {
    const file = path.join(dataDir, 'pending-registrations.json');
    if (!fs.existsSync(file)) return;

    const regs = readJSONArray(file);
    console.log(`[MIGRATE] Migrating ${regs.length} pending registrations...`);

    for (const r of regs) {
        await db.query(
            `INSERT INTO pending_registrations (email, password_hash, portal, full_name,
             first_name, last_name, middle_name, suffix, office, position,
             salary_grade, step, salary, employee_number, status, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
             ON CONFLICT DO NOTHING`,
            [
                r.email,
                r.password || r.passwordHash || r.password_hash || '',
                r.portal || r.role || 'user',
                r.fullName || r.full_name || r.name,
                r.firstName || r.first_name,
                r.lastName || r.last_name,
                r.middleName || r.middle_name,
                r.suffix,
                r.office,
                r.position,
                r.salaryGrade || r.salary_grade,
                r.step,
                r.salary ? parseFloat(r.salary) || null : null,
                r.employeeNo || r.employeeNumber || r.employee_number,
                r.status || 'pending',
                r.createdAt || r.created_at || new Date().toISOString(),
            ]
        );
    }
}

async function migrateActivityLogs() {
    const file = path.join(dataDir, 'activity-logs.json');
    if (!fs.existsSync(file)) return;

    const logs = readJSONArray(file);
    console.log(`[MIGRATE] Migrating ${logs.length} activity logs...`);

    // Batch insert for performance
    const batchSize = 100;
    for (let i = 0; i < logs.length; i += batchSize) {
        const batch = logs.slice(i, i + batchSize);
        const values = [];
        const placeholders = [];
        let idx = 1;

        for (const log of batch) {
            placeholders.push(`($${idx},$${idx+1},$${idx+2},$${idx+3},$${idx+4},$${idx+5},$${idx+6})`);
            values.push(
                log.timestamp || log.created_at || new Date().toISOString(),
                log.action,
                log.portalType || log.portal_type,
                log.userEmail || log.user_email,
                log.userName || log.user_name,
                log.ip,
                JSON.stringify(log.details || {}),
            );
            idx += 7;
        }

        if (placeholders.length > 0) {
            await db.query(
                `INSERT INTO activity_logs (timestamp, action, portal_type, user_email, user_name, ip, details)
                 VALUES ${placeholders.join(',')}`,
                values
            );
        }
    }
}

async function migrateSystemState() {
    const file = path.join(dataDir, 'system-state.json');
    if (!fs.existsSync(file)) return;

    const state = readJSON(file);
    if (!state || typeof state !== 'object') return;

    console.log('[MIGRATE] Migrating system state...');
    for (const [key, value] of Object.entries(state)) {
        await db.query(
            `INSERT INTO system_state (key, value, updated_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
            [key, typeof value === 'object' ? JSON.stringify(value) : String(value)]
        );
    }
}

module.exports = { runMigration, createSchema };
