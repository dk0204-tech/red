/* =====================================================================
   METADATA FORENSICS — backend/server.js
   Zero-dependency Node HTTP server.

   Serves the frontend (strict whitelist) and the investigation API.
   The expected flag lives ONLY here (derived from the real datasets, or
   taken from the METADATA_FLAG env var) and is never sent to a client.

   Start:   node backend/server.js     (or: npm start)
   Env:     PORT           default 8082
            METADATA_FLAG  optional authoritative override
            SHOW_FLAG=1    print the expected flag at boot (organizer)
   ===================================================================== */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { Store } = require("./store.js");
const puzzle = require("./puzzle.js");

const ROOT = path.join(__dirname, "..");
const PARENT_FILE = path.join(ROOT, "data", "PARENT_FINAL.csv");
const CHILD_FILE = path.join(ROOT, "data", "CHILD_FINAL.csv");

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
  : 8082;

/* ---------------- data + expected flag (server-side only) ---------------- */
const store = Store(PARENT_FILE, CHILD_FILE);
const SOLUTION = puzzle.solve(store);
const EXPECTED_FLAG = puzzle.expectedFlag(store);

const shaFile = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const PARENT_SHA = shaFile(PARENT_FILE);
const CHILD_SHA = shaFile(CHILD_FILE);

/* ---------------- narrative (served, never the flag) ---------------- */
const BRIEF = [
  "NODE 07 // RECOVERY ARCHIVE — CASE INTAKE / CHILD-17",
  "",
  "The Child Dataset came back whole. Every row reads clean.",
  "The metadata around it does not.",
  "",
  "PRALAYA worked on the trail, not the data: seals were struck below the",
  "archival floor, the audit clock was moved past its statutory window, and",
  "child profiles were erased where the parent admits an edit. The records",
  "authority published the rules — you bring the findings.",
  "",
  "  >> collect the evidence, file the three extracts, rebuild the material.",
  "  >> the archive will not tell you which records. that is your job."
].join("\n");

const HINTS = {
  1: "The record tells you what happened. The metadata tells you when. Read the intake memo, then open the exhibits.",
  2: "An authenticity score is a seal, not an opinion. Sort the parent set on Record_Authenticity_Score ascending — the archival floor cuts the list in exactly one place.",
  3: "Compute every lag yourself: audit timestamp minus transfer date. Seven days plus a half is the window. Three records land exactly on 7d 12h — equality is not breach.",
  4: "One blank cell in a child profile is a survey gap. Two or more blanks, where the parent carries Record_Alteration_Flag=True, is erasure. The comparison view marks both conditions at once.",
  5: "Assemble per the protocol: three extracts, ascending, pipe-separated — then hash. The assembly console will do the hashing; you do the selecting."
};

const STAGE_BRIEFS = {
  intake: {
    title: "CASE INTAKE",
    body: [
      "Recovered by Node 07 on 14 OCT 2026. Archive reference CHILD-17.",
      "",
      "The Child Dataset survived the collapse intact — 120 profiles, all ids present.",
      "What did not survive is the metadata that is supposed to vouch for it.",
      "Three published rules define what 'trustworthy' means here. Filing them",
      "in order unlocks reconstruction."
    ]
  },
  exhibits: {
    title: "EXHIBITS",
    body: [
      "Two artifacts are in custody. Open both: the parent archive carries the",
      "metadata trail, the child dataset carries the profiles. Nothing else in",
      "this node can be filed as evidence."
    ]
  },
  provenance: {
    title: "PROVENANCE",
    body: [
      "RULE III — ARCHIVAL FLOOR",
      "",
      "  A record whose Record_Authenticity_Score is below 0.500 is unsealed:",
      "  its provenance cannot be vouched for by anyone, including PRALAYA.",
      "",
      "  File every unsealed record. The inspector will confirm each seal.",
      "  Sort ascending; the floor cuts the list in one place."
    ]
  },
  chronology: {
    title: "CHRONOLOGY",
    body: [
      "RULE IV — STATUTORY WINDOW",
      "",
      "  The audit entry (Access_Log_Timestamp) must be written no later than",
      "  7 days 12 hours after the transfer (Transfer_Date). Anything later is",
      "  a moved clock — the log and the ledger agreeing is not evidence.",
      "",
      "  Mark every record whose lag breaches the window. Check the boundary.",
      "  Three lags land exactly on 7d 12h: equality is not breach."
    ]
  },
  correlation: {
    title: "PARENT / CHILD CORRELATION",
    body: [
      "RULE V — CHILD INTEGRITY",
      "",
      "  One blank skill cell in a child profile is a survey gap.",
      "  Two or more blanks, WHERE the parent record carries",
      "  Record_Alteration_Flag=True, is erasure over an admitted edit.",
      "",
      "  File every erased profile. Both conditions must hold."
    ]
  },
  reconstruction: {
    title: "RECONSTRUCTION",
    body: [
      "Your three filed extracts now form the material. Review them against the",
      "protocol, compute the digest, and carry it to RECOVERY."
    ]
  },
  recovery: {
    title: "RECOVERY",
    body: [
      "Submit the reconstructed value. On acceptance the Child Dataset is",
      "released from custody, verified and complete."
    ]
  }
};

/* ---------------- session state (single node, in-memory) ---------------- */
const state = {
  intake: false,
  exhibits: [],
  provenance: null,
  chronology: null,
  correlation: null,
  failed: { chronology: 0, correlation: 0, flag: 0 },
  solved: false,
  startedAt: null
};

function resetState() {
  state.intake = false;
  state.exhibits = [];
  state.provenance = null;
  state.chronology = null;
  state.correlation = null;
  state.failed = { chronology: 0, correlation: 0, flag: 0 };
  state.solved = false;
  state.startedAt = null;
}

function unlockedHints() {
  const out = [];
  if (state.intake) out.push(1);
  if (state.exhibits.length >= 2) out.push(2);
  if (state.failed.chronology >= 1) out.push(3);
  if (state.failed.correlation >= 1) out.push(4);
  if (state.provenance && state.chronology && state.correlation) out.push(5);
  return out.sort((a, b) => a - b);
}

function evidenceTray() {
  const ev = [];
  if (state.intake) ev.push({ id: "CASE-INTAKE", label: "CHILD-17 intake memo" });
  if (state.exhibits.includes("PARENT_FINAL.csv")) ev.push({ id: "EXHIBIT-PARENT", label: "PARENT_FINAL.csv" });
  if (state.exhibits.includes("CHILD_FINAL.csv")) ev.push({ id: "EXHIBIT-CHILD", label: "CHILD_FINAL.csv" });
  if (state.provenance) ev.push({ id: "PROVENANCE-" + state.provenance.length, label: state.provenance.length + " unsealed records" });
  if (state.chronology) ev.push({ id: "CHRONOLOGY-" + state.chronology.length, label: state.chronology.length + " moved clocks" });
  if (state.correlation) ev.push({ id: "CORRELATION-" + state.correlation.length, label: state.correlation.length + " erased profiles" });
  if (state.solved) ev.push({ id: "CHILD-RECOVERED", label: "Child Dataset recovered" });
  return ev;
}

function unlockedStages() {
  const s = ["case"];
  if (state.intake) s.push("exhibits");
  if (state.exhibits.length >= 2) s.push("meta", "timeline", "correlation");
  /* all three extracts filed: assemble the material (VI) and submit it (VII).
     Recovery must be reachable BEFORE the flag is accepted — it is where the
     player submits. */
  if (state.provenance && state.chronology && state.correlation) s.push("reconstruction", "rec");
  return s;
}

function stageProgress() {
  return {
    intake: !!state.intake,
    exhibits: { parent: state.exhibits.includes("PARENT_FINAL.csv"), child: state.exhibits.includes("CHILD_FINAL.csv") },
    provenance: state.provenance,
    chronology: state.chronology,
    correlation: state.correlation,
    reconstruction: !!(state.provenance && state.chronology && state.correlation),
    solved: state.solved
  };
}

/* ---------------- static whitelist ---------------- */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8"
};
const STATIC_OK = [
  /^\/$/, /^\/index\.html$/, /^\/favicon\.ico$/,
  /^\/css\/[A-Za-z0-9_-]+\.css$/, /^\/js\/[A-Za-z0-9_-]+\.js$/,
  /^\/assets\/[A-Za-z0-9_-]+\.(svg|png|jpg|ico)$/
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
    if (size > 8192) { cb(new Error("too large")); req.destroy(); return; }
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

/* validate a filed extract against the derived solution */
function checkExtract(field, ids) {
  if (!Array.isArray(ids)) return { ok: false, error: "BAD_PAYLOAD" };
  const filed = [...new Set(ids.map((x) => String(x).toUpperCase()))].filter((x) => /^S\d{3}$/.test(x)).sort();
  const expected = SOLUTION[field];
  if (filed.length !== expected.length) {
    return { ok: false, msg: "EXTRACT REJECTED — " + filed.length + " filed, " + expected.length + " expected", wrongCount: true, filed: filed.length, expected: expected.length };
  }
  const missing = expected.filter((x) => filed.indexOf(x) < 0);
  const extra = filed.filter((x) => expected.indexOf(x) < 0);
  if (missing.length || extra.length) {
    return { ok: false, msg: "EXTRACT REJECTED — count correct, membership wrong", wrongMembership: true };
  }
  return { ok: true, ids: filed };
}

/* ---------------- API ---------------- */
function api(req, res, url) {
  const p = url.pathname;
  const q = url.searchParams;

  if (p === "/healthz") return json(res, 200, { ok: true, service: "red-zone-ctf-3" });

  if (p === "/api/state" && req.method === "GET") {
    return json(res, 200, {
      service: "NODE 07 // RECOVERY ARCHIVE",
      reference: "CHILD-17",
      progress: stageProgress(),
      unlocked: unlockedStages(),
      evidence: evidenceTray(),
      hints: unlockedHints(),
      artifacts: { parent: 120, child: 120, columns: store.stats.columns },
      stats: store.stats
    });
  }

  if (p === "/api/brief" && req.method === "GET") return json(res, 200, { log: BRIEF });

  if (p === "/api/protocol" && req.method === "GET") return json(res, 200, { protocol: puzzle.PROTOCOL });

  if (p === "/api/rules" && req.method === "GET") {
    return json(res, 200, {
      floor: puzzle.RULES.AUTH_FLOOR,
      windowDays: puzzle.RULES.AUDIT_WINDOW_DAYS,
      blankMin: puzzle.RULES.CHILD_BLANK_MIN
    });
  }

  if (p === "/api/briefs" && req.method === "GET") return json(res, 200, { briefs: STAGE_BRIEFS });

  const hm = p.match(/^\/api\/hint\/([1-5])$/);
  if (hm && req.method === "GET") {
    const n = Number(hm[1]);
    if (unlockedHints().indexOf(n) < 0) {
      return json(res, 403, { error: "HINT_LOCKED", hint: null, unlocked: unlockedHints() });
    }
    return json(res, 200, { n, hint: HINTS[n] });
  }

  /* ---- exhibits / intake ---- */
  if (p === "/api/exhibits" && req.method === "GET") {
    return json(res, 200, {
      exhibits: [
        {
          no: "01", name: "PARENT_FINAL.csv", kind: "ARCHIVE / METADATA TRAIL",
          records: store.parentRows.length, columns: store.stats.columns,
          sha256: PARENT_SHA, status: "PROVENANCE COMPROMISED",
          fields: ["Vault_Case_ID", "Transfer_Manifest_ID", "Medical_Tag_ID", "Record_Authenticity_Score",
            "Record_Alteration_Flag", "PRALAYA_Alteration_Type", "Signature_Valid_Flag",
            "Transfer_Date", "Access_Log_Timestamp", "Previous_Identifier", "Identity_Record_Status"]
        },
        {
          no: "02", name: "CHILD_FINAL.csv", kind: "RECOVERED / PROFILE SET",
          records: store.childRows.length, columns: store.stats.childColumns,
          sha256: CHILD_SHA, status: "ROWS INTACT / METADATA SUSPECT",
          fields: ["Sanctuary_ID", "skill scores x10", "Sector_Exposure", "Original_Occupation_Category"]
        }
      ]
    });
  }

  if (p === "/api/intake" && req.method === "POST") {
    return readJson(req, (err, body) => {
      if (err) return json(res, 400, { error: "BAD_BODY" });
      if (!state.intake) {
        state.intake = true;
        state.startedAt = state.startedAt || Date.now();
      }
      return json(res, 200, { ok: true, unlocked: unlockedStages(), evidence: evidenceTray(), hints: unlockedHints() });
    });
  }

  if (p === "/api/exhibits" && req.method === "POST") {
    return readJson(req, (err, body) => {
      if (err) return json(res, 400, { error: "BAD_BODY" });
      if (!state.intake) return json(res, 403, { error: "STAGE_LOCKED", msg: "CASE INTAKE not acknowledged" });
      const seen = Array.isArray(body && body.inspected) ? body.inspected.map(String) : [];
      const known = ["PARENT_FINAL.csv", "CHILD_FINAL.csv"];
      const done = known.filter((n) => seen.indexOf(n) >= 0);
      if (done.length < 2) {
        return json(res, 200, {
          ok: false,
          msg: "Both exhibits must be opened before filing",
          remaining: known.filter((n) => done.indexOf(n) < 0)
        });
      }
      state.exhibits = done;
      return json(res, 200, { ok: true, unlocked: unlockedStages(), evidence: evidenceTray(), hints: unlockedHints() });
    });
  }

  /* ---- the three filed extracts ---- */
  const exMatch = p.match(/^\/api\/(provenance|chronology|correlation)$/);
  if (exMatch && req.method === "POST") {
    const field = exMatch[1];
    return readJson(req, (err, body) => {
      if (err) return json(res, 400, { error: "BAD_BODY" });
      if (state.exhibits.length < 2) return json(res, 403, { error: "STAGE_LOCKED", msg: "Open both exhibits first" });
      const verdict = checkExtract(field, body && body.ids);
      if (!verdict.ok) {
        if (field === "chronology" || field === "correlation") state.failed[field]++;
        return json(res, 200, Object.assign({ ok: false, title: "EXTRACT REJECTED" }, verdict, { hints: unlockedHints() }));
      }
      state[field] = verdict.ids;
      return json(res, 200, {
        ok: true, title: "EXTRACT ACCEPTED", ids: verdict.ids,
        unlocked: unlockedStages(), evidence: evidenceTray(), hints: unlockedHints(),
        reconstruction: stageProgress().reconstruction
      });
    });
  }

  /* ---- datasets ---- */
  const dsMatch = p.match(/^\/api\/dataset\/(parent|child)$/);
  if (dsMatch && req.method === "GET") {
    const term = String(q.get("q") || "");
    if (term.length > 64) return json(res, 400, { error: "BAD_QUERY" });
    const out = store.query({
      which: dsMatch[1],
      q: term,
      page: q.get("page"),
      limit: q.get("limit"),
      sort: q.get("sort"),
      dir: q.get("dir"),
      filter: q.get("filter")
    });
    return json(res, 200, out);
  }

  /* ---- single record: parent + child + derived metadata ---- */
  const recMatch = p.match(/^\/api\/record\/([Ss]\d{3})(?:\/([a-z]+))?$/);
  if (recMatch && req.method === "GET") {
    const view = recMatch[2] || "full";
    if (!["full", "relations", "trace"].includes(view)) {
      return json(res, 400, { error: "BAD_VIEW", hint: "views: full relations trace" });
    }
    const id = recMatch[1].toUpperCase();
    const rec = store.record(id);
    if (!rec) return json(res, 404, { error: "NO_RECORD", id, hint: "ids run S001..S120" });

    if (view === "relations") {
      const links = store.relations(id).map((lid) => {
        const d = store.derived.get(lid);
        return d ? {
          id: lid,
          status: d.status,
          altered: d.altered,
          alterationType: d.alterationType,
          auth: d.auth,
          signature: d.signature,
          sector: d.sectorParent
        } : { id: lid, missing: true };
      });
      return json(res, 200, { id, degree: links.length, links });
    }

    if (view === "trace") {
      return json(res, 200, { id, chain: store.trace(id) });
    }

    return json(res, 200, {
      id,
      parent: rec.parent,
      child: rec.child,
      derived: rec.derived,
      scoreColumns: store.scoreCols
    });
  }

  /* ---- correlation ledger: raw facts from BOTH artifacts, joined ---- */
  if (p === "/api/ledger" && req.method === "GET") {
    const rows = store.parentRows.map((r) => {
      const d = store.derived.get(r.Sanctuary_ID);
      return {
        id: r.Sanctuary_ID,
        altered: d.altered,
        alterationType: d.alterationType,
        blanks: d.childBlanks,
        blankCols: d.childBlankCols,
        sectorMismatch: d.sectorMismatch,
        status: d.status,
        auth: d.auth,
        gap: Number(d.gapDays.toFixed(4))
      };
    });
    return json(res, 200, { count: rows.length, rows });
  }

  /* ---- chronology events for the timeline ---- */
  if (p === "/api/timeline" && req.method === "GET") {    const events = store.parentRows.map((r) => ({
      id: r.Sanctuary_ID,
      transfer: r.Transfer_Date,
      audit: r.Access_Log_Timestamp,
      type: r.Reason_For_Transfer
    })).sort((a, b) => a.transfer.localeCompare(b.transfer));
    return json(res, 200, { count: events.length, windowDays: puzzle.RULES.AUDIT_WINDOW_DAYS, events });
  }

  /* ---- recovery ---- */
  if (p === "/api/download/child" && req.method === "GET") {
    if (!state.solved) {
      return json(res, 403, { error: "DATASET_SEALED", msg: "Child Dataset is released only after reconstruction" });
    }
    const buf = fs.readFileSync(CHILD_FILE);
    return send(res, 200, buf, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="CHILD_FINAL.csv"',
      "Cache-Control": "no-store"
    });
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

      if (!state.provenance || !state.chronology || !state.correlation) {
        return json(res, 200, {
          granted: false, title: "RECONSTRUCTION INCOMPLETE",
          lines: ["> three extracts must be filed before reconstruction", "> stages III, IV and V are outstanding"]
        });
      }

      const submitted = String((body && body.flag) || "").trim();
      const shapeOk = FLAG_RE.test(submitted);
      const granted = shapeOk && constantTimeEquals(submitted, EXPECTED_FLAG);
      const stamp = new Date().toISOString();

      if (granted) {
        state.solved = true;
        console.log(`[flag] ${stamp} GRANTED ip=${ip}`);
        return json(res, 200, {
          granted: true,
          title: "FLAG ACCEPTED",
          lines: [
            "> VERIFYING METADATA ........ OK",
            "> VERIFYING PROVENANCE ...... OK",
            "> CORRELATING RECORDS ....... OK",
            "> REBUILDING INDEX .......... OK",
            "> RESTORING CHILD DATA ...... OK",
            "> RECOVERY COMPLETE"
          ],
          reveal: {
            heading: "CHILD DATASET RECOVERED",
            rows: ["PROVENANCE       VERIFIED", "INTEGRITY        VERIFIED", "RECORDS          RECOVERED", "METADATA         RECONSTRUCTED"],
            download: "/api/download/child"
          },
          unlocked: unlockedStages(),
          evidence: evidenceTray()
        });
      }

      state.failed.flag++;
      console.log(`[flag] ${stamp} denied ip=${ip} sig=${submitted.slice(0, 12)}${shapeOk ? "" : " (malformed)"}`);
      return json(res, 200, {
        granted: false,
        title: "RECONSTRUCTION FAILED",
        lines: shapeOk
          ? ["> THE METADATA DOES NOT SUPPORT THIS VALUE"]
          : ["> MALFORMED VALUE", "> expected pattern: RZ{...}"],
        hints: unlockedHints()
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
  if (!allowed) return send(res, 404, "404 — not served by node 07");
  const rel = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep)) return send(res, 403, "403 forbidden");
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, "404 — not served by node 07");
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
  console.log("NODE 07 // RECOVERY ARCHIVE — metadata forensics online");
  console.log(`  url        http://localhost:${PORT}/`);
  console.log(`  dataset    data/PARENT_FINAL.csv (${store.parentRows.length} records) + data/CHILD_FINAL.csv (${store.childRows.length} records)`);
  console.log(`  extracts   provenance ${SOLUTION.provenance.length} / chronology ${SOLUTION.chronology.length} / correlation ${SOLUTION.correlation.length}`);
  if (String(process.env.SHOW_FLAG || "") === "1") {
    console.log(`  material   ${SOLUTION.material}`);
    console.log(`  flag       ${EXPECTED_FLAG}   <-- organizer only, never sent to clients`);
  } else {
    console.log("  flag       set SHOW_FLAG=1 or run `npm run flag` to print (organizer only)");
  }
});

module.exports = { server, state, resetState, SOLUTION };
