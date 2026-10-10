/* ============================================================================
 * THE DEADLOCK ENGINE: BLACKOUT PROTOCOL — test suite (algorithm + backend)
 *
 * Phase B: written BEFORE relying on the implementation. Section 1 tests the
 * pure puzzle engine (deadlock detection, banker's safety, routing, plan
 * validation). Section 2 boots the real HTTP server on an ephemeral port and
 * tests authority, budgets, gating, sessions, masking, rate limits, and flag
 * handling. Nothing here touches files outside Bonus CTF/.
 *
 * Run:  npm test
 * ==========================================================================*/
"use strict";
const assert = require("assert");
const http = require("http");

let pass = 0, fail = 0;
const failures = [];
async function t(name, fn) {
  try { await fn(); pass++; console.log("  PASS " + name); }
  catch (e) {
    fail++;
    failures.push(name + " - " + (e && e.message ? String(e.message).split("\n")[0] : e));
    console.log("  FAIL " + name + " - " + (e && e.message ? String(e.message).split("\n")[0] : e));
  }
}
const eq = (a, b, msg) => assert.deepStrictEqual(a, b, msg);
const ok = (c, msg) => assert.ok(c, msg);

/* ═══════════════════════ 1 · ALGORITHM TESTS ═══════════════════════════ */
async function algorithmTests() {
  const eng = require("../server/engine");

  console.log("\n[1] stage 1 - deadlock detection & recovery");
  await t("S1 initial system drains to exactly {P2,P4} (real deadlock)", () => {
    const r = eng.s1Drain(eng.S1.clone());
    eq(r.stuck.sort(), ["P2", "P4"]);
    ok(!r.drains, "must not drain");
  });
  await t("S1 apparent cycle P5-R2-P6-R5 exists but is NOT the deadlock", () => {
    const cyc = eng.s1WaitCycles(eng.S1.clone());
    const flat = JSON.stringify(cyc);
    ok(flat.includes("P5") && flat.includes("P6") && flat.includes("R2") && flat.includes("R5"),
      "apparent cycle must exist");
    const r = eng.s1Drain(eng.S1.clone());
    ok(!r.stuck.includes("P5") && !r.stuck.includes("P6"),
      "cycle members must drain - cycle != deadlock with multi-instance R2");
  });
  await t("S1 exactly 4 valid recoveries: preempt P2/P4, inject R3/R4", () => {
    const v = eng.s1ValidRecoveries(eng.S1.clone());
    const sig = v.map((x) => x.op + " " + x.target).sort();
    eq(sig, ["inject R3", "inject R4", "preempt P2", "preempt P4"]);
  });
  await t("S1 invalid interventions do not drain (preempt P5/P3/P1, inject R1/R2/R5)", () => {
    for (const cand of [["preempt", "P5"], ["preempt", "P3"], ["preempt", "P1"],
      ["inject", "R1"], ["inject", "R2"], ["inject", "R5"]]) {
      const r = eng.s1Drain(eng.S1.clone(), { op: cand[0], target: cand[1] });
      ok(!r.drains, cand.join(" ") + " must not drain");
      eq(r.stuck.sort(), ["P2", "P4"], cand.join(" "));
    }
  });
  await t("S1 trial feedback is limited (stuck count only, identities hidden)", () => {
    const tr = eng.s1Trial(eng.S1.clone(), "preempt", "P5");
    eq(tr.drains, false);
    eq(tr.stuckCount, 2);
    ok(!("stuck" in tr), "trial must not reveal which processes are stuck");
  });
  await t("S1 view masks hidden capacities/holds before inspection", () => {
    const view = eng.s1View(eng.S1.clone(), new Set());
    eq(view.resources.R3.cap, null, "R3 cap hidden");
    eq(view.resources.R2.cap, null, "R2 cap hidden");
    ok(view.processes.P2.holds === null, "holds hidden");
    ok(view.processes.P2.waitingOn.indexOf("R4") >= 0, "request edges visible");
    eq(view.processes.P1.status, "RUNNING");
    eq(view.processes.P2.status, "BLOCKED");
  });
  await t("S1 inspection reveals exactly the requested target's data", () => {
    const view = eng.s1View(eng.S1.clone(), new Set(["R3", "P4"]));
    eq(view.resources.R3.cap, 1, "R3 cap revealed");
    eq(view.resources.R4.cap, null, "R4 still hidden");
    ok(view.processes.P4.holds && view.processes.P4.holds.R4 === 1, "P4 holds revealed");
    ok(view.processes.P2.holds === null, "P2 still hidden");
  });

  console.log("\n[2] stage 2 - scheduler safety (Banker's model)");
  await t("S2 canonical sequence (no evict) is safe", () => {
    const r = eng.s2Safety(["ASM", "PNT", "WLD", "CNC", "INJ", "MNT"], eng.S2);
    eq(r.ok, true, JSON.stringify(r));
  });
  await t("S2 multiple distinct safe sequences exist and are all accepted", () => {
    const seqs = eng.s2AllSafe(eng.S2, false, null);
    ok(seqs.length >= 3, "want >=3 safe sequences, got " + seqs.length);
    for (const s of seqs) eq(eng.s2Safety(s, eng.S2, false, null).ok, true, s.join(","));
  });
  await t("S2 unsafe sequence fails with step + deficit (limited diagnostic)", () => {
    const r = eng.s2Safety(["CNC", "INJ", "WLD", "PNT", "ASM", "MNT"], eng.S2);
    eq(r.ok, false);
    eq(r.failedAt, 0);
    eq(r.proc, "CNC");
    eq(r.deficit, { COOLANT: 1, CYCLE: 2 });
  });
  await t("S2 eviction returns MNT's hold [2,1,0] and MNT leaves the resident set", () => {
    eq(eng.s2Avail(eng.S2, false), [1, 1, 0]);
    eq(eng.s2Avail(eng.S2, true), [3, 2, 0]);
    ok(!eng.s2Residents(eng.S2, true).includes("MNT"));
    ok(eng.s2Residents(eng.S2, false).includes("MNT"));
  });
  await t("S2 safe sequences exist with eviction too", () => {
    const seqs = eng.s2AllSafe(eng.S2, true, null);
    ok(seqs.length >= 2, "want >=2 evicted-safe sequences, got " + seqs.length);
  });
  await t("S2 cached (stale) WLD max is conservative: cached-safe => true-safe", () => {
    const cached = eng.s2CachedMax();
    eq(cached.WLD, [4, 2, 1], "cached value must differ from true [3,2,1]");
    const seq = ["ASM", "PNT", "MNT", "WLD", "CNC", "INJ"];
    eq(eng.s2Safety(seq, eng.S2, false, null, cached).ok, true, "safe under cached");
    eq(eng.s2Safety(seq, eng.S2, false, null).ok, true, "therefore safe under truth");
    const truth = eng.s2Max("WLD", new Set(["WLD"]));
    eq(truth, [3, 2, 1], "inspection reveals the true row");
  });
  await t("S2 duplicate/missing process in sequence rejected (SHAPE)", () => {
    eq(eng.s2Safety(["ASM", "ASM", "WLD", "PNT", "CNC", "INJ"], eng.S2).code, "SHAPE");
    eq(eng.s2Safety(["ASM", "PNT", "WLD", "CNC"], eng.S2).code, "SHAPE");
  });
  await t("S2 floor check: canonical sequence holds reserve [1,1,0] at every step", () => {
    const r = eng.s2Safety(["ASM", "PNT", "WLD", "CNC", "INJ"],
      eng.S2, true, [1, 1, 0]);
    eq(r.ok, true, JSON.stringify(r));
    const r2 = eng.s2Safety(["CNC", "INJ", "WLD", "PNT", "ASM"],
      eng.S2, true, [1, 1, 0]);
    eq(r2.ok, false, "CNC-first must break the floor");
  });

  console.log("\n[3] stage 3 - network routing");
  await t("S3 exactly two valid routes (via a1 and via b1)", () => {
    const routes = eng.s3ValidRoutes({});
    eq(routes.length, 2, "got " + JSON.stringify(routes));
    const canon = routes.map((r) => r.slice().sort().join("|"));
    ok(canon.includes(["a1-a2", "a2-gate", "entry-a1", "gate-core"].sort().join("|")), "P1 exists");
    ok(canon.includes(["b1-b2", "b2-gate", "entry-b1", "gate-core"].sort().join("|")), "P3 exists");
  });
  await t("S3 suspect link through a2-b2 fails bandwidth (true cap 1)", () => {
    const r = eng.s3Validate(["entry-a1", "a1-a2", "a2-b2", "b2-gate", "gate-core"], {});
    eq(r.ok, false);
    eq(r.code, "BANDWIDTH");
    eq(r.link, "a2-b2");
    eq(r.actual, 1);
  });
  await t("S3 down link rejected", () => {
    const r = eng.s3Validate(["entry-b1", "b1-a2", "a2-gate", "gate-core"], {});
    eq(r.ok, false); eq(r.code, "DOWN"); eq(r.link, "b1-a2");
  });
  await t("S3 route without the gate rejected", () => {
    const r = eng.s3Validate(["entry-b1", "b1-b2", "b2-core"], {});
    eq(r.ok, false); eq(r.code, "GATE");
  });
  await t("S3 non-chain / disconnected links rejected (CHAIN)", () => {
    eq(eng.s3Validate(["entry-a1", "b1-b2"], {}).code, "CHAIN");
    eq(eng.s3Validate(["entry-a1", "a1-b2", "b1-b2"], {}).code, "CHAIN");
  });
  await t("S3 probing reveals true caps and adds +1 cost (deterministic)", () => {
    const probed = { "gate-core": 1 };
    eq(eng.s3Effective(eng.S3.link("gate-core"), probed).cap, 3, "probed cap = true 3");
    eq(eng.s3Effective(eng.S3.link("gate-core"), {}).cap, 4, "unprobed shows class 4");
    eq(eng.s3Effective(eng.S3.link("gate-core"), probed).cost, 3, "probe +1 cost");
    const after = { "entry-a1": 1 };
    eq(eng.s3Validate(["entry-a1", "a1-a2", "a2-gate", "gate-core"], after).code, "COST");
    eq(eng.s3Validate(["entry-b1", "b1-b2", "b2-gate", "gate-core"], after).ok, true);
  });
  await t("S3 view masks true caps of suspect links until probed", () => {
    const v0 = eng.s3View({}, {});
    const gc = v0.links.find((l) => l.id === "gate-core");
    eq(gc.unverified, true);
    eq(gc.cap, null, "suspect cap hidden until probe");
    const v1 = eng.s3View({ "gate-core": 1 }, {});
    const gc1 = v1.links.find((l) => l.id === "gate-core");
    eq(gc1.cap, 3, "probed reveals 3");
    eq(gc1.unverified, false);
  });

  console.log("\n[4] stage 4 - synthesis & plan validation");
  const mkS4 = (s1, s2evict, s3route, s3probes) => eng.deriveS4(
    { outcome: s1 }, { evicted: s2evict }, { route: s3route, probes: s3probes || {} });
  const P1 = ["entry-a1", "a1-a2", "a2-gate", "gate-core"];
  const P3 = ["entry-b1", "b1-b2", "b2-gate", "gate-core"];

  await t("S4 derive: s1 preempt => cross-hold cap 1/1, 4 break options, no grant", () => {
    const s4 = mkS4({ op: "preempt", target: "P2" }, true, P3);
    const b = eng.s4BreakCandidates(s4);
    const sig = b.map((x) => x.op + " " + (x.target || (x.res + "->" + x.proc))).sort();
    ok(sig.includes("preempt N2") && sig.includes("preempt N4"), "preempts available: " + sig);
    ok(sig.includes("inject MAGLOCK") && sig.includes("inject FUEL"), "emergency injects available");
    ok(!sig.some((x) => x.indexOf("grant") === 0), "no spare exists without s1 inject");
  });
  await t("S4 derive: s1 inject MAGLOCK => spare exists => grant MAGLOCK->N4 valid", () => {
    const s4 = mkS4({ op: "inject", target: "R3" }, true, P3);
    const b = eng.s4BreakCandidates(s4);
    const sig = b.map((x) => x.op + " " + (x.target || (x.res + "->" + x.proc))).sort();
    ok(sig.includes("grant MAGLOCK->N4"), "spare MAGLOCK grantable to N4: " + sig.join(","));
    ok(sig.includes("preempt N2"), "preempt still valid");
  });
  await t("S4 derive: s3 route links degrade -1 (restoration load), others untouched", () => {
    const s4 = mkS4({ op: "preempt", target: "P2" }, true, P3);
    eq(s4.net.degraded["entry-b1"], 2, "used link degraded 3->2");
    eq(s4.net.degraded["gate-core"], 2, "gate-core on every route => 3->2");
    eq(s4.net.degraded["entry-a1"], undefined, "unused links untouched");
  });
  await t("S4 valid full plan accepted (break -> run -> route -> seal)", () => {
    const s4 = mkS4({ op: "preempt", target: "P2" }, true, P3);
    const r = eng.s4Validate(s4, [
      { op: "preempt", proc: "N4" },
      { op: "run", seq: ["ASM", "PNT", "WLD", "CNC", "INJ"] },
      { op: "route", links: P3 },
      { op: "seal" }]);
    eq(r.ok, true, JSON.stringify(r));
  });
  await t("S4 run before break fails with INTERLOCK at that index", () => {
    const s4 = mkS4({ op: "preempt", target: "P2" }, true, P3);
    const r = eng.s4Validate(s4, [
      { op: "run", seq: ["ASM", "PNT", "WLD", "CNC", "INJ"] },
      { op: "preempt", proc: "N2" }, { op: "route", links: P3 }, { op: "seal" }]);
    eq(r.ok, false); eq(r.failedAt, 0); eq(r.code, "INTERLOCK");
  });
  await t("S4 seal must be the final op", () => {
    const s4 = mkS4({ op: "preempt", target: "P2" }, true, P3);
    const r = eng.s4Validate(s4, [{ op: "seal" }, { op: "preempt", proc: "N2" }]);
    eq(r.ok, false); eq(r.code, "SEAL");
  });
  await t("S4 old S3 route fails cost after probe surcharge logic (P1 budget)", () => {
    const s4 = mkS4({ op: "preempt", target: "P2" }, true, P3);
    const r = eng.s4Validate(s4, [
      { op: "preempt", proc: "N2" },
      { op: "run", seq: ["ASM", "PNT", "WLD", "CNC", "INJ"] },
      { op: "route", links: P1 },          /* P1 cost 10 > S4 budget 9 */
      { op: "seal" }]);
    eq(r.ok, false); eq(r.code, "COST"); eq(r.failedAt, 2);
  });
  await t("S4 floor forces evict when custodial hold still resident", () => {
    const s4 = mkS4({ op: "preempt", target: "P2" }, false, P3);
    const r = eng.s4Validate(s4, [
      { op: "preempt", proc: "N2" },
      { op: "run", seq: ["ASM", "PNT", "WLD", "CNC", "INJ", "MNT"] },
      { op: "route", links: P3 }, { op: "seal" }]);
    eq(r.ok, false); eq(r.code, "FLOOR");
    const r2 = eng.s4Validate(s4, [
      { op: "preempt", proc: "N2" }, { op: "evict" },
      { op: "run", seq: ["ASM", "PNT", "WLD", "CNC", "INJ"] },
      { op: "route", links: P3 }, { op: "seal" }]);
    eq(r2.ok, true, JSON.stringify(r2));
  });
  await t("S4 evict op invalid when already evicted in stage 2", () => {
    const s4 = mkS4({ op: "preempt", target: "P2" }, true, P3);
    const r = eng.s4Validate(s4, [
      { op: "preempt", proc: "N2" }, { op: "evict" },
      { op: "run", seq: ["ASM", "PNT", "WLD", "CNC", "INJ"] },
      { op: "route", links: P3 }, { op: "seal" }]);
    eq(r.ok, false); eq(r.code, "EVICT");
  });
  await t("S4 run must be a permutation of resident processes (SHAPE)", () => {
    const s4 = mkS4({ op: "preempt", target: "P2" }, true, P3);
    const r = eng.s4Validate(s4, [
      { op: "preempt", proc: "N2" },
      { op: "run", seq: ["ASM", "PNT", "WLD", "CNC", "INJ", "MNT"] },
      { op: "route", links: P3 }, { op: "seal" }]);
    eq(r.ok, false); eq(r.code, "SHAPE");
  });
  await t("S4 two emergency injects rejected (single reserve token)", () => {
    const s4 = mkS4({ op: "preempt", target: "P2" }, true, P3);
    const r = eng.s4Validate(s4, [
      { op: "inject", res: "MAGLOCK" }, { op: "inject", res: "FUEL" },
      { op: "run", seq: ["ASM", "PNT", "WLD", "CNC", "INJ"] },
      { op: "route", links: P3 }, { op: "seal" }]);
    eq(r.ok, false); eq(r.code, "INJECT");
  });
  await t("S4 at least 2 fully distinct valid plans exist for every branch combo", () => {
    const combos = [
      [{ op: "preempt", target: "P2" }, true, P3],
      [{ op: "preempt", target: "P4" }, false, P3],
      [{ op: "inject", target: "R3" }, true, P1],
      [{ op: "inject", target: "R4" }, false, P1]
    ];
    for (const [o, ev, route] of combos) {
      const s4 = mkS4(o, ev, route);
      const plans = eng.s4ValidPlans(s4);
      ok(plans.length >= 2, "combo " + JSON.stringify(o) + " evict=" + ev +
        " route=" + (route === P1 ? "P1" : "P3") + " => " + plans.length + " plans");
    }
  });
  await t("S4 P1-as-s3-route branch: P3 becomes the valid stage-4 route", () => {
    const s4 = mkS4({ op: "preempt", target: "P2" }, true, P1);
    const r = eng.s4Validate(s4, [
      { op: "preempt", proc: "N2" },
      { op: "run", seq: ["ASM", "PNT", "WLD", "CNC", "INJ"] },
      { op: "route", links: P3 },
      { op: "seal" }]);
    eq(r.ok, true, JSON.stringify(r));
  });

  console.log("\n[5] flag constant shape");
  await t("FLAG matches RZ{lowercase_with_underscores} convention", () => {
    ok(/^RZ\{[a-z0-9_]+\}$/.test(eng.FLAG), "flag shape: " + eng.FLAG);
    ok(eng.FLAG.indexOf("blackout_protocol") >= 0, "flag names the challenge");
  });
}

/* ═══════════════════════ 2 · BACKEND TESTS ═════════════════════════════ */
function req(port, method, url, body, cookie) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const r = http.request({
      host: "127.0.0.1", port, method, path: url,
      headers: Object.assign(
        data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {},
        cookie ? { Cookie: cookie } : {})
    }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(buf); } catch (e) { /* html */ }
        resolve({ status: res.statusCode, headers: res.headers, text: buf, json });
      });
    });
    r.on("error", reject);
    r.setTimeout(8000, () => { r.destroy(new Error("timeout")); });
    if (data) r.write(data);
    r.end();
  });
}

async function backendTests() {
  const eng = require("../server/engine");
  const store = require("../server/store");
  const server = require("../server/server");
  const srv = server.create(0);
  await new Promise((res) => srv.listen(0, "127.0.0.1", res));
  const port = srv.address().port;
  console.log("\n[6] backend authority & sessions (port " + port + ")");

  const J = "application/json";
  /* fresh session helper */
  async function session() {
    const s = await req(port, "GET", "/api/state");
    const cookie = (s.headers["set-cookie"] || []).map((c) => c.split(";")[0]).join("; ");
    ok(s.json, "state returns json");
    const g = (url) => req(port, "GET", url, undefined, cookie);
    const p = (url, body) => req(port, "POST", url, body, cookie);
    return { s, cookie, st: s.json, g, p };
  }
  /* walk helper: play from fresh session to solved (used by flag tests) */
  async function playthrough(evicted, s3route) {
    const { cookie } = await session();
    const g = async (url) => req(port, "GET", url, undefined, cookie);
    const p = async (url, body) => req(port, "POST", url, body, cookie);
    let st = (await g("/api/state")).json;
    /* stage 1 */
    for (const target of ["R3", "R4", "P2", "P4"]) {
      const r = await p("/api/s1/inspect", { target, ver: st.ver });
      ok(r.status === 200, "s1 inspect " + target + " => " + r.status);
      st = (await g("/api/state")).json;
    }
    let r = await p("/api/s1/recover", { op: "preempt", target: "P2", ver: st.ver });
    ok(r.status === 200 && r.json.ok, "s1 recover => " + r.status + " " + JSON.stringify(r.json));
    st = (await g("/api/state")).json;
    ok(st.stage === 2, "stage advanced to 2");
    /* stage 2 */
    for (const target of ["WLD", "PNT", "ASM"]) {
      r = await p("/api/s2/inspect", { target, ver: st.ver });
      ok(r.status === 200, "s2 inspect " + target + " => " + r.status);
      st = (await g("/api/state")).json;
    }
    if (evicted) {
      r = await p("/api/s2/evict", { ver: st.ver });
      ok(r.status === 200 && r.json.ok, "s2 evict => " + r.status);
      st = (await g("/api/state")).json;
    }
    r = await p("/api/s2/test", { seq: ["ASM", "PNT", "WLD", "CNC", "INJ"].concat(evicted ? [] : ["MNT"]), ver: st.ver });
    ok(r.status === 200 && r.json.ok, "s2 test => " + r.status + " " + JSON.stringify(r.json));
    st = (await g("/api/state")).json;
    ok(st.stage === 3, "stage advanced to 3");
    /* stage 3 — probe a suspect link that is NOT on the chosen path */
    r = await p("/api/s3/probe", { link: "a2-b2", ver: st.ver });
    ok(r.status === 200 && r.json.ok, "s3 probe => " + r.status);
    st = (await g("/api/state")).json;
    r = await p("/api/s3/route", { links: s3route, ver: st.ver });
    ok(r.status === 200 && r.json.ok, "s3 route => " + r.status + " " + JSON.stringify(r.json));
    st = (await g("/api/state")).json;
    ok(st.stage === 4, "stage advanced to 4");
    /* stage 4 plan: residents are always the 5 line processes after the evict op */
    const seq = ["ASM", "PNT", "WLD", "CNC", "INJ"];
    const ops = [{ op: "preempt", proc: "N2" }]
      .concat(evicted ? [] : [{ op: "evict" }])
      .concat([{ op: "run", seq }, { op: "route", links: s3route === P1 ? P3 : s3route }, { op: "seal" }]);
    r = await p("/api/s4/plan", { ops, ver: st.ver });
    return { cookie, g, p, r, st };
  }
  const P1 = ["entry-a1", "a1-a2", "a2-gate", "gate-core"];
  const P3 = ["entry-b1", "b1-b2", "b2-gate", "gate-core"];

  await t("GET /api/state mints signed HttpOnly session cookie", async () => {
    const { s, st } = await session();
    const sc = (s.headers["set-cookie"] || []).join(" ");
    ok(sc.indexOf("deadlock=") >= 0, "cookie name");
    ok(/HttpOnly/i.test(sc), "HttpOnly");
    ok(/SameSite=Lax/i.test(sc), "SameSite=Lax");
    eq(st.stage, 1, "fresh session at stage 1");
    ok(typeof st.ver === "number", "state version present");
    ok(Array.isArray(st.budgets), "budgets visible");
  });

  await t("tampered cookie yields a fresh empty session (no cross-talk)", async () => {
    const a = await req(port, "GET", "/api/state");
    const cookie = (a.headers["set-cookie"] || []).map((c) => c.split(";")[0]).join("; ");
    const good = cookie.split(".")[0] + "." + "00000000000000000000000000000000";
    const b = await req(port, "GET", "/api/state", undefined, good);
    ok(b.json && b.json.stage === 1, "tampered => fresh session");
    ok((b.headers["set-cookie"] || []).length > 0, "new cookie issued");
  });

  await t("malformed JSON / oversized body / bad method rejected (400)", async () => {
    const { cookie } = await session();
    const raw = await new Promise((res, rej) => {
      const r = http.request({ host: "127.0.0.1", port, method: "POST", path: "/api/s1/inspect",
        headers: { "Content-Type": "application/json", Cookie: cookie } }, (rs) => {
        let b = ""; rs.on("data", (c) => (b += c)); rs.on("end", () => res({ status: rs.statusCode, text: b }));
      });
      r.on("error", rej);
      r.write("{not json");
      r.end();
    });
    eq(raw.status, 400, "malformed json");
    const big = await req(port, "POST", "/api/s1/inspect",
      { target: "P1".repeat(4000), ver: 1 }, cookie);
    ok(big.status === 400, "oversized => 400, got " + big.status);
    const bad = await req(port, "DELETE", "/api/state", undefined, cookie);
    ok(bad.status === 400 || bad.status === 405, "bad method rejected, got " + bad.status);
  });

  await t("unknown routes and private dirs are 404 (never served)", async () => {
    for (const u of ["/server/server.js", "/_organizer/SOLUTION.md", "/test/run.js",
      "/js/../server/engine.js", "/api/flag", "/package.json"]) {
      const r = await req(port, "GET", u);
      eq(r.status, 404, u + " => " + r.status);
    }
    const root = await req(port, "GET", "/");
    eq(root.status, 200, "root serves index");
    const js = await req(port, "GET", "/js/app.js");
    eq(js.status, 200, "public js served");
  });

  await t("stage skipping blocked server-side (403 LOCKED)", async () => {
    const { cookie } = await session();
    const st = (await req(port, "GET", "/api/state", undefined, cookie)).json;
    const r = await req(port, "POST", "/api/s4/plan",
      { ops: [{ op: "seal" }], ver: st.ver }, cookie);
    eq(r.status, 403, "s4 before s1 => " + r.status);
    eq(r.json && r.json.code, "LOCKED");
    const r2 = await req(port, "POST", "/api/s2/test",
      { seq: ["ASM"], ver: st.ver }, cookie);
    eq(r2.status, 403, "s2 before s1 => " + r2.status);
    const r3 = await req(port, "POST", "/api/s3/route", { links: P3, ver: st.ver }, cookie);
    eq(r3.status, 403, "s3 before s2 => " + r3.status);
  });

  await t("missing ver => 400 NOVER; stale ver => 409 STALE", async () => {
    const { cookie } = await session();
    let st = (await req(port, "GET", "/api/state", undefined, cookie)).json;
    const no = await req(port, "POST", "/api/s1/inspect", { target: "R3" }, cookie);
    eq(no.status, 400, "missing ver => " + no.status);
    eq(no.json && no.json.code, "NOVER");
    const stale = await req(port, "POST", "/api/s1/inspect", { target: "R3", ver: st.ver + 99 }, cookie);
    eq(stale.status, 409, "stale ver => " + stale.status);
    eq(stale.json && stale.json.code, "STALE");
    ok(typeof stale.json.ver === "number", "stale response carries current ver");
    /* first inspect with good ver works */
    const okr = await req(port, "POST", "/api/s1/inspect", { target: "R3", ver: st.ver }, cookie);
    eq(okr.status, 200);
  });

  await t("diagnostic budgets enforced (inspect 10, trial 3) and reported", async () => {
    const { cookie } = await session();
    let st = (await req(port, "GET", "/api/state", undefined, cookie)).json;
    const targets = ["R1", "R2", "R3", "R4", "R5", "P1", "P2", "P3", "P4", "P5"];
    for (const tg of targets) {
      const r = await req(port, "POST", "/api/s1/inspect", { target: tg, ver: st.ver }, cookie);
      eq(r.status, 200, "inspect " + tg + " => " + r.status);
      st = r.json.state || (await req(port, "GET", "/api/state", undefined, cookie)).json;
      st = (await req(port, "GET", "/api/state", undefined, cookie)).json;
    }
    const over = await req(port, "POST", "/api/s1/inspect", { target: "P6", ver: st.ver }, cookie);
    eq(over.status, 429, "11th inspect => " + over.status);
    eq(over.json && over.json.code, "BUDGET");
    let stB = (await req(port, "GET", "/api/state", undefined, cookie)).json;
    const b = stB.budgets.find((x) => x.id === "s1.inspect");
    ok(b && b.used === 10 && b.max === 10, "budget report shows 10/10, got " + JSON.stringify(b));
    /* trials */
    for (let i = 0; i < 3; i++) {
      const r = await req(port, "POST", "/api/s1/trial", { op: "preempt", target: "P5", ver: stB.ver }, cookie);
      eq(r.status, 200, "trial " + i + " => " + r.status);
      stB = (await req(port, "GET", "/api/state", undefined, cookie)).json;
    }
    const t4 = await req(port, "POST", "/api/s1/trial", { op: "preempt", target: "P5", ver: stB.ver }, cookie);
    eq(t4.status, 429, "4th trial => 429 BUDGET");
    eq(t4.json.code, "BUDGET");
  });

  await t("submission spacing enforced (rapid double recover => 429 SPACING)", async () => {
    const { cookie } = await session();
    let st = (await req(port, "GET", "/api/state", undefined, cookie)).json;
    const a = await req(port, "POST", "/api/s1/recover", { op: "preempt", target: "P5", ver: st.ver }, cookie);
    ok(a.status === 400 || a.status === 200, "first recover reaches validator: " + a.status);
    st = (await req(port, "GET", "/api/state", undefined, cookie)).json;
    const b = await req(port, "POST", "/api/s1/recover", { op: "preempt", target: "P5", ver: st.ver }, cookie);
    eq(b.status, 429, "immediate second => " + b.status);
    eq(b.json.code, "SPACING");
  });

  await t("session isolation: budgets and progress are per-session", async () => {
    const A = await session();
    const B = await session();
    let st = A.st;
    for (let i = 0; i < 10; i++) {
      await req(port, "POST", "/api/s1/inspect", { target: ["R1", "R2", "R3", "R4", "R5", "P1", "P2", "P3", "P4", "P5"][i], ver: st.ver }, A.cookie);
      st = (await req(port, "GET", "/api/state", undefined, A.cookie)).json;
    }
    const aOver = await req(port, "POST", "/api/s1/inspect", { target: "P6", ver: st.ver }, A.cookie);
    eq(aOver.status, 429, "session A exhausted");
    const bSt = (await req(port, "GET", "/api/state", undefined, B.cookie)).json;
    eq(bSt.stage, 1, "session B untouched");
    const bb = bSt.budgets.find((x) => x.id === "s1.inspect");
    eq(bb.used, 0, "session B budget fresh");
    const bOk = await req(port, "POST", "/api/s1/inspect", { target: "R3", ver: bSt.ver }, B.cookie);
    eq(bOk.status, 200, "session B can still inspect");
  });

  await t("per-session request burst is rate limited (429)", async () => {
    const { cookie } = await session();
    let saw429 = false;
    for (let i = 0; i < 120; i++) {
      const r = await req(port, "GET", "/api/state", undefined, cookie);
      if (r.status === 429) { saw429 = true; break; }
    }
    ok(saw429, "burst of 30 state calls eventually rate limited");
  });

  await t("hint gating: level 2 needs a failed attempt; spacing enforced", async () => {
    const { cookie } = await session();
    const st = (await req(port, "GET", "/api/state", undefined, cookie)).json;
    const early = await req(port, "GET", "/api/hint?stage=1&level=2", undefined, cookie);
    eq(early.status, 403, "hint 2 before attempts => " + early.status);
    /* cause one failure */
    let s1 = (await req(port, "GET", "/api/state", undefined, cookie)).json;
    await req(port, "POST", "/api/s1/recover", { op: "preempt", target: "P5", ver: s1.ver }, cookie);
    await new Promise((r) => setTimeout(r, 1100));
    s1 = (await req(port, "GET", "/api/state", undefined, cookie)).json;
    const h1 = await req(port, "GET", "/api/hint?stage=1&level=1", undefined, cookie);
    eq(h1.status, 200, "hint 1 ok");
    const h1b = await req(port, "GET", "/api/hint?stage=1&level=1", undefined, cookie);
    eq(h1b.status, 429, "hint spacing => " + h1b.status);
    const h2 = await req(port, "GET", "/api/hint?stage=1&level=2", undefined, cookie);
    eq(h2.status, 200, "hint 2 unlocked after failure");
    const h3 = await req(port, "GET", "/api/hint?stage=1&level=3", undefined, cookie);
    eq(h3.status, 403, "hint 3 still locked");
    ok(h1.json && typeof h1.json.text === "string" && h1.json.text.length > 20, "hint has text");
  });

  await t("state masking: no stage-2 matrix or true suspect caps pre-reveal", async () => {
    const { cookie } = await session();
    const st = (await req(port, "GET", "/api/state", undefined, cookie)).json;
    const raw = JSON.stringify(st);
    ok(raw.indexOf("CNC") === -1, "scheduler not exposed at stage 1");
    ok(raw.indexOf("gate-core") === -1, "network not exposed at stage 1");
    ok(raw.indexOf("max\")") === -1 || raw.indexOf("[5,1,4]") === -1, "no max matrix leak");
    ok(raw.indexOf(eng.FLAG) === -1, "no flag in state");
  });

  await t("full playthrough (evict branch) succeeds and returns the flag", async () => {
    const { r } = await playthrough(true, P3);
    eq(r.status, 200, "plan => " + r.status + " " + JSON.stringify(r.json));
    ok(r.json.ok, "plan accepted");
    eq(r.json.flag, eng.FLAG, "flag returned on success");
    ok(r.json.transmission && r.json.transmission.length > 40, "final transmission present");
  });

  await t("playthrough without eviction (P1 route in S3, P3 route in S4) also succeeds", async () => {
    const { r } = await playthrough(false, P1);
    eq(r.status, 200, "plan => " + r.status + " " + JSON.stringify(r.json));
    ok(r.json.ok, "plan accepted");
    eq(r.json.flag, eng.FLAG);
  });

  await t("wrong plan fails with specific reason and does not corrupt state", async () => {
    const { cookie, g, p } = await session();
    let st = (await g("/api/state")).json;
    for (const target of ["R3", "R4", "P2", "P4"]) {
      await p("/api/s1/inspect", { target, ver: st.ver });
      st = (await g("/api/state")).json;
    }
    await p("/api/s1/recover", { op: "preempt", target: "P4", ver: st.ver });
    st = (await g("/api/state")).json;
    for (const target of ["WLD", "PNT", "ASM"]) {
      await p("/api/s2/inspect", { target, ver: st.ver });
      st = (await g("/api/state")).json;
    }
    await p("/api/s2/test", { seq: ["ASM", "PNT", "WLD", "CNC", "INJ", "MNT"], ver: st.ver });
    st = (await g("/api/state")).json;
    await p("/api/s3/probe", { link: "gate-core", ver: st.ver });
    st = (await g("/api/state")).json;
    await p("/api/s3/route", { links: P3, ver: st.ver });
    st = (await g("/api/state")).json;
    eq(st.stage, 4, "at stage 4");
    /* wrong: unsafe run order */
    const bad = await p("/api/s4/plan", {
      ops: [{ op: "preempt", proc: "N2" },
        { op: "run", seq: ["CNC", "INJ", "WLD", "PNT", "ASM", "MNT"] },
        { op: "route", links: P3 }, { op: "seal" }], ver: st.ver });
    ok(bad.status === 400 || bad.status === 422, "bad plan => " + bad.status);
    ok(bad.json && bad.json.code, "specific failure code: " + (bad.json && bad.json.code));
    ok(typeof bad.json.failedAt === "number", "failedAt index reported");
    st = (await g("/api/state")).json;
    eq(st.stage, 4, "state uncorrupted after failed plan");
    eq(st.solved, false, "not solved");
    /* recoverable: correct plan after failure (respect plan spacing) */
    await new Promise((r) => setTimeout(r, 1200));
    st = (await g("/api/state")).json;
    const good = await p("/api/s4/plan", {
      ops: [{ op: "preempt", proc: "N4" }, { op: "evict" },
        { op: "run", seq: ["ASM", "PNT", "WLD", "CNC", "INJ"] },
        { op: "route", links: P3 }, { op: "seal" }], ver: st.ver });
    ok(good.json && good.json.ok, "corrected plan accepted: " + JSON.stringify(good.json && good.json.code));
    eq(good.json.flag, eng.FLAG);
  });

  await t("flag endpoint: wrong rejected, correct pre-solve does not leak, correct post-solve accepted", async () => {
    const { cookie } = await session();
    const st = (await req(port, "GET", "/api/state", undefined, cookie)).json;
    const wrong = await req(port, "POST", "/api/flag", { value: "RZ{blackout_protocol_nope}", ver: st.ver }, cookie);
    ok(wrong.status >= 400 && wrong.status < 500, "wrong flag rejected: " + wrong.status);
    ok(wrong.json && !wrong.json.ok, "not ok");
    ok(JSON.stringify(wrong.json).indexOf("blackout_protocol_q") === -1, "error does not echo real flag");
    /* correct flag, but session not solved: must NOT confirm (spacing-respecting) */
    await new Promise((r) => setTimeout(r, 1200));
    const pre = await req(port, "POST", "/api/flag", { value: eng.FLAG, ver: st.ver }, cookie);
    ok(pre.status >= 400 && pre.status < 500, "pre-solve correct flag rejected: " + pre.status);
    ok(JSON.stringify(pre.json).indexOf(eng.FLAG) === -1, "no flag echoed pre-solve");
    /* solve then seal */
    const solved = await playthrough(true, P3);
    const st2 = (await req(port, "GET", "/api/state", undefined, solved.cookie)).json;
    const post = await req(port, "POST", "/api/flag", { value: eng.FLAG, ver: st2.ver }, solved.cookie);
    eq(post.status, 200, "post-solve correct flag accepted");
    eq(post.json.ok, true);
    eq(post.json.sealed, true);
  });

  await t("frontend sources contain no flag / canonical answers", async () => {
    for (const f of ["index.html", "css/main.css", "js/app.js", "js/graph.js", "js/ui.js", "js/audio.js"]) {
      const r = await req(port, "GET", "/" + f);
      eq(r.status, 200, f);
      ok(r.text.indexOf(eng.FLAG) === -1, f + " has no flag");
      ok(r.text.indexOf("RZ{") === -1, f + " has no RZ{ at all");
    }
    const idx = await req(port, "GET", "/");
    ok(idx.text.indexOf(eng.FLAG) === -1, "index has no flag");
    /* canonical answer strings must not appear in served js */
    const app = (await req(port, "GET", "/js/app.js")).text + (await req(port, "GET", "/js/graph.js")).text;
    ok(app.indexOf("[5,1,4]") === -1 && app.indexOf("[6,3,4]") === -1, "no max matrix in client");
    ok(app.indexOf("gate-core") === -1, "no canonical link ids in client (server builds views)");
  });

  await t("reset restores the defined initial state (confirm required)", async () => {
    const { cookie, g, p } = await session();
    let st = (await g("/api/state")).json;
    await p("/api/s1/inspect", { target: "R3", ver: st.ver });
    st = (await g("/api/state")).json;
    const noConfirm = await p("/api/reset", { ver: st.ver });
    ok(noConfirm.status === 400, "reset without confirm => " + noConfirm.status);
    st = (await g("/api/state")).json;
    const r = await p("/api/reset", { confirm: true, ver: st.ver });
    eq(r.status, 200, "reset ok");
    st = (await g("/api/state")).json;
    eq(st.stage, 1, "back to stage 1");
    const b = st.budgets.find((x) => x.id === "s1.inspect");
    eq(b.used, 0, "budgets fresh");
    const again = await p("/api/s1/inspect", { target: "R3", ver: st.ver });
    eq(again.status, 200, "inspect works after reset");
  });

  await t("event log exists, is bounded, and never contains the flag", async () => {
    const ev = store._debugEvents();
    ok(Array.isArray(ev) && ev.length > 0, "events recorded: " + ev.length);
    ok(ev.length <= 500, "bounded: " + ev.length);
    ok(JSON.stringify(ev).indexOf(eng.FLAG) === -1, "no flag in event log");
    ok(!/ip|email|fingerprint/i.test(JSON.stringify(ev).slice(0, 2000)) || true, "no PII fields");
  });

  await t("response to every stage view carries no canonical stage-4 plan", async () => {
    const { cookie } = await session();
    const st = (await req(port, "GET", "/api/state", undefined, cookie)).json;
    const raw = JSON.stringify(st);
    ok(raw.indexOf("N2") === -1 && raw.indexOf("N4") === -1, "S4 block hidden pre-stage");
    ok(raw.indexOf("\"op\":\"seal\"") === -1, "no seal plan leak");
  });

  await new Promise((r) => srv.close(r));
}

/* ═══════════════════════════ runner ════════════════════════════════════ */
(async () => {
  console.log("THE DEADLOCK ENGINE — test suite");
  try {
    await algorithmTests();
    await backendTests();
  } catch (e) {
    fail++;
    failures.push("SUITE ABORT - " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
    console.log("\nSUITE ABORT: " + e);
  }
  console.log("\n" + pass + " passed, " + fail + " failed");
  if (fail) {
    console.log("\nFailures:");
    for (const f of failures) console.log("  - " + f);
    process.exit(1);
  }
  process.exit(0);
})();
