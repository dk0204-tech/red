/* ==========================================================================
   Server bootstrap — runs migrations + seed (idempotent), then listens.
   Usage:  npm start          production
           npm run dev        development with --watch
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const env = require('./config/env');
const logger = require('./utils/logger');
const { createApp } = require('./app');
const db = require('./config/database');

/* ----------------------------------------------------------------------
   Red Zone CTF 1 — the provided CTF backend attached to the GHOST SIGNAL
   terminal (CTF 1). config/ctf-links.js points at http://127.0.0.1:8080.
   Best effort only: never blocks or fails the game server.
     • CTF1_AUTOSTART=false  → never started here
     • CTF1_PORT             → port to check/spawn on (default 8080)
   ---------------------------------------------------------------------- */
let stopCtf1 = null;
function startRedZoneCtf1() {
    if (process.env.CTF1_AUTOSTART === 'false') return;
    const port = Number(process.env.CTF1_PORT || 8080);
    const entry = path.join(__dirname, '..', 'red-zone-ctf1', 'red-zone-ctf1', 'src', 'server.js');
    if (!fs.existsSync(entry)) return;

    const url = 'http://127.0.0.1:' + port;
    const probe = () => fetch(url + '/healthz', { signal: AbortSignal.timeout(1500) })
        .then(r => r.ok).catch(() => false);

    probe().then(async (up) => {
        if (up) {
            logger.info('Red Zone CTF 1 already listening', { url });
            return;
        }
        const child = spawn(process.execPath, [entry], {
            env: Object.assign({}, process.env, { PORT: String(port) }),
            stdio: ['ignore', 'ignore', 'pipe']
        });
        child.once('error', (err) => logger.warn('Red Zone CTF 1 spawn failed', { message: err.message }));
        child.once('exit', (code, signal) => logger.warn('Red Zone CTF 1 stopped', { code, signal }));
        if (child.stderr) {
            child.stderr.on('data', (d) => {
                const line = String(d).trim();
                if (line) logger.warn('Red Zone CTF 1', { line: line.slice(0, 240) });
            });
        }
        stopCtf1 = () => { try { child.kill('SIGTERM'); } catch (e) { /* already gone */ } };
        setTimeout(async () => {
            const nowUp = await probe();
            logger.info(nowUp ? 'Red Zone CTF 1 attached' : 'Red Zone CTF 1 not reachable yet', { url });
        }, 1500).unref();
    }).catch(() => { /* probe failure is non-fatal */ });
}

/* ----------------------------------------------------------------------
   Red Zone CTF 2 — the existing `Red Zone CTF 2/` node attached to the
   SANCTUARY ARCHIVE terminal (CTF 2, zone_vault). config/ctf-links.js
   points at http://127.0.0.1:8081. Same best-effort contract as CTF 1:
     • CTF2_AUTOSTART=false  → never started here
     • CTF2_PORT             → port to check/spawn on (default 8081)
   ---------------------------------------------------------------------- */
let stopCtf2 = null;
function startRedZoneCtf2() {
    if (process.env.CTF2_AUTOSTART === 'false') return;
    const port = Number(process.env.CTF2_PORT || 8081);
    const entry = path.join(__dirname, '..', 'Red Zone CTF 2', 'backend', 'server.js');
    if (!fs.existsSync(entry)) return;

    const url = 'http://127.0.0.1:' + port;
    const probe = () => fetch(url + '/healthz', { signal: AbortSignal.timeout(1500) })
        .then(r => r.ok).catch(() => false);

    probe().then(async (up) => {
        if (up) {
            logger.info('Red Zone CTF 2 already listening', { url });
            return;
        }
        const child = spawn(process.execPath, [entry], {
            env: Object.assign({}, process.env, { PORT: String(port) }),
            stdio: ['ignore', 'ignore', 'pipe']
        });
        child.once('error', (err) => logger.warn('Red Zone CTF 2 spawn failed', { message: err.message }));
        child.once('exit', (code, signal) => logger.warn('Red Zone CTF 2 stopped', { code, signal }));
        if (child.stderr) {
            child.stderr.on('data', (d) => {
                const line = String(d).trim();
                if (line) logger.warn('Red Zone CTF 2', { line: line.slice(0, 240) });
            });
        }
        stopCtf2 = () => { try { child.kill('SIGTERM'); } catch (e) { /* already gone */ } };
        setTimeout(async () => {
            const nowUp = await probe();
            logger.info(nowUp ? 'Red Zone CTF 2 attached' : 'Red Zone CTF 2 not reachable yet', { url });
        }, 1500).unref();
    }).catch(() => { /* probe failure is non-fatal */ });
}

/* ----------------------------------------------------------------------
   Red Zone CTF 3 — the existing `Red Zone CTF 3/` node attached to the
   CHILD DATASET terminal (CTF 3, zone_ai). config/ctf-links.js points at
   http://127.0.0.1:8082. Same best-effort contract as CTF 1 / CTF 2:
     • CTF3_AUTOSTART=false  → never started here
     • CTF3_PORT             → port to check/spawn on (default 8082)
   ---------------------------------------------------------------------- */
let stopCtf3 = null;
function startRedZoneCtf3() {
    if (process.env.CTF3_AUTOSTART === 'false') return;
    const port = Number(process.env.CTF3_PORT || 8082);
    const entry = path.join(__dirname, '..', 'Red Zone CTF 3', 'backend', 'server.js');
    if (!fs.existsSync(entry)) return;

    const url = 'http://127.0.0.1:' + port;
    const probe = () => fetch(url + '/healthz', { signal: AbortSignal.timeout(1500) })
        .then(r => r.ok).catch(() => false);

    probe().then(async (up) => {
        if (up) {
            logger.info('Red Zone CTF 3 already listening', { url });
            return;
        }
        const child = spawn(process.execPath, [entry], {
            env: Object.assign({}, process.env, { PORT: String(port) }),
            stdio: ['ignore', 'ignore', 'pipe']
        });
        child.once('error', (err) => logger.warn('Red Zone CTF 3 spawn failed', { message: err.message }));
        child.once('exit', (code, signal) => logger.warn('Red Zone CTF 3 stopped', { code, signal }));
        if (child.stderr) {
            child.stderr.on('data', (d) => {
                const line = String(d).trim();
                if (line) logger.warn('Red Zone CTF 3', { line: line.slice(0, 240) });
            });
        }
        stopCtf3 = () => { try { child.kill('SIGTERM'); } catch (e) { /* already gone */ } };
        setTimeout(async () => {
            const nowUp = await probe();
            logger.info(nowUp ? 'Red Zone CTF 3 attached' : 'Red Zone CTF 3 not reachable yet', { url });
        }, 1500).unref();
    }).catch(() => { /* probe failure is non-fatal */ });
}

/* ----------------------------------------------------------------------
   CTF 4 — THE DEADLOCK ENGINE (bonus). The existing `Bonus CTF/` node
   attached to the CENTRAL ATRIUM terminal (CTF 4, zone_atrium).
   config/ctf-links.js points at http://127.0.0.1:8090. Same best-effort
   contract as CTF 1 / 2 / 3:
     • CTF4_AUTOSTART=false  → never started here
     • CTF4_PORT             → port to check/spawn on (default 8090)
   ---------------------------------------------------------------------- */
let stopCtf4 = null;
function startRedZoneCtf4() {
    if (process.env.CTF4_AUTOSTART === 'false') return;
    const port = Number(process.env.CTF4_PORT || 8090);
    const entry = path.join(__dirname, '..', 'Bonus CTF', 'server', 'server.js');
    if (!fs.existsSync(entry)) return;

    const url = 'http://127.0.0.1:' + port;
    const probe = () => fetch(url + '/api/state', { signal: AbortSignal.timeout(1500) })
        .then(r => r.ok).catch(() => false);

    probe().then(async (up) => {
        if (up) {
            logger.info('CTF 4 (Deadlock Engine) already listening', { url });
            return;
        }
        const child = spawn(process.execPath, [entry], {
            env: Object.assign({}, process.env, { PORT: String(port) }),
            stdio: ['ignore', 'ignore', 'pipe']
        });
        child.once('error', (err) => logger.warn('CTF 4 spawn failed', { message: err.message }));
        child.once('exit', (code, signal) => logger.warn('CTF 4 stopped', { code, signal }));
        if (child.stderr) {
            child.stderr.on('data', (d) => {
                const line = String(d).trim();
                if (line) logger.warn('CTF 4', { line: line.slice(0, 240) });
            });
        }
        stopCtf4 = () => { try { child.kill('SIGTERM'); } catch (e) { /* already gone */ } };
        setTimeout(async () => {
            const nowUp = await probe();
            logger.info(nowUp ? 'CTF 4 (Deadlock Engine) attached' : 'CTF 4 not reachable yet', { url });
        }, 1500).unref();
    }).catch(() => { /* probe failure is non-fatal */ });
}

/* ----------------------------------------------------------------------
   CTF 5 — THE LAST GATEKEEPER. The existing `CTF 5 - THE LAST GATEKEEPER/`
   node attached to the BIOARCHIVE terminal (CTF 5, zone_bio).
   config/ctf-links.js points at http://127.0.0.1:8083. Same best-effort
   contract as the others:
     • CTF5_AUTOSTART=false  → never started here
     • CTF5_PORT             → port to check/spawn on (default 8083)
   ---------------------------------------------------------------------- */
let stopCtf5 = null;
function startRedZoneCtf5() {
    if (process.env.CTF5_AUTOSTART === 'false') return;
    const port = Number(process.env.CTF5_PORT || 8083);
    const entry = path.join(__dirname, '..', 'CTF 5 - THE LAST GATEKEEPER', 'server', 'server.js');
    if (!fs.existsSync(entry)) return;

    const url = 'http://127.0.0.1:' + port;
    const probe = () => fetch(url + '/api/status', { signal: AbortSignal.timeout(1500) })
        .then(r => r.ok).catch(() => false);

    probe().then(async (up) => {
        if (up) {
            logger.info('CTF 5 (Last Gatekeeper) already listening', { url });
            return;
        }
        const child = spawn(process.execPath, [entry], {
            env: Object.assign({}, process.env, { PORT: String(port) }),
            stdio: ['ignore', 'ignore', 'pipe']
        });
        child.once('error', (err) => logger.warn('CTF 5 spawn failed', { message: err.message }));
        child.once('exit', (code, signal) => logger.warn('CTF 5 stopped', { code, signal }));
        if (child.stderr) {
            child.stderr.on('data', (d) => {
                const line = String(d).trim();
                if (line) logger.warn('CTF 5', { line: line.slice(0, 240) });
            });
        }
        stopCtf5 = () => { try { child.kill('SIGTERM'); } catch (e) { /* already gone */ } };
        setTimeout(async () => {
            const nowUp = await probe();
            logger.info(nowUp ? 'CTF 5 (Last Gatekeeper) attached' : 'CTF 5 not reachable yet', { url });
        }, 1500).unref();
    }).catch(() => { /* probe failure is non-fatal */ });
}

async function main() {
    const problems = env.validate();
    if (problems.length) {
        problems.forEach(p => logger.error('configuration error', { problem: p }));
        process.exit(1);
    }

    // Idempotent schema + seed so a fresh deploy works with zero manual steps.
    try {
        const { migrate } = require('./db/migrate');
        const migration = await migrate();
        const { seed } = require('./db/seed');
        const seeded = await seed();
        logger.info('startup database ready', { migrations: migration.applied, seeded });
    } catch (err) {
        logger.error('database initialization failed', { message: err.message });
        if (env.isProd) process.exit(1);
        logger.warn('continuing without a database — /api/health will report degraded');
    }

    const app = createApp();
    const server = app.listen(env.PORT, () => {
        logger.info('THE LAST DATASET server listening', {
            port: env.PORT,
            env: env.NODE_ENV,
            game: `http://localhost:${env.PORT}/`,
            dashboard: `http://localhost:${env.PORT}/dashboard`
        });
        startRedZoneCtf1(); // attach the provided Red Zone CTF 1 backend (Ghost Signal)
        startRedZoneCtf2(); // attach the existing Red Zone CTF 2 node (Sanctuary Archive)
        startRedZoneCtf3(); // attach the existing Red Zone CTF 3 node (Child Dataset)
        startRedZoneCtf4(); // attach the existing Bonus CTF node (Central Atrium)
        startRedZoneCtf5(); // attach the existing Last Gatekeeper node (Bioarchive)
    });

    const shutdown = (signal) => async () => {
        logger.info('shutting down', { signal });
        if (stopCtf1) { try { stopCtf1(); } catch (e) { /* ignore */ } }
        if (stopCtf2) { try { stopCtf2(); } catch (e) { /* ignore */ } }
        if (stopCtf3) { try { stopCtf3(); } catch (e) { /* ignore */ } }
        if (stopCtf4) { try { stopCtf4(); } catch (e) { /* ignore */ } }
        if (stopCtf5) { try { stopCtf5(); } catch (e) { /* ignore */ } }
        server.close(async () => {
            await db.close().catch(() => {});
            process.exit(0);
        });
        setTimeout(() => process.exit(1), 8000).unref();
    };
    process.on('SIGINT', shutdown('SIGINT'));
    process.on('SIGTERM', shutdown('SIGTERM'));
    process.on('unhandledRejection', (err) => {
        logger.error('unhandled rejection', { message: err && err.message, stack: err && err.stack });
    });

    return server;
}

if (require.main === module) {
    main().catch((err) => {
        logger.error('server failed to start', { message: err.message, stack: err.stack });
        process.exit(1);
    });
}

module.exports = { main };
