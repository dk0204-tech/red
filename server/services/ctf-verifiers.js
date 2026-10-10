/* ==========================================================================
   CTF FLAG VERIFIERS — server-authoritative, per-challenge.

   The main game never judges a flag itself and never ships an expected value
   to a browser. For every CTF this module reuses the challenge's OWN
   authoritative logic, which already lives inside its project folder:

     CTF 1  GHOST SIGNAL      red-zone-ctf1/…/src/security.js deriveFlag()
     CTF 2  SANCTUARY ARCHIVE Red Zone CTF 2/backend/puzzle.js expectedFlag()
     CTF 3  CHILD DATASET     Red Zone CTF 3/backend/puzzle.js expectedFlag()
     CTF 4  CENTRAL ATRIUM    Bonus CTF/server/engine.js  FLAG (bonus)
     CTF 5  BIOARCHIVE        CTF 5 …/server/validate.js isValidFlag()

   CTF 5 stores only a one-way SHA-256 commitment, so it validates the
   candidate directly. The other four derive their expected flag from their
   own read-only datasets (or their documented env override) and are compared
   here with a constant-time digest comparison.

   Nothing in here is ever exposed over HTTP: only verify() is exported, and
   it returns a verdict — never the expected value.
   ========================================================================== */
'use strict';

const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');

/* The five sequential in-world terminals (zone ids match index.html ZONES). */
const CTF_META = Object.freeze({
    1: { slug: 'ghost-signal', name: 'GHOST SIGNAL', zone: 'zone_bridge' },
    2: { slug: 'sanctuary-archive', name: 'SANCTUARY ARCHIVE', zone: 'zone_vault' },
    3: { slug: 'child-dataset', name: 'CHILD DATASET', zone: 'zone_ai' },
    4: { slug: 'central-atrium', name: 'CENTRAL ATRIUM', zone: 'zone_atrium', bonus: true },
    5: { slug: 'bioarchive', name: 'BIOARCHIVE', zone: 'zone_bio' }
});

/* Absolute paths to the sibling challenge projects (never renamed/moved). */
const P = {
    ctf1Store: path.join(ROOT, 'red-zone-ctf1', 'red-zone-ctf1', 'src', 'store.js'),
    ctf1Security: path.join(ROOT, 'red-zone-ctf1', 'red-zone-ctf1', 'src', 'security.js'),
    ctf2Store: path.join(ROOT, 'Red Zone CTF 2', 'backend', 'store.js'),
    ctf2Puzzle: path.join(ROOT, 'Red Zone CTF 2', 'backend', 'puzzle.js'),
    ctf2Csv: path.join(ROOT, 'Red Zone CTF 2', 'data', 'PARENT_FINAL.csv'),
    ctf3Store: path.join(ROOT, 'Red Zone CTF 3', 'backend', 'store.js'),
    ctf3Puzzle: path.join(ROOT, 'Red Zone CTF 3', 'backend', 'puzzle.js'),
    ctf3Parent: path.join(ROOT, 'Red Zone CTF 3', 'data', 'PARENT_FINAL.csv'),
    ctf3Child: path.join(ROOT, 'Red Zone CTF 3', 'data', 'CHILD_FINAL.csv'),
    ctf4Engine: path.join(ROOT, 'Bonus CTF', 'server', 'engine.js'),
    ctf5Validate: path.join(ROOT, 'CTF 5 - THE LAST GATEKEEPER', 'server', 'validate.js')
};

/* ---------------------------------------------------------------- helpers */

/** Constant-time comparison of two arbitrary strings (via fixed-size digests). */
function safeEqual(a, b) {
    const da = crypto.createHash('sha256').update(String(a), 'utf8').digest();
    const db = crypto.createHash('sha256').update(String(b), 'utf8').digest();
    return crypto.timingSafeEqual(da, db);
}

/* Authoritative expected flag per CTF, derived lazily once and cached.
   A derivation failure is never cached — it is reported as unavailable so the
   player's progress can never be granted by a broken verifier. */
const expectedCache = Object.create(null);

function deriveExpected(ctf) {
    if (expectedCache[ctf]) return expectedCache[ctf];

    if (ctf === 1) {
        const store = require(P.ctf1Store);
        const security = require(P.ctf1Security);
        const data = store.load();                       // self-contained read-only load
        const salt = process.env.FLAG_SALT || 'pralaya::adjudication::r7';
        expectedCache[ctf] = security.deriveFlag(data.fragmentIds, salt);
        return expectedCache[ctf];
    }

    if (ctf === 2) {
        const { Store } = require(P.ctf2Store);
        const puzzle = require(P.ctf2Puzzle);
        const store = Store(P.ctf2Csv);
        expectedCache[ctf] = puzzle.expectedFlag(store.rows, process.env);
        return expectedCache[ctf];
    }

    if (ctf === 3) {
        const { Store } = require(P.ctf3Store);
        const puzzle = require(P.ctf3Puzzle);
        const store = Store(P.ctf3Parent, P.ctf3Child);
        expectedCache[ctf] = puzzle.expectedFlag(store, process.env);
        return expectedCache[ctf];
    }

    if (ctf === 4) {
        const engine = require(P.ctf4Engine);
        expectedCache[ctf] = engine.FLAG;
        return expectedCache[ctf];
    }

    throw new Error('no derivation for ctf ' + ctf);
}

/* ------------------------------------------------------------------ API */

/** True when `ctf` is one of the five in-world terminals. */
function isKnownCtf(ctf) {
    return Number.isInteger(ctf) && Object.prototype.hasOwnProperty.call(CTF_META, ctf);
}

function meta(ctf) {
    return isKnownCtf(ctf) ? CTF_META[ctf] : null;
}

/**
 * Verify a submitted flag against one specific challenge.
 *
 * @returns {{ ok: boolean, reason: 'match'|'mismatch'|'empty'|'too_long'|'unavailable' }}
 *   `unavailable` means the challenge's own verifier/data could not be read —
 *   the caller must treat that as "not verified" and never grant completion.
 */
function verify(ctf, candidate) {
    if (!isKnownCtf(ctf)) return { ok: false, reason: 'unavailable' };

    const flag = typeof candidate === 'string' ? candidate.trim() : '';
    if (!flag) return { ok: false, reason: 'empty' };
    if (flag.length > 200) return { ok: false, reason: 'too_long' };

    try {
        if (ctf === 5) {
            const validate = require(P.ctf5Validate);     // one-way commitment
            return validate.isValidFlag(flag)
                ? { ok: true, reason: 'match' }
                : { ok: false, reason: 'mismatch' };
        }

        const expected = deriveExpected(ctf);
        if (typeof expected !== 'string' || !expected) {
            return { ok: false, reason: 'unavailable' };
        }
        return safeEqual(flag, expected)
            ? { ok: true, reason: 'match' }
            : { ok: false, reason: 'mismatch' };
    } catch (err) {
        // Missing dataset / module, unreadable file, bad derivation — never a pass.
        return { ok: false, reason: 'unavailable', error: err && err.message };
    }
}

module.exports = { CTF_META, isKnownCtf, meta, verify };
