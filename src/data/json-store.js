/**
 * JSON flat-file CRUD operations.
 *
 * Provides atomic read/write helpers for the JSON data files that back
 * the leave management system.  Extracted from server.js to allow
 * reuse across service modules without pulling in the entire server.
 */

const fs = require('fs');
const path = require('path');

// Default seed directory — sits next to the top-level data/ folder
const defaultsDir = path.join(__dirname, '..', '..', 'data', 'defaults');

/**
 * Ensure a data file exists on disk.
 * If missing, seeds it from `data/defaults/<filename>` when available,
 * otherwise writes `defaultContent` (defaults to `'[]'`).
 *
 * @param {string} filepath - Absolute path to the JSON data file.
 * @param {string} [defaultContent='[]'] - Fallback content when no seed exists.
 */
function ensureFile(filepath, defaultContent = '[]') {
    const filename = path.basename(filepath);
    const defaultFile = path.join(defaultsDir, filename);

    if (!fs.existsSync(filepath)) {
        // File doesn't exist — seed from bundled defaults (useful for Railway Volume first deploy)
        if (fs.existsSync(defaultFile)) {
            const content = fs.readFileSync(defaultFile, 'utf8');
            fs.writeFileSync(filepath, content);
            console.log(`[DATA] Seeded ${filename} from defaults`);
        } else {
            fs.writeFileSync(filepath, defaultContent);
            console.log(`[DATA] Created empty ${filename}`);
        }
    }
    // NOTE: Do NOT re-seed existing empty files from defaults.
    // If data was intentionally cleared (e.g., bulk delete), it should stay empty.
}

/**
 * Read and parse a JSON file.
 *
 * Strips a UTF-8 BOM when present and falls back to a `.bak` backup if
 * the primary file is corrupted.  Returns `[]` as a safe default when
 * the file does not exist or cannot be recovered.
 *
 * @param {string} filepath - Absolute path to the JSON file.
 * @returns {any} Parsed JSON (array or object).
 */
function readJSON(filepath) {
    try {
        if (!fs.existsSync(filepath)) {
            return [];
        }
        let content = fs.readFileSync(filepath, 'utf8');
        // Strip UTF-8 BOM if present
        if (content.charCodeAt(0) === 0xFEFF) {
            content = content.slice(1);
        }
        const parsed = JSON.parse(content);
        return parsed;
    } catch (error) {
        console.error(`Error reading JSON file ${filepath}:`, error.message);
        // Try to recover from backup
        const backupPath = filepath + '.bak';
        if (fs.existsSync(backupPath)) {
            try {
                console.log(`[DATA-RECOVERY] Attempting to recover ${path.basename(filepath)} from backup...`);
                let backupContent = fs.readFileSync(backupPath, 'utf8');
                if (backupContent.charCodeAt(0) === 0xFEFF) {
                    backupContent = backupContent.slice(1);
                }
                const recovered = JSON.parse(backupContent);
                // Restore the main file from backup
                fs.writeFileSync(filepath, JSON.stringify(recovered, null, 2));
                console.log(`[DATA-RECOVERY] Successfully recovered ${path.basename(filepath)} from backup`);
                return recovered;
            } catch (backupError) {
                console.error(`[DATA-RECOVERY] Backup also corrupted for ${filepath}:`, backupError.message);
            }
        }
        return [];
    }
}

/**
 * Read a JSON file and guarantee the result is an array.
 *
 * Handles the edge case where a file contains an object with a single
 * key wrapping an array (e.g. `{"applications":[...]}`). When detected
 * the file is rewritten in plain-array format for future reads.
 *
 * @param {string} filepath - Absolute path to the JSON file.
 * @returns {Array} Parsed array data.
 */
function readJSONArray(filepath) {
    const data = readJSON(filepath);
    if (Array.isArray(data)) return data;
    // If it's an object with a single key containing an array, unwrap it
    if (data && typeof data === 'object') {
        const keys = Object.keys(data);
        if (keys.length === 1 && Array.isArray(data[keys[0]])) {
            console.log(`[readJSONArray] Unwrapping "${keys[0]}" from ${path.basename(filepath)}, fixing file format...`);
            // Also fix the file to plain array for future reads
            writeJSON(filepath, data[keys[0]]);
            return data[keys[0]];
        }
    }
    return [];
}

/**
 * Atomically write JSON data to a file.
 *
 * Writes to a `.tmp` sibling first, validates the serialised JSON, then
 * renames over the target to prevent partial-write corruption. A `.bak`
 * backup of the previous version is kept.
 *
 * CONCURRENCY NOTE: All route handlers that read-modify-write use
 * synchronous readFileSync/writeFileSync with no await between them.
 * Since Node.js is single-threaded the entire cycle completes in one
 * event-loop tick — no race conditions.
 *
 * @param {string} filepath - Absolute path to the target file.
 * @param {any}    data     - Data to serialise.
 */
function writeJSON(filepath, data) {
    const tempPath = filepath + '.tmp';
    const backupPath = filepath + '.bak';
    try {
        const jsonStr = JSON.stringify(data, null, 2);
        // Validate JSON before writing (catch serialization issues)
        JSON.parse(jsonStr);
        // Create backup of current file if it exists
        if (fs.existsSync(filepath)) {
            try { fs.copyFileSync(filepath, backupPath); } catch (e) { /* best effort */ }
        }
        // Write to temp file first
        fs.writeFileSync(tempPath, jsonStr);
        // Atomic rename
        fs.renameSync(tempPath, filepath);
    } catch (error) {
        console.error(`[WRITE-ERROR] Failed to write ${filepath}:`, error.message);
        // Clean up temp file if it exists
        try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (e) { /* ignore */ }
        throw error;
    }
}

module.exports = {
    ensureFile,
    readJSON,
    readJSONArray,
    writeJSON,
};
