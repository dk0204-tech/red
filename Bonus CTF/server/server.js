/* ============================================================================
 * THE DEADLOCK ENGINE: BLACKOUT PROTOCOL — HTTP server (zero dependencies)
 *
 * - static whitelist: /  /index.html  /favicon.svg  /css/main.css
 *   /js/app.js /js/graph.js /js/ui.js /js/audio.js — everything else 404
 * - signed cookie carries ONLY a random session id; all progress server-side
 * - per-IP + per-session token buckets (service level), per-session game
 *   budgets (game level)
 * - CSP script-src 'self'; no inline handlers; no debug/admin routes
 *
 * Launch:  npm start      (PORT env overrides 8090)
 * ==========================================================================*/
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const store = require("./store");

const PUB = path.join(__dirname, "..", "public");
const MAX_BODY = 4096;

const FILES = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/favicon.svg": ["favicon.svg", "image/svg+xml"],
  "/css/main.css": ["css/main.css", "text/css; charset=utf-8"],
  "/js/app.js": ["js/app.js", "text/javascript; charset=utf-8"],
  "/js/graph.js": ["js/graph.js", "text/javascript; charset=utf-8"],
  "/js/ui.js": ["js/ui.js", "text/javascript; charset=utf-8"],
  "/js/audio.js": ["js/audio.js", "text/javascript; charset=utf-8"]
};

const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; " +
  "img-src 'self' data:; connect-src 'self'; font-src 'self'; " +
  "object-src 'none'; base-uri 'none'; form-action 'none'";

function send(res, status, obj, ctype, extraHeaders) {
  const buf = Buffer.isBuffer(obj) ? obj : Buffer.from(JSON.stringify(obj));
  const headers = Object.assign({
    "Content-Type": ctype || "application/json; charset=utf-8",
    "Content-Length": buf.length,
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store"
  }, extraHeaders || {});
  res.writeHead(status, headers);
  res.end(buf);
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function readBody(req, cb) {
  let size = 0;
  const chunks = [];
  let aborted = false;
  req.on("data", (c) => {
    if (aborted) return;
    size += c.length;
    if (size > MAX_BODY) {
      aborted = true;
      cb(new Error("too large"));
      req.resume();           /* drain so the socket stays usable for the 400 */
      return;
    }
    chunks.push(c);
  });
  req.on("end", () => { if (!aborted) cb(null, Buffer.concat(chunks).toString("utf8")); });
  req.on("error", (e) => { if (!aborted) cb(e); });
}

function create() {
  return http.createServer((req, res) => {
    const method = req.method || "GET";
    let rawUrl = req.url || "/";
    const qIdx = rawUrl.indexOf("?");
    const rawPath = qIdx >= 0 ? rawUrl.slice(0, qIdx) : rawUrl;
    const rawQuery = qIdx >= 0 ? rawUrl.slice(qIdx + 1) : "";
    let pathname = rawPath;
    try { pathname = decodeURIComponent(rawPath); } catch (e) { /* keep raw */ }

    if (method !== "GET" && method !== "POST") {
      send(res, 405, { ok: false, code: "METHOD" });
      return;
    }

    /* ---------------------------------------------------------- static -- */
    if (Object.prototype.hasOwnProperty.call(FILES, pathname)) {
      if (method !== "GET") { send(res, 405, { ok: false, code: "METHOD" }); return; }
      const [file, ctype] = FILES[pathname];
      const full = path.join(PUB, file);
      fs.readFile(full, (err, data) => {
        if (err) { send(res, 404, { ok: false, code: "NOPE" }); return; }
        send(res, 200, data, ctype);
      });
      return;
    }

    /* ------------------------------------------------------------- api -- */
    if (pathname.indexOf("/api/") === 0) {
      const query = {};
      for (const kv of rawQuery.split("&")) {
        if (!kv) continue;
        const i = kv.indexOf("=");
        const k = i >= 0 ? kv.slice(0, i) : kv;
        const v = i >= 0 ? kv.slice(i + 1) : "";
        try { query[decodeURIComponent(k)] = decodeURIComponent(v); } catch (e) { /* skip */ }
      }

      const cookies = parseCookies(req.headers.cookie);
      let session = store.verify(cookies.deadlock);
      let minted = null;
      if (!session) {
        const c = store.create();
        session = c.session;
        minted = c.cookie;
      }
      const ip = req.socket.remoteAddress || "local";
      if (!store.rate(session, ip)) {
        send(res, 429, { ok: false, code: "RATE" }, null,
          minted ? { "Set-Cookie": cookieHeader(minted) } : undefined);
        return;
      }

      if (method === "GET") {
        const out = store.dispatch(session, "GET", pathname, query, null);
        send(res, out.status, out.json, null,
          minted ? { "Set-Cookie": cookieHeader(minted) } : undefined);
        return;
      }

      readBody(req, (err, text) => {
        const extra = minted ? { "Set-Cookie": cookieHeader(minted) } : undefined;
        if (err) {
          send(res, 400, { ok: false, code: err.message === "too large" ? "BODY" : "IO" }, null, extra);
          return;
        }
        let body = null;
        if (text && text.trim()) {
          try { body = JSON.parse(text); } catch (e) {
            send(res, 400, { ok: false, code: "PARSE" }, null, extra);
            return;
          }
        }
        const out = store.dispatch(session, "POST", pathname, query, body);
        send(res, out.status, out.json, null, extra);
      });
      return;
    }

    send(res, 404, { ok: false, code: "NOPE" });
  });
}

function cookieHeader(value) {
  return "deadlock=" + value + "; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800";
}

if (require.main === module) {
  const port = parseInt(process.env.PORT || "8090", 10);
  const srv = create();
  srv.listen(port, () => {
    process.stderr.write("THE DEADLOCK ENGINE listening on http://localhost:" + port + "\n");
  });
}

module.exports = { create };
