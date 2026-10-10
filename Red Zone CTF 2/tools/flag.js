/* Organizer utility: print the derived expected flag (server-side derivation only).
   Usage: node tools/flag.js        (or: npm run flag)
   Never expose this output to players. */
"use strict";

const path = require("path");
const { Store } = require("../backend/store.js");
const puzzle = require("../backend/puzzle.js");

const store = Store(path.join(__dirname, "..", "data", "PARENT_FINAL.csv"));
const solution = puzzle.solve(store.rows);
const flag = puzzle.expectedFlag(store.rows);

console.log("RED ZONE CTF 2 // THE SILENT EDIT — organizer flag readout");
console.log("---------------------------------------------------------");
console.log("dataset      data/PARENT_FINAL.csv (" + store.rows.length + " records, unmodified)");
console.log("material     " + solution.material);
console.log("expected     " + flag);
console.log("");
console.log("override     RED_ZONE_FLAG env var (wins when set)");
console.log("verify       npm test   (validates end-to-end against the server)");
