/**
 * Shared utility functions for all client-side pages.
 * Include via: <script src="/utils.js"></script>
 */

/**
 * Escape HTML entities to prevent XSS when injecting into innerHTML.
 * Defense-in-depth: server-side sanitizeInput() already encodes stored data,
 * but this protects against localStorage, error messages, and client-only data.
 * @param {*} str - Value to escape (coerced to string)
 * @returns {string} HTML-safe string
 */
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    const s = String(str);
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
    return s.replace(/[&<>"'`]/g, ch => map[ch]);
}

/**
 * Safely build an onclick attribute value with escaped parameters.
 * Prevents breakout from onclick="fn('...')" via quotes in data.
 * @param {string} fnName - Function name to call
 * @param {...string} args - Arguments to pass (will be escaped)
 * @returns {string} Safe onclick attribute string
 */
function safeOnclick(fnName, ...args) {
    const escaped = args.map(a => escapeHtml(String(a).replace(/\\/g, '\\\\').replace(/'/g, "\\'"))).join("', '");
    return `${fnName}('${escaped}')`;
}
