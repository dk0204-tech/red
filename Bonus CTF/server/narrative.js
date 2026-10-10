/* ============================================================================
 * THE DEADLOCK ENGINE: BLACKOUT PROTOCOL — narrative content
 * Briefings, objectives, hints, tutorial, transmissions. Server-sourced so
 * the client never hard-codes rules or answers.
 * ==========================================================================*/
"use strict";

const STAGE_TITLES = {
  1: "GHOST IN THE RESOURCE GRAPH",
  2: "THE UNSAFE SCHEDULER",
  3: "THE MOVING NETWORK",
  4: "BLACKOUT PROTOCOL"
};

const OBJECTIVES = {
  1: "Map the facility's resource graph, separate the real deadlock from the apparent cycle, and submit a recovery action that lets every process finish.",
  2: "Determine the scheduler's true claim matrix and test an execution order that never starves the pool.",
  3: "Probe the damaged network selectively and restore a route from INGRESS to CORE through SEC-GATE within floor and fuel limits.",
  4: "Compose a complete recovery plan — dependency, scheduler, route, seal — against the live state you created."
};

const BRIEFINGS = {
  1: {
    title: "CONTROL INTERFACE // RECOVERY DESK",
    body: [
      "The engine has not shut down. It is waiting for a decision.",
      "Every subsystem of this facility is a PROCESS holding RESOURCES and claiming more. The maintenance log calls the stall a deadlock — but the schematic in front of you disagrees with itself. Some cycles in the wait-for graph can never be deadlocks; some deadlocks wear no cycle you can see at a glance.",
      "You are given a resource-allocation model and a diagnostic budget. Read it, experiment inside it, and hand the engine a recovery it can verify."
    ],
    rules: [
      "Each resource type has a fixed number of instances (CAPACITY). Processes hold instances; free instances sit in the pool.",
      "A process is BLOCKED while any claim it still needs has zero free instances.",
      "A set is DEADLOCKED when no possible sequence of grants and releases ever lets its members finish.",
      "A cycle in the wait-for graph is necessary for deadlock — it is not sufficient when a resource has multiple instances or an outside holder can still finish.",
      "Preempting a process force-releases everything it holds. Injecting a resource adds one emergency instance to the pool.",
      "The schematic shows every WAITING relationship. Capacities and holdings are hidden until you INSPECT a node (each inspection spends budget).",
      "TRIAL simulates a candidate intervention on a copy of the system and reports only whether the system drains — not who was stuck.",
      "The recovery you submit is validated against the authoritative model, not against a list of approved answers: any intervention that truly unblocks every process is accepted."
    ]
  },
  2: {
    title: "SCHEDULER SUBSYSTEM // CLAIM MATRIX",
    body: [
      "Stage-one recovery registered. The scheduler console unlocks.",
      "The line can only run in a SAFE order: at every step, each process's remaining claim must fit the pool, so no sequence of completions can starve the system.",
      "Some claim rows are missing — telemetry marked them unverified, and the cached snapshot on the console is stale. Convince yourself of the true numbers, then hand the scheduler an order it can execute."
    ],
    rules: [
      "ALLOCATION and AVAILABLE are authoritative and visible. MAX claims marked VERIFIED are trusted; rows shown as — must be inspected to reveal the true values.",
      "A cached claim row, when shown, is labeled CACHED. It may overstate a claim; verified rows always supersede cached ones.",
      "A sequence is SAFE iff, running in that order from the current pool, every process's remaining claim is satisfiable before it runs.",
      "Every failed test returns the first failing step and the exact shortfall per resource — nothing about later steps.",
      "The custodial rig MNT holds COOLANT 2 and BUS 1. You may EVICT it: its hold returns to the pool and it leaves the resident set permanently for this session.",
      "ANY order that passes the safety check is a valid recovery. There is no single canonical answer."
    ]
  },
  3: {
    title: "ROUTING SUBSYSTEM // DAMAGED NETWORK",
    body: [
      "Scheduler recovered. The routing subsystem is yours to repair.",
      "Traffic must move from INGRESS to CORE through SEC-GATE. Links carry class capacities, but several trunks are marked ⚠ SUSPECT — class is a claim, not a measurement. PROBING a link measures it for real, and measurement draws standby power: every probe adds +1 fuel cost to that link, permanently.",
      "Stay at or above the bandwidth floor and inside the fuel budget."
    ],
    rules: [
      "Route requirements: simple path INGRESS→CORE, every link UP, must traverse SEC-GATE, bottleneck bandwidth ≥ 3, total fuel cost ≤ 10.",
      "Class capacities: TRUNK 4, BRANCH 3, SPUR 2 — except links marked ⚠ SUSPECT, whose real capacity is hidden until probed and may be far below class.",
      "Each probe reveals that link's true capacity and adds +1 fuel to it. Probe budget: 8. Probing never changes true capacity.",
      "A rejected route tells you which constraint failed (down / gate / bandwidth with actual capacity / fuel overrun)."
    ]
  },
  4: {
    title: "BLACKOUT PROTOCOL // FINAL RECOVERY",
    body: [
      "You are close. The engine now asks for one plan against the state YOUR decisions created.",
      "Your stage-one recovery changed what sits in the bay. Your custodial decision changed the scheduler's pool. Your stage-3 route now carries restoration traffic — every link on it has dropped one capacity tier. The network floor is lower now (2), but so is the fuel budget (9).",
      "The blackout reserve withholds COOLANT ≥ 1 and BUS ≥ 1 from circulation at all times — factor the floor into the run order.",
      "Build the plan, submit it, and the facility either restores or tells you the first operation that fails."
    ],
    rules: [
      "Plan operations, in order: resolve the dependency block (PREEMPT / INJECT / GRANT), optionally EVICT the custodial rig, RUN a safe order, RESTORE a route, then SEAL.",
      "BOOT INTERLOCK: the dependency block must be resolved before any RUN. The cross-held MAGLOCK/FUEL pair on the final boot is N2 and N4.",
      "The emergency reserve holds exactly ONE spare instance per plan (choose MAGLOCK or FUEL). A spare carried over from a stage-1 INJECT is already in the bay — grant it instead.",
      "RUN safety includes the reserve floor: after every step the pool must keep COOLANT ≥ 1 and BUS ≥ 1.",
      "ROUTE in this stage: path INGRESS→CORE via SEC-GATE, all links up, bottleneck ≥ 2, fuel ≤ 9; links from your stage-3 route are degraded by one tier; each stage-4 probe adds +1 fuel (budget 4).",
      "SEAL must be the final operation and requires block resolved, scheduler run, and route restored.",
      "Invalid plans never corrupt state: the engine reports the failing operation index and reason, and your session keeps its progress."
    ]
  }
};

const HINTS = {
  1: [
    "A cycle in a wait-for graph is not automatically a deadlock. Look for a resource in the cycle whose instances can still come free from OUTSIDE the cycle.",
    "Deadlock needs a closed set: every instance of the resources the blocked pair waits on must be held inside that pair. Inspect the capacities of the single-instance resources and who holds them — and remember that a blocked pair whose waits can be satisfied from a free or soon-released instance was never deadlocked.",
    "P2 and P4 cross-hold MAGLOCK and FUEL: one instance each, each waiting for the other's, no outside holder. Break the set — preempt P2 or P4, or inject a spare MAGLOCK or FUEL. Anything else leaves the system stalled."
  ],
  2: [
    "Cached telemetry is marked unverified for a reason. Inspect any row you plan to rely on — a stale claim can make a valid order look impossible.",
    "Start from the process whose remaining claim fits the available pool, then let its release fund the next. The custodial rig's hold is evictable if the pool is too tight.",
    "ASM fits immediately; PNT fits next; after that WLD, CNC and INJ cascade. With or without evicting MNT there are multiple safe orders — any one the safety check accepts counts."
  ],
  3: [
    "⚠ links show class capacity, not real capacity. SEC-GATE sits on every route, so one probe there buys certainty for +1 fuel.",
    "The b1–b2–corridor to the gate costs 8 fuel with margin to spare; the a1–a2 trunk uses the budget exactly — and probing anything on your chosen path raises its cost.",
    "Two corridors clear the floor: INGRESS→A1→A2→GATE→CORE (cost 10) and INGRESS→B1→B2→GATE→CORE (cost 8). If you probe a link on the first one, it no longer fits."
  ],
  4: [
    "The reserve is real: COOLANT ≥ 1 and BUS ≥ 1 stay out of circulation. If the pool starts at [1,1,0], no order fits until the custodial hold is evicted.",
    "Stage 1 wrote into the bay: injected spares exist as free instances you can GRANT; preempted recoveries leave none. Stage 3 wrote into the network: your old route is degraded, and the fuel budget is now 9.",
    "Order of operations: resolve N2/N4 (preempt one, or grant/inject a spare), evict MNT if still resident, run a floor-safe order (ASM, PNT, WLD, CNC, INJ works), restore a route that fits cost 9 — then SEAL."
  ]
};

const TUTORIAL = [
  { id: "select", text: "Select any node in the facility view to open its inspector." },
  { id: "inspect", text: "Press INSPECT to reveal hidden properties — inspections spend your diagnostic budget." },
  { id: "experiment", text: "Press TRIAL to simulate a candidate intervention. The engine reports only whether the system drains." },
  { id: "submit", text: "When you are confident, submit the recovery. The backend validates it against the live model." }
];

const STAGE_CLEAR = {
  1: "Dependency deadlock broken. A verified recovery is recorded — SCHEDULER SUBSYSTEM unlocked.",
  2: "Safe order accepted. Routing subsystem unlocked.",
  3: "Route verified and activated. The final recovery engine is online.",
  4: "Protocol accepted. Facility restoration sequence engaged."
};

const TRANSMISSION =
  "CENTRAL ATRIUM RELAY // FINAL TRANSMISSION — The operators never came back because there was no one left to come back to. " +
  "You rebuilt the graph, the scheduler, and the route because you understood what the system was waiting for: not a command, but a decision that respected every constraint it had. " +
  "The facility is yours now. The system is no longer waiting.";

const CODE_EXPLAIN = {
  DEADLOCK: "The intervention does not unblock every process — the simulation still ends with stalled processes.",
  SHAPE: "The submitted structure is wrong: missing, duplicated, or unknown elements.",
  UNSAFE: "The order is unsafe: some process cannot be granted its remaining claim before it runs.",
  FLOOR: "The blackout reserve would be violated — keep COOLANT ≥ 1 and BUS ≥ 1 available after every step.",
  INTERLOCK: "Boot interlock: resolve the dependency block before running the scheduler.",
  BREAK: "That operation does not resolve the dependency block.",
  INJECT: "The emergency reserve holds a single spare instance per plan.",
  EVICT: "The custodial hold is not resident (already evicted in stage 2).",
  DUP: "That operation is already in the plan.",
  OP: "Unknown operation — check the plan builder.",
  SEAL: "SEAL must come last and requires block resolved, run completed, and route restored.",
  CHAIN: "Links do not form a simple INGRESS→CORE chain.",
  DOWN: "The named link is down.",
  GATE: "The route must traverse SEC-GATE.",
  BANDWIDTH: "Bottleneck bandwidth is below the floor — probe suspect links to see true capacity.",
  COST: "The route exceeds the fuel budget — probes on your path add +1 each.",
  STILL_DEADLOCKED: "Same as above: the system still ends stalled."
};

module.exports = {
  STAGE_TITLES, OBJECTIVES, BRIEFINGS, HINTS, TUTORIAL,
  STAGE_CLEAR, TRANSMISSION, CODE_EXPLAIN
};
