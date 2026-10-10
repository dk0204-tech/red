# RED ZONE CTF 3 — METADATA FORENSICS

**THE LAST DATASET** · Node 07 Recovery Archive · Archive reference `CHILD-17`

A standalone, zero-dependency Metadata Forensics CTF built on the real
`PARENT_FINAL.csv` and `CHILD_FINAL.csv` datasets. The player investigates the
provenance trail PRALAYA manipulated, files three forensic extracts, rebuilds
the reconstruction material and recovers the Child Dataset.

> Design foundation: the forensic/archive language of `last_dataset_ctf3.html`,
> executed as an expanded, interactive, backend-driven challenge.

---

## Run

```bash
npm start          # node backend/server.js  ->  http://localhost:8082
npm test           # full verification suite (47 checks)
npm run flag       # ORGANIZER ONLY: print material + expected flag
```

Requires **Node >= 18**. No dependencies, no build step, no network access.

| Env var | Meaning |
|---|---|
| `PORT` | listen port (default `8082`) |
| `METADATA_FLAG` | authoritative flag override (organizer) |
| `SHOW_FLAG=1` | print the expected flag at boot (organizer) |

Production: the project **is** the deployable unit — copy the folder to the
target machine and run `npm start` (zero dependencies, no build step).

---

## Structure

```
Red Zone CTF 3/
├── index.html            # hero / seal + app shell
├── css/main.css          # design system (dark forensic + archival paper)
├── js/
│   ├── app.js            # stage router, tray, hints, assembly console, recovery
│   ├── explorer.js       # search / filter / sort / paginate / select
│   ├── inspector.js      # metadata inspector + field analysis sheets
│   ├── graph.js          # provenance graph (VC → TM → MT → record → child)
│   └── timeline.js       # chronology lanes + lag ledger
├── data/
│   ├── PARENT_FINAL.csv  # byte-identical copy of the source dataset (read-only)
│   └── CHILD_FINAL.csv   # byte-identical copy of the source dataset (read-only)
├── assets/favicon.svg
├── backend/
│   ├── server.js         # HTTP server, static whitelist, API, rate limiting
│   ├── store.js          # CSV parse + parent/child join + derived metadata
│   └── puzzle.js         # published rules + flag derivation (server-side only)
├── tools/flag.js         # organizer-only flag printer
└── test/run.js           # self-contained test suite
```

The datasets are **read-only**: nothing in the project rewrites them, and the
test suite verifies their SHA-256 before and after every run.

---

## The challenge (7 stages)

| Stage | Name | What the player does |
|---|---|---|
| I | CASE INTAKE | briefing; establishes `CHILD DATASET / PROVENANCE COMPROMISED` |
| II | EXHIBITS | inspect both real artifacts (custody sheets with real SHA-256) |
| III | PROVENANCE | rule III — authenticity below the **0.500** archival floor |
| IV | CHRONOLOGY | rule IV — audit written later than **7d 12h** after transfer |
| V | CORRELATION | rule V — **≥2** child blank cells **over an admitted edit** |
| VI | RECONSTRUCTION | assemble material, compute the digest |
| VII | RECOVERY | submit the value; cinematic recovery; Child Dataset release |

The three published rules are applied to the real data:

```
provenance   9 records    Record_Authenticity_Score < 0.500
chronology   7 records    Access_Log_Timestamp − Transfer_Date > 7.5 days
correlation 10 records    child blank skill cells >= 2  AND  parent Record_Alteration_Flag = True

material = <prov ids>|<chron ids>|<corr ids>     (each sorted ascending, comma separated)
flag     = RZ{ sha256hex( material )[0..31] }
```

The digest is computed client-side by the assembly console from the player's
own filed extracts; the server recomputes it from the datasets and validates
with a constant-time compare. **The flag is never sent to a client** — not in
HTML, CSS, JS, assets, any API response, `localStorage`, or the boot log.

---

## API

| Route | Purpose |
|---|---|
| `GET /healthz` | liveness |
| `GET /api/state` | progress, unlocked stages, evidence, hints |
| `POST /api/intake` · `/api/exhibits` | stage I / II completion |
| `POST /api/provenance` · `/api/chronology` · `/api/correlation` | file an extract |
| `GET /api/dataset/parent\|child` | paginated, searchable, sortable views |
| `GET /api/record/:id` · `/relations` · `/trace` | inspector / graph / provenance chain |
| `GET /api/timeline` · `/api/ledger` | chronology + correlation instruments |
| `GET /api/brief` · `/api/briefs` · `/api/rules` · `/api/protocol` · `/api/hint/:n` | briefing material |
| `POST /api/flag` | validate the reconstructed value (rate-limited) |
| `GET /api/download/child` | recovered Child Dataset — **403 until solved** |

Static serving is a strict whitelist: only `index.html`, `css/*`, `js/*`,
`assets/*` are reachable. `data/`, `backend/`, `test/`, `tools/` and the
package files are never served.

---

## Testing

```bash
npm test
```

Self-contained (47 checks): dataset byte-integrity, parent/child join
invariants, exact derivation of all three rule sets (including the
exactly-7d-12h boundary records that must **not** be filed), client digest vs
server digest, frontend leak scan, CSP inline-handler scan, asset whitelist,
standalone scan, full live-API walkthrough with stage gating, wrong/correct
extract feedback, wrong/correct flag wording, gated Child Dataset download,
security headers, clean spawn boot, and optional baseline verification of the
neighbouring projects when they are present (skipped otherwise — they are not
dependencies).
