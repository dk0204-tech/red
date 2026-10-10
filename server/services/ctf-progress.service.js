/* ==========================================================================
   CTF PROGRESS — server-authoritative player progression for the 5 terminals.

   Why this and not the team tables: the live game has NO account system (the
   legacy HUD is a local-only single-player shell; the `teams`/`users` schema
   belongs to the not-yet-wired event platform in docs/REFACTOR_PLAN.md). To
   make verification genuinely server-authoritative without inventing logins,
   the server issues a signed, anonymous, per-browser session and owns every
   completion bit for it.

   • Session token:  <random-id>.<HMAC-SHA256(JWT_SECRET, "ctf:"+id)>
     The client can present it but cannot forge or edit it, so it can never
     unlock another session or claim a solve directly.
   • Completions are written ONLY by the verify endpoint after a flag is
     validated against the challenge's own authoritative logic.
   • Storage: a small JSON document under .data/ (the project's local data
     directory, alongside the embedded Postgres files). Writes are atomic
     (tmp file + rename). Progress survives game restarts, challenge
     restarts, and browser refreshes.

   Unlock order (exact, no extra prerequisites):
     1 → unlocks 2 → unlocks 3 → unlocks 4 AND 5 SIMULTANEOUSLY.
     CTF 4 is an optional bonus and gates nothing; CTF 5 gates the final exit.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const env = require('../config/env');

const DATA_DIR = path.join(env.ROOT, '.data');
/* CTF_PROGRESS_FILE lets the test suite (and a second instance) use its own
   store; production always uses .data/ctf-progress.json. */
const STORE_FILE = process.env.CTF_PROGRESS_FILE
    ? path.resolve(process.env.CTF_PROGRESS_FILE)
    : path.join(DATA_DIR, 'ctf-progress.json');

const CTF_IDS = [1, 2, 3, 4, 5];
const MANDATORY_IDS = [1, 2, 3, 5];        // CTF 4 is the optional bonus

/* Verified-completion bookkeeping only — never flags or answers. */
const SCHEMA_VERSION = 1;

let cache = null;                          // in-memory mirror of STORE_FILE

/* --------------------------------------------------------------- storage */

function emptyDoc() {
    return { v: SCHEMA_VERSION, sessions: {} };
}

function load() {
    if (cache) return cache;
    try {
        const raw = fs.readFileSync(STORE_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        cache = parsed && parsed.sessions && typeof parsed.sessions === 'object'
            ? { v: SCHEMA_VERSION, sessions: parsed.sessions }
            : emptyDoc();
    } catch (err) {
        cache = emptyDoc();                // missing/corrupt file → clean slate
    }
    return cache;
}

function save() {
    const doc = load();
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        const tmp = STORE_FILE + '.' + process.pid + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf8');
        fs.renameSync(tmp, STORE_FILE);
    } catch (err) {
        /* A failed write must never fabricate progress — the in-memory copy
           still reflects only verifier-approved solves, and the caller is
           told persistence failed so it can surface a 503 instead of a lie. */
        throw err;
    }
}

/* --------------------------------------------------------------- session */

const ID_RE = /^[a-f0-9]{32}$/;

function hmac(id) {
    return crypto.createHmac('sha256', env.JWT_SECRET || 'dev-only-insecure-secret-change-me')
        .update('ctf-session:' + id)
        .digest('base64url')
        .slice(0, 32);
}

function safeEqualStr(a, b) {
    const da = crypto.createHash('sha256').update(String(a)).digest();
    const db = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(da, db);
}

/** Mint a fresh signed session token. */
function issueSession() {
    const id = crypto.randomBytes(16).toString('hex');
    return { id: id, token: id + '.' + hmac(id) };
}

/**
 * Validate a presented token. Returns the session id or null.
 * A forged/edited/short token never resolves to a session.
 */
function parseToken(token) {
    if (typeof token !== 'string' || token.length > 128) return null;
    const dot = token.indexOf('.');
    if (dot < 1) return null;
    const id = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    if (!ID_RE.test(id) || !sig) return null;
    if (!safeEqualStr(sig, hmac(id))) return null;
    return id;
}

function record(sessionId, create) {
    const doc = load();
    let session = doc.sessions[sessionId];
    if (!session) {
        if (!create) return null;
        session = doc.sessions[sessionId] = { solved: {}, createdAt: new Date().toISOString() };
    }
    if (!session.solved || typeof session.solved !== 'object') session.solved = {};
    return session;
}

/* ------------------------------------------------------------- progress */

function has(solvedIds, n) {
    return solvedIds.indexOf(n) !== -1;
}

/** Exact unlock rule — the single place progression is decided. */
function unlockedOf(solvedIds) {
    const unlocked = [1];
    if (has(solvedIds, 1)) unlocked.push(2);
    if (has(solvedIds, 1) && has(solvedIds, 2)) unlocked.push(3);
    if (has(solvedIds, 1) && has(solvedIds, 2) && has(solvedIds, 3)) unlocked.push(4, 5);
    return unlocked;
}

function solvedIdsOf(session) {
    const solved = (session && session.solved) || {};
    return CTF_IDS.filter(n => !!solved[String(n)]);
}

/** Full progress payload for a session id (creating it when asked). */
function stateOf(sessionId, create) {
    const session = record(sessionId, !!create);
    const solved = session ? solvedIdsOf(session) : [];
    const unlocked = session ? unlockedOf(solved) : [1];
    const solvedCount = solved.length;
    return {
        sessionId: sessionId,
        solved: solved,
        unlocked: unlocked,
        solvedCount: solvedCount,
        totalCount: CTF_IDS.length,
        restoration: Math.round((solvedCount / CTF_IDS.length) * 100),
        /* Reward / unlock flags the UI reads (all derived, never client-supplied) */
        childDatasetUnlocked: has(solved, 3),
        ctf4Unlocked: has(solved, 3),
        ctf5Unlocked: has(solved, 3),
        parentDatasetUnlocked: has(solved, 5),
        finalExitUnlocked: has(solved, 5),
        mandatoryComplete: MANDATORY_IDS.every(n => has(solved, n)),
        updatedAt: (session && session.updatedAt) || null
    };
}

function isUnlocked(sessionId, ctf) {
    return stateOf(sessionId, false).unlocked.indexOf(ctf) !== -1;
}

function isSolved(sessionId, ctf) {
    return stateOf(sessionId, false).solved.indexOf(ctf) !== -1;
}

/**
 * Record a verified completion. Idempotent: repeat submissions never
 * duplicate or regress progress. Returns { alreadySolved, state }.
 */
function markSolved(sessionId, ctf) {
    const session = record(sessionId, true);
    const key = String(ctf);
    const alreadySolved = !!session.solved[key];
    if (!alreadySolved) {
        session.solved[key] = new Date().toISOString();
        session.updatedAt = new Date().toISOString();
        save();
    }
    return { alreadySolved: alreadySolved, state: stateOf(sessionId, false) };
}

/* ------------------------------------------------------- attempt limiter */

/* Per-session sliding window so a wrong flag cannot be brute-forced.
   Purely in-memory (resets on restart) — a backstop, not the security model. */
const attempts = new Map();                 // sessionId → [timestamps]
const WINDOW_MS = 60 * 1000;
const MAX_ATTEMPTS = 12;

function noteAttempt(sessionId) {
    const now = Date.now();
    const list = (attempts.get(sessionId) || []).filter(t => now - t < WINDOW_MS);
    list.push(now);
    attempts.set(sessionId, list);
    return { ok: list.length <= MAX_ATTEMPTS, retryAfterMs: WINDOW_MS };
}

/* ------------------------------------------------------------- rewards */

/* The REAL datasets already shipped with the challenges — never copied,
   never regenerated, never modified. Child = CTF 3 dataset, Parent = CTF 2. */
const REWARDS = Object.freeze({
    child: {
        requiredCtf: 3,
        file: path.join(env.ROOT, 'Red Zone CTF 3', 'data', 'CHILD_FINAL.csv'),
        filename: 'CHILD_FINAL.csv'
    },
    parent: {
        requiredCtf: 5,
        file: path.join(env.ROOT, 'Red Zone CTF 2', 'data', 'PARENT_FINAL.csv'),
        filename: 'PARENT_FINAL.csv'
    }
});

/**
 * Resolve a reward for download. Returns:
 *   { ok:true, file, filename } | { ok:false, status, code }
 * Authorization is the server's own verified progress — never the button.
 */
function reward(sessionId, which) {
    const spec = REWARDS[which];
    if (!spec) return { ok: false, status: 404, code: 'unknown_reward' };
    if (!isSolved(sessionId, spec.requiredCtf)) {
        return { ok: false, status: 403, code: 'not_earned' };
    }
    if (!fs.existsSync(spec.file)) {
        return { ok: false, status: 500, code: 'dataset_missing' };
    }
    return { ok: true, file: spec.file, filename: spec.filename };
}

module.exports = {
    CTF_IDS,
    issueSession,
    parseToken,
    stateOf,
    unlockedOf,
    isUnlocked,
    isSolved,
    markSolved,
    noteAttempt,
    reward,
    _storeFile: STORE_FILE
};
