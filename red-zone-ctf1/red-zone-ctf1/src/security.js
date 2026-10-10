"use strict";

/**
 * Cryptographic primitives for the recovery chain.
 *
 * - The signer key is DERIVED from the dataset (see store.signerRecipe), never
 *   stored in a file, env var or blob a participant could simply read out.
 * - Tokens, download tickets and the flag are all HMAC/hash constructions
 *   computed server-side at request time.
 */

const crypto = require("crypto");

const TOKEN_HEADER = "PRT1";

/** Key used only to sign the expired sample token shown on /status.
 *  The server never verifies against it, so it cannot be replayed. */
const RETIRED_KEY = "PRALAYA-RETIRED-KEY-2019";

function sha256Hex(input) {
  return crypto.createHash("sha256").update(String(input), "utf8").digest("hex");
}

function hmacRaw(key, message) {
  return crypto.createHmac("sha256", key).update(String(message), "utf8").digest();
}

function hmacBase64Url(key, message) {
  return hmacRaw(key, message).toString("base64url");
}

function b64urlEncode(value) {
  return Buffer.from(String(value), "utf8").toString("base64url");
}

function b64urlDecode(value) {
  return Buffer.from(String(value), "base64url").toString("utf8");
}

/** SIGNER-01: key = sha256_hex(recipe string) — recipe built from real data. */
function deriveSignerKey(recipeString) {
  return sha256Hex(recipeString);
}

/** Token/ticket format: PRT1.<payload-b64url>.<hmac-b64url(message "PRT1."+payload)> */
function signPayload(key, payloadObject) {
  const payload = b64urlEncode(JSON.stringify(payloadObject));
  const message = `${TOKEN_HEADER}.${payload}`;
  const sig = hmacBase64Url(key, message);
  return `${message}.${sig}`;
}

function verifySignedToken(raw, key, requiredScope) {
  const fail = (reason) => ({ ok: false, reason });
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 8192) {
    return fail("malformed");
  }
  const parts = raw.trim().split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_HEADER) return fail("malformed");
  if (!/^[A-Za-z0-9_-]+$/.test(parts[1]) || !/^[A-Za-z0-9_-]+$/.test(parts[2])) {
    return fail("malformed");
  }

  const expected = hmacRaw(key, `${TOKEN_HEADER}.${parts[1]}`);
  const given = Buffer.from(parts[2], "base64url");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return fail("bad-signature");
  }

  let payload;
  try {
    payload = JSON.parse(b64urlDecode(parts[1]));
  } catch {
    return fail("bad-payload");
  }
  if (!payload || typeof payload !== "object") return fail("bad-payload");

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || now > payload.exp) return fail("expired");
  if (typeof payload.iat === "number" && payload.iat > now + 300) return fail("not-yet-valid");

  if (requiredScope) {
    const scopes = Array.isArray(payload.scope) ? payload.scope : [];
    if (!scopes.includes(requiredScope)) return fail("scope");
  }
  return { ok: true, payload };
}

/** Expired 2019 sample token, signed with the retired key. Structure reference only. */
function sampleToken() {
  return signPayload(RETIRED_KEY, {
    sub: "recovery-migration",
    role: "recovery_archivist",
    scope: ["manifest:read", "fragment:submit"],
    iat: 1568000000,
    exp: 1568008600,
    note: "retired-key sample",
  });
}

/** ETag / integrity digest over the exact manifest response bytes. */
function manifestDigest(body) {
  return sha256Hex(body);
}

/** Canonical hash of the accepted answer set (used for tickets + flag input). */
function setIdHash(sortedIds) {
  return sha256Hex(sortedIds.join(","));
}

/**
 * Flag = RZ{ + first 40 hex chars of
 *   sha256( "RZ1::FRAGMENT1::" + sortedIds.join(",") + "::" + SALT )
 * Tied to the exact accepted id set; salt is server-side only.
 */
function deriveFlag(sortedIds, salt) {
  const material = `RZ1::FRAGMENT1::${sortedIds.join(",")}::${salt}`;
  return `RZ{${sha256Hex(material).slice(0, 40)}}`;
}

function issueFragmentTicket(key, sortedIds, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  return signPayload(key, {
    typ: "fragment1-ticket",
    k: setIdHash(sortedIds),
    iat: now,
    exp: now + ttlSeconds,
  });
}

function verifyFragmentTicket(raw, key, sortedIds) {
  const result = verifySignedToken(raw, key, null);
  if (!result.ok) return result;
  if (result.payload.typ !== "fragment1-ticket") return { ok: false, reason: "bad-type" };
  if (result.payload.k !== setIdHash(sortedIds)) return { ok: false, reason: "set-mismatch" };
  return { ok: true, payload: result.payload };
}

module.exports = {
  TOKEN_HEADER,
  sha256Hex,
  hmacRaw,
  hmacBase64Url,
  b64urlEncode,
  b64urlDecode,
  deriveSignerKey,
  signPayload,
  verifySignedToken,
  sampleToken,
  manifestDigest,
  setIdHash,
  deriveFlag,
  issueFragmentTicket,
  verifyFragmentTicket,
};
