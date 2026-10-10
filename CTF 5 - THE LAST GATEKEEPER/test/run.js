#!/usr/bin/env node
/*
 * CTF 5 — THE LAST GATEKEEPER: SPLIT SEAL — integration test suite.
 *
 * Plain-Node assertions (no framework), consistent with the other suites in
 * this event. Spawns isolated server instances on test ports with a temp
 * DATA_DIR so real completion state is never touched.
 *
 * Run: npm test
 *
 * Honesty policy: every check prints PASS / FAIL / SKIP with a reason.
 * Backend-dependent checks are SKIPPED (not silently passed) when no Linux
 * runtime is available on the host.
 */
'use strict';

const http = require('http');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.TEST_PORT || 18083);
const TCP_PORT = Number(process.env.TEST_TCP_PORT || 18137);
const FLAG_RE = /RZ\{[A-Za-z0-9_-]{6,64}\}/;

let passed = 0, failed = 0, skipped = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; failures.push(name); console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}
function skip(name, why) { skipped++; console.log(`  SKIP  ${name} — ${why}`); }
function section(t) { console.log(`\n== ${t} ==`); }

function req(method, urlPath, body, headers) {
  return new Promise((resolve, reject) => {
    // encodeURI: traversal paths may contain literal spaces/parens that
    // http.request rejects; already-%-encoded sequences are left untouched.
    const r = http.request({ host: '127.0.0.1', port: PORT, method, path: encodeURI(urlPath), headers: headers || {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    if (body !== undefined) r.write(body);
    r.end();
  });
}

async function getJson(urlPath) {
  const r = await req('GET', urlPath);
  try { return { status: r.status, data: JSON.parse(r.body) }; } catch { return { status: r.status, data: null, raw: r.body }; }
}

function waitHttp(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return (async function probe() {
    while (Date.now() < deadline) {
      try { const r = await req('GET', '/api/status'); if (r.status === 200) return true; } catch { /* not up */ }
      await new Promise((r) => setTimeout(r, 400));
    }
    return false;
  })();
}

function startServer(env) {
  const child = spawn(process.execPath, ['server/server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(PORT), TCP_PORT: String(TCP_PORT) }, env || {}),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', (b) => process.stderr.write(`[srv] ${b}`));
  return child;
}

function stopServer(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    child.once('exit', () => resolve());
    child.kill();
    setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 2500).unref?.();
  });
}

function tcpBanner(port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    let buf = '';
    const done = (v, err) => { sock.destroy(); err ? reject(err) : resolve(v); };
    sock.setTimeout(timeoutMs, () => done(null, new Error('timeout waiting for banner')));
    sock.on('data', (b) => { buf += b.toString('latin1'); if (buf.includes('Archivist identification: ')) done(buf); });
    sock.on('error', (e) => done(null, e));
  });
}

/* ===================================================================== main */
(async () => {
  console.log('CTF 5 — THE LAST GATEKEEPER: SPLIT SEAL — integration tests');
  console.log(`server under test: http://127.0.0.1:${PORT}/  raw tcp: ${TCP_PORT}`);

  const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'ctf5-test-'));
  let srv = startServer({ DATA_DIR: tmpData, RATE_LIMIT_MAX: '5' });
  const up = await waitHttp(30000);
  ok('server starts and serves /api/status', up);
  if (!up) { await stopServer(srv); report(); return; }

  /* ---------------------------------------------------- static + security */
  section('frontend & security');
  const idx = await req('GET', '/');
  ok('GET / returns 200 html', idx.status === 200 && idx.headers['content-type'].includes('text/html'));
  ok('index brands the challenge as CTF 5', /CTF 5/.test(idx.body) && /THE LAST GATEKEEPER/.test(idx.body));
  // A mislabel would place "CTF 4" next to the split-seal identity on the same
  // line; the map legitimately links "CTF 4 · BONUS" (THE SLEEPER) elsewhere.
  ok(
    'index never labels split seal as CTF 4',
    !/CTF 4[^\n]{0,160}(SPLIT SEAL|GATEKEEPER)/i.test(idx.body) &&
      !/(SPLIT SEAL|THE LAST GATEKEEPER)[^\n]{0,160}CTF 4/i.test(idx.body)
  );
  ok('recovery sequence present', /GATEKEEPER BYPASSED/.test(idx.body) && /ARCHIVE FRAGMENT RECOVERED/.test(idx.body));
  ok('no flag-shaped literal in served html', !FLAG_RE.test(idx.body));
  for (const f of ['/css/main.css', '/js/app.js', '/js/terminal.js', '/favicon.svg']) {
    const r = await req('GET', f);
    ok(`serves ${f}`, r.status === 200);
    ok(`no flag-shaped literal in ${f}`, !FLAG_RE.test(r.body));
  }

  // path traversal / private-file exposure attempts
  const traversals = [
    '/../CTF4_Split_Seal_V3_ORGANIZER/ORGANIZER_GUIDE.md',
    '/%2e%2e/CTF4_Split_Seal_V3_ORGANIZER/ORGANIZER_GUIDE.md',
    '/..%2f..%2fserver/config.js',
    '/server/config.js',
    '/challenge/gatekeeper',
    '/test/solve.mjs',
    '/../../CTF4_Split_Seal_V3_PLAYER (1)/gatekeeper',
  ];
  for (const t of traversals) {
    const r = await req('GET', t);
    ok(`blocked: ${t}`, r.status === 404 && !/RZ\{/.test(r.body) && !/witness|route_seal|split_seal/i.test(r.body), `status ${r.status}`);
  }
  const apiLeak = await req('GET', '/api/status');
  ok('no flag material in /api/status', !FLAG_RE.test(apiLeak.body) && !/cf7ade02/.test(apiLeak.body));

  /* ------------------------------------------------------------- api flow */
  section('flag API');
  const st0 = await getJson('/api/status');
  ok('/api/status shape', st0.data && st0.data.service && st0.data.backend && typeof st0.data.solved === 'boolean');
  ok('starts unsolved', st0.data.solved === false);

  const malformed = await req('POST', '/api/flag', JSON.stringify({ nope: 1 }), { 'Content-Type': 'application/json' });
  ok('malformed body → 400', malformed.status === 400);

  const bad1 = await req('POST', '/api/flag', JSON.stringify({ flag: 'RZ{deadbeefdeadbeefdeadbeefdeadbeef}' }), { 'Content-Type': 'application/json' });
  ok('well-shaped wrong flag rejected', bad1.status === 200 && JSON.parse(bad1.body).ok === false);
  const bad2 = await req('POST', '/api/flag', JSON.stringify({ flag: 'CTF5{not-even-the-right-shape}' }), { 'Content-Type': 'application/json' });
  ok('wrong-shape flag rejected', JSON.parse(bad2.body).ok === false);
  const st1 = await getJson('/api/status');
  ok('completion NOT forged by bad submissions', st1.data.solved === false);

  // rate limiting (limit=5 in this instance; 3 fails consumed above)
  let rateTriggered = false;
  for (let i = 0; i < 3 && !rateTriggered; i++) {
    const r = await req('POST', '/api/flag', JSON.stringify({ flag: `RZ{nope${i}nope}` }), { 'Content-Type': 'application/json' });
    if (r.status === 429) rateTriggered = true;
  }
  ok('rate limiter engages on repeated bad attempts', rateTriggered || (await req('POST', '/api/flag', JSON.stringify({ flag: 'RZ{nopeXnope}' }), { 'Content-Type': 'application/json' })).status === 429);

  await stopServer(srv);

  /* --------------------------------------- backend availability decision */
  const backend = (() => {
    try {
      const gk = require(path.join(ROOT, 'server', 'gatekeeper'));
      return gk.describe();
    } catch (e) { return { mode: 'unavailable', ok: false, detail: e.message }; }
  })();

  /* ------------------------------------------------- override-path server */
  section('organizer flag rotation (SPLIT_SEAL_FLAG override)');
  const TEST_FLAG = 'RZ{test_rotation_value_9a8b}';
  const tmpData2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ctf5-test2-'));
  srv = startServer({ DATA_DIR: tmpData2, SPLIT_SEAL_FLAG: TEST_FLAG, RATE_LIMIT_MAX: '20', TCP_PORT: '0' });
  ok('override instance up', await waitHttp(20000));
  const sub = await req('POST', '/api/flag', JSON.stringify({ flag: TEST_FLAG }), { 'Content-Type': 'application/json' });
  ok('env-override flag accepted via POST /api/flag', sub.status === 200 && JSON.parse(sub.body).ok === true);
  const stOv = await getJson('/api/status');
  ok('state solved after valid submit', stOv.data.solved === true);
  ok('solved state persisted to disk', fs.existsSync(path.join(tmpData2, 'progress.json')));
  await stopServer(srv);

  /* ----------------------------------------------- live-backend testing */
  section('live challenge backend');
  if (!backend.ok) {
    skip('WS bridge / raw TCP / full exploit', `backend unavailable: ${backend.detail}`);
    skip('emission auto-award + restart persistence', 'backend unavailable');
    cleanup(tmpData); cleanup(tmpData2);
    report();
    return;
  }

  // fresh instance against the real backend (default digest, no override)
  const tmpData3 = fs.mkdtempSync(path.join(os.tmpdir(), 'ctf5-test3-'));
  srv = startServer({ DATA_DIR: tmpData3, RATE_LIMIT_MAX: '20' });
  ok('live instance up', await waitHttp(20000));

  // raw TCP listener
  let banner = null;
  try { banner = await tcpBanner(TCP_PORT, 120000); } catch (e) { /* handled below */ }
  ok('raw TCP (nc :31337 style) serves real gatekeeper banner', !!banner && /PRALAYA \/\/ RED-ZONE-04 \/\/ SPLIT SEAL/.test(banner || ''), banner ? banner.slice(0, 80) : 'no banner');

  // WebSocket bridge: real bytes from the real process
  section('websocket bridge');
  const wsOk = await wsProbe();
  ok('WS /ws pipes real service banner + accepts input', wsOk.ok, wsOk.why);

  // full intended exploit via raw TCP (the nc path)
  section('intended exploit (private harness, raw TCP)');
  const solve = spawnSync(process.execPath, [path.join(__dirname, 'solve.mjs'), '127.0.0.1', String(TCP_PORT)], {
    encoding: 'utf8', timeout: 180000,
  });
  const solvedOut = `${solve.stdout || ''}${solve.stderr || ''}`;
  ok('solver completes intended multi-stage exploit', solve.status === 0 && /SOLVED: RZ\{/.test(solvedOut), solvedOut.split('\n').slice(-3).join(' | '));

  // emission sniffer must have validated + awarded completion server-side
  await new Promise((r) => setTimeout(r, 800));
  const stLive = await getJson('/api/status');
  ok('server auto-awarded completion from observed live output', stLive.data.solved === true);
  ok('award recorded as observed method', stLive.data.method === 'observed');

  // manual submit path also validates the real flag (learned at runtime, never in our source)
  const emitted = (solvedOut.match(/SOLVED: (RZ\{[A-Za-z0-9_-]{6,64}\})/) || [])[1];
  if (emitted) {
    const sub2 = await req('POST', '/api/flag', JSON.stringify({ flag: emitted }), { 'Content-Type': 'application/json' });
    ok('POST /api/flag accepts the real emitted flag', sub2.status === 200 && JSON.parse(sub2.body).ok === true);
  } else {
    skip('POST /api/flag with emitted flag', 'no emitted flag (solver failed)');
  }

  await stopServer(srv);

  // persistence across restart
  srv = startServer({ DATA_DIR: tmpData3, RATE_LIMIT_MAX: '20', TCP_PORT: '0' });
  ok('restarted instance up', await waitHttp(20000));
  const stRe = await getJson('/api/status');
  ok('completion persists across server restart', stRe.data.solved === true);
  await stopServer(srv);

  cleanup(tmpData); cleanup(tmpData2); cleanup(tmpData3);
  report();

  /* ------------------------------------------------------------- helpers */
  function cleanup(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }

  function wsProbe() {
    return new Promise((resolve) => {
      let WebSocket;
      try { WebSocket = require('ws'); } catch { return resolve({ ok: false, why: 'ws module missing' }); }
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
      let got = '';
      const done = (okv, why) => { try { ws.close(); } catch {} resolve({ ok: okv, why }); };
      ws.on('message', (data) => {
        got += Buffer.from(data).toString('latin1');
        if (got.includes('Archivist identification: ')) {
          ws.send('%p\n'); // harmless format-string probe — proves input path
          setTimeout(() => done(true), 500);
        }
      });
      ws.on('open', () => setTimeout(() => got.includes('Archivist') || done(false, 'no banner within timeout'), 90000));
      ws.on('error', (e) => done(false, e.message));
    });
  }

  function report() {
    console.log('\n==================================================');
    console.log(`PASS: ${passed}   FAIL: ${failed}   SKIP: ${skipped}`);
    if (failures.length) console.log('failing checks:\n  - ' + failures.join('\n  - '));
    console.log('==================================================');
    process.exit(failed ? 1 : 0);
  }
})().catch((e) => { console.error('test harness crashed:', e); process.exit(1); });
