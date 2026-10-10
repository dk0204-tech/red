"use strict";

/**
 * End-to-end test of the intended solve path, written from the perspective of
 * a participant who only has what the app exposes.
 *
 *   recon -> IDOR enumeration -> secret derivation -> token forging ->
 *   recovery manifest (trap) -> audit dialect (2nd discovery) -> synthesis ->
 *   submission -> flag + fragment download
 *
 * Also asserts the negative paths: generic rejections, no per-item feedback,
 * no flag leakage in static assets, malformed input handling.
 *
 * Run: npm test   (spawns its own server on PORT 8391)
 */

const { spawn } = require("child_process");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");

const PORT = 8391;
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.join(__dirname, "..");

const EXPECTED_FRAGMENT_IDS = [
  "S001", "S024", "S027", "S046", "S051", "S054",
  "S060", "S073", "S077", "S084", "S105", "S120",
];
const TRAP_ID = "S021";
const DEFAULT_SALT = "pralaya::adjudication::r7";
const AUDIT_DIALECT = "application/vnd.pralaya.audit+csv";

let passed = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failures.push(label + (detail ? ` :: ${detail}` : ""));
    console.log(`  FAIL ${label}${detail ? ` :: ${detail}` : ""}`);
  }
}

function sha256Hex(s) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

function hmacBase64Url(key, msg) {
  return crypto.createHmac("sha256", key).update(msg, "utf8").digest("base64url");
}

function parseSimpleCsv(text) {
  const lines = text.replace(/\r\n/g, "\n").trim().split("\n");
  return { header: lines[0].split(","), rows: lines.slice(1).map((l) => l.split(",")) };
}

/** Raw GET with the request line verbatim (no WHATWG URL normalization). */
function rawGet(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: PORT, path: pathname, method: "GET" },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not come up");
}

async function main() {
  const server = spawn(process.execPath, [path.join(ROOT, "src", "server.js")], {
    env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));

  try {
    await waitForServer();
    console.log("server up\n== recon ==");

    /* ---- step 1: public surface ---- */
    const root = await fetch(`${BASE}/`);
    const rootHtml = await root.text();
    check("site root serves the entry hero page", root.status === 200 && rootHtml.includes("hero-title"));
    check("hero CTA links to /archive", rootHtml.includes('class="btn hero-cta" href="/archive"'));
    check("hero does not leak the flag format", !rootHtml.includes("RZ{"));

    const bootJs = await (await fetch(`${BASE}/js/boot.js`)).text();
    const bootTextLeak = [
      "PRALAYA::", "Falsified_To_Protect_Flag", "Evidence_Fragment_Count",
      "Identity_Record_Status", "Signature_Valid_Flag", "Sanctuary_ID",
      "/recovery", "/api/", "PRT1.", "RZ{", "adjudication",
    ].filter((needle) => rootHtml.includes(needle) || bootJs.includes(needle));
    check("hero boot sequence leaks no chain details (fields, routes, secrets)", bootTextLeak.length === 0, bootTextLeak.join(","));

    const home = await fetch(`${BASE}/archive`);
    const homeHtml = await home.text();
    check("archive page serves transparency log", home.status === 200 && homeHtml.includes("Public Release Register"));
    check("archive page carries the recovery directive", homeHtml.includes("It&rsquo;s wrong about one of them"));
    check("archive page does not leak the flag format", !homeHtml.includes("RZ{"));
    check("archive nav points to itself, not /", homeHtml.includes('href="/archive" aria-current="page"'));
    check(
      "archive page serves the multi-panel workstation shell",
      homeHtml.includes('data-view="recovery"') &&
        homeHtml.includes('id="frag-overlay"') &&
        homeHtml.includes('class="case-card"')
    );
    check(
      "archive page carries the three progressive hints",
      ['data-hint="1"', 'data-hint="2"', 'data-hint="3"'].every((s) => homeHtml.includes(s))
    );
    check(
      "archive page never names the withheld integrity field",
      !homeHtml.includes("Falsified_To_Protect_Flag")
    );
    check(
      "archive page names no hidden discovery routes",
      !homeHtml.includes("/recovery/manifest") &&
        !homeHtml.includes("/recovery/channel") &&
        !homeHtml.includes("/api/cases") &&
        !homeHtml.includes("/api/fragment")
    );

    const robots = await (await fetch(`${BASE}/robots.txt`)).text();
    check("robots.txt lists the archived recovery route", robots.includes("/recovery/manifest"));
    check(
      "robots.txt disallows the recovery prefix and its system artifacts",
      robots.includes("Disallow: /recovery/") &&
        robots.includes("/recovery/channel") &&
        robots.includes("/recovery/attempts")
    );

    const statusRes = await fetch(`${BASE}/status`);
    const statusHtml = await statusRes.text();
    check("status page serves", statusRes.status === 200);
    check("status page leaks no flag", !statusHtml.includes("RZ{"));
    check("status nav points to /archive, not /",
      statusHtml.includes('href="/archive"') && !statusHtml.includes('href="/"'));
    const sampleTokenMatch = /class="token-line">(PRT1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)</.exec(statusHtml);
    check("status page publishes an expired sample token", Boolean(sampleTokenMatch));
    check("status page states the derivation recipe", statusHtml.includes("PRALAYA::"));

    /* ---- step 2: IDOR enumeration ---- */
    const records = new Map();
    for (let n = 1; n <= 120; n++) {
      const id = `S${String(n).padStart(3, "0")}`;
      const res = await fetch(`${BASE}/api/case/${id}`);
      if (res.status !== 200) {
        failures.push(`IDOR enumeration broke at ${id} (status ${res.status})`);
        continue;
      }
      const body = await res.json();
      records.set(id, body.record);
    }
    check("all 120 record addresses enumerable without authorization", records.size === 120);
    const sample = records.get("S001");
    check(
      "case projection withholds Falsified_To_Protect_Flag",
      sample && !("Falsified_To_Protect_Flag" in sample)
    );
    check("case projection exposes Evidence_Fragment_Count", sample && "Evidence_Fragment_Count" in sample);
    check("case projection exposes Identity_Record_Status", sample && "Identity_Record_Status" in sample);
    check("case projection exposes Signature_Valid_Flag", sample && "Signature_Valid_Flag" in sample);
    check(
      "case projection carries custodian provenance (the fair dead end)",
      sample && (sample.provenance === "CUSTODIAN-7" || sample.provenance === "SYNC-DAEMON")
    );
    check(
      "every record falls inside a journal window (sync_event always present)",
      [...records.values()].every((r) => /^SW-0[1-6]$/.test(r.sync_event))
    );

    const linkHeader = (await fetch(`${BASE}/api/case/S001`)).headers.get("link");
    check('case API advertises the collection route', linkHeader === '</api/cases>; rel="collection"');

    const releasedRecords = [...records.values()].filter((r) => r.released === true);
    check("exactly 6 records are flagged as released", releasedRecords.length === 6);

    const unreleased = await fetch(`${BASE}/api/case/${TRAP_ID}`);
    const unreleasedBody = await unreleased.json();
    check(
      "trap record reachable through IDOR despite not being released",
      unreleased.status === 200 && unreleasedBody.record.released === false
    );

    /* ---- step 3: secret derivation from the status-page recipe ---- */
    const partA = releasedRecords
      .map((r) => `${r.Sanctuary_ID}:${r.Evidence_Fragment_Count}`)
      .join("|");
    let partB = 0;
    for (const r of records.values()) {
      if (r.released === false) partB += Number.parseInt(r.Evidence_Fragment_Count, 10);
    }
    const recipe = `PRALAYA::${partA}||${partB}`;
    const signerKey = sha256Hex(recipe);
    check("part A built from released cases", partA === "S001:5|S002:1|S003:6|S004:3|S005:5|S006:4", partA);
    check("part B is the evidence sum of unreleased records", Number.isInteger(partB) && partB > 0, String(partB));
    check("signer key is a 64-char hex digest", /^[0-9a-f]{64}$/.test(signerKey));

    /* the retired sample token must not be replayable */
    if (sampleTokenMatch) {
      const replay = await fetch(`${BASE}/recovery/manifest`, {
        headers: { Authorization: `Bearer ${sampleTokenMatch[1]}` },
      });
      check("retired sample token rejected (expired + retired key)", replay.status === 403);
    }

    /* ---- step 4: forge a token with the derived key ---- */
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: "recovery-service",
      role: "recovery_archivist",
      scope: ["manifest:read", "fragment:submit"],
      iat: now - 5,
      exp: now + 3600,
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const token = `PRT1.${payloadB64}.${hmacBase64Url(signerKey, `PRT1.${payloadB64}`)}`;
    check("forged token has the advertised shape", /^PRT1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token));

    const noAuth = await fetch(`${BASE}/recovery/manifest`);
    check("manifest refuses anonymous access", noAuth.status === 403);
    const badAuth = await fetch(`${BASE}/recovery/manifest`, {
      headers: { Authorization: "Bearer PRT1.aaaa.bbbb" },
    });
    check("manifest refuses garbage token", badAuth.status === 403);

    /* ---- step 5: the recovery manifest (the trap) ---- */
    const manifestRes = await fetch(`${BASE}/recovery/manifest`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    check("forged token accepted by the manifest route", manifestRes.status === 200);
    check(
      "manifest reports integrity UNVERIFIED (the don't-trust-me signal)",
      manifestRes.headers.get("x-manifest-integrity") === "unverified"
    );
    const etag = manifestRes.headers.get("etag");
    check("manifest returns an ETag", Boolean(etag) && etag.startsWith('"'));
    const manifestText = await manifestRes.text();
    const manifest = JSON.parse(manifestText);
    check("manifest lists 13 candidate records", Array.isArray(manifest.records) && manifest.records.length === 13);
    check(
      "manifest attestations are inconsistent (12 of 13 countersigned)",
      manifest.attestation.countersigned === 12 && manifest.attestation.pending === 1
    );
    const manifestIds = manifest.records.map((r) => r.id).sort();
    check("trap record is present in the manifest (the plausible-but-wrong answer)", manifestIds.includes(TRAP_ID));
    const etagBodyHash = `"${sha256Hex(manifestText)}"`;
    check("manifest ETag is the digest of the exact response body", etagBodyHash === etag, `${etagBodyHash} vs ${etag}`);

    /* ---- step 5b: system artifacts (journal, attempt log, folded channel) ---- */
    console.log("\n== system artifacts ==");
    const syncRes = await fetch(`${BASE}/api/system/sync-log`);
    check("synchronization journal serves", syncRes.status === 200);
    const syncLog = await syncRes.json();
    check(
      "journal carries six windows SW-01..SW-06 in order",
      Array.isArray(syncLog.events) &&
        syncLog.events.map((e) => e.id).join(",") === "SW-01,SW-02,SW-03,SW-04,SW-05,SW-06"
    );
    const sw3 = syncLog.events.find((e) => e.id === "SW-03");
    check(
      "SW-03 is the aborted window that compiled the manifest",
      Boolean(sw3) && sw3.outcome === "aborted" && sw3.note.includes("manifest compiled 02:14:07Z")
    );
    check(
      "manifest timestamp falls inside the SW-03 window",
      Boolean(sw3) &&
        Date.parse(manifest.generated) >= Date.parse(sw3.from) &&
        Date.parse(manifest.generated) < Date.parse(sw3.to)
    );
    check(
      "journal windows account for all 120 records",
      syncLog.events.reduce((s, e) => s + e.records_touched, 0) === 120
    );
    const syncText = JSON.stringify(syncLog);
    check(
      "journal leaks no record addresses, flag or withheld field",
      !/S\d{3}/.test(syncText) && !syncText.includes("RZ{") && !syncText.includes("Falsified")
    );
    check(
      "journal is read-only",
      (await fetch(`${BASE}/api/system/sync-log`, { method: "POST" })).status === 405
    );

    const attemptsRes = await fetch(`${BASE}/recovery/attempts`);
    check("recovery attempt log serves", attemptsRes.status === 200);
    const attemptLog = await attemptsRes.json();
    check(
      "attempt log documents all four reference failures",
      ["E_TOKEN", "E_ETAG", "E_EVENT", "E_ATTEST"].every((c) =>
        attemptLog.attempts.some((a) => a.code === c)
      )
    );
    check(
      "attempt log never contains a record address",
      !/S\d{3}/.test(JSON.stringify(attemptLog))
    );
    const channelRes = await fetch(`${BASE}/recovery/channel`);
    check("folded recovery channel answers 410 Gone", channelRes.status === 410);
    const channelBody = await channelRes.json();
    check(
      "channel points at the live attestation route (the fair pointer)",
      channelBody.superseded_by === "POST /api/fragment/submit"
    );

    /* ---- step 6: second, independent discovery — the audit dialect ---- */
    const notAcceptable = await fetch(`${BASE}/api/cases`);
    check("collection route refuses default Accept with 406", notAcceptable.status === 406);
    const nAJson = await notAcceptable.json();
    check(
      "406 names the required dialect",
      Array.isArray(nAJson.supported) && nAJson.supported.includes(AUDIT_DIALECT)
    );

    const auditRes = await fetch(`${BASE}/api/cases`, { headers: { Accept: AUDIT_DIALECT } });
    check("audit dialect accepted", auditRes.status === 200);
    check(
      "audit export content type matches the dialect",
      (auditRes.headers.get("content-type") || "").includes(AUDIT_DIALECT)
    );
    const audit = parseSimpleCsv(await auditRes.text());
    check("audit export carries the falsification column", audit.header.includes("Falsified_To_Protect_Flag"));
    check("audit export omits status/signature (not a shortcut for the other steps)",
      !audit.header.includes("Identity_Record_Status") && !audit.header.includes("Signature_Valid_Flag"));
    check("audit export covers all 120 records", audit.rows.length === 120);
    const falsifiedIdx = audit.header.indexOf("Falsified_To_Protect_Flag");
    const idIdx = audit.header.indexOf("Sanctuary_ID");
    const falsifiedById = new Map(audit.rows.map((r) => [r[idIdx], r[falsifiedIdx]]));

    /* ---- step 7: synthesis ---- */
    const verifiedSigned = [...records.values()]
      .filter((r) => r.Identity_Record_Status === "IDENTITY_VERIFIED" && r.Signature_Valid_Flag === "True")
      .map((r) => r.Sanctuary_ID)
      .sort();
    check(
      "independent filter (status + signature) yields the same 13 candidates as the manifest",
      JSON.stringify(verifiedSigned) === JSON.stringify(manifestIds)
    );

    const derivedIds = verifiedSigned.filter((id) => falsifiedById.get(id) !== "True").sort();
    check(
      `cross-referencing removes exactly the trap (${TRAP_ID}) and yields 12 rows`,
      JSON.stringify(derivedIds) === JSON.stringify(EXPECTED_FRAGMENT_IDS),
      JSON.stringify(derivedIds)
    );
    check(
      "manifest list alone would have been wrong by one row",
      manifestIds.length === 13 && !derivedIds.includes(TRAP_ID) && manifestIds.includes(TRAP_ID)
    );

    /* the two designed dead ends, asserted from the data itself */
    const alteredIdx = audit.header.indexOf("Record_Alteration_Flag");
    const falsifiedCount = audit.rows.filter((r) => r[falsifiedIdx] === "True").length;
    const alteredCount = audit.rows.filter((r) => r[alteredIdx] === "True").length;
    const custodianCount = [...records.values()].filter((r) => r.provenance === "CUSTODIAN-7").length;
    check(
      "custodian provenance mirrors alteration (57), not falsification (34) — the dead end",
      custodianCount === alteredCount && alteredCount === 57 && falsifiedCount === 34
    );
    check(
      "falsified rows are a strict subset of custodian-touched rows (provenance cannot discriminate)",
      audit.rows.every((r) => r[falsifiedIdx] !== "True" || r[alteredIdx] === "True") &&
        alteredCount > falsifiedCount
    );
    const candidateEvents = new Set(verifiedSigned.map((id) => records.get(id).sync_event));
    check(
      "candidates spread across journal windows (the sync event is not an oracle)",
      candidateEvents.size >= 4,
      [...candidateEvents].join(",")
    );

    /* ---- step 8: submission — negative paths first ---- */
    console.log("\n== submission negatives ==");
    const submitUrl = `${BASE}/api/fragment/submit`;
    const jsonHeaders = { "Content-Type": "application/json" };

    let res = await fetch(submitUrl, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ ids: derivedIds }),
    });
    check("submission without token -> 403", res.status === 403);

    res = await fetch(submitUrl, {
      method: "POST",
      headers: { ...jsonHeaders, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ids: derivedIds }),
    });
    check("submission without manifest ETag -> 403", res.status === 403);

    res = await fetch(submitUrl, {
      method: "POST",
      headers: { ...jsonHeaders, Authorization: `Bearer ${token}`, "X-Manifest-ETag": '"deadbeef"' },
      body: JSON.stringify({ ids: derivedIds }),
    });
    check("submission with stale ETag -> 403", res.status === 403);

    res = await fetch(submitUrl, {
      method: "POST",
      headers: { ...jsonHeaders, Authorization: `Bearer ${token}`, "X-Manifest-ETag": etag },
      body: JSON.stringify({ ids: derivedIds }),
    });
    const noEventText = await res.text();
    check("submission without sync event -> 403", res.status === 403);
    check("sync-event rejection points at the journal", noEventText.includes("/api/system/sync-log"));
    check(
      "sync-event rejection leaks no addresses or flag",
      !/S\d{3}/.test(noEventText) && !noEventText.includes("RZ{")
    );

    res = await fetch(submitUrl, {
      method: "POST",
      headers: {
        ...jsonHeaders,
        Authorization: `Bearer ${token}`,
        "X-Manifest-ETag": etag,
        "X-Sync-Event": "SW-01",
      },
      body: JSON.stringify({ ids: derivedIds }),
    });
    const wrongEventText = await res.text();
    check("submission with a non-compiling sync event -> 403", res.status === 403);

    res = await fetch(submitUrl, {
      method: "POST",
      headers: {
        ...jsonHeaders,
        Authorization: `Bearer ${token}`,
        "X-Manifest-ETag": etag,
        "X-Sync-Event": "not-an-event",
      },
      body: JSON.stringify({ ids: derivedIds }),
    });
    const garbageEventText = await res.text();
    check("submission with a garbage sync event -> 403", res.status === 403);
    check(
      "sync-event rejections are identical regardless of value (no oracle)",
      noEventText === wrongEventText && wrongEventText === garbageEventText
    );

    res = await fetch(submitUrl, {
      method: "POST",
      headers: {
        ...jsonHeaders,
        Authorization: `Bearer ${token}`,
        "X-Manifest-ETag": etag,
        "X-Sync-Event": "SW-03",
      },
      body: "{not json",
    });
    check("malformed JSON -> 400", res.status === 400);

    res = await fetch(submitUrl, {
      method: "POST",
      headers: {
        ...jsonHeaders,
        Authorization: `Bearer ${token}`,
        "X-Manifest-ETag": etag,
        "X-Sync-Event": "SW-03",
      },
      body: JSON.stringify({ ids: "S001" }),
    });
    check("ids not an array -> 400", res.status === 400);

    res = await fetch(submitUrl, {
      method: "POST",
      headers: {
        ...jsonHeaders,
        Authorization: `Bearer ${token}`,
        "X-Manifest-ETag": etag,
        "X-Sync-Event": "SW-03",
      },
      body: JSON.stringify({ ids: [...derivedIds, TRAP_ID] }),
    });
    const rejectText = await res.text();
    check("the plausible-but-wrong manifest list (13 ids) -> rejected", res.status === 400);
    check("rejection is generic", rejectText.includes("attestation rejected"));
    check(
      "rejection never names an incorrect item",
      !rejectText.includes(TRAP_ID) && !rejectText.includes("S001") && !/"ids"/.test(rejectText)
    );

    res = await fetch(submitUrl, {
      method: "POST",
      headers: {
        ...jsonHeaders,
        Authorization: `Bearer ${token}`,
        "X-Manifest-ETag": etag,
        "X-Sync-Event": "SW-03",
      },
      body: JSON.stringify({ ids: derivedIds.slice(0, 11) }),
    });
    check("subset of the correct set -> rejected", res.status === 400);

    res = await fetch(submitUrl, {
      method: "POST",
      headers: {
        ...jsonHeaders,
        Authorization: `Bearer ${token}`,
        "X-Manifest-ETag": etag,
        "X-Sync-Event": "SW-03",
      },
      body: JSON.stringify({ ids: [...derivedIds.slice(0, 11), "S999"] }),
    });
    check("one swapped-in unknown id -> rejected", res.status === 400);

    res = await fetch(submitUrl, { method: "GET" });
    check("GET method on submit -> 405", res.status === 405);

    /* ---- the real submission ---- */
    console.log("\n== submission ==");
    res = await fetch(submitUrl, {
      method: "POST",
      headers: {
        ...jsonHeaders,
        Authorization: `Bearer ${token}`,
        "X-Manifest-ETag": etag,
        "X-Sync-Event": "SW-03",
      },
      body: JSON.stringify({ ids: derivedIds }),
    });
    check("correct set accepted", res.status === 200);
    const result = await res.json();
    check("response carries a flag", typeof result.flag === "string");
    check("flag matches the documented format", /^RZ\{[0-9a-f]{40}\}$/.test(result.flag || ""), result.flag);

    const expectedFlag =
      "RZ{" +
      sha256Hex(`RZ1::FRAGMENT1::${EXPECTED_FRAGMENT_IDS.join(",")}::${DEFAULT_SALT}`).slice(0, 40) +
      "}";
    check(
      "flag is the documented hash of the exact id set + salt",
      result.flag === expectedFlag,
      `${result.flag} vs ${expectedFlag}`
    );
    check(
      "flag ties to the exact set (including the trap would change it)",
      expectedFlag !==
        "RZ{" + sha256Hex(`RZ1::FRAGMENT1::${manifestIds.join(",")}::${DEFAULT_SALT}`).slice(0, 40) + "}"
    );
    check("response includes a download link", typeof result.download === "string");

    /* ---- fragment download ---- */
    const dl = await fetch(`${BASE}${result.download}`);
    check("fragment download succeeds", dl.status === 200);
    check(
      "fragment served as CSV attachment",
      (dl.headers.get("content-disposition") || "").includes("FRAGMENT_1.csv")
    );
    const csvText = await dl.text();
    const parsed = parseSimpleCsv(csvText);
    check(
      "fragment has exactly the 5 specified columns",
      JSON.stringify(parsed.header) ===
        JSON.stringify([
          "Sanctuary_ID",
          "Original_Name",
          "Original_Occupation",
          "Original_Skills",
          "Original_Sector_Of_Residence",
        ]),
      JSON.stringify(parsed.header)
    );
    check("fragment has exactly 12 data rows", parsed.rows.length === 12, String(parsed.rows.length));
    check(
      "fragment ids match the true row set exactly",
      JSON.stringify(parsed.rows.map((r) => r[0])) === JSON.stringify(EXPECTED_FRAGMENT_IDS),
      JSON.stringify(parsed.rows.map((r) => r[0]))
    );
    check("fragment excludes the trap row", !csvText.includes(TRAP_ID) && !csvText.includes("Kabir Voss"));

    /* cross-check every sliced cell against the real parent CSV, independently */
    const parentText = fs.readFileSync(path.join(ROOT, "data", "PARENT_FINAL.csv"), "utf8");
    const parent = parseSimpleCsv(parentText);
    check(
      "parent CSV parses uniformly (no embedded commas)",
      parent.rows.every((r) => r.length === parent.header.length)
    );
    const pIdx = Object.fromEntries(parent.header.map((h, i) => [h, i]));
    const expectedRows = parent.rows
      .filter((r) => EXPECTED_FRAGMENT_IDS.includes(r[pIdx.Sanctuary_ID]))
      .map((r) =>
        [
          r[pIdx.Sanctuary_ID],
          r[pIdx.Original_Name],
          r[pIdx.Original_Occupation],
          r[pIdx.Original_Skills],
          r[pIdx.Original_Sector_Of_Residence],
        ].join(",")
      );
    check(
      "every fragment cell matches PARENT_FINAL.csv verbatim",
      JSON.stringify(parsed.rows.map((r) => r.join(","))) === JSON.stringify(expectedRows)
    );

    /* bad ticket */
    const badDl = await fetch(`${BASE}/api/fragment/1/download?ticket=PRT1.aaaa.bbbb`);
    check("forged/absent ticket rejected", badDl.status === 403);

    /* ---- edge cases ---- */
    console.log("\n== edges ==");
    check("unknown id -> 404", (await fetch(`${BASE}/api/case/S999`)).status === 404);
    check("malformed id -> 400", (await fetch(`${BASE}/api/case/NOTANID`)).status === 400);
    check("empty id -> 400", (await fetch(`${BASE}/api/case/`)).status === 400);
    const traversal = await fetch(`${BASE}/api/case/%2e%2e%2f%2e%2e%2fsrc%2fserver`);
    check("encoded traversal in id -> 400", traversal.status === 400);

    const rawTraversal = await rawGet("/..%2f..%2fsrc/server.js");
    check(
      "raw dot-segment traversal on static routes blocked",
      rawTraversal.status === 404 && !rawTraversal.body.includes("deriveSignerKey")
    );
    const rawTraversal2 = await rawGet("/css/%2e%2e/%2e%2e/src/server.js");
    check(
      "encoded dot-segment traversal on static routes blocked",
      rawTraversal2.status === 404 && !rawTraversal2.body.includes("deriveSignerKey")
    );
    check("source route not directly served", (await fetch(`${BASE}/src/server.js`)).status === 404);
    check("data file not directly served", (await fetch(`${BASE}/data/PARENT_FINAL.csv`)).status === 404);

    const notFound = await fetch(`${BASE}/no/such/page`, { headers: { Accept: "text/html" } });
    check("styled 404 for browsers", notFound.status === 404);
    const notFoundHtml = await notFound.text();
    check(
      "404 page points at robots.txt without listing the route",
      notFoundHtml.includes("robots.txt") && !notFoundHtml.includes("/recovery/manifest")
    );
    check("404 nav points to /archive, not /",
      notFoundHtml.includes('href="/archive"') && !notFoundHtml.includes('href="/"'));
    check("POST to case route -> 405", (await fetch(`${BASE}/api/case/S001`, { method: "POST" })).status === 405);

    /* static assets carry no secrets */
    let leaked = null;
    for (const asset of [
      "/", "/archive", "/status", "/css/terminal.css", "/css/workstation.css",
      "/js/app.js", "/js/audio.js", "/js/boot.js", "/robots.txt", "/404.html",
    ]) {
      const text = await (await fetch(`${BASE}${asset}`)).text();
      if (text.includes("RZ{") || text.includes(DEFAULT_SALT)) leaked = asset;
    }
    check("no static asset contains the flag format or the salt", leaked === null, leaked || "");

    /* the client controller must not hand out the discovery chain */
    const appJs = await (await fetch(`${BASE}/js/app.js`)).text();
    check(
      "client controller hardcodes no hidden discovery routes",
      !/recovery\/manifest|recovery\/channel|api\/fragment|api\/cases/.test(appJs)
    );

    /* ---- verdict ---- */
    console.log(`\n${passed} checks passed, ${failures.length} failed`);
    if (failures.length) {
      console.log("failures:");
      for (const f of failures) console.log(`  - ${f}`);
      process.exitCode = 1;
    } else {
      console.log(`\nFLAG FOR THIS BUILD: ${result.flag}`);
    }
  } finally {
    server.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
