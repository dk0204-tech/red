/* ============================================================================
 * THE DEADLOCK ENGINE: BLACKOUT PROTOCOL — reference solver (organizer only)
 *
 * Plays the full 4-stage path against a live server over the public API,
 * exactly as a player would (session cookie, budgets, spacing), then seals
 * the flag. Pathfinding reads link ids from the server's own view — nothing
 * canonical is hardcoded beyond the well-known scheduler order.
 *
 * Usage:
 *   node _organizer/solve.js                       # spawns its own server
 *   BASE_URL=http://host:8090 node _organizer/solve.js   # against a running one
 * ========================================================================== */
"use strict";
const http = require("http");
const { URL } = require("url");

let targetBase = process.env.BASE_URL || "";
let cookie = "";

function req(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(pathname, targetBase);
    const payload = body ? JSON.stringify(body) : null;
    const headers = { "Content-Type": "application/json" };
    if (cookie) headers.Cookie = cookie;
    if (payload) headers["Content-Length"] = Buffer.byteLength(payload);
    const r = http.request({
      host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers
    }, (res) => {
      let text = "";
      res.on("data", (c) => (text += c));
      res.on("end", () => {
        const set = res.headers["set-cookie"];
        if (set && set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
        let json = null;
        try { json = JSON.parse(text); } catch (e) { /* non-json */ }
        resolve({ status: res.statusCode, json, text });
      });
    });
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

const log = (step, extra) => console.log("  \u2713 " + step + (extra ? "  \u2014 " + extra : ""));
function assert(cond, msg) { if (!cond) { console.error("  \u2717 " + msg); process.exit(1); } }

/* enumerate simple paths entry->core, keep those traversing the gate on UP links */
function allPaths(net, entry, core, gate) {
  const adj = {};
  net.links.filter((l) => l.up).forEach((l) => {
    (adj[l.a] = adj[l.a] || []).push(l);
    (adj[l.b] = adj[l.b] || []).push(l);
  });
  const out = [];
  const walk = (node, used, trail, visited) => {
    if (trail.length > 10 || out.length > 40) return;
    if (node === core) { out.push(trail.slice()); return; }
    for (const l of adj[node] || []) {
      if (used.has(l.id)) continue;
      const next = l.a === node ? l.b : l.a;
      if (visited.has(next)) continue;
      used.add(l.id); visited.add(next); trail.push(l.id);
      walk(next, used, trail, visited);
      used.delete(l.id); visited.delete(next); trail.pop();
    }
  };
  walk(entry, new Set(), [], new Set([entry]));
  return out.filter((trail) => {
    const nodes = new Set();
    trail.forEach((id) => {
      const l = net.links.find((x) => x.id === id);
      nodes.add(l.a); nodes.add(l.b);
    });
    return nodes.has(gate);
  });
}

function routeStats(net, trail, degrade) {
  let cost = 0, bottleneck = null;
  for (const id of trail) {
    const l = net.links.find((x) => x.id === id);
    cost += l.cost;
    let cap = l.cap == null ? l.classCap : l.cap;    /* unprobed suspect = class */
    if (degrade) cap = Math.max(1, cap - 1);
    bottleneck = bottleneck == null ? cap : Math.min(bottleneck, cap);
  }
  return { cost, bottleneck };
}

async function main() {
  let server = null;
  if (!targetBase) {
    const { create } = require("../server/server");
    server = create();
    await new Promise((res) => server.listen(0, "127.0.0.1", res));
    targetBase = "http://127.0.0.1:" + server.address().port;
  }
  console.log("THE DEADLOCK ENGINE — reference solve against " + targetBase);

  /* ---- session + briefing ack ---- */
  let st = (await req("GET", "/api/state")).json;
  assert(st && st.stage === 1, "fresh session starts at stage 1");
  log("session minted", "ver " + st.ver);

  let br = (await req("GET", "/api/briefing")).json;
  await req("POST", "/api/ack", { kind: "briefing", ver: st.ver });
  st = (await req("GET", "/api/state")).json;
  log("stage-1 briefing acknowledged", br.title);

  /* ---- STAGE 1: inspect the cross-held pair, recover ---- */
  for (const target of ["R3", "R4", "P2", "P4"]) {
    const r = await req("POST", "/api/s1/inspect", { target, ver: st.ver });
    assert(r.status === 200, "inspect " + target + " -> " + r.status);
    st = r.json.state;
  }
  log("inspected R3/R4/P2/P4", "capacities + holdings revealed");

  const trial = await req("POST", "/api/s1/trial", { op: "preempt", target: "P2", ver: st.ver });
  assert(trial.status === 200 && trial.json.trial.drains, "trial(preempt P2) drains");
  st = trial.json.state;
  log("trial preempt P2", "drains=true (stuck identities withheld)");

  const rec = await req("POST", "/api/s1/recover", { op: "preempt", target: "P2", ver: st.ver });
  assert(rec.status === 200, "recovery accepted -> " + rec.status);
  st = rec.json.state;
  assert(st.stage === 2, "advanced to stage 2");
  log("stage 1 cleared", rec.json.clear);

  br = (await req("GET", "/api/briefing")).json;
  await req("POST", "/api/ack", { kind: "briefing", ver: st.ver });
  st = (await req("GET", "/api/state")).json;
  log("stage-2 briefing acknowledged", br.title);

  /* ---- STAGE 2: evict custodial rig, submit a safe order ---- */
  const ev = await req("POST", "/api/s2/evict", { ver: st.ver });
  assert(ev.status === 200, "evict accepted -> " + ev.status + " " + JSON.stringify(ev.json));
  st = ev.json.state;
  log("custodial rig evicted", "hold returned to the pool");

  const seq = ["ASM", "PNT", "WLD", "CNC", "INJ"];   /* floor-safe without MNT */
  const test = await req("POST", "/api/s2/test", { seq, ver: st.ver });
  assert(test.status === 200, "safe order rejected -> " + test.status + " " + JSON.stringify(test.json));
  st = test.json.state;
  assert(st.stage === 3, "advanced to stage 3");
  log("stage 2 cleared", "order " + seq.join(">") + " accepted");

  br = (await req("GET", "/api/briefing")).json;
  await req("POST", "/api/ack", { kind: "briefing", ver: st.ver });
  st = (await req("GET", "/api/state")).json;
  log("stage-3 briefing acknowledged", br.title);

  /* ---- STAGE 3: cheapest corridor that survives BOTH stage rules ---- */
  const entry = st.net.nodes.find((n) => n.role === "entry").id;
  const core = st.net.nodes.find((n) => n.role === "core").id;
  const gate = st.net.nodes.find((n) => n.role === "gate").id;
  const candidates = allPaths(st.net, entry, core, gate)
    .map((trail) => {
      const s3 = routeStats(st.net, trail, false);
      const s4 = routeStats(st.net, trail, true);
      return { trail, s3, s4 };
    })
    .filter((c) =>
      c.s3.bottleneck >= st.net.floor && c.s3.cost <= st.net.budget &&
      c.s4.bottleneck >= 2 && c.s4.cost <= 9)
    .sort((a, b) => a.s3.cost - b.s3.cost);
  assert(candidates.length, "no corridor satisfies stage-3 + stage-4 constraints");
  const route = candidates[0].trail;
  const routeRes = await req("POST", "/api/s3/route", { links: route, ver: st.ver });
  assert(routeRes.status === 200,
    "route rejected -> " + routeRes.status + " " + JSON.stringify(routeRes.json));
  st = routeRes.json.state;
  assert(st.stage === 4, "advanced to stage 4");
  log("stage 3 cleared", route.join(">") + " (cost " + candidates[0].s3.cost +
    " \u2264 " + st.net.budget + " at stage 3, " + candidates[0].s4.cost + " \u2264 9 at stage 4)");

  br = (await req("GET", "/api/briefing")).json;
  await req("POST", "/api/ack", { kind: "briefing", ver: st.ver });
  st = (await req("GET", "/api/state")).json;
  log("stage-4 briefing acknowledged", br.title);

  /* ---- STAGE 4: plan = break block -> run -> route -> seal ---- */
  const plan = [
    { op: "preempt", proc: st.block.procs.find((p) => !p.dead).id },
    { op: "run", seq: ["ASM", "PNT", "WLD", "CNC", "INJ"] },
    { op: "route", links: route },
    { op: "seal" }
  ];
  const done = await req("POST", "/api/s4/plan", { ops: plan, ver: st.ver });
  assert(done.status === 200, "plan rejected -> " + done.status + " " + JSON.stringify(done.json));
  st = done.json.state;
  assert(st.solved, "session solved");
  assert(/^RZ\{[a-z0-9_]+\}$/.test(done.json.flag), "flag shape");
  log("STAGE 4 CLEARED", "plan accepted, transmission returned");

  /* ---- seal ---- */
  const seal = await req("POST", "/api/flag", { value: done.json.flag, ver: st.ver });
  assert(seal.status === 200 && seal.json.sealed, "flag seal failed -> " + seal.status);
  log("flag sealed", done.json.flag);

  console.log("\nREFERENCE SOLVE PASS — flag: " + done.json.flag);
  if (server) server.close();
  process.exit(0);
}

main().catch((e) => {
  console.error("REFERENCE SOLVE FAILED:", e);
  process.exit(1);
});
