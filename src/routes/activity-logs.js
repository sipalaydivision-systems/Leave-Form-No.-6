/**
 * Activity log routes — viewing, summarizing, and exporting activity logs.
 *
 * Extracted from server.js:
 *   - GET /api/activity-logs         (line 5845)
 *   - GET /api/activity-logs-summary (line 5903)
 *   - GET /api/export-activity-logs  (line 5955)
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { requireAuth } = require('../middleware/auth');
const { readJSON, readJSONArray, writeJSON } = require('../data/json-store');
const { dataDir } = require('../config');

const activityLogsFile = path.join(dataDir, 'activity-logs.json');

// ---------------------------------------------------------------------------
// GET /api/activity-logs — View activity logs with pagination and filtering
// ---------------------------------------------------------------------------
router.get('/api/activity-logs', requireAuth('it'), (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 50, 500); // S16: Cap at 500 to prevent abuse
        const action = req.query.action;
        const portal = req.query.portal;
        const userEmail = req.query.userEmail;
        const startDate = req.query.startDate;
        const endDate = req.query.endDate;

        const logs = readJSONArray(activityLogsFile);

        // Apply filters
        let filtered = logs;
        if (action) {
            filtered = filtered.filter(log => log.action.includes(action.toUpperCase()));
        }
        if (portal) {
            filtered = filtered.filter(log => log.portalType === portal.toLowerCase());
        }
        if (userEmail) {
            filtered = filtered.filter(log => log.userEmail.toLowerCase().includes(userEmail.toLowerCase()));
        }
        if (startDate) {
            const start = new Date(startDate);
            filtered = filtered.filter(log => new Date(log.timestamp) >= start);
        }
        if (endDate) {
            const end = new Date(endDate);
            filtered = filtered.filter(log => new Date(log.timestamp) <= end);
        }

        // Sort by timestamp descending (newest first)
        filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        // Pagination
        const totalItems = filtered.length;
        const totalPages = Math.ceil(totalItems / limit);
        const start = (page - 1) * limit;
        const paginated = filtered.slice(start, start + limit);

        res.json({
            success: true,
            logs: paginated,
            pagination: {
                page,
                limit,
                totalItems,
                totalPages
            }
        });
    } catch (error) {
        console.error('Error fetching activity logs:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---------------------------------------------------------------------------
// GET /api/activity-logs-summary — Get summary counts / stats
// ---------------------------------------------------------------------------
router.get('/api/activity-logs-summary', requireAuth('it'), (req, res) => {
    try {
        const logs = readJSONArray(activityLogsFile);

        // Calculate statistics
        const stats = {
            totalActivities: logs.length,
            activitiesByAction: {},
            activitiesByPortal: {},
            activitiesByIp: {},
            recentActivities: logs.slice(-10),
            last24Hours: logs.filter(log => {
                const logTime = new Date(log.timestamp);
                const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
                return logTime >= oneDayAgo;
            }).length,
            uniqueUsers: new Set(logs.map(log => log.userEmail)).size,
            uniqueIps: new Set(logs.map(log => log.ip)).size
        };

        // Group by action
        logs.forEach(log => {
            if (!stats.activitiesByAction[log.action]) {
                stats.activitiesByAction[log.action] = 0;
            }
            stats.activitiesByAction[log.action]++;
        });

        // Group by portal
        logs.forEach(log => {
            if (!stats.activitiesByPortal[log.portalType]) {
                stats.activitiesByPortal[log.portalType] = 0;
            }
            stats.activitiesByPortal[log.portalType]++;
        });

        // Group by IP
        logs.forEach(log => {
            if (!stats.activitiesByIp[log.ip]) {
                stats.activitiesByIp[log.ip] = 0;
            }
            stats.activitiesByIp[log.ip]++;
        });

        res.json({ success: true, stats });
    } catch (error) {
        console.error('Error fetching activity logs summary:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---------------------------------------------------------------------------
// GET /api/export-activity-logs — Export logs as CSV
// ---------------------------------------------------------------------------
router.get('/api/export-activity-logs', requireAuth('it'), (req, res) => {
    try {
        const logs = readJSONArray(activityLogsFile);

        // Convert to CSV
        const headers = ['ID', 'Timestamp', 'Action', 'Portal', 'User Email', 'User ID', 'IP Address', 'User Agent', 'Details'];
        const csvContent = [
            headers.join(','),
            ...logs.map(log => [
                log.id,
                log.timestamp,
                log.action,
                log.portalType,
                log.userEmail,
                log.userId || '',
                log.ip,
                (log.userAgent || '').replace(/,/g, ';'),
                JSON.stringify(log.details).replace(/,/g, ';')
            ].map(field => `"${String(field || '').replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"` ).join(','))
        ].join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="activity-logs.csv"');
        res.send(csvContent);
    } catch (error) {
        console.error('Error exporting activity logs:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
