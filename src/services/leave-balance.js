/**
 * Leave-balance calculation service.
 *
 * All functions that determine how many VL / SL / CTO / FL / SPL days
 * an employee has available live here.  Extracted from server.js so the
 * logic can be unit-tested and reused from multiple route handlers
 * without duplication.
 */

const crypto = require('crypto');
const path = require('path');
const { ensureFile, readJSON, readJSONArray, writeJSON } = require('../data/json-store');
const { MONTH_NAMES } = require('../data/models');

// ---------------------------------------------------------------------------
// Data-file paths — mirrors the canonical paths defined in server.js.
// Consumers that need a different dataDir can call `configure()`.
// ---------------------------------------------------------------------------

const dataDir = process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'data')
    : path.join(__dirname, '..', '..', 'data');

const applicationsFile = path.join(dataDir, 'applications.json');
const leavecardsFile   = path.join(dataDir, 'leavecards.json');
const ctoRecordsFile   = path.join(dataDir, 'cto-records.json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the set of application IDs already reflected in a leave card's
 * history (both `leaveUsageHistory` and `transactions`).
 *
 * @param {object} leaveCard - The employee's leave card object.
 * @returns {Set<string>} Set of reflected application IDs.
 */
function getReflectedAppIds(leaveCard) {
    const ids = new Set();
    if (leaveCard && leaveCard.leaveUsageHistory && Array.isArray(leaveCard.leaveUsageHistory)) {
        leaveCard.leaveUsageHistory.forEach(h => { if (h.applicationId) ids.add(h.applicationId); });
    }
    if (leaveCard && leaveCard.transactions && Array.isArray(leaveCard.transactions)) {
        leaveCard.transactions.forEach(t => { if (t.applicationId) ids.add(t.applicationId); });
    }
    return ids;
}

// ---------------------------------------------------------------------------
// Core balance calculations
// ---------------------------------------------------------------------------

/**
 * Calculate effective VL/SL balance after deducting pending/approved
 * applications that haven't been recorded on the leave card yet.
 *
 * @param {string}      employeeEmail - Employee email.
 * @param {object|null} leaveCard     - The employee's leave card (or null).
 * @param {string|null} excludeAppId  - Application ID to exclude (for resubmissions).
 * @returns {{ vlBalance: number, slBalance: number, forceSpent: number, splSpent: number, ctoBalance: number, hasCard: boolean }}
 */
function calculateEffectiveBalance(employeeEmail, leaveCard, excludeAppId) {
    const result = { vlBalance: 0, slBalance: 0, forceSpent: 0, splSpent: 0, wellnessSpent: 0, ctoBalance: 0, hasCard: false };

    if (!leaveCard) return result;
    result.hasCard = true;

    // VL/SL from summary fields (single source of truth)
    let vl = (leaveCard.vl !== undefined) ? leaveCard.vl : null;
    let sl = (leaveCard.sl !== undefined) ? leaveCard.sl : null;
    // Fallback for legacy cards
    if (vl === null) vl = Math.max(0, (leaveCard.vacationLeaveEarned || 0) - (leaveCard.vacationLeaveSpent || 0));
    if (sl === null) sl = Math.max(0, (leaveCard.sickLeaveEarned || 0) - (leaveCard.sickLeaveSpent || 0));

    result.forceSpent = leaveCard.forceLeaveSpent || 0;
    result.splSpent = leaveCard.splSpent || 0;
    result.wellnessSpent = leaveCard.wellnessSpent || 0;

    // Deduct pending/approved applications not yet reflected in leave card
    const allApps = readJSONArray(applicationsFile);
    const reflected = getReflectedAppIds(leaveCard);
    let pendingForceSpent = 0, pendingSplSpent = 0, pendingWellnessSpent = 0;

    allApps.forEach(app => {
        if (excludeAppId && app.id === excludeAppId) return;
        if (reflected.has(app.id)) return;
        if (app.employeeEmail !== employeeEmail && app.email !== employeeEmail) return;
        if (app.status !== 'pending' && app.status !== 'approved') return;
        const days = parseFloat(app.numDays) || 0;
        if (days <= 0) return;
        const type = (app.leaveType || '').toLowerCase();
        if (type.includes('vl') || type.includes('vacation')) vl = Math.max(0, vl - days);
        else if (type.includes('sl') || type.includes('sick')) sl = Math.max(0, sl - days);
        else if (type.includes('mfl') || type.includes('mandatory') || type.includes('forced')) { pendingForceSpent += days; vl = Math.max(0, vl - days); }
        else if (type.includes('spl') || type.includes('special')) pendingSplSpent += days;
        else if (type.includes('wellness') || type === 'leave_wl') pendingWellnessSpent += days;
    });

    result.vlBalance = vl;
    result.slBalance = sl;
    result.forceSpent += pendingForceSpent;
    result.splSpent += pendingSplSpent;
    result.wellnessSpent += pendingWellnessSpent;

    return result;
}

/**
 * Calculate CTO balance after deducting pending/approved CTO applications.
 *
 * @param {string}      employeeEmail - Employee email.
 * @param {object|null} leaveCard     - Optional; used for reflected IDs.
 * @param {string|null} excludeAppId  - Application ID to exclude.
 * @returns {number} Effective CTO balance.
 */
function calculateCtoBalance(employeeEmail, leaveCard, excludeAppId) {
    ensureFile(ctoRecordsFile);
    const ctoRecords = readJSON(ctoRecordsFile);
    const empRecords = ctoRecords.filter(r => r.employeeId === employeeEmail);
    let balance = 0;
    empRecords.forEach(rec => { balance += (parseFloat(rec.daysGranted) || 0) - (parseFloat(rec.daysUsed) || 0); });
    balance = Math.max(0, balance);

    // Build reflected IDs from both CTO records and leave card
    const reflectedIds = new Set();
    empRecords.forEach(rec => {
        if (rec.applicationIds && Array.isArray(rec.applicationIds)) {
            rec.applicationIds.forEach(id => reflectedIds.add(id));
        }
    });
    if (leaveCard) {
        const lcIds = getReflectedAppIds(leaveCard);
        lcIds.forEach(id => reflectedIds.add(id));
    }

    const allApps = readJSONArray(applicationsFile);
    allApps.forEach(app => {
        if (excludeAppId && app.id === excludeAppId) return;
        if (reflectedIds.has(app.id)) return;
        if (app.employeeEmail !== employeeEmail && app.email !== employeeEmail) return;
        if (app.status !== 'pending' && app.status !== 'approved') return;
        const type = (app.leaveType || '').toLowerCase();
        if (type.includes('others') || type.includes('cto')) {
            balance = Math.max(0, balance - (parseFloat(app.numDays) || 0));
        }
    });

    return balance;
}

/**
 * Get the latest leave card record for an employee (by updatedAt / createdAt).
 *
 * @param {Array} records - Array of leave card records.
 * @returns {object|null} The most recently updated record, or null.
 */
function getLatestLeaveCard(records) {
    if (!records || records.length === 0) return null;
    let latest = records[0];
    records.forEach(record => {
        const latestTime = new Date(latest.updatedAt || latest.createdAt || 0).getTime();
        const currentTime = new Date(record.updatedAt || record.createdAt || 0).getTime();
        if (currentTime > latestTime) latest = record;
    });
    return latest;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate that an employee has sufficient leave balance for the
 * requested leave type and number of days.
 *
 * @param {string}      leaveType     - Leave type code (e.g. `'leave_vl'`).
 * @param {number}      numDays       - Requested number of days.
 * @param {string}      employeeEmail - Employee email.
 * @param {string|null} excludeAppId  - App ID to skip (for resubmissions).
 * @returns {{ valid: boolean, error?: string, message?: string }}
 */
function validateLeaveBalance(leaveType, numDays, employeeEmail, excludeAppId) {
    const leavecards = readJSON(leavecardsFile);
    const leaveCard = leavecards.find(lc => lc.email === employeeEmail || lc.employeeId === employeeEmail);

    if (leaveType === 'leave_vl' || leaveType === 'leave_sl') {
        if (!leaveCard) {
            return { valid: false, error: 'No leave card found', message: 'You do not have a leave card on file. Please contact the Administrative Officer to create your leave card before applying for leave.' };
        }
        const bal = calculateEffectiveBalance(employeeEmail, leaveCard, excludeAppId);
        if (leaveType === 'leave_vl' && numDays > bal.vlBalance) {
            console.log(`[VALIDATION] VL rejected for ${employeeEmail}: Requested ${numDays} but only ${bal.vlBalance.toFixed(3)} available`);
            return { valid: false, error: 'Insufficient Vacation Leave balance', message: `You cannot apply for ${numDays} day(s) of Vacation Leave. Your current balance is ${bal.vlBalance.toFixed(3)} day(s). The leave card balance cannot go negative.` };
        }
        if (leaveType === 'leave_sl' && numDays > bal.slBalance) {
            console.log(`[VALIDATION] SL rejected for ${employeeEmail}: Requested ${numDays} but only ${bal.slBalance.toFixed(3)} available`);
            return { valid: false, error: 'Insufficient Sick Leave balance', message: `You cannot apply for ${numDays} day(s) of Sick Leave. Your SL balance is ${bal.slBalance.toFixed(3)} day(s). The balance cannot go negative.` };
        }
        return { valid: true };
    }

    if (leaveType === 'leave_mfl' || leaveType === 'leave_spl' || leaveType === 'leave_wl' || leaveType === 'leave_wellness' || leaveType === 'wellness') {
        const bal = calculateEffectiveBalance(employeeEmail, leaveCard, excludeAppId);
        if (leaveType === 'leave_mfl') {
            if ((bal.forceSpent + numDays) > 5) {
                const remaining = Math.max(0, 5 - bal.forceSpent);
                console.log(`[VALIDATION] FL rejected for ${employeeEmail}: Already used ${bal.forceSpent}/5, requested ${numDays}`);
                return { valid: false, error: 'Insufficient Force Leave balance', message: `You cannot apply for ${numDays} day(s) of Force Leave. You have ${remaining.toFixed(0)} day(s) remaining out of your 5-day yearly allocation.` };
            }
            if (numDays >= 5) {
                return { valid: false, error: 'Force Leave filing restriction', message: 'Force Leave should not be filed as 5 consecutive days. Please file fewer days per application.' };
            }
            // FL draws from VL balance — check VL sufficiency
            if (numDays > bal.vlBalance) {
                console.log(`[VALIDATION] FL rejected for ${employeeEmail}: VL balance insufficient (${bal.vlBalance.toFixed(3)}) for ${numDays} FL days`);
                return { valid: false, error: 'Insufficient Vacation Leave balance for Force Leave', message: `Force Leave is deducted from your Vacation Leave balance. You need ${numDays} day(s) but only have ${bal.vlBalance.toFixed(3)} VL day(s) available.` };
            }
        }
        if (leaveType === 'leave_spl') {
            if ((bal.splSpent + numDays) > 3) {
                const remaining = Math.max(0, 3 - bal.splSpent);
                console.log(`[VALIDATION] SPL rejected for ${employeeEmail}: Already used ${bal.splSpent}/3, requested ${numDays}`);
                return { valid: false, error: 'Insufficient Special Privilege Leave balance', message: `You cannot apply for ${numDays} day(s) of Special Privilege Leave. You have ${remaining.toFixed(0)} day(s) remaining out of your 3-day yearly allocation.` };
            }
        }
        if (leaveType === 'leave_wl' || leaveType === 'leave_wellness' || leaveType === 'wellness') {
            if ((bal.wellnessSpent + numDays) > 5) {
                const remaining = Math.max(0, 5 - bal.wellnessSpent);
                console.log(`[VALIDATION] WL rejected for ${employeeEmail}: Already used ${bal.wellnessSpent}/5, requested ${numDays}`);
                return { valid: false, error: 'Insufficient Wellness Leave balance', message: `You cannot apply for ${numDays} day(s) of Wellness Leave. You have ${remaining.toFixed(0)} day(s) remaining out of your 5-day yearly allocation.` };
            }
        }
        return { valid: true };
    }

    if (leaveType === 'leave_others') {
        try {
            const ctoBalance = calculateCtoBalance(employeeEmail, leaveCard, excludeAppId);
            if (ctoBalance <= 0) {
                console.log(`[VALIDATION] CTO rejected for ${employeeEmail}: No CTO records (balance is 0)`);
                return { valid: false, error: 'No CTO balance available', message: 'You do not have any CTO (Compensatory Time-Off) balance. Please ensure a Special Order has been filed and CTO days have been granted before applying.' };
            }
            if (numDays > ctoBalance) {
                console.log(`[VALIDATION] CTO rejected for ${employeeEmail}: Requested ${numDays} but only ${ctoBalance.toFixed(3)} available`);
                return { valid: false, error: 'Insufficient CTO balance', message: `You cannot apply for ${numDays} day(s) of CTO leave. Your current CTO balance is ${ctoBalance.toFixed(3)} day(s). The balance cannot go negative.` };
            }
            return { valid: true };
        } catch (err) {
            console.error('[VALIDATION] Error checking CTO balance:', err);
            return { valid: false, error: 'Unable to verify CTO balance', message: 'Could not verify your CTO balance. Please try again or contact the Administrative Officer.' };
        }
    }

    // Other leave types — no balance check needed
    return { valid: true };
}

// ---------------------------------------------------------------------------
// Transaction normalisation & deduplication
// ---------------------------------------------------------------------------

/**
 * Re-derive running balances and summary totals from a raw list of
 * transactions.  Ensures every transaction has consistent vlBalance /
 * slBalance / total fields and handles over-deduction via PVP tracking.
 *
 * @param {Array} transactions - Raw transaction array.
 * @returns {{ transactions: Array, summary: object }}
 */
function normalizeLeaveCardTransactions(transactions) {
    const normalized = [];
    let runningVL = 0;
    let runningSL = 0;
    let vlEarnedTotal = 0;
    let slEarnedTotal = 0;
    let vlSpentTotal = 0;
    let slSpentTotal = 0;
    let forceSpentTotal = 0;
    let splSpentTotal = 0;
    let wellnessSpentTotal = 0;
    let pvpDeductionTotal = 0;

    for (const rawTx of (transactions || [])) {
        const rawTypeUpper = String(rawTx.type || '').toUpperCase();
        const txTypeResolved = rawTypeUpper === 'LAWOP' ? 'LAWOP' : (rawTypeUpper === 'LESS' ? 'LESS' : 'ADD');
        const tx = {
            id: rawTx.id || crypto.randomUUID(),
            type: txTypeResolved,
            periodCovered: rawTx.periodCovered || '-',
            vlEarned: Math.max(0, parseFloat(rawTx.vlEarned) || 0),
            slEarned: Math.max(0, parseFloat(rawTx.slEarned) || 0),
            vlSpent: Math.max(0, parseFloat(rawTx.vlSpent) || 0),
            slSpent: Math.max(0, parseFloat(rawTx.slSpent) || 0),
            forcedLeave: Math.max(0, parseFloat(rawTx.forcedLeave) || 0),
            splUsed: Math.max(0, parseFloat(rawTx.splUsed) || 0),
            wellnessUsed: Math.max(0, parseFloat(rawTx.wellnessUsed) || 0),
            source: rawTx.source || '',
            dateRecorded: rawTx.dateRecorded || rawTx.date || new Date().toISOString(),
        };

        let pvpDeductionDays = 0;

        if (tx.type === 'LAWOP') {
            // LAWOP is record-keeping only — no balance impact
        } else if (tx.type === 'ADD') {
            runningVL += tx.vlEarned;
            runningSL += tx.slEarned;
            vlEarnedTotal += tx.vlEarned;
            slEarnedTotal += tx.slEarned;
        } else {
            const requestedVlLess = tx.vlSpent;
            const requestedSlLess = tx.slSpent;

            const actualVlLess = Math.min(requestedVlLess, runningVL);
            const actualSlLess = Math.min(requestedSlLess, runningSL);

            const vlOverflow = Math.max(0, requestedVlLess - actualVlLess);
            const slOverflow = Math.max(0, requestedSlLess - actualSlLess);
            pvpDeductionDays = +(vlOverflow + slOverflow).toFixed(3);

            runningVL = +(runningVL - actualVlLess).toFixed(3);
            runningSL = +(runningSL - actualSlLess).toFixed(3);
            tx.vlSpent = actualVlLess;
            tx.slSpent = actualSlLess;

            vlSpentTotal += actualVlLess;
            slSpentTotal += actualSlLess;
            pvpDeductionTotal += pvpDeductionDays;
        }

        if (tx.type !== 'LAWOP') {
            forceSpentTotal += tx.forcedLeave;
            splSpentTotal += tx.splUsed;
            wellnessSpentTotal += tx.wellnessUsed;
        }

        tx.pvpDeductionDays = pvpDeductionDays;
        tx.vlBalance = +runningVL.toFixed(3);
        tx.slBalance = +runningSL.toFixed(3);
        tx.total = +(runningVL + runningSL).toFixed(3);
        normalized.push(tx);
    }

    return {
        transactions: normalized,
        summary: {
            vl: +runningVL.toFixed(3),
            sl: +runningSL.toFixed(3),
            vacationLeaveEarned: +vlEarnedTotal.toFixed(3),
            sickLeaveEarned: +slEarnedTotal.toFixed(3),
            vacationLeaveSpent: +vlSpentTotal.toFixed(3),
            sickLeaveSpent: +slSpentTotal.toFixed(3),
            forceLeaveSpent: +forceSpentTotal.toFixed(3),
            splSpent: +splSpentTotal.toFixed(3),
            wellnessSpent: +wellnessSpentTotal.toFixed(3),
            pvpDeductionTotal: +pvpDeductionTotal.toFixed(3),
        },
    };
}

/**
 * Remove duplicate monthly-accrual transactions from all leave cards.
 *
 * After deduplication the affected cards are re-normalised so running
 * balances stay correct.
 *
 * @param {boolean} [dryRun=true] - When `true`, reports what *would*
 *   change without writing to disk.
 * @returns {{ dryRun: boolean, cardsScanned: number, cardsChanged: number, duplicatesRemoved: number, changedCards: Array }}
 */
function dedupeMonthlyAccrualEntries(dryRun = true) {
    ensureFile(leavecardsFile);
    const leavecards = readJSON(leavecardsFile);
    const nowIso = new Date().toISOString();

    let cardsScanned = 0;
    let cardsChanged = 0;
    let duplicatesRemoved = 0;
    const changedCards = [];

    for (const card of leavecards) {
        cardsScanned++;
        const txns = Array.isArray(card.transactions) ? card.transactions : [];
        if (txns.length === 0) continue;

        const seenAccrualPeriods = new Set();
        const filtered = [];
        let removedForCard = 0;

        for (const tx of txns) {
            const periodCovered = String(tx?.periodCovered || '').trim();
            const source = String(tx?.source || '').toLowerCase();
            const isMonthlyAccrual = /\(monthly accrual\)$/i.test(periodCovered) && source.startsWith('system-accrual');

            if (!isMonthlyAccrual) {
                filtered.push(tx);
                continue;
            }

            const key = periodCovered.toUpperCase();
            if (seenAccrualPeriods.has(key)) {
                removedForCard++;
                continue;
            }

            seenAccrualPeriods.add(key);
            filtered.push(tx);
        }

        if (removedForCard <= 0) continue;

        const normalized = normalizeLeaveCardTransactions(filtered);
        duplicatesRemoved += removedForCard;
        cardsChanged++;
        changedCards.push({
            employee: card.email || card.employeeId || card.name || 'unknown',
            duplicatesRemoved: removedForCard,
        });

        if (!dryRun) {
            card.transactions = normalized.transactions;
            card.vl = normalized.summary.vl;
            card.sl = normalized.summary.sl;
            card.vacationLeaveEarned = normalized.summary.vacationLeaveEarned;
            card.sickLeaveEarned = normalized.summary.sickLeaveEarned;
            card.vacationLeaveSpent = normalized.summary.vacationLeaveSpent;
            card.sickLeaveSpent = normalized.summary.sickLeaveSpent;
            card.forceLeaveSpent = normalized.summary.forceLeaveSpent;
            card.splSpent = normalized.summary.splSpent;
            card.wellnessSpent = normalized.summary.wellnessSpent;
            card.pvpDeductionTotal = normalized.summary.pvpDeductionTotal;
            card.updatedAt = nowIso;
        }
    }

    if (!dryRun && cardsChanged > 0) {
        writeJSON(leavecardsFile, leavecards);
    }

    return {
        dryRun,
        cardsScanned,
        cardsChanged,
        duplicatesRemoved,
        changedCards,
    };
}

/**
 * Check whether a leave card already has a monthly-accrual transaction
 * for the given month and year.
 *
 * @param {object} card  - Leave card object.
 * @param {number} month - Month (1-12).
 * @param {number} year  - Calendar year.
 * @returns {boolean}
 */
function hasMonthlyAccrualTransaction(card, month, year) {
    const expectedPeriod = `${MONTH_NAMES[month]} ${year} (Monthly Accrual)`;
    const transactions = Array.isArray(card?.transactions) ? card.transactions : [];
    return transactions.some(tx => {
        const period = String(tx?.periodCovered || '').trim();
        const source = String(tx?.source || '').toLowerCase();
        return period === expectedPeriod && source.startsWith('system-accrual');
    });
}

// ---------------------------------------------------------------------------

module.exports = {
    getReflectedAppIds,
    calculateEffectiveBalance,
    calculateCtoBalance,
    getLatestLeaveCard,
    validateLeaveBalance,
    normalizeLeaveCardTransactions,
    dedupeMonthlyAccrualEntries,
    hasMonthlyAccrualTransaction,
};
