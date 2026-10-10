/* =====================================================================
   RED ZONE CTF 3 — test/run.js
   Full verification: dataset integrity, puzzle derivation, frontend
   leak scan, CSP compliance, live API behaviour, stage gating, flag
   validation, recovered-dataset gating, static whitelist, spawn test.

   Run: npm test   (zero dependencies, Node >= 18)
   ===================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const vm = require("vm");
const { spawn, execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

/* known source-dataset hashes (the workspace originals) */
const PARENT_SHA = "1c951859b23be1d14c0587e64eda9d65d9df5be87133ba7187ecc063e8f4a061";
const CHILD_SHA = "91456ae8a2a26242c7796aab76011add59fdda262dcb7cdc648155d63d6b2f59";

/* ------------------------------------------------------------------ */
/* tiny assertion harness                                              */
/* ------------------------------------------------------------------ */
const results = [];
function test(name, fn) { results.push({ name, fn }); }
function ok(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg || "not equal") + "  expected=" + JSON.stringify(b) + "  actual=" + JSON.stringify(a));
}

/* ------------------------------------------------------------------ */
/* http helpers                                                        */
/* ------------------------------------------------------------------ */
function req(port, reqPath, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const r = http.request({
      host: "127.0.0.1", port, path: reqPath,
      method: opts.method || "GET",
      headers: Object.assign({ "Content-Type": "application/json" }, opts.headers || {})
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString("utf8"),
        json() { try { return JSON.parse(this.body); } catch (e) { return null; } }
      }));
    });
    r.on("error", reject);
    if (opts.body != null) r.write(typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body));
    r.end();
  });
}
const post = (port, p, body) => req(port, p, { method: "POST", body });

/* ================================================================== */
/* 1. DATASET INTEGRITY (self-contained: nothing outside the project) */
/* ================================================================== */
test("data/PARENT_FINAL.csv exists, is readable, matches the expected dataset", () => {
  const p = path.join(ROOT, "data", "PARENT_FINAL.csv");
  ok(fs.existsSync(p), "missing data/PARENT_FINAL.csv");
  const buf = fs.readFileSync(p);
  ok(buf.length > 0, "empty dataset");
  eq(sha(buf), PARENT_SHA, "parent dataset changed byte-for-byte");
  const lines = buf.toString("utf8").replace(/\r\n/g, "\n").trim().split("\n");
  eq(lines.length, 121, "header + 120 records");
  const h = lines[0].split(",");
  eq(h.length, 26, "26 columns");
  eq(h[0], "Sanctuary_ID");
  eq(h[25], "Identity_Recovery_Score");
  lines.slice(1).forEach((l, i) => eq(l.split(",").length, 26, "row " + (i + 2) + " must have 26 fields"));
  eq(lines[1].split(",")[0], "S001");
});

test("data/CHILD_FINAL.csv exists, is readable, matches the expected dataset", () => {
  const p = path.join(ROOT, "data", "CHILD_FINAL.csv");
  ok(fs.existsSync(p), "missing data/CHILD_FINAL.csv");
  const buf = fs.readFileSync(p);
  ok(buf.length > 0, "empty dataset");
  eq(sha(buf), CHILD_SHA, "child dataset changed byte-for-byte");
  const lines = buf.toString("utf8").replace(/\r\n/g, "\n").trim().split("\n");
  eq(lines.length, 121, "header + 120 records");
  const h = lines[0].split(",");
  eq(h.length, 14, "14 columns");
  eq(h[0], "Sanctuary_ID");
  eq(h[12], "Sector_Exposure");
  eq(h[13], "Original_Occupation_Category");
  lines.slice(1).forEach((l, i) => eq(l.split(",").length, 14, "row " + (i + 2) + " must have 14 fields"));
});

test("both datasets join perfectly on Sanctuary_ID", () => {
  const { Store } = require("../backend/store.js");
  const store = Store(path.join(ROOT, "data", "PARENT_FINAL.csv"), path.join(ROOT, "data", "CHILD_FINAL.csv"));
  eq(store.parentRows.length, 120);
  eq(store.childRows.length, 120);
  eq(store.pHeader.length, 26);
  eq(store.cHeader.length, 14);
  eq(store.scoreCols.length, 11, "11 skill-score columns");
  store.parentRows.forEach((r) => ok(store.childById.has(r.Sanctuary_ID), "no child for " + r.Sanctuary_ID));
  store.childRows.forEach((r) => ok(store.parentById.has(r.Sanctuary_ID), "no parent for " + r.Sanctuary_ID));
  /* occupation category must always agree — a real cross-artifact invariant */
  store.parentRows.forEach((r) => {
    const c = store.childById.get(r.Sanctuary_ID);
    eq(c.Original_Occupation_Category, r.Original_Occupation, "occupation conflict on " + r.Sanctuary_ID);
  });
  eq(store.stats.altered, 57);
  eq(store.stats.untouched, 63);
  eq(store.stats.signatureFailed, 23);
  eq(store.stats.locked, 36);
});

/* ================================================================== */
/* 2. PUZZLE DERIVATION (from the real data)                          */
/* ================================================================== */
const { Store } = require("../backend/store.js");
const puzzle = require("../backend/puzzle.js");
const store = Store(path.join(ROOT, "data", "PARENT_FINAL.csv"), path.join(ROOT, "data", "CHILD_FINAL.csv"));
const solution = puzzle.solve(store);
const derivedFlag = puzzle.expectedFlag(store);

const EXPECTED_PROV = ["S022", "S026", "S032", "S043", "S052", "S072", "S075", "S086", "S088"];
const EXPECTED_CHRON = ["S001", "S031", "S051", "S085", "S096", "S099", "S102"];
const EXPECTED_CORR = ["S017", "S020", "S035", "S041", "S068", "S070", "S081", "S088", "S091", "S116"];

test("rule III: authenticity below the 0.500 floor yields exactly the 9 unsealed records", () => {
  eq(solution.provenance.length, 9, "count");
  eq(solution.provenance.join(","), EXPECTED_PROV.join(","), "membership");
  solution.provenance.forEach((id) => {
    const d = store.derived.get(id);
    ok(d.auth < 0.5, id + " must be below the floor");
    eq(d.status, "LOCKED", id + " must be LOCKED");
  });
  /* every record at or above the floor must NOT be filed */
  store.parentRows.forEach((r) => {
    const inSet = solution.provenance.indexOf(r.Sanctuary_ID) >= 0;
    eq(inSet, Number(r.Record_Authenticity_Score) < 0.5, "misclassified " + r.Sanctuary_ID);
  });
});

test("rule IV: audit later than 7d 12h yields exactly the 7 moved clocks", () => {
  eq(solution.chronology.length, 7, "count");
  eq(solution.chronology.join(","), EXPECTED_CHRON.join(","), "membership");
  solution.chronology.forEach((id) => ok(store.derived.get(id).gapDays > 7.5, id + " must breach the window"));
  /* the three records sitting exactly on 7.5000 must NOT be filed */
  ["S061", "S092", "S118"].forEach((id) => {
    const d = store.derived.get(id);
    ok(Math.abs(d.gapDays - 7.5) < 1e-9, id + " should sit exactly on the window");
    ok(solution.chronology.indexOf(id) < 0, id + " is at the limit — equality is not breach");
  });
  /* exhaustive check across all 120 */
  store.parentRows.forEach((r) => {
    const inSet = solution.chronology.indexOf(r.Sanctuary_ID) >= 0;
    eq(inSet, store.derived.get(r.Sanctuary_ID).gapDays > 7.5, "misclassified " + r.Sanctuary_ID);
  });
});

test("rule V: >=2 child blanks over an admitted edit yields exactly the 10 erased profiles", () => {
  eq(solution.correlation.length, 10, "count");
  eq(solution.correlation.join(","), EXPECTED_CORR.join(","), "membership");
  solution.correlation.forEach((id) => {
    const d = store.derived.get(id);
    ok(d.childBlanks >= 2, id + " must have >= 2 blanks");
    ok(d.altered, id + " parent must carry the alteration flag");
  });
  /* S088 is the join-sensitive case: 2 blanks (Leadership + Team_Coordination) */
  ok(solution.correlation.indexOf("S088") >= 0, "S088 must be included (2 blanks, altered)");
  /* near misses must be excluded */
  ["S013", "S033", "S048"].forEach((id) => {           /* >=2 blanks, parent NOT altered */
    ok(solution.correlation.indexOf(id) < 0, id + " has blanks but no admitted edit");
    ok(store.derived.get(id).childBlanks >= 2 && !store.derived.get(id).altered);
  });
  ["S002", "S005"].forEach((id) => {                   /* altered, but only 1 blank */
    ok(solution.correlation.indexOf(id) < 0, id + " is altered but not erased");
    ok(store.derived.get(id).childBlanks < 2);
  });
});

test("material format + flag shape: RZ{32 hex}, deterministic, env override wins", () => {
  eq(solution.material, EXPECTED_PROV.join(",") + "|" + EXPECTED_CHRON.join(",") + "|" + EXPECTED_CORR.join(","));
  ok(/^RZ\{[0-9a-f]{32}\}$/.test(derivedFlag), "flag shape: " + derivedFlag);
  eq(puzzle.expectedFlag(store), derivedFlag, "deterministic recompute");
  eq(puzzle.expectedFlag(store, { METADATA_FLAG: "RZ{override}" }), "RZ{override}", "env override");
  const again = puzzle.solve(Store(path.join(ROOT, "data", "PARENT_FINAL.csv"), path.join(ROOT, "data", "CHILD_FINAL.csv")));
  eq(again.material, solution.material, "stable across reloads");
});

/* ================================================================== */
/* 3. CLIENT-SIDE DIGEST (the assembly console)                       */
/* ================================================================== */
test("frontend sha256 matches NIST vectors and the server digest", () => {
  const src = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");
  const m = src.match(/function sha256hex[\s\S]*?\n}/);
  ok(m, "sha256hex present in app.js");
  const ctx = { TextEncoder, Uint8Array, DataView, Uint32Array, Math, console };
  vm.createContext(ctx);
  vm.runInContext(m[0] + "; this.f=sha256hex;", ctx);
  const f = ctx.f;
  eq(f("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "NIST vector");
  eq(f(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "empty vector");
  const nodeDigest = crypto.createHash("sha256").update(solution.material, "utf8").digest("hex");
  eq(f(solution.material), nodeDigest, "client digest must equal server digest");
  eq("RZ{" + f(solution.material).slice(0, 32) + "}", derivedFlag, "client recipe reproduces the flag");
});

/* ================================================================== */
/* 4. FRONTEND LEAK + CSP SCAN                                         */
/* ================================================================== */
const CLIENT_FILES = ["index.html", "css/main.css", "js/explorer.js", "js/inspector.js",
  "js/graph.js", "js/timeline.js", "js/app.js", "assets/favicon.svg"];

test("no flag, material or solution extract is present in any client file", () => {
  CLIENT_FILES.forEach((rel) => {
    const body = fs.readFileSync(path.join(ROOT, rel), "utf8");
    ok(body.indexOf(derivedFlag) < 0, "FLAG LEAK in " + rel);
    ok(body.indexOf(solution.material) < 0, "MATERIAL LEAK in " + rel);
    ok(!/RZ\{[0-9a-f]{32}\}/.test(body), "flag-shaped literal in " + rel);
    ok(body.indexOf(EXPECTED_PROV.join(",")) < 0, "PROVENANCE EXTRACT hardcoded in " + rel);
    ok(body.indexOf(EXPECTED_CHRON.join(",")) < 0, "CHRONOLOGY EXTRACT hardcoded in " + rel);
    ok(body.indexOf(EXPECTED_CORR.join(",")) < 0, "CORRELATION EXTRACT hardcoded in " + rel);
  });
});

test("flag never appears in server-side docs or the served protocol", () => {
  ["README.md", "package.json", "backend/store.js"].forEach((rel) => {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) return;
    const body = fs.readFileSync(p, "utf8");
    ok(body.indexOf(derivedFlag) < 0, "FLAG LEAK in " + rel);
  });
  /* backend/puzzle.js derives it — it must never hardcode it */
  const pz = fs.readFileSync(path.join(ROOT, "backend", "puzzle.js"), "utf8");
  ok(pz.indexOf(derivedFlag) < 0, "hardcoded flag in puzzle.js");
  ok(pz.indexOf(solution.material) < 0, "hardcoded material in puzzle.js");
});

test("no inline event handlers (CSP script-src 'self' must hold)", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  ok(!/\son(click|load|error|submit|change|mouseover)\s*=/i.test(html), "inline handler in index.html");
  CLIENT_FILES.filter((f) => f.endsWith(".js") || f.endsWith(".html")).forEach((rel) => {
    const body = fs.readFileSync(path.join(ROOT, rel), "utf8");
    ok(!/\son(click|load|error|submit)\s*=\s*["'`]/i.test(body), "inline handler in " + rel);
  });
  /* every data-act used must be handled by the app.js delegation switch */
  const app = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");
  const used = new Set();
  CLIENT_FILES.forEach((rel) => {
    const body = fs.readFileSync(path.join(ROOT, rel), "utf8");
    for (const m of body.matchAll(/data-act="([a-z-]+)/g)) used.add(m[1]);
  });
  ok(used.size >= 8, "expected data-act usage, found " + used.size);
  used.forEach((act) => {
    ok(app.indexOf('case "' + act + '":') >= 0, "data-act without handler: " + act);
  });
});

test("frontend references only local, whitelisted assets", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
  const externals = refs.filter((r) => /^(https?:)?\/\//.test(r));
  eq(externals.length, 0, "external resources: " + externals.join(","));
  refs.filter((r) => !r.startsWith("#")).forEach((r) => {
    const rel = r.replace(/^\//, "");
    ok(fs.existsSync(path.join(ROOT, rel)), "missing local asset: " + r);
  });
});

test("project is standalone: no references to neighbouring projects", () => {
  const banned = ["GHOST_SIGNAL", "last_dataset_ctf3", "red-zone-ctf1", "Red Zone CTF 1", "Red Zone CTF 2", "CHILD_FINAL .csv", "PARENT_FINAL .csv"];
  /* executable + config files must not mention neighbouring projects at all */
  const scan = ["index.html", "js/explorer.js", "js/inspector.js", "js/graph.js", "js/timeline.js",
    "js/app.js", "backend/server.js", "backend/store.js", "backend/puzzle.js", "package.json"];
  scan.forEach((rel) => {
    const body = fs.readFileSync(path.join(ROOT, rel), "utf8");
    banned.forEach((b) => ok(body.indexOf(b) < 0, rel + " references external project: " + b));
  });
  /* the stylesheet may credit its design foundation in a comment, but must
     never pull a resource from outside this project */
  const css = fs.readFileSync(path.join(ROOT, "css", "main.css"), "utf8");
  ok(!/@import\s+['"]?https?:/i.test(css), "css @imports an external stylesheet");
  ok(!/url\(\s*['"]?(https?:)?\/\//i.test(css), "css loads an external resource");
  banned.filter((b) => b !== "last_dataset_ctf3").forEach((b) =>
    ok(css.indexOf(b) < 0, "css/main.css references external project: " + b));
});

/* ================================================================== */
/* 5. LIVE SERVER                                                      */
/* ================================================================== */
let serverProc = null;
let PORT = 0;

async function serverTests() {
  process.env.PORT = "0";
  delete process.env.METADATA_FLAG;
  const mod = require("../backend/server.js");
  serverProc = mod.server;
  await new Promise((r) => serverProc.on("listening", r));
  PORT = serverProc.address().port;
  ok(PORT > 0, "server listening");

  const cases = [];
  const T = (name, fn) => cases.push([name, fn]);

  T("GET /healthz", async () => {
    const r = await req(PORT, "/healthz");
    eq(r.status, 200); eq(r.json().ok, true); eq(r.json().service, "red-zone-ctf-3");
  });

  T("initial state: only stage I unlocked, no evidence, no hints", async () => {
    const s = (await req(PORT, "/api/state")).json();
    eq(s.progress.intake, false);
    eq(s.progress.solved, false);
    eq(s.unlocked.join(","), "case");
    eq(s.evidence.length, 0);
    eq(s.hints.length, 0);
    eq(s.artifacts.parent, 120); eq(s.artifacts.child, 120);
  });

  T("stage gating: exhibits + extracts + flag are locked at the start", async () => {
    const a = await post(PORT, "/api/exhibits", { inspected: ["PARENT_FINAL.csv", "CHILD_FINAL.csv"] });
    eq(a.status, 403, "exhibits before intake");
    const b = await post(PORT, "/api/provenance", { ids: EXPECTED_PROV });
    eq(b.status, 403, "extract before exhibits");
    const c = await post(PORT, "/api/chronology", { ids: EXPECTED_CHRON });
    eq(c.status, 403, "chronology before exhibits");
    const d = await post(PORT, "/api/flag", { flag: derivedFlag });
    eq(d.json().granted, false);
    eq(d.json().title, "RECONSTRUCTION INCOMPLETE");
    const e = await req(PORT, "/api/download/child");
    eq(e.status, 403, "child dataset must be sealed before recovery");
    const h3 = await req(PORT, "/api/hint/3");
    eq(h3.status, 403, "hint 3 starts locked");
  });

  T("STAGE I: acknowledging the intake unlocks exhibits + hint 1", async () => {
    const r = await post(PORT, "/api/intake", {});
    eq(r.status, 200); eq(r.json().ok, true);
    eq(r.json().unlocked.join(","), "case,exhibits");
    eq(r.json().hints.join(","), "1");
    const h = await req(PORT, "/api/hint/1");
    eq(h.status, 200);
    ok(h.json().hint.length > 30, "hint text");
    ok(h.json().hint.indexOf(derivedFlag) < 0, "hint leaks flag");
    const s = (await req(PORT, "/api/state")).json();
    eq(s.evidence.some((e) => e.id === "CASE-INTAKE"), true, "intake evidence");
  });

  T("STAGE II: exhibits need to be opened, then unlock III–V", async () => {
    const partial = await post(PORT, "/api/exhibits", { inspected: ["PARENT_FINAL.csv"] });
    eq(partial.json().ok, false, "one exhibit is not enough");
    eq(partial.json().remaining.join(","), "CHILD_FINAL.csv");
    const both = await post(PORT, "/api/exhibits", { inspected: ["PARENT_FINAL.csv", "CHILD_FINAL.csv"] });
    eq(both.json().ok, true);
    eq(both.json().unlocked.join(","), "case,exhibits,meta,timeline,correlation");
    eq(both.json().hints.join(","), "1,2");
    const list = (await req(PORT, "/api/exhibits")).json();
    eq(list.exhibits.length, 2);
    eq(list.exhibits[0].sha256, PARENT_SHA, "custody sheet carries the real hash");
    eq(list.exhibits[1].sha256, CHILD_SHA, "custody sheet carries the real hash");
  });

  T("dataset API: pagination, sorting, search, filters", async () => {
    const p1 = await req(PORT, "/api/dataset/parent?limit=15&page=1");
    eq(p1.json().total, 120); eq(p1.json().pages, 8); eq(p1.json().rows.length, 15);
    eq(p1.json().columns.length, 26);
    const asc = await req(PORT, "/api/dataset/parent?sort=Record_Authenticity_Score&dir=asc&limit=3");
    eq(asc.json().rows[0].Sanctuary_ID, "S052", "lowest authenticity first (0.399)");
    ok(Number(asc.json().rows[2].Record_Authenticity_Score) <= 0.5, "top rows under the floor");
    const s = await req(PORT, "/api/dataset/parent?q=Chidi");
    ok(s.json().total >= 1 && s.json().rows[0].Sanctuary_ID === "S001", "search finds Chidi");
    const locked = await req(PORT, "/api/dataset/parent?filter=locked");
    eq(locked.json().total, 36, "locked filter");
    const child = await req(PORT, "/api/dataset/child?filter=blanks");
    ok(child.json().total >= 60, "child blanks filter");
    const bad = await req(PORT, "/api/dataset/parent?q=" + "x".repeat(80));
    eq(bad.status, 400, "oversized query rejected");
  });

  T("record API: full view, relations, trace, error paths", async () => {
    const f = await req(PORT, "/api/record/S088");
    const j = f.json();
    eq(j.id, "S088");
    eq(j.derived.childBlanks, 2, "S088 has two blank skill cells");
    eq(j.derived.altered, true);
    ok(j.derived.auth < 0.5, "S088 is unsealed");
    ok(j.child && j.parent, "both artifacts returned");
    eq(j.scoreColumns.length, 11);
    const low = await req(PORT, "/api/record/s052");
    eq(low.json().id, "S052", "lowercase id accepted");
    const rel = await req(PORT, "/api/record/S001/relations");
    eq(rel.json().degree, 3, "Relationship_History degree");
    rel.json().links.forEach((l) => ok(l.id && l.status, "link summary"));
    const tr = await req(PORT, "/api/record/S017/trace");
    eq(tr.json().chain.length, 5, "VC -> TM -> MT -> record -> child");
    eq(tr.json().chain[0].value, "VC-1016");
    const none = await req(PORT, "/api/record/S999");
    eq(none.status, 404); eq(none.json().error, "NO_RECORD");
    const badId = await req(PORT, "/api/record/XYZ");
    eq(badId.status, 404);
    const badView = await req(PORT, "/api/record/S001/evil");
    eq(badView.status, 400); eq(badView.json().error, "BAD_VIEW");
  });

  T("timeline + correlation ledger expose the real measurements", async () => {
    const t = (await req(PORT, "/api/timeline")).json();
    eq(t.count, 120);
    eq(t.windowDays, 7.5);
    const s001 = t.events.find((e) => e.id === "S001");
    eq(s001.transfer, "2024-09-13");
    eq(s001.audit, "2024-09-20 21:00:00");
    const l = (await req(PORT, "/api/ledger")).json();
    eq(l.count, 120);
    const s088 = l.rows.find((r) => r.id === "S088");
    eq(s088.blanks, 2);
    eq(s088.altered, true);
    eq(l.rows.filter((r) => r.blanks >= 2 && r.altered).length, 10, "ledger supports rule V");
    eq(l.rows.filter((r) => r.auth < 0.5).length, 9, "ledger supports rule III");
    eq(l.rows.filter((r) => r.gap > 7.5).length, 7, "ledger supports rule IV");
  });

  T("protocol is published and does not contain the flag", async () => {
    const p = (await req(PORT, "/api/protocol")).json().protocol;
    ok(p.indexOf("sha256") >= 0, "digest recipe");
    ok(p.indexOf("RZ{") >= 0, "flag format");
    ok(p.indexOf("provenance|") >= 0 || p.indexOf("<provenance>|") >= 0, "material recipe");
    ok(p.indexOf(derivedFlag) < 0, "protocol leaks the flag");
    ok(p.indexOf(solution.material) < 0, "protocol leaks the material");
    const brief = (await req(PORT, "/api/brief")).json().log;
    ok(brief.indexOf(derivedFlag) < 0, "brief leaks the flag");
    const rules = (await req(PORT, "/api/rules")).json();
    eq(rules.floor, 0.5); eq(rules.windowDays, 7.5); eq(rules.blankMin, 2);
    const briefs = (await req(PORT, "/api/briefs")).json().briefs;
    eq(Object.keys(briefs).length, 7, "one brief per stage");
  });

  T("STAGE III: wrong extracts rejected, correct extract accepted", async () => {
    const short = await post(PORT, "/api/provenance", { ids: EXPECTED_PROV.slice(0, 8) });
    eq(short.json().ok, false);
    eq(short.json().wrongCount, true, "8 filed / 9 expected");
    ok(short.json().msg.indexOf("8 filed, 9 expected") >= 0, "count feedback: " + short.json().msg);
    const wrongMembership = EXPECTED_PROV.slice(1).concat("S001");
    const wm = await post(PORT, "/api/provenance", { ids: wrongMembership });
    eq(wm.json().ok, false);
    eq(wm.json().wrongMembership, true, "right count, wrong records");
    const good = await post(PORT, "/api/provenance", { ids: EXPECTED_PROV.slice().reverse() });
    eq(good.json().ok, true, "order must not matter");
    eq(good.json().ids.join(","), EXPECTED_PROV.join(","));
    eq(good.json().title, "EXTRACT ACCEPTED");
    ok(good.json().evidence.some((e) => e.id === "PROVENANCE-9"), "evidence stamped with the real count");
  });

  T("STAGE IV: boundary cases rejected, correct 7 accepted, hint 3 unlocks", async () => {
    const atLimit = ["S001", "S031", "S051", "S061", "S085", "S092", "S096", "S099", "S102", "S118"];
    const ge = await post(PORT, "/api/chronology", { ids: atLimit });
    eq(ge.json().ok, false, "including the exactly-7.5 records must be rejected");
    eq(ge.json().wrongCount, true, "10 filed / 7 expected");
    const h3a = await req(PORT, "/api/hint/3");
    eq(h3a.status, 200, "first chronology failure unlocks hint 3");
    ok(h3a.json().hint.indexOf("7d 12h") >= 0, "hint addresses the boundary");
    const wrongMembership = ["S001", "S031", "S051", "S085", "S096", "S099", "S061"];
    const wm = await post(PORT, "/api/chronology", { ids: wrongMembership });
    eq(wm.json().wrongMembership, true);
    const good = await post(PORT, "/api/chronology", { ids: EXPECTED_CHRON });
    eq(good.json().ok, true);
    eq(good.json().ids.length, 7);
    ok(good.json().evidence.some((e) => e.id === "CHRONOLOGY-7"), "chronology evidence");
  });

  T("STAGE V: incomplete set rejected, correct 10 accepted, hint 4 unlocks", async () => {
    const nine = EXPECTED_CORR.filter((x) => x !== "S088");
    const miss = await post(PORT, "/api/correlation", { ids: nine });
    eq(miss.json().ok, false, "missing S088");
    eq(miss.json().wrongCount, true, "9 filed / 10 expected");
    const h4 = await req(PORT, "/api/hint/4");
    eq(h4.status, 200, "first correlation failure unlocks hint 4");
    const wrongMembership = EXPECTED_CORR.slice(0, 9).concat("S013");
    const wm = await post(PORT, "/api/correlation", { ids: wrongMembership });
    eq(wm.json().wrongMembership, true, "S013 has blanks but no admitted edit");
    const good = await post(PORT, "/api/correlation", { ids: EXPECTED_CORR.slice().reverse() });
    eq(good.json().ok, true);
    eq(good.json().reconstruction, true, "all three extracts filed -> reconstruction unlocked");
    eq(good.json().unlocked.join(","), "case,exhibits,meta,timeline,correlation,reconstruction,rec",
      "recovery must be reachable to submit the flag");
    const h5 = await req(PORT, "/api/hint/5");
    eq(h5.status, 200, "all extracts filed unlocks hint 5");
    const s = (await req(PORT, "/api/state")).json();
    eq(s.progress.reconstruction, true);
    eq(s.evidence.length, 6, "intake + 2 exhibits + 3 extracts");
  });

  T("wrong flag -> RECONSTRUCTION FAILED (exact wording, non-spoiling)", async () => {
    const r = await post(PORT, "/api/flag", { flag: "RZ{00000000000000000000000000000000}" });
    const d = r.json();
    eq(r.status, 200);
    eq(d.granted, false);
    eq(d.title, "RECONSTRUCTION FAILED");
    const text = d.lines.join(" ");
    ok(text.indexOf("THE METADATA DOES NOT SUPPORT THIS VALUE") >= 0, "spec wording");
    ok(text.indexOf(derivedFlag) < 0, "no expected value revealed");
    const m = await post(PORT, "/api/flag", { flag: "hello" });
    eq(m.json().granted, false);
    ok(m.json().lines.join(" ").indexOf("MALFORMED") >= 0, "format feedback");
    ok(m.json().lines.join(" ").indexOf(derivedFlag) < 0, "malformed path leaks nothing");
  });

  T("correct flag -> cinematic acceptance payload + evidence", async () => {
    const r = await post(PORT, "/api/flag", { flag: derivedFlag });
    const d = r.json();
    eq(r.status, 200);
    eq(d.granted, true);
    eq(d.title, "FLAG ACCEPTED");
    const lines = d.lines.join("\n");
    ["> VERIFYING METADATA ........ OK", "> VERIFYING PROVENANCE ...... OK",
      "> CORRELATING RECORDS ....... OK", "> REBUILDING INDEX .......... OK",
      "> RESTORING CHILD DATA ...... OK", "> RECOVERY COMPLETE"].forEach((l) =>
      ok(lines.indexOf(l) >= 0, "missing cinematic line: " + l));
    eq(d.reveal.heading, "CHILD DATASET RECOVERED");
    const rows = d.reveal.rows.join("\n");
    ["PROVENANCE       VERIFIED", "INTEGRITY        VERIFIED",
      "RECORDS          RECOVERED", "METADATA         RECONSTRUCTED"].forEach((x) =>
      ok(rows.indexOf(x) >= 0, "missing reveal row: " + x));
    eq(d.reveal.download, "/api/download/child");
    ok(d.evidence.some((e) => e.id === "CHILD-RECOVERED"), "final evidence chip");
    ok(r.body.indexOf(solution.material) < 0, "response must not echo the material");
  });

  T("state after recovery: solved, all stages unlocked", async () => {
    const s = (await req(PORT, "/api/state")).json();
    eq(s.progress.solved, true);
    eq(s.unlocked.join(","), "case,exhibits,meta,timeline,correlation,reconstruction,rec");
    eq(s.evidence.length, 7);
    eq(s.hints.join(","), "1,2,3,4,5");
  });

  T("child dataset now downloads, byte-identical to the shipped file", async () => {
    const r = await req(PORT, "/api/download/child");
    eq(r.status, 200);
    eq(r.headers["content-disposition"], 'attachment; filename="CHILD_FINAL.csv"');
    eq(sha(Buffer.from(r.body, "utf8")), CHILD_SHA, "download must be byte-identical");
    eq(r.body.trim().split("\n").length, 121, "header + 120 records");
    eq(r.body.split("\n")[0].split(",").length, 14);
  });

  T("no API response carries the expected flag", async () => {
    const paths = ["/api/state", "/api/protocol", "/api/brief", "/api/exhibits",
      "/api/hint/1", "/api/hint/2", "/api/hint/5", "/api/rules", "/api/briefs",
      "/api/timeline", "/api/ledger", "/api/record/S001", "/api/record/S001/trace",
      "/api/record/S001/relations", "/api/dataset/parent?limit=5", "/api/dataset/child?limit=5"];
    for (const p of paths) {
      const r = await req(PORT, p);
      ok(r.body.indexOf(derivedFlag) < 0, "FLAG IN " + p);
      ok(r.body.indexOf(solution.material) < 0, "MATERIAL IN " + p);
    }
  });

  T("static whitelist serves the frontend and blocks the rest", async () => {
    for (const p of ["/", "/index.html", "/css/main.css", "/js/app.js", "/js/inspector.js",
      "/js/explorer.js", "/js/graph.js", "/js/timeline.js", "/assets/favicon.svg"]) {
      const r = await req(PORT, p);
      eq(r.status, 200, p);
      ok(r.headers["content-type"], p + " content-type");
    }
    const home = await req(PORT, "/");
    ok(home.body.indexOf("THE LAST") >= 0, "hero renders");
    ok(home.body.indexOf("CHILD-17") >= 0, "reference present");
    const blocked = ["/data/PARENT_FINAL.csv", "/data/CHILD_FINAL.csv", "/backend/server.js",
      "/backend/puzzle.js", "/backend/store.js", "/package.json", "/README.md",
      "/test/run.js", "/tools/flag.js", "/css/../../backend/server.js",
      "/js/%2e%2e/backend/puzzle.js", "/node_modules/x", "/.env"];
    for (const p of blocked) {
      const r = await req(PORT, p);
      ok(r.status !== 200, "LEAK: " + p + " served with " + r.status);
    }
  });

  T("security headers: nosniff, strict CSP, no permissive CORS", async () => {
    const r = await req(PORT, "/");
    eq(r.headers["x-content-type-options"], "nosniff");
    eq(r.headers["x-frame-options"], "DENY");
    const csp = r.headers["content-security-policy"] || "";
    ok(csp.indexOf("script-src 'self'") >= 0, "CSP script-src");
    ok(csp.indexOf("unsafe-inline") < 0 || csp.indexOf("script-src") >= 0, "csp present");
    ok(!/script-src[^;]*unsafe-inline/.test(csp), "CSP must not allow inline script");
    ok(csp.indexOf("object-src 'none'") >= 0, "no plugins");
    const a = await req(PORT, "/api/state");
    eq(a.headers["cache-control"], "no-store");
    ok(!a.headers["access-control-allow-origin"], "no permissive CORS");
  });

  T("malformed bodies are rejected safely", async () => {
    const a = await post(PORT, "/api/flag", "not json");
    eq(a.status, 400);
    const b = await post(PORT, "/api/provenance", { ids: "S022" });
    eq(b.json().ok, false, "ids must be an array");
    const c = await req(PORT, "/api/state", { method: "POST", body: {} });
    eq(c.status, 404, "POST to a GET-only route");
    const d = await req(PORT, "/api/nope");
    eq(d.status, 404); eq(d.json().error, "NO_ROUTE");
  });

  for (const [name, fn] of cases) test(name, fn);
}

/* ================================================================== */
/* 6. SPAWN TEST: fresh boot is clean and silent about the flag        */
/* ================================================================== */
function spawnTests() {
  test("fresh spawn: boots, serves, and never prints the flag", async () => {
    const port = 19700 + Math.floor(Math.random() * 300);
    const child = spawn(process.execPath, [path.join(ROOT, "backend", "server.js")], {
      cwd: ROOT,
      env: Object.assign({}, process.env, { PORT: String(port) }),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let log = "";
    child.stdout.on("data", (d) => { log += d; });
    child.stderr.on("data", (d) => { log += d; });
    try {
      /* async poll so the event loop keeps draining the child's stdout */
      let up = false;
      for (let i = 0; i < 50 && !up; i++) {
        try {
          await req(port, "/healthz");
          up = true;
        } catch (e) {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      await new Promise((r) => setTimeout(r, 150));   /* let the banner flush */
      ok(up, "server came up");
      ok(log.indexOf("NODE 07") >= 0, "boot banner");
      ok(log.indexOf("RZ{") < 0, "flag leaked to stdout: " + log.match(/RZ\{[^)]*/));
      ok(log.indexOf(solution.material) < 0, "material leaked to stdout");
      ok(log.indexOf("provenance 9 / chronology 7 / correlation 10") >= 0, "extract counts reported");
    } finally {
      child.kill();
    }
  });

  test("organizer tool prints the flag only on demand", () => {
    const out = execFileSync(process.execPath, [path.join(ROOT, "tools", "flag.js")], { cwd: ROOT, encoding: "utf8" });
    ok(out.indexOf(derivedFlag) >= 0, "npm run flag prints the expected flag");
    ok(out.indexOf(solution.material) >= 0, "prints the material");
  });
}

/* ================================================================== */
/* 7. EXTERNAL BASELINES (optional: only checked when present)         */
/* ================================================================== */
test("workspace originals and neighbouring CTFs untouched (when present)", () => {
  const BASELINES = {
    "PARENT_FINAL .csv": PARENT_SHA,
    "CHILD_FINAL .csv": CHILD_SHA,
    "last_dataset_ctf3.html": "cda41962c092e991361ad5c386fc7db3eadf717f3aeb1a2a7dfcc37f6483cba7",
    "GHOST_SIGNAL_V3.html": "b344ed2fabd8537bcfef1bed0b9032dd7c3fe1415ee8e5a86b1da938682c6e10",
    "red-zone-ctf1/red-zone-ctf1/data/PARENT_FINAL.csv": PARENT_SHA,
    "red-zone-ctf1/red-zone-ctf1/package.json": "1cf119aeaf1dbd343412c1eb108ce0251554b6a184e4a44e6d696239db70e750",
    "Red Zone CTF 2/data/PARENT_FINAL.csv": PARENT_SHA,
    "Red Zone CTF 2/data/CHILD_FINAL.csv": CHILD_SHA,
    "Red Zone CTF 2/package.json": "0da0551220016b50edae75c885c8eeac39661d6a2c1c01d61777e6a064cc3292"
  };
  let checked = 0, skipped = 0;
  const rel2abs = (rel) => path.join(ROOT, "..", rel);
  Object.keys(BASELINES).forEach((rel) => {
    const p = rel2abs(rel);
    if (!fs.existsSync(p)) { skipped++; return; }   /* absent external file: not a dependency */
    eq(sha(fs.readFileSync(p)), BASELINES[rel], "CHANGED: " + rel);
    checked++;
  });
  const anyPresent = Object.keys(BASELINES).some((rel) => fs.existsSync(rel2abs(rel)));
  if (anyPresent) {
    /* in the original workspace: the neighbours must be there to verify */
    ok(checked >= 4, "expected the neighbouring files to be present for verification (checked " + checked + ", skipped " + skipped + ")");
  } else {
    /* isolated deployment copy: nothing external to compare — by design */
    ok(checked === 0 && skipped === Object.keys(BASELINES).length, "isolated copy must skip every external baseline");
  }
});

test("own datasets unchanged after the whole suite", () => {
  eq(sha(fs.readFileSync(path.join(ROOT, "data", "PARENT_FINAL.csv"))), PARENT_SHA);
  eq(sha(fs.readFileSync(path.join(ROOT, "data", "CHILD_FINAL.csv"))), CHILD_SHA);
});

/* ================================================================== */
/* 7b. FRONTEND RENDER SMOKE — micro-DOM + real store data             */
/*     (exercises the interactive paths a static dump cannot click)    */
/* ================================================================== */
async function frontendRenderTests() {
  /* ---- minimal DOM stub: innerHTML setters capture the built markup ---- */
  const els = new Map();
  const makeEl = (tag) => ({
    tagName: String(tag || "div"),
    _html: "", textContent: "", className: "", hidden: false,
    value: "", disabled: false, dataset: {}, style: {}, childNodes: [],
    set innerHTML(v) { this._html = String(v); },
    get innerHTML() { return this._html; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {},
    appendChild(c) { this.childNodes.push(c); return c; },
    removeChild() {}, remove() {},
    querySelector(sel) {
      if (!this._q) this._q = new Map();
      if (!this._q.has(sel)) this._q.set(sel, makeEl("div"));
      return this._q.get(sel);
    },
    querySelectorAll() { return []; },
    closest() { return null; },
    scrollIntoView() {}, focus() {},
    setAttribute() {}, getAttribute() { return null; },
    get firstChild() { return this.childNodes[0] || null; }
  });

  global.window = global;
  global.document = {
    readyState: "loading",
    addEventListener() {}, removeEventListener() {},
    getElementById(id) { if (!els.has(id)) els.set(id, makeEl("div")); return els.get(id); },
    createElement(t) { return makeEl(t); },
    querySelector(sel) { return this.getElementById("__q__" + sel); },
    querySelectorAll() { return []; },
    body: makeEl("body")
  };
  global.location = { hash: "", search: "" };
  global.history = { replaceState() {} };
  global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

  /* ---- fetch stub serving REAL store data (same shapes as the server) ---- */
  global.fetch = async (u) => {
    const s = String(u);
    const j = (obj) => ({ status: 200, json: async () => obj, text: async () => JSON.stringify(obj) });
    let m;
    if ((m = s.match(/^\/api\/record\/([Ss]\d{3})\/(relations|trace)/))) {
      const id = m[1].toUpperCase();
      if (m[2] === "relations") {
        const links = store.relations(id).map((lid) => {
          const d = store.derived.get(lid);
          return d ? { id: lid, status: d.status, altered: d.altered, alterationType: d.alterationType,
            auth: d.auth, signature: d.signature, sector: d.sectorParent } : { id: lid, missing: true };
        });
        return j({ id, degree: links.length, links });
      }
      return j({ id, chain: store.trace(id) });
    }
    if ((m = s.match(/^\/api\/record\/([Ss]\d{3})$/))) {
      const rec = store.record(m[1]);
      return j(rec ? { id: rec.parent.Sanctuary_ID, parent: rec.parent, child: rec.child,
        derived: rec.derived, scoreColumns: store.scoreCols } : { error: "NO_RECORD" });
    }
    if ((m = s.match(/^\/api\/dataset\/(parent|child)/))) {
      const p = new URL(s, "http://local");
      return j(store.query({
        which: m[1], q: p.searchParams.get("q") || "", page: p.searchParams.get("page"),
        limit: p.searchParams.get("limit"), sort: p.searchParams.get("sort"),
        dir: p.searchParams.get("dir"), filter: p.searchParams.get("filter")
      }));
    }
    if (s.startsWith("/api/timeline")) {
      const events = store.parentRows.map((r) => ({
        id: r.Sanctuary_ID, transfer: r.Transfer_Date,
        audit: r.Access_Log_Timestamp, type: r.Reason_For_Transfer
      })).sort((a, b) => a.transfer.localeCompare(b.transfer));
      return j({ count: events.length, windowDays: puzzle.RULES.AUDIT_WINDOW_DAYS, events });
    }
    if (s.startsWith("/api/ledger")) {
      return j({ count: store.parentRows.length, rows: store.parentRows.map((r) => {
        const d = store.derived.get(r.Sanctuary_ID);
        return { id: r.Sanctuary_ID, altered: d.altered, alterationType: d.alterationType,
          blanks: d.childBlanks, blankCols: d.childBlankCols, sectorMismatch: d.sectorMismatch,
          status: d.status, auth: d.auth, gap: Number(d.gapDays.toFixed(4)) };
      }) });
    }
    return j({});
  };

  /* ---- load the real frontend modules against the stub ---- */
  ["explorer", "inspector", "graph", "timeline", "app"].forEach((f) =>
    require(path.join(ROOT, "js", f + ".js")));

  test("inspector drawer builds from real record data (breach / boundary / clean)", async () => {
    await Inspector.open("S001");                       /* gap 7.875 -> breach  */
    let h = Inspector.root.querySelector("#ih-body").innerHTML;
    ok(h.length > 1500, "drawer populated");
    ok(h.includes("PARENT METADATA"), "parent section");
    ok(h.includes("CHILD PROFILE"), "child section");
    ok(h.includes("⚠ ANOMALOUS"), "breach flagged on the MODIFIED row");
    ok(h.includes("PAST THE STATUTORY WINDOW"), "breach explained");

    await Inspector.open("S061");                       /* gap exactly 7.5000   */
    h = Inspector.root.querySelector("#ih-body").innerHTML;
    ok(h.includes("✔"), "at-limit record is NOT flagged as anomalous");

    await Inspector.open("S088");                       /* auth 0.494 + 2 blanks */
    h = Inspector.root.querySelector("#ih-body").innerHTML;
    ok(h.includes("0.494"), "authenticity rendered");
    ok(h.includes("⚠ UNSEALED"), "seal verdict");
    ok(h.includes("ERASURE PATTERN"), "child erasure verdict");
    ok(h.includes("LEADERSHIP_SCORE"), "blank columns named");
  });

  test("every metadata field analysis sheet builds with a verdict", async () => {
    await Inspector.open("S001");
    const fields = ["Sanctuary_ID", "Original_Name", "Transfer_Date", "Access_Log_Timestamp",
      "Vault_Case_ID", "Transfer_Manifest_ID", "Medical_Tag_ID", "Identity_Record_Status",
      "Previous_Identifier", "Record_Authenticity_Score", "Signature_Valid_Flag",
      "PRALAYA_Alteration_Type", "Identity_Recovery_Level", "Sector_Exposure",
      "blanks", "Original_Occupation_Category"];
    for (const f of fields) {
      Inspector.fieldSheet(f);
      const html = document.getElementById("modal-body").innerHTML;
      ok(html.length > 400, f + " sheet too small (" + html.length + ")");
      ok(/class="verdict/.test(html), f + " sheet missing a verdict");
      ok(html.indexOf(derivedFlag) < 0, f + " sheet leaks the flag");
    }
    /* the exact wording the spec's example demands */
    Inspector.fieldSheet("Access_Log_Timestamp");
    let html = document.getElementById("modal-body").innerHTML;
    ok(html.includes("TIMESTAMP ANALYSIS"), "spec's TIMESTAMP ANALYSIS sheet");
    ok(html.includes("2024-09-13 00:00:00") && html.includes("2024-09-20 21:00:00"),
      "created / modified values shown");
    ok(html.includes("⚠ ANOMALOUS"), "ANOMALY DETECTED equivalent");
    Inspector.fieldSheet("Record_Authenticity_Score");
    html = document.getElementById("modal-body").innerHTML;
    ok(html.includes("SEAL ANALYSIS") && html.includes("0.500"), "archival floor shown");
  });

  test("boundary records get the AT THE LIMIT sheet, not ANOMALOUS", async () => {
    for (const id of ["S061", "S092", "S118"]) {
      await Inspector.open(id);
      Inspector.fieldSheet("Access_Log_Timestamp");
      const html = document.getElementById("modal-body").innerHTML;
      ok(html.includes("AT THE LIMIT"), id + " must read as at-limit");
      ok(html.includes("is not breach"), id + " boundary note");
      ok(!html.includes("⚠ ANOMALOUS"), id + " must not be called anomalous");
    }
  });

  test("parent <-> child comparison sheet builds with blank highlighting", async () => {
    await Inspector.open("S088");
    Inspector.compare();
    const html = document.getElementById("modal-body").innerHTML;
    ok(html.includes("PARENT ↔ CHILD COMPARISON"), "comparison heading");
    ok(html.includes("— blank —"), "blank cells rendered as blank");
    ok(html.includes("ERASURE PATTERN"), "both-conditions finding");
    ok(html.includes("Research"), "sector cross-check data");
    /* a record with 1 blank only: no erasure finding */
    await Inspector.open("S013");
    Inspector.compare();
    const html2 = document.getElementById("modal-body").innerHTML;
    ok(html2.includes("NO ERASURE FINDING"), "near-miss must not be called erasure");
  });

  test("provenance trace sheet builds the real custody chain", async () => {
    await Inspector.open("S017");
    await Inspector.trace();
    const html = document.getElementById("modal-body").innerHTML;
    ok(html.includes("PROVENANCE TRACE"), "trace heading");
    ok(html.includes("VC-1016") && html.includes("TM-2016") && html.includes("MT-3016"),
      "real chain identifiers for S017");
    ok(html.includes("LINKED RECORDS"), "relationship section");
    ok(html.includes("CHAIN OF CUSTODY") || html.includes("custody"), "chain note");
  });

  test("provenance graph renders the 5-node chain for a record", async () => {
    const mount = document.getElementById("graph-test");
    await ProvGraph.render(mount, "S088");
    const svg = mount.querySelector("#prov-svg-check");
    void svg;
    const html = mount.innerHTML;
    ok(html.includes("PROVENANCE GRAPH · S088"), "graph heading");
    ok(html.includes("VAULT CASE") && html.includes("CHILD PROFILE"), "node labels");
    ok(html.includes("VC-1087"), "real vault case for S088");
    ok(html.includes("TRAIL SUSPECT"), "suspect verdict for an unsealed record");
    ok((html.match(/class="node/g) || []).length >= 5, "five nodes rendered");
  });

  test("chronology builds lanes, ledger and 120 measured events", async () => {
    const mount = document.getElementById("chron-test");
    await Chronology.render(mount);
    eq(Chronology.events.length, 120, "events measured");
    eq(Chronology.events.filter((e) => e.breach).length, 7, "client-side breach count");
    eq(Chronology.events.filter((e) => e.atLimit).length, 3, "client-side at-limit count");
    ok(mount.innerHTML.includes("LAG LEDGER"), "ledger panel");
    ok(document.getElementById("tl-svg").innerHTML.includes("AUDIT"), "audit lane drawn");
    const ledger = document.getElementById("ch-tbody").innerHTML;
    ok(ledger.includes("BREACH") && ledger.includes("AT LIMIT") && ledger.includes("WITHIN"),
      "verdict badges present");
    ok(ledger.split("data-an=").length - 1 >= 120, "every event rowed");

    Chronology.sheet(Chronology.events.find((e) => e.id === "S001"));
    let html = document.getElementById("modal-body").innerHTML;
    ok(html.includes("⚠ ANOMALOUS") && html.includes("7d 21h"), "breach sheet: " + html.includes("7d 21h"));
    Chronology.sheet(Chronology.events.find((e) => e.id === "S061"));
    html = document.getElementById("modal-body").innerHTML;
    ok(html.includes("AT THE LIMIT") && html.includes("7d 12h"), "boundary sheet shows 7d 12h");
  });

  test("dataset explorer renders, sorts, paginates and selects", async () => {
    const ex = new Explorer({
      dataset: "parent", limit: 15, selectable: true,
      filters: [{ key: "", label: "ALL" }, { key: "locked", label: "LOCKED" }],
      fileLabel: "FILE", onFile() {}, onInspect() {}
    });
    await ex.load();
    eq(ex.rows.length, 15, "page size");
    eq(ex.total, 120, "total");
    const head = ex.el.querySelector("#ex-thead").innerHTML;
    ok(head.includes("Sanctuary_ID") && head.includes("Record Authenticity Score"), "header columns");
    const body = ex.el.querySelector("#ex-tbody").innerHTML;
    ok(body.includes("S001"), "rows rendered");
    eq(ex.selected().length, 0, "starts unselected");
    ex.toggle("S001"); ex.toggle("S002");
    eq(ex.selected().join(","), "S001,S002", "selection accumulates");
    ex.clear();
    eq(ex.selected().length, 0, "clear empties selection");

    const childEx = new Explorer({ dataset: "child", limit: 10 });
    await childEx.load();
    eq(childEx.rows.length, 10, "child page");
    ok(childEx.el.querySelector("#ex-tbody").innerHTML.includes("S001"), "child rows");
  });

  test("correlation ledger builds the joined view", async () => {
    App.ledger = (await J("/api/ledger")).rows;
    App.pickedCorr = new Set(["S088"]);
    App.corrFilter = "both";
    App.corrSearch = "";
    App.renderCorrLedger();
    const tb = document.getElementById("co-tbody").innerHTML;
    ok(tb.includes("S088") && tb.includes("COMPARE"), "rows with compare action");
    ok(tb.split("data-pick=").length - 1 >= 10, "at least the erasure set rows visible");
    ok(tb.includes("record_split") || tb.includes("identifier_changed"), "parent alteration shown");
    App.corrFilter = "blank2";
    App.renderCorrLedger();
    const tb2 = document.getElementById("co-tbody").innerHTML;
    ok(tb2.split("data-pick=").length - 1 <= 60, "pagination bound respected");
  });

  test("recovery reveal + cinematic build the final screen", async () => {
    await App.showReveal(null, true);
    const slot = document.getElementById("reveal-slot").innerHTML;
    ok(slot.includes("CHILD DATASET RECOVERED"), "reveal heading");
    ok(slot.includes("FLAG ACCEPTED"), "acceptance bar");
    ok(slot.includes("OPEN CHILD DATASET") && slot.includes("DOWNLOAD DATASET"), "both actions");
    ok(slot.includes('href="/api/download/child"'), "download points at the gated route");

    const term = document.getElementById("term");
    await App.cinematic({ lines: ["> VERIFYING METADATA ........ OK", "> RECOVERY COMPLETE"] });
    ok(term.textContent.includes("RECOVERY COMPLETE"), "cinematic writes the terminal");
    ok(term.innerHTML.includes("CHILD-17 RELEASED"), "closing banner");
  });
}

/* ================================================================== */
/* runner                                                              */
/* ================================================================== */
(async function main() {
  console.log("RED ZONE CTF 3 — METADATA FORENSICS · test suite\n");

  await serverTests();
  spawnTests();
  await frontendRenderTests();

  let pass = 0, fail = 0;
  for (const t of results) {
    try {
      await t.fn();
      pass++;
      console.log("  PASS  " + t.name);
    } catch (e) {
      fail++;
      console.log("  FAIL  " + t.name);
      console.log("        " + (e && e.message ? e.message : e));
    }
  }

  if (serverProc) { try { serverProc.close(); } catch (e) { /* ignore */ } }

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("SUITE ERROR", e);
  if (serverProc) { try { serverProc.close(); } catch (_) {} }
  process.exit(1);
});
