/* ============================================================
   CTF 5 — live terminal bridge (WebSocket ⇄ real gatekeeper)
   This is a direct pipe to the actual challenge service.
   ============================================================ */
(function () {
  'use strict';

  const out = () => document.getElementById('term-out');
  const input = () => document.getElementById('term-in');
  const pill = () => document.getElementById('term-pill');
  const pillText = () => document.getElementById('term-text');

  let ws = null;
  let decoder = null;
  const MAX_CHARS = 240000;

  function setPill(state, text) {
    const p = pill(); const t = pillText();
    if (p) p.dataset.state = state;
    if (t) t.textContent = text;
  }

  function trim() {
    const el = out();
    if (el && el.textContent.length > MAX_CHARS) {
      el.textContent = el.textContent.slice(el.textContent.length - MAX_CHARS);
      el.textContent = '[…earlier output trimmed…]\n' + el.textContent;
    }
  }

  function append(text) {
    const el = out();
    if (!el) return;
    el.textContent += text;
    trim();
    el.scrollTop = el.scrollHeight;
  }

  function echoLocal(text) {
    // Local echo marker so transmitted lines are visible even when the
    // service does not echo input back.
    const lines = String(text).split('\n');
    append('» ' + lines.join('\n» ') + '\n');
  }

  /* printable-safe representation of bytes the player transmits */
  function describeBytes(buf) {
    let s = '';
    for (const b of buf) {
      if (b === 0x0a) { s += '\n'; continue; }
      if (b >= 0x20 && b < 0x7f) { s += String.fromCharCode(b); continue; }
      s += '\\x' + b.toString(16).padStart(2, '0');
    }
    return s;
  }

  function sendBytes(bytes) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      append('[bridge] not connected — press RECONNECT.\n');
      setPill('down', 'OFFLINE');
      return;
    }
    ws.send(bytes);
    echoLocal(describeBytes(bytes));
  }

  function sendLine() {
    const el = input();
    if (!el) return;
    let text = el.value;
    if (text.length === 0) { sendBytes(new Uint8Array([0x0a])); return; }
    if (text.startsWith('/b64 ')) {
      const payload = text.slice(5).replace(/\s+/g, '');
      try {
        const bin = atob(payload);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        el.value = '';
        sendBytes(bytes);
        return;
      } catch (e) {
        append('[bridge] invalid /b64 payload\n');
        return;
      }
    }
    if (!text.endsWith('\n')) text += '\n';
    el.value = '';
    sendBytes(new TextEncoder().encode(text));
  }

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    setPill('unknown', 'CONNECTING…');
    decoder = new TextDecoder('utf-8');
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/ws`);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      setPill('live', 'LIVE — REAL SERVICE');
      append('[bridge] connected to RED-ZONE-04 gatekeeper process\n');
      append('[bridge] stdin/stdout are the challenge’s — good luck, archivist.\n\n');
      window.dispatchEvent(new CustomEvent('term:open'));
    };
    ws.onmessage = (ev) => {
      let text;
      if (typeof ev.data === 'string') text = ev.data;
      else text = decoder.decode(ev.data, { stream: true });
      append(text);
      window.dispatchEvent(new CustomEvent('term:data'));
    };
    ws.onclose = (ev) => {
      setPill('down', ev.wasCleanup ? 'CLOSED' : 'SESSION ENDED');
      append('\n[bridge] session ended (' + (ev.reason || ev.code) + '). Press RECONNECT for a new process.\n');
      window.dispatchEvent(new CustomEvent('term:close'));
    };
    ws.onerror = () => {
      setPill('down', 'UNREACHABLE');
    };
  }

  function resetOutput() {
    const el = out();
    if (el) el.textContent = '';
  }

  function boot() {
    const el = input();
    const sendBtn = document.getElementById('term-send');
    const reBtn = document.getElementById('term-reconnect');
    const termOut = out();

    if (el) {
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendLine();
        }
      });
    }
    if (sendBtn) sendBtn.addEventListener('click', sendLine);
    if (reBtn) reBtn.addEventListener('click', () => {
      if (ws) { try { ws.close(); } catch (e) {} }
      resetOutput();
      connect();
    });
    if (termOut) termOut.addEventListener('click', () => el && el.focus());
  }

  window.Terminal = { ensure: connect, reset: resetOutput, boot };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
