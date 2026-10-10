/* ============================================================================
 * THE DEADLOCK ENGINE: BLACKOUT PROTOCOL — session store & dispatcher
 *
 * All progress lives here, server-side, keyed by a signed random session id.
 * This directory is never served. Dispatch enforces, in order:
 *   ver token -> schema -> spacing -> stage gate -> budget -> action.
 * Budgets and spacing are PER SESSION; the only per-IP controls are the
 * service-level token buckets (anti-DoS, generous, documented).
 * ==========================================================================*/
"use strict";
const crypto = require("crypto");
const eng = require("./engine");
const narr = require("./narrative");

const SECRET = process.env.DEADLOCK_SECRET ||
  crypto.randomBytes(32).toString("hex");
const FLAG = eng.FLAG;              /* server-side only, never in any view */

/* ------------------------------------------------------------- limits ---- */
const LIMITS = {
  budget: {
    s1Inspect: 10, s1Trial: 3, s1Recover: 5,
    s2Inspect: 5, s2Evict: 1, s2Test: 10,
    s3Probe: 8, s3Route: 6,
    s4Plan: 8, flag: 8
  },
  spacing: {
    "s1.recover": 1100, "s2.evict": 1100, "s2.test": 1100,
    "s3.route": 1100, "s4.plan": 1100, "flag": 1100, "reset": 5000
  },
  hintSpacing: 3000,
  rate: {
    session: { rate: 40, burst: 80 },
    ip: { rate: 100, burst: 300 }
  }
};

/* ------------------------------------------------------------- sessions -- */
const sessions = new Map();
const events = [];
const ipBuckets = new Map();

const sign = (sid) =>
  crypto.createHmac("sha256", SECRET).update(sid).digest("hex");

function fresh(sid) {
  return {
    sid, created: Date.now(),
    ver: 0, stage: 1, solved: false, sealed: false,
    s1: { revealed: [], inspects: 0, trials: 0, recover: 0, fails: 0, outcome: null },
    s2: { revealed: ["CNC", "INJ"], inspects: 0, evict: 0, tests: 0,
          evicted: false, fails: 0, safe: false },
    s3: { probeMap: {}, probeCount: 0, route: null, routeTries: 0, fails: 0, activated: false },
    s4: { state: null, plans: 0, fails: 0 },
    flagTries: 0,
    hintKeys: {}, spacing: {}, actions: [],
    tutorial: 0, briefings: {},
    rate: { tokens: LIMITS.rate.session.burst, ts: Date.now() }
  };
}

function create() {
  const sid = crypto.randomBytes(20).toString("hex");
  const s = fresh(sid);
  sessions.set(sid, s);
  return { session: s, cookie: sid + "." + sign(sid) };
}

function verify(value) {
  if (typeof value !== "string") return null;
  const i = value.indexOf(".");
  if (i <= 0) return null;
  const sid = value.slice(0, i);
  const sig = value.slice(i + 1);
  const expect = sign(sid);
  if (sig.length !== expect.length) return null;
  let ok = true;
  for (let k = 0; k < sig.length; k++) if (sig[k] !== expect[k]) ok = false;
  if (!ok) return null;
  return sessions.get(sid) || null;
}

/* -------------------------------------------------------- rate limiting -- */
function refill(b, rate, burst, now) {
  const bkt = b || { tokens: burst, ts: now };
  bkt.tokens = Math.min(burst, bkt.tokens + ((now - bkt.ts) / 1000) * rate);
  bkt.ts = now;
  return bkt;
}
function rate(session, ip) {
  const now = Date.now();
  const sb = refill(session.rate, LIMITS.rate.session.rate,
    LIMITS.rate.session.burst, now);
  if (sb.tokens < 1) { session.rate = sb; return false; }
  sb.tokens -= 1;
  session.rate = sb;
  const ib = refill(ipBuckets.get(ip), LIMITS.rate.ip.rate,
    LIMITS.rate.ip.burst, now);
  if (ib.tokens < 1) return false;
  ib.tokens -= 1;
  ipBuckets.set(ip, ib);
  if (ipBuckets.size > 500) {
    for (const [k, v] of ipBuckets) if (now - v.ts > 60000) ipBuckets.delete(k);
  }
  return true;
}

/* --------------------------------------------------------------- audit --- */
function ev(sid, type, code) {
  events.push({ t: Date.now(), sid: sid.slice(0, 6), type, code });
  if (events.length > 500) events.shift();
}
function act(s, type, ok, code) {
  s.actions.push({ t: Date.now(), type, ok, code: code || (ok ? "OK" : "ERR") });
  if (s.actions.length > 12) s.actions.shift();
}
const _debugEvents = () => events.slice();

/* -------------------------------------------------------------- views ---- */
function b(id, used, max, label) { return { id, used, max, label }; }
function budgetsOf(s) {
  if (s.stage === 1) return [
    b("s1.inspect", s.s1.inspects, LIMITS.budget.s1Inspect, "INSPECTIONS"),
    b("s1.trial", s.s1.trials, LIMITS.budget.s1Trial, "TRIALS"),
    b("s1.recover", s.s1.recover, LIMITS.budget.s1Recover, "RECOVERY ATTEMPTS")
  ];
  if (s.stage === 2) return [
    b("s2.inspect", s.s2.inspects, LIMITS.budget.s2Inspect, "CLAIM INSPECTIONS"),
    b("s2.evict", s.s2.evict, LIMITS.budget.s2Evict, "EVICTIONS"),
    b("s2.test", s.s2.tests, LIMITS.budget.s2Test, "SEQUENCE TESTS")
  ];
  if (s.stage === 3) return [
    b("s3.probe", s.s3.probeCount, LIMITS.budget.s3Probe, "PROBES"),
    b("s3.route", s.s3.routeTries, LIMITS.budget.s3Route, "ROUTE SUBMISSIONS")
  ];
  return [
    b("s4.plan", s.s4.plans, LIMITS.budget.s4Plan, "PLAN SUBMISSIONS"),
    b("flag", s.flagTries, LIMITS.budget.flag, "FLAG SEAL")
  ];
}

function s2View(s) {
  return {
    types: eng.S2.types,
    avail: eng.s2Avail(eng.S2, s.s2.evicted),
    evicted: s.s2.evicted,
    safe: s.s2.safe,
    procs: eng.S2.order.map((pid) => {
      const p = eng.S2.procs[pid];
      const custodial = !!p.custodial;
      const revealed = custodial || s.s2.revealed.indexOf(pid) >= 0;
      const max = revealed ? p.max.slice() : null;
      return {
        id: pid, label: p.label, alloc: p.alloc.slice(), custodial,
        max, verified: !!max,
        need: max ? max.map((v, i) => v - p.alloc[i]) : null,
        evicted: custodial && s.s2.evicted
      };
    }),
    cached: eng.s2CachedMax()
  };
}

function s4View(s) {
  const s4 = s.s4.state;
  const block = { caps: {}, procs: [], dead: s4.block.dead.slice() };
  for (const r of ["MAGLOCK", "FUEL"]) {
    let held = 0;
    for (const pid in s4.block.procs) held += s4.block.procs[pid].alloc[r] || 0;
    block.caps[r] = { cap: s4.block.caps[r], held, free: s4.block.caps[r] - held };
  }
  for (const pid of Object.keys(s4.block.procs)) {
    const p = s4.block.procs[pid];
    const need = {};
    for (const r of ["MAGLOCK", "FUEL"]) {
      const n = (p.max[r] || 0) - (p.alloc[r] || 0);
      if (n > 0) need[r] = n;
    }
    block.procs.push({
      id: pid, label: p.label, holds: p.alloc, max: p.max,
      need, dead: s4.block.dead.indexOf(pid) >= 0
    });
  }
  const sched = {
    types: s4.sched.types,
    avail: eng.s2Avail(s4.sched, s.s2.evicted),
    floor: s4.floor,
    evicted: s.s2.evicted,
    procs: s4.sched.order.map((pid) => {
      const p = s4.sched.procs[pid];
      const custodial = !!p.custodial;
      return {
        id: pid, label: p.label, alloc: p.alloc.slice(), custodial,
        max: p.max.slice(), verified: true,
        need: p.max.map((v, i) => v - p.alloc[i]),
        evicted: custodial && s.s2.evicted
      };
    })
  };
  const net = eng.s3View(s4.net.probes, { probeBudget: s4.net.probeBudget });
  net.floor = s4.net.floor;
  net.budget = s4.net.budget;
  net.degraded = s4.net.degraded;
  net.route = s.s3.route;
  net.links = net.links.map((l) => {
    const d = s4.net.degraded[l.id];
    if (d != null) { l.cap = d; l.degraded = true; l.unverified = false; }
    return l;
  });
  return { block, sched, net, emergency: s4.emergency };
}

function stateOf(s) {
  const out = {
    ok: true, ver: s.ver, stage: s.stage, solved: s.solved, sealed: s.sealed,
    stageTitle: narr.STAGE_TITLES[s.stage],
    objective: narr.OBJECTIVES[s.stage],
    budgets: budgetsOf(s),
    tutorial: { step: s.tutorial, done: s.tutorial >= narr.TUTORIAL.length,
                steps: narr.TUTORIAL },
    actions: s.actions
  };
  if (s.stage === 1) {
    Object.assign(out, eng.s1View(eng.S1, new Set(s.s1.revealed)));
    out.recovered = !!s.s1.outcome;
  } else if (s.stage === 2) {
    out.sched = s2View(s);
  } else if (s.stage === 3) {
    out.net = eng.s3View(s.s3.probeMap, { probeBudget: LIMITS.budget.s3Probe });
    out.net.route = s.s3.route;
    out.net.activated = s.s3.activated;
  } else if (s.stage === 4 && s.s4.state) {
    Object.assign(out, s4View(s));
    out.stage1Outcome = s.s1.outcome;
  }
  return out;
}

/* ------------------------------------------------------------ dispatch ---- */
function failsOf(s, stage) {
  if (stage === 1) return s.s1.fails;
  if (stage === 2) return s.s2.fails;
  if (stage === 3) return s.s3.fails;
  return s.s4.fails;
}

function get(s, pathname, query) {
  if (pathname === "/api/state") return { status: 200, json: stateOf(s) };
  if (pathname === "/api/briefing") {
    const bb = narr.BRIEFINGS[s.stage];
    return {
      status: 200,
      json: {
        stage: s.stage, title: bb.title, body: bb.body, rules: bb.rules,
        objective: narr.OBJECTIVES[s.stage],
        stageTitle: narr.STAGE_TITLES[s.stage],
        stageClear: s.stage > 1 ? narr.STAGE_CLEAR[s.stage - 1] : null,
        codeExplain: narr.CODE_EXPLAIN
      }
    };
  }
  if (pathname === "/api/hint") {
    const stage = parseInt(query.stage, 10);
    const level = parseInt(query.level, 10);
    if (!(stage >= 1 && stage <= 4) || !(level >= 1 && level <= 3)) {
      return { status: 400, json: { ok: false, code: "BAD" } };
    }
    if (stage > s.stage) return { status: 403, json: { ok: false, code: "LOCKED", stage: s.stage } };
    const fails = failsOf(s, stage);
    if (level === 2 && fails < 1) {
      return { status: 403, json: { ok: false, code: "GATED", need: 1, have: fails } };
    }
    if (level === 3 && fails < 3) {
      return { status: 403, json: { ok: false, code: "GATED", need: 3, have: fails } };
    }
    const key = "hint:" + stage + ":" + level;
    const last = s.hintKeys[key];
    if (last && Date.now() - last < LIMITS.hintSpacing) {
      return { status: 429, json: { ok: false, code: "SPACING" } };
    }
    s.hintKeys[key] = Date.now();
    act(s, "hint.l" + level, true);
    ev(s.sid, "hint", "L" + level);
    return { status: 200, json: { stage, level, text: narr.HINTS[stage][level - 1] } };
  }
  return { status: 404, json: { ok: false, code: "NOPE" } };
}

function post(s, pathname, body) {
  const fail = (status, code, extra) => ({
    status, json: Object.assign({ ok: false, code }, extra || {})
  });

  if (!body || typeof body !== "object" || Array.isArray(body)) return fail(400, "PARSE");
  if (typeof body.ver !== "number") return fail(400, "NOVER");
  if (body.ver !== s.ver) return fail(409, "STALE", { ver: s.ver });

  const spacingId = pathname.slice(5).replace(/\//g, ".");
  const spacingMs = LIMITS.spacing[spacingId];
  const gateStage = {
    "/api/s1/inspect": 1, "/api/s1/trial": 1, "/api/s1/recover": 1,
    "/api/s2/inspect": 2, "/api/s2/evict": 2, "/api/s2/test": 2,
    "/api/s3/probe": 3, "/api/s3/route": 3,
    "/api/s4/plan": 4
  }[pathname];

  /* ---- schema ---- */
  let charge = null;   /* [object, key, max] */
  let schemaErr = null;
  if (pathname === "/api/ack") {
    if (body.kind !== "briefing" && body.kind !== "tutorial") schemaErr = fail(400, "BAD");
  } else if (pathname === "/api/s1/inspect") {
    if (typeof body.target !== "string" || !/^(R[1-5]|P[1-6])$/.test(body.target)) schemaErr = fail(400, "BAD");
    else charge = [s.s1, "inspects", LIMITS.budget.s1Inspect];
  } else if (pathname === "/api/s1/trial") {
    if ((body.op !== "preempt" && body.op !== "inject") ||
        (typeof body.target !== "string") ||
        (body.op === "preempt" && !/^P[1-6]$/.test(body.target)) ||
        (body.op === "inject" && !/^R[1-5]$/.test(body.target))) schemaErr = fail(400, "BAD");
    else charge = [s.s1, "trials", LIMITS.budget.s1Trial];
  } else if (pathname === "/api/s1/recover") {
    if ((body.op !== "preempt" && body.op !== "inject") ||
        (typeof body.target !== "string") ||
        (body.op === "preempt" && !/^P[1-6]$/.test(body.target)) ||
        (body.op === "inject" && !/^R[1-5]$/.test(body.target))) schemaErr = fail(400, "BAD");
    else charge = [s.s1, "recover", LIMITS.budget.s1Recover];
  } else if (pathname === "/api/s2/inspect") {
    if (typeof body.target !== "string" || eng.S2.order.indexOf(body.target) < 0) schemaErr = fail(400, "BAD");
    else charge = [s.s2, "inspects", LIMITS.budget.s2Inspect];
  } else if (pathname === "/api/s2/evict") {
    charge = [s.s2, "evict", LIMITS.budget.s2Evict];
  } else if (pathname === "/api/s2/test") {
    if (!Array.isArray(body.seq) || body.seq.length < 1 || body.seq.length > 8 ||
        body.seq.some((x) => typeof x !== "string")) schemaErr = fail(400, "BAD");
    else charge = [s.s2, "tests", LIMITS.budget.s2Test];
  } else if (pathname === "/api/s3/probe") {
    if (typeof body.link !== "string" || !eng.S3.link(body.link)) schemaErr = fail(400, "BAD");
    else charge = [s.s3, "probeCount", LIMITS.budget.s3Probe];
  } else if (pathname === "/api/s3/route") {
    if (!Array.isArray(body.links) || body.links.length < 1 || body.links.length > 12 ||
        body.links.some((x) => typeof x !== "string")) schemaErr = fail(400, "BAD");
    else charge = [s.s3, "routeTries", LIMITS.budget.s3Route];
  } else if (pathname === "/api/s4/plan") {
    if (!Array.isArray(body.ops) || body.ops.length < 1 || body.ops.length > 16 ||
        body.ops.some((x) => !x || typeof x !== "object" || typeof x.op !== "string")) schemaErr = fail(400, "BAD");
    else charge = [s.s4, "plans", LIMITS.budget.s4Plan];
  } else if (pathname === "/api/flag") {
    if (typeof body.value !== "string" || body.value.length > 64) schemaErr = fail(400, "BAD");
    else charge = [{ get flagTries() { return s.flagTries; }, set flagTries(v) { s.flagTries = v; } },
      "flagTries", LIMITS.budget.flag];
  } else if (pathname === "/api/reset") {
    if (body.confirm !== true) schemaErr = fail(400, "CONFIRM", { msg: "reset requires confirm:true" });
  } else {
    return fail(404, "NOPE");
  }
  if (schemaErr) return schemaErr;

  /* ---- spacing ---- */
  if (spacingMs) {
    const last = s.spacing[spacingId];
    if (last && Date.now() - last < spacingMs) {
      return fail(429, "SPACING", { retryMs: spacingMs });
    }
  }

  /* ---- stage gate ---- */
  if (gateStage != null && s.stage !== gateStage) {
    return fail(403, "LOCKED", { stage: s.stage });
  }

  /* ---- budget ---- */
  if (charge) {
    const [obj, key, max] = charge;
    if (obj[key] >= max) {
      ev(s.sid, pathname, "BUDGET");
      return fail(429, "BUDGET", { used: obj[key], max });
    }
    obj[key] += 1;
  }
  if (spacingMs) s.spacing[spacingId] = Date.now();

  /* ---- action ---- */
  switch (pathname) {
    case "/api/ack": {
      if (body.kind === "briefing") s.briefings[s.stage] = true;
      else s.tutorial = typeof body.step === "number"
        ? Math.max(s.tutorial, Math.min(body.step, narr.TUTORIAL.length))
        : narr.TUTORIAL.length;
      ev(s.sid, "ack", "OK");
      return { status: 200, json: { ok: true, state: stateOf(s) } };
    }
    case "/api/s1/inspect": {
      if (s.s1.revealed.indexOf(body.target) < 0) s.s1.revealed.push(body.target);
      act(s, "s1.inspect", true);
      ev(s.sid, "s1.inspect", "OK");
      return { status: 200, json: { ok: true, target: body.target, state: stateOf(s) } };
    }
    case "/api/s1/trial": {
      const r = eng.s1Trial(eng.S1.clone(), body.op, body.target);
      act(s, "s1.trial", true, r.drains ? "DRAINS" : "STALL");
      ev(s.sid, "s1.trial", r.drains ? "DRAINS" : "STALL");
      return { status: 200, json: { ok: true, trial: r, state: stateOf(s) } };
    }
    case "/api/s1/recover": {
      const r = eng.s1Drain(eng.S1.clone(), { op: body.op, target: body.target });
      if (r.drains) {
        s.s1.outcome = { op: body.op, target: body.target };
        s.stage = 2;
        s.ver += 1;
        act(s, "s1.recover", true);
        ev(s.sid, "s1.recover", "CLEAR");
        return { status: 200, json: { ok: true, clear: narr.STAGE_CLEAR[1], state: stateOf(s) } };
      }
      s.s1.fails += 1;
      act(s, "s1.recover", false, "DEADLOCK");
      ev(s.sid, "s1.recover", "DEADLOCK");
      return {
        status: 400,
        json: {
          ok: false, code: "DEADLOCK", msg: narr.CODE_EXPLAIN.DEADLOCK,
          trial: { drains: false, stuckCount: r.stuck.length },
          state: stateOf(s)
        }
      };
    }
    case "/api/s2/inspect": {
      if (s.s2.revealed.indexOf(body.target) < 0) s.s2.revealed.push(body.target);
      act(s, "s2.inspect", true);
      ev(s.sid, "s2.inspect", "OK");
      return { status: 200, json: { ok: true, target: body.target, max: eng.s2Max(body.target, new Set(s.s2.revealed)), state: stateOf(s) } };
    }
    case "/api/s2/evict": {
      if (s.s2.evicted) return fail(400, "GONE", { msg: "custodial hold already evicted" });
      s.s2.evicted = true;
      s.ver += 1;
      act(s, "s2.evict", true);
      ev(s.sid, "s2.evict", "OK");
      return { status: 200, json: { ok: true, state: stateOf(s) } };
    }
    case "/api/s2/test": {
      const r = eng.s2Safety(body.seq, eng.S2, s.s2.evicted, null, null);
      if (r.ok) {
        s.s2.safe = true;
        s.stage = 3;
        s.ver += 1;
        act(s, "s2.test", true);
        ev(s.sid, "s2.test", "CLEAR");
        return { status: 200, json: { ok: true, clear: narr.STAGE_CLEAR[2], state: stateOf(s) } };
      }
      s.s2.fails += 1;
      act(s, "s2.test", false, r.code);
      ev(s.sid, "s2.test", r.code);
      return {
        status: 400,
        json: {
          ok: false, code: r.code, failedAt: r.failedAt, proc: r.proc,
          deficit: r.deficit, msg: narr.CODE_EXPLAIN[r.code] || r.code,
          state: stateOf(s)
        }
      };
    }
    case "/api/s3/probe": {
      const link = eng.S3.link(body.link);
      if (!s.s3.probeMap[body.link]) s.s3.probeMap[body.link] = 1;
      act(s, "s3.probe", true);
      ev(s.sid, "s3.probe", "OK");
      return {
        status: 200,
        json: {
          ok: true,
          probe: { id: link.id, cap: eng.s3TrueCap(link), cost: link.cost + 1 },
          state: stateOf(s)
        }
      };
    }
    case "/api/s3/route": {
      const r = eng.s3Validate(body.links, s.s3.probeMap);
      if (r.ok) {
        s.s3.route = r.path;
        s.s3.activated = true;
        s.stage = 4;
        s.s4.state = eng.deriveS4(
          { outcome: s.s1.outcome },
          { evicted: s.s2.evicted, revealed: s.s2.revealed },
          { route: r.path, probes: s.s3.probeMap });
        s.ver += 1;
        act(s, "s3.route", true);
        ev(s.sid, "s3.route", "CLEAR");
        return { status: 200, json: { ok: true, clear: narr.STAGE_CLEAR[3], state: stateOf(s) } };
      }
      s.s3.fails += 1;
      act(s, "s3.route", false, r.code);
      ev(s.sid, "s3.route", r.code);
      return {
        status: 400,
        json: {
          ok: false, code: r.code, link: r.link, actual: r.actual,
          budget: r.budget, floor: r.floor,
          msg: narr.CODE_EXPLAIN[r.code] || r.code,
          state: stateOf(s)
        }
      };
    }
    case "/api/s4/plan": {
      const r = eng.s4Validate(s.s4.state, body.ops);
      if (r.ok) {
        s.solved = true;
        s.ver += 1;
        act(s, "s4.plan", true);
        ev(s.sid, "s4.plan", "CLEAR");
        return {
          status: 200,
          json: {
            ok: true, flag: FLAG, transmission: narr.TRANSMISSION,
            clear: narr.STAGE_CLEAR[4], state: stateOf(s)
          }
        };
      }
      s.s4.fails += 1;
      act(s, "s4.plan", false, r.code);
      ev(s.sid, "s4.plan", r.code);
      return {
        status: 400,
        json: Object.assign({
          ok: false, code: r.code, failedAt: r.failedAt, msg: r.msg,
          state: stateOf(s)
        }, r.step != null ? { step: r.step, proc: r.proc, deficit: r.deficit } : {},
           r.link ? { link: r.link, actual: r.actual } : {})
      };
    }
    case "/api/flag": {
      const uniform = { code: "FLAG", msg: "Transmission not authorized." };
      if (!s.solved || body.value !== FLAG) {
        ev(s.sid, "flag", "REJECT");
        return fail(400, "FLAG", { msg: uniform.msg });
      }
      s.sealed = true;
      s.ver += 1;
      ev(s.sid, "flag", "SEALED");
      act(s, "flag", true, "SEALED");
      return { status: 200, json: { ok: true, sealed: true, state: stateOf(s) } };
    }
    case "/api/reset": {
      const ver = s.ver;
      const rate = s.rate;
      const sid = s.sid;
      const keep = { sid, created: s.created, rate };
      const reset = fresh(sid);
      reset.created = keep.created;
      reset.rate = keep.rate;
      reset.ver = ver + 1;
      for (const k of Object.keys(s)) delete s[k];
      Object.assign(s, reset);
      ev(s.sid, "reset", "OK");
      return { status: 200, json: { ok: true, state: stateOf(s) } };
    }
    default:
      return fail(404, "NOPE");
  }
}

function dispatch(s, method, pathname, query, body) {
  if (method === "GET") return get(s, pathname, query || {});
  if (method === "POST") return post(s, pathname, body);
  return { status: 405, json: { ok: false, code: "METHOD" } };
}

module.exports = {
  create, verify, dispatch, stateOf, rate,
  _debugEvents, LIMITS, FLAG
};
