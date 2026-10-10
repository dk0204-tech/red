'use strict';
/*
 * Durable completion state for CTF 5 — THE LAST GATEKEEPER: SPLIT SEAL.
 *
 * Completion is recorded SERVER SIDE only, and only after server-side flag
 * validation (either a correct submission or an observed live exploit).
 * Toggling anything in the browser cannot mark the challenge solved.
 *
 * State is stored as JSON under server/data/ (override with DATA_DIR).
 */
const fs = require('fs');
const path = require('path');
const cfg = require('./config');

const FILE = () => path.join(cfg.DATA_DIR, 'progress.json');

const EMPTY = { solved: false, solvedAt: null, method: null, awards: 0 };

let cache = null;

function load() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(FILE(), 'utf8');
    const data = JSON.parse(raw);
    cache = Object.assign({}, EMPTY, data);
  } catch {
    cache = Object.assign({}, EMPTY);
  }
  return cache;
}

function persist() {
  const file = FILE();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

/**
 * Records a successful completion. Idempotent: the first accepted method
 * wins the timestamp; every accepted validation still increments `awards`.
 * Returns true when this call flipped the state from unsolved to solved.
 */
function award(method) {
  const state = load();
  state.awards = (state.awards || 0) + 1;
  if (!state.solved) {
    state.solved = true;
    state.solvedAt = new Date().toISOString();
    state.method = method || 'unknown';
    persist();
    return true;
  }
  persist();
  return false;
}

function state() {
  const s = load();
  return { solved: !!s.solved, solvedAt: s.solvedAt, method: s.method || null };
}

/** Organizer utility: wipe completion state (npm run start:reset style). */
function reset() {
  cache = Object.assign({}, EMPTY);
  try {
    fs.unlinkSync(FILE());
  } catch { /* already gone */ }
}

module.exports = { award, state, reset, load };
