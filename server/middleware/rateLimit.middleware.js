/* ==========================================================================
   Rate limiting — global, auth (brute-force protection), and service
   callbacks. Disabled only when NODE_ENV=test so the suite stays fast.
   ========================================================================== */
'use strict';

const rateLimit = require('express-rate-limit');
const env = require('../config/env');

function makeLimiter(options) {
    if (env.NODE_ENV === 'test') {
        return (req, res, next) => next();
    }
    return rateLimit({
        windowMs: options.windowMs,
        limit: options.limit,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'Too many requests — please slow down.', code: 'rate_limited' }
    });
}

const globalLimiter = makeLimiter({ windowMs: 15 * 60 * 1000, limit: 600 });
const authLimiter = makeLimiter({ windowMs: 15 * 60 * 1000, limit: 30 });
const integrationLimiter = makeLimiter({ windowMs: 60 * 1000, limit: 60 });
const launchLimiter = makeLimiter({ windowMs: 60 * 1000, limit: 40 });

module.exports = { globalLimiter, authLimiter, integrationLimiter, launchLimiter };
