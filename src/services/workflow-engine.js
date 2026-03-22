/**
 * Workflow Engine — Formalizes the leave application approval state machine.
 *
 * State Machine:
 *   PENDING (AO) → AO_APPROVED → PENDING (HR) → HR_APPROVED →
 *   PENDING (ASDS) → ASDS_APPROVED → PENDING (SDS) → APPROVED
 *
 *   Any state → RETURNED (to previous step or employee)
 *   Any state → REJECTED (terminal)
 *   PENDING (AO) → CANCELLED (by employee, terminal)
 *
 * This module centralizes transition validation and next-approver routing.
 * The actual database writes happen in the route handlers or repositories.
 */

const { DIVISION_OFFICES } = require('../config/constants');

// Approval chain order
const APPROVAL_CHAIN = ['AO', 'HR', 'ASDS', 'SDS'];

// Terminal states — no further transitions possible
const TERMINAL_STATES = ['approved', 'rejected', 'cancelled'];

/**
 * Determine if an employee is school-based (goes through AO first)
 * or division-level (may skip AO depending on configuration).
 */
function isSchoolBasedEmployee(office) {
    if (!office) return true; // Default to school-based
    const normalized = office.toUpperCase().replace(/\s+/g, ' ').trim();
    const divisionOffices = (DIVISION_OFFICES || []).map(o => o.toUpperCase().replace(/\s+/g, ' ').trim());
    return !divisionOffices.includes(normalized);
}

/**
 * Get the first approver in the chain for a new application.
 */
function getFirstApprover(application) {
    // All applications start with AO regardless of school/division level
    return 'AO';
}

/**
 * Get the next approver after a successful approval.
 * Returns null if this was the final approval (SDS).
 */
function getNextApprover(currentApprover) {
    const idx = APPROVAL_CHAIN.indexOf(currentApprover);
    if (idx === -1) return null;
    if (idx >= APPROVAL_CHAIN.length - 1) return null; // SDS is final
    return APPROVAL_CHAIN[idx + 1];
}

/**
 * Get the previous approver for a return action.
 * Returns 'EMPLOYEE' if returning from AO.
 */
function getPreviousApprover(currentApprover) {
    const idx = APPROVAL_CHAIN.indexOf(currentApprover);
    if (idx <= 0) return 'EMPLOYEE';
    return APPROVAL_CHAIN[idx - 1];
}

/**
 * Validate whether a transition is legal.
 *
 * @param {object} application - Current application state
 * @param {string} action - 'approved' | 'returned' | 'rejected'
 * @param {string} actingPortal - Portal of the user taking action (AO/HR/ASDS/SDS)
 * @returns {{ valid: boolean, error?: string, nextState?: object }}
 */
function validateTransition(application, action, actingPortal) {
    // Can't act on terminal states
    if (TERMINAL_STATES.includes(application.status)) {
        return { valid: false, error: `Application is already ${application.status}` };
    }

    // Check that the acting portal matches the current approver
    const currentApprover = application.currentApprover || application.current_approver;
    if (currentApprover && currentApprover.toUpperCase() !== actingPortal.toUpperCase()) {
        return {
            valid: false,
            error: `This application is pending ${currentApprover} review, not ${actingPortal}`,
        };
    }

    const portal = actingPortal.toUpperCase();

    switch (action) {
        case 'approved': {
            const nextApprover = getNextApprover(portal);
            if (nextApprover) {
                // Intermediate approval — advance to next approver
                return {
                    valid: true,
                    nextState: {
                        status: 'pending',
                        currentApprover: nextApprover,
                        isFinalApproval: false,
                    },
                };
            } else {
                // Final approval (SDS)
                return {
                    valid: true,
                    nextState: {
                        status: 'approved',
                        currentApprover: null,
                        isFinalApproval: true,
                    },
                };
            }
        }

        case 'returned': {
            return {
                valid: true,
                nextState: {
                    status: 'returned',
                    currentApprover: 'EMPLOYEE',
                    isFinalApproval: false,
                },
            };
        }

        case 'rejected': {
            return {
                valid: true,
                nextState: {
                    status: 'rejected',
                    currentApprover: null,
                    isFinalApproval: false,
                },
            };
        }

        default:
            return { valid: false, error: `Unknown action: ${action}` };
    }
}

/**
 * Build the timestamp field name for an approval action.
 * e.g., 'AO' + 'approved' → 'aoApprovedAt'
 */
function getTimestampField(portal) {
    const p = portal.toLowerCase();
    if (p === 'sds') return 'finalApprovalAt';
    return `${p}ApprovedAt`;
}

/**
 * Build the approver name field for an approval action.
 * e.g., 'AO' → 'aoName', 'HR' → 'hrOfficerName'
 */
function getApproverNameField(portal) {
    const map = {
        AO:   'aoName',
        HR:   'hrOfficerName',
        ASDS: 'asdsOfficerName',
        SDS:  'sdsOfficerName',
    };
    return map[portal.toUpperCase()] || `${portal.toLowerCase()}Name`;
}

/**
 * Build an approval history entry.
 */
function createHistoryEntry(portal, action, approverName, remarks) {
    return {
        portal: portal.toUpperCase(),
        action,
        approverName: approverName || '',
        remarks: remarks || '',
        timestamp: new Date().toISOString(),
    };
}

/**
 * Get all valid actions for the current state.
 */
function getAvailableActions(application) {
    if (TERMINAL_STATES.includes(application.status)) return [];
    return ['approved', 'returned', 'rejected'];
}

/**
 * Get a human-readable status label.
 */
function getStatusLabel(application) {
    const status = application.status;
    const approver = application.currentApprover || application.current_approver;

    if (status === 'pending' && approver) {
        return `Pending ${approver} Review`;
    }
    if (status === 'approved') return 'Approved';
    if (status === 'returned') return 'Returned to Employee';
    if (status === 'rejected') return 'Rejected';
    if (status === 'cancelled') return 'Cancelled';
    return status;
}

/**
 * Get the approval progress as a percentage (0-100).
 */
function getApprovalProgress(application) {
    if (application.status === 'approved') return 100;
    if (TERMINAL_STATES.includes(application.status)) return 0;

    const approver = application.currentApprover || application.current_approver;
    const idx = APPROVAL_CHAIN.indexOf(approver);
    if (idx === -1) return 0;
    return Math.round((idx / APPROVAL_CHAIN.length) * 100);
}

module.exports = {
    APPROVAL_CHAIN,
    TERMINAL_STATES,
    isSchoolBasedEmployee,
    getFirstApprover,
    getNextApprover,
    getPreviousApprover,
    validateTransition,
    getTimestampField,
    getApproverNameField,
    createHistoryEntry,
    getAvailableActions,
    getStatusLabel,
    getApprovalProgress,
};
