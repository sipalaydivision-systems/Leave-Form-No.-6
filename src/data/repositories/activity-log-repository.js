/**
 * Activity Log Repository — Abstracts activity log CRUD over PostgreSQL or JSON.
 *
 * JSON mode: `activity-logs.json` flat file, capped at 10,000 entries.
 * PG mode: `activity_logs` table.
 */

const path = require('path');
const db = require('../db');
const { readJSONArray, readJSON, writeJSON } = require('../json-store');
const { dataDir } = require('../../config');

const DATA_FILE = path.join(dataDir, 'activity-logs.json');
const MAX_JSON_ENTRIES = 10000;

// ========================
// PostgreSQL Implementation
// ========================

const pg = {
    async append(entry) {
        const { rows } = await db.query(
            `INSERT INTO activity_logs (action, portal_type, user_email, user_name, ip, details, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             RETURNING *`,
            [entry.action, entry.portal_type || entry.portalType || null,
             entry.user_email || entry.userEmail || null,
             entry.user_name || entry.userName || null,
             entry.ip || null,
             entry.details ? (typeof entry.details === 'string' ? entry.details : JSON.stringify(entry.details)) : null,
             entry.created_at || new Date().toISOString()]
        );
        return rows[0];
    },

    async query(filters = {}, pagination = {}) {
        const page = Math.max(1, parseInt(pagination.page) || 1);
        const pageSize = Math.min(200, Math.max(1, parseInt(pagination.pageSize) || 50));
        const offset = (page - 1) * pageSize;

        let sql = 'SELECT * FROM activity_logs WHERE 1=1';
        let countSql = 'SELECT COUNT(*) FROM activity_logs WHERE 1=1';
        const params = [];
        const countParams = [];
        let idx = 1;

        if (filters.action) {
            const clause = ` AND action = $${idx}`;
            sql += clause;
            countSql += clause;
            params.push(filters.action);
            countParams.push(filters.action);
            idx++;
        }
        if (filters.portal_type || filters.portalType) {
            const val = filters.portal_type || filters.portalType;
            const clause = ` AND portal_type = $${idx}`;
            sql += clause;
            countSql += clause;
            params.push(val);
            countParams.push(val);
            idx++;
        }
        if (filters.user_email || filters.userEmail) {
            const val = filters.user_email || filters.userEmail;
            const clause = ` AND user_email = $${idx}`;
            sql += clause;
            countSql += clause;
            params.push(val);
            countParams.push(val);
            idx++;
        }
        if (filters.dateFrom) {
            const clause = ` AND created_at >= $${idx}`;
            sql += clause;
            countSql += clause;
            params.push(filters.dateFrom);
            countParams.push(filters.dateFrom);
            idx++;
        }
        if (filters.dateTo) {
            const clause = ` AND created_at <= $${idx}`;
            sql += clause;
            countSql += clause;
            params.push(filters.dateTo);
            countParams.push(filters.dateTo);
            idx++;
        }

        sql += ` ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`;
        params.push(pageSize, offset);

        const [dataResult, countResult] = await Promise.all([
            db.query(sql, params),
            db.query(countSql, countParams),
        ]);

        const total = parseInt(countResult.rows[0].count);

        return {
            data: dataResult.rows,
            total,
            page,
            pageSize,
            totalPages: Math.ceil(total / pageSize),
        };
    },

    async summary(dateRange = {}) {
        let sql = 'SELECT action, COUNT(*) AS count FROM activity_logs WHERE 1=1';
        const params = [];
        let idx = 1;

        if (dateRange.dateFrom) {
            sql += ` AND created_at >= $${idx}`;
            params.push(dateRange.dateFrom);
            idx++;
        }
        if (dateRange.dateTo) {
            sql += ` AND created_at <= $${idx}`;
            params.push(dateRange.dateTo);
            idx++;
        }

        sql += ' GROUP BY action ORDER BY count DESC';
        const { rows } = await db.query(sql, params);

        const result = {};
        for (const row of rows) {
            result[row.action] = parseInt(row.count);
        }
        return result;
    },

    async clear() {
        await db.query('DELETE FROM activity_logs');
    },
};

// ========================
// JSON Implementation
// ========================

const json = {
    _readAll() {
        return readJSONArray(DATA_FILE);
    },

    _writeAll(logs) {
        writeJSON(DATA_FILE, logs);
    },

    append(entry) {
        const logs = this._readAll();
        const log = {
            ...entry,
            id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            created_at: entry.created_at || new Date().toISOString(),
        };
        logs.push(log);

        // Enforce 10K cap by trimming oldest entries
        if (logs.length > MAX_JSON_ENTRIES) {
            logs.splice(0, logs.length - MAX_JSON_ENTRIES);
        }

        this._writeAll(logs);
        return log;
    },

    query(filters = {}, pagination = {}) {
        let logs = this._readAll();

        // Apply filters
        if (filters.action) {
            logs = logs.filter(l => l.action === filters.action);
        }
        if (filters.portal_type || filters.portalType) {
            const val = filters.portal_type || filters.portalType;
            logs = logs.filter(l => (l.portal_type || l.portalType) === val);
        }
        if (filters.user_email || filters.userEmail) {
            const val = filters.user_email || filters.userEmail;
            logs = logs.filter(l => (l.user_email || l.userEmail) === val);
        }
        if (filters.dateFrom) {
            logs = logs.filter(l => (l.created_at || '') >= filters.dateFrom);
        }
        if (filters.dateTo) {
            logs = logs.filter(l => (l.created_at || '') <= filters.dateTo);
        }

        // Sort newest first
        logs.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

        // Pagination
        const page = Math.max(1, parseInt(pagination.page) || 1);
        const pageSize = Math.min(200, Math.max(1, parseInt(pagination.pageSize) || 50));
        const total = logs.length;
        const start = (page - 1) * pageSize;
        const data = logs.slice(start, start + pageSize);

        return {
            data,
            total,
            page,
            pageSize,
            totalPages: Math.ceil(total / pageSize),
        };
    },

    summary(dateRange = {}) {
        let logs = this._readAll();

        if (dateRange.dateFrom) {
            logs = logs.filter(l => (l.created_at || '') >= dateRange.dateFrom);
        }
        if (dateRange.dateTo) {
            logs = logs.filter(l => (l.created_at || '') <= dateRange.dateTo);
        }

        const result = {};
        for (const log of logs) {
            const action = log.action || 'unknown';
            result[action] = (result[action] || 0) + 1;
        }
        return result;
    },

    clear() {
        this._writeAll([]);
    },
};

// ========================
// Export the right implementation
// ========================

function getRepo() {
    return db.isDbConnected() ? pg : json;
}

module.exports = {
    append:  (...args) => getRepo().append(...args),
    query:   (...args) => getRepo().query(...args),
    summary: (...args) => getRepo().summary(...args),
    clear:   (...args) => getRepo().clear(...args),
};
