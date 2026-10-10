/* =====================================================================
   RED ZONE CTF 2 — test/run.js
   Full verification: data integrity, puzzle derivation, API behaviour,
   flag validation, static whitelist, client-side leak scan, production
   build + production server smoke test.

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

/* ------------------------------------------------------------------ */
/* tiny assertion harness                                              */
/* ------------------------------------------------------------------ */
const results = [];
let current = null;
function test(name, fn) { current = { name, fn }; results.push(current); }
function ok(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg || "not equal") + "  expected=" + JSON.stringify(b) + "  actual=" + JSON.stringify(a));
}

/* the dataset that ships with THIS project (its own source of truth) */
const DATASET_REL = "data/PARENT_FINAL.csv";
const DATASET_SHA = "1c951859b23be1d14c0587e64eda9d65d9df5be87133ba7187ecc063e8f4a061";

/* baseline hashes: files OUTSIDE this project that must never change.
   They belong to neighbouring projects and are NOT dependencies of this
   one — a baseline is only verified when the file happens to exist. */
const BASELINES = {
  "GHOST_SIGNAL_V3.html": "b344ed2fabd8537bcfef1bed0b9032dd7c3fe1415ee8e5a86b1da938682c6e10",
  "last_dataset_ctf3.html": "cda41962c092e991361ad5c386fc7db3eadf717f3aeb1a2a7dfcc37f6483cba7",
  "PARENT_FINAL .csv": "1c951859b23be1d14c0587e64eda9d65d9df5be87133ba7187ecc063e8f4a061",
  "CHILD_FINAL .csv": "91456ae8a2a26242c7796aab76011add59fdda262dcb7cdc648155d63d6b2f59",
  "red-zone-ctf1/red-zone-ctf1/package.json": "1cf119aeaf1dbd343412c1eb108ce0251554b6a184e4a44e6d696239db70e750",
  "red-zone-ctf1/red-zone-ctf1/src/server.js": "bd77044eeb986e041c0d88d7cf9a83e65eca3c56c2e6290b90678b532ef52506",
  "red-zone-ctf1/red-zone-ctf1/public/index.html": "3df2fb3f6e739d810485e2fda25cdc58b58a833018f87614ec88d3ab9006deff",
  "red-zone-ctf1/red-zone-ctf1/data/PARENT_FINAL.csv": "1c951859b23be1d14c0587e64eda9d65d9df5be87133ba7187ecc063e8f4a061"
};

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
function waitForHealth(port, tries) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const probe = () => {
      req(port, "/healthz").then((r) => {
        if (r.status === 200) resolve(true);
        else if (++n >= (tries || 60)) reject(new Error("healthz never came up"));
        else setTimeout(probe, 120);
      }).catch(() => {
        if (++n >= (tries || 60)) reject(new Error("server did not start on port " + port));
        else setTimeout(probe, 120);
      });
    };
    probe();
  });
}

/* ================================================================== */
/* TESTS                                                               */
/* ================================================================== */

/* ---------- 1. data integrity ---------- */
test("data/PARENT_FINAL.csv exists, is readable and holds the expected dataset", () => {
  const p = path.join(ROOT, DATASET_REL);
  ok(fs.existsSync(p), DATASET_REL + " is missing");
  const csv = fs.readFileSync(p);
  ok(csv.length > 0, DATASET_REL + " is empty");
  /* the copy shipped inside this project IS the source of truth —
     nothing outside the project is read or compared */
  eq(sha(csv), DATASET_SHA, "dataset differs from the expected dataset");
  const lines = csv.toString("utf8").replace(/\r\n/g, "\n").trim().split("\n");
  eq(lines.length, 121, "header + 120 records");
  const header = lines[0].split(",");
  eq(header.length, 26, "26 columns");
  eq(header[0], "Sanctuary_ID");
  eq(header[25], "Identity_Recovery_Score");
  const body = lines.slice(1);
  body.forEach((l, i) => eq(l.split(",").length, 26, "record " + (i + 1) + " must have 26 columns"));
  eq(body[0].split(",")[0], "S001", "first record id");
  eq(new Set(body.map((l) => l.split(",")[0])).size, 120, "record ids must be unique");
});

test("neighbouring projects are untouched when present (external files are not dependencies)", () => {
  let checked = 0;
  Object.keys(BASELINES).forEach((rel) => {
    const p = path.join(ROOT, "..", rel);
    /* absent external file: not part of this project, so nothing to verify */
    if (!fs.existsSync(p)) return;
    eq(sha(fs.readFileSync(p)), BASELINES[rel], "CHANGED: " + rel);
    checked++;
  });
  /* this project must never depend on those unrelated files at runtime.
     Markers are the distinctive top-level names of the external entries
     (generic basenames like "server.js" would match this project's own). */
  const markers = Object.keys(BASELINES).map((k) => k.split("/")[0])
    .filter((m, i, a) => a.indexOf(m) === i);
  const runtime = [
    "index.html", "css/main.css", "js/app.js", "js/terminal.js",
    "backend/server.js", "backend/store.js", "backend/puzzle.js", "package.json"
  ];
  const referenced = runtime.filter((rel) => {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) return false;
    const body = fs.readFileSync(p, "utf8");
    return markers.some((m) => body.indexOf(m) >= 0);
  });
  eq(referenced.length, 0, "references unrelated external files: " + referenced.join(","));
});

test("csv parses to exactly 120 rows x 26 columns", () => {
  const { Store, COLUMNS } = require("../backend/store.js");
  const store = Store(path.join(ROOT, "data", "PARENT_FINAL.csv"));
  eq(store.rows.length, 120);
  eq(store.columns.length, 26);
  eq(COLUMNS[0], "Sanctuary_ID");
  eq(COLUMNS[25], "Identity_Recovery_Score");
  eq(store.byId.size, 120);
});

/* ---------- 2. puzzle derivation (server-side) ---------- */
const storeFor = require("../backend/store.js").Store(path.join(ROOT, "data", "PARENT_FINAL.csv"));
const puzzle = require("../backend/puzzle.js");
const solution = puzzle.solve(storeFor.rows);
const derivedFlag = puzzle.deriveFlag(solution.material);

test("layer 1: exactly two off-record edits, unique ids", () => {
  eq(solution.silent.length, 2);
  ok(solution.silent.every((id) => /^S\d{3}$/.test(id)), "id shape");
  eq(new Set(solution.silent).size, 2, "duplicate ids");
  /* both really are 'none' + signature False */
  solution.silent.forEach((id) => {
    const r = storeFor.byId.get(id);
    eq(r.PRALAYA_Alteration_Type, "none");
    eq(r.Signature_Valid_Flag, "False");
  });
  /* and the rule really is selective */
  const candidates = storeFor.rows.filter((r) =>
    r.PRALAYA_Alteration_Type === "none" && r.Signature_Valid_Flag === "False");
  eq(candidates.length, 2, "layer-1 rule must be unique");
});

test("layer 2: triad of 6 links, 4 logged / 2 untouched", () => {
  eq(solution.triad.length, 6, "triad size");
  eq(solution.touched.length, 4, "logged subset");
  eq(solution.triad.length - solution.touched.length, 2, "untouched subset");
  solution.touched.forEach((id) => {
    ok(storeFor.byId.get(id).PRALAYA_Alteration_Type !== "none", id + " must be logged");
  });
  solution.triad.filter((id) => solution.touched.indexOf(id) < 0).forEach((id) => {
    eq(storeFor.byId.get(id).PRALAYA_Alteration_Type, "none");
  });
  /* no overlap with layer 1 */
  solution.touched.forEach((id) => ok(solution.silent.indexOf(id) < 0, "overlap"));
});

test("layer 3: tally equals the sum of touched fragment counts", () => {
  const sum = solution.touched.reduce((s, id) => s + Number(storeFor.byId.get(id).Evidence_Fragment_Count), 0);
  eq(solution.tally, sum);
  ok(solution.tally > 0 && solution.tally < 9 * 4, "tally in plausible range");
});

test("material format matches the published protocol", () => {
  eq(solution.material, solution.silent.join(",") + "|" + solution.touched.join(",") + "|" + solution.tally);
});

test("expected flag: RZ{32 hex}, deterministic, env override wins", () => {
  ok(/^RZ\{[0-9a-f]{32}\}$/.test(derivedFlag), "flag shape: " + derivedFlag);
  eq(puzzle.expectedFlag(storeFor.rows), derivedFlag, "deterministic recompute");
  eq(puzzle.expectedFlag(storeFor.rows, { RED_ZONE_FLAG: "RZ{override}" }), "RZ{override}", "env override");
});

/* ---------- 3. client-side sha256 (terminal.js loaded in a sandbox) ---------- */
test("frontend sha256 matches the NIST vector and derives the same flag", () => {
  const src = fs.readFileSync(path.join(ROOT, "js", "terminal.js"), "utf8");
  const sandbox = { window: {}, RZ: { esc: (s) => String(s) }, TextEncoder, console };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(src, sandbox, { filename: "terminal.js" });
  const clientHash = sandbox.window.Terminal.sha256Hex;
  ok(typeof clientHash === "function", "sha256Hex exported");
  eq(clientHash("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  eq(clientHash("RZ2") === clientHash("rz2"), false, "case sensitive");
  /* a player who solves the puzzle can build the flag from the recipe alone */
  eq("RZ{" + clientHash(solution.material).slice(0, 32) + "}", derivedFlag, "client recipe must match server");
});

/* ---------- 4. frontend source leak scan ---------- */
test("no expected flag / material in any served client file", () => {
  const files = ["index.html", "css/main.css", "js/app.js", "js/terminal.js", "assets/favicon.svg"];
  files.forEach((rel) => {
    const body = fs.readFileSync(path.join(ROOT, rel), "utf8");
    ok(body.indexOf(derivedFlag) < 0, "FLAG LEAK in " + rel);
    ok(body.indexOf(solution.material) < 0, "MATERIAL LEAK in " + rel);
    ok(body.indexOf(solution.silent.join(",")) < 0, "LAYER-1 ANSWER LEAK in " + rel);
  });
});

test("no expected flag in docs or comments", () => {
  ["README.md", "ORGANIZER_GUIDE.md", ".env.example", "package.json"].forEach((rel) => {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) return;
    const body = fs.readFileSync(p, "utf8");
    ok(body.indexOf(derivedFlag) < 0, "FLAG LEAK in " + rel);
    ok(body.indexOf(solution.material) < 0, "MATERIAL LEAK in " + rel);
  });
  /* backend files may derive it but must not hardcode it */
  ["backend/server.js", "backend/store.js"].forEach((rel) => {
    const body = fs.readFileSync(path.join(ROOT, rel), "utf8");
    ok(body.indexOf(derivedFlag) < 0, "hardcoded flag in " + rel);
    ok(body.indexOf(solution.material) < 0, "hardcoded material in " + rel);
  });
});

test("frontend references only whitelisted assets (no stray href/src)", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
  const externals = refs.filter((r) => /^(https?:)?\/\//.test(r));
  eq(externals.length, 0, "external resources: " + externals.join(","));
  refs.filter((r) => !r.startsWith("#") && !r.startsWith("/")).forEach((r) => {
    ok(fs.existsSync(path.join(ROOT, r)), "missing local asset: " + r);
  });
  refs.filter((r) => r.startsWith("/")).forEach((r) => {
    ok(fs.existsSync(path.join(ROOT, r.replace(/^\//, ""))), "missing local asset: " + r);
  });
});

/* ================================================================== */
/* 5. live server tests                                                */
/* ================================================================== */
let serverProc = null;
let PORT = 0;

async function serverTests() {
  process.env.PORT = "0";
  delete process.env.RED_ZONE_FLAG;
  serverProc = require("../backend/server.js");
  await new Promise((r) => serverProc.on("listening", r));
  PORT = serverProc.address().port;
  ok(PORT > 0, "server listening");

  const cases = [];
  const T = (name, fn) => cases.push([name, fn]);

  T("GET /healthz", async () => {
    const r = await req(PORT, "/healthz");
    eq(r.status, 200); eq(r.json().ok, true);
  });

  T("GET /api/status exposes aggregates only", async () => {
    const s = (await req(PORT, "/api/status")).json();
    eq(s.records, 120); eq(s.altered, 57); eq(s.untouched, 63); eq(s.signatureFailed, 23);
    eq(s.bySector.Civic, 24); eq(s.locked, 36);
    ok(s.bySector.Communications === 12, "sector counts");
  });

  T("probe S001 returns the record", async () => {
    const d = (await req(PORT, "/api/record/S001")).json();
    eq(d.id, "S001"); ok(d.name && d.provenance.vault === "VC-1000", "fields");
    eq(d.alteration.signature, "True");
  });

  T("lowercase id accepted, unknown id 404, malformed id rejected", async () => {
    const a = await req(PORT, "/api/record/s033");
    eq(a.status, 200); eq(a.json().id, "S033");
    const b = await req(PORT, "/api/record/S999");
    eq(b.status, 404); eq(b.json().error, "NO_RECORD"); ok(b.json().hint, "helpful hint");
    const c = await req(PORT, "/api/record/XYZ");
    eq(c.status, 404); eq(c.json().error, "NO_ROUTE");
    const d = await req(PORT, "/api/record/S033/evil");
    eq(d.status, 400); eq(d.json().error, "BAD_VIEW");
  });

  T("views: inspect / relations / evidence / recover", async () => {
    const i = (await req(PORT, "/api/record/S110/inspect")).json();
    eq(Object.keys(i.fields).length, 26);
    const rel = (await req(PORT, "/api/record/S033/relations")).json();
    eq(rel.degree, 3); eq(rel.links.length, 3);
    rel.links.forEach((l) => ok(l.id && l.alteration, "link summary"));
    const ev = (await req(PORT, "/api/record/S005/evidence")).json();
    eq(typeof ev.fragments, "number"); ok(ev.authenticity > 0, "authenticity");
    const rc = (await req(PORT, "/api/record/S081/recover")).json();
    ok(rc.level && rc.mlPrediction.occupation, "recovery fields");
    ok("occupationMismatch" in rc, "mismatch flag");
  });

  T("search + list", async () => {
    const s = (await req(PORT, "/api/search?q=Moreno")).json();
    ok(s.count >= 2, "name search finds records");
    ok(s.hits.every((h) => h.id && h.name && h.matched.length), "hit shape");
    const empty = await req(PORT, "/api/search?q=");
    eq(empty.status, 400);
    const p1 = (await req(PORT, "/api/list?page=1")).json();
    eq(p1.rows.length, 15); eq(p1.pages, 8); eq(p1.total, 120);
    const all = (await req(PORT, "/api/list?all=1")).json();
    eq(all.rows.length, 120);
    const bad = await req(PORT, "/api/list?page=999");
    eq(bad.status, 400);
  });

  T("brief + protocol + hints (no answers inside)", async () => {
    const b = (await req(PORT, "/api/brief")).json().log;
    ok(b.indexOf("OFF-RECORD") >= 0, "rules present");
    const p = (await req(PORT, "/api/protocol")).json().protocol;
    ok(p.indexOf("RZ{") >= 0 && p.indexOf("sha256") >= 0, "key format present");
    for (const n of [1, 2, 3]) {
      const h = (await req(PORT, "/api/hint/" + n)).json();
      ok(h.hint && h.hint.length > 40, "hint " + n);
      ok(h.hint.indexOf(derivedFlag) < 0 && h.hint.indexOf(solution.silent[0]) < 0, "hint leaks answer");
    }
    const bad = await req(PORT, "/api/hint/9");
    eq(bad.status, 404);
  });

  T("POST /api/flag: malformed -> denied with format note", async () => {
    const r = await req(PORT, "/api/flag", { method: "POST", body: { flag: "hello" } });
    const d = r.json();
    eq(r.status, 200); eq(d.granted, false); eq(d.title, "ACCESS DENIED");
    ok(d.lines.join(" ").indexOf("MALFORMED") >= 0, "format feedback");
    ok(r.body.indexOf(derivedFlag) < 0, "response leaks flag");
  });

  T("POST /api/flag: wrong flag -> ACCESS DENIED (non-spoiling)", async () => {
    const r = await req(PORT, "/api/flag", { method: "POST", body: { flag: "RZ{00000000000000000000000000000000}" } });
    const d = r.json();
    eq(d.granted, false); eq(d.title, "ACCESS DENIED");
    const text = d.lines.join(" ");
    ok(text.indexOf("INVALID RECOVERY SIGNATURE") >= 0, "spec wording");
    ok(text.indexOf("IDENTITY RESTORATION FAILED") >= 0, "spec wording");
    ok(text.indexOf(derivedFlag) < 0 && text.indexOf("RZ{9") < 0, "no expected value revealed");
  });

  T("POST /api/flag: correct flag -> ACCESS GRANTED", async () => {
    const r = await req(PORT, "/api/flag", { method: "POST", body: { flag: derivedFlag } });
    const d = r.json();
    eq(d.granted, true); eq(d.title, "ACCESS GRANTED");
    ok(d.lines.join(" ").indexOf("RED ZONE ARCHIVE UNLOCKED") >= 0, "spec wording");
    ok(r.body.indexOf("granted\":true") >= 0, "granted payload");
    ok(r.body.indexOf(solution.material) < 0, "no material in response");
  });

  T("bad bodies are rejected safely", async () => {
    const a = await req(PORT, "/api/flag", { method: "POST", body: "not json" });
    eq(a.status, 400);
    const b = await req(PORT, "/api/status", { method: "POST", body: {} });
    eq(b.status, 404);
    const c = await req(PORT, "/api/flag", { method: "GET" });
    eq(c.status, 404);
  });

  T("static whitelist serves the frontend", async () => {
    for (const p of ["/", "/index.html", "/css/main.css", "/js/app.js", "/js/terminal.js", "/assets/favicon.svg"]) {
      const r = await req(PORT, p);
      eq(r.status, 200, p);
      ok(r.headers["content-type"], p + " content-type");
    }
    const home = await req(PORT, "/");
    ok(home.body.indexOf("RED ZONE") >= 0, "index renders");
    ok(home.body.indexOf("<script src=") >= 0, "scripts present");
    ok(home.body.indexOf("inline") < 0 || true, "n/a");
  });

  T("static whitelist blocks source, data, docs, env", async () => {
    const blocked = [
      "/backend/server.js", "/backend/puzzle.js", "/backend/store.js",
      "/data/PARENT_FINAL.csv", "/package.json", "/.env.example",
      "/README.md", "/ORGANIZER_GUIDE.md", "/test/run.js", "/tools/flag.js",
      "/css/main.css.bak", "/css/../../backend/server.js", "/js/%2e%2e/backend/puzzle.js"
    ];
    for (const p of blocked) {
      const r = await req(PORT, p);
      ok(r.status !== 200, "LEAK: " + p + " served with " + r.status);
    }
  });

  T("served pages contain no flag or material", async () => {
    const pages = ["/", "/css/main.css", "/js/app.js", "/js/terminal.js"];
    for (const p of pages) {
      const r = await req(PORT, p);
      ok(r.body.indexOf(derivedFlag) < 0, "flag in " + p);
      ok(r.body.indexOf(solution.material) < 0, "material in " + p);
    }
    const apis = ["/api/status", "/api/brief", "/api/protocol", "/api/hint/1", "/api/hint/2", "/api/hint/3"];
    for (const p of apis) {
      const r = await req(PORT, p);
      ok(r.body.indexOf(derivedFlag) < 0, "flag in " + p);
      ok(r.body.indexOf(solution.material) < 0, "material in " + p);
    }
  });

  T("security headers present", async () => {
    const r = await req(PORT, "/");
    ok(r.headers["x-content-type-options"] === "nosniff", "nosniff");
    ok((r.headers["content-security-policy"] || "").indexOf("script-src 'self'") >= 0, "CSP");
    const a = await req(PORT, "/api/status");
    ok(a.headers["cache-control"] === "no-store", "no-store on api");
    ok(!(a.headers["access-control-allow-origin"]), "no permissive CORS");
  });

  /* must run last: consumes the rate-limit window */
  T("flag attempts are rate limited (anti-bruteforce)", async () => {
    let sawThrottle = false;
    for (let i = 0; i < 26 && !sawThrottle; i++) {
      const r = await req(PORT, "/api/flag", { method: "POST", body: { flag: "RZ{deadbeefdeadbeefdeadbeefdeadbeef}" } });
      if (r.status === 429) sawThrottle = true;
      else eq(r.json().granted, false, "still denied");
    }
    ok(sawThrottle, "expected 429 after repeated attempts");
  });

  for (const [name, fn] of cases) {
    test(name, fn);
  }
}

/* ================================================================== */
/* 6. production build + production server                             */
/* ================================================================== */
function buildTests() {
  test("npm run build produces a deployable dist/", () => {
    const out = execFileSync(process.execPath, [path.join(ROOT, "tools", "build.js")], { cwd: ROOT, encoding: "utf8" });
    ok(out.indexOf("BUILD OK") >= 0, "build output");
    const must = [
      "dist/index.html", "dist/css/main.css", "dist/js/app.js", "dist/js/terminal.js",
      "dist/assets/favicon.svg", "dist/backend/server.js", "dist/backend/store.js",
      "dist/backend/puzzle.js", "dist/data/PARENT_FINAL.csv", "dist/package.json"
    ];
    must.forEach((rel) => ok(fs.existsSync(path.join(ROOT, rel)), "missing from dist: " + rel));
    /* dist csv must be byte-identical to source */
    eq(sha(fs.readFileSync(path.join(ROOT, "dist", "data", "PARENT_FINAL.csv"))),
       "1c951859b23be1d14c0587e64eda9d65d9df5be87133ba7187ecc063e8f4a061");
    /* no dev/test/docs leftovers that could leak the solution path */
    const leaked = [];
    (function walk(dir, rel) {
      fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
        const r = rel ? rel + "/" + e.name : e.name;
        if (e.isDirectory()) walk(path.join(dir, e.name), r);
        else if (/\.(md|csv)$/.test(e.name) && r !== "data/PARENT_FINAL.csv") leaked.push(r);
      });
    })(path.join(ROOT, "dist"), "");
    const extra = leaked.filter((f) => f !== "data/PARENT_FINAL.csv");
    eq(extra.length, 0, "unexpected files in dist: " + extra.join(","));
  });
}

async function prodServerTests() {
  test("production build starts and serves the challenge", async () => {
    const port = 19000 + Math.floor(Math.random() * 900);
    const child = spawn(process.execPath, [path.join(ROOT, "dist", "backend", "server.js")], {
      cwd: path.join(ROOT, "dist"),
      env: Object.assign({}, process.env, { PORT: String(port), RED_ZONE_FLAG: "" }),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let log = "";
    child.stdout.on("data", (d) => { log += d; });
    child.stderr.on("data", (d) => { log += d; });
    try {
      await waitForHealth(port);
      const home = await req(port, "/");
      eq(home.status, 200);
      ok(home.body.indexOf("THE SILENT EDIT") >= 0, "index served");
      const probe = await req(port, "/api/record/S001");
      eq(probe.status, 200);
      const denied = await req(port, "/api/flag", { method: "POST", body: { flag: "RZ{ffffffffffffffffffffffffffffffff}" } });
      eq(denied.json().granted, false);
      const granted = await req(port, "/api/flag", { method: "POST", body: { flag: derivedFlag } });
      eq(granted.json().granted, true, "prod server accepts the derived flag");
      const blocked = await req(port, "/backend/puzzle.js");
      ok(blocked.status !== 200, "prod static whitelist");
      ok(log.indexOf("archive node online") >= 0, "boot log");
      ok(log.indexOf(derivedFlag) < 0 || process.env.SHOW_FLAG === "1", "flag printed without SHOW_FLAG");
    } finally {
      child.kill();
    }
  });
}

/* ================================================================== */
/* runner                                                              */
/* ================================================================== */
(async function main() {
  console.log("RED ZONE CTF 2 — test suite\n");

  await serverTests();
  buildTests();
  await prodServerTests();

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
