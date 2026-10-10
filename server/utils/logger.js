/* ==========================================================================
   Minimal structured logger. Never logs secrets, passwords or tokens.
   ========================================================================== */
'use strict';

const env = require('../config/env');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const threshold = LEVELS[env.LOG_LEVEL] !== undefined ? LEVELS[env.LOG_LEVEL] : 2;

const SECRET_KEYS = /^(password|password_hash|pass|token|secret|authorization|cookie|flag|hint|answer|service_token|jwt)$/i;

function sanitize(value, depth) {
    if (value === null || value === undefined) return value;
    if (depth > 4) return '[deep]';
    if (Array.isArray(value)) return value.slice(0, 20).map(v => sanitize(v, depth + 1));
    if (typeof value === 'object') {
        const out = {};
        for (const k of Object.keys(value)) {
            out[k] = SECRET_KEYS.test(k) ? '[redacted]' : sanitize(value[k], depth + 1);
        }
        return out;
    }
    if (typeof value === 'string' && value.length > 400) return value.slice(0, 400) + '…';
    return value;
}

function emit(level, msg, meta) {
    if (LEVELS[level] > threshold) return;
    const line = {
        ts: new Date().toISOString(),
        level: level.toUpperCase(),
        msg: msg
    };
    if (meta) Object.assign(line, sanitize(meta, 0));
    const text = JSON.stringify(line);
    if (level === 'error') console.error(text);
    else if (level === 'warn') console.warn(text);
    else console.log(text);
}

module.exports = {
    error: (msg, meta) => emit('error', msg, meta),
    warn: (msg, meta) => emit('warn', msg, meta),
    info: (msg, meta) => emit('info', msg, meta),
    debug: (msg, meta) => emit('debug', msg, meta)
};
