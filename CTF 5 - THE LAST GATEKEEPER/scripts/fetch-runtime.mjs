#!/usr/bin/env node
/*
 * CTF 5 — THE LAST GATEKEEPER: SPLIT SEAL
 * Runtime provisioning for hosts that cannot execute the Linux gatekeeper
 * ELF directly (e.g. Windows dev machines without Docker/WSL).
 *
 *   npm run runtime:fetch
 *
 * Assembles challenge/runtime/ from public upstream artifacts:
 *
 *   qemu/            QEMU system emulator (MSYS2 ucrt64 build, no admin
 *                    rights required — files are extracted, not installed)
 *   kernel/          Alpine "virt" kernel + static busybox + initramfs
 *                    containing the unmodified challenge ELF
 *   .cache/          downloaded artifacts (safe to delete)
 *
 * The result boots an isolated Linux guest whose challenge listener is the
 * same gatekeeper binary the players receive. Linux/Docker hosts do not need
 * any of this (they run the ELF natively).
 *
 * Idempotent: skips work when runtime/.ready.json matches current inputs.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RT = path.join(ROOT, 'challenge', 'runtime');
const CACHE = path.join(ROOT, 'scripts', '.cache');
const DB_EXTRACT = path.join(CACHE, 'db');

/* ------------------------------------------------------------------ urls */
const MSYS2_REPO = 'https://repo.msys2.org/mingw/ucrt64';
const MSYS2_SITE = 'https://packages.msys2.org';
const QEMU_PKG_URL = `${MSYS2_REPO}/mingw-w64-ucrt-x86_64-qemu-11.1.2-1-any.pkg.tar.zst`;
const DB_URL = `${MSYS2_REPO}/ucrt64.db.tar.zst`;
const FILES_DB_URL = `${MSYS2_REPO}/ucrt64.files.tar.zst`;
const LINUX_VIRT_APK_URL = 'https://dl-cdn.alpinelinux.org/alpine/v3.22/main/x86_64/linux-virt-6.12.112-r0.apk';
const LINUX_VIRT_APK_NAME = 'linux-virt-6.12.112-r0.apk';
// The virt flavour ships its network stack as loadable modules; the kernel and
// these modules must come from the SAME package (vermagic must match).
const GUEST_NET_MODULES = [
  'net/core/failover.ko.gz',
  'drivers/net/net_failover.ko.gz',
  'drivers/net/virtio_net.ko.gz',
];
const BUSYBOX_URL = 'https://busybox.net/downloads/binaries/1.35.0-x86_64-linux-musl/busybox';
// gatekeeper needs GLIBC_2.38+ — Debian 13 (trixie) matches the reference
// python:3.12-slim image's runtime and provides glibc 2.41.
const LIBC6_URL = 'http://deb.debian.org/debian/pool/main/g/glibc/libc6_2.41-12+deb13u4_amd64.deb';

const tarCmd = process.platform === 'win32' ? 'C:\\Windows\\System32\\tar.exe' : 'tar';

function log(msg) { console.log(`[runtime] ${msg}`); }
function die(msg) { console.error(`[runtime] FATAL: ${msg}`); process.exit(1); }

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, ...opts });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')}\n${r.stdout || ''}\n${r.stderr || ''}`);
  }
  return r;
}

async function ensureFile(url, dest, label) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    log(`cache hit: ${label || path.basename(dest)}`);
    return dest;
  }
  ensureDir(path.dirname(dest));
  log(`downloading: ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  log(`  → ${path.basename(dest)} (${(buf.length / 1048576).toFixed(1)} MB)`);
  return dest;
}

/* ------------------------------------------------------------- PE parser */
function parsePeImports(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 0x40 || buf.readUInt16LE(0) !== 0x5a4d) return [];
  const pe = buf.readUInt32LE(0x3c);
  if (buf.readUInt32LE(pe) !== 0x00004550) return [];
  const numSections = buf.readUInt16LE(pe + 6);
  const optSize = buf.readUInt16LE(pe + 20);
  const opt = pe + 24;
  const magic = buf.readUInt16LE(opt);
  const ddOffset = magic === 0x20b ? opt + 112 : opt + 96; // PE32+ / PE32
  const importRva = buf.readUInt32LE(ddOffset + 8); // data dir[1]
  if (importRva === 0) return [];
  const sects = [];
  for (let i = 0; i < numSections; i++) {
    const s = opt + optSize + i * 40;
    sects.push({
      va: buf.readUInt32LE(s + 12),
      vsz: buf.readUInt32LE(s + 8),
      raw: buf.readUInt32LE(s + 20),
      rsz: buf.readUInt32LE(s + 16),
    });
  }
  const rva2off = (rva) => {
    for (const s of sects) {
      if (rva >= s.va && rva < s.va + Math.max(s.vsz, s.rsz)) return s.raw + (rva - s.va);
    }
    return -1;
  };
  const out = [];
  let descOff = rva2off(importRva);
  if (descOff < 0) return [];
  for (let i = 0; i < 256; i++) {
    const nameRva = buf.readUInt32LE(descOff + 12);
    if (nameRva === 0) break;
    const no = rva2off(nameRva);
    if (no < 0) break;
    let end = no;
    while (end < buf.length && buf[end] !== 0) end++;
    out.push(buf.toString('latin1', no, end));
    descOff += 20;
  }
  return out;
}

/* ---------------------------------------------------- pacman db parsing */
function extractArchive(file, destDir) {
  ensureDir(destDir);
  run(tarCmd, ['-xf', file, '-C', destDir]);
}

function parsePacmanDb(dbRoot) {
  // Returns a Map with two kinds of keys:
  //   lowercased file basename -> { name, filename, version }  (only for the files db)
  //   lowercased package name  -> { name, filename, version }  (always)
  const map = new Map();
  if (!fs.existsSync(dbRoot)) return map;
  for (const entry of fs.readdirSync(dbRoot)) {
    const entryDir = path.join(dbRoot, entry);
    if (!fs.statSync(entryDir).isDirectory()) continue;
    let filename = null, pkgName = null, version = null;
    const descPath = path.join(entryDir, 'desc');
    if (fs.existsSync(descPath)) {
      const desc = fs.readFileSync(descPath, 'utf8');
      const grab = (tag) => {
        const m = desc.match(new RegExp(`%${tag}%\\n([^\\n]+)`));
        return m ? m[1] : null;
      };
      filename = grab('FILENAME');
      pkgName = grab('NAME');
      version = grab('VERSION');
    }
    const meta = { name: pkgName, filename, version };
    if (pkgName) map.set(pkgName.toLowerCase(), meta);
    const filesPath = path.join(entryDir, 'files');
    if (fs.existsSync(filesPath)) {
      const lines = fs.readFileSync(filesPath, 'utf8').split('\n');
      let inFiles = false;
      for (const line of lines) {
        if (line === '%FILES%') { inFiles = true; continue; }
        if (line.startsWith('%')) { inFiles = false; continue; }
        if (inFiles && line.trim()) {
          const fp = line.trim();
          const base = path.posix.basename(fp).toLowerCase();
          const depth = fp.split('/').length;
          const prev = map.get(base);
          // Prefer canonical runtime locations (usr/bin/…) over copies buried
          // in package-private dirs — e.g. python wheels bundle SDL2.dll and
          // zlib1.dll deep inside site-packages, alphabetically earlier than
          // the real SDL2/zlib packages.
          if (!prev) map.set(base, { ...meta, depth });
          else if (typeof prev.depth === 'number' && depth < prev.depth) {
            map.set(base, { ...meta, depth });
          }
        }
      }
    }
  }
  return map;
}

/* --------------------------------------------------------- copy helpers */
function copyDir(src, dest, filter) {
  ensureDir(dest);
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d, filter);
    else if (!filter || filter(e.name, s)) fs.copyFileSync(s, d);
  }
}

/* -------------------------------------------------------------- initramfs */
function initScript(modGuestFiles) {
  // net_failover must load before virtio_net; failures are non-fatal warnings.
  const insmods = modGuestFiles
    .map((p) => `$B insmod /${p} || echo "[guest] warn: module ${path.posix.basename(p)} not loaded"`)
    .join('\n');
  return `#!/bin/busybox sh
# CTF 5 challenge VM — minimal guest init (built by scripts/fetch-runtime.mjs)
# Boots the unmodified gatekeeper ELF behind a TCP listener on guest :2323.
B=/bin/busybox
$B mount -t proc proc /proc 2>/dev/null
$B mount -t sysfs sysfs /sys 2>/dev/null
$B mount -t devtmpfs devtmpfs /dev 2>/dev/null || {
  $B mkdir -p /dev
  $B mknod -m 666 /dev/null c 13 1 2>/dev/null
  $B mknod -m 666 /dev/zero c 13 5 2>/dev/null
  $B mknod -m 666 /dev/random c 13 8 2>/dev/null
  $B mknod -m 666 /dev/urandom c 13 9 2>/dev/null
}
$B mount -t tmpfs -o size=16m tmpfs /tmp 2>/dev/null
$B hostname red-zone-04

# virtio-net ships as loadable modules in the virt flavour
${insmods}

$B ip link set lo up 2>/dev/null
$B ip link set eth0 up 2>/dev/null || $B ifconfig eth0 up 2>/dev/null
$B ip addr add 10.0.2.15/24 dev eth0 2>/dev/null || true
$B ip route add default via 10.0.2.2 dev eth0 2>/dev/null || true

echo "[guest] RED-ZONE-04 relay online — gatekeeper listener on :2323"
# One fresh gatekeeper process per connection with plain pipes — exactly the
# model of the reference challenge/server.py. The binary sets its own stdout
# unbuffered (setvbuf _IONBF), so no pty is needed.
exec $B tcpsvd -v 0.0.0.0 2323 /gatekeeper
`;
}

function cpioNewc(entries) {
  // entries: [{ name, mode, data:Buffer, mtime }]
  // newc ("070701") header fields are 8-digit HEXADECIMAL (not octal).
  const chunks = [];
  let ino = 1;
  const pad4 = (n) => Buffer.alloc((4 - (n % 4)) % 4);
  const h8 = (n) => (n >>> 0).toString(16).padStart(8, '0');
  const writeEntry = (name, mode, data, mtime) => {
    const nameBuf = Buffer.from(name + '\0', 'utf8');
    const header = Buffer.from(
      '070701' +
      h8(ino++) +
      h8(mode) +
      '00000000' + // uid
      '00000000' + // gid
      '00000001' + // nlink
      h8(Math.floor(mtime / 1000)) +
      h8(data.length) +
      '00000000' + // devmajor
      '00000000' + // devminor
      '00000000' + // rdevmajor
      '00000000' + // rdevminor
      h8(nameBuf.length) +
      '00000000',  // check
      'latin1'
    );
    chunks.push(header, nameBuf, pad4(header.length + nameBuf.length), data, pad4(data.length));
  };
  for (const e of entries) writeEntry(e.name, e.mode, e.data, e.mtime || Date.now());
  // trailer: everything zero except nlink = 1 and namesize
  const trailerName = Buffer.from('TRAILER!!\0', 'utf8');
  const trailerHeader = Buffer.from(
    '070701' + '00000000'.repeat(4) + '00000001' + '00000000'.repeat(6) +
    h8(trailerName.length) + '00000000',
    'latin1'
  );
  chunks.push(trailerHeader, trailerName, pad4(trailerHeader.length + trailerName.length));
  return Buffer.concat(chunks);
}

function buildInitramfs(libcDir) {
  const mk = (p) => fs.readFileSync(p);
  const modsMeta = JSON.parse(fs.readFileSync(path.join(RT, 'kernel', 'mods', 'meta.json'), 'utf8'));
  const dirs = ['dev', 'etc', 'proc', 'sys', 'tmp', 'bin', 'lib', 'lib64', 'lib/x86_64-linux-gnu', 'lib/modules'];
  for (const f of modsMeta.files) {
    // cumulative parent dirs: lib, lib/modules, lib/modules/<ver>, …
    const parts = f.split('/');
    for (let i = 1; i < parts.length; i++) dirs.push(parts.slice(0, i).join('/'));
  }
  const entries = [];
  for (const d of [...new Set(dirs)]) {
    entries.push({ name: d, mode: 0o040755, data: Buffer.alloc(0), mtime: Date.now() });
  }
  const files = [
    { name: 'init', mode: 0o100755, data: Buffer.from(initScript(modsMeta.files), 'utf8') },
    { name: 'bin/busybox', mode: 0o100755, data: mk(path.join(RT, 'kernel', 'busybox')) },
    { name: 'gatekeeper', mode: 0o100755, data: mk(path.join(ROOT, 'challenge', 'gatekeeper')) },
    { name: 'lib/x86_64-linux-gnu/libc.so.6', mode: 0o100755, data: mk(path.join(libcDir, 'libc.so.6')) },
    // the ELF interpreter itself must be executable or every execve() fails
    { name: 'lib64/ld-linux-x86-64.so.2', mode: 0o100755, data: mk(path.join(libcDir, 'ld-linux-x86-64.so.2')) },
    ...modsMeta.files.map((f) => ({
      name: f,
      mode: 0o100644,
      data: mk(path.join(RT, 'kernel', 'mods', path.basename(f))),
    })),
  ];
  for (const f of files) entries.push({ ...f, mtime: Date.now() });
  const cpio = cpioNewc(entries);
  const gz = zlib.gzipSync(cpio, { level: 9 });
  const out = path.join(RT, 'kernel', 'initramfs.cpio.gz');
  fs.writeFileSync(out, gz);
  log(`initramfs built: ${(gz.length / 1024).toFixed(0)} KB → ${path.relative(ROOT, out)}`);
  return out;
}

/* ------------------------------------------------------------------- deb */
function extractDeb(debPath, destDir) {
  const buf = fs.readFileSync(debPath);
  if (buf.toString('latin1', 0, 8) !== '!<arch>\n') throw new Error('not a deb (ar) archive');
  let off = 8;
  let dataTarXz = null;
  while (off + 60 <= buf.length) {
    const name = buf.toString('latin1', off, off + 16).trim().replace(/\/$/, '');
    const size = parseInt(buf.toString('latin1', off + 48, off + 58).trim(), 10);
    const start = off + 60;
    if (name.startsWith('data.tar')) {
      dataTarXz = { ext: name.slice('data.tar.'.length), data: buf.subarray(start, start + size) };
      break;
    }
    off = start + size + (size % 2);
  }
  if (!dataTarXz) throw new Error('data.tar.* not found in deb');
  ensureDir(destDir);
  const tmp = path.join(CACHE, `data.tar.${dataTarXz.ext}`);
  fs.writeFileSync(tmp, dataTarXz.data);
  try {
    run(tarCmd, ['-xf', tmp, '-C', destDir]);
  } catch (err) {
    // Debian packages store libc.so.6 / ld-linux as symlinks; Windows cannot
    // create symlinks here. Extraction is still complete enough — the missing
    // links are materialised as copies right after extraction.
    log(`archive contained symlinks (tolerated on Windows): ${String(err.message).split('\n')[1] || ''}`);
  }
  fs.unlinkSync(tmp);
}

/* ------------------------------------------------------------------ main */
async function main() {
  ensureDir(CACHE);
  ensureDir(RT);

  /* 1. base artifacts ---------------------------------------------------- */
  await ensureFile(QEMU_PKG_URL, path.join(CACHE, 'qemu.pkg.tar.zst'), 'qemu package');
  await ensureFile(DB_URL, path.join(CACHE, 'ucrt64.db.tar.zst'), 'pacman db');
  await ensureFile(FILES_DB_URL, path.join(CACHE, 'ucrt64.files.tar.zst'), 'pacman files db');
  await ensureFile(LINUX_VIRT_APK_URL, path.join(CACHE, LINUX_VIRT_APK_NAME), 'alpine linux-virt kernel+modules');
  await ensureFile(BUSYBOX_URL, path.join(RT, 'kernel', 'busybox'), 'busybox static');
  await ensureFile(LIBC6_URL, path.join(CACHE, 'libc6.deb'), 'debian libc6');

  /* 1b. kernel + network modules (version-matched, from the linux-virt apk) */
  const kernelDir = path.join(RT, 'kernel');
  const modsMetaPath = path.join(kernelDir, 'mods', 'meta.json');
  if (!fs.existsSync(modsMetaPath)) {
    log('extracting kernel + network modules from linux-virt apk…');
    const stage = path.join(CACHE, 'linux-virt-pkg');
    fs.rmSync(stage, { recursive: true, force: true });
    extractArchive(path.join(CACHE, LINUX_VIRT_APK_NAME), stage);
    const verDir = fs.readdirSync(path.join(stage, 'lib', 'modules'))[0];
    fs.copyFileSync(path.join(stage, 'boot', 'vmlinuz-virt'), path.join(kernelDir, 'vmlinuz-virt'));
    ensureDir(path.join(kernelDir, 'mods'));
    const guestFiles = [];
    for (const rel of GUEST_NET_MODULES) {
      const src = path.join(stage, 'lib', 'modules', verDir, 'kernel', rel);
      if (!fs.existsSync(src)) { console.warn(`[runtime] WARN: module ${rel} not in apk`); continue; }
      const base = path.basename(rel, '.gz');
      fs.writeFileSync(path.join(kernelDir, 'mods', base), zlib.gunzipSync(fs.readFileSync(src)));
      guestFiles.push(`lib/modules/${verDir}/kernel/${rel.slice(0, -3)}`);
    }
    fs.writeFileSync(modsMetaPath, JSON.stringify({ ver: verDir, files: guestFiles }, null, 2));
    fs.rmSync(stage, { recursive: true, force: true });
    log(`kernel ${verDir} + ${guestFiles.length} network modules staged`);
  } else {
    log('cache hit: kernel + network modules');
  }

  /* 2. pacman databases -------------------------------------------------- */
  if (!fs.existsSync(path.join(DB_EXTRACT, 'db')) || !fs.existsSync(path.join(DB_EXTRACT, 'files'))) {
    log('extracting pacman databases…');
    extractArchive(path.join(CACHE, 'ucrt64.db.tar.zst'), path.join(DB_EXTRACT, 'db'));
    extractArchive(path.join(CACHE, 'ucrt64.files.tar.zst'), path.join(DB_EXTRACT, 'files'));
  }
  const filesDb = parsePacmanDb(path.join(DB_EXTRACT, 'files'));
  const descDb = parsePacmanDb(path.join(DB_EXTRACT, 'db'));
  log(`pacman index: ${filesDb.size} file entries, ${descDb.size} packages`);

  /* 3. extract the qemu package ----------------------------------------- */
  const qemuBinDir = path.join(RT, 'qemu', 'bin');
  const qemuShareDir = path.join(RT, 'qemu', 'share', 'qemu');
  if (!fs.existsSync(path.join(qemuBinDir, 'qemu-system-x86_64.exe'))) {
    log('extracting qemu package (61 MB)…');
    const qdir = path.join(CACHE, 'qemu-pkg');
    fs.rmSync(qdir, { recursive: true, force: true });
    extractArchive(path.join(CACHE, 'qemu.pkg.tar.zst'), qdir);
    const ucrt = path.join(qdir, 'ucrt64');
    ensureDir(qemuBinDir);
    // exe + any bundled dlls
    copyDir(path.join(ucrt, 'bin'), qemuBinDir, (n) => /\.(exe|dll)$/i.test(n));
    if (fs.existsSync(path.join(ucrt, 'share', 'qemu'))) {
      copyDir(path.join(ucrt, 'share', 'qemu'), qemuShareDir);
    }
    if (fs.existsSync(path.join(ucrt, 'lib', 'qemu'))) {
      copyDir(path.join(ucrt, 'lib', 'qemu'), path.join(RT, 'qemu', 'lib', 'qemu'));
    }
    fs.rmSync(qdir, { recursive: true, force: true });
    log('qemu binaries extracted');
  } else {
    log('cache hit: qemu binaries');
  }

  /* 4. resolve the DLL closure — fixed point over the static import graph.
   *    Re-walks after every fetch so imports of late-arriving packages are
   *    discovered too, and verifies the graph at the end.                     */
  const SYSTEM_DLLS = new Set([
    'kernel32.dll', 'user32.dll', 'gdi32.dll', 'shell32.dll', 'advapi32.dll', 'ws2_32.dll',
    'ole32.dll', 'oleaut32.dll', 'comdlg32.dll', 'comctl32.dll', 'imm32.dll', 'winmm.dll',
    'winspool.drv', 'rpcrt4.dll', 'usp10.dll', 'dwrite.dll', 'd3d9.dll', 'd3d11.dll', 'dxgi.dll',
    'setupapi.dll', 'cfgmgr32.dll', 'dbghelp.dll', 'psapi.dll', 'ntdll.dll', 'msvcrt.dll',
    'ucrtbase.dll', 'bcrypt.dll', 'crypt32.dll', 'secur32.dll', 'ncrypt.dll', 'netapi32.dll',
    'iphlpapi.dll', 'wininet.dll', 'winhttp.dll', 'urlmon.dll', 'hid.dll', 'version.dll',
    'mpr.dll', 'powrprof.dll', 'wtsapi32.dll', 'pdh.dll', 'wevtapi.dll', 'authz.dll',
    'dnsapi.dll', 'dhcpcsvc.dll', 'wintrust.dll', 'imagehlp.dll', 'opengl32.dll', 'glu32.dll',
    'dinput8.dll', 'xinput1_4.dll', 'mmdevapi.dll', 'avrt.dll', 'wldap32.dll', 'normaliz.dll',
    'shlwapi.dll', 'msimg32.dll', 'dwmapi.dll', 'gdiplus.dll', 'mswsock.dll', 'winscard.dll',
    'wsock32.dll', 'oleacc.dll', 'uxtheme.dll', 'd2d1.dll', 'windowscodecs.dll',
  ]);
  const locate = (name) => {
    const direct = path.join(qemuBinDir, name);
    if (fs.existsSync(direct)) return direct;
    const ci = fs.readdirSync(qemuBinDir).find((f) => f.toLowerCase() === name.toLowerCase());
    return ci ? path.join(qemuBinDir, ci) : null;
  };
  const findMissing = () => {
    const missing = [];
    const visited = new Set();
    const q = ['qemu-system-x86_64.exe'];
    while (q.length) {
      const dll = q.shift();
      const key = dll.toLowerCase();
      if (visited.has(key)) continue;
      visited.add(key);
      if (key.startsWith('api-ms-win-') || SYSTEM_DLLS.has(key)) continue;
      const file = locate(dll);
      if (!file) { missing.push(dll); continue; }
      parsePeImports(file).forEach((x) => q.push(x));
    }
    return missing;
  };

  const unresolved = new Set();
  let fetched = 0;
  for (let round = 0; round < 15; round++) {
    const missing = findMissing().filter((d) => !unresolved.has(d.toLowerCase()));
    if (!missing.length) break;
    for (const dll of missing) {
      const hit = filesDb.get(dll.toLowerCase()) || descDb.get(dll.toLowerCase());
      let pkgFile = hit && hit.filename;
      if (!pkgFile) {
        // heuristic package-name guesses for common mingw runtimes
        for (const g of guessPackages(dll)) {
          const page = await fetch(`${MSYS2_SITE}/package/${g}?repo=ucrt64`).catch(() => null);
          if (!page || !page.ok) continue;
          const html = await page.text();
          const m = html.match(/[\w.-]+\.pkg\.tar\.zst/);
          if (m) { pkgFile = m[0]; break; }
        }
      }
      if (!pkgFile) {
        console.warn(`[runtime] WARN: no package found for DLL "${dll}"`);
        unresolved.add(dll.toLowerCase());
        continue;
      }
      const dest = path.join(CACHE, 'deps', pkgFile);
      await ensureFile(`${MSYS2_REPO}/${pkgFile}`, dest, pkgFile);
      const tmp = path.join(CACHE, 'deps', '_x');
      fs.rmSync(tmp, { recursive: true, force: true });
      extractArchive(dest, tmp);
      const ucrt = path.join(tmp, 'ucrt64');
      for (const sub of ['bin', 'lib']) {
        const dir = path.join(ucrt, sub);
        if (fs.existsSync(dir)) copyDir(dir, qemuBinDir, (n) => /\.dll$/i.test(n));
      }
      fs.rmSync(tmp, { recursive: true, force: true });
      fetched++;
      if (!locate(dll)) {
        console.warn(`[runtime] WARN: ${pkgFile} extracted but "${dll}" still not found`);
        unresolved.add(dll.toLowerCase());
      }
    }
  }
  log(`dll closure resolved (${fetched} dependency packages fetched)`);

  // The bundled Mesa opengl32.dll shadows the Windows system DLL of the same
  // name and cannot load its optional driver dependencies. Headless QEMU
  // (-display none) never needs it — remove it so the loader falls back to
  // System32 for anything that imports opengl32.
  const mesaGl = locate('opengl32.dll');
  if (mesaGl) { fs.rmSync(mesaGl, { force: true }); log('removed bundled Mesa opengl32.dll (system fallback)'); }

  const stillMissing = findMissing();
  if (stillMissing.length) {
    console.warn(`[runtime] WARN: unresolved imports — qemu may fail: ${stillMissing.join(', ')}`);
  } else {
    log('import graph fully resolved');
  }

  /* 5. libc → initramfs -------------------------------------------------- */
  // bookworm layout: lib/x86_64-linux-gnu/…; trixie is usr-merged:
  // usr/lib/x86_64-linux-gnu/… — accept either.
  const libcStage = path.join(CACHE, 'libc');
  const libcDirOf = (stage) =>
    ['lib/x86_64-linux-gnu', 'usr/lib/x86_64-linux-gnu']
      .map((rel) => path.join(stage, rel))
      .find((d) => {
        try { return fs.existsSync(d) && fs.readdirSync(d).some((f) => /^libc/.test(f)); } catch { return false; }
      }) || '';
  if (!libcDirOf(libcStage)) {
    log('extracting debian libc6…');
    fs.rmSync(libcStage, { recursive: true, force: true });
    ensureDir(libcStage);
    extractDeb(path.join(CACHE, 'libc6.deb'), libcStage);
  }
  const libcDir = libcDirOf(libcStage);
  if (!libcDir) die('libc extraction incomplete — check libc6.deb');
  // Debian ships libc.so.6 and the loader as symlinks/copies; Windows extraction
  // may skip some links — locate the real files and materialise what's missing.
  const libcSo = path.join(libcDir, 'libc.so.6');
  if (!fs.existsSync(libcSo)) {
    const realLibc = fs.readdirSync(libcDir).find((f) => /^libc-[\d.]+\.so$/.test(f));
    if (realLibc) {
      fs.copyFileSync(path.join(libcDir, realLibc), libcSo);
      log('materialised libc.so.6 from real shared object');
    }
  }
  const ldNames = fs.readdirSync(libcDir);
  const ldName =
    ldNames.find((f) => /^ld-[\d.]+\.so$/.test(f)) ||
    (ldNames.includes('ld-linux-x86-64.so.2') ? 'ld-linux-x86-64.so.2' : '');
  const ldReal = ldName ? path.join(libcDir, ldName) : '';
  if (!fs.existsSync(libcSo) || !ldReal || !fs.existsSync(ldReal)) {
    die('libc extraction incomplete — check libc6.deb');
  }
  // materialise loader at the path the ELF requests
  const ldTarget = path.join(libcStage, 'lib64', 'ld-linux-x86-64.so.2');
  ensureDir(path.dirname(ldTarget));
  fs.copyFileSync(ldReal, ldTarget);

  buildInitramfs(libcDir);

  /* 6. marker ------------------------------------------------------------- */
  const marker = {
    builtAt: new Date().toISOString(),
    inputs: {
      qemuPkg: sha256(path.join(CACHE, 'qemu.pkg.tar.zst')),
      linuxVirtApk: sha256(path.join(CACHE, LINUX_VIRT_APK_NAME)),
      kernel: sha256(path.join(RT, 'kernel', 'vmlinuz-virt')),
      busybox: sha256(path.join(RT, 'kernel', 'busybox')),
      libc6: sha256(path.join(CACHE, 'libc6.deb')),
      gatekeeper: sha256(path.join(ROOT, 'challenge', 'gatekeeper')),
      initramfs: sha256(path.join(RT, 'kernel', 'initramfs.cpio.gz')),
    },
  };
  fs.writeFileSync(path.join(RT, '.ready.json'), JSON.stringify(marker, null, 2));
  fs.writeFileSync(
    path.join(RT, 'README.txt'),
    [
      'CTF 5 — THE LAST GATEKEEPER: SPLIT SEAL — local runtime (Windows hosts)',
      '',
      'Built by scripts/fetch-runtime.mjs. Contents:',
      '  qemu/     QEMU system emulator (MSYS2 ucrt64 build — extracted, no installer/admin)',
      '  kernel/   Alpine linux-virt kernel + static busybox + initramfs.cpio.gz',
      '            (initramfs embeds the unmodified challenge/gatekeeper ELF)',
      '  .ready.json  build marker',
      '',
      'Sources: repo.msys2.org (QEMU, GPL-2.0+), dl-cdn.alpinelinux.org (kernel, GPL-2.0),',
      'busybox.net (busybox, GPL-2.0), deb.debian.org (glibc, LGPL-2.1+).',
      '',
      'Linux and Docker deployments do not use this directory — they run the ELF natively.',
      'Delete scripts/.cache/ to reclaim download space.',
    ].join('\n'),
    'utf8'
  );

  log('DONE — runtime ready. Start with: npm start');
}

function guessPackages(dll) {
  const base = dll.toLowerCase().replace(/\.dll$/, '');
  const guesses = [];
  const known = {
    'libwinpthread-1': 'mingw-w64-ucrt-x86_64-libwinpthread',
    'libc++': 'mingw-w64-ucrt-x86_64-libc++',
    'libunwind': 'mingw-w64-ucrt-x86_64-libunwind',
    'libintl-8': 'mingw-w64-ucrt-x86_64-gettext',
    'libiconv-2': 'mingw-w64-ucrt-x86_64-libiconv',
    'zlib1': 'mingw-w64-ucrt-x86_64-zlib',
    'libzstd': 'mingw-w64-ucrt-x86_64-zstd',
    'liblz4': 'mingw-w64-ucrt-x86_64-lz4',
  };
  if (known[base]) guesses.push(known[base]);
  guesses.push(`mingw-w64-ucrt-x86_64-${base.replace(/^lib/, '').replace(/-\d+$/, '')}`);
  guesses.push(`mingw-w64-ucrt-x86_64-${base}`);
  return guesses;
}

function sha256(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

main().catch((err) => {
  console.error('[runtime] FAILED:', err);
  process.exit(1);
});
