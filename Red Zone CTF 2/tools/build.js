/* =====================================================================
   RED ZONE CTF 2 — tools/build.js
   Production build: assembles a self-contained `dist/` that can be
   copied to any Node >= 18 host. No bundling is needed (zero-dep
   vanilla JS), so the build verifies + copies + stamps a manifest.

   Run: npm run build     ->  dist/     then: npm run start:prod
   ===================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");

const COPY = [
  "index.html",
  "css/main.css",
  "js/app.js",
  "js/terminal.js",
  "assets/favicon.svg",
  "backend/server.js",
  "backend/store.js",
  "backend/puzzle.js",
  "data/PARENT_FINAL.csv"
];

function rmrf(p) {
  if (!fs.existsSync(p)) return;
  fs.readdirSync(p).forEach((e) => {
    const f = path.join(p, e);
    if (fs.statSync(f).isDirectory()) rmrf(f); else fs.unlinkSync(f);
  });
  fs.rmdirSync(p);
}
function copy(rel) {
  const src = path.join(ROOT, rel);
  const dst = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

/* ---- verify inputs before copying ---- */
const problems = [];

COPY.forEach((rel) => {
  if (!fs.existsSync(path.join(ROOT, rel))) problems.push("missing input: " + rel);
});

/* the source-of-truth dataset must ship byte-identical */
const csvPath = path.join(ROOT, "data", "PARENT_FINAL.csv");
const csvHash = fs.existsSync(csvPath) ? sha(fs.readFileSync(csvPath)) : "";
if (csvHash !== "1c951859b23be1d14c0587e64eda9d65d9df5be87133ba7187ecc063e8f4a061") {
  problems.push("data/PARENT_FINAL.csv differs from the source of truth (" + csvHash + ")");
}

/* the flag must never be embedded in the frontend bundle */
["index.html", "css/main.css", "js/app.js", "js/terminal.js"].forEach((rel) => {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return;
  const body = fs.readFileSync(p, "utf8");
  if (/RZ\{[0-9a-f]{32}\}/.test(body)) problems.push("possible embedded flag in " + rel);
  if (body.indexOf("S033,S110|") >= 0) problems.push("solution material embedded in " + rel);
});

if (problems.length) {
  console.error("BUILD FAILED");
  problems.forEach((p) => console.error("  - " + p));
  process.exit(1);
}

/* ---- assemble dist/ ---- */
rmrf(DIST);
fs.mkdirSync(DIST, { recursive: true });
COPY.forEach(copy);

/* production package.json: the shipped scripts must resolve paths that are
   relative to dist/ itself, and dev-only scripts (build/test/flag) point at
   tools/ and test/ which are deliberately not part of the deployment. */
const srcPkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const distPkg = {
  name: srcPkg.name,
  version: srcPkg.version,
  private: srcPkg.private,
  description: srcPkg.description,
  main: "backend/server.js",
  scripts: {
    start: "node backend/server.js",
    "start:prod": "node backend/server.js"
  },
  engines: srcPkg.engines,
  license: srcPkg.license
};
if (srcPkg.dependencies && Object.keys(srcPkg.dependencies).length) {
  distPkg.dependencies = srcPkg.dependencies;
}
fs.writeFileSync(path.join(DIST, "package.json"), JSON.stringify(distPkg, null, 2) + "\n");

/* strip server-only hints from the shipped copy? (none: server needs them) */

const manifest = {
  name: "red-zone-ctf-2",
  builtAt: new Date().toISOString(),
  node: process.version,
  files: {},
  dataset: { file: "data/PARENT_FINAL.csv", sha256: csvHash, records: 120, columns: 26 }
};
COPY.forEach((rel) => {
  manifest.files[rel] = sha(fs.readFileSync(path.join(ROOT, rel)));
});
manifest.files["package.json"] = sha(fs.readFileSync(path.join(DIST, "package.json")));
fs.writeFileSync(path.join(DIST, "build-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

const bytes = COPY.reduce((n, rel) => n + fs.statSync(path.join(DIST, rel)).size, 0)
  + fs.statSync(path.join(DIST, "package.json")).size;
console.log("BUILD OK");
console.log("  output     dist/ (" + (COPY.length + 1) + " files, " + (bytes / 1024).toFixed(1) + " KB)");
console.log("  dataset    data/PARENT_FINAL.csv  sha256 " + csvHash.slice(0, 16) + "… (byte-identical)");
console.log("  run        npm run start:prod");
console.log("  deploy     upload dist/ to any Node >= 18 host, set PORT (and optionally RED_ZONE_FLAG)");
