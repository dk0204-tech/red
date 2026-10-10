"use strict";

/**
 * PRALAYA Archive Terminal — Red Zone CTF 1
 *
 * Zero-dependency Node HTTP server. Endpoints, by design:
 *
 *   GET  /                          entry hero: boot/signal-recovery sequence
 *   GET  /archive                   workstation: index, forensics, matrix, graph,
 *                                   recovery console, system, terminal
 *   GET  /status                    system status: signer recipe, token format
 *   GET  /robots.txt                still lists the archived recovery routes
 *   GET  /api/case/:id              case lookup — no authorization check (IDOR),
 *                                   withholds Falsified_To_Protect_Flag,
 *                                   advertises the collection route via Link
 *   GET  /api/cases                 collection route: only answers in the audit
 *                                   dialect (406 otherwise), returns the
 *                                   falsification column for all records
 *   GET  /api/system/sync-log       synchronization journal (event windows,
 *                                   compiled-manifest event, data-derived counts)
 *   GET  /recovery/attempts         failed recovery attempts log (no ids ever)
 *   GET  /recovery/channel          410: the old channel folded; names the
 *                                   current attestation route (fair pointer)
 *   GET  /recovery/manifest         token-gated recovery manifest (the trap)
 *   POST /api/fragment/submit       token + manifest ETag + sync event + ids
 *   GET  /api/fragment/1/download   ticket-gated live slice of PARENT_FINAL.csv
 *   GET  /healthz                   liveness probe
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const store = require("./store");
const sec = require("./security");

const PORT = Number.parseInt(process.env.PORT || "8080", 10);
const HOST = process.env.HOST || "0.0.0.0";
const FLAG_SALT = process.env.FLAG_SALT || "pralaya::adjudication::r7";
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const TICKET_TTL_SECONDS = 1800;
const AUDIT_MEDIA_TYPE = "application/vnd.pralaya.audit+csv";
const MAX_BODY_BYTES = 64 * 1024;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
};

const BOOT_TIME = new Date();

/* ------------------------------------------------------------------ data -- */

const data = store.load();
const signerKey = sec.deriveSignerKey(data.signerRecipe);

const manifestObject = {
  manifest: "recovery-fragment-1",
  revision: 7,
  generated: "2024-09-18T02:14:07Z",
  basis: "identity record verified AND signature valid",
  integrity: "UNVERIFIED",
  advisory: "compiled before the final adjudication pass; verify each entry independently",
  attestation: {
    records: data.candidateRows.length,
    countersigned: data.candidateRows.length - data.trapRows.length,
    pending: data.trapRows.length,
  },
  records: data.candidateRows
    .slice()
    .sort((a, b) => (a.Sanctuary_ID < b.Sanctuary_ID ? -1 : 1))
    .map((r) => ({
      id: r.Sanctuary_ID,
      name: r.Original_Name,
      authenticity: Number(r.Record_Authenticity_Score),
      evidence: Number(r.Evidence_Fragment_Count),
      recovery_level: r.Identity_Recovery_Level,
    })),
};

/** Exact bytes served (and hashed) for the manifest ETag. */
const manifestBody = JSON.stringify(manifestObject);
const manifestEtag = '"' + sec.manifestDigest(manifestBody) + '"';

/**
 * Failed recovery attempts recorded by the archive (system artifact, §15).
 * Deliberately never contains record ids or answers — it documents WHICH
 * references a submission must carry, nothing more.
 */
const ATTEMPTS_LOG = {
  ok: true,
  log: "recovery-attempts",
  node: "RED-ZONE-04",
  attempts: [
    { at: "2024-09-18T02:31:12Z", phase: "manifest", code: "E_TOKEN",
      note: "attestation token absent" },
    { at: "2024-09-18T02:44:51Z", phase: "submit", code: "E_ETAG",
      note: "manifest reference missing" },
    { at: "2024-09-18T03:02:33Z", phase: "submit", code: "E_EVENT",
      note: "sync event not referenced — attestations bind to the compiling event (journal: sync-archive)" },
    { at: "2024-09-18T03:19:07Z", phase: "submit", code: "E_ATTEST",
      note: "attestation rejected (generic by policy)" },
  ],
};

/* --------------------------------------------------------------- helpers -- */

function securityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
      "connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
  );
}

function send(req, res, status, contentType, body, headers = {}) {
  securityHeaders(res);
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.statusCode = status;
  if (req.method === "HEAD") res.end();
  else res.end(body);
}

function sendJson(req, res, status, obj, headers = {}) {
  send(req, res, status, "application/json; charset=utf-8", JSON.stringify(obj), {
    "Cache-Control": "no-store",
    ...headers,
  });
}

function sendHtml(req, res, status, html, headers = {}) {
  send(req, res, status, "text/html; charset=utf-8", html, {
    "Cache-Control": "no-store",
    ...headers,
  });
}

function notFound(req, res) {
  const p = req.url.split("?")[0];
  if (p.startsWith("/api/") || p.startsWith("/recovery/")) {
    return sendJson(req, res, 404, { ok: false, error: "no such route" });
  }
  const accept = req.headers.accept || "";
  if (accept.includes("text/html")) {
    const page = readPublic("404.html");
    if (page !== null) return sendHtml(req, res, 404, page);
  }
  send(req, res, 404, "text/plain; charset=utf-8", "404 — route not present in this build\n");
}

function methodNotAllowed(req, res, allow) {
  sendJson(req, res, 405, { ok: false, error: "method not allowed" }, { Allow: allow });
}

function readPublic(relPath) {
  try {
    return fs.readFileSync(path.join(PUBLIC_DIR, relPath), "utf8");
  } catch {
    return null;
  }
}

function renderTemplate(relPath, vars) {
  const raw = readPublic(relPath);
  if (raw === null) return null;
  let html = raw;
  for (const [key, value] of Object.entries(vars)) {
    html = html.split(`{{${key}}}`).join(value);
  }
  return html;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let exceeded = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        exceeded = true; // keep draining, but store nothing
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (exceeded) {
        reject(Object.assign(new Error("payload too large"), { code: "TOO_LARGE" }));
      } else {
        resolve(Buffer.concat(chunks).toString("utf8"));
      }
    });
    req.on("error", reject);
  });
}

function bearerToken(req) {
  const header = req.headers.authorization;
  if (typeof header !== "string") return null;
  const match = /^Bearer[ ]+([^ ]+)$/.exec(header.trim());
  return match ? match[1] : null;
}

function serveStatic(req, res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return notFound(req, res);
  }
  if (rel === "/") rel = "/hero.html";
  const resolved = path.normalize(path.join(PUBLIC_DIR, rel));
  if (resolved !== PUBLIC_DIR && !resolved.startsWith(PUBLIC_DIR + path.sep)) {
    return notFound(req, res);
  }
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return notFound(req, res);
  }
  if (!stat.isFile()) return notFound(req, res);
  const ext = path.extname(resolved).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  send(req, res, 200, type, fs.readFileSync(resolved), { "Cache-Control": "no-store" });
}

/* --------------------------------------------------------------- routes -- */

async function handle(req, res) {
  const url = new URL(req.url, "http://archive.internal");
  const p = url.pathname;

  /* ---- system pages ---- */

  if (p === "/" && (req.method === "GET" || req.method === "HEAD")) {
    const hero = readPublic("hero.html");
    if (hero === null) return notFound(req, res);
    return sendHtml(req, res, 200, hero);
  }

  if (p === "/archive" && (req.method === "GET" || req.method === "HEAD")) {
    const cards = data.releasedRows
      .map((r) => {
        const view = data.caseView(r);
        return `        <article class="case-card" data-id="${view.Sanctuary_ID}" tabindex="0" role="button"
                 aria-label="open record ${view.Sanctuary_ID}">
          <header class="cc-head">
            <span class="cc-id">${view.Sanctuary_ID}</span>
            <span class="pill pill-ok">${escapeHtml(view.Identity_Record_Status)}</span>
          </header>
          <dl class="cc-grid">
            <dt>subject</dt><dd>${escapeHtml(view.Original_Name)}</dd>
            <dt>sector</dt><dd>${escapeHtml(view.Original_Sector_Of_Residence)}</dd>
            <dt>transfer</dt><dd>${escapeHtml(view.Transfer_Date)}</dd>
            <dt>manifest</dt><dd>${escapeHtml(view.Transfer_Manifest_ID)}</dd>
          </dl>
          <footer class="cc-extra">
            <span class="${view.provenance === "CUSTODIAN-7" ? "cc-cust" : ""}">provenance ${escapeHtml(view.provenance)}</span>
            <span>journal ${escapeHtml(view.sync_event || "—")}</span>
            <span>access ${escapeHtml(view.Access_Log_Timestamp)}</span>
          </footer>
        </article>`;
      })
      .join("\n");

    const indexCells = Object.entries({
      "records indexed": data.indexReport().records_indexed,
      "published cases": data.indexReport().published,
      "identity verified": data.indexReport().identity_verified,
      "partially reconstructed": data.indexReport().partially_reconstructed,
      "quarantined (locked)": data.indexReport().locked,
      "custodian-touched": data.indexReport().custodian_touched,
      "outside journal": data.indexReport().out_of_journal,
      "recovery fragments": `${data.indexReport().recovery_fragments_recovered} / ${data.indexReport().recovery_fragments_total}`,
    })
      .map(
        ([k, v]) =>
          `            <div class="status-cell"><span class="k">${k}</span><span class="v">${v}</span></div>`
      )
      .join("\n");

    const journalRows = data
      .syncJournal()
      .map(
        (e) => `            <tr${e.id === data.MANIFEST_COMPILE_EVENT ? ' class="jw-key"' : ""}>
              <td>${e.id}</td>
              <td>${e.from.slice(0, 10)} → ${e.to.slice(0, 10)}</td>
              <td><span class="pill ${e.outcome === "completed" ? "pill-ok" : e.outcome === "aborted" ? "pill-err" : "pill-warn"}">${e.outcome}</span></td>
              <td class="num">${e.records_touched}</td>
              <td class="num">${e.custodian_writes}</td>
              <td>${escapeHtml(e.note)}</td>
            </tr>`
      )
      .join("\n");

    const attemptRows = ATTEMPTS_LOG.attempts
      .map(
        (a) => `            <tr>
              <td>${a.at.slice(11, 19)}Z</td>
              <td>${escapeHtml(a.phase)}</td>
              <td><span class="pill ${a.code === "E_ATTEST" ? "pill-err" : "pill-warn"}">${a.code}</span></td>
              <td>${escapeHtml(a.note)}</td>
            </tr>`
      )
      .join("\n");

    const html = renderTemplate("index.html", {
      RELEASED_CARDS: cards,
      RELEASED_COUNT: String(data.RELEASED_COUNT),
      ARCHIVE_COUNT: String(data.rows.length),
      INDEX_CELLS: indexCells,
      JOURNAL_ROWS: journalRows,
      ATTEMPT_ROWS: attemptRows,
    });
    if (html === null) return notFound(req, res);
    return sendHtml(req, res, 200, html);
  }

  if (p === "/status" && (req.method === "GET" || req.method === "HEAD")) {
    const html = renderTemplate("status.html", {
      RELEASED_IDS: data.releasedIds.join("  "),
      SAMPLE_TOKEN: sec.sampleToken(),
      BOOT_TIME: BOOT_TIME.toISOString().replace(/\.\d+Z$/, "Z"),
      NODE_VERSION: process.version,
      ARCHIVE_COUNT: String(data.rows.length),
      RELEASED_COUNT: String(data.RELEASED_COUNT),
    });
    if (html === null) return notFound(req, res);
    return sendHtml(req, res, 200, html);
  }

  if (p === "/healthz" && (req.method === "GET" || req.method === "HEAD")) {
    return send(req, res, 200, "text/plain; charset=utf-8", "ok\n");
  }

  /* ---- step 1/2: public case lookup (IDOR by design) ---- */

  if (p.startsWith("/api/case/") && p !== "/api/cases/") {
    if (req.method !== "GET" && req.method !== "HEAD") return methodNotAllowed(req, res, "GET, HEAD");
    let rawId;
    try {
      rawId = decodeURIComponent(p.slice("/api/case/".length)).trim();
    } catch {
      return sendJson(req, res, 400, { ok: false, error: "malformed record address" });
    }
    const id = rawId.toUpperCase();
    if (!/^S\d{3}$/.test(id)) {
      return sendJson(req, res, 400, { ok: false, error: "malformed record address" });
    }
    const row = data.byId.get(id);
    if (!row) {
      return sendJson(req, res, 404, { ok: false, error: "no record at this address" });
    }
    // The bug: the release flag is checked nowhere. Any address answers, and the
    // integrity column the directive cares about is withheld from this projection.
    return sendJson(
      req,
      res,
      200,
      { ok: true, record: data.caseView(row) },
      { Link: "</api/cases>; rel=\"collection\"" }
    );
  }

  /* ---- step 6: collection route, audit dialect only ---- */

  if (p === "/api/cases") {
    if (req.method !== "GET" && req.method !== "HEAD") return methodNotAllowed(req, res, "GET, HEAD");
    const accept = String(req.headers.accept || "");
    if (!accept.includes(AUDIT_MEDIA_TYPE)) {
      return sendJson(
        req,
        res,
        406,
        {
          ok: false,
          error: "not acceptable",
          supported: [AUDIT_MEDIA_TYPE],
          note: "collection route answers only in the archived audit dialect",
        },
        { "Accept-Ranges": "none" }
      );
    }
    return send(req, res, 200, `${AUDIT_MEDIA_TYPE}; charset=utf-8`, data.auditCsv(), {
      "Cache-Control": "no-store",
      "X-Archive-Projection": "audit",
    });
  }

  /* ---- system artifact: synchronization journal (event windows) ---- */

  if (p === "/api/system/sync-log") {
    if (req.method !== "GET" && req.method !== "HEAD") return methodNotAllowed(req, res, "GET, HEAD");
    return sendJson(req, res, 200, {
      ok: true,
      journal: "sync-archive",
      node: "RED-ZONE-04",
      manifest_revision: 7,
      events: data.syncJournal(),
    });
  }

  /* ---- system artifacts under the archived recovery prefix ---- */

  if (p === "/recovery/attempts") {
    if (req.method !== "GET" && req.method !== "HEAD") return methodNotAllowed(req, res, "GET, HEAD");
    return sendJson(req, res, 200, ATTEMPTS_LOG);
  }

  if (p === "/recovery/channel") {
    if (req.method !== "GET" && req.method !== "HEAD") return methodNotAllowed(req, res, "GET, HEAD");
    return sendJson(
      req,
      res,
      410,
      {
        ok: false,
        error: "recovery channel folded at 02:19:44Z",
        channel: "fragment-recovery",
        custodian: "CUSTODIAN-7",
        note: "channel collapsed mid-reindex; attestations continue on the fragment route",
        superseded_by: "POST /api/fragment/submit",
      },
      { "Deprecation": "true" }
    );
  }

  /* ---- step 4/5: recovery manifest (token-gated, the trap) ---- */

  if (p === "/recovery/manifest") {
    if (req.method !== "GET" && req.method !== "HEAD") return methodNotAllowed(req, res, "GET, HEAD");
    const token = bearerToken(req);
    const check = token
      ? sec.verifySignedToken(token, signerKey, "manifest:read")
      : { ok: false, reason: "absent" };
    if (!check.ok) {
      return sendJson(req, res, 403, {
        ok: false,
        error: "recovery manifest requires a valid attestation token",
      });
    }
    return send(req, res, 200, "application/json; charset=utf-8", manifestBody, {
      "Cache-Control": "no-store",
      ETag: manifestEtag,
      "X-Manifest-Integrity": "unverified",
    });
  }

  /* ---- step 8: submission ---- */

  if (p === "/api/fragment/submit") {
    if (req.method !== "POST") return methodNotAllowed(req, res, "POST");

    const token = bearerToken(req);
    const auth = token
      ? sec.verifySignedToken(token, signerKey, "fragment:submit")
      : { ok: false, reason: "absent" };
    if (!auth.ok) {
      return sendJson(req, res, 403, { ok: false, error: "attestation token required or invalid" });
    }

    const ref = String(req.headers["x-manifest-etag"] || "").trim();
    if (ref !== manifestEtag) {
      return sendJson(req, res, 403, {
        ok: false,
        error: "manifest reference missing or stale (reference the ETag returned with the recovery manifest)",
      });
    }

    // Attestations are bound to the sync event that compiled the manifest.
    // Missing or wrong value -> the same explanatory 403 (no per-value oracle).
    const eventRef = String(req.headers["x-sync-event"] || "").trim().toUpperCase();
    if (!data.SYNC_EVENTS.some((ev) => ev.id === eventRef) || eventRef !== data.MANIFEST_COMPILE_EVENT) {
      return sendJson(req, res, 403, {
        ok: false,
        error:
          "attestation must reference the sync event that compiled the manifest " +
          "(see GET /api/system/sync-log)",
      });
    }

    let payload;
    const raw = await readBody(req);
    try {
      payload = JSON.parse(raw || "");
    } catch {
      return sendJson(req, res, 400, { ok: false, error: "malformed request body" });
    }
    if (!payload || typeof payload !== "object" || !Array.isArray(payload.ids)) {
      return sendJson(req, res, 400, { ok: false, error: "malformed request body" });
    }
    if (payload.ids.some((v) => typeof v !== "string")) {
      return sendJson(req, res, 400, { ok: false, error: "malformed request body" });
    }

    const submitted = [...new Set(payload.ids.map((v) => v.trim().toUpperCase()).filter(Boolean))].sort();
    const expected = data.fragmentIds;

    const matches =
      submitted.length === expected.length && submitted.every((id, i) => id === expected[i]);

    if (!matches) {
      // Generic rejection: no per-item feedback, ever.
      return sendJson(req, res, 400, {
        ok: false,
        error: "attestation rejected",
        code: "E_ATTEST",
      });
    }

    const flag = sec.deriveFlag(expected, FLAG_SALT);
    const ticket = sec.issueFragmentTicket(signerKey, expected, TICKET_TTL_SECONDS);
    return sendJson(req, res, 200, {
      ok: true,
      rows: expected.length,
      flag,
      download: `/api/fragment/1/download?ticket=${encodeURIComponent(ticket)}`,
    });
  }

  /* ---- step 8: fragment download, live slice of the parent dataset ---- */

  if (p === "/api/fragment/1/download") {
    if (req.method !== "GET" && req.method !== "HEAD") return methodNotAllowed(req, res, "GET, HEAD");
    const ticket = url.searchParams.get("ticket");
    const check = ticket
      ? sec.verifyFragmentTicket(ticket, signerKey, data.fragmentIds)
      : { ok: false, reason: "absent" };
    if (!check.ok) {
      return sendJson(req, res, 403, { ok: false, error: "invalid or expired fragment ticket" });
    }
    return send(req, res, 200, "text/csv; charset=utf-8", data.fragmentCsv(), {
      "Cache-Control": "no-store",
      "Content-Disposition": 'attachment; filename="FRAGMENT_1.csv"',
      "X-Fragment-Rows": String(data.fragmentIds.length),
    });
  }

  /* ---- static assets (public/ only) ---- */

  if (req.method === "GET" || req.method === "HEAD") {
    return serveStatic(req, res, p);
  }

  return methodNotAllowed(req, res, "GET, HEAD, POST");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    if (err && err.code === "TOO_LARGE") {
      if (!res.headersSent) {
        return sendJson(req, res, 413, { ok: false, error: "payload too large" });
      }
      return res.destroy();
    }
    console.error("[server] unhandled error:", err);
    if (!res.headersSent) {
      sendJson(req, res, 500, { ok: false, error: "internal error" });
    } else {
      res.destroy();
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[pralaya] archive terminal listening on http://${HOST}:${PORT}`);
  console.log(`[pralaya] records: ${data.rows.length} | released: ${data.releasedIds.length}`);
  console.log(`[pralaya] fragment rows: ${data.fragmentIds.length} | trap rows: ${data.trapRows.length}`);
  console.log(`[pralaya] manifest etag: ${manifestEtag}`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
