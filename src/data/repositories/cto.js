/**
 * CtoRepository — single read/write path for cto-records.json.
 */

const path = require('path');
const { ensureFile, readJSON, writeJSON } = require('../json-store');
const { dataDir } = require('../../config');

const FILE = path.join(dataDir, 'cto-records.json');

class CtoRepository {
    constructor() {
        this._data = null;
    }

    _load() {
        if (this._data === null) {
            ensureFile(FILE);
            this._data = readJSON(FILE);
            if (!Array.isArray(this._data)) this._data = [];
        }
        return this._data;
    }

    findAll() { return this._load(); }

    findByEmployee(email) {
        const e = (email || '').toLowerCase();
        return this._load().filter(r =>
            (r.employeeId || '').toLowerCase() === e ||
            (r.email || '').toLowerCase() === e
        );
    }

    findById(id) {
        return this._load().find(r => r.id === id) || null;
    }

    /**
     * Compute the live CTO balance for an employee from the raw records.
     * Does NOT subtract pending applications — call LeaveBalanceService for that.
     *
     * @param {string} email
     * @returns {number}
     */
    rawBalanceFor(email) {
        return this.findByEmployee(email).reduce(
            (sum, r) => sum + Math.max(0, parseFloat(r.daysGranted || 0) - parseFloat(r.daysUsed || 0)),
            0
        );
    }

    save(record) {
        const records = this._load();
        const idx = records.findIndex(r => r.id === record.id);
        record.updatedAt = new Date().toISOString();
        if (idx >= 0) {
            records[idx] = record;
        } else {
            records.push(record);
        }
        writeJSON(FILE, records);
    }

    saveAll(records) {
        this._data = records;
        writeJSON(FILE, records);
    }

    delete(id) {
        const records = this._load();
        const filtered = records.filter(r => r.id !== id);
        this._data = filtered;
        writeJSON(FILE, filtered);
    }
}

module.exports = CtoRepository;
