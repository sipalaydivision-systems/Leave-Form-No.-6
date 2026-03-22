/**
 * PostgreSQL Connection Pool
 *
 * Uses the DATABASE_URL env var (auto-injected by Railway Postgres addon).
 * Falls back gracefully to JSON-file mode when no DATABASE_URL is set.
 */

const { DATABASE_URL } = require('../config');

let pool = null;
let isConnected = false;

/**
 * Initialize the PostgreSQL connection pool.
 * Returns null if DATABASE_URL is not configured (JSON-file mode).
 */
async function initPool() {
    if (!DATABASE_URL) {
        console.log('[DB] No DATABASE_URL configured — using JSON file storage');
        return null;
    }

    try {
        const { Pool } = require('pg');
        pool = new Pool({
            connectionString: DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production'
                ? { rejectUnauthorized: false }
                : false,
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000,
        });

        // Verify connection
        const client = await pool.connect();
        await client.query('SELECT 1');
        client.release();
        isConnected = true;
        console.log('[DB] PostgreSQL connected successfully');
        return pool;
    } catch (err) {
        console.error('[DB] PostgreSQL connection failed:', err.message);
        console.log('[DB] Falling back to JSON file storage');
        pool = null;
        isConnected = false;
        return null;
    }
}

/**
 * Execute a parameterized query.
 */
async function query(text, params) {
    if (!pool) throw new Error('Database not initialized');
    return pool.query(text, params);
}

/**
 * Get a client from the pool for transactions.
 *
 * Usage:
 *   const client = await getClient();
 *   try {
 *       await client.query('BEGIN');
 *       await client.query('INSERT INTO ...', [...]);
 *       await client.query('COMMIT');
 *   } catch (err) {
 *       await client.query('ROLLBACK');
 *       throw err;
 *   } finally {
 *       client.release();
 *   }
 */
async function getClient() {
    if (!pool) throw new Error('Database not initialized');
    return pool.connect();
}

/**
 * Execute multiple statements in a transaction.
 */
async function transaction(fn) {
    const client = await getClient();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Gracefully close the pool (call on server shutdown).
 */
async function closePool() {
    if (pool) {
        await pool.end();
        console.log('[DB] Connection pool closed');
        pool = null;
        isConnected = false;
    }
}

/**
 * Check if PostgreSQL is available and connected.
 */
function isDbConnected() {
    return isConnected && pool !== null;
}

/**
 * Get the raw pool instance (for advanced usage).
 */
function getPool() {
    return pool;
}

module.exports = {
    initPool,
    query,
    getClient,
    transaction,
    closePool,
    isDbConnected,
    getPool,
};
