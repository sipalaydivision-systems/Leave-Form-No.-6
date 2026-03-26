/**
 * Leave credits routes — leave balance queries and updates.
 *
 * Extracted from server.js:
 *   - GET  /api/leave-credits        (line 4698)
 *   - GET  /api/leave-card           (line 4859)
 *   - GET  /api/employee-leavecard   (line 4914)
 *   - POST /api/update-leave-credits (line 5078)
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { requireAuth } = require('../middleware/auth');
const { readJSON, readJSONArray, writeJSON } = require('../data/json-store');
const { dataDir } = require('../config');
const { getLatestLeaveCard, normalizeLeaveCardTransactions } = require('../services/leave-balance');
const {
    usersFile, employeesFile, leavecardsFile,
    isSelfOrAdmin, isAoAccessAllowed,
    logActivity, getClientIp,
} = require('../utils/helpers');

// ---------------------------------------------------------------------------
// GET /api/leave-credits — Get leave balance for an employee
// ---------------------------------------------------------------------------
router.get('/api/leave-credits', requireAuth(), (req, res) => {
    try {
        const employeeId = req.query.employeeId;
        if (!employeeId) {
            return res.status(400).json({ success: false, error: 'Employee ID is required' });
        }

        // SECURITY: Only allow access to own leave credits unless admin role
        if (!isSelfOrAdmin(req, employeeId)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        // AO school-based filtering
        if (!isAoAccessAllowed(req, employeeId)) {
            return res.status(403).json({ success: false, error: 'Access denied. This employee is not from your school.' });
        }

        const leavecards = readJSON(leavecardsFile);
        // Normalize name for comparison: NFC first so Ñ/ñ (NFD) matches precomposed form
        const normName = (s) => (s || '').normalize('NFC').toUpperCase().replace(/\s+/g, ' ').trim();
        const emailLower = (employeeId || '').toLowerCase();

        // Find all records for this employee — by email (case-insensitive), employeeId, name, or employee number
        let employeeRecords = leavecards.filter(lc =>
            (lc.employeeId || '').toLowerCase() === emailLower ||
            (lc.email || '').toLowerCase() === emailLower
        );

        // Fallback: if not found by email, try matching by name (for unlinked Excel-migrated cards)
        if (employeeRecords.length === 0) {
            const normalizedId = normName(employeeId);
            employeeRecords = leavecards.filter(lc => normName(lc.name) === normalizedId);
        }

        // Fallback: try matching by employee number
        if (employeeRecords.length === 0) {
            employeeRecords = leavecards.filter(lc => lc.employeeNo && lc.employeeNo === employeeId);
        }

        if (employeeRecords.length === 0) {
            // Return default leave credits (0 until monthly accrual adds credits)
            return res.json({
                success: true,
                credits: {
                    employeeId: employeeId,
                    email: employeeId,
                    vl: 0,
                    sl: 0,
                    spl: 3,
                    forceLeaveSpent: 0,
                    splSpent: 0,
                    wellnessEarned: 3,
                    wellnessSpent: 0,
                    others: 0,
                    vacationLeaveEarned: 0,
                    sickLeaveEarned: 0,
                    vacationLeaveSpent: 0,
                    sickLeaveSpent: 0,
                    leaveUsageHistory: []
                }
            });
        }

        // Get the latest record (most recent based on updatedAt or createdAt)
        const latestRecord = getLatestLeaveCard(employeeRecords);

        const currentYear = new Date().getFullYear();

        // Check if Force Leave, SPL, or Wellness year needs reset
        let forceLeaveSpent = latestRecord.forceLeaveSpent || 0;
        let splSpent = latestRecord.splSpent || 0;
        let wellnessSpent = latestRecord.wellnessSpent || 0;
        let needsPersist = false;

        // Reset Force Leave if year changed — persist to disk so validateLeaveBalance uses correct value
        if (latestRecord.forceLeaveYear && latestRecord.forceLeaveYear !== currentYear) {
            forceLeaveSpent = 0;
            latestRecord.forceLeaveSpent = 0;
            latestRecord.forceLeaveYear = currentYear;
            needsPersist = true;
        }

        // Reset Special Privilege Leave if year changed
        if (latestRecord.splYear && latestRecord.splYear !== currentYear) {
            splSpent = 0;
            latestRecord.splSpent = 0;
            latestRecord.splYear = currentYear;
            needsPersist = true;
        }

        // Reset Wellness Leave if year changed
        if (latestRecord.wellnessYear && latestRecord.wellnessYear !== currentYear) {
            wellnessSpent = 0;
            latestRecord.wellnessSpent = 0;
            latestRecord.wellnessYear = currentYear;
            needsPersist = true;
        }

        // Persist year reset to disk so submit-leave validation reads correct values
        if (needsPersist) {
            const allCards = readJSON(leavecardsFile);
            const cardIdx = allCards.findIndex(lc => lc.email === latestRecord.email || lc.employeeId === latestRecord.employeeId);
            if (cardIdx !== -1) {
                allCards[cardIdx].forceLeaveSpent = 0;
                allCards[cardIdx].forceLeaveYear = currentYear;
                allCards[cardIdx].splSpent = 0;
                allCards[cardIdx].splYear = currentYear;
                allCards[cardIdx].wellnessSpent = 0;
                allCards[cardIdx].wellnessYear = currentYear;
                writeJSON(leavecardsFile, allCards);
                console.log(`[LEAVE-CREDITS] Year reset persisted for ${latestRecord.email}: FL/SPL/WL spent reset to 0 for ${currentYear}`);
            }
        }

        // Single source of truth: vl/sl summary fields
        // These are updated by accrual, SDS approval, and AO edits — always current
        // transactions[] and leaveUsageHistory[] are audit logs only, not used for balance
        let vlBalance = (latestRecord.vl !== undefined) ? latestRecord.vl : null;
        let slBalance = (latestRecord.sl !== undefined) ? latestRecord.sl : null;
        let totalForceSpent = forceLeaveSpent;
        let totalSplSpent = splSpent;

        // Sum up force, special, and wellness leave usage from transactions
        let totalWellnessSpent = wellnessSpent;
        if (latestRecord.transactions && Array.isArray(latestRecord.transactions) && latestRecord.transactions.length > 0) {
            totalForceSpent = 0;
            totalSplSpent = 0;
            totalWellnessSpent = 0;
            latestRecord.transactions.forEach(tx => {
                totalForceSpent += parseFloat(tx.forcedLeave) || 0;
                totalSplSpent += parseFloat(tx.splUsed) || 0;
                totalWellnessSpent += parseFloat(tx.wellnessUsed) || 0;
            });
        }

        // Fallback for legacy cards without vl/sl fields
        const vacationLeaveEarned = latestRecord.vacationLeaveEarned || 0;
        const sickLeaveEarned = latestRecord.sickLeaveEarned || 0;

        if (vlBalance === null) {
            vlBalance = Math.max(0, vacationLeaveEarned - (latestRecord.vacationLeaveSpent || 0));
        }
        if (slBalance === null) {
            slBalance = Math.max(0, sickLeaveEarned - (latestRecord.sickLeaveSpent || 0));
        }

        // Compute "spent" values from the balance for backward compat
        let vacationLeaveSpent = Math.max(0, vacationLeaveEarned - vlBalance);
        let sickLeaveSpent = Math.max(0, sickLeaveEarned - slBalance);

        // Leave card balances are now strictly based on leave card entries.
        // Leave applications no longer auto-adjust balances.

        // Ensure the credits object has all required fields with defaults
        const enrichedCredits = {
            ...latestRecord,
            vacationLeaveEarned: vacationLeaveEarned,
            sickLeaveEarned: sickLeaveEarned,
            forceLeaveEarned: latestRecord.forceLeaveEarned || latestRecord.mandatoryForced || latestRecord.others || 5,
            splEarned: latestRecord.splEarned || latestRecord.spl || 3,
            wellnessEarned: latestRecord.wellnessEarned || 3,
            vacationLeaveSpent: vacationLeaveSpent,
            sickLeaveSpent: sickLeaveSpent,
            forceLeaveSpent: totalForceSpent,
            splSpent: totalSplSpent,
            wellnessSpent: totalWellnessSpent,
            forceLeaveYear: currentYear,
            splYear: currentYear,
            wellnessYear: currentYear,
            leaveUsageHistory: latestRecord.leaveUsageHistory || [],
            // Direct balance values for dashboard convenience
            currentVlBalance: vlBalance,
            currentSlBalance: slBalance
        };

        res.json({ success: true, credits: enrichedCredits });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---------------------------------------------------------------------------
// GET /api/leave-card — Get basic leave card allocation (return/compliance preview)
// ---------------------------------------------------------------------------
router.get('/api/leave-card', requireAuth(), (req, res) => {
    try {
        const employeeId = req.query.employeeId;

        if (!employeeId) {
            return res.status(400).json({ success: false, error: 'Employee ID is required' });
        }

        // SECURITY: Only allow access to own leave card unless admin role
        if (!isSelfOrAdmin(req, employeeId)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const leavecards = readJSON(leavecardsFile);

        // Find all records for this employee to get the latest one
        const employeeRecords = leavecards.filter(lc => lc.employeeId === employeeId || lc.email === employeeId);

        if (employeeRecords.length === 0) {
            // Return default leave card allocation (0 until monthly accrual)
            return res.json({
                success: true,
                credits: {
                    employeeId: employeeId,
                    email: employeeId,
                    vl: 0,
                    sl: 0,
                    spl: 3,
                    forceLeave: 5,
                    wellness: 3
                }
            });
        }

        // Get the latest record
        const latestRecord = getLatestLeaveCard(employeeRecords);

        // Return the actual allocation values from the leave card (earned values = the allocation set in edit)
        res.json({
            success: true,
            credits: {
                employeeId: latestRecord.employeeId,
                email: latestRecord.email,
                vl: latestRecord.vacationLeaveEarned || latestRecord.vl || 0,
                sl: latestRecord.sickLeaveEarned || latestRecord.sl || 0,
                spl: latestRecord.splEarned || latestRecord.spl || 3,
                forceLeave: latestRecord.forceLeaveEarned || latestRecord.others || 5,
                wellness: latestRecord.wellnessEarned || 3
            }
        });
    } catch (error) {
        console.error('[LEAVE-CARD API] Error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---------------------------------------------------------------------------
// GET /api/employee-leavecard — Get full leave card details
// ---------------------------------------------------------------------------
router.get('/api/employee-leavecard', requireAuth(), (req, res) => {
    try {
        const employeeId = req.query.employeeId;
        if (!employeeId) {
            return res.status(400).json({ success: false, error: 'Employee ID is required' });
        }

        // SECURITY: Only allow access to own leave card unless admin role
        if (!isSelfOrAdmin(req, employeeId)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const leavecards = readJSON(leavecardsFile);

        // Try to find by employeeId first, then by email (since we use email as ID now)
        let leavecard = leavecards.find(lc => lc.employeeId === employeeId || lc.email === employeeId);

        if (!leavecard) {
            // Return empty leave card if not found
            return res.json({
                success: true,
                leavecard: {
                    employeeId: employeeId,
                    email: employeeId,
                    vacationLeaveEarned: 0,
                    sickLeaveEarned: 0,
                    forceLeaveEarned: 0,
                    splEarned: 0,
                    vacationLeaveSpent: 0,
                    sickLeaveSpent: 0,
                    forceLeaveSpent: 0,
                    splSpent: 0,
                    wellnessEarned: 0,
                    wellnessSpent: 0
                }
            });
        }

        res.json({ success: true, leavecard });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---------------------------------------------------------------------------
// POST /api/update-leave-credits — Update leave credits (AO/IT only)
// ---------------------------------------------------------------------------
router.post('/api/update-leave-credits', requireAuth('ao', 'it'), (req, res) => {
    try {
        const {
            applicationId,
            employeeId,
            employeeEmail,
            transactions,
            replaceTransactions,
            vacationLeaveEarned,
            sickLeaveEarned,
            forceLeaveEarned,
            splEarned,
            wellnessEarned,
            vacationLeaveSpent,
            sickLeaveSpent,
            forceLeaveSpent,
            splSpent,
            wellnessSpent,
            vl, sl, spl, others, mandatoryForced, wellness
        } = req.body;

        // Validate employeeEmail is provided
        if (!employeeEmail) {
            return res.status(400).json({ success: false, error: 'employeeEmail is required' });
        }

        // AO school-based filtering
        if (!isAoAccessAllowed(req, employeeEmail)) {
            return res.status(403).json({ success: false, error: 'Access denied. This employee is not from your school.' });
        }

        // Verify employee exists in users or employees data
        const users = readJSON(usersFile);
        const employees = readJSON(employeesFile);
        const userExists = users.some(u => u.email === employeeEmail);
        const employeeExists = employees.some(e => e.email === employeeEmail || e.employeeId === employeeEmail);
        if (!userExists && !employeeExists) {
            console.log(`[UPDATE LEAVE] Warning: employeeEmail ${employeeEmail} not found in users or employees - proceeding anyway for legacy cards`);
        }

        let leavecards = readJSON(leavecardsFile);

        // Use email as primary lookup key since that's what we have from applications
        const normName2 = (s) => (s || '').normalize('NFC').toUpperCase().replace(/\s+/g, ' ').trim();
        const emailLower2 = (employeeEmail || '').toLowerCase();

        // Find existing leave card by email (case-insensitive), name, or employee number
        let employeeLeave = leavecards.find(lc =>
            (lc.email || '').toLowerCase() === emailLower2 ||
            (lc.employeeId || '').toLowerCase() === emailLower2
        );

        // Fallback: match by name if no email match (for unlinked Excel-migrated cards)
        if (!employeeLeave && employeeEmail) {
            const normalizedId = normName2(employeeEmail);
            employeeLeave = leavecards.find(lc => normName2(lc.name) === normalizedId);
        }

        // Fallback: match by employee number
        if (!employeeLeave && employeeEmail) {
            employeeLeave = leavecards.find(lc => lc.employeeNo && lc.employeeNo === employeeEmail);
        }

        if (!employeeLeave) {
            // Create new leave card record with transaction history
            employeeLeave = {
                applicationId: applicationId,
                employeeId: employeeEmail, // Use email as ID since we don't have explicit ID from application
                email: employeeEmail,
                transactions: transactions || [],
                // Legacy fields for backward compatibility
                vacationLeaveEarned: vacationLeaveEarned || 0,
                sickLeaveEarned: sickLeaveEarned || 0,
                forceLeaveEarned: forceLeaveEarned || 0,
                splEarned: splEarned || 0,
                wellnessEarned: wellnessEarned || 3,
                vacationLeaveSpent: vacationLeaveSpent || 0,
                sickLeaveSpent: sickLeaveSpent || 0,
                forceLeaveSpent: forceLeaveSpent || 0,
                splSpent: splSpent || 0,
                wellnessSpent: wellnessSpent || 0,
                vl: vl || 0,
                sl: sl || 0,
                spl: spl || 0,
                others: others || mandatoryForced || 0,
                mandatoryForced: mandatoryForced || others || 0,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            const normalized = normalizeLeaveCardTransactions(employeeLeave.transactions);
            employeeLeave.transactions = normalized.transactions;
            employeeLeave.vl = normalized.summary.vl;
            employeeLeave.sl = normalized.summary.sl;
            employeeLeave.vacationLeaveEarned = normalized.summary.vacationLeaveEarned;
            employeeLeave.sickLeaveEarned = normalized.summary.sickLeaveEarned;
            employeeLeave.vacationLeaveSpent = normalized.summary.vacationLeaveSpent;
            employeeLeave.sickLeaveSpent = normalized.summary.sickLeaveSpent;
            employeeLeave.forceLeaveSpent = normalized.summary.forceLeaveSpent;
            employeeLeave.splSpent = normalized.summary.splSpent;
            employeeLeave.wellnessSpent = normalized.summary.wellnessSpent;
            employeeLeave.pvpDeductionTotal = normalized.summary.pvpDeductionTotal;
            leavecards.push(employeeLeave);
            console.log('[UPDATE LEAVE] Created new leave card record for:', employeeEmail);
        } else {
            // Update with new transactions
            if (transactions && Array.isArray(transactions)) {
                employeeLeave.transactions = employeeLeave.transactions || [];
                const editDate = new Date().toISOString();
                const incoming = transactions.map(txn => ({ ...txn, dateRecorded: txn.dateRecorded || editDate }));
                const mergedTransactions = replaceTransactions ? incoming : [...employeeLeave.transactions, ...incoming];
                const normalized = normalizeLeaveCardTransactions(mergedTransactions);
                employeeLeave.transactions = normalized.transactions;
                employeeLeave.vl = normalized.summary.vl;
                employeeLeave.sl = normalized.summary.sl;
                employeeLeave.vacationLeaveEarned = normalized.summary.vacationLeaveEarned;
                employeeLeave.sickLeaveEarned = normalized.summary.sickLeaveEarned;
                employeeLeave.vacationLeaveSpent = normalized.summary.vacationLeaveSpent;
                employeeLeave.sickLeaveSpent = normalized.summary.sickLeaveSpent;
                employeeLeave.forceLeaveSpent = normalized.summary.forceLeaveSpent;
                employeeLeave.splSpent = normalized.summary.splSpent;
                employeeLeave.pvpDeductionTotal = normalized.summary.pvpDeductionTotal;

            }

            // Update legacy fields for backward compatibility
            if (vacationLeaveEarned !== undefined) employeeLeave.vacationLeaveEarned = vacationLeaveEarned;
            if (sickLeaveEarned !== undefined) employeeLeave.sickLeaveEarned = sickLeaveEarned;
            if (forceLeaveEarned !== undefined) employeeLeave.forceLeaveEarned = forceLeaveEarned;
            if (splEarned !== undefined) employeeLeave.splEarned = splEarned;
            if (wellnessEarned !== undefined) employeeLeave.wellnessEarned = wellnessEarned;
            if (vacationLeaveSpent !== undefined) employeeLeave.vacationLeaveSpent = vacationLeaveSpent;
            if (sickLeaveSpent !== undefined) employeeLeave.sickLeaveSpent = sickLeaveSpent;
            if (forceLeaveSpent !== undefined) employeeLeave.forceLeaveSpent = forceLeaveSpent;
            if (splSpent !== undefined) employeeLeave.splSpent = splSpent;
            if (wellnessSpent !== undefined) employeeLeave.wellnessSpent = wellnessSpent;
            if (vl !== undefined) {
                employeeLeave.vl = vl;
                // If this is a direct balance edit (from AO), also update vacationLeaveEarned
                // so the employee dashboard's earned-spent calculation stays in sync
                if (!transactions && !vacationLeaveEarned) {
                    const currentSpent = employeeLeave.vacationLeaveSpent || 0;
                    employeeLeave.vacationLeaveEarned = vl + currentSpent;
                }
            }
            if (sl !== undefined) {
                employeeLeave.sl = sl;
                if (!transactions && !sickLeaveEarned) {
                    const currentSpent = employeeLeave.sickLeaveSpent || 0;
                    employeeLeave.sickLeaveEarned = sl + currentSpent;
                }
            }
            if (spl !== undefined) {
                employeeLeave.spl = spl;
                employeeLeave.splEarned = spl;
            }
            if (wellness !== undefined) {
                employeeLeave.wellnessEarned = wellness;
            }
            if (others !== undefined) employeeLeave.others = others;
            if (mandatoryForced !== undefined) {
                employeeLeave.mandatoryForced = mandatoryForced;
                employeeLeave.others = mandatoryForced;
                employeeLeave.forceLeaveEarned = mandatoryForced;
            }

            employeeLeave.updatedAt = new Date().toISOString();

        }

        writeJSON(leavecardsFile, leavecards);


        // Log leave credits update
        logActivity('LEAVE_CREDITS_UPDATED', 'employee', {
            userEmail: employeeEmail,
            applicationId: applicationId,
            vl: employeeLeave.vl,
            sl: employeeLeave.sl,
            spl: employeeLeave.spl,
            ip: getClientIp(req),
            userAgent: req.get('user-agent')
        });

        res.json({
            success: true,
            message: 'Leave card updated successfully',
            leavecard: employeeLeave
        });
    } catch (error) {
        console.error('[UPDATE LEAVE] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
