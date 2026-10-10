'use strict';
/*
 * CTF 5 — session bridge.
 *
 * Fans one live gatekeeper session out to a client:
 *   - WebSocket clients (the in-page terminal)
 *   - raw TCP clients (nc HOST 31337 — the method in challenge/CHALLENGE.md)
 *
 * Every byte produced by the challenge flows through here, so a successful
 * exploit performed anywhere is observed and validated server-side.
 * Completion is awarded ONLY by validate.js (SHA-256 commitment), never by
 * client state.
 */
const net = require('net');
const cfg = require('./config');
const gatekeeper = require('./gatekeeper');
const progress = require('./progress');

let activeSessions = 0;
const startedAt = Date.now();

function onFlagObserved(candidate) {
  const flipped = progress.award('observed');
  if (flipped) {
    console.log('[validation] live session emitted the archive fragment — completion recorded');
  } else {
    console.log('[validation] archive fragment re-observed on a live session');
  }
  void candidate;
}

function stats() {
  return { activeSessions, maxSessions: cfg.MAX_SESSIONS, uptimeMs: Date.now() - startedAt };
}

function sessionLimitReached() {
  return activeSessions >= cfg.MAX_SESSIONS;
}

/**
 * Wraps a backend session with limits + idle timeout.
 * Returns a handle with write/close and lifecycle events for the transport.
 */
async function createManagedSession(clientHooks) {
  if (sessionLimitReached()) {
    throw new Error('too many live sessions');
  }
  activeSessions += 1;
  let closed = false;
  let idleTimer = null;
  let bytesOut = 0;
  let bytesIn = 0;

  const touch = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => handle.close('idle timeout'), cfg.SESSION_IDLE_MS);
    if (idleTimer.unref) idleTimer.unref();
  };

  const session = await gatekeeper.openSession({
    onOpen: () => clientHooks.onOpen && clientHooks.onOpen(),
    onData(buf) {
      touch();
      bytesOut += buf.length;
      if (bytesOut > cfg.SESSION_MAX_BYTES) {
        handle.close('session byte limit');
        return;
      }
      clientHooks.onData && clientHooks.onData(buf);
    },
    onEnd(reason) {
      handle.finish(reason);
    },
    onFlag: onFlagObserved,
  });

  const handle = {
    bytesIn: () => bytesIn,
    bytesOut: () => bytesOut,
    write(buf) {
      if (closed) return;
      touch();
      bytesIn += buf.length;
      if (bytesIn > cfg.SESSION_MAX_BYTES) {
        handle.close('session byte limit');
        return;
      }
      session.write(buf);
    },
    finish(reason) {
      if (closed) return;
      closed = true;
      if (idleTimer) clearTimeout(idleTimer);
      activeSessions = Math.max(0, activeSessions - 1);
      clientHooks.onEnd && clientHooks.onEnd(reason || 'closed');
    },
    close(reason) {
      session.close();
      handle.finish(reason || 'closed');
    },
  };

  touch();
  return handle;
}

/** Bridges a `ws` WebSocket connection to a live session. */
async function attachWebSocket(ws) {
  let handle = null;
  let pending = [];
  try {
    handle = await createManagedSession({
      onData(buf) {
        if (ws.readyState === ws.OPEN) ws.send(buf, { binary: true });
      },
      onEnd(reason) {
        if (ws.readyState === ws.OPEN) {
          try { ws.close(1000, String(reason).slice(0, 100)); } catch { /* ignore */ }
        }
      },
    });
  } catch (err) {
    try { ws.close(1013, String(err.message).slice(0, 100)); } catch { /* ignore */ }
    return;
  }
  ws.on('message', (data, isBinary) => {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    handle.write(buf);
    void isBinary;
    void pending;
  });
  ws.on('close', () => handle && handle.close('websocket closed'));
  ws.on('error', () => handle && handle.close('websocket error'));
}

/** Bridges a raw TCP client (nc HOST 31337) to a live session. */
async function attachRawTcp(sock) {
  let handle = null;
  try {
    handle = await createManagedSession({
      onData(buf) { if (sock.writable) sock.write(buf); },
      onEnd() { try { sock.destroy(); } catch { /* ignore */ } },
    });
  } catch (err) {
    try { sock.end(`\r\n[ctf5] service busy: ${err.message}\r\n`); } catch { /* ignore */ }
    return;
  }
  sock.on('data', (buf) => handle.write(buf));
  const bye = () => handle && handle.close('tcp closed');
  sock.on('close', bye);
  sock.on('error', bye);
}

/** Starts the raw nc-facing listener. Returns the net.Server. */
function startRawTcp(onListening) {
  const server = net.createServer((sock) => {
    sock.setNoDelay(true);
    attachRawTcp(sock);
  });
  server.on('error', (err) => {
    console.error(`[tcp:${cfg.TCP_PORT}] error: ${err.message}`);
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[tcp:${cfg.TCP_PORT}] port already in use — stop the other service or set TCP_PORT=0 to disable the raw listener.`
      );
    }
  });
  server.listen(cfg.TCP_PORT, () => {
    console.log(`[tcp] raw challenge listener on 0.0.0.0:${cfg.TCP_PORT} (nc HOST ${cfg.TCP_PORT})`);
    onListening && onListening();
  });
  return server;
}

module.exports = { attachWebSocket, attachRawTcp, startRawTcp, stats, onFlagObserved };
