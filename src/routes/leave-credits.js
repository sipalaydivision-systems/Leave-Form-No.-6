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
// GET /api/leave-credits — fetch live leave balance (lazy-loaded per request)
// ---------------------------------------------------------------------------
router.get('/api/leave-credits', requireAuth(), (req, res) => {
    try {
        const employeeId = req.query.employeeId;
        if (!employeeId) {
            return res.status(400).json({ success: false, error: 'Employee ID is required' });
        }

        if (!isSelfOrAdmin(req, employeeId)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        if (!isAoAccessAllowed(req, employeeId)) {
            return res.status(403).json({ success: false, error: 'Access denied. This employee is not from your school.' });
        }

        // Lazy-load: one file read for this request via the repository
        const { repos } = require('../data/repositories');
        const { leavecards } = repos();
        const latestRecord = leavecards.findByEmail(employeeId);

        if (!latestRecord) {
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
                    wellnessEarned: 5,
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

        // Persist year reset via the same repository instance (no second file read)
        if (needsPersist) {
            leavecards.save(latestRecord);
            console.log(`[LEAVE-CREDITS] Year reset persisted for ${latestRecord.email}: FL/SPL/WL spent reset to 0 for ${currentYear}`);
        }

        // Single source of truth: vl/sl summary fields
        // These are updated by accrual, SDS approval, and AO edits — always current
        // transactions[] and leaveUsageHistory[] are audit logs only, not used for balance
        let vlBalance = (latestRecord.vl !== undefined) ? latestRecord.vl : null;
        let slBalance = (latestRecord.sl !== undefined) ? latestRecord.sl : null;
        let totalForceSpent = forceLeaveSpent;
        let totalSplSpent = splSpent;

        // FL/SPL/Wellness spent values are authoritative from the dedicated fields.
        // These are reset to 0 at the start of each year (year-reset logic above)
        // and incremented only by SDS final approval via updateLeaveCardWithUsage().
        //
        // Do NOT sum from transactions[] — those contain multi-year historical
        // data imported from Excel and would produce negative balances when summed
        // across years that have already been reset.
        let totalWellnessSpent = wellnessSpent;

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
            wellnessEarned: latestRecord.wellnessEarned || 5,
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
                    wellness: 5
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

// ---------------------------------------------------------------------------
// DELETE /api/leave-credits/transaction/:txId — Remove one transaction by ID
// ---------------------------------------------------------------------------
router.delete('/api/leave-credits/transaction/:txId', requireAuth('ao', 'it'), (req, res) => {
    try {
        const { txId } = req.params;
        const employeeId = req.query.employeeId;
        if (!employeeId) return res.status(400).json({ success: false, error: 'employeeId required' });
        if (!isSelfOrAdmin(req, employeeId)) return res.status(403).json({ success: false, error: 'Access denied' });

        const leavecards = readJSON(leavecardsFile);
        const idx = leavecards.findIndex(lc => lc.email === employeeId || lc.employeeId === employeeId);
        if (idx === -1) return res.status(404).json({ success: false, error: 'Leave card not found' });

        const card = leavecards[idx];
        const before = (card.transactions || []).length;
        card.transactions = (card.transactions || []).filter(t => t.id !== txId);
        if (card.transactions.length === before) {
            return res.status(404).json({ success: false, error: 'Transaction not found' });
        }

        // Recalculate running balances from the remaining transactions
        if (card.transactions.length > 0) {
            const normalized = normalizeLeaveCardTransactions(card.transactions);
            card.transactions = normalized.transactions;
            const s = normalized.summary;
            card.vacationLeaveEarned = s.vacationLeaveEarned;
            card.sickLeaveEarned     = s.sickLeaveEarned;
            card.vacationLeaveSpent  = s.vacationLeaveSpent;
            card.sickLeaveSpent      = s.sickLeaveSpent;
            card.vl = s.vl;
            card.sl = s.sl;
        } else {
            // All transactions removed — zero out summary fields
            card.vacationLeaveEarned = 0;
            card.sickLeaveEarned = 0;
            card.vacationLeaveSpent = 0;
            card.sickLeaveSpent = 0;
            card.vl = 0;
            card.sl = 0;
        }

        card.updatedAt = new Date().toISOString();
        leavecards[idx] = card;
        writeJSON(leavecardsFile, leavecards);

        logActivity('LEAVE_TRANSACTION_DELETED', 'ao', {
            userEmail: req.session.email,
            employeeId,
            transactionId: txId,
            ip: getClientIp(req),
            userAgent: req.get('user-agent'),
        });

        res.json({ success: true, message: 'Transaction deleted and balances recalculated', leavecard: card });
    } catch (error) {
        console.error('[DELETE TX] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
