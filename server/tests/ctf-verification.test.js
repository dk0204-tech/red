/* ==========================================================================
   CTF verification + progression tests (node:test).

   Run:  npm test          (root package → node --test server/tests/)

   Covers the pieces the whole event rests on:
     • every challenge's OWN flag is accepted by the server verifier, and a
       wrong / empty / cross-challenge flag never is
     • the exact unlock order (3 ⇒ 4 AND 5 simultaneously; 4 gates nothing)
     • session tokens cannot be forged or edited
     • progression is idempotent and rewards stay locked until earned
     • the real CHILD / PARENT datasets exist and back the authorized download

   The verifier reuses each challenge's own logic, so the "expected" flags in
   this suite are derived from those same challenge modules/datasets — that is
   exactly the integration under test. Nothing here is written into the game,
   and no expected flag is ever exposed over HTTP.
   ========================================================================== */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

/* Isolate the progress store BEFORE the service is loaded. */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tld-ctf-test-'));
process.env.CTF_PROGRESS_FILE = path.join(TMP, 'progress.json');

const ROOT = path.join(__dirname, '..', '..');
const verifiers = require('../services/ctf-verifiers');
const progress = require('../services/ctf-progress.service');

/* ------------------------------------------------- authoritative flags ---
   Derived from each challenge's own project, the same way a solved player
   would obtain them. */
function challengeFlags() {
    const ctf1Store = require(path.join(ROOT, 'red-zone-ctf1', 'red-zone-ctf1', 'src', 'store.js'));
    const ctf1Security = require(path.join(ROOT, 'red-zone-ctf1', 'red-zone-ctf1', 'src', 'security.js'));
    const f1 = ctf1Security.deriveFlag(ctf1Store.load().fragmentIds, process.env.FLAG_SALT || 'pralaya::adjudication::r7');

    const ctf2 = require(path.join(ROOT, 'Red Zone CTF 2', 'backend', 'store.js'));
    const puzzle2 = require(path.join(ROOT, 'Red Zone CTF 2', 'backend', 'puzzle.js'));
    const f2 = puzzle2.expectedFlag(ctf2.Store(path.join(ROOT, 'Red Zone CTF 2', 'data', 'PARENT_FINAL.csv')).rows, {});

    const ctf3 = require(path.join(ROOT, 'Red Zone CTF 3', 'backend', 'store.js'));
    const puzzle3 = require(path.join(ROOT, 'Red Zone CTF 3', 'backend', 'puzzle.js'));
    const f3 = puzzle3.expectedFlag(ctf3.Store(
        path.join(ROOT, 'Red Zone CTF 3', 'data', 'PARENT_FINAL.csv'),
        path.join(ROOT, 'Red Zone CTF 3', 'data', 'CHILD_FINAL.csv')
    ), {});

    const f4 = require(path.join(ROOT, 'Bonus CTF', 'server', 'engine.js')).FLAG;

    return { 1: f1, 2: f2, 3: f3, 4: f4 };
}

const FLAGS = challengeFlags();
const WRONG = 'RZ{definitely_not_the_flag_0000}';

/* ------------------------------------------------------- flag verifiers --- */

test('each challenge accepts its own flag', () => {
    for (const ctf of [1, 2, 3, 4]) {
        const out = verifiers.verify(ctf, FLAGS[ctf]);
        assert.strictEqual(out.ok, true, `CTF ${ctf} should accept its own flag`);
    }
});

test('a wrong flag never verifies on any challenge', () => {
    for (const ctf of [1, 2, 3, 4, 5]) {
        const out = verifiers.verify(ctf, WRONG);
        assert.strictEqual(out.ok, false, `CTF ${ctf} must reject a wrong flag`);
        assert.notStrictEqual(out.reason, 'match');
    }
});

test('empty / whitespace / over-long submissions are rejected', () => {
    assert.strictEqual(verifiers.verify(1, '').ok, false);
    assert.strictEqual(verifiers.verify(1, '    ').ok, false);
    assert.strictEqual(verifiers.verify(3, null).ok, false);
    assert.strictEqual(verifiers.verify(4, 'RZ{' + 'a'.repeat(400) + '}').ok, false);
});

test('a flag cannot complete a different challenge', () => {
    for (const [fromCtf, flag] of Object.entries(FLAGS)) {
        for (const toCtf of [1, 2, 3, 4, 5]) {
            if (String(toCtf) === String(fromCtf)) continue;
            assert.strictEqual(
                verifiers.verify(toCtf, flag).ok, false,
                `CTF ${fromCtf}'s flag must not verify as CTF ${toCtf}`
            );
        }
    }
});

test('unknown CTF ids are rejected', () => {
    assert.strictEqual(verifiers.isKnownCtf(0), false);
    assert.strictEqual(verifiers.isKnownCtf(6), false);
    assert.strictEqual(verifiers.isKnownCtf('2'), false);
    assert.strictEqual(verifiers.verify(9, FLAGS[1]).ok, false);
});

/* ---------------------------------------------------- progression rules --- */

test('unlock order: 1 → 2 → 3 → (4 AND 5 simultaneously)', () => {
    assert.deepStrictEqual(progress.unlockedOf([]), [1]);
    assert.deepStrictEqual(progress.unlockedOf([1]), [1, 2]);
    assert.deepStrictEqual(progress.unlockedOf([1, 2]), [1, 2, 3]);
    assert.deepStrictEqual(progress.unlockedOf([1, 2, 3]), [1, 2, 3, 4, 5]);
});

test('CTF 4 is optional and gates nothing; CTF 5 needs CTF 3', () => {
    // Solving the bonus alone unlocks nothing beyond the chain state.
    assert.deepStrictEqual(progress.unlockedOf([1, 2, 3, 4]), [1, 2, 3, 4, 5]);
    assert.deepStrictEqual(progress.unlockedOf([1, 2, 4]), [1, 2, 3]);
    // CTF 5 is never reachable before CTF 3.
    assert.strictEqual(progress.unlockedOf([1, 2]).includes(5), false);
    assert.strictEqual(progress.unlockedOf([1, 2, 4]).includes(5), false);
});

/* ------------------------------------------------------------- sessions --- */

test('session tokens are signed: forged or edited tokens never resolve', () => {
    const issued = progress.issueSession();
    assert.strictEqual(progress.parseToken(issued.token), issued.id);

    // edited signature, edited id, missing signature, junk
    assert.strictEqual(progress.parseToken(issued.id + '.deadbeefdeadbeefdeadbeefdeadbeef'), null);
    assert.strictEqual(progress.parseToken('f'.repeat(32) + issued.token.slice(32)), null);
    assert.strictEqual(progress.parseToken(issued.id), null);
    assert.strictEqual(progress.parseToken(''), null);
    assert.strictEqual(progress.parseToken(null), null);
    assert.strictEqual(progress.parseToken(12345), null);
});

test('a fresh session exposes nothing and unlocks only CTF 1', () => {
    const { id } = progress.issueSession();
    const state = progress.stateOf(id, true);
    assert.deepStrictEqual(state.solved, []);
    assert.deepStrictEqual(state.unlocked, [1]);
    assert.strictEqual(state.childDatasetUnlocked, false);
    assert.strictEqual(state.ctf4Unlocked, false);
    assert.strictEqual(state.ctf5Unlocked, false);
    assert.strictEqual(state.parentDatasetUnlocked, false);
    assert.strictEqual(state.finalExitUnlocked, false);
    assert.strictEqual(state.mandatoryComplete, false);
});

/* ------------------------------------------------------------ rewards --- */

test('rewards stay locked until the matching flag is verified', () => {
    const { id } = progress.issueSession();
    progress.stateOf(id, true);                       // create the session

    assert.strictEqual(progress.reward(id, 'child').ok, false);
    assert.strictEqual(progress.reward(id, 'parent').ok, false);
    assert.strictEqual(progress.reward(id, 'child').status, 403);

    progress.markSolved(id, 1);
    assert.strictEqual(progress.reward(id, 'child').ok, false, 'CTF 1 must not release the Child Dataset');
    progress.markSolved(id, 2);
    assert.strictEqual(progress.reward(id, 'child').ok, false, 'CTF 2 must not release the Child Dataset');

    progress.markSolved(id, 3);
    assert.strictEqual(progress.reward(id, 'child').ok, true, 'CTF 3 releases the Child Dataset');
    assert.strictEqual(progress.reward(id, 'parent').ok, false, 'CTF 3 must not release the Parent Dataset');

    progress.markSolved(id, 5);
    assert.strictEqual(progress.reward(id, 'parent').ok, true, 'CTF 5 releases the Parent Dataset');
    assert.strictEqual(progress.reward(id, 'nonsense').ok, false);
    assert.strictEqual(progress.reward(id, 'nonsense').status, 404);
});

test('progression is idempotent and never regresses', () => {
    const { id } = progress.issueSession();
    progress.stateOf(id, true);
    progress.markSolved(id, 1);
    const first = progress.stateOf(id, false).solved.slice();
    progress.markSolved(id, 1);
    const again = progress.markSolved(id, 1);
    assert.strictEqual(again.alreadySolved, true);
    assert.deepStrictEqual(progress.stateOf(id, false).solved, first);
});

test('the reward payload points at the REAL shipped datasets', () => {
    const { id } = progress.issueSession();
    progress.stateOf(id, true);
    progress.markSolved(id, 3);
    progress.markSolved(id, 5);

    const child = progress.reward(id, 'child');
    const parent = progress.reward(id, 'parent');
    assert.strictEqual(child.filename, 'CHILD_FINAL.csv');
    assert.strictEqual(parent.filename, 'PARENT_FINAL.csv');

    for (const r of [child, parent]) {
        assert.ok(fs.existsSync(r.file), r.filename + ' must exist');
        const head = fs.readFileSync(r.file, 'utf8').split('\n')[0];
        assert.ok(head.includes('Sanctuary_ID'), r.filename + ' must be the real dataset');
    }

    // The Child dataset is CTF 3's; the Parent dataset is CTF 2's (never a copy).
    assert.strictEqual(child.file, path.join(ROOT, 'Red Zone CTF 3', 'data', 'CHILD_FINAL.csv'));
    assert.strictEqual(parent.file, path.join(ROOT, 'Red Zone CTF 2', 'data', 'PARENT_FINAL.csv'));
});

test('ratcheting the attempt limiter blocks a brute force', () => {
    const { id } = progress.issueSession();
    progress.stateOf(id, true);
    let blocked = false;
    for (let i = 0; i < 40; i++) {
        if (!progress.noteAttempt(id).ok) { blocked = true; break; }
    }
    assert.strictEqual(blocked, true, 'repeated wrong flags must eventually be rate limited');
});
