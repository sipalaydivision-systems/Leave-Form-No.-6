/**
 * Leave Card Repository — Abstracts leave card CRUD over PostgreSQL or JSON.
 *
 * JSON mode: single `leavecards.json` file with nested transactions[] and leaveUsageHistory[].
 * PG mode: `leave_cards` table + `leave_transactions` and `leave_usage_history` linked by leave_card_id.
 */

const path = require('path');
const db = require('../db');
const { readJSONArray, readJSON, writeJSON } = require('../json-store');
const { dataDir } = require('../../config');

const DATA_FILE = path.join(dataDir, 'leavecards.json');

// ========================
// PostgreSQL Implementation
// ========================

const pg = {
    async findByEmail(email) {
        const { rows } = await db.query('SELECT * FROM leave_cards WHERE email = $1', [email]);
        return rows[0] || null;
    },

    async create(data) {
        const { rows } = await db.query(
            `INSERT INTO leave_cards (email, employee_name, office, position,
             vl_earned, vl_used, vl_balance, vl_abs_wo_pay, vl_undertime,
             sl_earned, sl_used, sl_balance, sl_abs_wo_pay, sl_undertime,
             date_first_employed, as_of_date)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
             RETURNING *`,
            [data.email, data.employee_name || data.employeeName || data.name,
             data.office, data.position,
             data.vl_earned || data.vlEarned || 0,
             data.vl_used || data.vlUsed || 0,
             data.vl_balance || data.vlBalance || 0,
             data.vl_abs_wo_pay || data.vlAbsWoPay || 0,
             data.vl_undertime || data.vlUndertime || 0,
             data.sl_earned || data.slEarned || 0,
             data.sl_used || data.slUsed || 0,
             data.sl_balance || data.slBalance || 0,
             data.sl_abs_wo_pay || data.slAbsWoPay || 0,
             data.sl_undertime || data.slUndertime || 0,
             data.date_first_employed || data.dateFirstEmployed || null,
             data.as_of_date || data.asOfDate || null]
        );
        return rows[0];
    },

    async updateBalance(email, fields) {
        const allowed = [
            'vl_earned', 'vl_used', 'vl_balance', 'vl_abs_wo_pay', 'vl_undertime',
            'sl_earned', 'sl_used', 'sl_balance', 'sl_abs_wo_pay', 'sl_undertime',
            'employee_name', 'office', 'position', 'date_first_employed', 'as_of_date'
        ];
        const setClauses = [];
        const values = [];
        let idx = 1;

        for (const key of allowed) {
            if (fields[key] !== undefined) {
                setClauses.push(`${key} = $${idx}`);
                values.push(fields[key]);
                idx++;
            }
        }

        if (setClauses.length === 0) return null;

        setClauses.push('updated_at = NOW()');
        values.push(email);

        const { rows } = await db.query(
            `UPDATE leave_cards SET ${setClauses.join(', ')} WHERE email = $${idx} RETURNING *`,
            values
        );
        return rows[0] || null;
    },

    async addTransaction(email, txn) {
        // First get the leave_card_id
        const card = await this.findByEmail(email);
        if (!card) throw new Error(`Leave card not found for email: ${email}`);

        const { rows } = await db.query(
            `INSERT INTO leave_transactions (leave_card_id, period, particular,
             vl_earned, vl_abs_wo_pay, vl_balance, vl_abs_undertime,
             sl_earned, sl_abs_wo_pay, sl_balance, sl_abs_undertime,
             date_of_action, remarks, transaction_type, transaction_date)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
             RETURNING *`,
            [card.id, txn.period, txn.particular,
             txn.vl_earned || txn.vlEarned || 0,
             txn.vl_abs_wo_pay || txn.vlAbsWoPay || 0,
             txn.vl_balance || txn.vlBalance || 0,
             txn.vl_abs_undertime || txn.vlAbsUndertime || 0,
             txn.sl_earned || txn.slEarned || 0,
             txn.sl_abs_wo_pay || txn.slAbsWoPay || 0,
             txn.sl_balance || txn.slBalance || 0,
             txn.sl_abs_undertime || txn.slAbsUndertime || 0,
             txn.date_of_action || txn.dateOfAction || null,
             txn.remarks || null,
             txn.transaction_type || txn.transactionType || 'manual',
             txn.transaction_date || txn.transactionDate || new Date().toISOString()]
        );
        return rows[0];
    },

    async getTransactions(email) {
        const card = await this.findByEmail(email);
        if (!card) return [];

        const { rows } = await db.query(
            'SELECT * FROM leave_transactions WHERE leave_card_id = $1 ORDER BY transaction_date, id',
            [card.id]
        );
        return rows;
    },

    async addUsageHistory(email, usage) {
        const card = await this.findByEmail(email);
        if (!card) throw new Error(`Leave card not found for email: ${email}`);

        const { rows } = await db.query(
            `INSERT INTO leave_usage_history (leave_card_id, leave_type, days_used,
             date_from, date_to, application_id, approved_by, approved_date, remarks)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             RETURNING *`,
            [card.id, usage.leave_type || usage.leaveType,
             usage.days_used || usage.daysUsed,
             usage.date_from || usage.dateFrom,
             usage.date_to || usage.dateTo,
             usage.application_id || usage.applicationId || null,
             usage.approved_by || usage.approvedBy || null,
             usage.approved_date || usage.approvedDate || null,
             usage.remarks || null]
        );
        return rows[0];
    },

    async getUsageHistory(email) {
        const card = await this.findByEmail(email);
        if (!card) return [];

        const { rows } = await db.query(
            'SELECT * FROM leave_usage_history WHERE leave_card_id = $1 ORDER BY created_at DESC',
            [card.id]
        );
        return rows;
    },

    async findAll() {
        const { rows } = await db.query('SELECT * FROM leave_cards ORDER BY employee_name');
        return rows;
    },

    async delete(email) {
        // Cascading delete handled by FK constraints, but be explicit
        const card = await this.findByEmail(email);
        if (card) {
            await db.query('DELETE FROM leave_usage_history WHERE leave_card_id = $1', [card.id]);
            await db.query('DELETE FROM leave_transactions WHERE leave_card_id = $1', [card.id]);
            await db.query('DELETE FROM leave_cards WHERE id = $1', [card.id]);
        }
    },
};

// ========================
// JSON Implementation
// ========================

const json = {
    _readAll() {
        return readJSONArray(DATA_FILE);
    },

    _writeAll(cards) {
        writeJSON(DATA_FILE, cards);
    },

    findByEmail(email) {
        const cards = this._readAll();
        return cards.find(c => c.email === email) || null;
    },

    create(data) {
        const cards = this._readAll();
        const card = {
            ...data,
            transactions: data.transactions || [],
            leaveUsageHistory: data.leaveUsageHistory || [],
            created_at: data.created_at || new Date().toISOString(),
        };
        cards.push(card);
        this._writeAll(cards);
        return card;
    },

    updateBalance(email, fields) {
        const cards = this._readAll();
        const idx = cards.findIndex(c => c.email === email);
        if (idx === -1) return null;

        cards[idx] = { ...cards[idx], ...fields, updated_at: new Date().toISOString() };
        this._writeAll(cards);
        return cards[idx];
    },

    addTransaction(email, txn) {
        const cards = this._readAll();
        const idx = cards.findIndex(c => c.email === email);
        if (idx === -1) throw new Error(`Leave card not found for email: ${email}`);

        if (!cards[idx].transactions) cards[idx].transactions = [];
        const entry = {
            ...txn,
            transaction_date: txn.transaction_date || txn.transactionDate || new Date().toISOString(),
        };
        cards[idx].transactions.push(entry);
        this._writeAll(cards);
        return entry;
    },

    getTransactions(email) {
        const card = this.findByEmail(email);
        if (!card) return [];
        return card.transactions || [];
    },

    addUsageHistory(email, usage) {
        const cards = this._readAll();
        const idx = cards.findIndex(c => c.email === email);
        if (idx === -1) throw new Error(`Leave card not found for email: ${email}`);

        if (!cards[idx].leaveUsageHistory) cards[idx].leaveUsageHistory = [];
        const entry = {
            ...usage,
            created_at: new Date().toISOString(),
        };
        cards[idx].leaveUsageHistory.push(entry);
        this._writeAll(cards);
        return entry;
    },

    getUsageHistory(email) {
        const card = this.findByEmail(email);
        if (!card) return [];
        return card.leaveUsageHistory || [];
    },

    findAll() {
        return this._readAll();
    },

    delete(email) {
        const cards = this._readAll();
        const filtered = cards.filter(c => c.email !== email);
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
    findByEmail:      (...args) => getRepo().findByEmail(...args),
    create:           (...args) => getRepo().create(...args),
    updateBalance:    (...args) => getRepo().updateBalance(...args),
    addTransaction:   (...args) => getRepo().addTransaction(...args),
    getTransactions:  (...args) => getRepo().getTransactions(...args),
    addUsageHistory:  (...args) => getRepo().addUsageHistory(...args),
    getUsageHistory:  (...args) => getRepo().getUsageHistory(...args),
    findAll:          (...args) => getRepo().findAll(...args),
    delete:           (...args) => getRepo().delete(...args),
};
