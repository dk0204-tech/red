# SOLUTION.md — THE DEADLOCK ENGINE: BLACKOUT PROTOCOL

**Flag:** `RZ{blackout_protocol_quiesce}` (override with env `DEADLOCK_FLAG`)
**Reference solve:** `node _organizer/solve.js` (spawns its own server; `BASE_URL=` to target a running one)

All four stages accept *any* solution that the authoritative model validates —
the steps below are one valid path, not the only path.

---

## Stage 1 — Ghost in the Resource Graph

**Setup:** 6 processes, 5 resource types. Capacities/holdings are hidden until
INSPECT (budget 10). TRIAL (budget 3) reports only *drains / stalled + stuck
count*. RECOVERY (budget 5) is validated against a real drain simulation.

**The trap:** P5 → R2 → P6 → R5 is a visible cycle but **not** the deadlock
(R2 has a second instance held by P3, who can finish; R5 likewise).

**The real deadlock:** P2 holds R3 (MAGLOCK, cap 1) waiting for R4 (FUEL, cap 1),
which is held by P4 waiting for R3. No outside holder, single instances —
a closed set. The stuck set is exactly {P2, P4}.

**Valid recoveries (exactly 4):**
- `PREEMPT P2` or `PREEMPT P4` (releases their hold, breaks the set)
- `INJECT R3` or `INJECT R4` (adds the missing instance)

Everything else stalls: preempting P1/P3/P5, injecting R1/R2/R5.

**Hint ladder:** L1 free; L2 after ≥1 failed recovery; L3 after ≥3.

## Stage 2 — The Unsafe Scheduler

Banker's-model check. ALLOC + AVAILABLE are trusted; MAX rows show `—` until
INSPECTED (budget 5). The **CACHED WLD row `[4,2,1]` is stale** — it
overstates the claim; the true max is `[3,2,1]` (inspect it).

- Available: `[1,1,0]` (COOLANT, BUS, CYCLE).
- MNT is CUSTODIAL: **EVICT** returns its hold `[2,1,0]` to the pool and
  removes it permanently (budget 1).
- TEST budget 10; a failure returns first failing step + exact per-resource
  deficit.

**Valid answers:** *any* order the safety check accepts. With eviction:
`ASM → PNT → WLD → CNC → INJ` (floor-safe). Without eviction,
`ASM → PNT → WLD → CNC → INJ → MNT` (and many permutations) also pass.
All rows are inspectable — no order is impossible once claims are verified.

## Stage 3 — The Moving Network

Route INGRESS → CORE **through SEC-GATE**, all links UP, bottleneck ≥ 3,
fuel ≤ 10. PROBE budget 8: reveals true capacity, **permanently +1 fuel** on
that link. Suspect links' class capacity is a claim, not a measurement
(`a2-b2` claims 4, measures 1; `gate-core` claims 4, measures 3).

**Exactly two corridors clear the rules without probing:**
- `entry-b1 → b1-b2 → b2-gate → gate-core` — cost **8**, bottleneck 3 ✅
- `entry-a1 → a1-a2 → a2-gate → gate-core` — cost **10**, bottleneck 4 ✅
  (probing *any* link on this path pushes it over the fuel budget)

Down link `b1-a2` can never be used. Non-chains, missing-gate routes fail
CHAIN/GATE.

## Stage 4 — Blackout Protocol

The plan is evaluated **against state the player created**:

- **Block:** N2/N4 cross-hold MAGLOCK/FUEL (cap 1 each). Break with
  `PREEMPT N2`/`PREEMPT N4`, `INJECT` (one spare per plan), or — if stage 1
  injected — `GRANT` the spare that is already in the bay.
  BOOT INTERLOCK: block must be resolved before RUN.
- **Scheduler:** floor `[1,1,0]` must hold after *every* step. If MNT was
  evicted in stage 2, run `ASM → PNT → WLD → CNC → INJ`; if it is still
  resident, add `EVICT` to the plan first (its return is what makes the pool
  fit).
- **Route:** floor 2, fuel 9, **every stage-3 route link degraded −1**;
  stage-4 probes are a fresh budget of 4. The stage-3 b-corridor still fits
  (degraded bottleneck 2, cost 8).
- **SEAL** must be last and requires block resolved + run + route.

On success the response carries the transmission + flag; paste it into the
seal box (`POST /api/flag`) to record completion.

---

## Multiple-solution summary

| Stage | Degrees of freedom |
|---|---|
| 1 | 4 valid recoveries |
| 2 | every safe order (dozens), evict or not |
| 3 | 2 corridors (probing can open others if budget allows) |
| 4 | break choice × evict choice × safe orders × route choice |

## Anti-shortcut notes

- The client never computes an answer: it only visualizes server views and
  previews *published* constraints (cost/floor/gate) for UX; the server
  re-validates everything with hidden truth (true caps, real drain, real
  banker's check).
- No flag or canonical vector exists in any served file (enforced by
  `test/run.js` "frontend sources" case).
- Budgets, spacing, and hint gates are per-session and server-enforced.
