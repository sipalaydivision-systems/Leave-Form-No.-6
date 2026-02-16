#!/usr/bin/env node
// ============================================================
// Migration Script – JSON flat-files → PostgreSQL (Neon)
// Run once:  node migrate-data.js
// Prerequisites: DATABASE_URL env var must be set
// ============================================================
const fs = require('fs');
const path = require('path');

// Set DATABASE_URL from .env if present
try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
        const lines = fs.readFileSync(envPath, 'utf8').split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
                const eqIdx = trimmed.indexOf('=');
                if (eqIdx > 0) {
                    const key = trimmed.slice(0, eqIdx).trim();
                    const val = trimmed.slice(eqIdx + 1).trim();
                    if (!process.env[key]) process.env[key] = val;
                }
            }
        }
    }
} catch (e) { /* ignore */ }

const db = require('./db');

// Directory containing JSON files to migrate
const dataDir = process.env.MIGRATE_FROM || path.join(__dirname, 'data', 'defaults');

async function readJsonFile(filename) {
    const filepath = path.join(dataDir, filename);
    if (!fs.existsSync(filepath)) {
        console.log(`  ⏭  ${filename} not found, skipping`);
        return null;
    }
    try {
        let content = fs.readFileSync(filepath, 'utf8');
        if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
        return JSON.parse(content);
    } catch (err) {
        console.error(`  ✗  Error reading ${filename}:`, err.message);
        return null;
    }
}

async function migrateUsers(filename, role) {
    const data = await readJsonFile(filename);
    if (!data || !Array.isArray(data) || data.length === 0) {
        console.log(`  ⏭  ${filename}: empty or invalid`);
        return 0;
    }
    let count = 0;
    for (const user of data) {
        try {
            await db.insertUser(user, role);
            count++;
        } catch (err) {
            console.error(`  ✗  ${filename}: failed to insert user ${user.email}:`, err.message);
        }
    }
    console.log(`  ✓  ${filename}: ${count} user(s) migrated`);
    return count;
}

async function migrateApplications() {
    let data = await readJsonFile('applications.json');
    if (!data) return 0;
    // Handle wrapped format  {applications: [...]}
    if (!Array.isArray(data) && typeof data === 'object') {
        const keys = Object.keys(data);
        if (keys.length === 1 && Array.isArray(data[keys[0]])) {
            data = data[keys[0]];
        } else {
            data = [];
        }
    }
    if (data.length === 0) { console.log('  ⏭  applications.json: empty'); return 0; }
    let count = 0;
    for (const app of data) {
        try {
            await db.insertApplication(app);
            count++;
        } catch (err) {
            console.error(`  ✗  applications: failed to insert ${app.id}:`, err.message);
        }
    }
    console.log(`  ✓  applications.json: ${count} application(s) migrated`);
    return count;
}

async function migrateLeavecards() {
    const data = await readJsonFile('leavecards.json');
    if (!data || !Array.isArray(data) || data.length === 0) {
        console.log('  ⏭  leavecards.json: empty'); return 0;
    }
    let count = 0;
    for (const lc of data) {
        try {
            const email = lc.email || lc.employeeId || '';
            if (!email) { console.warn('  ⚠  leavecard without email, skipping'); continue; }
            await db.upsertLeavecard(email, lc);
            count++;
        } catch (err) {
            console.error('  ✗  leavecards: insert failed:', err.message);
        }
    }
    console.log(`  ✓  leavecards.json: ${count} card(s) migrated`);
    return count;
}

async function migrateCtoRecords() {
    const data = await readJsonFile('cto-records.json');
    if (!data || !Array.isArray(data) || data.length === 0) {
        console.log('  ⏭  cto-records.json: empty'); return 0;
    }
    let count = 0;
    for (const rec of data) {
        try {
            await db.insertCtoRecord(rec);
            count++;
        } catch (err) {
            console.error('  ✗  cto-records: insert failed:', err.message);
        }
    }
    console.log(`  ✓  cto-records.json: ${count} record(s) migrated`);
    return count;
}

async function migrateEmployees() {
    const data = await readJsonFile('employees.json');
    if (!data || !Array.isArray(data) || data.length === 0) {
        console.log('  ⏭  employees.json: empty'); return 0;
    }
    let count = 0;
    for (const emp of data) {
        try {
            const email = emp.email || '';
            if (!email) { console.warn('  ⚠  employee without email, skipping'); continue; }
            await db.upsertEmployee(email, emp);
            count++;
        } catch (err) {
            console.error('  ✗  employees: insert failed:', err.message);
        }
    }
    console.log(`  ✓  employees.json: ${count} employee(s) migrated`);
    return count;
}

async function migrateActivityLogs() {
    const data = await readJsonFile('activity-logs.json');
    if (!data || !Array.isArray(data) || data.length === 0) {
        console.log('  ⏭  activity-logs.json: empty'); return 0;
    }
    let count = 0;
    for (const log of data) {
        try {
            await db.insertActivityLog(log);
            count++;
        } catch (err) {
            // Duplicate id is fine, skip silently
            if (!err.message.includes('duplicate')) {
                console.error('  ✗  activity-logs: insert failed:', err.message);
            }
        }
    }
    console.log(`  ✓  activity-logs.json: ${count} log(s) migrated`);
    return count;
}

async function migratePendingRegistrations() {
    const data = await readJsonFile('pending-registrations.json');
    if (!data || !Array.isArray(data) || data.length === 0) {
        console.log('  ⏭  pending-registrations.json: empty'); return 0;
    }
    let count = 0;
    for (const reg of data) {
        try {
            await db.insertPendingRegistration(reg);
            count++;
        } catch (err) {
            console.error('  ✗  pending-registrations: insert failed:', err.message);
        }
    }
    console.log(`  ✓  pending-registrations.json: ${count} registration(s) migrated`);
    return count;
}

async function migrateSchools() {
    const data = await readJsonFile('schools.json');
    if (!data) { console.log('  ⏭  schools.json: not found'); return 0; }
    try {
        await db.setSchools(data);
        const schoolCount = data.districts
            ? data.districts.reduce((sum, d) => sum + (d.schools ? d.schools.length : 0), 0)
            : 0;
        console.log(`  ✓  schools.json: migrated (${schoolCount} schools in ${(data.districts || []).length} districts)`);
        return 1;
    } catch (err) {
        console.error('  ✗  schools: migration failed:', err.message);
        return 0;
    }
}

async function migrateInitialCredits() {
    const data = await readJsonFile('initial-credits.json');
    if (!data) { console.log('  ⏭  initial-credits.json: not found'); return 0; }
    try {
        await db.setInitialCredits(Array.isArray(data) ? data : []);
        console.log(`  ✓  initial-credits.json: migrated`);
        return 1;
    } catch (err) {
        console.error('  ✗  initial-credits: migration failed:', err.message);
        return 0;
    }
}

async function migrateSoRecords() {
    const data = await readJsonFile('so-records.json');
    if (!data || !Array.isArray(data) || data.length === 0) {
        console.log('  ⏭  so-records.json: empty'); return 0;
    }
    try {
        await db.setSoRecords(data);
        console.log(`  ✓  so-records.json: ${data.length} record(s) migrated`);
        return data.length;
    } catch (err) {
        console.error('  ✗  so-records: migration failed:', err.message);
        return 0;
    }
}

// ── Main ────────────────────────────────────────────────────
async function main() {
    console.log('═══════════════════════════════════════════════════');
    console.log('  Leave Form – JSON → PostgreSQL Migration');
    console.log(`  Source:  ${dataDir}`);
    console.log(`  Target:  ${process.env.DATABASE_URL?.replace(/:([^:@]+)@/, ':***@')}`);
    console.log('═══════════════════════════════════════════════════\n');

    if (!fs.existsSync(dataDir)) {
        console.error(`ERROR: Data directory not found: ${dataDir}`);
        process.exit(1);
    }

    // 1. Initialise schema
    console.log('[1/12] Initialising database schema...');
    await db.initialize();
    console.log('');

    // 2. Migrate users (6 role-based files)
    console.log('[2/12] Migrating users...');
    await migrateUsers('users.json', 'user');
    await migrateUsers('ao-users.json', 'ao');
    await migrateUsers('hr-users.json', 'hr');
    await migrateUsers('asds-users.json', 'asds');
    await migrateUsers('sds-users.json', 'sds');
    await migrateUsers('it-users.json', 'it');
    console.log('');

    // 3. Migrate pending registrations
    console.log('[3/12] Migrating pending registrations...');
    await migratePendingRegistrations();
    console.log('');

    // 4. Migrate applications
    console.log('[4/12] Migrating applications...');
    await migrateApplications();
    console.log('');

    // 5. Migrate leavecards
    console.log('[5/12] Migrating leavecards...');
    await migrateLeavecards();
    console.log('');

    // 6. Migrate CTO records
    console.log('[6/12] Migrating CTO records...');
    await migrateCtoRecords();
    console.log('');

    // 7. Migrate employees
    console.log('[7/12] Migrating employees...');
    await migrateEmployees();
    console.log('');

    // 8. Migrate activity logs
    console.log('[8/12] Migrating activity logs...');
    await migrateActivityLogs();
    console.log('');

    // 9. Migrate schools
    console.log('[9/12] Migrating schools...');
    await migrateSchools();
    console.log('');

    // 10. Migrate initial credits
    console.log('[10/12] Migrating initial credits...');
    await migrateInitialCredits();
    console.log('');

    // 11. Migrate SO records
    console.log('[11/12] Migrating SO records...');
    await migrateSoRecords();
    console.log('');

    // 12. Verify
    console.log('[12/12] Verifying migration...');
    const status = await db.getSystemStatus();
    console.log('  System status:', JSON.stringify(status, null, 2));
    console.log('');

    console.log('═══════════════════════════════════════════════════');
    console.log('  ✓  Migration complete!');
    console.log('═══════════════════════════════════════════════════');

    await db.pool.end();
    process.exit(0);
}

main().catch(err => {
    console.error('\n✗ Migration failed:', err);
    process.exit(1);
});
