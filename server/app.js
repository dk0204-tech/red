/* ==========================================================================
   Express application factory.
   Serves:   /api/*          REST API
             /               the Three.js game (allowlisted static files)
             /dashboard      organizer dashboard
   ========================================================================== */
'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const env = require('./config/env');
const apiRouter = require('./routes/index');
const { globalLimiter } = require('./middleware/rateLimit.middleware');
const { notFound, errorHandler } = require('./middleware/error.middleware');
const logger = require('./utils/logger');

function createApp() {
    const app = express();

    app.set('trust proxy', env.TRUST_PROXY ? 1 : false);
    app.disable('x-powered-by');

    /* --------------------------- security headers ------------------------ */
    app.use(helmet({
        contentSecurityPolicy: {
            useDefaults: false,
            directives: {
                'default-src': ["'self'"],
                // The game uses one inline boot script by design.
                'script-src': ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
                'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
                'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
                'img-src': ["'self'", 'data:', 'blob:'],
                'media-src': ["'self'", 'data:'],
                'connect-src': ["'self'"],
                'worker-src': ["'self'", 'blob:'],
                'frame-src': ["'none'"],
                'object-src': ["'none'"],
                'base-uri': ["'self'"],
                'form-action': ["'self'"],
                'frame-ancestors': ["'none'"]
            }
        },
        // The CTF launcher scripts an about:blank splash tab before navigating.
        crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
        crossOriginResourcePolicy: { policy: 'same-origin' },
        referrerPolicy: { policy: 'no-referrer' },
        hsts: env.isProd ? { maxAge: 15552000, includeSubDomains: true } : false
    }));

    /* -------------------------------- CORS -------------------------------- */
    const origins = env.CORS_ORIGIN
        ? env.CORS_ORIGIN.split(',').map(s => s.trim()).filter(Boolean)
        : true; // reflect request origin when not configured (same-origin app)
    app.use(cors({ origin: origins, credentials: false, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] }));

    /* ------------------------------ parsing ------------------------------ */
    app.use(express.json({ limit: '64kb' }));
    app.use(express.urlencoded({ extended: false, limit: '64kb' }));

    /* ---------------------------- rate limiting -------------------------- */
    app.use(globalLimiter);

    /* -------------------------------- API -------------------------------- */
    app.use('/api', apiRouter);

    /* --------------------------- static assets --------------------------- */
    // Allowlist: server/, node_modules/, .env and legacy flag-bearing files
    // are NEVER served to the browser.
    const root = env.ROOT;
    const staticOpts = { dotfiles: 'ignore', index: false, maxAge: env.isProd ? '1h' : 0 };

    app.get('/', sendGameIndex);
    app.get('/index.html', sendGameIndex);
    function sendGameIndex(req, res) {
        res.sendFile(path.join(root, 'index.html'));
    }

    app.use('/config', express.static(path.join(root, 'config'), staticOpts));
    app.use('/src', express.static(path.join(root, 'src'), staticOpts));
    if (fs.existsSync(path.join(root, 'assets'))) {
        app.use('/assets', express.static(path.join(root, 'assets'), staticOpts));
    }

    /* ------------------------ organizer dashboard ------------------------ */
    app.use('/dashboard', express.static(path.join(root, 'admin'), { ...staticOpts, index: 'index.html' }));

    /* ------------------------------ errors ------------------------------- */
    app.use('/api', notFound);
    app.use((req, res) => {
        res.status(404).json({ error: 'Not found.', code: 'not_found' });
    });
    app.use(errorHandler);

    return app;
}

module.exports = { createApp };
