// Security middleware - extracted from server.js lines 167-427
const { NODE_ENV } = require('../config');
const { sanitizeObject } = require('../utils/validation');

/**
 * Sets security headers on every response.
 * Includes HSTS in production, CSP, and common anti-XSS/clickjacking headers.
 */
function securityHeaders(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    res.setHeader('Content-Security-Policy',
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline'; " +
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
        "img-src 'self' data: blob:; " +
        "font-src 'self' data: https://fonts.gstatic.com; " +
        "connect-src 'self'"
    );
    next();
}

/**
 * Sanitizes all incoming request body and query parameters.
 * Must be mounted AFTER bodyParser so req.body is populated.
 */
function sanitizeRequestBody(req, res, next) {
    if (req.body && typeof req.body === 'object') {
        req.body = sanitizeObject(req.body);
    }
    if (req.query && typeof req.query === 'object') {
        req.query = sanitizeObject(req.query);
    }
    next();
}

/**
 * Prevents caching of HTML and JS files so clients always get the latest
 * code after deploys. Non-file paths (API routes) are also not cached.
 */
function noCacheForHtmlJs(req, res, next) {
    if (req.path.endsWith('.html') || req.path.endsWith('.js') || (!req.path.includes('.') && req.path !== '/')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
    next();
}

/**
 * Enables CORS headers for static image files (needed for canvas operations in print).
 * Mount on specific image routes (e.g., /sipalay_logo.png, /deped%20logo.png).
 */
function corsImageHeaders(req, res, next) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
}

/**
 * Redirects HTTP requests to HTTPS in production.
 * Railway terminates TLS at the reverse proxy and sets X-Forwarded-Proto.
 * Must be mounted before all other middleware.
 */
function enforceHttps(req, res, next) {
    if (NODE_ENV === 'production' && req.header('x-forwarded-proto') !== 'https') {
        return res.redirect(301, 'https://' + req.header('host') + req.url);
    }
    next();
}

module.exports = { securityHeaders, sanitizeRequestBody, noCacheForHtmlJs, corsImageHeaders, enforceHttps };
