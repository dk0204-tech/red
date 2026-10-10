'use strict';
/*
 * Server-side flag validation for CTF 5 — THE LAST GATEKEEPER: SPLIT SEAL.
 *
 * The expected flag exists only as a SHA-256 commitment (config.js). A
 * candidate (either submitted through POST /api/flag, or observed on a live
 * challenge session) is hashed and compared in constant time. The literal
 * answer never appears in this codebase and is never sent to a client.
 */
const crypto = require('crypto');
const cfg = require('./config');

function safeEqualHex(aHex, bHex) {
  if (typeof aHex !== 'string' || typeof bHex !== 'string') return false;
  if (aHex.length !== bHex.length || aHex.length === 0) return false;
  try {
    const a = Buffer.from(aHex, 'hex');
    const b = Buffer.from(bHex, 'hex');
    if (a.length !== b.length || a.length === 0) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Returns true when `candidate` is the expected flag for this challenge. */
function isValidFlag(candidate) {
  if (typeof candidate !== 'string') return false;
  const value = candidate.trim();
  if (!cfg.FLAG_RE.test(value)) return false;
  const digest = crypto.createHash('sha256').update(value, 'utf8').digest('hex');
  return safeEqualHex(digest, cfg.expectedDigest());
}

/**
 * Scans service output for flag-shaped strings and validates each against
 * the commitment. Used to award completion when the gatekeeper actually
 * emits the fragment on a live session. Returns the valid candidate or null.
 */
function findFlagInOutput(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  const re = /RZ\{[A-Za-z0-9_-]{6,64}\}/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (isValidFlag(m[0])) return m[0];
  }
  return null;
}

module.exports = { isValidFlag, findFlagInOutput, safeEqualHex };
