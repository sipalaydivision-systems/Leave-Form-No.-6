/**
 * ApplicationRepository — single read/write path for applications.json.
 *
 * All status constants are exported so callers never hardcode strings.
 */

const path = require('path');
const { ensureFile, readJSONArray, writeJSON } = require('../json-store');
const { dataDir } = require('../../config');

const FILE = path.join(dataDir, 'applications.json');

// Status and approver constants — single definition for the whole codebase
const STATUS = Object.freeze({
    PENDING:  'pending',
    APPROVED: 'approved',
    REJECTED: 'rejected',
    RETURNED: 'returned',
    CANCELLED: 'cancelled',
});

const PORTAL = Object.freeze({
    AO:   'AO',
    HR:   'HR',
    ASDS: 'ASDS',
    SDS:  'SDS',
    IT:   'IT',
});

class ApplicationRepository {
    constructor() {
        this._data = null;
    }

    // ── Private ───────────────────────────────────────────────────────────────

    _load() {
        if (this._data === null) {
            ensureFile(FILE);
            this._data = readJSONArray(FILE);
        }
        return this._data;
    }

    _email(app) {
        return (app.employeeEmail || app.email || '').toLowerCase();
    }

    // ── Read ──────────────────────────────────────────────────────────────────

    findAll() { return this._load(); }

    findById(id) {
        return this._load().find(a => a.id === id) || null;
    }

    findByEmail(email) {
        const e = (email || '').toLowerCase();
        return this._load().filter(a => this._email(a) === e);
    }

    /**
     * Return applications visible to a given approver portal.
     * Mirrors the portal-filtering logic used across all approval dashboards.
     */
    findByPortal(portal) {
        const p = (portal || '').toUpperCase();
        return this._load().filter(app => {
            const currentApprover = (app.currentApprover || '').toUpperCase();
            const status          = (app.status || '').toLowerCase();
            const history         = app.approvalHistory || app.approval_history || [];

            const isCurrentApprover = currentApprover === p;
            const hasApproved  = history.some(h => (h.portal || '').toUpperCase() === p && h.action === STATUS.APPROVED);
            const hasRejected  = status === STATUS.REJECTED && history.some(h => (h.portal || '').toUpperCase() === p);
            const wasReturned  = status === STATUS.RETURNED && history.some(h => (h.portal || '').toUpperCase() === p);
            const hasHistory   = history.some(h => (h.portal || '').toUpperCase() === p);

            return isCurrentApprover || hasApproved || hasRejected || wasReturned || hasHistory;
        });
    }

    /** Pending / approved applications for an employee not yet reflected in their leave card. */
    findActiveByEmail(email) {
        const e = (email || '').toLowerCase();
        return this._load().filter(a =>
            this._email(a) === e &&
            (a.status === STATUS.PENDING || a.status === STATUS.APPROVED)
        );
    }

    // ── Write ─────────────────────────────────────────────────────────────────

    save(app) {
        const apps = this._load();
        const idx = apps.findIndex(a => a.id === app.id);
        app.updatedAt = new Date().toISOString();
        if (idx >= 0) {
            apps[idx] = app;
        } else {
            apps.push(app);
        }
        writeJSON(FILE, apps);
    }

    saveAll(apps) {
        this._data = apps;
        writeJSON(FILE, apps);
    }
}

module.exports = { ApplicationRepository, STATUS, PORTAL };
