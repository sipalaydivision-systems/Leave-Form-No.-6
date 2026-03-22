/**
 * Activity-logging service.
 *
 * Provides an append-only audit trail of user actions across all
 * portals.  Logs are capped at 10,000 entries with automatic archival
 * of older entries.
 *
 * Extracted from server.js (lines 483-555) so activity logging can be
 * used from route handlers and background services without coupling to
 * the Express app instance.
 */

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { writeJSON } = require('../data/json-store');
const { dataDir } = require('../config');

// ---------------------------------------------------------------------------
// Data-file path
// ---------------------------------------------------------------------------

const activityLogsFile = path.join(dataDir, 'activity-logs.json');

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Log user activity with detailed information.
 *
 * The log store is append-only: entries are never modified or deleted.
 * When the store exceeds 10,000 entries the oldest records are archived
 * to a timestamped file before being trimmed from the active log.
 *
 * @param {string} action     - Action type (login, logout, create, update, delete, etc.).
 * @param {string} portalType - Portal type (employee, hr, asds, sds, ao, it).
 * @param {object} [details]  - Additional details about the activity.  May include
 *   `ip`, `userEmail`, `userId`, `userAgent` which are promoted to top-level
 *   fields and removed from the nested `details` object.
 */
function logActivity(action, portalType, details = {}) {
    try {
        const ip = details.ip || 'unknown';
        const userEmail = details.userEmail || 'anonymous';
        const userId = details.userId || null;
        const timestamp = new Date().toISOString();

        // Get user agent info
        const userAgent = details.userAgent || 'unknown';

        const logEntry = {
            id: crypto.randomUUID(),
            timestamp,
            action,
            portalType,
            userEmail,
            userId,
            ip,
            userAgent,
            details: {
                ...details,
                ip: undefined,
                userEmail: undefined,
                userId: undefined,
                userAgent: undefined
            }
        };

        let logs = [];
        if (fs.existsSync(activityLogsFile)) {
            try {
                const content = fs.readFileSync(activityLogsFile, 'utf-8');
                logs = JSON.parse(content);
                if (!Array.isArray(logs)) logs = [];
            } catch (e) {
                logs = [];
            }
        }

        // APPEND-ONLY: Write new entry by appending to array, then atomic-write.
        // This preserves full audit trail integrity -- entries are never modified/deleted.
        logs.push(logEntry);
        if (logs.length > 10000) {
            // Archive old logs before trimming (keeps audit trail recoverable)
            const archivePath = activityLogsFile.replace(
                '.json',
                `-archive-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
            );
            try { writeJSON(archivePath, logs.slice(0, logs.length - 10000)); } catch (e) { /* best-effort archive */ }
            logs = logs.slice(-10000);
        }

        writeJSON(activityLogsFile, logs);
    } catch (error) {
        console.error('Error logging activity:', error);
    }
}

/**
 * Extract the real client IP address from an Express request.
 *
 * Checks the `X-Forwarded-For` header (set by reverse proxies like
 * Railway / Render / Nginx) first, then falls back to lower-level
 * socket addresses.
 *
 * @param {object} req - Express request object.
 * @returns {string} Client IP address, or `'unknown'` if not determinable.
 */
function getClientIp(req) {
    return (req.headers['x-forwarded-for'] || '').split(',')[0] ||
           req.connection.remoteAddress ||
           req.socket.remoteAddress ||
           req.connection.socket?.remoteAddress ||
           'unknown';
}

// ---------------------------------------------------------------------------

module.exports = {
    logActivity,
    getClientIp,
};
