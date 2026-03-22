/**
 * CTO Repository — Abstracts Compensatory Time-Off CRUD over PostgreSQL or JSON.
 *
 * JSON mode: `cto-records.json` flat file.
 * PG mode: `cto_records` table.
 */

const path = require('path');
const db = require('../db');
const { readJSONArray, readJSON, writeJSON } = require('../json-store');
const { dataDir } = require('../../config');

const DATA_FILE = path.join(dataDir, 'cto-records.json');

// ========================
// PostgreSQL Implementation
// ========================

const pg = {
    async findByEmail(email) {
        const { rows } = await db.query(
            'SELECT * FROM cto_records WHERE email = $1 ORDER BY created_at DESC',
            [email]
        );
        return rows;
    },

    async getBalance(email) {
        const { rows } = await db.query(
            `SELECT
                COALESCE(SUM(CASE WHEN type = 'granted' THEN days ELSE 0 END), 0) -
                COALESCE(SUM(CASE WHEN type = 'used' THEN days ELSE 0 END), 0) AS balance
             FROM cto_records WHERE email = $1`,
            [email]
        );
        return parseFloat(rows[0].balance) || 0;
    },

    async create(data) {
        const { rows } = await db.query(
            `INSERT INTO cto_records (email, employee_name, type, days, reason,
             date_from, date_to, reference, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             RETURNING *`,
            [data.email, data.employee_name || data.employeeName || data.name,
             data.type || 'granted',
             data.days || data.days_granted || data.daysGranted || 0,
             data.reason || null,
             data.date_from || data.dateFrom || null,
             data.date_to || data.dateTo || null,
             data.reference || null,
             data.created_at || new Date().toISOString()]
        );
        return rows[0];
    },

    async update(id, data) {
        const allowed = ['type', 'days', 'reason', 'date_from', 'date_to', 'reference', 'employee_name'];
        const setClauses = [];
        const values = [];
        let idx = 1;

        for (const key of allowed) {
            if (data[key] !== undefined) {
                setClauses.push(`${key} = $${idx}`);
                values.push(data[key]);
                idx++;
            }
        }

        if (setClauses.length === 0) return null;

        setClauses.push('updated_at = NOW()');
        values.push(id);

        const { rows } = await db.query(
            `UPDATE cto_records SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
            values
        );
        return rows[0] || null;
    },

    async delete(id) {
        await db.query('DELETE FROM cto_records WHERE id = $1', [id]);
    },
};

// ========================
// JSON Implementation
// ========================

const json = {
    _readAll() {
        return readJSONArray(DATA_FILE);
    },

    _writeAll(records) {
        writeJSON(DATA_FILE, records);
    },

    findByEmail(email) {
        const records = this._readAll();
        return records.filter(r => r.email === email);
    },

    getBalance(email) {
        const records = this.findByEmail(email);
        let balance = 0;
        for (const r of records) {
            const days = parseFloat(r.days || r.days_granted || r.daysGranted || 0);
            if (r.type === 'granted') {
                balance += days;
            } else if (r.type === 'used') {
                balance -= days;
            }
        }
        return balance;
    },

    create(data) {
        const records = this._readAll();
        const record = {
            ...data,
            id: data.id || `cto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type: data.type || 'granted',
            created_at: data.created_at || new Date().toISOString(),
        };
        records.push(record);
        this._writeAll(records);
        return record;
    },

    update(id, data) {
        const records = this._readAll();
        const idx = records.findIndex(r => r.id === id);
        if (idx === -1) return null;

        records[idx] = { ...records[idx], ...data, updated_at: new Date().toISOString() };
        this._writeAll(records);
        return records[idx];
    },

    delete(id) {
        const records = this._readAll();
        const filtered = records.filter(r => r.id !== id);
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
    findByEmail: (...args) => getRepo().findByEmail(...args),
    getBalance:  (...args) => getRepo().getBalance(...args),
    create:      (...args) => getRepo().create(...args),
    update:      (...args) => getRepo().update(...args),
    delete:      (...args) => getRepo().delete(...args),
};
