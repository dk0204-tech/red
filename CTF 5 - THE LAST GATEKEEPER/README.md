# CTF 5 — THE LAST GATEKEEPER: SPLIT SEAL

> **PRALAYA // RED-ZONE-04** — *The archive is still alive. The gatekeeper is
> still watching. The seal is split.*

This folder is the complete, self-contained integration of the final RED ZONE
challenge of **THE LAST DATASET** (TDA — The Data Alchemists · Cognitia '26):

- a cinematic world-map / approach / recovery experience in the event's visual language,
- a **live terminal that is a direct pipe to the real `gatekeeper` service**,
- a raw `nc` listener, and
- strictly **server-side** flag validation and durable completion state.

The puzzle itself is untouched: the shipped, stripped, PIE x86-64 `gatekeeper`
ELF (format-string recon → witness reconstruction → second disclosure →
session-dependent continuation address → moving overflow → fragment). Nothing
was rewritten, simulated, or simplified.

> The legacy package folders are named `CTF4_Split_Seal_V3_*`, but per the
> official lineup this challenge is **CTF 5**. The legacy folders are inputs
> only and remain untouched; all player-facing material here says CTF 5.
> CTF 4 — THE SLEEPER remains the separate optional bonus in `Bonus CTF/`.

---

## Quick start

```bash
cd "CTF 5 - THE LAST GATEKEEPER"
npm install          # one dependency: ws (WebSocket bridge)
npm start            # web + api on :8083, raw challenge listener on :31337
```

Open **http://127.0.0.1:8083/** → world map → CTF 5 → approach → live terminal.

The challenge service is reached either through the in-page terminal (WebSocket
bridge, with an optional `/b64 <base64>` command for raw payloads) or the way
the challenge documents intend:

```bash
nc 127.0.0.1 31337
```

### Host requirements for the challenge binary

`challenge/gatekeeper` is a **Linux x86-64 ELF**. How it runs depends on the host:

| Host | Backend | What you need |
|---|---|---|
| Linux | `spawn` — server spawns the ELF directly | nothing extra (glibc ≥ 2.34, e.g. Debian 12+) |
| Docker (any OS) | `spawn` inside the container | Docker — see *Deployment* |
| Windows, no Docker/WSL | `vm` — isolated local QEMU Linux guest | `npm run runtime:fetch` once (no admin rights needed) |
| Any, external service | `tcp` — proxy to an existing deployment | `GATEKEEPER_TCP_HOST/PORT` (e.g. the original player package's `docker compose up` on another port) |

On Windows, `npm run runtime:fetch` assembles `challenge/runtime/` from public
upstream artifacts (MSYS2 QEMU build — extracted, **not installed** — plus an
Alpine virt kernel, static busybox and a Debian glibc, with the unmodified
gatekeeper ELF embedded in a purpose-built initramfs). `npm start` then boots
that guest on demand and forwards `127.0.0.1:13137 → guest:2323` where `tcpsvd`
spawns a fresh gatekeeper process per connection — the exact semantics of the
original `challenge/server.py`. Linux/Docker hosts never touch this runtime.

---

## Folder structure

```
CTF 5 - THE LAST GATEKEEPER/
├── frontend/                  # served statically — the ONLY served directory
│   ├── index.html             # world map + approach cinematic + terminal + recovery
│   ├── css/main.css           # RED ZONE visual language (scanlines, ash, hazard gate)
│   ├── js/app.js              # hash router #/map → #/approach → #/challenge → #/recovery
│   ├── js/terminal.js         # WebSocket ⇄ live gatekeeper pipe
│   └── favicon.svg
├── server/                    # never served over HTTP
│   ├── server.js              # http static (whitelist) + /api/* + ws upgrade + boot
│   ├── config.js              # private: flag commitment, ports, limits (env-overridable)
│   ├── validate.js            # constant-time SHA-256 commitment check
│   ├── progress.js            # durable completion state (server/data/progress.json)
│   ├── gatekeeper.js          # backend resolution: tcp | spawn | vm
│   ├── bridge.js              # session limits, flag observation, WS + raw TCP wiring
│   ├── vm.js                  # Windows-only isolated challenge VM (qemu-system)
│   └── data/                  # runtime state (progress.json, vm logs)
├── challenge/                 # player-facing challenge runtime (from the PLAYER package)
│   ├── gatekeeper             # the real ELF (sha256 6994de68… — identical to both originals)
│   ├── CHALLENGE.md           # instructions (heading corrected to CTF 5)
│   ├── server.py              # original TCP wrapper (Linux deployments may use it directly)
│   ├── Dockerfile             # original standalone service image (port 31337)
│   ├── docker-compose.yml     # original standalone service compose
│   └── runtime/               # Windows dev-host runtime (built by npm run runtime:fetch)
├── scripts/fetch-runtime.mjs  # assembles challenge/runtime/ (documented, idempotent)
├── test/run.js                # integration suite (npm test)
├── test/solve.mjs             # PRIVATE intended-solution harness — never served/deployed
├── Dockerfile                 # integrated image: web + api + native gatekeeper spawn
├── docker-compose.yml         # integrated deployment (8083 + 31337, durable volume)
├── .dockerignore              # excludes test/, scripts/, runtime/ from images
├── .env.example               # environment template (never contains real secrets)
└── package.json               # npm start / npm test / npm run runtime:fetch
```

---

## Ports & environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8083` | web UI + `/api/*` + WebSocket bridge |
| `TCP_PORT` | `31337` | raw challenge listener (`nc HOST 31337`); `0` disables |
| `DATA_DIR` | `server/data` | where `progress.json` completion state is stored |
| `SPLIT_SEAL_FLAG` | *(unset)* | organizer-only flag rotation — validated against a built-in one-way commitment when unset |
| `GATEKEEPER_BIN` | `challenge/gatekeeper` | ELF path (spawn mode) |
| `GATEKEEPER_TCP_HOST` / `GATEKEEPER_TCP_PORT` | *(unset)* | external service mode (proxies instead of spawning) |
| `MAX_SESSIONS` | `8` | concurrent live sessions |
| `SESSION_IDLE_MS` | `600000` | idle session timeout |
| `QEMU_BIN` / `QEMU_KERNEL` / `QEMU_INITRAMFS` | under `challenge/runtime/` | Windows VM overrides |
| `VM_HOST_PORT` / `VM_RAM_MB` | `13137` / `160` | host-side VM forward port / guest RAM |

Chosen ports do not collide with the other challenges in this event
(CTF 1 `:8080`, CTF 2 `:8081`, CTF 3 `:8082`, CTF 4 bonus `:8090`).

---

## How the challenge service works

```
browser ──WS /ws──▶ server/server.js ──┬─ spawn: gatekeeper ELF (Linux/Docker)
nc HOST 31337 ────────────────────────┤─ tcp:   external service
                                       └─ vm:    local qemu guest (Windows dev)
```

- **spawn** (Linux / Docker): one process per connection, stdin/stdout piped —
  byte-for-byte the behaviour of the original `challenge/server.py`.
- **vm** (Windows dev hosts): a headless QEMU guest (Alpine virt kernel +
  busybox initramfs embedding the same ELF) runs `tcpsvd … 2323 /gatekeeper`;
  the server forwards to `127.0.0.1:13137`. Boot is warmed at server start.
- **tcp**: point at any reachable deployment of the original player package.

Every byte produced by the service flows through this server, so a player who
solves with `nc` from another machine is observed exactly like a player using
the in-page terminal.

---

## How completion is validated (server-side only)

1. **Observed exploit (primary).** Service output is scanned for flag-shaped
   strings; each candidate is hashed and compared in constant time against a
   **SHA-256 commitment** held in private server code (`server/config.js`).
   A match records completion (`method: "observed"`). The literal flag exists
   nowhere in this folder, in any served asset, or in client-side code.
2. **Submission (secondary, event-standard).** `POST /api/flag` runs the same
   constant-time check (shape + digest) with per-IP rate limiting. Completion
   flips only here or in (1) — never from browser state. `GET /api/status` is
   read-only.

State persists in `server/data/progress.json` (a named volume in Docker) and
survives restarts. Organizers can rotate the flag without editing code by
exporting `SPLIT_SEAL_FLAG` at runtime; the value never needs to be committed.

---

## Deployment

**Integrated (recommended):**

```bash
docker compose up --build        # http://HOST:8083  +  nc HOST 31337
```

**Standalone original service** (unchanged player package behaviour, e.g. to
feed the integration server via `GATEKEEPER_TCP_*`):

```bash
cd challenge && docker compose up --build   # 31337 only — or use the original
                                            # CTF4_Split_Seal_V3_PLAYER (1)/ folder
```

The integrated image runs as the unprivileged `node` user with `read_only`,
`cap_drop: ALL` and `no-new-privileges`, mirroring the hardening of the
original player compose file.

---

## Testing

```bash
npm test
```

Covers: static whitelist + traversal/organizer-leak attempts, absence of any
flag-shaped literal in served assets, API shape, rejection + rate limiting, the
`SPLIT_SEAL_FLAG` rotation path, WebSocket bridging of the **real** service, the
raw TCP listener, an **end-to-end run of the intended multi-stage exploit**
(`test/solve.mjs`, private), emission-based auto-award, and persistence across a
restart. Backend-dependent checks SKIP with an explicit reason when no Linux
runtime is available — they are never reported as passing.

`test/solve.mjs` implements the intended solution for verification only; it is
excluded from Docker images (`.dockerignore`) and never reachable over HTTP
(the static root is `frontend/` exclusively).

---

## Organizer security notes

- `CTF4_Split_Seal_V3_ORGANIZER/` (guide, `solve.py`, `src/gatekeeper.c`,
  expected flag) stays **outside** this folder and is never served, bundled, or
  linked. Nothing in `frontend/` references it.
- The expected flag is stored only as a one-way commitment (or the runtime
  `SPLIT_SEAL_FLAG` env var). It cannot be recovered from this source tree.
- `test/` and `scripts/` are private tooling: not served by the web server and
  excluded from container images.
- Both original Split Seal folders are byte-for-byte untouched; this folder
  contains its own copy of the player runtime.
