# PRALAYA Archive Terminal

**Red Zone · CTF 1 — The Last Dataset (TDA / Data Alchemists · Cognitia '26, 14–15 Oct 2026)**

A production-grade, browser-playable web-exploitation challenge. Participants break into
the damaged records terminal of a collapsed survivor-sanctuary network, correct the
archive's own wrong answer, and earn **Fragment 1** of `PARENT_FINAL.csv`.

---

## Story (participant-facing)

> The PRALAYA Archive Terminal is the only system from the collapsed sanctuary network
> still reachable. It's a damaged internal records tool — part public transparency
> portal, part forgotten staff backend nobody properly decommissioned. It still answers
> questions. It just doesn't check very hard who's asking, and it doesn't always tell
> the truth about what it hands back.
>
> **Recovery directive (intercepted, origin unverified):**
> *"Fragment 1 belongs only to the sanctuary records whose identity was fully verified,
> never falsified to protect someone, and signed correctly. The terminal thinks it knows
> which records those are. It's wrong about one of them."*

Solving yields two rewards:

1. A **flag** (`RZ{…}`) to submit to CTFd.
2. **`FRAGMENT_1.csv`** — the correct 12 rows of the master dataset, trimmed to 5
   columns, sliced live from `PARENT_FINAL.csv` at download time.

---

## Run it

### Local (zero dependencies — Node ≥ 18)

```bash
node src/server.js          # or: npm start
# terminal is up on http://127.0.0.1:8080
```

### Docker (recommended for the event)

```bash
docker compose up --build   # serves on http://localhost:8080
```

The container is read-only, drops all capabilities, and runs as the unprivileged
`node` user. It needs no network access beyond its published port.

### Environment

| Variable     | Default                    | Purpose                                        |
| ------------ | -------------------------- | ---------------------------------------------- |
| `PORT`       | `8080`                     | Listen port                                    |
| `HOST`       | `0.0.0.0`                  | Bind address                                   |
| `FLAG_SALT`  | (baked, server-side only)  | Rotate the flag by setting a private value     |
| `PARENT_CSV` | `data/PARENT_FINAL.csv`    | Path to the parent dataset                     |

> **Never expose `FLAG_SALT` to participants.** It exists server-side only; nothing the
> browser can fetch contains it (verified by the test suite).

---

## Test

```bash
npm test
```

Spawns its own server on port 8391 and runs the **complete intended solve path**
end-to-end — recon → IDOR → secret derivation → token forging → the manifest trap →
system artifacts (journal / attempt log) → audit-dialect discovery → synthesis →
attestation (token + ETag + sync event) → fragment download — plus ~45
negative and edge-case checks (generic rejections, sync-event gate, traversal,
malformed input, leak scans). On success it prints the flag for the current dataset +
salt. Current record: **114 / 114 passing.**

---

## Route map

| Route                   | Page                                                        |
| ----------------------- | ----------------------------------------------------------- |
| `/`                     | Entry hero — skippable boot / signal-recovery sequence      |
| `/archive`              | The workstation: case index, forensics, matrix, graph, recovery console, system, terminal |
| `/status`               | System status, signer recipe, retired sample token          |
| `/robots.txt`           | Still lists the archived recovery routes (step 1 of the chain) |
| `/api/system/sync-log`  | Synchronization journal — event windows (system artifact)   |
| `/recovery/attempts`    | Failed-attempt log — required references, no answers        |
| `/recovery/channel`     | Folded channel (410) — points at the live attestation route |

The core exploit chain (`/api/case/:id`, `/api/cases`, `/recovery/manifest`,
`/api/fragment/submit`) is unchanged; attestations additionally bind to the sync
event that compiled the manifest (`X-Sync-Event`). Hidden routes are never
hardcoded in client JS — players discover them (robots, `Link` header, 410 pointer)
and type them into the recovery console.

## Layout

```
red-zone-ctf1/
├── src/
│   ├── server.js      # HTTP server, all routes in the attack chain
│   ├── store.js       # loads PARENT_FINAL.csv, computes every derived view
│   ├── security.js    # key derivation, tokens, tickets, flag derivation
│   └── csv.js         # dependency-free CSV reader/writer
├── public/            # the site (server-templated, CSP-locked, no external assets)
│   ├── hero.html      # "/" entry: boot sequence → Enter Archive
│   ├── index.html     # "/archive" multi-panel workstation (server-templated cards + tables)
│   ├── status.html    # "/status" system status, signer recipe, retired sample token
│   ├── 404.html, robots.txt, favicon.svg
│   ├── css/           # terminal.css (shared chrome) + workstation.css (panel layer)
│   └── js/            # boot.js (hero), app.js (workstation), audio.js (WebAudio SFX)
├── data/PARENT_FINAL.csv   # 120 × 26 master dataset (source of truth)
├── test/solve.js      # end-to-end participant-perspective solver + negative suite
├── Dockerfile / docker-compose.yml
├── README.md          # this file
└── ORGANIZER_GUIDE.md # solve path, hints, flag, CTFd notes — keep off the server
```

**Organizers:** the full intended solve path, hint ladder, flag-generation mechanism and
deployment notes are in [`ORGANIZER_GUIDE.md`](ORGANIZER_GUIDE.md). That file must not
be shipped to participants.
