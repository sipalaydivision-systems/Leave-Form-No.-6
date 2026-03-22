/**
 * Application Repository — Abstracts leave application CRUD over PostgreSQL or JSON.
 *
 * JSON mode: `applications.json` flat file.
 * PG mode: `applications` table.
 */

const path = require('path');
const db = require('../db');
const { readJSONArray, readJSON, writeJSON } = require('../json-store');
const { dataDir } = require('../../config');

const DATA_FILE = path.join(dataDir, 'applications.json');

// Portal name -> approver role mapping for findPending
const PORTAL_APPROVER_MAP = {
    ao: 'ao',
    hr: 'hr',
    asds: 'asds',
    sds: 'sds',
};

// ========================
// PostgreSQL Implementation
// ========================

const pg = {
    async findById(id) {
        const { rows } = await db.query('SELECT * FROM applications WHERE id = $1', [id]);
        return rows[0] || null;
    },

    async findByEmail(email) {
        const { rows } = await db.query(
            'SELECT * FROM applications WHERE email = $1 ORDER BY created_at DESC',
            [email]
        );
        return rows;
    },

    async findByStatus(status, approver) {
        let sql = 'SELECT * FROM applications WHERE 1=1';
        const params = [];
        let idx = 1;

        if (status) {
            sql += ` AND status = $${idx}`;
            params.push(status);
            idx++;
        }
        if (approver) {
            sql += ` AND current_approver = $${idx}`;
            params.push(approver);
            idx++;
        }

        sql += ' ORDER BY created_at DESC';
        const { rows } = await db.query(sql, params);
        return rows;
    },

    async findPending(portal) {
        const approver = PORTAL_APPROVER_MAP[portal] || portal;
        const { rows } = await db.query(
            `SELECT * FROM applications
             WHERE status = 'pending' AND current_approver = $1
             ORDER BY created_at DESC`,
            [approver]
        );
        return rows;
    },

    async findApproved(portal) {
        const approver = PORTAL_APPROVER_MAP[portal] || portal;
        const { rows } = await db.query(
            `SELECT * FROM applications
             WHERE status = 'approved'
               AND (approved_by_chain @> $1::jsonb OR current_approver = $2)
             ORDER BY created_at DESC`,
            [JSON.stringify([approver]), approver]
        );
        // Fallback: if jsonb column doesn't exist, use simpler query
        return rows;
    },

    async findAll() {
        const { rows } = await db.query('SELECT * FROM applications ORDER BY created_at DESC');
        return rows;
    },

    async create(data) {
        const { rows } = await db.query(
            `INSERT INTO applications (id, email, employee_name, office, position,
             leave_type, leave_details, days_applied, inclusive_dates, date_from, date_to,
             commutation, status, current_approver, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
             RETURNING *`,
            [data.id, data.email, data.employee_name || data.employeeName || data.name,
             data.office, data.position,
             data.leave_type || data.leaveType,
             data.leave_details || data.leaveDetails || null,
             data.days_applied || data.daysApplied || data.numberOfDays || 0,
             data.inclusive_dates || data.inclusiveDates || null,
             data.date_from || data.dateFrom || null,
             data.date_to || data.dateTo || null,
             data.commutation || null,
             data.status || 'pending',
             data.current_approver || data.currentApprover || 'ao',
             data.created_at || new Date().toISOString()]
        );
        return rows[0];
    },

    async updateStatus(id, updates) {
        const allowed = [
            'status', 'current_approver', 'ao_approved_at', 'ao_signature',
            'hr_approved_at', 'hr_signature', 'hr_certified_at', 'hr_certification',
            'asds_approved_at', 'asds_signature', 'sds_approved_at', 'sds_signature',
            'disapproved_at', 'disapproved_by', 'disapproval_reason',
            'approved_by_chain', 'completed_at', 'cancelled_at', 'cancel_reason'
        ];
        const setClauses = [];
        const values = [];
        let idx = 1;

        for (const key of allowed) {
            if (updates[key] !== undefined) {
                setClauses.push(`${key} = $${idx}`);
                values.push(typeof updates[key] === 'object' && !Array.isArray(updates[key]) && updates[key] !== null
                    ? JSON.stringify(updates[key])
                    : updates[key]);
                idx++;
            }
        }

        if (setClauses.length === 0) return null;

        setClauses.push('updated_at = NOW()');
        values.push(id);

        const { rows } = await db.query(
            `UPDATE applications SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
            values
        );
        return rows[0] || null;
    },

    async count(filters = {}) {
        let sql = 'SELECT COUNT(*) FROM applications WHERE 1=1';
        const params = [];
        let idx = 1;

        if (filters.status) {
            sql += ` AND status = $${idx}`;
            params.push(filters.status);
            idx++;
        }
        if (filters.approver) {
            sql += ` AND current_approver = $${idx}`;
            params.push(filters.approver);
            idx++;
        }
        if (filters.email) {
            sql += ` AND email = $${idx}`;
            params.push(filters.email);
            idx++;
        }

        const { rows } = await db.query(sql, params);
        return parseInt(rows[0].count);
    },

    async delete(id) {
        await db.query('DELETE FROM applications WHERE id = $1', [id]);
    },
};

// ========================
// JSON Implementation
// ========================

const json = {
    _readAll() {
        return readJSONArray(DATA_FILE);
    },

    _writeAll(apps) {
        writeJSON(DATA_FILE, apps);
    },

    findById(id) {
        const apps = this._readAll();
        return apps.find(a => a.id === id) || null;
    },

    findByEmail(email) {
        const apps = this._readAll();
        return apps.filter(a => a.email === email);
    },

    findByStatus(status, approver) {
        let apps = this._readAll();
        if (status) apps = apps.filter(a => a.status === status);
        if (approver) apps = apps.filter(a => a.current_approver === approver || a.currentApprover === approver);
        return apps;
    },

    findPending(portal) {
        const approver = PORTAL_APPROVER_MAP[portal] || portal;
        const apps = this._readAll();
        return apps.filter(a =>
            a.status === 'pending' &&
            (a.current_approver === approver || a.currentApprover === approver)
        );
    },

    findApproved(portal) {
        const approver = PORTAL_APPROVER_MAP[portal] || portal;
        const apps = this._readAll();
        return apps.filter(a => {
            if (a.status !== 'approved') return false;
            // Check if this portal was in the approval chain
            const chain = a.approved_by_chain || a.approvedByChain || [];
            if (Array.isArray(chain) && chain.includes(approver)) return true;
            if (a.current_approver === approver || a.currentApprover === approver) return true;
            return false;
        });
    },

    findAll() {
        return this._readAll();
    },

    create(data) {
        const apps = this._readAll();
        const app = {
            ...data,
            status: data.status || 'pending',
            current_approver: data.current_approver || data.currentApprover || 'ao',
            created_at: data.created_at || new Date().toISOString(),
        };
        apps.push(app);
        this._writeAll(apps);
        return app;
    },

    updateStatus(id, updates) {
        const apps = this._readAll();
        const idx = apps.findIndex(a => a.id === id);
        if (idx === -1) return null;

        apps[idx] = { ...apps[idx], ...updates, updated_at: new Date().toISOString() };
        this._writeAll(apps);
        return apps[idx];
    },

    count(filters = {}) {
        let apps = this._readAll();
        if (filters.status) apps = apps.filter(a => a.status === filters.status);
        if (filters.approver) apps = apps.filter(a =>
            a.current_approver === filters.approver || a.currentApprover === filters.approver
        );
        if (filters.email) apps = apps.filter(a => a.email === filters.email);
        return apps.length;
    },

    delete(id) {
        const apps = this._readAll();
        const filtered = apps.filter(a => a.id !== id);
        this._writeAll(filtered);
    },
};

// ========================
// Export the right implementation
// ========================

function getRepo() {
    return db.isDbConnected() ? pg : json;
}

module.exports = {
    findById:     (...args) => getRepo().findById(...args),
    findByEmail:  (...args) => getRepo().findByEmail(...args),
    findByStatus: (...args) => getRepo().findByStatus(...args),
    findPending:  (...args) => getRepo().findPending(...args),
    findApproved: (...args) => getRepo().findApproved(...args),
    findAll:      (...args) => getRepo().findAll(...args),
    create:       (...args) => getRepo().create(...args),
    updateStatus: (...args) => getRepo().updateStatus(...args),
    count:        (...args) => getRepo().count(...args),
    delete:       (...args) => getRepo().delete(...args),
};
