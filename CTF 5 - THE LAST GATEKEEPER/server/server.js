'use strict';
/*
 * CTF 5 — THE LAST GATEKEEPER: SPLIT SEAL — integration server.
 *
 * Serves:
 *   - frontend/            world map, cinematic intro, live terminal UI
 *   - GET  /api/status     service + completion state (read-only)
 *   - GET  /api/state      completion state (read-only)
 *   - POST /api/flag       server-side flag validation (constant-time)
 *   - WS   /ws             terminal bridge to the real gatekeeper service
 *   - TCP  :31337          raw passthrough for `nc HOST 31337`
 *
 * SECURITY MODEL
 *   - Static root is frontend/ ONLY. Organizer material, server source,
 *     challenge binaries and test harnesses are never served.
 *   - The expected flag exists only as a SHA-256 commitment inside private
 *     server code (or the SPLIT_SEAL_FLAG env var at runtime).
 *   - Completion flips ONLY after server-side validation of a correct flag
 *     (submitted or observed on a live session). Client state is cosmetic.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const cfg = require('./config');
const progress = require('./progress');
const validate = require('./validate');
const bridge = require('./bridge');
const gatekeeper = require('./gatekeeper');

/* ------------------------------------------------------------------ static */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function send(res, code, body, headers) {
  res.writeHead(code, Object.assign({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store' }, headers || {}));
  res.end(body);
}

function sendJson(res, code, obj) {
  send(res, code, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}

function safeStaticPath(urlPath) {
  let p;
  try {
    p = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  if (p.includes('\0')) return null;
  p = p.replace(/\\/g, '/');
  if (p.split('/').includes('..')) return null;
  if (!p.startsWith('/')) return null;
  const rel = p === '/' ? 'index.html' : p.slice(1);
  const abs = path.resolve(cfg.FRONTEND_DIR, rel);
  const root = path.resolve(cfg.FRONTEND_DIR);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null; // traversal guard
  return abs;
}

function serveStatic(req, res, urlPath) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'method not allowed', { 'Content-Type': 'text/plain' });
    return;
  }
  const abs = safeStaticPath(urlPath);
  if (!abs) {
    send(res, 404, 'not found', { 'Content-Type': 'text/plain' });
    return;
  }
  fs.readFile(abs, (err, buf) => {
    if (err || !fs.statSync(abs).isFile()) {
      send(res, 404, 'not found', { 'Content-Type': 'text/plain' });
      return;
    }
    const type = MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream';
    send(res, 200, req.method === 'HEAD' ? '' : buf, { 'Content-Type': type, 'Content-Length': String(buf.length) });
  });
}

/* ------------------------------------------------------------- rate limits */
const attempts = new Map(); // ip -> { times: [], blockedUntil }
function rateKey(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}
function rateCheck(ip) {
  const now = Date.now();
  let e = attempts.get(ip);
  if (!e) return { ok: true };
  if (e.blockedUntil && now < e.blockedUntil) return { ok: false, retryAfterMs: e.blockedUntil - now };
  e.times = e.times.filter((t) => now - t < cfg.RATE_LIMIT_WINDOW_MS);
  return { ok: true };
}
function rateFail(ip) {
  const now = Date.now();
  let e = attempts.get(ip);
  if (!e) e = { times: [], blockedUntil: 0 };
  e.times.push(now);
  if (e.times.length >= cfg.RATE_LIMIT_MAX) e.blockedUntil = now + cfg.RATE_LIMIT_WINDOW_MS;
  attempts.set(ip, e);
}
function rateClear(ip) {
  attempts.delete(ip);
}

/* -------------------------------------------------------------- request api */
function readBody(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleApi(req, res, urlPath) {
  if (req.method === 'GET' && (urlPath === '/api/status' || urlPath === '/api/state')) {
    const backend = gatekeeper.describe();
    const st = progress.state();
    sendJson(res, 200, {
      service: 'CTF 5 — THE LAST GATEKEEPER: SPLIT SEAL',
      zone: 'RED-ZONE-04',
      event: 'THE LAST DATASET · TDA · COGNITIA \'26',
      backend,
      tcpPort: cfg.TCP_PORT > 0 ? cfg.TCP_PORT : null,
      solved: st.solved,
      solvedAt: st.solvedAt,
      /* how completion was first validated: 'submit' | 'observed' | null */
      method: st.method,
      sessions: bridge.stats(),
    });
    return true;
  }
  if (req.method === 'POST' && urlPath === '/api/flag') {
    const ip = rateKey(req);
    const gate = rateCheck(ip);
    if (!gate.ok) {
      sendJson(res, 429, { ok: false, msg: 'TOO MANY ATTEMPTS — wait and retry.', retryAfterMs: gate.retryAfterMs });
      return true;
    }
    let body;
    try {
      body = JSON.parse((await readBody(req)) || '{}');
    } catch {
      sendJson(res, 400, { ok: false, msg: 'malformed request' });
      return true;
    }
    // A body without a string `flag` field is a malformed request (400) —
    // not a rejected flag attempt, so it does not consume the rate budget.
    const candidate = typeof body.flag === 'string' ? body.flag.trim() : null;
    if (candidate === null) {
      sendJson(res, 400, { ok: false, msg: 'malformed request' });
      return true;
    }
    if (validate.isValidFlag(candidate)) {
      rateClear(ip);
      progress.award('submit');
      sendJson(res, 200, { ok: true, solved: true, msg: 'ARCHIVE FRAGMENT VERIFIED' });
    } else {
      rateFail(ip);
      sendJson(res, 200, { ok: false, solved: progress.state().solved, msg: 'REJECTED — the gatekeeper does not accept this fragment.' });
    }
    return true;
  }
  return false;
}

/* -------------------------------------------------------------------- boot */
function createServer() {
  const server = http.createServer(async (req, res) => {
    const urlPath = req.url || '/';
    try {
      if (urlPath.startsWith('/api/')) {
        const handled = await handleApi(req, res, urlPath);
        if (!handled) send(res, 404, 'not found', { 'Content-Type': 'text/plain' });
        return;
      }
      serveStatic(req, res, urlPath);
    } catch (err) {
      console.error(`[http] error: ${err.message}`);
      if (!res.headersSent) send(res, 500, 'internal error', { 'Content-Type': 'text/plain' });
      else try { res.end(); } catch { /* ignore */ }
    }
  });

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
  wss.on('connection', (ws) => {
    bridge.attachWebSocket(ws);
  });

  return server;
}

function main() {
  console.log('==============================================================');
  console.log(' CTF 5 — THE LAST GATEKEEPER: SPLIT SEAL');
  console.log(' PRALAYA // RED-ZONE-04 // THE ARCHIVE IS STILL ALIVE');
  console.log('==============================================================');
  const backend = gatekeeper.describe();
  console.log(`[backend] ${backend.mode} — ${backend.label}${backend.ok ? '' : ` — UNAVAILABLE (${backend.detail})`}`);
  if (process.env.SPLIT_SEAL_FLAG) console.log('[config] flag override taken from SPLIT_SEAL_FLAG environment variable');
  progress.state();

  // Windows dev hosts: warm-boot the isolated challenge VM right away so the
  // first player session connects instantly instead of waiting for the guest.
  if (backend.mode === 'vm') {
    require('./vm')
      .ensureVm()
      .then(() => console.log('[vm] challenge VM ready'))
      .catch((err) => console.error(`[vm] warm-up failed: ${err.message}`));
  }

  const server = createServer();
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[http] port ${cfg.PORT} already in use. Set PORT=<other> and restart.`);
      process.exit(1);
    }
    throw err;
  });
  server.listen(cfg.PORT, () => {
    console.log(`[http] frontend + api on http://127.0.0.1:${cfg.PORT}/  (ws: /ws)`);
  });

  let rawTcp = null;
  if (cfg.TCP_PORT > 0) rawTcp = bridge.startRawTcp();

  const shutdown = () => {
    console.log('\n[shutdown]');
    try { server.close(); } catch { /* ignore */ }
    try { rawTcp && rawTcp.close(); } catch { /* ignore */ }
    try { require('./vm').stopVm(); } catch { /* ignore */ }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) main();

module.exports = { createServer, safeStaticPath };
