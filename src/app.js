/**
 * Express Application Factory
 *
 * Assembles middleware, routes, and static file serving.
 * Used by server.js (entry point) to create the Express app.
 */

const express = require('express');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const {
    PORT, NODE_ENV, PRODUCTION_DOMAIN, APP_VERSION,
    dataDir, uploadsDir, soPdfsDir, leaveFormPdfsDir,
} = require('./config');

// Middleware
const { securityHeaders, sanitizeRequestBody, noCacheForHtmlJs, corsImageHeaders } = require('./middleware/security');
const { apiRateLimiter } = require('./middleware/rate-limit');

// Routes
const authRoutes = require('./routes/auth');
const employeeRoutes = require('./routes/employee');
const leaveRoutes = require('./routes/leave');
const itRoutes = require('./routes/it');
const leaveCreditsRoutes = require('./routes/leave-credits');
const activityLogRoutes = require('./routes/activity-logs');
const systemRoutes = require('./routes/system');

/**
 * Create and configure the Express application.
 */
function createApp() {
    const app = express();

    // ------------------------------------------------------------------
    // Trust proxy (Railway runs behind a reverse proxy)
    // ------------------------------------------------------------------
    app.set('trust proxy', 1);

    // ------------------------------------------------------------------
    // Core Middleware
    // ------------------------------------------------------------------
    app.use(bodyParser.json({ limit: '15mb' }));
    app.use(bodyParser.urlencoded({ extended: true }));
    app.use(cookieParser());

    // CORS
    const allowedOrigins = NODE_ENV === 'production' && PRODUCTION_DOMAIN
        ? [PRODUCTION_DOMAIN]
        : ['http://localhost:3000', 'http://127.0.0.1:3000'];

    app.use(cors({
        origin: allowedOrigins,
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    }));

    // Security headers
    app.use(securityHeaders);

    // Sanitize request bodies
    app.use(sanitizeRequestBody);

    // ------------------------------------------------------------------
    // Static File Serving
    // ------------------------------------------------------------------
    const publicDir = path.join(__dirname, '..', 'public');

    // No-cache for HTML/JS (ensures users always get latest version)
    app.use(noCacheForHtmlJs);

    // CORS headers for images (signature rendering)
    app.use(corsImageHeaders);

    // Serve static files
    app.use(express.static(publicDir, {
        maxAge: NODE_ENV === 'production' ? '1d' : 0,
        etag: true,
    }));

    // Serve uploads directory (SO PDFs, leave form PDFs)
    if (fs.existsSync(uploadsDir)) {
        app.use('/api/uploads', express.static(uploadsDir));
    }

    // ------------------------------------------------------------------
    // API Rate Limiting
    // ------------------------------------------------------------------
    app.use('/api/', apiRateLimiter);

    // ------------------------------------------------------------------
    // Health Check
    // ------------------------------------------------------------------
    app.get('/api/health', (req, res) => {
        res.json({
            status: 'ok',
            version: APP_VERSION,
            timestamp: new Date().toISOString(),
            uptime: Math.floor(process.uptime()),
        });
    });

    // ------------------------------------------------------------------
    // Route Modules
    // ------------------------------------------------------------------
    app.use(authRoutes);
    app.use(employeeRoutes);
    app.use(leaveRoutes);
    app.use(leaveCreditsRoutes);
    app.use(itRoutes);
    app.use(activityLogRoutes);
    app.use(systemRoutes);

    // ------------------------------------------------------------------
    // Page Routes (HTML serving for named routes)
    // Preserved from server.js — these serve specific HTML files
    // for direct-URL access (bookmarks, refresh).
    // ------------------------------------------------------------------
    const htmlPages = {
        '/':                    'index.html',
        '/login':               'login.html',
        '/ao-login':            'ao-login.html',
        '/hr-login':            'hr-login.html',
        '/asds-login':          'asds-login.html',
        '/sds-login':           'sds-login.html',
        '/it-login':            'it-login.html',
        '/ao-register':         'ao-register.html',
        '/dashboard':           'dashboard.html',
        '/ao-dashboard':        'ao-dashboard.html',
        '/hr-approval':         'hr-approval.html',
        '/asds-dashboard':      'asds-dashboard.html',
        '/sds-dashboard':       'sds-dashboard.html',
        '/it-dashboard':        'it-dashboard.html',
        '/leave-form':          'leave_form.html',
        '/leave-application':   'leave-application.html',
        '/edit-employee-cards':  'edit-employee-cards.html',
        '/employee-leavecard':   'employee-leavecard.html',
        '/data-management':      'data-management.html',
        '/activity-logs':        'activity-logs.html',
        '/leave-calendar':       'leave-calendar.html',
        '/about':                'about.html',
        '/help':                 'help.html',
        '/privacy':              'privacy.html',
        '/terms':                'terms.html',
    };

    for (const [route, file] of Object.entries(htmlPages)) {
        const filePath = path.join(publicDir, file);
        app.get(route, (req, res) => {
            if (fs.existsSync(filePath)) {
                res.sendFile(filePath);
            } else {
                res.status(404).send('Page not found');
            }
        });
    }

    // ------------------------------------------------------------------
    // 404 Handler
    // ------------------------------------------------------------------
    app.use((req, res) => {
        if (req.path.startsWith('/api/')) {
            res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } });
        } else {
            const indexPath = path.join(publicDir, 'index.html');
            if (fs.existsSync(indexPath)) {
                res.status(404).sendFile(indexPath);
            } else {
                res.status(404).send('Not Found');
            }
        }
    });

    // ------------------------------------------------------------------
    // Error Handler
    // ------------------------------------------------------------------
    app.use((err, req, res, _next) => {
        console.error('[ERROR]', err.message, err.stack);
        res.status(500).json({
            error: {
                code: 'INTERNAL_ERROR',
                message: NODE_ENV === 'production' ? 'Internal server error' : err.message,
            },
        });
    });

    return app;
}

module.exports = { createApp };
