'use strict';
/*
 * CTF 5 — THE LAST GATEKEEPER: SPLIT SEAL — private server configuration.
 *
 * SECURITY: This file is NOT served to clients (the HTTP static root is
 * frontend/ only). The expected flag is never stored here in literal form —
 * only a one-way SHA-256 commitment is kept, so the answer cannot be
 * recovered from server source, bundles, images or client-side code.
 *
 * Organizers can rotate the flag at runtime with the SPLIT_SEAL_FLAG
 * environment variable (never commit that value).
 */
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

/* SHA-256 of the expected flag string (one-way commitment). */
const FLAG_DIGEST = 'cf7ade027cd7cfaf13250a58d3ec5c334cf5426e1256ac169e414172c1cc8de2';

function intEnv(name, dflt) {
  const v = process.env[name];
  if (v === undefined || v === '') return dflt;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : dflt;
}

/* Flag shape accepted anywhere in this event (matches CTF 2 / CTF 3). */
const FLAG_RE = /^RZ\{[A-Za-z0-9_-]{6,64}\}$/;

function expectedDigest() {
  const override = process.env.SPLIT_SEAL_FLAG;
  if (override && FLAG_RE.test(override)) {
    return crypto.createHash('sha256').update(override, 'utf8').digest('hex');
  }
  return FLAG_DIGEST;
}

const cfg = {
  ROOT,
  FRONTEND_DIR: path.join(ROOT, 'frontend'),
  DATA_DIR: process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'server', 'data'),

  /* Web + API + WebSocket bridge */
  PORT: intEnv('PORT', 8083),

  /*
   * Raw TCP passthrough for `nc HOST 31337` (the connection method printed
   * in challenge/CHALLENGE.md). Set TCP_PORT=0 to disable.
   */
  TCP_PORT: intEnv('TCP_PORT', 31337),

  /* Where a live gatekeeper session is obtained (see gatekeeper.js). */
  GATEKEEPER_BIN: process.env.GATEKEEPER_BIN || path.join(ROOT, 'challenge', 'gatekeeper'),
  /* Private glibc 2.41 (Debian 13) for hosts whose system glibc predates the
   * ELF's GLIBC_2.38 requirement (Render native runtime = Debian 12). */
  GATEKEEPER_LOADER: process.env.GATEKEEPER_LOADER || path.join(ROOT, 'challenge', 'glibc', 'ld-linux-x86-64.so.2'),
  GATEKEEPER_GLIBC_DIR: process.env.GATEKEEPER_GLIBC_DIR || path.join(ROOT, 'challenge', 'glibc'),
  QEMU_BIN: process.env.QEMU_BIN || path.join(ROOT, 'challenge', 'runtime', 'qemu', 'bin', 'qemu-system-x86_64.exe'),
  QEMU_KERNEL: process.env.QEMU_KERNEL || path.join(ROOT, 'challenge', 'runtime', 'kernel', 'vmlinuz-virt'),
  QEMU_BUSYBOX: process.env.QEMU_BUSYBOX || path.join(ROOT, 'challenge', 'runtime', 'kernel', 'busybox'),
  QEMU_INITRAMFS: process.env.QEMU_INITRAMFS || path.join(ROOT, 'challenge', 'runtime', 'kernel', 'initramfs.cpio.gz'),
  VM_RAM: intEnv('VM_RAM_MB', 160),
  /* Host port the challenge VM forwards guest :2323 to. */
  VM_HOST_PORT: intEnv('VM_HOST_PORT', 13137),
  VM_AUTOSTART: process.env.VM_AUTOSTART === '1',

  /* External service mode (e.g. the player package's own Docker container). */
  GATEKEEPER_TCP_HOST: process.env.GATEKEEPER_TCP_HOST || '',
  GATEKEEPER_TCP_PORT: intEnv('GATEKEEPER_TCP_PORT', 0),

  /* Session hygiene */
  MAX_SESSIONS: intEnv('MAX_SESSIONS', 8),
  SESSION_IDLE_MS: intEnv('SESSION_IDLE_MS', 10 * 60 * 1000),
  SESSION_MAX_BYTES: intEnv('SESSION_MAX_BYTES', 4 * 1024 * 1024),

  /* Flag attempt rate limiting (per IP, sliding window) */
  RATE_LIMIT_MAX: intEnv('RATE_LIMIT_MAX', 8),
  RATE_LIMIT_WINDOW_MS: intEnv('RATE_LIMIT_WINDOW_MS', 10 * 60 * 1000),

  FLAG_RE,
  expectedDigest,
};

module.exports = cfg;
