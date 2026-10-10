/* =====================================================================
   METADATA FORENSICS — tools/flag.js   (ORGANIZER ONLY)
   Prints the derived material + expected flag. Never used at runtime.
   Run: npm run flag
   ===================================================================== */
"use strict";

const path = require("path");
const { Store } = require("../backend/store.js");
const puzzle = require("../backend/puzzle.js");

const ROOT = path.join(__dirname, "..");
const store = Store(path.join(ROOT, "data", "PARENT_FINAL.csv"), path.join(ROOT, "data", "CHILD_FINAL.csv"));
const s = puzzle.solve(store);

console.log("RED ZONE CTF 3 — organizer");
console.log("  provenance   " + s.provenance.length + "  " + s.provenance.join(","));
console.log("  chronology   " + s.chronology.length + "  " + s.chronology.join(","));
console.log("  correlation  " + s.correlation.length + "  " + s.correlation.join(","));
console.log("  material     " + s.material);
console.log("  digest       " + s.digest);
console.log("  flag         " + puzzle.expectedFlag(store));
