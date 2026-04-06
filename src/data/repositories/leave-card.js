/**
 * LeaveCardRepository — single read/write path for leavecards.json.
 *
 * Usage (per-request):
 *   const repo = new LeaveCardRepository();
 *   const card = repo.findByEmail(email);   // lazy-loads file on first call
 *   card.vl -= 1;
 *   repo.save(card);                        // writes back atomically
 *
 * The repository holds a per-instance cache so repeated calls within the
 * same request do not re-read the file.  Create a new instance per request.
 */

const path = require('path');
const { ensureFile, readJSON, writeJSON } = require('../json-store');
const { dataDir } = require('../../config');

const FILE = path.join(dataDir, 'leavecards.json');

class LeaveCardRepository {
    constructor() {
        this._data = null; // loaded lazily on first access
    }

    // ── Private ──────────────────────────────────────────────────────────────

    _load() {
        if (this._data === null) {
            ensureFile(FILE);
            this._data = readJSON(FILE);
            if (!Array.isArray(this._data)) this._data = [];
        }
        return this._data;
    }

    _matchEmail(card, email) {
        const e = (email || '').toLowerCase();
        return (
            (card.email || '').toLowerCase() === e ||
            (card.employeeId || '').toLowerCase() === e
        );
    }

    _normName(s) {
        return (s || '').normalize('NFC').toUpperCase().replace(/\s+/g, ' ').trim();
    }

    // ── Read ─────────────────────────────────────────────────────────────────

    /** Return all leave cards (full dataset, lazily loaded). */
    findAll() {
        return this._load();
    }

    /**
     * Find the most relevant leave card for an employee.
     * Tries email → name → employeeNo in order.
     *
     * @param {string} email
     * @returns {object|null}
     */
    findByEmail(email) {
        const cards = this._load();
        const emailLc = (email || '').toLowerCase();

        // 1. Exact email / employeeId match (case-insensitive)
        let found = cards.filter(c =>
            (c.email || '').toLowerCase() === emailLc ||
            (c.employeeId || '').toLowerCase() === emailLc
        );
        if (found.length > 0) return this._latest(found);

        // 2. Normalized name match (for unlinked Excel-migrated cards)
        const normEmail = this._normName(email);
        found = cards.filter(c => this._normName(c.name) === normEmail);
        if (found.length > 0) return this._latest(found);

        // 3. Employee number match
        found = cards.filter(c => c.employeeNo && c.employeeNo === email);
        if (found.length > 0) return this._latest(found);

        return null;
    }

    /** Return all cards whose email or name matches any of the given values. */
    findManyByEmails(emails) {
        const set = new Set((emails || []).map(e => e.toLowerCase()));
        return this._load().filter(c =>
            set.has((c.email || '').toLowerCase()) ||
            set.has((c.employeeId || '').toLowerCase())
        );
    }

    // ── Write ─────────────────────────────────────────────────────────────────

    /**
     * Upsert a leave card.  Matches by email/employeeId; appends if not found.
     *
     * @param {object} card - The leave card object to persist.
     */
    save(card) {
        const cards = this._load();
        const idx = cards.findIndex(c => this._matchEmail(c, card.email || card.employeeId));
        card.updatedAt = new Date().toISOString();
        if (idx >= 0) {
            cards[idx] = card;
        } else {
            cards.push(card);
        }
        writeJSON(FILE, cards);
    }

    /**
     * Persist the full array (use when bulk-updating many cards at once).
     *
     * @param {Array} cards
     */
    saveAll(cards) {
        this._data = cards;
        writeJSON(FILE, cards);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /** Pick the most recently updated card from a set of duplicates. */
    _latest(records) {
        return records.reduce((best, c) => {
            const bt = new Date(best.updatedAt || best.createdAt || 0).getTime();
            const ct = new Date(c.updatedAt || c.createdAt || 0).getTime();
            return ct > bt ? c : best;
        });
    }
}

module.exports = LeaveCardRepository;
