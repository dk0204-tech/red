# THE DEADLOCK ENGINE: BLACKOUT PROTOCOL

> Standalone bonus CTF · four stages · server-authoritative · zero dependencies.
> Part of the Red Zone / Central Atrium collection — runs on its own, no
> integration with the main map required.

The facility is in blackout. Four subsystems are frozen, the operator crew is
gone, and the consoles only tell you what you have earned the right to see.
Recover them in order — one honest experiment at a time.

```bash
npm start          # http://localhost:8090   (PORT env overrides)
```

No build step, no external fonts/CDN, no network calls — everything is served
from this folder. Node ≥ 18.

## The four stages

1. **GHOST IN THE RESOURCE GRAPH** — a facility deadlock. Inspect capacities
   and holdings, run bounded trials, separate the real deadlock from the
   cycle that only looks like one, and submit a recovery that lets *every*
   process finish.
2. **THE UNSAFE SCHEDULER** — a banker's-table claim matrix with one stale
   cached row. Verify claims, decide whether to evict the custodial rig, and
   find an execution order that never starves the pool.
3. **THE MOVING NETWORK** — a damaged network where suspect links lie about
   their bandwidth and every probe costs fuel. Restore a route from INGRESS
   to CORE through SEC-GATE inside the floor and fuel limits.
4. **BLACKOUT PROTOCOL** — compose a full recovery plan (dependency break →
   scheduler run → route → seal) against live state that your own stage-1–3
   decisions created. The engine validates it operation by operation.

Multiple valid solutions exist at every stage. All rules are discoverable in
the briefing, rules panel, and diagnostics — nothing depends on obscurity.

## While you play

- **Diagnostic budgets** are visible per stage (inspections, trials, probes,
  submissions). Hints and the next stage stay available even if you spend a
  budget badly.
- **ADVISORY L1–L3** hints unlock with progress (L2 after one failed attempt,
  L3 after three) — no global or shared counters.
- **RESET SESSION** wipes your progress, budgets, and hints after an explicit
  confirmation.
- Audio is **off by default** (toggle in the top bar); reduced-motion and
  keyboard navigation are respected. Works down to phone width with no
  horizontal scrolling.

## Verification

```bash
npm test           # algorithm + backend suite (test/run.js)
npm run solve      # reference solver, full 4-stage playthrough
npm run test:e2e   # Playwright UI playthrough: desktop + mobile + reduced motion
```

Organizer documentation (solution, state model, deployment, audit evidence)
lives in `_organizer/` — it is never served over HTTP.

The flag follows the `RZ{...}` convention and exists only in the server
process; override it for deployments with `DEADLOCK_FLAG="RZ{...}" npm start`.
