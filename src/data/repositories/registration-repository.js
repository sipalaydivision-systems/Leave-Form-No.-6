/**
 * Registration Repository — Abstracts pending registration CRUD over PostgreSQL or JSON.
 *
 * JSON mode: `pending-registrations.json` flat file.
 * PG mode: `pending_registrations` table.
 */

const path = require('path');
const db = require('../db');
const { readJSONArray, readJSON, writeJSON } = require('../json-store');
const { dataDir } = require('../../config');

const DATA_FILE = path.join(dataDir, 'pending-registrations.json');

// ========================
// PostgreSQL Implementation
// ========================

const pg = {
    async findPending() {
        const { rows } = await db.query(
            "SELECT * FROM pending_registrations WHERE status = 'pending' ORDER BY created_at DESC"
        );
        return rows;
    },

    async findByEmail(email) {
        const { rows } = await db.query(
            'SELECT * FROM pending_registrations WHERE email = $1',
            [email]
        );
        return rows[0] || null;
    },

    async create(data) {
        const { rows } = await db.query(
            `INSERT INTO pending_registrations (email, password_hash, name, first_name, last_name,
             middle_name, suffix, office, position, salary_grade, step, salary,
             employee_number, district, school, status, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
             RETURNING *`,
            [data.email, data.password_hash || data.passwordHash || data.password,
             data.name || data.fullName,
             data.first_name || data.firstName,
             data.last_name || data.lastName,
             data.middle_name || data.middleName || null,
             data.suffix || null,
             data.office, data.position,
             data.salary_grade || data.salaryGrade || null,
             data.step || null,
             data.salary || null,
             data.employee_number || data.employeeNumber || data.employeeNo || null,
             data.district || null,
             data.school || null,
             data.status || 'pending',
             data.created_at || new Date().toISOString()]
        );
        return rows[0];
    },

    async approve(id, reviewerName) {
        const { rows } = await db.query(
            `UPDATE pending_registrations
             SET status = 'approved', reviewed_by = $2, reviewed_at = NOW(), updated_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [id, reviewerName]
        );
        return rows[0] || null;
    },

    async reject(id, reviewerName) {
        const { rows } = await db.query(
            `UPDATE pending_registrations
             SET status = 'rejected', reviewed_by = $2, reviewed_at = NOW(), updated_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [id, reviewerName]
        );
        return rows[0] || null;
    },

    async delete(id) {
        await db.query('DELETE FROM pending_registrations WHERE id = $1', [id]);
    },

    async findAll() {
        const { rows } = await db.query(
            'SELECT * FROM pending_registrations ORDER BY created_at DESC'
        );
        return rows;
    },
};

// ========================
// JSON Implementation
// ========================

const json = {
    _readAll() {
        return readJSONArray(DATA_FILE);
    },

    _writeAll(regs) {
        writeJSON(DATA_FILE, regs);
    },

    findPending() {
        const regs = this._readAll();
        return regs.filter(r => r.status === 'pending' || !r.status);
    },

    findByEmail(email) {
        const regs = this._readAll();
        return regs.find(r => r.email === email) || null;
    },

    create(data) {
        const regs = this._readAll();
        const reg = {
            ...data,
            id: data.id || `reg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            status: data.status || 'pending',
            created_at: data.created_at || new Date().toISOString(),
        };
        regs.push(reg);
        this._writeAll(regs);
        return reg;
    },

    approve(id, reviewerName) {
        const regs = this._readAll();
        const idx = regs.findIndex(r => r.id === id || r.email === id);
        if (idx === -1) return null;

        regs[idx] = {
            ...regs[idx],
            status: 'approved',
            reviewed_by: reviewerName,
            reviewed_at: new Date().toISOString(),
        };
        this._writeAll(regs);
        return regs[idx];
    },

    reject(id, reviewerName) {
        const regs = this._readAll();
        const idx = regs.findIndex(r => r.id === id || r.email === id);
        if (idx === -1) return null;

        regs[idx] = {
            ...regs[idx],
            status: 'rejected',
            reviewed_by: reviewerName,
            reviewed_at: new Date().toISOString(),
        };
        this._writeAll(regs);
        return regs[idx];
    },

    delete(id) {
        const regs = this._readAll();
        const filtered = regs.filter(r => r.id !== id && r.email !== id);
        this._writeAll(filtered);
    },

    findAll() {
        return this._readAll();
    },
};

// ========================
// Export the right implementation
// ========================

function getRepo() {
    return db.isDbConnected() ? pg : json;
}

module.exports = {
    findPending: (...args) => getRepo().findPending(...args),
    findByEmail: (...args) => getRepo().findByEmail(...args),
    create:      (...args) => getRepo().create(...args),
    approve:     (...args) => getRepo().approve(...args),
    reject:      (...args) => getRepo().reject(...args),
    delete:      (...args) => getRepo().delete(...args),
    findAll:     (...args) => getRepo().findAll(...args),
};
