/**
 * Leave-approval service.
 *
 * Contains the core approval workflow logic and balance-deduction
 * functions that execute when a leave application moves through the
 * AO -> HR -> ASDS -> SDS approval chain.
 *
 * Extracted from server.js (lines 5265-5710) so the business rules
 * can be tested and reused independently of the Express route handler.
 */

const path = require('path');
const { ensureFile, readJSON, readJSONArray, writeJSON } = require('../data/json-store');
const { dataDir } = require('../config');

// ---------------------------------------------------------------------------
// Data-file paths (mirrors the canonical paths in server.js)
// ---------------------------------------------------------------------------

const leavecardsFile  = path.join(dataDir, 'leavecards.json');
const ctoRecordsFile  = path.join(dataDir, 'cto-records.json');

// ---------------------------------------------------------------------------
// Workflow constants
// ---------------------------------------------------------------------------

/** Approval chain hierarchy (lower index = lower in chain). */
const WORKFLOW_ORDER = ['EMPLOYEE', 'AO', 'HR', 'ASDS', 'SDS'];

/** Actions an approver may take. */
const VALID_ACTIONS = ['approved', 'returned', 'rejected'];

// ---------------------------------------------------------------------------
// Balance update after SDS final approval
// ---------------------------------------------------------------------------

/**
 * Update employee leave balance after SDS final approval.
 *
 * Currently a no-op log: the actual balance deduction is handled by
 * `updateLeaveCardWithUsage` which the AO encodes manually.
 *
 * @param {object} application - The approved leave application.
 */
function updateEmployeeLeaveBalance(application) {
    try {
        const leaveType = application.typeOfLeave || application.leaveType || '';
        console.log(`[LEAVE] Auto leave-card update skipped for ${application.employeeEmail} (${leaveType}). AO manual encoding is required.`);
    } catch (error) {
        console.error('Error updating leave balance:', error);
    }
}

/**
 * Deduct days from an employee's leave card and record usage history
 * after a leave application has been finally approved.
 *
 * Handles VL, SL, Force Leave, SPL, and CTO deductions including
 * yearly allocation resets and negative-balance capping.
 *
 * @param {object} application - The approved leave application.
 * @param {number} vlUsed      - Vacation Leave days to deduct.
 * @param {number} slUsed      - Sick Leave days to deduct.
 */
function updateLeaveCardWithUsage(application, vlUsed, slUsed) {
    try {
        const leavecards = readJSON(leavecardsFile);
        let leavecard = leavecards.find(lc =>
            lc.email === application.employeeEmail || lc.employeeId === application.employeeEmail
        );
        const currentYear = new Date().getFullYear();

        if (!leavecard) {
            // Create new leave card if not found (VL/SL start at 0, earned via monthly accrual)
            leavecard = {
                email: application.employeeEmail,
                employeeId: application.employeeEmail,
                vacationLeaveEarned: 0,
                sickLeaveEarned: 0,
                forceLeaveEarned: 5,
                splEarned: 3,
                wellnessEarned: 3,
                vacationLeaveSpent: 0,
                sickLeaveSpent: 0,
                forceLeaveSpent: 0,
                splSpent: 0,
                wellnessSpent: 0,
                forceLeaveYear: currentYear,
                splYear: currentYear,
                wellnessYear: currentYear,
                vl: 0,
                sl: 0,
                spl: 3,
                others: 0,
                leaveUsageHistory: [],
                createdAt: new Date().toISOString()
            };
            leavecards.push(leavecard);
        }

        // Initialize earned values if not present (for existing cards without these fields)
        if (leavecard.vacationLeaveEarned === undefined) leavecard.vacationLeaveEarned = 0;
        if (leavecard.sickLeaveEarned === undefined) leavecard.sickLeaveEarned = 0;

        // Initialize year tracking if not present
        if (!leavecard.forceLeaveYear) leavecard.forceLeaveYear = currentYear;
        if (!leavecard.splYear) leavecard.splYear = currentYear;
        if (!leavecard.wellnessYear) leavecard.wellnessYear = currentYear;

        // Reset Force Leave balance if year has changed
        if (leavecard.forceLeaveYear !== currentYear) {
            leavecard.forceLeaveSpent = 0;
            leavecard.forceLeaveYear = currentYear;
        }

        // Reset Special Privilege Leave balance if year has changed
        if (leavecard.splYear !== currentYear) {
            leavecard.splSpent = 0;
            leavecard.splYear = currentYear;
        }

        // Reset Wellness Leave balance if year has changed
        if (leavecard.wellnessYear !== currentYear) {
            leavecard.wellnessSpent = 0;
            leavecard.wellnessYear = currentYear;
        }

        // Initialize balance if not set (use earned values)
        if (leavecard.vl === undefined || leavecard.vl === null) {
            leavecard.vl = leavecard.vacationLeaveEarned - (leavecard.vacationLeaveSpent || 0);
        }
        if (leavecard.sl === undefined || leavecard.sl === null) {
            leavecard.sl = leavecard.sickLeaveEarned - (leavecard.sickLeaveSpent || 0);
        }

        // Initialize usage history if not present
        if (!leavecard.leaveUsageHistory) {
            leavecard.leaveUsageHistory = [];
        }

        // Determine leave type from application
        let leaveType = 'Leave';
        let daysUsed = 0;
        let forceLeaveUsed = 0;
        let splUsed = 0;
        let wellnessUsed = 0;

        if (application.typeOfLeave || application.leaveType) {
            const lType = application.typeOfLeave || application.leaveType;
            if (lType === 'leave_mfl' || String(lType).toLowerCase().includes('force')) {
                leaveType = 'Force Leave';
                daysUsed = parseFloat(application.numDays) || parseFloat(application.forceLeaveCount) || parseFloat(application.daysApplied) || 1;
                forceLeaveUsed = daysUsed;
            } else if (lType === 'leave_spl' || String(lType).toLowerCase().includes('special')) {
                leaveType = 'Special Privilege Leave';
                daysUsed = parseFloat(application.numDays) || parseFloat(application.splCount) || parseFloat(application.daysApplied) || 1;
                splUsed = daysUsed;
            } else if (lType === 'leave_wl' || lType === 'leave_wellness' || lType === 'wellness' || String(lType).toLowerCase().includes('wellness')) {
                leaveType = 'Wellness Leave';
                daysUsed = parseFloat(application.numDays) || parseFloat(application.daysApplied) || 1;
                wellnessUsed = daysUsed;
            }
        }

        // If no specific leave type matched, use VL/SL
        if (!forceLeaveUsed && !splUsed && !wellnessUsed) {
            if (vlUsed > 0) {
                leaveType = 'Vacation Leave';
                daysUsed = vlUsed;
            } else if (slUsed > 0) {
                leaveType = 'Sick Leave';
                daysUsed = slUsed;
            }
        }

        // Deduct from balance based on leave type
        if (forceLeaveUsed > 0) {
            // Force Leave is a separate 5-day yearly allocation -- NOT charged against VL
            leavecard.forceLeaveSpent = (leavecard.forceLeaveSpent || 0) + forceLeaveUsed;
            // Do NOT deduct from leavecard.vl or vacationLeaveSpent
        } else if (splUsed > 0) {
            leavecard.splSpent = (leavecard.splSpent || 0) + splUsed;
        } else if (wellnessUsed > 0) {
            // Wellness Leave is a separate 3-day yearly allocation
            leavecard.wellnessSpent = (leavecard.wellnessSpent || 0) + wellnessUsed;
        } else if (application.leaveType === 'leave_others' || String(application.leaveType || '').toLowerCase().includes('others')) {
            // CTO/Others leave - deduct from CTO records
            const ctoUsed = parseFloat(application.numDays) || parseFloat(application.daysApplied) || 1;
            leaveType = 'CTO';
            daysUsed = ctoUsed;
            try {
                ensureFile(ctoRecordsFile);
                const ctoRecords = readJSON(ctoRecordsFile);
                const empCtoRecords = ctoRecords.filter(r => r.employeeId === application.employeeEmail);
                if (empCtoRecords.length > 0) {
                    // Find the most recent CTO record with remaining balance
                    let remaining = ctoUsed;
                    for (let i = empCtoRecords.length - 1; i >= 0 && remaining > 0; i--) {
                        const rec = empCtoRecords[i];
                        const recIndex = ctoRecords.indexOf(rec);
                        const granted = parseFloat(rec.daysGranted) || 0;
                        const used = parseFloat(rec.daysUsed) || 0;
                        const available = granted - used;
                        if (available > 0) {
                            const deduct = Math.min(remaining, available);
                            ctoRecords[recIndex].daysUsed = (used + deduct);
                            remaining -= deduct;
                        }
                    }
                    writeJSON(ctoRecordsFile, ctoRecords);
                    console.log(`[LEAVECARD] Deducted ${ctoUsed} CTO days from records for ${application.employeeEmail}`);
                }
            } catch (ctoErr) {
                console.error('Error deducting CTO:', ctoErr);
            }
        } else {
            // VL/SL deduction -- negative balances are NOT allowed and NOT charged to other leave types
            if (slUsed > 0) {
                const currentSl = leavecard.sl || 0;
                // Only deduct what SL can cover -- do NOT charge remainder to VL
                const actualSlDeduction = Math.min(slUsed, currentSl);
                leavecard.sl = Math.max(0, currentSl - actualSlDeduction);
                leavecard.sickLeaveSpent = (leavecard.sickLeaveSpent || 0) + actualSlDeduction;
                if (slUsed > currentSl) {
                    console.log(`[LEAVECARD] SL capped: requested ${slUsed} but only ${currentSl} available. NOT charging VL for ${application.employeeEmail}`);
                }
            }
            if (vlUsed > 0) {
                const currentVl = leavecard.vl || 0;
                const actualVlDeduction = Math.min(vlUsed, currentVl);
                leavecard.vl = Math.max(0, currentVl - actualVlDeduction);
                leavecard.vacationLeaveSpent = (leavecard.vacationLeaveSpent || 0) + actualVlDeduction;
                if (vlUsed > currentVl) {
                    console.log(`[LEAVECARD] VL capped: requested ${vlUsed} but only ${currentVl} available for ${application.employeeEmail}`);
                }
            }
        }

        // Record usage with period covered
        const dateFrom = application.dateFrom || application.date_from || application.inclusiveDatesFrom || '';
        const dateTo = application.dateTo || application.date_to || application.inclusiveDatesTo || '';

        // balanceAfterVL/SL should always reflect the current VL/SL balance, regardless of leave type
        const balanceAfterVL = leavecard.vl;
        const balanceAfterSL = leavecard.sl;

        leavecard.leaveUsageHistory.push({
            applicationId: application.id,
            leaveType: leaveType,
            daysUsed: daysUsed,
            periodFrom: dateFrom,
            periodTo: dateTo,
            dateApproved: new Date().toISOString(),
            approvedBy: 'SDS',
            remarks: application.remarks || '',
            balanceAfterVL: balanceAfterVL,
            balanceAfterSL: balanceAfterSL
        });

        leavecard.updatedAt = new Date().toISOString();

        // Find and update the leavecard entry
        const lcIndex = leavecards.findIndex(lc =>
            lc.email === application.employeeEmail || lc.employeeId === application.employeeEmail
        );
        if (lcIndex !== -1) {
            leavecards[lcIndex] = leavecard;
        }

        writeJSON(leavecardsFile, leavecards);
        console.log(`[LEAVECARD] Updated leave card for ${application.employeeEmail}: VL=${leavecard.vl}, SL=${leavecard.sl}, FL Spent=${leavecard.forceLeaveSpent}, SPL Spent=${leavecard.splSpent}, WL Spent=${leavecard.wellnessSpent || 0}, Year=${currentYear}`);
    } catch (error) {
        console.error('Error updating leave card:', error);
    }
}

// ---------------------------------------------------------------------------
// Approval state transitions
// ---------------------------------------------------------------------------

/**
 * Determine the next approver after the current one approves.
 *
 * @param {string} currentApprover - Current approver portal code (AO, HR, ASDS, SDS).
 * @returns {string|null} Next approver code, or null if this was the final step.
 */
function getNextApprover(currentApprover) {
    const idx = WORKFLOW_ORDER.indexOf(currentApprover);
    if (idx === -1 || idx >= WORKFLOW_ORDER.length - 1) return null;
    return WORKFLOW_ORDER[idx + 1];
}

/**
 * Determine where a returned application should go by default
 * (one step back in the workflow).
 *
 * @param {string} currentApprover - The portal returning the application.
 * @returns {{ status: string, currentApprover: string, returnedTo: string }}
 */
function getDefaultReturnTarget(currentApprover) {
    if (currentApprover === 'AO') {
        return { status: 'returned', currentApprover: 'EMPLOYEE', returnedTo: 'Employee' };
    }
    const idx = WORKFLOW_ORDER.indexOf(currentApprover);
    if (idx <= 0) {
        return { status: 'returned', currentApprover: 'EMPLOYEE', returnedTo: 'Employee' };
    }
    const prevStep = WORKFLOW_ORDER[idx - 1];
    if (prevStep === 'EMPLOYEE') {
        return { status: 'returned', currentApprover: 'EMPLOYEE', returnedTo: 'Employee' };
    }
    return { status: 'pending', currentApprover: prevStep, returnedTo: prevStep };
}

/**
 * Determine return target when a specific `returnTo` step is requested.
 *
 * @param {string} currentApprover - The portal returning the application.
 * @param {string} returnTo        - Requested target step (e.g. 'EMPLOYEE', 'AO', 'HR').
 * @returns {{ status: string, currentApprover: string, returnedTo: string } | null}
 *   Returns null if the requested target is not below the current approver.
 */
function getSpecificReturnTarget(currentApprover, returnTo) {
    const currentIndex = WORKFLOW_ORDER.indexOf(currentApprover);
    const targetIndex = WORKFLOW_ORDER.indexOf(returnTo);
    if (targetIndex >= currentIndex || targetIndex === -1) return null; // Invalid target

    if (returnTo === 'EMPLOYEE') {
        return { status: 'returned', currentApprover: 'EMPLOYEE', returnedTo: 'Employee' };
    }
    return { status: 'pending', currentApprover: returnTo, returnedTo: returnTo };
}

/**
 * Apply an approval action to a leave application and return the mutated object.
 *
 * This is the core state-machine that processes approve / return / reject
 * transitions.  It does NOT persist data or send notifications -- the caller
 * is responsible for saving and notifying.
 *
 * @param {object} application      - The leave application object (mutated in-place).
 * @param {object} opts
 * @param {string} opts.action      - 'approved' | 'returned' | 'rejected'
 * @param {string} opts.currentApprover - Session-derived portal code (AO, HR, ASDS, SDS).
 * @param {string} opts.approverName    - Resolved full name of the approver.
 * @param {string} [opts.remarks]       - Reason for return/reject.
 * @param {string} [opts.returnTo]      - Specific return target (for returns).
 * @param {object} [opts.officerInfo]   - Officer name/signature fields for HR/ASDS/SDS steps.
 * @param {object} [opts.leaveCredits]  - Leave credit fields certified by HR.
 * @returns {{ application: object, error?: string }}
 */
function applyApprovalAction(application, opts) {
    const {
        action, currentApprover, approverName,
        remarks, returnTo, officerInfo, leaveCredits
    } = opts;

    // Block action on already-finalised applications
    if (application.status === 'approved' || application.status === 'rejected') {
        return {
            application,
            error: `This application has already been ${application.status}. No further action can be taken.`
        };
    }

    // Validate that the session role matches what the application expects
    if (currentApprover !== application.currentApprover) {
        return {
            application,
            error: `This application is currently waiting for ${application.currentApprover || 'unknown'} approval. You cannot act on it as ${currentApprover}.`
        };
    }

    // Add to approval history
    if (!application.approvalHistory) application.approvalHistory = [];
    application.approvalHistory.push({
        portal: currentApprover,
        action: action,
        approverName: approverName,
        remarks: remarks || '',
        timestamp: new Date().toISOString()
    });

    // --- RETURNED ---
    if (action === 'returned') {
        let target;
        if (returnTo) {
            target = getSpecificReturnTarget(currentApprover, returnTo);
        }
        if (!target) {
            target = getDefaultReturnTarget(currentApprover);
        }

        application.status = target.status;
        application.currentApprover = target.currentApprover;
        application.returnedAt = new Date().toISOString();
        application.returnedBy = currentApprover;
        application.returnRemarks = remarks;

        console.log(`[LEAVE] Application ${application.id} returned by ${currentApprover} to ${target.returnedTo} - Reason: ${remarks}`);
        return { application };
    }

    // --- REJECTED ---
    if (action === 'rejected') {
        application.status = 'rejected';
        application.currentApprover = null;
        application.rejectedAt = new Date().toISOString();
        application.rejectedBy = currentApprover;
        application.rejectedByName = approverName;
        application.rejectionReason = remarks;

        console.log(`[LEAVE] Application ${application.id} REJECTED by ${currentApprover} - Reason: ${remarks}`);
        return { application };
    }

    // --- APPROVED ---
    if (action === 'approved') {
        if (currentApprover === 'AO') {
            application.currentApprover = 'HR';
            application.aoApprovedAt = new Date().toISOString();
            console.log(`[WORKFLOW] AO approved - Moving to HR`);

        } else if (currentApprover === 'HR') {
            application.currentApprover = 'ASDS';
            application.hrApprovedAt = new Date().toISOString();

            // Store authorized officer info for Section 7.A of the final form
            if (officerInfo) {
                if (officerInfo.authorizedOfficerName) application.authorizedOfficerName = officerInfo.authorizedOfficerName;
                if (officerInfo.authorizedOfficerSignature) application.authorizedOfficerSignature = officerInfo.authorizedOfficerSignature;
            }

            // Store leave credits certified by HR
            if (leaveCredits) {
                const creditFields = [
                    'vlEarned', 'vlLess', 'vlBalance',
                    'slEarned', 'slLess', 'slBalance',
                    'splEarned', 'splLess', 'splBalance',
                    'flEarned', 'flLess', 'flBalance',
                    'wlEarned', 'wlLess', 'wlBalance',
                    'ctoEarned', 'ctoLess', 'ctoBalance'
                ];
                for (const field of creditFields) {
                    if (leaveCredits[field] !== undefined) {
                        application[field] = leaveCredits[field];
                    }
                }
            }

            console.log(`[WORKFLOW] HR approved - Moving to ASDS. Authorized Officer: ${(officerInfo && officerInfo.authorizedOfficerName) || 'Not specified'}`);

        } else if (currentApprover === 'ASDS') {
            application.currentApprover = 'SDS';
            application.asdsApprovedAt = new Date().toISOString();

            // Store ASDS/OIC-ASDS officer info for Section 7.B of the final form
            if (officerInfo) {
                if (officerInfo.asdsOfficerName) application.asdsOfficerName = officerInfo.asdsOfficerName;
                if (officerInfo.asdsOfficerSignature) application.asdsOfficerSignature = officerInfo.asdsOfficerSignature;
            }

            console.log(`[WORKFLOW] ASDS approved - Moving to SDS. OIC-ASDS: ${(officerInfo && officerInfo.asdsOfficerName) || 'Not specified'}`);

        } else if (currentApprover === 'SDS') {
            // SDS approved -> FINAL APPROVAL
            application.status = 'approved';
            application.currentApprover = null;
            application.sdsApprovedAt = new Date().toISOString();
            application.finalApprovalAt = new Date().toISOString();

            // Store SDS officer info
            if (officerInfo) {
                if (officerInfo.sdsOfficerName) application.sdsOfficerName = officerInfo.sdsOfficerName;
                if (officerInfo.sdsOfficerSignature) application.sdsOfficerSignature = officerInfo.sdsOfficerSignature;
            }

            console.log(`[WORKFLOW] SDS approved - FINAL APPROVAL. OIC-SDS: ${(officerInfo && officerInfo.sdsOfficerName) || 'Not specified'}`);

            // Update employee's leave balance
            updateEmployeeLeaveBalance(application);
        }

        console.log(`[LEAVE] Application ${application.id} approved by ${currentApprover}, new currentApprover: ${application.currentApprover}`);
        return { application };
    }

    return { application, error: `Unknown action: ${action}` };
}

// ---------------------------------------------------------------------------

module.exports = {
    WORKFLOW_ORDER,
    VALID_ACTIONS,
    updateEmployeeLeaveBalance,
    updateLeaveCardWithUsage,
    getNextApprover,
    getDefaultReturnTarget,
    getSpecificReturnTarget,
    applyApprovalAction,
};
