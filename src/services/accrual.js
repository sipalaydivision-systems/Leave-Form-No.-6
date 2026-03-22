/**
 * Monthly leave-credit accrual service.
 *
 * Each non-teaching employee earns 1.25 days of Vacation Leave and
 * 1.25 days of Sick Leave at the end of every calendar month (per CSC
 * rules).  Teaching personnel receive proportional vacation service
 * credits (VSC) at the end of the school year instead and are
 * therefore excluded from monthly accrual.
 *
 * Extracted from server.js (lines 1262-1633) so the accrual logic can
 * be tested, maintained, and scheduled independently of the HTTP layer.
 */

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { ensureFile, readJSON, writeJSON } = require('../data/json-store');
const { createAccrualTransaction } = require('../data/models');
const { hasMonthlyAccrualTransaction } = require('./leave-balance');
const { dataDir } = require('../config');

// ---------------------------------------------------------------------------
// Data-file paths (mirrors the canonical paths in server.js)
// ---------------------------------------------------------------------------

const leavecardsFile   = path.join(dataDir, 'leavecards.json');
const usersFile        = path.join(dataDir, 'users.json');
const systemStateFile  = path.join(dataDir, 'system-state.json');
const activityLogsFile = path.join(dataDir, 'activity-logs.json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if an employee's position is a teaching role.
 * Teachers do NOT receive monthly 1.25-day VL/SL accrual -- they get
 * proportional vacation service credits (VSC) at the end of the school
 * year instead.  Only non-teaching personnel accrue 1.25 VL + 1.25 SL
 * per month.
 *
 * @param {string} position - The employee's position title.
 * @returns {boolean} true if position is teaching (should SKIP monthly accrual).
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
 * Build email -> position lookup map from users.json for accrual filtering.
 *
 * @returns {Map<string, string>} email -> position
 */
function buildPositionMap() {
    const users = readJSON(usersFile);
    const map = new Map();
    users.forEach(u => {
        if (u.email && u.position) map.set(u.email, u.position);
    });
    return map;
}

// ---------------------------------------------------------------------------
// Catch-up accrual for newly created cards
// ---------------------------------------------------------------------------

/**
 * Catch-up accrual for cards created AFTER the global monthly accrual
 * already ran.  Compares each card's lastAccrualDate (or absence
 * thereof) against the global lastAccruedMonth and adds any missing
 * months of credits.
 *
 * @param {string} globalLastAccruedMonth - "YYYY-MM" key of the last globally accrued month.
 * @param {Date}   now                    - Current timestamp.
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
            // Skip teaching personnel -- teachers do NOT get monthly accrual
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
                // Card has never been accrued -- accrue from January of the accrual year
                // (DepEd employees earn credits from start of calendar year regardless
                //  of when their card was created in the system)
                const globalParts = globalLastAccruedMonth.split('-').map(Number);
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

// ---------------------------------------------------------------------------
// Main monthly accrual
// ---------------------------------------------------------------------------

/**
 * At the end of every month, each employee earns 1.25 days of Vacation
 * Leave and 1.25 days of Sick Leave (per CSC rules).  This function
 * checks on server startup and every 24 hours whether any months have
 * elapsed since the last accrual, then adds the appropriate credits to
 * every employee's leave card.
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
            // Skip teaching personnel -- teachers do NOT get monthly 1.25 VL/SL accrual
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

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

/** Timer references so callers can cancel the scheduled jobs if needed. */
let _startupTimer = null;
let _dailyInterval = null;

/**
 * Start the accrual scheduler.
 *
 * Runs `runMonthlyAccrual` once after a 5-second startup delay (to let
 * data files initialise) and then every 24 hours.
 */
function startAccrualScheduler() {
    // Run accrual on startup (after a short delay to let files initialise)
    _startupTimer = setTimeout(() => {
        runMonthlyAccrual();
    }, 5000);

    // Run accrual check every 24 hours
    _dailyInterval = setInterval(() => {
        console.log('[ACCRUAL] Running daily accrual check...');
        runMonthlyAccrual();
    }, 24 * 60 * 60 * 1000);
}

/**
 * Stop the accrual scheduler (useful for graceful shutdown / testing).
 */
function stopAccrualScheduler() {
    if (_startupTimer) { clearTimeout(_startupTimer); _startupTimer = null; }
    if (_dailyInterval) { clearInterval(_dailyInterval); _dailyInterval = null; }
}

// ---------------------------------------------------------------------------

module.exports = {
    isTeachingPosition,
    buildPositionMap,
    catchUpNewCards,
    runMonthlyAccrual,
    startAccrualScheduler,
    stopAccrualScheduler,
};
