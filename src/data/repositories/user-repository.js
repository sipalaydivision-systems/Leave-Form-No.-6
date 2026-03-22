/**
 * User Repository — Abstracts user CRUD over PostgreSQL or JSON.
 *
 * Consolidates the 6 separate JSON user files (users.json, ao-users.json,
 * hr-users.json, asds-users.json, sds-users.json, it-users.json) into
 * a single `users` table with a `role` column.
 */

const path = require('path');
const db = require('../db');
const { readJSONArray, writeJSON } = require('../json-store');
const { dataDir } = require('../../config');

// Map role -> JSON file
const ROLE_FILES = {
    user: 'users.json',
    ao:   'ao-users.json',
    hr:   'hr-users.json',
    asds: 'asds-users.json',
    sds:  'sds-users.json',
    it:   'it-users.json',
};

function getFilePath(role) {
    const file = ROLE_FILES[role];
    if (!file) throw new Error(`Unknown role: ${role}`);
    return path.join(dataDir, file);
}

// ========================
// PostgreSQL Implementation
// ========================

const pg = {
    async findByEmail(email) {
        const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email]);
        return rows[0] || null;
    },

    async findByEmailAndRole(email, role) {
        const { rows } = await db.query(
            'SELECT * FROM users WHERE email = $1 AND role = $2',
            [email, role]
        );
        return rows[0] || null;
    },

    async findByRole(role) {
        const { rows } = await db.query(
            'SELECT * FROM users WHERE role = $1 ORDER BY name',
            [role]
        );
        return rows;
    },

    async findAll() {
        const { rows } = await db.query('SELECT * FROM users ORDER BY role, name');
        return rows;
    },

    async create(data) {
        const { rows } = await db.query(
            `INSERT INTO users (email, password_hash, name, first_name, last_name, middle_name, suffix,
             role, office, position, salary_grade, step, salary, employee_number, pin_hash, district, school)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
             RETURNING *`,
            [data.email, data.password_hash || data.passwordHash || data.password,
             data.name || data.fullName, data.first_name || data.firstName,
             data.last_name || data.lastName, data.middle_name || data.middleName,
             data.suffix, data.role, data.office, data.position,
             data.salary_grade || data.salaryGrade, data.step,
             data.salary, data.employee_number || data.employeeNumber || data.employeeNo,
             data.pin_hash || data.pinHash, data.district, data.school]
        );
        return rows[0];
    },

    async update(id, data) {
        const fields = [];
        const values = [];
        let idx = 1;

        const allowed = ['name', 'first_name', 'last_name', 'middle_name', 'suffix',
            'office', 'position', 'salary_grade', 'step', 'salary', 'employee_number',
            'password_hash', 'pin_hash', 'district', 'school'];

        for (const key of allowed) {
            if (data[key] !== undefined) {
                fields.push(`${key} = $${idx}`);
                values.push(data[key]);
                idx++;
            }
        }

        if (fields.length === 0) return null;

        fields.push(`updated_at = NOW()`);
        values.push(id);

        const { rows } = await db.query(
            `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
            values
        );
        return rows[0] || null;
    },

    async delete(id) {
        await db.query('DELETE FROM users WHERE id = $1', [id]);
    },

    async deleteByEmail(email, role) {
        if (role) {
            await db.query('DELETE FROM users WHERE email = $1 AND role = $2', [email, role]);
        } else {
            await db.query('DELETE FROM users WHERE email = $1', [email]);
        }
    },

    async count(role) {
        const q = role
            ? await db.query('SELECT COUNT(*) FROM users WHERE role = $1', [role])
            : await db.query('SELECT COUNT(*) FROM users');
        return parseInt(q.rows[0].count);
    },

    async search(query, role) {
        const q = query.toLowerCase();
        let sql = 'SELECT * FROM users WHERE (LOWER(name) LIKE $1 OR LOWER(email) LIKE $1)';
        const params = [`%${q}%`];
        if (role) {
            sql += ' AND role = $2';
            params.push(role);
        }
        sql += ' ORDER BY name LIMIT 50';
        const { rows } = await db.query(sql, params);
        return rows;
    },
};

// ========================
// JSON Implementation
// ========================

const json = {
    findByEmail(email) {
        for (const role of Object.keys(ROLE_FILES)) {
            const users = readJSONArray(getFilePath(role));
            const user = users.find(u => u.email === email);
            if (user) return { ...user, role };
        }
        return null;
    },

    findByEmailAndRole(email, role) {
        const users = readJSONArray(getFilePath(role));
        const user = users.find(u => u.email === email);
        return user ? { ...user, role } : null;
    },

    findByRole(role) {
        return readJSONArray(getFilePath(role)).map(u => ({ ...u, role }));
    },

    findAll() {
        const all = [];
        for (const role of Object.keys(ROLE_FILES)) {
            const users = readJSONArray(getFilePath(role));
            all.push(...users.map(u => ({ ...u, role })));
        }
        return all;
    },

    create(data) {
        const role = data.role;
        const users = readJSONArray(getFilePath(role));
        users.push(data);
        writeJSON(getFilePath(role), users);
        return data;
    },

    update(id, data) {
        // id here is email for JSON mode
        for (const role of Object.keys(ROLE_FILES)) {
            const fp = getFilePath(role);
            const users = readJSONArray(fp);
            const idx = users.findIndex(u => u.email === id || u.id === id);
            if (idx !== -1) {
                users[idx] = { ...users[idx], ...data };
                writeJSON(fp, users);
                return users[idx];
            }
        }
        return null;
    },

    delete(id) {
        for (const role of Object.keys(ROLE_FILES)) {
            const fp = getFilePath(role);
            const users = readJSONArray(fp);
            const filtered = users.filter(u => u.email !== id && u.id !== id);
            if (filtered.length < users.length) {
                writeJSON(fp, filtered);
                return;
            }
        }
    },

    deleteByEmail(email, role) {
        if (role) {
            const fp = getFilePath(role);
            const users = readJSONArray(fp);
            writeJSON(fp, users.filter(u => u.email !== email));
        } else {
            this.delete(email);
        }
    },

    count(role) {
        if (role) return readJSONArray(getFilePath(role)).length;
        let total = 0;
        for (const r of Object.keys(ROLE_FILES)) {
            total += readJSONArray(getFilePath(r)).length;
        }
        return total;
    },

    search(query, role) {
        const q = query.toLowerCase();
        const source = role ? this.findByRole(role) : this.findAll();
        return source.filter(u =>
            (u.name || u.fullName || '').toLowerCase().includes(q) ||
            (u.email || '').toLowerCase().includes(q)
        ).slice(0, 50);
    },
};

// ========================
// Export the right implementation
// ========================

function getRepo() {
    return db.isDbConnected() ? pg : json;
}

module.exports = {
    findByEmail:        (...args) => getRepo().findByEmail(...args),
    findByEmailAndRole: (...args) => getRepo().findByEmailAndRole(...args),
    findByRole:         (...args) => getRepo().findByRole(...args),
    findAll:            (...args) => getRepo().findAll(...args),
    create:             (...args) => getRepo().create(...args),
    update:             (...args) => getRepo().update(...args),
    delete:             (...args) => getRepo().delete(...args),
    deleteByEmail:      (...args) => getRepo().deleteByEmail(...args),
    count:              (...args) => getRepo().count(...args),
    search:             (...args) => getRepo().search(...args),
};
