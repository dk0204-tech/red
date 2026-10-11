/* ==========================================================================
   Environment configuration — single source of truth for all runtime config.
   Secrets are ONLY read from the environment (never committed, never shipped
   to the browser).
   ========================================================================== */
'use strict';

const path = require('path');
const fs = require('fs');

// Load .env in development; production platforms inject real environment
// variables. .env is git-ignored.
try {
    require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
} catch (e) { /* dotenv is optional at runtime */ }

const ROOT = path.join(__dirname, '..', '..');
const NODE_ENV = process.env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';

function parseBool(v, fallback) {
    if (v === undefined || v === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function parseTime(v, fallback) {
    if (!v) return fallback;
    const t = Date.parse(v);
    return Number.isNaN(t) ? fallback : new Date(t).toISOString();
}

const env = {
    NODE_ENV,
    isProd,
    ROOT,

    PORT: parseInt(process.env.PORT, 10) || 3000,

    /* Database.
       postgres://…  → real PostgreSQL (production)
       pglite://./dir → embedded Postgres for zero-setup local development   */
    DATABASE_URL: process.env.DATABASE_URL || 'pglite://./.data/db',

    JWT_SECRET: process.env.JWT_SECRET || (isProd ? '' : 'dev-only-insecure-secret-change-me'),
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '12h',

    /* Service token used by external CTF apps to report completions. */
    CTF_SERVICE_TOKEN: process.env.CTF_SERVICE_TOKEN || (isProd ? '' : 'dev-service-token'),

    /* Public addresses of the five in-world challenge services, served to the
       game at GET /api/ctf/links so a deployed page never has to carry a
       localhost address. One per terminal (CTF_URL_1 … CTF_URL_5). Empty or
       invalid → that terminal stays "not configured" in the browser. */
    CTF_PUBLIC_URLS: {
        1: process.env.CTF_URL_1 || '',
        2: process.env.CTF_URL_2 || '',
        3: process.env.CTF_URL_3 || '',
        4: process.env.CTF_URL_4 || '',
        5: process.env.CTF_URL_5 || ''
    },

    ADMIN_EMAIL: process.env.ADMIN_EMAIL || 'admin@sanctuary.local',
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || '',      // used only by the seed script
    ADMIN_PASSWORD_HASH: process.env.ADMIN_PASSWORD_HASH || '', // preferred in production

    FRONTEND_URL: process.env.FRONTEND_URL || '',
    CORS_ORIGIN: process.env.CORS_ORIGIN || process.env.FRONTEND_URL || '',

    EVENT_NAME: process.env.EVENT_NAME || 'THE LAST DATASET // SANCTUARY ZERO',
    EVENT_START: parseTime(process.env.EVENT_START, new Date().toISOString()),
    EVENT_END: parseTime(process.env.EVENT_END, new Date(Date.now() + 36 * 3600 * 1000).toISOString()),

    ALLOW_LOCAL_URLS: parseBool(process.env.ALLOW_LOCAL_URLS, !isProd),
    ALLOW_INSECURE_HTTP: parseBool(process.env.ALLOW_INSECURE_HTTP, !isProd),

    TRUST_PROXY: parseBool(process.env.TRUST_PROXY, false),
    LOG_LEVEL: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug')
};

/* Fail fast in production when a critical secret is missing. */
env.validate = function validate() {
    const problems = [];
    if (isProd) {
        if (!env.JWT_SECRET || env.JWT_SECRET.length < 16) {
            problems.push('JWT_SECRET must be set to a strong random value (>= 16 chars).');
        }
        if (!env.CTF_SERVICE_TOKEN || env.CTF_SERVICE_TOKEN.length < 16) {
            problems.push('CTF_SERVICE_TOKEN must be set to a strong random value (>= 16 chars).');
        }
        if (!env.DATABASE_URL || env.DATABASE_URL.startsWith('pglite://')) {
            problems.push('DATABASE_URL must point at PostgreSQL (postgres://…) in production.');
        }
        if (!env.ADMIN_PASSWORD_HASH && !env.ADMIN_PASSWORD) {
            problems.push('Set ADMIN_PASSWORD_HASH (preferred) or ADMIN_PASSWORD for the first admin.');
        }
    }
    return problems;
};

module.exports = env;
