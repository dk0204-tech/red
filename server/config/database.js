/* ==========================================================================
   Database access layer.

   One thin `query(text, params)` API with two interchangeable drivers:

     DATABASE_URL=postgres://user:pass@host:5432/db   → node-postgres (prod)
     DATABASE_URL=pglite://./.data/db                 → embedded Postgres
                                                        (zero-setup dev/test)

   Every statement in the codebase is parameterized ($1, $2 …) — no string
   concatenation of user input, ever.
   ========================================================================== */
'use strict';

const path = require('path');
const fs = require('fs');
const env = require('../config/env');
const logger = require('../utils/logger');

let driver = null;       // { kind: 'pg'|'pglite', query, end }
let initPromise = null;

function isPglite(url) {
    return !/^postgres(ql)?:\/\//i.test(url);
}

async function initPg() {
    const { Pool } = require('pg');
    const pool = new Pool({
        connectionString: env.DATABASE_URL,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 8000
    });
    pool.on('error', (err) => logger.error('pg pool error', { message: err.message }));
    return {
        kind: 'pg',
        query: (text, params) => pool.query(text, params),
        exec: (sql) => pool.query(sql),
        end: () => pool.end(),
        pool
    };
}

async function initPglite() {
    // Dynamic import: PGlite ships as an ES module.
    const { PGlite } = await import('@electric-sql/pglite');
    const dir = env.DATABASE_URL.replace(/^pglite:\/\//, '');
    const resolved = path.resolve(env.ROOT, dir || './.data/db');
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    const db = new PGlite(resolved);
    await db.waitReady;
    return {
        kind: 'pglite',
        query: async (text, params) => {
            const res = await db.query(text, params);
            return { rows: res.rows, rowCount: res.rows.length };
        },
        exec: (sql) => db.exec(sql),
        end: () => db.close(),
        raw: db
    };
}

async function getDriver() {
    if (driver) return driver;
    if (!initPromise) {
        initPromise = (async () => {
            driver = isPglite(env.DATABASE_URL) ? await initPglite() : await initPg();
            logger.info('database ready', { driver: driver.kind, target: isPglite(env.DATABASE_URL) ? env.DATABASE_URL : env.DATABASE_URL.replace(/:\/\/[^@]*@/, '://***@') });
            return driver;
        })().catch((err) => {
            initPromise = null;
            throw err;
        });
    }
    return initPromise;
}

/** Run a parameterized query. */
async function query(text, params) {
    const d = await getDriver();
    return d.query(text, params);
}

/** Fetch a single row or null. */
async function one(text, params) {
    const res = await query(text, params);
    return res.rows.length ? res.rows[0] : null;
}

/** Begin a transaction using a dedicated client where the driver supports it. */
async function withTransaction(fn) {
    const d = await getDriver();
    if (d.kind === 'pg') {
        const client = await d.pool.connect();
        const conn = {
            query: (text, params) => client.query(text, params),
            exec: (sql) => client.query(sql)
        };
        try {
            await client.query('BEGIN');
            const result = await fn(conn);
            await client.query('COMMIT');
            return result;
        } catch (err) {
            try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
            throw err;
        } finally {
            client.release();
        }
    }
    // pglite is single-connection: serial execution is already safe here.
    return fn({ query: d.query, exec: d.exec });
}

/** Execute a multi-statement SQL block (migrations, DDL). */
async function exec(sql) {
    const d = await getDriver();
    return d.exec(sql);
}

/** Health probe used by GET /api/health. */
async function ping() {
    try {
        const res = await query('SELECT 1 AS ok');
        return res.rows && res.rows[0] && res.rows[0].ok === 1 ? 'connected' : 'unknown';
    } catch (err) {
        logger.warn('database ping failed', { message: err.message });
        return 'disconnected';
    }
}

async function close() {
    if (driver) {
        await driver.end();
        driver = null;
        initPromise = null;
    }
}

module.exports = { query, one, withTransaction, exec, ping, close, getDriver };
