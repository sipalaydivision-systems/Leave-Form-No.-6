// Input sanitization utilities - extracted from server.js lines 84-129

/**
 * Sanitize a single string input to prevent XSS and injection attacks.
 * Idempotent: decodes previously-encoded entities first, then re-encodes
 * only the XSS-dangerous characters.
 */
function sanitizeInput(input) {
    if (typeof input !== 'string') return input;
    // Skip valid base64 data URLs (signatures, images) — they must not be modified
    // SECURITY: Only skip specifically valid data URI formats to prevent XSS via data: prefix
    if (/^data:(image|application)\/(png|jpeg|jpg|gif|pdf|octet-stream);base64,/.test(input)) return input;
    // Decode any previously-encoded entities first to prevent double-encoding
    // Also decode &#x2F; and &#x5C; which were previously over-encoded
    let s = input
        .replace(/&#x2F;/g, '/')
        .replace(/&#x5C;/g, '\\')
        .replace(/&#x60;/g, '`')
        .replace(/&#x27;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&gt;/g, '>')
        .replace(/&lt;/g, '<');
    // Re-encode XSS-dangerous characters only
    // Note: / and \ are NOT encoded — they are not XSS vectors and break base64 data & file paths
    return s
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/`/g, '&#x60;');
}

/**
 * Deep sanitize an object (recursively sanitizes all string values and keys).
 * Truncates excessively long non-data-URI strings to 100k chars.
 */
function sanitizeObject(obj) {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'string') {
        // SECURITY: Truncate excessively long non-data-URI strings to prevent storage abuse
        if (obj.length > 100000 && !/^data:(image|application)\//.test(obj)) {
            obj = obj.substring(0, 100000);
        }
        return sanitizeInput(obj);
    }
    if (Array.isArray(obj)) return obj.map(sanitizeObject);
    if (typeof obj === 'object') {
        const sanitized = {};
        for (const [key, value] of Object.entries(obj)) {
            sanitized[sanitizeInput(key)] = sanitizeObject(value);
        }
        return sanitized;
    }
    return obj;
}

/**
 * Validate date format (YYYY-MM-DD) and ensure it's a real date.
 */
function isValidDate(dateStr) {
    if (!dateStr) return false;
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(dateStr)) return false;
    const date = new Date(dateStr);
    return date instanceof Date && !isNaN(date);
}

/**
 * Validate that an email belongs to the DepEd domain.
 */
function validateDepEdEmail(email) {
    return email && email.toLowerCase().endsWith('@deped.gov.ph');
}

/**
 * Validate portal password meets complexity requirements:
 * 6-24 chars, at least one letter, one number, one special character.
 */
function validatePortalPassword(password) {
    if (!password) return { valid: false, error: 'Password is required' };
    if (password.length < 6 || password.length > 24) {
        return { valid: false, error: 'Password must be 6-24 characters' };
    }
    if (!/[a-zA-ZÀ-ÖØ-öø-ÿ\u00C0-\u024F]/.test(password)) {
        return { valid: false, error: 'Password must contain letters (a-z, A-Z)' };
    }
    if (!/[0-9]/.test(password)) {
        return { valid: false, error: 'Password must contain numbers (0-9)' };
    }
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
        return { valid: false, error: 'Password must contain a special character (!@#$%^&* etc.)' };
    }
    return { valid: true };
}

module.exports = {
    sanitizeInput,
    sanitizeObject,
    isValidDate,
    validateDepEdEmail,
    validatePortalPassword
};
