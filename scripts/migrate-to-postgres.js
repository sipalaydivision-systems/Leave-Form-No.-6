#!/usr/bin/env node

/**
 * Migrate from JSON files to PostgreSQL database
 * Usage: DATABASE_URL=postgres://user:pass@host/dbname node scripts/migrate-to-postgres.js
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable not set');
    console.error('Usage: DATABASE_URL=postgres://user:pass@host/dbname node scripts/migrate-to-postgres.js');
    process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });
const dataDir = path.join(__dirname, '..', 'data');

// Utility to read JSON files
function readJSON(file) {
    try {
        const content = fs.readFileSync(file, 'utf8');
        return JSON.parse(content);
    } catch (e) {
        console.warn(`[WARN] Failed to read ${file}: ${e.message}`);
        return [];
    }
}

// Main migration function
async function migrate() {
    const client = await pool.connect();
    let migratedCount = 0;
    let errorCount = 0;

    try {
        console.log('[MIGRATE] Starting PostgreSQL migration...\n');

        // 1. Migrate Users (Employee Portal)
        console.log('[MIGRATE] Migrating employee users...');
        const users = readJSON(path.join(dataDir, 'users.json'));
        for (const user of users) {
            try {
                await client.query(
                    `INSERT INTO users (id, email, password, name, full_name, first_name, last_name, middle_name, suffix, office, position, employee_no, salary_grade, step, salary, role, created_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
                     ON CONFLICT (email) DO NOTHING`,
                    [user.id, user.email, user.password, user.name, user.fullName, user.firstName, user.lastName, user.middleName, user.suffix, user.office, user.position, user.employeeNo, user.salaryGrade, user.step, user.salary, user.role || 'user', user.createdAt]
                );
                migratedCount++;
            } catch (e) {
                console.error(`  [ERROR] Failed to migrate user ${user.email}: ${e.message}`);
                errorCount++;
            }
        }
        console.log(`  ✓ Migrated ${migratedCount} employee users\n`);

        // 2. Migrate HR Users
        console.log('[MIGRATE] Migrating HR users...');
        migratedCount = 0;
        const hrUsers = readJSON(path.join(dataDir, 'hr-users.json'));
        for (const user of hrUsers) {
            try {
                await client.query(
                    `INSERT INTO hr_users (id, email, password, name, full_name, first_name, last_name, middle_name, suffix, office, position, salary_grade, step, salary, role, created_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                     ON CONFLICT (email) DO NOTHING`,
                    [user.id || require('crypto').randomUUID(), user.email, user.password, user.name, user.fullName, user.firstName, user.lastName, user.middleName, user.suffix, user.office, user.position, user.salaryGrade, user.step, user.salary, user.role || 'hr', user.createdAt]
                );
                migratedCount++;
            } catch (e) {
                console.error(`  [ERROR] Failed to migrate HR user ${user.email}: ${e.message}`);
                errorCount++;
            }
        }
        console.log(`  ✓ Migrated ${migratedCount} HR users\n`);

        // 3. Migrate AOV Users
        console.log('[MIGRATE] Migrating AOV users...');
        migratedCount = 0;
        const aovUsers = readJSON(path.join(dataDir, 'aov-users.json'));
        for (const user of aovUsers) {
            try {
                await client.query(
                    `INSERT INTO aov_users (id, email, password, name, full_name, first_name, last_name, middle_name, suffix, office, position, salary_grade, step, salary, role, created_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                     ON CONFLICT (email) DO NOTHING`,
                    [user.id || require('crypto').randomUUID(), user.email, user.password, user.name, user.fullName, user.firstName, user.lastName, user.middleName, user.suffix, user.office, user.position, user.salaryGrade, user.step, user.salary, user.role || 'aov', user.createdAt]
                );
                migratedCount++;
            } catch (e) {
                console.error(`  [ERROR] Failed to migrate AOV user ${user.email}: ${e.message}`);
                errorCount++;
            }
        }
        console.log(`  ✓ Migrated ${migratedCount} AOV users\n`);

        // 4. Migrate ASDS Users
        console.log('[MIGRATE] Migrating ASDS users...');
        migratedCount = 0;
        const asdsUsers = readJSON(path.join(dataDir, 'asds-users.json'));
        for (const user of asdsUsers) {
            try {
                await client.query(
                    `INSERT INTO asds_users (id, email, password, name, full_name, first_name, last_name, middle_name, suffix, office, position, salary_grade, step, salary, role, created_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                     ON CONFLICT (email) DO NOTHING`,
                    [user.id || require('crypto').randomUUID(), user.email, user.password, user.name, user.fullName, user.firstName, user.lastName, user.middleName, user.suffix, user.office, user.position, user.salaryGrade, user.step, user.salary, user.role || 'asds', user.createdAt]
                );
                migratedCount++;
            } catch (e) {
                console.error(`  [ERROR] Failed to migrate ASDS user ${user.email}: ${e.message}`);
                errorCount++;
            }
        }
        console.log(`  ✓ Migrated ${migratedCount} ASDS users\n`);

        // 5. Migrate SDS Users
        console.log('[MIGRATE] Migrating SDS users...');
        migratedCount = 0;
        const sdsUsers = readJSON(path.join(dataDir, 'sds-users.json'));
        for (const user of sdsUsers) {
            try {
                await client.query(
                    `INSERT INTO sds_users (id, email, password, name, full_name, first_name, last_name, middle_name, suffix, office, position, salary_grade, step, salary, role, created_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                     ON CONFLICT (email) DO NOTHING`,
                    [user.id || require('crypto').randomUUID(), user.email, user.password, user.name, user.fullName, user.firstName, user.lastName, user.middleName, user.suffix, user.office, user.position, user.salaryGrade, user.step, user.salary, user.role || 'sds', user.createdAt]
                );
                migratedCount++;
            } catch (e) {
                console.error(`  [ERROR] Failed to migrate SDS user ${user.email}: ${e.message}`);
                errorCount++;
            }
        }
        console.log(`  ✓ Migrated ${migratedCount} SDS users\n`);

        // 6. Migrate IT Users
        console.log('[MIGRATE] Migrating IT users...');
        migratedCount = 0;
        const itUsers = readJSON(path.join(dataDir, 'it-users.json'));
        for (const user of itUsers) {
            try {
                await client.query(
                    `INSERT INTO it_users (id, email, password, name, full_name, created_at)
                     VALUES ($1, $2, $3, $4, $5, $6)
                     ON CONFLICT (email) DO NOTHING`,
                    [user.id || require('crypto').randomUUID(), user.email, user.password, user.name, user.fullName, user.createdAt]
                );
                migratedCount++;
            } catch (e) {
                console.error(`  [ERROR] Failed to migrate IT user ${user.email}: ${e.message}`);
                errorCount++;
            }
        }
        console.log(`  ✓ Migrated ${migratedCount} IT users\n`);

        // 7. Migrate Employees
        console.log('[MIGRATE] Migrating employees directory...');
        migratedCount = 0;
        const employees = readJSON(path.join(dataDir, 'employees.json'));
        for (const emp of employees) {
            try {
                await client.query(
                    `INSERT INTO employees (email, full_name, first_name, last_name, middle_name, suffix, office, position, salary_grade, step, salary, district, created_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                     ON CONFLICT (email) DO NOTHING`,
                    [emp.email, emp.fullName, emp.firstName, emp.lastName, emp.middleName, emp.suffix, emp.office, emp.position, emp.salaryGrade, emp.step, emp.salary, emp.district, emp.createdAt]
                );
                migratedCount++;
            } catch (e) {
                console.error(`  [ERROR] Failed to migrate employee ${emp.email}: ${e.message}`);
                errorCount++;
            }
        }
        console.log(`  ✓ Migrated ${migratedCount} employees\n`);

        // 8. Migrate Leave Cards
        console.log('[MIGRATE] Migrating leave cards...');
        migratedCount = 0;
        const leavecards = readJSON(path.join(dataDir, 'leavecards.json'));
        for (const card of leavecards) {
            try {
                await client.query(
                    `INSERT INTO leave_cards (email, employee_id, full_name, office, position, salary_grade, step, salary, district, vacation_leave_earned, vacation_leave_used, sick_leave_earned, sick_leave_used, special_privilege_leave, spl_year, wellness_leave, wellness_year, vl, sl, spl, last_accrual_date, created_at, updated_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
                     ON CONFLICT (email) DO NOTHING`,
                    [card.email, card.employeeId, card.fullName, card.office, card.position, card.salaryGrade, card.step, card.salary, card.district, card.vacationLeaveEarned, card.vacationLeaveUsed, card.sickLeaveEarned, card.sickLeaveUsed, card.specialPrivilegeLeave, card.splYear, card.wellnessLeave, card.wellnessYear, card.vl, card.sl, card.spl, card.lastAccrualDate, card.createdAt, card.updatedAt]
                );
                migratedCount++;
            } catch (e) {
                console.error(`  [ERROR] Failed to migrate leave card ${card.email}: ${e.message}`);
                errorCount++;
            }
        }
        console.log(`  ✓ Migrated ${migratedCount} leave cards\n`);

        // 9. Migrate Applications
        console.log('[MIGRATE] Migrating leave applications...');
        migratedCount = 0;
        const applications = readJSON(path.join(dataDir, 'applications.json'));
        for (const app of applications) {
            try {
                await client.query(
                    `INSERT INTO applications (id, employee_email, employee_name, office, position, salary, date_of_filing, leave_type, date_from, date_to, num_days, vl_earned, sl_earned, commutation, location_ph, sick_hospital, study_masters, women_illness, other_leave_specify, so_file_data, employee_signature, current_approver, status, hr_approved_at, ao_approved_at, asds_approved_at, sds_approved_at, created_at, updated_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29)
                     ON CONFLICT (id) DO NOTHING`,
                    [app.id, app.employeeEmail, app.employeeName, app.office, app.position, app.salary, app.dateOfFiling, app.leaveType, app.dateFrom, app.dateTo, app.numDays, app.vlEarned, app.slEarned, app.commutation, app.locationPH, app.sickHospital, app.studyMasters, app.womenIllness, app.otherLeaveSpecify, app.soFileData, app.employeeSignature, app.currentApprover, app.status, app.hrApprovedAt, app.aoApprovedAt, app.asdsApprovedAt, app.sdsApprovedAt, app.createdAt, app.updatedAt]
                );
                migratedCount++;
            } catch (e) {
                console.error(`  [ERROR] Failed to migrate application ${app.id}: ${e.message}`);
                errorCount++;
            }
        }
        console.log(`  ✓ Migrated ${migratedCount} applications\n`);

        // 10. Migrate CTO Records
        console.log('[MIGRATE] Migrating CTO records...');
        migratedCount = 0;
        const ctoRecords = readJSON(path.join(dataDir, 'cto-records.json'));
        for (const cto of ctoRecords) {
            try {
                await client.query(
                    `INSERT INTO cto_records (id, employee_email, employee_name, office, position, salary, earned_date, hours_earned, hours_used, hours_balance, remarks, created_at, updated_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                     ON CONFLICT (id) DO NOTHING`,
                    [cto.id, cto.employeeEmail, cto.employeeName, cto.office, cto.position, cto.salary, cto.earnedDate, cto.hoursEarned, cto.hoursUsed, cto.hoursBalance, cto.remarks, cto.createdAt, cto.updatedAt]
                );
                migratedCount++;
            } catch (e) {
                console.error(`  [ERROR] Failed to migrate CTO record ${cto.id}: ${e.message}`);
                errorCount++;
            }
        }
        console.log(`  ✓ Migrated ${migratedCount} CTO records\n`);

        // 11. Migrate Pending Registrations
        console.log('[MIGRATE] Migrating pending registrations...');
        migratedCount = 0;
        const pendingRegs = readJSON(path.join(dataDir, 'pending-registrations.json'));
        for (const reg of pendingRegs) {
            try {
                await client.query(
                    `INSERT INTO pending_registrations (id, portal, email, password, full_name, first_name, last_name, middle_name, suffix, office, position, salary_grade, step, salary, employee_no, district, role, status, created_at, processed_at, processed_by)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
                     ON CONFLICT (id) DO NOTHING`,
                    [reg.id, reg.portal, reg.email, reg.password, reg.fullName, reg.firstName, reg.lastName, reg.middleName, reg.suffix, reg.office, reg.position, reg.salaryGrade, reg.step, reg.salary, reg.employeeNo, reg.district, reg.role, reg.status, reg.createdAt, reg.processedAt, reg.processedBy]
                );
                migratedCount++;
            } catch (e) {
                console.error(`  [ERROR] Failed to migrate pending registration ${reg.id}: ${e.message}`);
                errorCount++;
            }
        }
        console.log(`  ✓ Migrated ${migratedCount} pending registrations\n`);

        // 12. Migrate Activity Logs
        console.log('[MIGRATE] Migrating activity logs...');
        migratedCount = 0;
        const activityLogs = readJSON(path.join(dataDir, 'activity-logs.json'));
        for (const log of activityLogs) {
            try {
                await client.query(
                    `INSERT INTO activity_logs (id, timestamp, action, portal_type, user_email, user_id, ip, user_agent, details)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                     ON CONFLICT (id) DO NOTHING`,
                    [log.id || require('crypto').randomUUID(), log.timestamp, log.action, log.portalType, log.userEmail, log.userId, log.ip, log.userAgent, JSON.stringify(log.details || {})]
                );
                migratedCount++;
            } catch (e) {
                console.error(`  [ERROR] Failed to migrate activity log ${log.id}: ${e.message}`);
                errorCount++;
            }
        }
        console.log(`  ✓ Migrated ${migratedCount} activity logs\n`);

        console.log('\n✅ MIGRATION COMPLETE!');
        console.log(`Total errors: ${errorCount}`);
        if (errorCount === 0) {
            console.log('\n🎉 All data successfully migrated to PostgreSQL!');
        } else {
            console.log(`\n⚠️  ${errorCount} records failed to migrate. Check logs above.`);
        }

    } catch (err) {
        console.error('\n❌ MIGRATION FAILED:', err.message);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

migrate();
