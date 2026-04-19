/**
 * Database Adapter — Switches between JSON and PostgreSQL
 *
 * Usage: Set DATABASE_URL env var to use PostgreSQL
 * If DATABASE_URL is not set, falls back to JSON file I/O
 */

const fs = require('fs');
const path = require('path');
const Pool = require('pg').Pool;

const DATABASE_URL = process.env.DATABASE_URL;
const isDbConnected = !!DATABASE_URL;

let pool = null;

if (isDbConnected) {
    pool = new Pool({ connectionString: DATABASE_URL });
    console.log('[DATABASE] PostgreSQL mode enabled');
} else {
    console.log('[DATABASE] JSON file mode enabled (DATABASE_URL not set)');
}

/**
 * Read/Write adapter that works with both JSON and PostgreSQL
 */
class DatabaseAdapter {
    /**
     * Get a single user by email across all portal tables
     */
    static async getUserByEmail(email, portalTable = null) {
        if (!isDbConnected) {
            const dataDir = path.join(__dirname, '..', 'data');
            const getFile = (table) => {
                const files = {
                    users: path.join(dataDir, 'users.json'),
                    hr_users: path.join(dataDir, 'hr-users.json'),
                    aov_users: path.join(dataDir, 'aov-users.json'),
                    asds_users: path.join(dataDir, 'asds-users.json'),
                    sds_users: path.join(dataDir, 'sds-users.json'),
                    it_users: path.join(dataDir, 'it-users.json'),
                };
                return files[table] || null;
            };

            if (portalTable) {
                const file = getFile(portalTable);
                if (!file) return null;
                try {
                    const users = JSON.parse(fs.readFileSync(file, 'utf8'));
                    return users.find(u => (u.email || '').toLowerCase() === email.toLowerCase()) || null;
                } catch (e) {
                    return null;
                }
            }
            return null;
        }

        // PostgreSQL mode
        try {
            const result = await pool.query(
                `SELECT * FROM ${portalTable} WHERE LOWER(email) = LOWER($1) LIMIT 1`,
                [email]
            );
            return result.rows[0] || null;
        } catch (err) {
            console.error(`[DB] Error querying ${portalTable}:`, err.message);
            return null;
        }
    }

    /**
     * Get all users from a table
     */
    static async getUsersFromTable(tableName) {
        if (!isDbConnected) {
            const dataDir = path.join(__dirname, '..', 'data');
            const files = {
                users: path.join(dataDir, 'users.json'),
                hr_users: path.join(dataDir, 'hr-users.json'),
                aov_users: path.join(dataDir, 'aov-users.json'),
                asds_users: path.join(dataDir, 'asds-users.json'),
                sds_users: path.join(dataDir, 'sds-users.json'),
                it_users: path.join(dataDir, 'it-users.json'),
            };

            const file = files[tableName];
            try {
                return JSON.parse(fs.readFileSync(file, 'utf8'));
            } catch (e) {
                return [];
            }
        }

        // PostgreSQL mode
        try {
            const result = await pool.query(`SELECT * FROM ${tableName}`);
            return result.rows;
        } catch (err) {
            console.error(`[DB] Error querying ${tableName}:`, err.message);
            return [];
        }
    }

    /**
     * Insert user into table
     */
    static async insertUser(tableName, userData) {
        if (!isDbConnected) {
            const dataDir = path.join(__dirname, '..', 'data');
            const files = {
                users: path.join(dataDir, 'users.json'),
                hr_users: path.join(dataDir, 'hr-users.json'),
                aov_users: path.join(dataDir, 'aov-users.json'),
                asds_users: path.join(dataDir, 'asds-users.json'),
                sds_users: path.join(dataDir, 'sds-users.json'),
                it_users: path.join(dataDir, 'it-users.json'),
            };

            const file = files[tableName];
            try {
                let users = JSON.parse(fs.readFileSync(file, 'utf8'));
                users.push(userData);
                fs.writeFileSync(file, JSON.stringify(users, null, 2));
                return userData;
            } catch (e) {
                throw e;
            }
        }

        // PostgreSQL mode
        const columns = Object.keys(userData).join(', ');
        const values = Object.values(userData);
        const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');

        try {
            const result = await pool.query(
                `INSERT INTO ${tableName} (${columns}) VALUES (${placeholders}) RETURNING *`,
                values
            );
            return result.rows[0];
        } catch (err) {
            console.error(`[DB] Error inserting into ${tableName}:`, err.message);
            throw err;
        }
    }

    /**
     * Get application by ID
     */
    static async getApplicationById(appId) {
        if (!isDbConnected) {
            const dataDir = path.join(__dirname, '..', 'data');
            try {
                const apps = JSON.parse(fs.readFileSync(path.join(dataDir, 'applications.json'), 'utf8'));
                return apps.find(a => a.id === appId) || null;
            } catch (e) {
                return null;
            }
        }

        try {
            const result = await pool.query('SELECT * FROM applications WHERE id = $1', [appId]);
            return result.rows[0] || null;
        } catch (err) {
            console.error('[DB] Error querying applications:', err.message);
            return null;
        }
    }

    /**
     * Update application
     */
    static async updateApplication(appId, updates) {
        if (!isDbConnected) {
            const dataDir = path.join(__dirname, '..', 'data');
            try {
                let apps = JSON.parse(fs.readFileSync(path.join(dataDir, 'applications.json'), 'utf8'));
                const idx = apps.findIndex(a => a.id === appId);
                if (idx !== -1) {
                    apps[idx] = { ...apps[idx], ...updates };
                    fs.writeFileSync(path.join(dataDir, 'applications.json'), JSON.stringify(apps, null, 2));
                    return apps[idx];
                }
                return null;
            } catch (e) {
                throw e;
            }
        }

        const columns = Object.keys(updates).map(k => `${k} = $${Object.keys(updates).indexOf(k) + 1}`).join(', ');
        const values = [...Object.values(updates), appId];

        try {
            const result = await pool.query(
                `UPDATE applications SET ${columns}, updated_at = CURRENT_TIMESTAMP WHERE id = $${values.length} RETURNING *`,
                values
            );
            return result.rows[0] || null;
        } catch (err) {
            console.error('[DB] Error updating application:', err.message);
            throw err;
        }
    }

    /**
     * Get leave card by email
     */
    static async getLeaveCardByEmail(email) {
        if (!isDbConnected) {
            const dataDir = path.join(__dirname, '..', 'data');
            try {
                const cards = JSON.parse(fs.readFileSync(path.join(dataDir, 'leavecards.json'), 'utf8'));
                return cards.find(c => (c.email || '').toLowerCase() === email.toLowerCase()) || null;
            } catch (e) {
                return null;
            }
        }

        try {
            const result = await pool.query('SELECT * FROM leave_cards WHERE LOWER(email) = LOWER($1)', [email]);
            return result.rows[0] || null;
        } catch (err) {
            console.error('[DB] Error querying leave_cards:', err.message);
            return null;
        }
    }
}

module.exports = { DatabaseAdapter, isDbConnected, pool };
