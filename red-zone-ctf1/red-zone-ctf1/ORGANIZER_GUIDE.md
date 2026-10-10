# ORGANIZER GUIDE — Red Zone CTF 1: PRALAYA Archive Terminal

> **CONFIDENTIAL — do not distribute to participants.** This file is not copied into the
> Docker image (see `.dockerignore`) and is not served by the app.

---

## 1. Challenge overview

| | |
|---|---|
| **Event** | The Last Dataset — TDA / Data Alchemists · Cognitia '26 (14–15 Oct 2026) |
| **Zone** | Red Zone (hardest), CTF 1 of 4 — entry point; unlocks **Fragment 1** |
| **Category** | Web (chained with a light crypto/recon step) |
| **Format** | Static flag; stateless shared instance is fine |
| **Reward** | Flag for CTFd **and** `FRAGMENT_1.csv` downloaded from the app itself |

### Participant-facing description (safe to paste into CTFd)

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
>
> Find the true record set, attest it, and the terminal will release Fragment 1.

The same directive is rendered inside the app (`/archive`), so the challenge is
self-contained: teams that only get a URL can still find the rules of the puzzle.

---

## 2. Exact intended solve path

Every value below was produced by `npm test` / independent Python cross-check against
the shipped `data/PARENT_FINAL.csv`. Numbers change **only** if you swap the dataset or
the salt.

### Step 1 — Recon (public surface)

- `GET /` — entry hero: a short (**1–2 s**, skippable) boot sequence with a progress
  bar, then the title, sector tag and `[ press enter to continue ]` → `/archive`
  (Enter or the Skip button both work; repeat visits in the same tab start revealed;
  `prefers-reduced-motion` renders instantly). Pure atmosphere: it exposes no puzzle
  data (the test suite asserts boot text and markup contain no field names, routes,
  ids or secrets).
- `GET /archive` — the **workstation**: a multi-panel terminal interface (left nav /
  center workspace / right telemetry rail / bottom event stream) with seven views:
  - **index** — the 6 published cases (S001–S006) as cards, the recovery directive,
    and a case-lookup form. The register does **not** publish `Evidence_Fragment_Count`.
  - **forensics** — any record opened here shows profile, integrity bars, an
    interactive **timeline derived from the record's own fields** (transfer, last
    access, modification, provenance, journal event) and a raw projection.
  - **matrix** — "Scan Index" enumerates all 120 addresses (the IDOR, made visible)
    into a filterable/sortable table; **graph** — radial relation view per record.
  - **recovery** — the attestation console. Its route fields are **blank on purpose**:
    players type in the routes they discover. The state pill progresses
    `LOCKED → PARTIAL → CHANNEL → AUTHORIZED` as they make progress.
  - **system** — index report, the synchronization journal and the failed-attempt log,
    rendered as tables.
  - **terminal** — a small command shell (`help`, `probe`, `scan`, `get <path> …`)
    over the same API.
  The right rail carries telemetry, a live network panel, and three decryptable
  hints (see §3). None of the hidden routes appear anywhere in this HTML/JS — the
  test suite asserts it.
- `GET /robots.txt` — still lists `/recovery/`, `/recovery/manifest`,
  `/recovery/channel` and `/recovery/attempts` (the archive "forgot" to clean it).
  This is step 1 of the chain **and** the pointer to two system artifacts.
- Nav → `GET /status` — system status page (read now or later; needed at step 3).

### Step 2 — IDOR on the case API

`GET /api/case/:id` performs **no authorization check**: all 120 addresses
(`S001`…`S120`) answer with the full record and `"released": true|false`.

Deliberate design:

- `Falsified_To_Protect_Flag` is **stripped from this projection** — so this step alone
  cannot distinguish the 13 candidates from the true 12.
- `Identity_Record_Status`, `Signature_Valid_Flag`, `Evidence_Fragment_Count` are
  present (needed later).
- Response carries `Link: </api/cases>; rel="collection"` — the only pointer to the
  collection route (it appears **nowhere** in HTML/JS/robots).

Filtering on status + signature (2 of the directive's 3 conditions) yields **13**
candidates:

```
S001 S021 S024 S027 S046 S051 S054 S060 S073 S077 S084 S105 S120
```

### Step 3 — Derive the signing secret (status page)

`GET /status` → **SIGNER-01** block states (verbatim):

```
a = for each published case, ascending: Sanctuary_ID + ":" + Evidence_Fragment_Count, joined with "|"
b = plain integer sum of Evidence_Fragment_Count over every addressable record whose case-API "released" flag is false
key = sha256_hex("PRALAYA::" + a + "||" + b)
```

Computed from step-2 data:

```
a    = S001:5|S002:1|S003:6|S004:3|S005:5|S006:4
b    = 505                                     (sum over the 114 unreleased records)
recipe = PRALAYA::S001:5|S002:1|S003:6|S004:3|S005:5|S006:4||505
key  = 534fda168b8911bdd2cf1b5c003e68fa2dead217ed540d1551077a810f429267
```

`b` forces a full IDOR enumeration; nothing on the site reveals it. The status page
also documents the token format and shows an **expired sample token signed with a
retired key** — structure reference only; replaying it fails (wrong key + expired).

### Step 4 — Forge the attestation token

Token format (stated on `/status`):

```
token = PRT1.<payload-b64url>.<sig-b64url>
sig   = HMAC-SHA256(key, "PRT1." + <payload-b64url>)
payload = {"sub":..., "role":"recovery_archivist",
           "scope":["manifest:read","fragment:submit"], "iat":<past>, "exp":<future>}
```

Sign a fresh payload with the derived key. Expiry is checked (±5 min skew allowed);
both scopes are required downstream.

### Step 5 — The trap: recovery manifest

`GET /recovery/manifest` with `Authorization: Bearer <token>` returns **13 records** —
the archive's (wrong) answer: it checked only `verified AND signature valid`, skipping
the falsification condition. Signals that something is off (none of them say "wrong"):

- HTTP header `X-Manifest-Integrity: unverified`
- body `"integrity": "UNVERIFIED"` + `"advisory": "…verify each entry independently"`
- `"attestation": {"records": 13, "countersigned": 12, "pending": 1}` (12 ≠ 13)
- HTTP `ETag: "<sha256 of the exact response body>"` — required again at step 8

The manifest includes the near-miss trap **S021 (Kabir Voss)** — verified, signed,
*falsified to protect someone*. Trusting the manifest's 13 ids → rejected at submit.

### Step 6 — Second, independent discovery: the audit dialect

Different technique from the robots/token path (no crypto involved):

1. Follow the `Link` header from step 2 → `GET /api/cases`.
2. Default `Accept` → **406** `{"supported":["application/vnd.pralaya.audit+csv"]}`.
   (The `/status` content-negotiation log line primes this.)
3. Retry with `Accept: application/vnd.pralaya.audit+csv` → CSV for all 120 rows:
   `Sanctuary_ID,Falsified_To_Protect_Flag,Record_Alteration_Flag`.

This is the **only** source of `Falsified_To_Protect_Flag`. It deliberately omits
status/signature, so neither hidden source alone is sufficient.

### Step 7 — Synthesis

`13 candidates − {ids with Falsified_To_Protect_Flag == True}` → the true 12:

```
S001 S024 S027 S046 S051 S054 S060 S073 S077 S084 S105 S120
```

(S021 dropped.)

*Independent verification path (what careful teams do because the manifest says
UNVERIFIED): re-check all 13 candidates via `/api/case/:id` — status and signature both
hold for all 13, which is exactly why the second source is required.*

### Step 7b — The compiling sync event (system artifacts)

Attestations are **bound to the sync event that compiled the manifest**. The header
`X-Sync-Event` must equal **`SW-03`**. Two fair discovery routes, plus the record
itself:

1. **The attempt log.** `robots.txt` lists `/recovery/attempts` →
   `GET /recovery/attempts` returns four historical failures with their codes and
   nothing else (no record ids, ever):
   `E_TOKEN` (attestation token absent) · `E_ETAG` (manifest reference missing) ·
   `E_EVENT` ("sync event not referenced — attestations bind to the compiling event
   (journal: sync-archive)") · `E_ATTEST` (generic rejection). This documents exactly
   which references a submission must carry.
2. **The journal.** `GET /api/system/sync-log` returns six windows
   (`SW-01…SW-06`, all counts computed from the dataset). **`SW-03`** is the one with
   `outcome: "aborted"`, `writer: "CUSTODIAN-7"` and
   `note: "recovery manifest compiled 02:14:07Z · final adjudication pass aborted ·
   reindex pending"` — window `2024-09-17 → 2024-09-19` contains the manifest's own
   `generated: "2024-09-18T02:14:07Z"`. Correlating the two timestamps is the
   human-insight step: **SW-03 compiled the manifest**, so that is the event to attest.
   (Submitting without the header → 403 whose body points at
   `GET /api/system/sync-log`; the old channel route
   `GET /recovery/channel` → **410 Gone** with
   `superseded_by: "POST /api/fragment/submit"` is the fair pointer to the live
   endpoint for players who went looking for it.)
3. **In-app:** the recovery console's `sync event` field takes the value; its state
   pill advances to `CHANNEL` once the manifest is loaded through the console.

Designed dead ends around this step (each teaches something, none are required):

- `provenance` on every record is `CUSTODIAN-7` for **all 57 altered records** —
  a superset of the 34 falsified. Sorting/filtering by provenance cannot separate
  the trap: it is a dead end that teaches the falsification column exists elsewhere.
- `sync_event` is derived from each record's access timestamp and spreads the 13
  candidates across **four different windows** (SW-01, SW-02, SW-04, SW-05) — the
  event value never identifies which record is wrong; it is a binding, not a filter.

### Step 8 — Submission, flag, fragment

```
POST /api/fragment/submit
Authorization: Bearer <forged token>
X-Manifest-ETag: <ETag from step 5>          # forces teams to have fetched the manifest
X-Sync-Event: SW-03                          # the compiling event (step 7b)
Content-Type: application/json

{"ids": ["S001","S024",...,"S120"]}
```

- **Wrong sets** (the 13-id manifest list, subsets, swaps, unknowns) → HTTP 400
  `{"ok":false,"error":"attestation rejected","code":"E_ATTEST"}` — generic, never names
  which ids were wrong.
- Missing/invalid token or ETag → 403. Missing or wrong sync event → the **same**
  explanatory 403 regardless of value (`…see GET /api/system/sync-log`) — no per-value
  oracle. Malformed JSON / non-array → 400.
- **Correct set** → `{"ok":true,"rows":12,"flag":"RZ{…}","download":"/api/fragment/1/download?ticket=…"}`.
- `GET` the download link (HMAC ticket, 30-min TTL, bound to the accepted id set) →
  **`FRAGMENT_1.csv`**: 12 rows × the 5 fragment columns, sliced live from
  `PARENT_FINAL.csv` on every request.
- In-app, success plays the cinematic **FRAGMENT 01 recovery screen**: bar fill,
  `12 / 12 rows verified`, the flag, a copy/download control, one Custodian line and
  a `1 OF 4 RECOVERED` tease for the next zone.

---

## 3. Hint ladder (suggested CTFd text + costs)

The three hints are also shipped **inside the app** (right rail → "directive assist"
on `/archive`, revealed on click), so teams that never open CTFd still have a ladder.
If you use CTFd hints, mirror these texts verbatim so both channels agree:

1. **(10 pts)** — *hint 1, verbatim:*
   > The release gate evaluates *after* the read — every address the index knows
   > will answer the case API. The signer recipe needs values only that API holds,
   > so a full enumeration is unavoidable.
2. **(30 pts)** — *hint 2, verbatim:*
   > Attestations are bound to a synchronization event. The failed-attempt log under
   > the archived prefix lists exactly which references a submission must carry, and
   > the sync journal tells you which event compiled the manifest.
3. **(60 pts)** — *hint 3, verbatim:*
   > The manifest is authoritative but not final: cross its candidates against the
   > collection route, which only answers in its archived dialect — that dialect
   > holds the one column the directive cares about. Drop the falsified candidate
   > and attest the remaining set with token, ETag and event.

Hint 1 unblocks steps 1–4 (recon → token); hint 2 opens the system-artifact path
(step 7b); hint 3 breaks the manifest trap and names the submit mechanics. None of
the hints contains a route path, field name, id or secret — they point, they don't
answer.

---

## 4. Flag generation mechanism (and the flag for this build)

The flag is computed **server-side only** at submission time, from the exact accepted
id set. It never exists in any response, asset, or file before a correct solve.

```
flag = "RZ{" + sha256_hex(
          "RZ1::FRAGMENT1::" + sortedIds.join(",") + "::" + FLAG_SALT
       )[0:40] + "}"
```

- `sortedIds` = the 12 accepted ids, comma-joined, ascending.
- `FLAG_SALT` default (baked into `src/server.js`, never served): `pralaya::adjudication::r7`
- Changing any id (e.g., including the trap S021) changes the flag — it is bound to the
  exact answer set.

**Flag for this build (default dataset + default salt):**

```
RZ{ad88a47811ca5d67b4e14f8b299ef3f6a979660e}
```

Verification cross-checks (independent of app code): the Python snippet below must print
the same flag; `npm test` also asserts it:

```python
import csv, hashlib
rows = list(csv.DictReader(open("data/PARENT_FINAL.csv", encoding="utf-8-sig")))
ids = sorted(r["Sanctuary_ID"] for r in rows
             if r["Identity_Record_Status"] == "IDENTITY_VERIFIED"
             and r["Falsified_To_Protect_Flag"] == "False"
             and r["Signature_Valid_Flag"] == "True")
print("RZ{" + hashlib.sha256(
    ("RZ1::FRAGMENT1::" + ",".join(ids) + "::pralaya::adjudication::r7").encode()
).hexdigest()[:40] + "}")
```

**To rotate the flag:** set `FLAG_SALT` to a private value in `docker-compose.yml`, then
run `npm test` — it prints `FLAG FOR THIS BUILD: …` for the active salt.

---

## 5. How Fragment 1's rows were selected (and why the trap is excluded)

Selection rule (computed live from `data/PARENT_FINAL.csv` in `src/store.js`, never
hardcoded):

```
Identity_Record_Status == "IDENTITY_VERIFIED"
AND Falsified_To_Protect_Flag == "False"
AND Signature_Valid_Flag == "True"
```

**12 rows:** `S001 S024 S027 S046 S051 S054 S060 S073 S077 S084 S105 S120`

**Trap row — `S021` (Kabir Voss):** a genuine dataset row that is
`IDENTITY_VERIFIED` + `Signature_Valid_Flag=True` (passes 2 of 3, looks correct in
every privileged-looking view) but `Falsified_To_Protect_Flag=True` — it fails the
directive's "never falsified to protect someone" condition and must be excluded. It is
the row the recovery manifest wrongly includes.

Dataset facts that keep this fair (verified against the shipped CSV):

- Exactly 13 rows are `IDENTITY_VERIFIED`: the 12 above + S021 — so "verified + signed"
  is *precisely* the manifest's wrong 13.
- `Record_Alteration_Flag` and `Record_Authenticity_Score` are **not** discriminators:
  correct row **S054 also has `Record_Alteration_Flag=True`** and a *lower* authenticity
  score (0.820) than the trap (0.833). No heuristic shortcut exists — teams must get
  `Falsified_To_Protect_Flag` from the audit dialect.

**Delivery:** `FRAGMENT_1.csv` is sliced from `PARENT_FINAL.csv` **at request time**
(12 rows × columns `Sanctuary_ID, Original_Name, Original_Occupation, Original_Skills,
Original_Sector_Of_Residence`, ascending id). It can never drift from the source data;
there is no pre-baked copy anywhere in the repo or image.

---

## 6. CTFd configuration notes

| Field | Value |
|---|---|
| **Category** | `Red Zone` |
| **Name** | `PRALAYA Archive Terminal` (or `CTF 1 — PRALAYA Archive Terminal`) |
| **Flag type** | Static |
| **Flag** | `RZ{ad88a47811ca5d67b4e14f8b299ef3f6a979660e}` |
| **Case** | lowercase hex — enable "ignore case" for paste-safety anyway |
| **Value** | 300 (Red Zone entry; adjust to your difficulty curve) |
| **Tags** | `web`, `recon`, `crypto` |
| **Hints** | 3 hints, costs 10 / 30 / 60 (text in §3; also decryptable in-app) |
| **Max attempts** | unlimited (rejections are generic; no oracle) |
| **Cooldowns** | none needed |

**Deployment / reverse-proxy checklist**

- One shared instance is enough: the app is **stateless** (no sessions, no per-team
  state; tokens/tickets are self-contained HMACs).
- If fronting with nginx/Caddy/Traefik, ensure the proxy **passes through unchanged**:
  request `Accept` and `Authorization` headers, and response `Link`, `ETag`,
  `X-Manifest-Integrity`, `Content-Disposition` headers. (nginx: don't use
  `proxy_hide_header` for these; Cloudflare may normalize `ETag` — self-host preferred.)
- Publish port 8080 (or set `PORT`). HTTPS termination at the proxy is fine.
- The container needs **no outbound network access** — safe for isolated CTF infra.
- Health check: `GET /healthz` → `200 ok`.
- Fragments: teams copy/download `FRAGMENT_1.csv` from the app after the flag is
  accepted; if your Red Zone tracks fragment claims in a scoreboard sheet, award on
  screenshot of the success response (flag match already proves the solve).

**Do not** ship: `ORGANIZER_GUIDE.md`, `test/`, or `.env` files. `.dockerignore`
already excludes the guide and tests from the image; if you host the repo, keep it
private or strip them.

---

## 7. Test record & what still needs a human pass

### Automated coverage (all green — `npm test`, 114 checks)

- **Entry hero page:** `/` serves the boot/reveal page with its CTA to `/archive`;
  the boot sequence text and page markup are asserted to contain **no** field names,
  hidden route names, ids, key material or flag format; all internal nav links
  (archive, status, 404) point to `/archive` rather than `/`; the exploit chain, flag
  and fragment are byte-identical to the pre-upgrade build.
- **Workstation shell:** `/archive` serves the multi-panel UI (views, fragment overlay,
  server-rendered case cards), carries all three progressive hints, never names the
  withheld `Falsified_To_Protect_Flag` field, and names **no hidden discovery routes**
  (`/recovery/manifest`, `/recovery/channel`, `/api/cases`, `/api/fragment` all absent).
- **Full intended solve path**, participant perspective, no insider shortcuts:
  recon → 120-address IDOR enumeration → recipe-derived key → forged token →
  manifest (ETag, UNVERIFIED signals, 13 entries incl. S021) → system artifacts
  (journal SW-01..SW-06, attempt log codes, 410 channel) → 406/audit-dialect
  discovery → synthesis of the 12 → attestation (token + ETag + `X-Sync-Event: SW-03`)
  → flag → fragment download.
- **Sync-event gate:** missing / wrong (`SW-01`) / garbage event → 403 with **byte-identical**
  bodies (no oracle); the body points at `/api/system/sync-log` and contains no
  addresses or flag; correct event + wrong set → still generic 400.
- **System artifacts:** journal serves six ordered windows, `SW-03` is the aborted
  window whose note carries the manifest compile time and contains
  `manifest.generated` inside its window, windows account for all 120 records,
  journal/attempt log contain no record addresses, flag or withheld field, journal
  is read-only (405 on POST); `/recovery/channel` → 410 with
  `superseded_by: "POST /api/fragment/submit"`; `robots.txt` disallows the prefix
  and both artifacts.
- **Designed dead ends, asserted from the data:** custodian provenance mirrors
  alteration (57) not falsification (34), falsified ⊆ altered (provenance cannot
  discriminate); the 13 candidates spread across ≥ 4 journal windows (the event is
  not an oracle).
- **Flag:** format, equals independent hash of exact id set + salt, differs if the trap
  id is included.
- **Fragment:** exactly 5 columns, exactly 12 rows, exact id set, every cell matches
  `PARENT_FINAL.csv` verbatim (independent re-parse of the source file), trap absent.
- **Negative submissions:** no token / stale or wrong ETag / retired sample-token
  replay / missing or wrong sync event / malformed JSON / non-array ids /
  13-id manifest set / 11-id subset / one-id swap → all rejected, **generic**
  error, response never contains any id.
- **Containment:** `/src/*`, `/data/*`, traversal (`..`, `%2e%2e`, raw `..%2f` via
  raw sockets) blocked; no static asset (incl. `workstation.css`, `audio.js`) contains
  the flag format or the salt; `js/app.js` hardcodes none of the hidden discovery
  routes.
- **Edges:** unknown id → 404, malformed id → 400, empty id → 400, wrong method → 405,
  oversized body → 413, styled 404 without spoiling the hidden route.
- **Independent crypto cross-check:** key + flag + manifest ETag recomputed in Python
  from data only — matches the Node server byte-for-byte.
- **UI pass (Chromium via Playwright):** boot sequence on `/`, all seven workstation
  views, case-card → forensics navigation, matrix scan, the full solve through the
  in-app recovery console to the fragment overlay, status page, 404, mobile 390 px;
  zero CSP violations and zero console/page errors (the only logged "error" is the
  intentional 404 document). Hero-specific behavioral pass: progressive line reveal,
  skip control jumps to the reveal and moves focus to the CTA, repeat visit in the
  same tab starts revealed, `prefers-reduced-motion` renders instantly with zero
  running animations, keyboard Tab → Skip → Enter → CTA navigates to `/archive`,
  no mobile overflow.
- **Leak greps:** `api/cases` appears in no static asset; `Falsified_To_Protect_Flag`
  appears in no served page, template or client script (only the audit CSV dialect,
  which is the point); the flag format and salt appear in no static asset.

### Needs a human pass before the event

1. **Blind solver test** — give the URL (nothing else) to someone who hasn't seen this
   guide; measure whether they reach the flag within the event budget and whether the
   hint ladder, if bought, unblocks them at each stage. This is the single most
   important remaining check.
2. **Docker build on event infra** — Docker is not installed on the build machine, so
   the Dockerfile/compose were reviewed but not executed. Run
   `docker compose up --build` on a Linux host and re-run `npm test` against it before
   go-live.
3. **Reverse-proxy header behavior** — if you front the app, verify `ETag`,
   `Link`, `Accept` pass through (see §6) on the actual stack.
4. **Browser spot-check** — only Chromium was screenshot-tested; give Firefox/WebKit a
   quick look (no exotic APIs used, low risk).
5. **Keyboard/screen-reader pass** — focus order, skip link, `aria-live` lookup status
   were implemented but should get a 5-minute human accessibility review.
6. **Load sanity** — enumeration is ~120 requests per team; Node handles this easily,
   but if you expect hundreds of simultaneous teams, do a quick concurrency run and
   consider a cache-friendly `Cache-Control` policy (currently `no-store` by design).

---

## 8. Design notes (why it's not solvable by pasting into an AI)

- **No single leaked secret.** The signing key doesn't exist anywhere on disk — it is
  recomputed at boot from dataset values (`Evidence_Fragment_Count` sums) that a
  participant can only obtain by doing the IDOR enumeration themselves.
- **Two independent discovery paths.** robots.txt + derived-HMAC token forging
  (cryptographic) vs. `Link` header + HTTP content negotiation (protocol recon). The
  second hidden source is unreachable by re-using the first technique.
- **The authoritative source is wrong on purpose.** The manifest is the privileged,
  token-gated answer — and it contains S021. Its own integrity fields (UNVERIFIED,
  12-of-13 countersigned) say "don't trust me"; correcting it *requires* the second
  source that holds the column stripped from step 2.
- **Flag bound to the exact answer set** (hash of sorted ids + server-side salt);
  failed submissions return one generic error with zero per-item feedback.
- **Three references, one binding (step 7b).** Token + ETag + sync event must all be
  carried; each missing reference gets its own explanatory 403 that teaches *what* to
  find next (never *which value*). The correct event value (`SW-03`) is derived by
  correlating the manifest's `generated` timestamp with the journal windows — a
  reasoning step, not a lookup: four other windows look equally plausible from the
  records alone (candidates are spread across them).
- **The provenance dead end.** `provenance`/`sync_event` on every record invite
  correlation but cannot discriminate: CUSTODIAN-7 covers 57 altered records vs the
  34 falsified, and the candidates span four windows. Teams that chase them learn
  the falsification column must live somewhere else — which is exactly the audit
  dialect's lesson.
- **UI as narration, not hint.** The workstation only ever displays data the API
  already serves (cards, timelines, journal tables are rendered server-side from the
  same projections). The state pill (`LOCKED → PARTIAL → CHANNEL → AUTHORIZED`), the
  network panel and the event stream react to what the player does; five sparse
  Custodian messages appear at moments of friction (12th probe, first manifest 403,
  generic rejection, discovered dialect) — atmosphere and pacing, never solutions.
- **Client-side honesty.** `js/app.js` hardcodes only routes the interface itself
  exposes; the manifest, audit and submit routes are typed in by the player. The
  server enforces every rule regardless, so reading the client source yields no
  shortcut (asserted by the test suite).
- **Intentional surface is contained:** the only vulnerabilities are the documented
  IDOR, the missing authz on the manifest (gated by a *derivable* key), and content
  negotiation — all deliberate, all inside this service. Static hosting can't reach
  source, data, env, or salt.
