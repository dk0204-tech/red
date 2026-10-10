/* =====================================================================
   THE SILENT EDIT — backend/puzzle.js
   SERVER-SIDE ONLY. Solves the challenge from PARENT_FINAL.csv and
   derives the single expected flag.

   This file is never served (see the static whitelist in server.js),
   never queried by the frontend, and never serialised into a response.

   SOLUTION (three layers, all read from the dataset):
     L1  SILENT EDITS  — records whose PRALAYA_Alteration_Type is "none"
                         but whose Signature_Valid_Flag is "False":
                         altered outside policy, never logged.
     L2  POLICY-TOUCHED TRIAD MEMBERS — every record carries exactly three
                         Relationship_History links. Of the six links of the
                         two silent records, keep the ones PRALAYA DID log
                         (alteration type != none).
     L3  TALLY         — sum of Evidence_Fragment_Count over those members.

   MATERIAL = "<silent ids,asc,comma>|<touched ids,asc,comma>|<tally>"
   FLAG     = "RZ{" + sha256hex(MATERIAL)[0..31] + "}"
   Override: RED_ZONE_FLAG env var wins when set (see .env.example).
   ===================================================================== */
"use strict";

const crypto = require("crypto");

const sha256hex = (s) => crypto.createHash("sha256").update(String(s), "utf8").digest("hex");

function solve(rows) {
  const byId = new Map();
  rows.forEach((r) => byId.set(String(r.Sanctuary_ID).trim().toUpperCase(), r));

  /* L1 — the two off-record edits */
  const silent = rows
    .filter((r) => String(r.PRALAYA_Alteration_Type).trim() === "none" &&
                   String(r.Signature_Valid_Flag).trim().toLowerCase() === "false")
    .map((r) => String(r.Sanctuary_ID).trim().toUpperCase())
    .sort();

  /* L2 — their triads, filtered to logged alterations */
  const triad = [...new Set(
    silent.flatMap((id) => {
      const r = byId.get(id);
      return r ? String(r.Relationship_History).split(";").map((s) => s.trim()).filter(Boolean) : [];
    })
  )].sort();

  const touched = triad
    .filter((id) => {
      const r = byId.get(id);
      return r && String(r.PRALAYA_Alteration_Type).trim() !== "none";
    })
    .sort();

  /* L3 — fragment tally */
  const tally = touched.reduce((sum, id) => sum + (Number(byId.get(id).Evidence_Fragment_Count) || 0), 0);

  const material = [silent.join(","), touched.join(","), String(tally)].join("|");

  return { silent, triad, touched, tally, material };
}

function deriveFlag(material) {
  return "RZ{" + sha256hex(material).slice(0, 32) + "}";
}

/* Expected flag: env override first, otherwise deterministic from data. */
function expectedFlag(rows, env) {
  env = env || process.env;
  const override = String(env.RED_ZONE_FLAG || "").trim();
  if (override) return override;
  return deriveFlag(solve(rows).material);
}

module.exports = { solve, deriveFlag, expectedFlag, sha256hex };
