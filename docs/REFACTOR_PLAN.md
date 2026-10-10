# THE LAST DATASET — Safe Incremental Refactor Plan

Written **before** any production refactor code was changed (spec §42).

## 1. What exists today (inspection results)

| File | Lines | Loaded by `index.html`? | Role |
|---|---|---|---|
| `index.html` | 3999 | yes | The entire live game: inline `<script>` (L704–3997) = audio engine, Three.js world, city build, 6 ZONES, drive/foot/interior modes, CTF chamber builders, modal + **frontend flag judging**, LocalStorage save, HUD, animation loop. Inline `<style>` (L13–596). |
| `config/ctf-links.js` | 190 | yes | Static CTF URL config (4 placeholder slots), central launcher `openCTFForTerminal()`, popup-safety splash technique. |
| `style.css` | 1197 | no | Legacy styles for the legacy pages. |
| `app.js` | 738 | no | **Old duplicate CTF system**: `openCTFModal()`, `renderCTFDataTable()`, frontend flag input/checking, countdown timer. |
| `data.js` | 638 | no | `window.MANU_DATA`: sectors, 20 `CTF_CHALLENGES` **with `flag` + `hint` + `storyUnlock` in plaintext**, 120 residents, 450 historical records. |
| `audio.js`, `ml.js` | 163 / 288 | no | Legacy audio + ML helpers. |
| `brandguidelines.md`, `gemini.md` | 0 / 2 | no | Notes. |

Live state today: `SAVE_KEY = MANU3D_SAVE_V1` (localStorage only), 3 active zones
(`zone_vault`/`zone_bridge`/`zone_ai`) + 3 reserved, `ACTIVE_CTF_COUNT = 3`,
solved state = `zone.solved` set by **in-browser flag judging** (`zone.flag` hardcoded in ZONES).

## 2. Risks identified

1. One 3300-line inline script — any broad rewrite risks breaking the working 3D game.
2. **Flags/hints are shipped to every browser** (ZONES in index.html *and* data.js) → real CTFs would be free points.
3. Progress is localStorage-only → not an event platform, no teams, no leaderboard.
4. No backend at all: no auth, no admin, no launch tracking, no server timer.
5. CTF URLs hardcoded in a static file → editing requires a redeploy.
6. `openCTFModal`/`submitFlag` legacy flow must be removed without breaking the modal shell used by the terminal.

## 3. Strategy — incremental, additive-first

Order of work (each step keeps the game bootable):

1. **Backend first** (new `server/` tree — zero risk to the game): Express REST API, PostgreSQL
   schema + migrations, JWT auth (participants + admin roles), bcrypt hashing, helmet/CORS/rate-limit,
   parameterized SQL, audit log, CTF CRUD, launch tracking, secure service-token completion callback,
   team progression, leaderboard, server event timer, `/api/health`.
2. **Database**: `users, teams, ctf_challenges, ctf_launches, submissions, event_state, audit_logs`.
   Production driver `pg` (DATABASE_URL=postgres://…). Local/dev driver `@electric-sql/pglite`
   (real Postgres, embedded, zero setup — "easy local development option"), selected by URL scheme.
3. **Frontend API layer** (`src/api/client.js`, `src/state/gameState.js`): one centralized client,
   no scattered `fetch()`. Boot sequence: `/api/health` → `/api/event` → `/api/ctfs` → `/api/progress`
   → `/api/leaderboard` (lazy). All calls timeboxed; failure ⇒ offline banner + local fallback, never a blank screen.
4. **CTF launch path**: `ctfTerminalAction` → `src/ctf/launcher.js`
   (resolve zone→CTF from API cache, validate https URL, `POST /api/ctfs/:id/launch`, reserve tab
   synchronously, splash, navigate after handshake). `config/ctf-links.js` stays only as *offline fallback*.
5. **Remove the participant-facing flag system**: delete flag input UI + `submitFlag/judgeFlag/
   wrongFlagMessage` from the live script, strip `flag`/`hint` from ZONES, strip `flag`/`hint`/
   `storyUnlock` from `data.js`, disable `openCTFModal`/`renderCTFDataTable` in `app.js`.
   Solved state now comes from `GET /api/progress` (server-authoritative).
6. **HUD upgrade** (edit in place): top-left `THE LAST DATASET / SANCTUARY ZERO`, top-right
   `EVENT hh:mm:ss + RESTORATION %`, existing bottom `[E]` prompt, new pause/system menu
   (MISSION / PROGRESS / LEADERBOARD / AUDIO / SETTINGS / RETURN), leaderboard screen.
7. **Cinematic terminal sequence** (`src/ui/terminal.js`): full-screen CRT takeover, typed multi-line
   screen + flicker/scanlines/sound, ≤1.2 s, then channel opens (or popup-block fallback UI).
8. **World status**: zone state LOCKED / AVAILABLE / VISITED / SOLVED driven by backend progress;
   terminal screen text, pad emissive and door LED update dynamically.
9. **Auth gate**: cinematic SANCTUARY ID overlay (callsign + password + team) → JWT in localStorage;
   "ENTER UNSYNCED" fallback for offline play (banner shown).
10. **Admin dashboard** (`admin/`, served at `/dashboard`): login, overview, CTF CRUD (create/edit/
    enable/disable/URL/points/order/sector/terminal label), teams, submissions, leaderboard, event.
11. **Ops**: `.env.example`, `.gitignore`, `Dockerfile`, `docker-compose.yml` (app + postgres),
    `README.md`, `docs/API.md`, seed admin, healthcheck.
12. **Verification**: `node:test` API suite (auth, CRUD, launch, progress, leaderboard, callback,
    invalid input, disabled CTF, bad URL, DB failure) + browser integration run of the full
    player flow and completion→world-update flow, then a production-readiness pass.

## 4. Explicit non-goals

- No migration of the 3D game to React.
- No rewrite of the world/city/vehicle/interior code (untouched except the wiring points above).
- No iframe embedding of external CTFs; no `eval`; no trusting browser `{"solved":true}`.
- No huge new maps: the 3 compact chambers (archive/ghost/child) are kept as-is.
