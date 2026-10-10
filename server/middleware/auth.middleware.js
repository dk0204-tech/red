/* ==========================================================================
   Authentication / authorization middleware.
   Token sources:  Authorization: Bearer <jwt>   (API clients)
                   manu_token cookie             (admin dashboard, optional)
   ========================================================================== */
'use strict';

const { verifyToken } = require('../utils/jwt');

function readCookie(req, name) {
    const header = req.headers.cookie;
    if (!header) return null;
    for (const part of String(header).split(';')) {
        const idx = part.indexOf('=');
        if (idx === -1) continue;
        if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
    }
    return null;
}

function readToken(req) {
    const header = req.headers.authorization;
    if (header && /^Bearer /i.test(header)) return header.slice(7).trim();
    const cookie = readCookie(req, 'manu_token');
    if (cookie) return cookie;
    if (req.query && typeof req.query.token === 'string' && req.query.token.length < 512) {
        return req.query.token; // convenient for <img>/download links only
    }
    return null;
}

/** Attach req.user when a valid token is present; never fails the request. */
function attachUser(req, res, next) {
    const token = readToken(req);
    req.user = null;
    if (token) {
        try {
            const payload = verifyToken(token);
            req.user = {
                id: payload.sub,
                username: payload.username,
                role: payload.role,
                teamId: payload.teamId
            };
        } catch (err) {
            req.user = null;
            req.tokenError = err.message;
        }
    }
    next();
}

function requireAuth(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Sign in required.', code: 'unauthorized' });
    }
    next();
}

function requireAdmin(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Sign in required.', code: 'unauthorized' });
    }
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Organizer access required.', code: 'forbidden' });
    }
    next();
}

module.exports = { attachUser, requireAuth, requireAdmin, readToken };
