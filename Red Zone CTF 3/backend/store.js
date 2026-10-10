/* =====================================================================
   METADATA FORENSICS — backend/store.js
   Loads the REAL Parent + Child datasets, joins them on Sanctuary_ID
   and derives every metadata fact the investigation is built on.

   The datasets are read-only. Nothing here rewrites, sorts or repairs
   them — analysis is computed on read.
   ===================================================================== */
"use strict";

const fs = require("fs");

/* RFC-style CSV parser (quotes supported; the shipped data is plain) */
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c === "\r") { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length && !(r.length === 1 && r[0] === ""));
}

const DAY_MS = 86400000;
const transferMs = (d) => Date.parse(d + "T00:00:00Z");
const auditMs = (ts) => Date.parse(ts.replace(" ", "T") + "Z");

/* ---------------- Store ---------------- */
function Store(parentFile, childFile) {
  const pGrid = parseCSV(fs.readFileSync(parentFile, "utf8"));
  const cGrid = parseCSV(fs.readFileSync(childFile, "utf8"));

  const pHeader = pGrid[0];
  const cHeader = cGrid[0];

  const toObjects = (header, grid) => grid.slice(1).map((cells) => {
    const o = {};
    header.forEach((h, i) => { o[h] = cells[i] === undefined ? "" : cells[i]; });
    return o;
  });

  const parentRows = toObjects(pHeader, pGrid);
  const childRows = toObjects(cHeader, cGrid);

  /* child skill-score columns (everything except id + the two labels) */
  const scoreCols = cHeader.filter((h) =>
    h !== "Sanctuary_ID" && h !== "Sector_Exposure" && h !== "Original_Occupation_Category");

  const childById = new Map(childRows.map((r) => [r.Sanctuary_ID, r]));
  const parentById = new Map(parentRows.map((r) => [r.Sanctuary_ID, r]));

  /* ---- per-record derived metadata (the star of this challenge) ---- */
  const derived = new Map();
  parentRows.forEach((p) => {
    const id = p.Sanctuary_ID;
    const c = childById.get(id) || null;
    const gap = (auditMs(p.Access_Log_Timestamp) - transferMs(p.Transfer_Date)) / DAY_MS;
    const blanks = c ? scoreCols.filter((k) => !c[k]) : [];
    derived.set(id, {
      id,
      gapDays: gap,                                   /* transfer -> audit lag */
      auth: Number(p.Record_Authenticity_Score),
      signature: p.Signature_Valid_Flag === "True",
      altered: p.Record_Alteration_Flag === "True",
      alterationType: p.PRALAYA_Alteration_Type,
      falsified: p.Falsified_To_Protect_Flag === "True",
      status: p.Identity_Record_Status,
      recoveryLevel: p.Identity_Recovery_Level,
      prevId: p.Previous_Identifier || "",
      vault: p.Vault_Case_ID,
      manifest: p.Transfer_Manifest_ID,
      tag: p.Medical_Tag_ID,
      sectorParent: p.Original_Sector_Of_Residence,
      sectorChild: c ? c.Sector_Exposure : "",
      sectorMismatch: c ? c.Sector_Exposure !== p.Original_Sector_Of_Residence : false,
      childBlanks: blanks.length,
      childBlankCols: blanks,
      childPresent: !!c
    });
  });

  const stats = {
    records: parentRows.length,
    childRecords: childRows.length,
    columns: pHeader.length,
    childColumns: cHeader.length,
    altered: parentRows.filter((r) => r.Record_Alteration_Flag === "True").length,
    untouched: parentRows.filter((r) => r.Record_Alteration_Flag === "False").length,
    signatureFailed: parentRows.filter((r) => r.Signature_Valid_Flag === "False").length,
    locked: parentRows.filter((r) => r.Identity_Record_Status === "LOCKED").length,
    withPreviousId: parentRows.filter((r) => r.Previous_Identifier).length,
    childWithBlanks: childRows.filter((r) => scoreCols.some((k) => !r[k])).length
  };

  function relations(id) {
    const p = parentById.get(id);
    if (!p) return null;
    return p.Relationship_History.split(";").map((s) => s.trim()).filter(Boolean);
  }

  /* provenance chain: vault case -> manifest -> medical tag -> record -> child */
  function trace(id) {
    const d = derived.get(id);
    if (!d) return null;
    return [
      { kind: "VAULT CASE", value: d.vault, note: "originating custody container" },
      { kind: "MANIFEST", value: d.manifest, note: "transfer manifest filed with the move" },
      { kind: "MEDICAL TAG", value: d.tag, note: "condition tag attached at intake" },
      { kind: "RECORD", value: id, note: "parent archive record" },
      { kind: "CHILD", value: d.childPresent ? id : "—", note: d.childPresent ? "child profile linked by Sanctuary_ID" : "no child profile" }
    ];
  }

  /* searchable / sortable / paginated view over the joined records */
  function query(opts) {
    const which = opts.which === "child" ? "child" : "parent";
    const source = which === "child" ? childRows : parentRows;
    const header = which === "child" ? cHeader : pHeader;
    const term = String(opts.q || "").trim().toLowerCase();

    let rows = source;
    if (term) {
      rows = rows.filter((r) => header.some((h) => String(r[h]).toLowerCase().includes(term)));
    }
    /* simple filter: only-altered / only-blanks etc. */
    if (opts.filter === "altered" && which === "parent") rows = rows.filter((r) => r.Record_Alteration_Flag === "True");
    if (opts.filter === "unaltered" && which === "parent") rows = rows.filter((r) => r.Record_Alteration_Flag === "False");
    if (opts.filter === "locked" && which === "parent") rows = rows.filter((r) => r.Identity_Record_Status === "LOCKED");
    if (opts.filter === "prev" && which === "parent") rows = rows.filter((r) => r.Previous_Identifier);
    if (opts.filter === "blanks" && which === "child") rows = rows.filter((r) => scoreCols.some((k) => !r[k]));

    const sort = opts.sort && header.includes(opts.sort) ? opts.sort : "Sanctuary_ID";
    const dir = opts.dir === "desc" ? -1 : 1;
    rows = rows.slice().sort((a, b) => {
      const x = a[sort], y = b[sort];
      const nx = Number(x), ny = Number(y);
      if (x !== "" && y !== "" && Number.isFinite(nx) && Number.isFinite(ny)) return (nx - ny) * dir;
      return String(x).localeCompare(String(y)) * dir;
    });

    const total = rows.length;
    const limit = Math.min(Math.max(Number(opts.limit) || 15, 1), 60);
    const pages = Math.max(1, Math.ceil(total / limit));
    const page = Math.min(Math.max(Number(opts.page) || 1, 1), pages);
    const slice = rows.slice((page - 1) * limit, page * limit);

    return { which, total, page, pages, limit, sort, dir: dir === 1 ? "asc" : "desc", columns: header, rows: slice };
  }

  function record(id) {
    const key = String(id).toUpperCase();
    const p = parentById.get(key);
    if (!p) return null;
    const c = childById.get(key) || null;
    return { parent: p, child: c, derived: derived.get(key) };
  }

  return {
    parentRows, childRows, pHeader, cHeader, scoreCols,
    parentById, childById, derived, stats, relations, trace, query, record
  };
}

module.exports = { Store, parseCSV, transferMs, auditMs };
