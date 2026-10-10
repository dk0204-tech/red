/* =====================================================================
   METADATA FORENSICS — backend/puzzle.js
   The three forensic rules, derived straight from the shipped datasets.
   The expected flag exists ONLY here (or the METADATA_FLAG env override)
   and is never sent to a client.

   RULES (published to players through /api/protocol + the stage briefs):
     III   provenance  Record_Authenticity_Score < 0.500  (unsealed record)
     IV    chronology  audit written later than 7d 12h after transfer (breach)
     V     correlation child profile has >= 2 blank skill cells
                           AND the parent carries Record_Alteration_Flag=True

   material = <prov ids> | <chron ids> | <corr ids>       (each ascending)
   flag     = RZ{ sha256hex( material )[0..31] }
   ===================================================================== */
"use strict";

const crypto = require("crypto");

const RULES = {
  AUTH_FLOOR: 0.5,          /* authenticity strictly below this is unsealed   */
  AUDIT_WINDOW_DAYS: 7.5,   /* 7 days + 12h grace; strictly later is a breach */
  CHILD_BLANK_MIN: 2        /* >= 2 blank skill cells = erasure               */
};

const sha256hex = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

/* ---- the three extracts, computed from the real data ---- */
function solve(store) {
  const prov = [];
  const chron = [];
  const corr = [];

  store.parentRows.forEach((p) => {
    const id = p.Sanctuary_ID;
    const d = store.derived.get(id);

    /* III — provenance: the seal itself is below the archival floor */
    if (d.auth < RULES.AUTH_FLOOR) prov.push(id);

    /* IV — chronology: audit clock ran past the statutory window */
    if (d.gapDays > RULES.AUDIT_WINDOW_DAYS) chron.push(id);

    /* V — correlation: child profile erasure where the parent admits alteration */
    if (d.childBlanks >= RULES.CHILD_BLANK_MIN && d.altered) corr.push(id);
  });

  const byId = (a) => a.slice().sort();
  const material = [byId(prov), byId(chron), byId(corr)].map((a) => a.join(",")).join("|");

  return {
    provenance: byId(prov),
    chronology: byId(chron),
    correlation: byId(corr),
    material,
    digest: sha256hex(material)
  };
}

function expectedFlag(store, env) {
  env = env || process.env;
  if (env.METADATA_FLAG && /^RZ\{[A-Za-z0-9_-]{4,64}\}$/.test(env.METADATA_FLAG)) {
    return env.METADATA_FLAG;
  }
  return "RZ{" + solve(store).digest.slice(0, 32) + "}";
}

/* the player-facing protocol text (no flag inside) */
const PROTOCOL = [
  "RECONSTRUCTION PROTOCOL // records authority — NOT authored by PRALAYA",
  "",
  "  Three extracts, each the sanctuary ids that breach a published rule,",
  "  sorted ascending, comma separated:",
  "",
  "    <provenance>  records whose authenticity seal is below the floor",
  "    <chronology>  records whose audit entry breached the statutory window",
  "    <correlation> records whose child profile was erased over an admitted edit",
  "",
  "  material = <provenance>|<chronology>|<correlation>",
  "",
  "  flag = RZ{ sha256hex( material )[0..31] }",
  "",
  "  compute the digest with the ASSEMBLY console, then submit",
  "  RZ{<32 hex chars>} in RECOVERY."
].join("\n");

module.exports = { RULES, solve, expectedFlag, sha256hex, PROTOCOL };
