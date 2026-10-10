/* =====================================================================
   THE SILENT EDIT — backend/server.js
   Zero-dependency Node HTTP server.

   Serves the frontend (strict whitelist) and a JSON investigation API.
   The expected flag lives ONLY here (derived from PARENT_FINAL.csv, or
   taken from the RED_ZONE_FLAG env var) and is never sent to a client.

   Start:   node backend/server.js     (or: npm start)
   Env:     PORT          default 8081
            RED_ZONE_FLAG optional authoritative override
            SHOW_FLAG=1   print the expected flag at boot (organizer)
   ===================================================================== */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { Store } = require("./store.js");
const puzzle = require("./puzzle.js");

const ROOT = path.join(__dirname, "..");
const DATA_FILE = path.join(ROOT, "data", "PARENT_FINAL.csv");

/* ---------------- tiny .env loader (no dependencies) ---------------- */
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, "utf8").split(/\r?\n/).forEach((line) => {
    const t = line.trim();
    if (!t || t.startsWith("#")) return;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || process.env[m[1]] !== undefined) return;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  });
}
loadEnv(path.join(ROOT, ".env"));

const PORT = (process.env.PORT !== undefined && process.env.PORT !== "" && Number.isFinite(Number(process.env.PORT)))
  ? Number(process.env.PORT)
  : 8081;

/* ---------------- data + expected flag (server-side only) ---------------- */
const store = Store(DATA_FILE);
const SOLUTION = puzzle.solve(store.rows);
const EXPECTED_FLAG = puzzle.expectedFlag(store.rows);

/* ---------------- narrative / hints (served, never the flag) ---------------- */
const BRIEF = [
  "RED ZONE // PRALAYA ARCHIVE — INTERCEPTED MAINTENANCE LOG (partial, corrupted)",
  "",
  "[r44] policy check ........ an untouched record must still verify:",
  "        PRALAYA_Alteration_Type = none  =>  Signature_Valid_Flag = True",
  "[r45] audit ................ where alteration=none AND signature=False the edit",
  "        was made OFF-RECORD. policy never saw it, so it was never logged.",
  "        the register says exactly two survived the purge.",
  "[r46] triad ................ every subject carries exactly three linked records",
  "        in Relationship_History. no more, no less.",
  "[r47] policy touch ........ of those links keep only the ones the archive DID",
  "        log (PRALAYA_Alteration_Type != none). the pair's six links split",
  "        four logged / two untouched.",
  "[r48] tally ................ sum Evidence_Fragment_Count across the four.",
  "        that number is part of the recovery key.",
  "[r49] key .................. assemble per `protocol`, hash it, submit it.",
  "",
  "  >> the archive will not tell you which records. that is your job."
].join("\n");

const PROTOCOL = [
  "RECOVERY PROTOCOL // stamped by the records authority, not by PRALAYA",
  "",
  "  material = <list A> | <list B> | <tally>",
  "",
  "  <list A>  sanctuary ids of the off-record pair, ascending, comma separated",
  "  <list B>  sanctuary ids of the policy-touched links, ascending, comma separated",
  "  <tally>   the decimal fragment tally",
  "",
  "  flag     = RZ{ sha256hex( material )[0..31] }",
  "",
  "  compute the digest with:  hash <material>",
  "  then submit  RZ{<32 hex chars>}  in the AUTHENTICATION panel."
].join("\n");

const HINTS = {
  1: "Signature is the one field PRALAYA cannot rewrite without breaking the record. `search` cannot filter on flags — page `list all` and scan for rows where alteration type reads \"none\" while signature reads \"False\". Exactly two exist.",
  2: "Run `relations` on each of the two: six links return, three each, no overlap. Then `probe` each link and read its own alteration type — four were logged, two were not.",
  3: "Take `evidence <ID>` for the four logged links and sum Evidence_Fragment_Count. material = '<two ids>|<four ids>|<tally>', hash it, submit RZ{<first 32 hex>}."
};

/* ---------------- static whitelist ---------------- */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};
const STATIC_OK = [
  /^\/$/, /^\/index\.html$/, /^\/favicon\.ico$/, /^\/robots\.txt$/,
  /^\/css\/[A-Za-z0-9_-]+\.css$/, /^\/js\/[A-Za-z0-9_-]+\.js$/, /^\/assets\/[A-Za-z0-9_-]+\.(svg|png|jpg|ico)$/
];

/* ---------------- helpers ---------------- */
function send(res, code, body, headers) {
  res.writeHead(code, Object.assign({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY"
  }, headers || {}));
  res.end(body);
}
function json(res, code, obj, headers) {
  send(res, code, JSON.stringify(obj), Object.assign({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  }, headers || {}));
}
function readJson(req, cb) {
  let size = 0;
  const chunks = [];
  req.on("data", (c) => {
    size += c.length;
    if (size > 4096) { cb(new Error("too large")); req.destroy(); return; }
    chunks.push(c);
  });
  req.on("end", () => {
    try { cb(null, JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
    catch (e) { cb(e); }
  });
  req.on("error", (e) => cb(e));
}

/* naive per-IP rate limit for flag attempts */
const attempts = new Map();
function throttled(ip) {
  const now = Date.now();
  const win = 10 * 60 * 1000;
  const list = (attempts.get(ip) || []).filter((t) => now - t < win);
  attempts.set(ip, list);
  return list.length >= 20;
}
function recordAttempt(ip) {
  const list = attempts.get(ip) || [];
  list.push(Date.now());
  attempts.set(ip, list);
}

const FLAG_RE = /^RZ\{[A-Za-z0-9_-]{6,64}\}$/;
function constantTimeEquals(a, b) {
  const ba = Buffer.from(String(a), "utf8");
  const bb = Buffer.from(String(b), "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/* ---------------- API ---------------- */
function api(req, res, url) {
  const p = url.pathname;
  const q = url.searchParams;

  if (p === "/healthz") return json(res, 200, { ok: true, service: "red-zone-ctf-2" });

  if (p === "/api/status" && req.method === "GET") {
    return json(res, 200, {
      service: "PRALAYA ARCHIVE // RED ZONE NODE",
      dataset: "PARENT_FINAL.csv",
      ...store.stats
    });
  }

  if (p === "/api/brief" && req.method === "GET") return json(res, 200, { log: BRIEF });
  if (p === "/api/protocol" && req.method === "GET") return json(res, 200, { protocol: PROTOCOL });

  const hm = p.match(/^\/api\/hint\/([1-3])$/);
  if (hm && req.method === "GET") return json(res, 200, { n: Number(hm[1]), hint: HINTS[hm[1]] });

  if (p === "/api/list" && req.method === "GET") {
    if (q.get("all") === "1") {
      return json(res, 200, { page: 1, pages: 1, total: store.rows.length, all: true, rows: store.rows.map(store.summary) });
    }
    const page = Number(q.get("page") || "1");
    if (!Number.isFinite(page) || page < 1 || page > 100) return json(res, 400, { error: "BAD_PAGE" });
    return json(res, 200, store.list(page));
  }

  if (p === "/api/search" && req.method === "GET") {
    const term = String(q.get("q") || "");
    if (term.length > 64) return json(res, 400, { error: "BAD_QUERY" });
    const out = store.search(term, 25);
    if (out.error) return json(res, 400, out);
    return json(res, 200, out);
  }

  const rm = p.match(/^\/api\/record\/([Ss]\d{3})(?:\/([a-z]+))?$/);
  if (rm && req.method === "GET") {
    const view = rm[2] || "probe";
    if (!["probe", "inspect", "relations", "evidence", "recover"].includes(view)) {
      return json(res, 400, { error: "BAD_VIEW", hint: "views: probe inspect relations evidence recover" });
    }
    const out = store.views[view](rm[1]);
    if (out.error === "BAD_ID") return json(res, 400, out);
    if (out.error === "NO_RECORD") return json(res, 404, out);
    return json(res, 200, Object.assign({ view }, out));
  }

  if (p === "/api/flag" && req.method === "POST") {
    const ip = req.socket.remoteAddress || "unknown";
    if (throttled(ip)) {
      return json(res, 429, {
        granted: false, title: "CHANNEL THROTTLED",
        lines: ["> too many attempts on this channel", "> wait for the window to clear and retry"]
      });
    }
    return readJson(req, (err, body) => {
      if (err) return json(res, 400, { error: "BAD_BODY" });
      recordAttempt(ip);
      const submitted = String((body && body.flag) || "").trim();
      const shapeOk = FLAG_RE.test(submitted);
      const granted = shapeOk && constantTimeEquals(submitted, EXPECTED_FLAG);
      const stamp = new Date().toISOString();
      if (granted) {
        console.log(`[flag] ${stamp} GRANTED ip=${ip}`);
        return json(res, 200, {
          granted: true,
          title: "ACCESS GRANTED",
          lines: ["> RECOVERY SIGNATURE ACCEPTED", "> IDENTITY RESTORED", "> RED ZONE ARCHIVE UNLOCKED"]
        });
      }
      console.log(`[flag] ${stamp} denied ip=${ip} sig=${submitted.slice(0, 12)}${shapeOk ? "" : " (malformed)"}`);
      return json(res, 200, {
        granted: false,
        title: "ACCESS DENIED",
        lines: shapeOk
          ? ["> INVALID RECOVERY SIGNATURE", "> IDENTITY RESTORATION FAILED"]
          : ["> MALFORMED SIGNATURE", "> expected pattern: RZ{...}"]
      });
    });
  }

  return json(res, 404, { error: "NO_ROUTE" });
}

/* ---------------- static ---------------- */
function serveStatic(req, res, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch (e) { return send(res, 400, "400 bad request"); }
  const allowed = STATIC_OK.some((re) => re.test(decoded));
  if (!allowed) return send(res, 404, "404 — not served by the red zone node");
  const rel = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep)) return send(res, 403, "403 forbidden");
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, "404 — not served by the red zone node");
    const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
    send(res, 200, buf, {
      "Content-Type": type,
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'"
    });
  });
}

/* ---------------- server ---------------- */
const server = http.createServer((req, res) => {
  const started = Date.now();
  let url;
  try { url = new URL(req.url, "http://localhost"); }
  catch (e) { return send(res, 400, "400 bad request"); }

  const finish = (code) => {
    if (url.pathname.indexOf("/api") === 0 || url.pathname === "/healthz") {
      console.log(`${req.method} ${url.pathname} -> ${code} ${Date.now() - started}ms`);
    }
  };
  const orig = res.writeHead.bind(res);
  res.writeHead = function (c) { finish(c); return orig.apply(res, arguments); };

  if (url.pathname.indexOf("/api") === 0 || url.pathname === "/healthz") return api(req, res, url);
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "405 method not allowed");
  serveStatic(req, res, url.pathname);
});

server.listen(PORT, () => {
  console.log("RED ZONE // THE SILENT EDIT — archive node online");
  console.log(`  url        http://localhost:${PORT}/`);
  console.log(`  dataset    data/PARENT_FINAL.csv (${store.rows.length} records)`);
  console.log(`  solution   derived from dataset, ${SOLUTION.silent.length} layer-1 records`);
  if (String(process.env.SHOW_FLAG || "") === "1") {
    console.log(`  material   ${SOLUTION.material}`);
    console.log(`  flag       ${EXPECTED_FLAG}   <-- organizer only, never sent to clients`);
  } else {
    console.log("  flag       set SHOW_FLAG=1 or run `npm run flag` to print (organizer only)");
  }
});

module.exports = server;
