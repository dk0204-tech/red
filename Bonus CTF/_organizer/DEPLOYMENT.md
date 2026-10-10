# DEPLOYMENT.md — running THE DEADLOCK ENGINE

## Quick start

```bash
cd "Bonus CTF"
npm start              # node server/server.js — http://localhost:8090
```

- `PORT` env overrides the port (default **8090**).
- Zero runtime dependencies (Node ≥ 18, stdlib only). `playwright` is a
  dev-dependency used solely by `npm run test:e2e`.
- No build step, no bundler, no external fonts/CDN — fully offline.

## Tests

```bash
npm test               # algorithm + backend suite (test/run.js)
npm run solve          # reference solver end-to-end (_organizer/solve.js)
npm run test:e2e       # Playwright UI playthrough (test/e2e.js)
```

Evidence for each lives in `_organizer/audit/`.

## Flag

- Default: `RZ{blackout_protocol_quiesce}` defined **only** in
  `server/engine.js` (server-side).
- Override: `DEADLOCK_FLAG="RZ{your_flag}" npm start`
  (convention enforced by tests: `/^RZ\{[a-z0-9_]+\}$/`).
- The flag is never present in `public/**`, HTML comments, source maps (none
  exist), or any pre-solve response — `npm test` enforces this.

## File map

```
Bonus CTF/
├── package.json            scripts: start / test / test:e2e / solve
├── README.md               player-facing brief
├── server/                 ← NOT served over HTTP
│   ├── server.js           static whitelist, CSP, cookie, body cap, routing
│   ├── store.js            sessions, budgets, spacing, gating, dispatch, views
│   ├── engine.js           canonical instances + drain/banker's/routing/S4 logic
│   └── narrative.js        briefings, hints, tutorial, transmissions, code explain
├── public/                 ← the only served files
│   ├── index.html          three-column shell + overlays (no inline script/style)
│   ├── css/main.css        industrial console theme, responsive, reduced-motion
│   ├── favicon.svg
│   └── js/  audio.js graph.js ui.js app.js
├── test/
│   ├── run.js              full suite (algorithms + backend + no-leak checks)
│   └── e2e.js              Playwright playthrough (desktop + mobile)
└── _organizer/             ← private, never served (404 by design)
    ├── SOLUTION.md  STATE.md  DEPLOYMENT.md
    ├── solve.js             reference solver
    └── audit/               test + e2e evidence logs
```

## Security posture

- Signed opaque session cookie (HMAC), HttpOnly; state server-side only.
- Static whitelist — directory traversal and unknown paths 404.
- CSP: `default-src 'self'; script-src 'self'; style-src 'self'; object-src
  'none'; base-uri 'none'; form-action 'none'`.
- Request body cap 4096 B; per-session + per-IP token buckets; per-session
  puzzle budgets and submission spacing (anti-grind, per-session — never
  global, so one player cannot lock out another).
- Replay/stale protection: every POST requires the current `ver`
  (`NOVER`/`STALE`), submission spacing blocks burst retries, and progress
  is per-session.

## Later integration (Central Atrium)

This CTF is intentionally **standalone**: it has its own server, sessions,
and entry point. To integrate later:

1. Mount `public/` under a path (e.g. `/deadlock/`) and proxy `/deadlock/api/*`
   to `server/server.js`, **or** `require("./server/server")` and add the
   `FILES` prefixes to the atrium router.
2. Replace the intro's `ENTER THE FACILITY` handoff with the atrium's own
   launcher; everything else is idempotent per session.
3. If sessions must be shared, replace `store.create()`'s cookie mint with an
   atrium-provided session id — the store only needs a stable opaque id.
4. Keep `_organizer/` out of any served root, and keep `DEADLOCK_FLAG` as an
   env var in the atrium's process environment.

## Operational notes

- In-memory sessions: restarting the server wipes all progress (by design —
  no DB). Set `PORT` if 8090 is taken.
- The event ring (`store._debugEvents()`) is bounded at 500 entries and
  contains no player PII or flag material.
