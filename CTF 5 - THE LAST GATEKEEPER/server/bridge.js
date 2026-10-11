
'use strict';
/*
 * CTF 5 — session bridge.
 *
 * Supports:
 *   - WebSocket clients (the in-page terminal)
 *   - Raw TCP clients (nc HOST 31337)
 *
 * Completion is recorded server-side only.
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
  return {
    activeSessions,
    maxSessions: cfg.MAX_SESSIONS,
    uptimeMs: Date.now() - startedAt,
  };
}

function sessionLimitReached() {
  return activeSessions >= cfg.MAX_SESSIONS;
}

async function createManagedSession(clientHooks) {
  if (sessionLimitReached()) {
    throw new Error('too many live sessions');
  }

  activeSessions += 1;

  let closed = false;
  let idleTimer = null;
  let bytesOut = 0;
  let bytesIn = 0;
  let handle = null;
  let pendingEndReason = null;

  function finish(reason) {
    if (closed) return;
    closed = true;

    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }

    activeSessions = Math.max(0, activeSessions - 1);
    clientHooks.onEnd && clientHooks.onEnd(reason || 'closed');
  }

  function touch() {
    if (closed) return;

    if (idleTimer) clearTimeout(idleTimer);

    idleTimer = setTimeout(() => {
      if (handle) handle.close('idle timeout');
      else finish('idle timeout');
    }, cfg.SESSION_IDLE_MS);

    if (idleTimer.unref) idleTimer.unref();
  }

  let session;

  try {
    session = await gatekeeper.openSession({
      onOpen: () => {
        if (!closed && clientHooks.onOpen) clientHooks.onOpen();
      },

      onData(buf) {
        if (closed) return;

        touch();
        bytesOut += buf.length;

        if (bytesOut > cfg.SESSION_MAX_BYTES) {
          if (handle) handle.close('session byte limit');
          else finish('session byte limit');
          return;
        }

        clientHooks.onData && clientHooks.onData(buf);
      },

      onEnd(reason) {
        if (handle) finish(reason);
        else pendingEndReason = reason || 'closed';
      },

      onFlag: onFlagObserved,
    });
  } catch (err) {
    finish(`backend error: ${err.message}`);
    throw err;
  }

  handle = {
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

    finish,

    close(reason) {
      if (closed) return;

      try {
        session.close();
      } finally {
        finish(reason || 'closed');
      }
    },
  };

  if (pendingEndReason !== null) {
    finish(pendingEndReason);
  } else {
    touch();
  }

  return handle;
}

async function attachWebSocket(ws) {
  let handle = null;

  try {
    handle = await createManagedSession({
      onData(buf) {
        if (ws.readyState === ws.OPEN) {
          ws.send(buf, { binary: true });
        }
      },

      onEnd(reason) {
        if (ws.readyState === ws.OPEN) {
          try {
            ws.close(1000, String(reason).slice(0, 100));
          } catch {
            // Ignore close errors.
          }
        }
      },
    });
  } catch (err) {
    console.error(`[ws] session failed: ${err.message}`);

    try {
      if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
        ws.close(1013, 'Gatekeeper session unavailable');
      }
    } catch {
      // Ignore close errors.
    }

    return;
  }

  ws.on('message', (data) => {
    if (handle) {
      handle.write(Buffer.isBuffer(data) ? data : Buffer.from(data));
    }
  });

  ws.on('close', () => handle && handle.close('websocket closed'));
  ws.on('error', () => handle && handle.close('websocket error'));
}

async function attachRawTcp(sock) {
  let handle = null;

  try {
    handle = await createManagedSession({
      onData(buf) {
        if (sock.writable) sock.write(buf);
      },

      onEnd() {
        try {
          sock.destroy();
        } catch {
          // Ignore socket errors.
        }
      },
    });
  } catch (err) {
    try {
      sock.end(`\r\n[ctf5] service unavailable: ${err.message}\r\n`);
    } catch {
      // Ignore socket errors.
    }
    return;
  }

  sock.on('data', (buf) => handle && handle.write(buf));

  const bye = () => handle && handle.close('tcp closed');
  sock.on('close', bye);
  sock.on('error', bye);
}

function startRawTcp(onListening) {
  if (!Number.isInteger(cfg.TCP_PORT) || cfg.TCP_PORT <= 0) {
    console.log('[tcp] raw TCP listener disabled');
    return null;
  }

  const server = net.createServer((sock) => {
    sock.setNoDelay(true);
    void attachRawTcp(sock);
  });

  server.on('error', (err) => {
    console.error(`[tcp:${cfg.TCP_PORT}] error: ${err.message}`);
  });

  server.listen(cfg.TCP_PORT, '0.0.0.0', () => {
    console.log(
      `[tcp] raw challenge listener on 0.0.0.0:${cfg.TCP_PORT}`
    );
    if (onListening) onListening();
  });

  return server;
}

module.exports = {
  attachWebSocket,
  attachRawTcp,
  startRawTcp,
  stats,
  onFlagObserved,
};
