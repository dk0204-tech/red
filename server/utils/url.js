/* ==========================================================================
   CTF external URL validation (server side — the frontend re-checks too).

   Only administrator-configured https:// URLs may ever be handed to a
   player. javascript:, data:, file:, vbscript:, localhost, loopback and
   private-network targets are rejected (unless explicitly allowed for
   local development) — this is the open-redirect / XSS gate.
   ========================================================================== */
'use strict';

const env = require('../config/env');

const BAD_SCHEMES = ['javascript:', 'data:', 'file:', 'vbscript:', 'blob:', 'about:', 'chrome:', 'chrome-extension:'];

const PRIVATE_HOST_RE = /^(localhost|127(\.\d+){3}|0\.0\.0\.0|\[::1\]|::1|10(\.\d+){3}|192\.168(\.\d+){3}|172\.(1[6-9]|2\d|3[01])(\.\d+){3}|169\.254(\.\d+){3}|metadata\.google\.internal)$/i;

/**
 * Validate a CTF URL.
 * @returns {{ok: boolean, reason?: string, url?: string}}
 */
function validateCtfUrl(raw, opts) {
    const options = opts || {};
    const allowLocal = options.allowLocal !== undefined ? options.allowLocal : env.ALLOW_LOCAL_URLS;
    const allowHttp = options.allowHttp !== undefined ? options.allowHttp : env.ALLOW_INSECURE_HTTP;

    if (typeof raw !== 'string' || !raw.trim()) {
        return { ok: false, reason: 'URL is required.' };
    }
    const value = raw.trim();
    if (value.length > 2048) return { ok: false, reason: 'URL is too long.' };

    const lower = value.toLowerCase();
    for (const s of BAD_SCHEMES) {
        if (lower.startsWith(s)) return { ok: false, reason: `Scheme "${s}" is not allowed.` };
    }

    let parsed;
    try {
        parsed = new URL(value);
    } catch (e) {
        return { ok: false, reason: 'URL must be a complete absolute address (https://…).' };
    }

    if (parsed.protocol !== 'https:' && !(allowHttp && parsed.protocol === 'http:')) {
        return { ok: false, reason: 'Only https:// URLs are allowed.' };
    }
    if (parsed.username || parsed.password) {
        return { ok: false, reason: 'Credentials embedded in the URL are not allowed.' };
    }
    if (!allowLocal && (PRIVATE_HOST_RE.test(parsed.hostname) || parsed.hostname.endsWith('.localhost'))) {
        return { ok: false, reason: 'Local / private network addresses are not allowed.' };
    }
    if (!parsed.hostname) return { ok: false, reason: 'URL host is missing.' };

    return { ok: true, url: parsed.toString() };
}

module.exports = { validateCtfUrl };
