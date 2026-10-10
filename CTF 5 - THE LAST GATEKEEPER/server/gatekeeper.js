'use strict';
/*
 * CTF 5 — live gatekeeper session backends.
 *
 * The challenge itself is the unmodified ELF shipped in the player package
 * (challenge/gatekeeper). This module only decides HOW a session is obtained:
 *
 *   1. tcp   — connect to an external challenge service
 *              (GATEKEEPER_TCP_HOST/PORT, e.g. the player package's Docker
 *              container or any Linux host running challenge/server.py)
 *   2. spawn — spawn the ELF directly (Linux hosts / Docker image)
 *   3. vm    — Windows dev hosts: talk to the local isolated challenge VM
 *              (see vm.js — a qemu-system Linux guest that runs the same ELF)
 *
 * No mode alters the binary, its vulnerabilities or its flag.
 */
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const cfg = require('./config');
const vm = require('./vm');

function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

function resolveMode() {
  if (cfg.GATEKEEPER_TCP_HOST && cfg.GATEKEEPER_TCP_PORT > 0) {
    return {
      kind: 'tcp',
      label: `external service ${cfg.GATEKEEPER_TCP_HOST}:${cfg.GATEKEEPER_TCP_PORT}`,
      ok: true,
      host: cfg.GATEKEEPER_TCP_HOST,
      port: cfg.GATEKEEPER_TCP_PORT,
    };
  }
  if (process.platform === 'linux') {
    if (exists(cfg.GATEKEEPER_BIN)) {
      return { kind: 'spawn', label: 'local gatekeeper process', ok: true, bin: cfg.GATEKEEPER_BIN };
    }
    return { kind: 'unavailable', label: 'spawn', ok: false, detail: `gatekeeper binary missing at ${cfg.GATEKEEPER_BIN}` };
  }
  // Windows (or other non-Linux) development host: isolated challenge VM.
  if (vm.artifactsPresent()) {
    return {
      kind: 'vm',
      label: `local challenge VM (qemu, port ${cfg.VM_HOST_PORT})`,
      ok: true,
      host: '127.0.0.1',
      port: cfg.VM_HOST_PORT,
    };
  }
  return {
    kind: 'unavailable',
    label: 'no backend',
    ok: false,
    detail:
      'No Linux runtime found. Run `npm run runtime:fetch` to provision the local challenge VM, ' +
      'or point GATEKEEPER_TCP_HOST/PORT at a Linux/Docker deployment of challenge/server.py.',
  };
}

function describe() {
  const mode = resolveMode();
  return { mode: mode.kind, label: mode.label, ok: !!mode.ok && mode.kind !== 'unavailable', detail: mode.detail || null };
}

function tcpSession(host, port, hooks) {
  const sock = net.connect({ host, port });
  let ended = false;
  const finish = (why) => {
    if (ended) return;
    ended = true;
    try { sock.destroy(); } catch { /* ignore */ }
    hooks.onEnd && hooks.onEnd(why);
  };
  sock.on('connect', () => hooks.onOpen && hooks.onOpen());
  sock.on('data', (buf) => hooks.onData && hooks.onData(buf));
  sock.on('error', (err) => finish(`socket error: ${err.message}`));
  sock.on('close', () => finish('closed'));
  return {
    kind: 'tcp',
    write(buf) { if (!ended && sock.writable) sock.write(buf); },
    close() { finish('closed by client'); },
  };
}

function spawnSession(bin, hooks) {
  let child;
  try {
    child = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  } catch (err) {
    hooks.onEnd && hooks.onEnd(`spawn failed: ${err.message}`);
    return { kind: 'spawn', write() {}, close() {} };
  }
  let ended = false;
  const finish = (why) => {
    if (ended) return;
    ended = true;
    hooks.onEnd && hooks.onEnd(why);
  };
  child.on('error', (err) => finish(`spawn error: ${err.message}`));
  child.stdout && child.stdout.on('data', (buf) => hooks.onData && hooks.onData(buf));
  child.stderr && child.stderr.on('data', () => { /* challenge diagnostics stay server-side */ });
  child.on('close', () => finish('process exited'));
  hooks.onOpen && hooks.onOpen();
  return {
    kind: 'spawn',
    write(buf) { if (!ended && child.stdin && child.stdin.writable) { try { child.stdin.write(buf); } catch { /* ignore */ } } },
    close() {
      if (ended) return;
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      finish('closed by client');
    },
  };
}

/**
 * Opens one live gatekeeper session.
 * hooks: { onOpen?, onData(Buffer), onEnd(reason), onFlag(candidate) }
 * Returns a session handle { write(buf), close(), kind }.
 */
async function openSession(hooks) {
  const mode = resolveMode();
  if (mode.kind === 'unavailable') {
    const detail = mode.detail || 'challenge backend unavailable';
    hooks.onEnd && hooks.onEnd(detail);
    return { kind: 'unavailable', write() {}, close() {} };
  }

  // Sniff service→client bytes for the real flag so a live exploit performed
  // over nc (outside the browser) still records completion server-side.
  const sniffer = createSniffer((candidate) => hooks.onFlag && hooks.onFlag(candidate));
  const wrapped = Object.assign({}, hooks, {
    onData(buf) {
      sniffer.push(buf);
      hooks.onData && hooks.onData(buf);
    },
  });

  if (mode.kind === 'spawn') {
    return spawnSession(mode.bin, wrapped);
  }
  if (mode.kind === 'vm') {
    await vm.ensureVm(); // resolves when guest :2323 is reachable (or throws)
    return tcpSession(mode.host, mode.port, wrapped);
  }
  return tcpSession(mode.host, mode.port, wrapped);
}

/*
 * Rolling-window scanner for flag-shaped strings in a byte stream whose
 * chunks may split a candidate. Validates against the server-side
 * commitment — nothing flag-like is returned unless it IS the answer.
 */
function createSniffer(onCandidate) {
  let tail = '';
  return {
    push(buf) {
      const text = tail + buf.toString('latin1');
      const re = /RZ\{[A-Za-z0-9_-]{6,64}\}/g;
      let m;
      while ((m = re.exec(text)) !== null) {
        const { findFlagInOutput } = require('./validate');
        const good = findFlagInOutput(m[0]);
        if (good) {
          onCandidate(good);
          return;
        }
      }
      // Keep only a window large enough to catch a split candidate.
      tail = text.slice(Math.max(0, text.length - 72));
      if (tail.includes('{')) {
        const i = tail.lastIndexOf('RZ{');
        if (i >= 0) tail = tail.slice(i);
        else if (tail.length > 8) tail = '';
      }
    },
  };
}

module.exports = { describe, openSession, resolveMode, createSniffer };
