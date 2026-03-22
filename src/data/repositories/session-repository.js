/**
 * Session Repository — Abstracts session management over PostgreSQL or JSON.
 *
 * JSON mode: `sessions.json` flat file.
 * PG mode: `sessions` table.
 */

const path = require('path');
const db = require('../db');
const { readJSONArray, readJSON, writeJSON } = require('../json-store');
const { dataDir } = require('../../config');

const DATA_FILE = path.join(dataDir, 'sessions.json');

// ========================
// PostgreSQL Implementation
// ========================

const pg = {
    async create(token, sessionData) {
        const { rows } = await db.query(
            `INSERT INTO sessions (token, user_id, email, role, portal, name, user_data, created_at, expires_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             RETURNING *`,
            [token,
             sessionData.user_id || sessionData.userId || null,
             sessionData.email,
             sessionData.role || null,
             sessionData.portal || null,
             sessionData.name || null,
             sessionData.user_data ? JSON.stringify(sessionData.user_data) : (sessionData.userData ? JSON.stringify(sessionData.userData) : null),
             sessionData.created_at || new Date().toISOString(),
             sessionData.expires_at || sessionData.expiresAt]
        );
        return rows[0];
    },

    async validate(token) {
        const { rows } = await db.query(
            'SELECT * FROM sessions WHERE token = $1 AND expires_at > NOW()',
            [token]
        );
        if (rows.length === 0) return null;

        const session = rows[0];
        // Parse user_data if it's a string
        if (session.user_data && typeof session.user_data === 'string') {
            try { session.user_data = JSON.parse(session.user_data); } catch (e) { /* keep as string */ }
        }
        return session;
    },

    async destroy(token) {
        await db.query('DELETE FROM sessions WHERE token = $1', [token]);
    },

    async destroyByEmail(email) {
        await db.query('DELETE FROM sessions WHERE email = $1', [email]);
    },

    async cleanupExpired() {
        const { rowCount } = await db.query('DELETE FROM sessions WHERE expires_at <= NOW()');
        return rowCount;
    },

    async findAll() {
        const { rows } = await db.query(
            'SELECT * FROM sessions WHERE expires_at > NOW() ORDER BY created_at DESC'
        );
        return rows;
    },

    async count() {
        const { rows } = await db.query(
            'SELECT COUNT(*) FROM sessions WHERE expires_at > NOW()'
        );
        return parseInt(rows[0].count);
    },
};

// ========================
// JSON Implementation
// ========================

const json = {
    _readAll() {
        return readJSONArray(DATA_FILE);
    },

    _writeAll(sessions) {
        writeJSON(DATA_FILE, sessions);
    },

    _isExpired(session) {
        if (!session.expires_at && !session.expiresAt) return false;
        const expiresAt = new Date(session.expires_at || session.expiresAt);
        return expiresAt <= new Date();
    },

    create(token, sessionData) {
        const sessions = this._readAll();
        const session = {
            token,
            user_id: sessionData.user_id || sessionData.userId || null,
            email: sessionData.email,
            role: sessionData.role || null,
            portal: sessionData.portal || null,
            name: sessionData.name || null,
            user_data: sessionData.user_data || sessionData.userData || null,
            created_at: sessionData.created_at || new Date().toISOString(),
            expires_at: sessionData.expires_at || sessionData.expiresAt,
        };
        sessions.push(session);
        this._writeAll(sessions);
        return session;
    },

    validate(token) {
        const sessions = this._readAll();
        const session = sessions.find(s => s.token === token);
        if (!session) return null;
        if (this._isExpired(session)) return null;
        return session;
    },

    destroy(token) {
        const sessions = this._readAll();
        const filtered = sessions.filter(s => s.token !== token);
        this._writeAll(filtered);
    },

    destroyByEmail(email) {
        const sessions = this._readAll();
        const filtered = sessions.filter(s => s.email !== email);
        this._writeAll(filtered);
    },

    cleanupExpired() {
        const sessions = this._readAll();
        const active = sessions.filter(s => !this._isExpired(s));
        const removed = sessions.length - active.length;
        this._writeAll(active);
        return removed;
    },

    findAll() {
        const sessions = this._readAll();
        return sessions.filter(s => !this._isExpired(s));
    },

    count() {
        const sessions = this._readAll();
        return sessions.filter(s => !this._isExpired(s)).length;
    },
};

// ========================
// Export the right implementation
// ========================

function getRepo() {
    return db.isDbConnected() ? pg : json;
}

module.exports = {
    create:         (...args) => getRepo().create(...args),
    validate:       (...args) => getRepo().validate(...args),
    destroy:        (...args) => getRepo().destroy(...args),
    destroyByEmail: (...args) => getRepo().destroyByEmail(...args),
    cleanupExpired: (...args) => getRepo().cleanupExpired(...args),
    findAll:        (...args) => getRepo().findAll(...args),
    count:          (...args) => getRepo().count(...args),
};
