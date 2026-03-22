/**
 * School Repository — Abstracts school data CRUD over PostgreSQL or JSON.
 *
 * JSON mode: `schools.json` flat file.
 * PG mode: `schools` table.
 */

const path = require('path');
const db = require('../db');
const { readJSONArray, readJSON, writeJSON } = require('../json-store');
const { dataDir } = require('../../config');

const DATA_FILE = path.join(dataDir, 'schools.json');

// ========================
// PostgreSQL Implementation
// ========================

const pg = {
    async findAll() {
        const { rows } = await db.query('SELECT * FROM schools ORDER BY name');
        return rows;
    },

    async findByDistrict(districtId) {
        const { rows } = await db.query(
            'SELECT * FROM schools WHERE district_id = $1 ORDER BY name',
            [districtId]
        );
        return rows;
    },

    async findById(id) {
        const { rows } = await db.query('SELECT * FROM schools WHERE id = $1', [id]);
        return rows[0] || null;
    },
};

// ========================
// JSON Implementation
// ========================

const json = {
    _readAll() {
        return readJSONArray(DATA_FILE);
    },

    findAll() {
        return this._readAll();
    },

    findByDistrict(districtId) {
        const schools = this._readAll();
        return schools.filter(s =>
            s.district_id === districtId ||
            s.districtId === districtId ||
            s.district === districtId
        );
    },

    findById(id) {
        const schools = this._readAll();
        return schools.find(s => s.id === id) || null;
    },
};

// ========================
// Export the right implementation
// ========================

function getRepo() {
    return db.isDbConnected() ? pg : json;
}

module.exports = {
    findAll:        (...args) => getRepo().findAll(...args),
    findByDistrict: (...args) => getRepo().findByDistrict(...args),
    findById:       (...args) => getRepo().findById(...args),
};
