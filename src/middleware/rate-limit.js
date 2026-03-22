// Rate limiting middleware - extracted from server.js lines 30-82

// In-memory rate limit storage
const rateLimitStore = new Map();

/**
 * Rate limiting middleware factory.
 * Creates a middleware that limits requests per IP+path to maxRequests within windowMs.
 * @param {number} maxRequests - Maximum number of requests allowed in the window
 * @param {number} windowMs - Time window in milliseconds
 * @returns {Function} Express middleware
 */
function createRateLimiter(maxRequests, windowMs) {
    return (req, res, next) => {
        const ip = req.ip || req.connection.remoteAddress;
        const key = `${ip}:${req.path}`;
        const now = Date.now();

        if (!rateLimitStore.has(key)) {
            rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
            return next();
        }

        const record = rateLimitStore.get(key);
        if (now > record.resetTime) {
            rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
            return next();
        }

        if (record.count >= maxRequests) {
            return res.status(429).json({
                success: false,
                error: 'Too many requests. Please try again later.'
            });
        }

        record.count++;
        next();
    };
}

// Cleanup expired rate limit entries every 5 minutes to prevent memory leak
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, record] of rateLimitStore.entries()) {
        if (now > record.resetTime) {
            rateLimitStore.delete(key);
            cleaned++;
        }
    }
    if (cleaned > 0) {
        console.log(`[RATE-LIMIT] Cleaned ${cleaned} expired entries, ${rateLimitStore.size} remaining`);
    }
}, 5 * 60 * 1000);

// Login rate limiter: 10 attempts per 15 minutes
const loginRateLimiter = createRateLimiter(10, 15 * 60 * 1000);

// General API rate limiter: 100 requests per minute
const apiRateLimiter = createRateLimiter(100, 60 * 1000);

module.exports = { rateLimitStore, createRateLimiter, loginRateLimiter, apiRateLimiter };
