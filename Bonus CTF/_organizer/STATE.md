# STATE.md — server authority, sessions, and limits

## Session model

- Cookie `deadlock=<40hex>.<64hex-hmac>` — HttpOnly, SameSite=Lax, Max-Age 7d.
  Carries **only** a random session id; all progress lives server-side.
- Tampered/absent cookie ⇒ fresh session (never another player's state).
- `ver` (state version) increments **only** on puzzle-state success
  (stage advance, eviction, solve, reset). Failed attempts do not bump it.

## Request pipeline (POST /api/*)

1. **schema/parse** — malformed JSON ⇒ 400 `PARSE`; body cap 4096 (oversized
   ⇒ 400 `BODY`, connection drained not destroyed); missing `ver` ⇒ 400
   `NOVER`; mismatched `ver` ⇒ 409 `STALE` (client resyncs silently).
2. **spacing** — per-key cooldowns: `s1.recover / s2.evict / s2.test /
   s3.route / s4.plan / flag` 1100 ms, `reset` 5000 ms ⇒ 429 `SPACING`.
   Hint requests: 3000 ms per hint key (gate checked *before* spacing).
3. **stage gate** — acting on a locked stage ⇒ 403 `LOCKED`.
4. **budget** — per-session counters ⇒ 429 `BUDGET` when exhausted.
5. **action** — engine validation; *then* spacing key recorded.

Inspection/trial/probe/ack requests have no spacing (budgets still apply).

## Diagnostic budgets (per session, per stage)

| Stage | Budgets |
|---|---|
| 1 | inspect 10, trial 3, recover 5 |
| 2 | inspect 5, evict 1, test 10 |
| 3 | probe 8, route 6 |
| 4 | plan 8, flag seal 8 |

## Rate limits (service level)

- Per session: 40 req/s, burst 80 ⇒ 429 `RATE`.
- Per IP: 100 req/s, burst 300 (protects the service, not the puzzle).

## Hint gating

- L1 free; L2 needs ≥1 failed attempt on that stage; L3 needs ≥3.
- Stage not yet reached ⇒ 403 `LOCKED`; gate failure ⇒ 403 `GATED {need,have}`.
- Unlocking is progress-based and per-session — no global hint counter.

## State masking (views)

- Only the **current stage's** view fields are present in `/api/state`.
- Stage 1: capacities/holds/max hidden until inspected.
- Stage 2: unverified MAX rows `null`; custodial row pre-revealed; cached row
  labelled `CACHED`.
- Stage 3: suspect links `cap: null, unverified: true` until probed.
- Stage 4: full telemetry release (scheduler rows verified, block visible);
  N2/N4/block appear **only** at stage 4.
- The flag never appears in any view; only a **post-solve** plan success and
  a correct `POST /api/flag` ever return it.

## Validation semantics (engine.js, pure functions)

- **S1** `drain()` — iterative grant/release simulation over a *copy*;
  `drains` ⇔ every process finishes. Trials report `drains` + `stuckCount`.
- **S2** `s2Safety()` — banker's check from the live pool; failure returns
  first failing step, proc, and per-type deficit.
- **S3** `s3Validate()` — walk must be a simple INGRESS→CORE chain on UP
  links through the gate node; bottleneck uses **true** caps (probed reveals,
  unprobed suspect still true on the server); fuel includes probe surcharges.
- **S4** `s4Validate()` — op-by-op over cloned state: interlock → break
  (drain-proven) → evict → run (safety + floor `[1,1,0]`) → route (degraded
  caps, floor 2, budget 9) → seal-last. Returns `failedAt` + code
  (`INTERLOCK/BREAK/INJECT/EVICT/SHAPE/UNSAFE/FLOOR/COST/OP/SEAL/DUP`).
  Invalid plans never mutate state.

## Uniformity & leakage controls

- Wrong flag and correct-flag-pre-solve both return the same
  400 `{code:"FLAG", msg:"Transmission not authorized."}`.
- Events ring buffer ≤ 500 entries: sid-prefix, type, code — no PII, no flag.
- Static whitelist only; `_organizer/`, `server/`, `test/` are never served
  (404). CSP `script-src 'self'`, no inline handlers.

## Determinism / reproducibility

- All four stage instances are constants in `server/engine.js`.
- `test/run.js` asserts canonical instances + every documented failure mode.
- Organizer reproduction: `npm test`, `npm run solve`, `npm run test:e2e`.
