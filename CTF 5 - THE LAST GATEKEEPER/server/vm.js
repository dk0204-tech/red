'use strict';
/*
 * CTF 5 — isolated local challenge VM (Windows development hosts only).
 *
 * The gatekeeper ELF is a Linux x86-64 binary. On hosts without Docker or
 * WSL, this module boots a minimal, fully local Linux guest with qemu-system
 * and forwards a host port to the guest's challenge listener:
 *
 *     host 127.0.0.1:VM_HOST_PORT  --->  guest :2323 (tcpsvd → gatekeeper)
 *
 * Guest image contents (challenge/runtime/kernel/):
 *     vmlinuz-virt     Alpine Linux virt kernel (virtio built-in)
 *     busybox          static busybox (init shell + tcpsvd)
 *     initramfs.cpio.gz built by scripts/fetch-runtime.mjs; runs:
 *                       tcpsvd -v 0.0.0.0 2323 /gatekeeper
 *
 * The ELF inside the guest is the same unmodified challenge binary.
 * Linux/Docker deployments never use this path (they spawn the ELF natively).
 */
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const cfg = require('./config');

let child = null;
let booting = null;
let accel = null;

function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

function artifactsPresent() {
  return exists(cfg.QEMU_BIN) && exists(cfg.QEMU_KERNEL) && exists(cfg.QEMU_INITRAMFS);
}

function qemuReadyPort() {
  return cfg.VM_HOST_PORT;
}

function probePort(port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    const done = (ok) => {
      sock.removeAllListeners();
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.on('connect', () => done(true));
    sock.on('error', () => done(false));
  });
}

function detectAccel() {
  if (accel) return accel;
  accel = 'tcg';
  try {
    const r = spawnSync(cfg.QEMU_BIN, ['-accel', 'help'], { windowsHide: true, encoding: 'utf8', timeout: 10000 });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    if (/\bwhpx\b/i.test(out)) accel = 'whpx';
  } catch { /* default to tcg */ }
  return accel;
}

function vmLogPath() {
  return path.join(cfg.DATA_DIR, 'vm-serial.log');
}

function startProcess() {
  fs.mkdirSync(cfg.DATA_DIR, { recursive: true });
  const a = detectAccel();
  const args = [
    '-machine', 'q35',
    '-accel', a === 'whpx' ? 'whpx,kernel-irqchip=off' : 'tcg',
    '-m', String(cfg.VM_RAM),
    '-smp', '1',
    '-kernel', cfg.QEMU_KERNEL,
    '-initrd', cfg.QEMU_INITRAMFS,
    '-append', 'console=ttyS0 quiet rdinit=/init panic=-1',
    '-netdev', `user,id=n0,hostfwd=tcp:127.0.0.1:${cfg.VM_HOST_PORT}-:2323`,
    '-device', 'virtio-net-pci,netdev=n0',
    '-display', 'none',
    '-serial', `file:${vmLogPath()}`,
    '-no-reboot',
  ];
  const log = fs.createWriteStream(path.join(cfg.DATA_DIR, 'vm-qemu.log'), { flags: 'a' });
  child = spawn(cfg.QEMU_BIN, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  child.stderr && child.stderr.on('data', (b) => log.write(b));
  child.on('error', (err) => {
    log.write(`\n[qemu spawn error] ${err.message}\n`);
    child = null;
  });
  child.on('close', (code, signal) => {
    log.write(`\n[qemu exited] code=${code} signal=${signal}\n`);
    child = null;
  });
  return child;
}

async function waitReady(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probePort(qemuReadyPort())) return true;
    if (!child) return false; // qemu died during boot
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/** Ensures the challenge VM is running and its port is reachable. */
async function ensureVm() {
  if (await probePort(qemuReadyPort())) return { started: false }; // already up (maybe externally)
  if (booting) { await booting; return { started: true }; }
  if (!artifactsPresent()) {
    throw new Error('challenge VM artifacts missing — run `npm run runtime:fetch`');
  }
  booting = (async () => {
    startProcess();
    // TCG cold boot of a minimal kernel is ~15-45s; WHPX is a few seconds.
    const ok = await waitReady(150000);
    if (!ok) {
      throw new Error(`challenge VM did not become ready on port ${cfg.VM_HOST_PORT} (see ${cfg.DATA_DIR}/vm-serial.log)`);
    }
  })();
  try {
    await booting;
  } finally {
    booting = null;
  }
  return { started: true };
}

/** Stops a VM we started (external VMs are left alone). */
function stopVm() {
  if (child) {
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
    setTimeout(() => { try { child && child.kill('SIGKILL'); } catch { /* ignore */ } }, 3000).unref();
    child = null;
  }
}

module.exports = { artifactsPresent, ensureVm, stopVm, detectAccel, probePort, startProcess };
