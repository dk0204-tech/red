/* ============================================================================
 * THE DEADLOCK ENGINE: BLACKOUT PROTOCOL — pure puzzle engine
 *
 * Server-only. Canonical instances, deadlock detection, banker's safety,
 * constrained routing, and stage-4 plan validation. Pure functions over
 * explicit data: the store owns session state, this module never sees HTTP.
 *
 * Instances:
 *   S1  resource-allocation graph  (real deadlock {P2,P4} vs apparent cycle)
 *   S2  max-claim scheduler        (Banker's safety, eviction, stale cache)
 *   S3  constrained network        (class caps, suspect links, probe costs)
 *   S4  derived synthesis state    (block + scheduler + degraded network)
 * ==========================================================================*/
"use strict";

const FLAG = process.env.DEADLOCK_FLAG || "RZ{blackout_protocol_quiesce}";

const clone = (o) => JSON.parse(JSON.stringify(o));

/* ═══════════════════════════ shared drain analysis ═════════════════════ */
/*
 * Instance shape: { resources:{id:{cap, alloc:{pid:n}}}, processes:{id:{max:{rid:n}}} }
 * Intervention: {op:"preempt",target} | {op:"inject",target} |
 * {op:"grant",res,proc} | null.
 * A process finishes when every remaining claim fits the free pool; finishing
 * releases what it held. drains = everyone finished; stuck = can never run.
 */
function drain(inst, intervention) {
  const caps = {}, allocs = {}, procs = clone(inst.processes);
  for (const r in inst.resources) {
    caps[r] = inst.resources[r].cap;
    allocs[r] = clone(inst.resources[r].alloc || {});
  }
  const dead = new Set();          /* preempted */
  const done = new Set();
  const heldBy = (p) => {
    const h = {};
    for (const r in allocs) if (allocs[r][p]) h[r] = allocs[r][p];
    return h;
  };
  const freeOf = (r) => {
    let t = 0;
    for (const p in allocs[r]) if (!dead.has(p)) t += allocs[r][p];
    return caps[r] - t;
  };
  const release = (p) => { for (const r in allocs) delete allocs[r][p]; };
  if (intervention) {
    if (intervention.op === "preempt") {
      const p = intervention.target;
      if (procs[p] && !dead.has(p)) { dead.add(p); release(p); }
    } else if (intervention.op === "inject") {
      const r = intervention.target;
      if (caps[r] !== undefined) caps[r] += 1;
    } else if (intervention.op === "grant") {
      const { res, proc } = intervention;
      if (procs[proc] && caps[res] !== undefined) {
        const held = heldBy(proc);
        const need = (procs[proc].max[res] || 0) - (held[res] || 0);
        if (need > 0 && freeOf(res) >= 1) allocs[res][proc] = (allocs[res][proc] || 0) + 1;
      }
    }
  }
  let progress = true;
  while (progress) {
    progress = false;
    for (const p in procs) {
      if (done.has(p) || dead.has(p)) continue;
      const held = heldBy(p);
      let can = true;
      for (const r in procs[p].max) {
        const need = procs[p].max[r] - (held[r] || 0);
        if (need > 0 && need > freeOf(r)) { can = false; break; }
      }
      if (can) { done.add(p); for (const r in held) delete allocs[r][p]; progress = true; }
    }
  }
  const stuck = [];
  for (const p in procs) if (!done.has(p) && !dead.has(p)) stuck.push(p);
  return { drains: stuck.length === 0, stuck };
}

/* ═══════════════════════════ STAGE 1 instance ══════════════════════════ */
function makeS1() {
  return {
    resources: {
      R1: { label: "COOLANT", cap: 2, alloc: { P1: 1 } },
      R2: { label: "BUS", cap: 2, alloc: { P3: 1, P6: 1 } },
      R3: { label: "MAGLOCK", cap: 1, alloc: { P2: 1 } },
      R4: { label: "FUEL", cap: 1, alloc: { P4: 1 } },
      R5: { label: "TOKEN", cap: 1, alloc: { P5: 1 } }
    },
    processes: {
      P1: { label: "COOLANT LOOP", max: { R1: 1 } },
      P2: { label: "MAGLOCK SEAL", max: { R3: 1, R4: 1 } },
      P3: { label: "CELL", max: { R2: 1 } },
      P4: { label: "FORGE", max: { R4: 1, R3: 1 } },
      P5: { label: "DOSE RAIL", max: { R5: 1, R2: 1 } },
      P6: { label: "RELAY", max: { R2: 1, R5: 1 } }
    },
    clone: () => makeS1()
  };
}
const S1 = makeS1();

function s1Drain(inst, intervention) { return drain(inst, intervention || null); }

/* enumerate simple cycles of the wait-for (resource allocation) graph */
function s1WaitCycles(inst) {
  const adj = {};
  const add = (a, b) => { (adj[a] = adj[a] || []).push(b); };
  const heldOf = (p) => {
    const h = {};
    for (const r in inst.resources) if (inst.resources[r].alloc[p]) h[r] = inst.resources[r].alloc[p];
    return h;
  };
  for (const p in inst.processes) {
    const held = heldOf(p);
    for (const r in inst.processes[p].max) {
      if (inst.processes[p].max[r] - (held[r] || 0) > 0) add("P:" + p, "R:" + r);
    }
  }
  for (const r in inst.resources) {
    for (const p in inst.resources[r].alloc) {
      if (inst.resources[r].alloc[p] > 0) add("R:" + r, "P:" + p);
    }
  }
  const cycles = [];
  const seen = new Set();
  const nodes = Object.keys(adj).sort();
  const dfs = (start, path) => {
    const cur = path[path.length - 1];
    for (const nx of (adj[cur] || [])) {
      if (nx === start) {
        let mi = 0;
        for (let i = 1; i < path.length; i++) if (path[i] < path[mi]) mi = i;
        const rot = path.slice(mi).concat(path.slice(0, mi));
        const key = rot.join(">");
        if (!seen.has(key)) { seen.add(key); cycles.push(rot); }
        continue;
      }
      if (path.indexOf(nx) >= 0 || nx < start) continue;
      dfs(start, path.concat([nx]));
    }
  };
  for (const n of nodes) dfs(n, [n]);
  return cycles;
}

const s1CandOps = (inst) =>
  Object.keys(inst.processes).map((p) => ({ op: "preempt", target: p }))
    .concat(Object.keys(inst.resources).map((r) => ({ op: "inject", target: r })));

function s1ValidRecoveries(inst) {
  return s1CandOps(inst).filter((c) => s1Drain(inst, c).drains);
}

function s1Trial(inst, op, target) {
  const r = s1Drain(inst, { op, target });
  return { drains: r.drains, stuckCount: r.stuck.length };
}

function s1View(inst, revealed) {
  const show = (x) => !!(revealed && revealed.has && revealed.has(x));
  const resources = {};
  for (const r in inst.resources) {
    const res = inst.resources[r];
    let tot = 0;
    const holders = {};
    for (const p in res.alloc) { holders[p] = res.alloc[p]; tot += res.alloc[p]; }
    resources[r] = {
      label: res.label,
      cap: show(r) ? res.cap : null,
      holders: show(r) ? holders : null,
      free: show(r) ? res.cap - tot : null
    };
  }
  const processes = {};
  for (const p in inst.processes) {
    const held = {};
    for (const r in inst.resources) if (inst.resources[r].alloc[p]) held[r] = inst.resources[r].alloc[p];
    const waitingOn = [];
    for (const r in inst.processes[p].max) {
      if (inst.processes[p].max[r] - (held[r] || 0) > 0) waitingOn.push(r);
    }
    processes[p] = {
      label: inst.processes[p].label,
      status: waitingOn.length ? "BLOCKED" : "RUNNING",
      waitingOn,
      holds: show(p) ? held : null,
      max: show(p) ? clone(inst.processes[p].max) : null
    };
  }
  return { resources, processes };
}

/* ═══════════════════════════ STAGE 2 instance ══════════════════════════ */
const S2 = {
  types: ["COOLANT", "BUS", "CYCLE"],
  totals: [10, 5, 5],
  order: ["CNC", "INJ", "WLD", "PNT", "ASM", "MNT"],
  procs: {
    CNC: { label: "CNC ROUTER", alloc: [3, 0, 2], max: [5, 1, 4] },
    INJ: { label: "INJECTOR", alloc: [2, 1, 1], max: [6, 3, 4] },
    WLD: { label: "WELDER", alloc: [2, 1, 0], max: [3, 2, 1] },
    PNT: { label: "PAINTER", alloc: [0, 1, 1], max: [1, 1, 2] },
    ASM: { label: "ASSEMBLER", alloc: [0, 0, 1], max: [1, 0, 1] },
    MNT: { label: "CUSTODIAL RIG", alloc: [2, 1, 0], max: [2, 1, 0], custodial: true }
  },
  cachedMax: { WLD: [4, 2, 1] }
};

const s2Residents = (inst, evicted) =>
  inst.order.filter((p) => !(evicted && inst.procs[p] && inst.procs[p].custodial));

function s2Avail(inst, evicted) {
  const res = s2Residents(inst, evicted);
  const used = [0, 0, 0];
  for (const p of res) {
    const a = inst.procs[p].alloc;
    used[0] += a[0]; used[1] += a[1]; used[2] += a[2];
  }
  return [inst.totals[0] - used[0], inst.totals[1] - used[1], inst.totals[2] - used[2]];
}

function s2Safety(seq, inst, evicted, floor, maxOverride) {
  evicted = !!evicted;
  const residents = s2Residents(inst, evicted);
  if (!Array.isArray(seq) || seq.length !== residents.length ||
      new Set(seq).size !== seq.length ||
      seq.some((p) => residents.indexOf(p) < 0)) {
    return { ok: false, code: "SHAPE" };
  }
  let avail = s2Avail(inst, evicted);
  for (let i = 0; i < seq.length; i++) {
    const p = seq[i];
    const alloc = inst.procs[p].alloc;
    const max = (maxOverride && maxOverride[p]) || inst.procs[p].max;
    const usable = avail.map((v, k) => v - (floor ? (floor[k] || 0) : 0));
    const deficit = {};
    let fail = false, floorCaused = false;
    for (let k = 0; k < 3; k++) {
      const need = max[k] - alloc[k];
      if (need > usable[k]) {
        fail = true;
        const over = need - usable[k];
        if (over > 0) deficit[inst.types[k]] = over;
        if (need <= avail[k]) floorCaused = true;
      }
    }
    if (fail) {
      return {
        ok: false, failedAt: i, proc: p, deficit,
        code: (floor && floorCaused) ? "FLOOR" : "UNSAFE"
      };
    }
    avail = [avail[0] + alloc[0], avail[1] + alloc[1], avail[2] + alloc[2]];
  }
  return { ok: true };
}

function s2AllSafe(inst, evicted, floor) {
  const residents = s2Residents(inst, evicted);
  const out = [];
  const perm = (cur, rest) => {
    if (out.length >= 200) return;
    if (!rest.length) {
      if (s2Safety(cur, inst, evicted, floor || null).ok) out.push(cur.slice());
      return;
    }
    for (let i = 0; i < rest.length; i++) {
      perm(cur.concat([rest[i]]), rest.slice(0, i).concat(rest.slice(i + 1)));
    }
  };
  perm([], residents);
  return out;
}

const s2CachedMax = () => clone(S2.cachedMax);
const s2Max = (proc, revealed) => (revealed && revealed.has && revealed.has(proc) ? S2.procs[proc].max.slice() : null);

/* ═══════════════════════════ STAGE 3 instance ══════════════════════════ */
const S3_NODES = [
  { id: "entry", x: 60, y: 170, label: "INGRESS", role: "entry" },
  { id: "a1", x: 200, y: 70, label: "JCT-A1" },
  { id: "b1", x: 200, y: 270, label: "JCT-B1" },
  { id: "a2", x: 340, y: 70, label: "JCT-A2" },
  { id: "b2", x: 340, y: 270, label: "JCT-B2" },
  { id: "gate", x: 470, y: 170, label: "SEC-GATE", role: "gate" },
  { id: "core", x: 600, y: 170, label: "CORE", role: "core" }
];
const CLASS_CAP = { T: 4, B: 3, S: 2 };
function mkLink(id, a, b, cls, cost, up, suspect, trueCap) {
  return { id, a, b, cls, classCap: CLASS_CAP[cls], cost, up: up !== false, suspect: !!suspect, trueCap: trueCap };
}
const S3_LINKS = [
  mkLink("entry-a1", "entry", "a1", "T", 3),
  mkLink("entry-b1", "entry", "b1", "B", 2),
  mkLink("a1-a2", "a1", "a2", "T", 3),
  mkLink("a1-b2", "a1", "b2", "S", 1),
  mkLink("b1-b2", "b1", "b2", "B", 2),
  mkLink("b1-a2", "b1", "a2", "S", 1, false),
  mkLink("a2-b2", "a2", "b2", "T", 1, true, true, 1),
  mkLink("a2-gate", "a2", "gate", "B", 2),
  mkLink("b2-gate", "b2", "gate", "B", 2),
  mkLink("b2-core", "b2", "core", "T", 4),
  mkLink("gate-core", "gate", "core", "T", 2, true, true, 3)
];
const S3 = {
  nodes: clone(S3_NODES),
  links: clone(S3_LINKS),
  floor: 3,
  budget: 10,
  probeBudget: 8,
  link: (id) => S3.links.find((l) => l.id === id) || null
};

const s3TrueCap = (l) => (l.trueCap != null ? l.trueCap : l.classCap);
const s3Effective = (l, probed) => ({
  cap: (probed && probed[l.id]) ? s3TrueCap(l) : l.classCap,
  cost: l.cost + ((probed && probed[l.id]) || 0)
});

function s3Path(ids) {
  /* returns ordered node path or null when ids do not form a simple chain entry→core */
  const byId = {};
  for (const l of S3.links) byId[l.id] = l;
  if (!ids.length) return null;
  const adj = {};
  for (const id of ids) {
    const l = byId[id];
    if (!l) return null;
    (adj[l.a] = adj[l.a] || []).push({ n: l.b, id });
    (adj[l.b] = adj[l.b] || []).push({ n: l.a, id });
  }
  const deg1 = Object.keys(adj).filter((n) => adj[n].length === 1);
  for (const n of Object.keys(adj)) if (adj[n].length > 2) return null;
  if (deg1.length !== 2) return null;
  const start = deg1.indexOf("entry") >= 0 ? "entry" : deg1[0];
  const walk = [start];
  const walkIds = [];
  const used = new Set();
  let cur = start, prev = null;
  while (true) {
    const opts = (adj[cur] || []).filter((e) => !used.has(e.id));
    if (!opts.length) break;
    const e = opts[0];
    used.add(e.id);
    walkIds.push(e.id);
    prev = cur;
    cur = e.n;
    walk.push(cur);
  }
  if (used.size !== ids.length) return null;
  if (walk.indexOf("core") < 0) return null;
  return { nodes: walk, links: walkIds };
}

function s3Validate(ids, probed) {
  if (!Array.isArray(ids) || !ids.length) return { ok: false, code: "CHAIN" };
  const path = s3Path(ids);
  if (!path) return { ok: false, code: "CHAIN" };
  const byId = {};
  for (const l of S3.links) byId[l.id] = l;
  for (const id of path.links) {
    if (!byId[id].up) return { ok: false, code: "DOWN", link: id };
  }
  if (path.nodes.indexOf("gate") < 0) return { ok: false, code: "GATE" };
  let bottleneck = Infinity, bad = null;
  for (const id of path.links) {
    const cap = s3TrueCap(byId[id]);
    if (cap < S3.floor && (bad === null)) { bad = id; }
    bottleneck = Math.min(bottleneck, cap);
  }
  if (bottleneck < S3.floor) {
    return { ok: false, code: "BANDWIDTH", link: bad, actual: s3TrueCap(byId[bad]), floor: S3.floor };
  }
  let cost = 0;
  for (const id of path.links) cost += byId[id].cost + ((probed && probed[id]) || 0);
  if (cost > S3.budget) return { ok: false, code: "COST", actual: cost, budget: S3.budget };
  return { ok: true, cost, bottleneck, path: path.links };
}

function s3AllPaths() {
  const adj = {};
  for (const l of S3.links) {
    if (!l.up) continue;
    (adj[l.a] = adj[l.a] || []).push({ n: l.b, id: l.id });
    (adj[l.b] = adj[l.b] || []).push({ n: l.a, id: l.id });
  }
  const out = [];
  const walk = (cur, nodes, ids, used) => {
    if (cur === "core") { out.push({ nodes: nodes.slice(), links: ids.slice() }); return; }
    for (const e of (adj[cur] || [])) {
      if (used.has(e.n)) continue;
      used.add(e.n);
      walk(e.n, nodes.concat([e.n]), ids.concat([e.id]), used);
      used.delete(e.n);
    }
  };
  walk("entry", ["entry"], [], new Set(["entry"]));
  return out;
}

function s3ValidRoutes(probed) {
  return s3AllPaths()
    .filter((p) => s3Validate(p.links, probed || {}).ok)
    .map((p) => p.links);
}

function s3View(probed, extra) {
  probed = probed || {};
  extra = extra || {};
  return {
    nodes: clone(S3_NODES),
    floor: S3.floor,
    budget: S3.budget,
    probeBudget: extra.probeBudget != null ? extra.probeBudget : S3.probeBudget,
    probesUsed: Object.keys(probed).length,
    links: S3.links.map((l) => {
      const isProbed = !!probed[l.id];
      const unverified = l.suspect && !isProbed;
      return {
        id: l.id, a: l.a, b: l.b,
        cls: l.cls, classCap: l.classCap,
        up: l.up,
        suspect: l.suspect,
        unverified,
        probed: isProbed,
        cap: unverified ? null : (isProbed ? s3TrueCap(l) : l.classCap),
        cost: l.cost + (probed[l.id] || 0)
      };
    })
  };
}

/* ═══════════════════════════ STAGE 4 derivation ════════════════════════ */
function blockAsS1(block) {
  const resources = {}, processes = {};
  const dead = block.dead || [];
  for (const r of Object.keys(block.caps)) resources[r] = { cap: block.caps[r], alloc: {} };
  for (const p in block.procs) {
    if (dead.indexOf(p) >= 0) continue;   /* preempted: removed, holds released */
    processes[p] = { max: clone(block.procs[p].max) };
    for (const r in block.procs[p].alloc) {
      resources[r].alloc[p] = block.procs[p].alloc[r];
    }
  }
  return { resources, processes };
}

function deriveS4(s1state, s2state, s3state) {
  const outcome = (s1state && s1state.outcome) || null;
  let maglock = 1, fuel = 1;
  if (outcome && outcome.op === "inject") {
    if (outcome.target === "R3") maglock = 2;
    if (outcome.target === "R4") fuel = 2;
  }
  const block = {
    caps: { MAGLOCK: maglock, FUEL: fuel },
    procs: {
      N2: { label: "NODE-2 BUS CTRL", alloc: { MAGLOCK: 1 }, max: { MAGLOCK: 1, FUEL: 1 } },
      N4: { label: "NODE-4 HEAT GATE", alloc: { FUEL: 1 }, max: { FUEL: 1, MAGLOCK: 1 } }
    },
    dead: []
  };
  const evicted = !!(s2state && s2state.evicted);
  const route = (s3state && s3state.route) || [];
  const s3probes = (s3state && s3state.probes) || {};
  const degraded = {};
  for (const id of route) {
    const l = S3.link(id);
    if (l) degraded[id] = Math.max(1, s3TrueCap(l) - 1);
  }
  return {
    block,
    sched: {
      types: S2.types.slice(),
      totals: S2.totals.slice(),
      order: S2.order.slice(),
      procs: clone(S2.procs),
      evicted
    },
    net: {
      floor: 2,
      budget: 9,
      probeBudget: 4,
      degraded,
      probes: {}   /* stage-3 probe surcharges do not carry; stage-4 probes are its own budget */
    },
    emergency: 1,
    floor: [1, 1, 0],
    revealed: (s2state && s2state.revealed) ? s2state.revealed.slice() : []
  };
}

function s4BreakCandidates(s4) {
  const inst = blockAsS1(s4.block);
  const out = [];
  const push = (op) => { if (!out.some((o) => JSON.stringify(o) === JSON.stringify(op))) out.push(op); };
  for (const p of ["N2", "N4"]) {
    const op = { op: "preempt", target: p };
    if (drain(inst, op).drains) push(op);
  }
  if (s4.emergency > 0) {
    for (const r of ["MAGLOCK", "FUEL"]) {
      const op = { op: "inject", target: r };
      if (drain(inst, op).drains) push(op);
    }
  }
  for (const r of Object.keys(s4.block.caps)) {
    let held = 0;
    for (const p in s4.block.procs) held += s4.block.procs[p].alloc[r] || 0;
    if (s4.block.caps[r] - held < 1) continue;
    for (const p of Object.keys(s4.block.procs)) {
      const need = (s4.block.procs[p].max[r] || 0) - (s4.block.procs[p].alloc[r] || 0);
      if (need > 0) {
        const op = { op: "grant", res: r, proc: p };
        if (drain(inst, op).drains) push(op);
      }
    }
  }
  return out;
}

function s4BlockDrain(block) { return drain(blockAsS1(block), null).drains; }

function s4RouteCheck(net, ids) {
  if (!Array.isArray(ids) || !ids.length) return { ok: false, code: "CHAIN" };
  const path = s3Path(ids);
  if (!path) return { ok: false, code: "CHAIN" };
  const byId = {};
  for (const l of S3.links) byId[l.id] = l;
  const capOf = (id) => (net.degraded[id] != null ? net.degraded[id] : s3TrueCap(byId[id]));
  for (const id of path.links) {
    if (!byId[id].up) return { ok: false, code: "DOWN", link: id };
  }
  if (path.nodes.indexOf("gate") < 0) return { ok: false, code: "GATE" };
  let bottleneck = Infinity, bad = null;
  for (const id of path.links) {
    const c = capOf(id);
    if (c < net.floor && bad === null) bad = id;
    bottleneck = Math.min(bottleneck, c);
  }
  if (bottleneck < net.floor) {
    return { ok: false, code: "BANDWIDTH", link: bad, actual: capOf(bad), floor: net.floor };
  }
  let cost = 0;
  for (const id of path.links) cost += byId[id].cost + ((net.probes && net.probes[id]) || 0);
  if (cost > net.budget) return { ok: false, code: "COST", actual: cost, budget: net.budget };
  return { ok: true, cost, bottleneck };
}

function s4Validate(s4, ops) {
  const fail = (i, code, msg, extra) =>
    Object.assign({ ok: false, failedAt: i, code, msg: msg || code }, extra || {});
  if (!Array.isArray(ops) || ops.length < 2) return fail(0, "SHAPE", "plan must contain operations ending in seal");
  const last = ops[ops.length - 1];
  if (!last || last.op !== "seal") {
    return fail(ops.length - 1, "SEAL", "seal must be the final operation");
  }

  const block = clone(s4.block);
  const mntResident = !s4.sched.evicted;
  let breakDone = false, injectUsed = 0, ran = false, routed = false;
  let evictedNow = s4.sched.evicted;

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (i === ops.length - 1) { /* seal */
      if (!breakDone || !ran || !routed) {
        return fail(i, "SEAL", "facility incomplete: resolve dependency, run scheduler, restore route before sealing");
      }
      return { ok: true };
    }
    switch (op.op) {
      case "preempt": {
        if (!block.procs[op.proc]) return fail(i, "OP", "unknown process " + String(op.proc));
        if (breakDone) return fail(i, "BREAK", "dependency block already resolved");
        const nxt = clone(block);
        nxt.dead.push(op.proc);
        if (!s4BlockDrain(nxt)) return fail(i, "BREAK", "preempting " + op.proc + " does not resolve the dependency block");
        block.dead.push(op.proc);
        breakDone = true;
        break;
      }
      case "inject": {
        if (op.res !== "MAGLOCK" && op.res !== "FUEL") return fail(i, "OP", "unknown resource " + String(op.res));
        if (injectUsed >= (s4.emergency || 0)) return fail(i, "INJECT", "emergency reserve holds a single spare instance");
        const nxt = clone(block);
        nxt.caps[op.res] += 1;
        if (!s4BlockDrain(nxt)) return fail(i, "BREAK", "injecting " + op.res + " does not resolve the dependency block");
        block.caps[op.res] += 1;
        injectUsed += 1;
        breakDone = true;
        break;
      }
      case "grant": {
        const { res, proc } = op;
        if (!block.procs[proc] || block.caps[res] === undefined) return fail(i, "OP", "unknown grant target");
        if (breakDone) return fail(i, "BREAK", "dependency block already resolved");
        const nxt = clone(block);
        const held = nxt.procs[proc].alloc[res] || 0;
        let pool = nxt.caps[res];
        for (const p in nxt.procs) pool -= nxt.procs[p].alloc[res] || 0;
        const need = (nxt.procs[proc].max[res] || 0) - held;
        if (need <= 0 || pool < 1) return fail(i, "BREAK", "no free " + res + " instance available for " + proc);
        nxt.procs[proc].alloc[res] = held + 1;
        if (!s4BlockDrain(nxt)) return fail(i, "BREAK", "granting " + res + " to " + proc + " does not resolve the dependency block");
        block.procs[proc].alloc[res] = held + 1;
        breakDone = true;
        break;
      }
      case "evict": {
        if (!mntResident || evictedNow) return fail(i, "EVICT", "custodial hold is not resident");
        evictedNow = true;
        break;
      }
      case "run": {
        if (!breakDone) return fail(i, "INTERLOCK", "boot interlock: dependency block must be resolved first");
        if (ran) return fail(i, "DUP", "scheduler run already queued");
        const residents = s2Residents(s4.sched, evictedNow);
        if (!Array.isArray(op.seq) || op.seq.length !== residents.length ||
            new Set(op.seq).size !== op.seq.length || op.seq.some((p) => residents.indexOf(p) < 0)) {
          return fail(i, "SHAPE", "run order must contain each resident process exactly once");
        }
        const r = s2Safety(op.seq, s4.sched, evictedNow, s4.floor, null);
        if (!r.ok) {
          if (r.code === "SHAPE") return fail(i, "SHAPE", "run order does not match resident set");
          return fail(i, r.code, r.code === "FLOOR"
            ? "reserve floor violated at step " + (r.failedAt + 1) + " (" + r.proc + ")"
            : "unsafe at step " + (r.failedAt + 1) + " (" + r.proc + " short " + JSON.stringify(r.deficit) + ")",
          { step: r.failedAt, proc: r.proc, deficit: r.deficit });
        }
        ran = true;
        break;
      }
      case "route": {
        if (routed) return fail(i, "DUP", "route already restored");
        const r = s4RouteCheck(s4.net, op.links);
        if (!r.ok) {
          const msgs = {
            CHAIN: "links do not form a simple entry→core chain",
            DOWN: "link " + r.link + " is down",
            GATE: "route must pass SEC-GATE",
            BANDWIDTH: "bandwidth floor missed at " + r.link + " (actual " + r.actual + ", floor " + r.floor + ")",
            COST: "route costs " + r.actual + " fuel, budget is " + r.budget
          };
          return fail(i, r.code, msgs[r.code], { link: r.link, actual: r.actual });
        }
        routed = true;
        break;
      }
      default:
        return fail(i, "OP", "unknown operation " + String(op.op));
    }
  }
  return fail(ops.length - 1, "SEAL", "seal must be the final operation");
}

function s4ValidPlans(s4) {
  const plans = [];
  const seen = new Set();
  const breaks = s4BreakCandidates(s4);
  const routes = (function () {
    const all = s3AllPaths();
    return all.map((p) => p.links).filter((ids) => s4RouteCheck(s4.net, ids).ok);
  })();
  const evictOptions = (!s4.sched.evicted) ? [true, false] : [false];
  for (const ev of evictOptions) {
    const effEvicted = ev || s4.sched.evicted;
    const seqs = s2AllSafe(s4.sched, effEvicted, s4.floor);
    for (const seq of seqs) {
      for (const br of breaks) {
        for (const route of routes) {
          if (plans.length >= 64) return plans;
          const toPlanOp = (o) =>
            o.op === "preempt" ? { op: "preempt", proc: o.target } :
            o.op === "inject" ? { op: "inject", res: o.target } : clone(o);
          const ops = [toPlanOp(br)]
            .concat((ev && !s4.sched.evicted) ? [{ op: "evict" }] : [])
            .concat([{ op: "run", seq: seq.slice() }, { op: "route", links: route.slice() }, { op: "seal" }]);
          const key = JSON.stringify(ops);
          if (seen.has(key)) continue;
          seen.add(key);
          const r = s4Validate(s4, ops);
          if (r.ok) plans.push(ops);
        }
      }
    }
  }
  return plans;
}

module.exports = {
  FLAG,
  S1, S2, S3,
  s1Drain, s1WaitCycles, s1ValidRecoveries, s1Trial, s1View,
  s2Avail, s2Residents, s2Safety, s2AllSafe, s2CachedMax, s2Max,
  s3Effective, s3TrueCap, s3Validate, s3ValidRoutes, s3View, s3Path, s3AllPaths,
  deriveS4, s4BreakCandidates, s4Validate, s4ValidPlans, s4RouteCheck
};
