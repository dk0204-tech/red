/* =====================================================================
   THE SILENT EDIT — backend/store.js
   Loads data/PARENT_FINAL.csv (SOURCE OF TRUTH — never modified),
   indexes it, and builds the projections the terminal is allowed to see.
   ===================================================================== */
"use strict";

const fs = require("fs");

const COLUMNS = [
  "Sanctuary_ID", "Original_Name", "Original_Occupation", "Original_Skills",
  "Original_Sector_Of_Residence", "Relationship_History", "Original_Community_Standing",
  "Transfer_Date", "Reason_For_Transfer", "Vault_Case_ID", "Transfer_Manifest_ID",
  "Medical_Tag_ID", "Record_Alteration_Flag", "PRALAYA_Alteration_Type",
  "Record_Authenticity_Score", "Signature_Valid_Flag", "Identity_Mapping_Confidence",
  "Falsified_To_Protect_Flag", "Access_Log_Timestamp", "Evidence_Fragment_Count",
  "Identity_Record_Status", "Previous_Identifier", "Identity_Recovery_Level",
  "ML_Predicted_Occupation", "ML_Occupation_Confidence", "Identity_Recovery_Score"
];

/* RFC4180-ish parser (quotes, escaped quotes, CRLF) ------------------ */
function parseCsv(text) {
  const src = String(text).replace(/^\uFEFF/, "");
  const rows = [];
  let row = [], field = "", i = 0, quoted = false;
  while (i < src.length) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { quoted = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const cols = rows.shift() || [];
  const objects = rows
    .filter((r) => r.some((v) => String(v).trim() !== ""))
    .map((r) => {
      const o = {};
      cols.forEach((c, idx) => { o[c] = r[idx] == null ? "" : r[idx]; });
      return o;
    });
  return { cols, rows: objects };
}

const ID_RE = /^S\d{3}$/i;
function normId(raw) {
  const s = String(raw == null ? "" : raw).trim().toUpperCase();
  return ID_RE.test(s) ? s : null;
}
const yes = (v) => String(v).trim().toLowerCase() === "true";

function Store(csvPath) {
  const parsed = parseCsv(fs.readFileSync(csvPath, "utf8"));
  const rows = parsed.rows;
  const byId = new Map();
  rows.forEach((r) => byId.set(String(r.Sanctuary_ID).trim().toUpperCase(), r));

  const missingCols = COLUMNS.filter((c) => parsed.cols.indexOf(c) < 0);
  if (missingCols.length) throw new Error("dataset missing columns: " + missingCols.join(", "));
  if (rows.length !== 120) throw new Error("dataset expected 120 rows, got " + rows.length);

  /* ---------- aggregates (safe to expose: counts only, no answers) ---------- */
  const stats = {
    records: rows.length,
    altered: 0,
    untouched: 0,
    signatureFailed: 0,
    falsified: 0,
    locked: 0,
    verified: 0,
    partial: 0,
    evidenceTotal: 0,
    alterationTypes: { none: 0, record_split: 0, memory_erased: 0, identifier_changed: 0 },
    bySector: {}
  };
  rows.forEach((r) => {
    const type = String(r.PRALAYA_Alteration_Type).trim();
    if (type === "none") stats.untouched++; else stats.altered++;
    stats.alterationTypes[type] = (stats.alterationTypes[type] || 0) + 1;
    if (!yes(r.Signature_Valid_Flag)) stats.signatureFailed++;
    if (yes(r.Falsified_To_Protect_Flag)) stats.falsified++;
    if (r.Identity_Record_Status === "LOCKED") stats.locked++;
    else if (r.Identity_Record_Status === "IDENTITY_VERIFIED") stats.verified++;
    else stats.partial++;
    stats.evidenceTotal += Number(r.Evidence_Fragment_Count) || 0;
    const sec = String(r.Original_Sector_Of_Residence).trim();
    stats.bySector[sec] = (stats.bySector[sec] || 0) + 1;
  });

  const rel = (r) => String(r.Relationship_History).split(";").map((s) => s.trim()).filter(Boolean);

  const summary = (r) => ({
    id: String(r.Sanctuary_ID).trim(),
    name: r.Original_Name,
    occupation: r.Original_Occupation,
    sector: r.Original_Sector_Of_Residence,
    status: r.Identity_Record_Status,
    alteration: r.PRALAYA_Alteration_Type,
    signature: r.Signature_Valid_Flag,
    evidence: Number(r.Evidence_Fragment_Count) || 0
  });

  function get(id) {
    const cid = normId(id);
    if (!cid) return { error: "BAD_ID", hint: "expected a sanctuary id such as S001" };
    const r = byId.get(cid);
    if (!r) return { error: "NO_RECORD", id: cid, hint: "no record with that id in the archive" };
    return { id: cid, record: r };
  }

  /* ---------- views ---------- */
  const views = {
    probe(id) {
      const g = get(id);
      if (g.error) return g;
      const r = g.record;
      return {
        id: g.id,
        name: r.Original_Name,
        occupation: r.Original_Occupation,
        status: r.Identity_Record_Status,
        sector: r.Original_Sector_Of_Residence,
        standing: Number(r.Original_Community_Standing),
        provenance: { vault: r.Vault_Case_ID, manifest: r.Transfer_Manifest_ID, medical: r.Medical_Tag_ID },
        journal: { transfer: r.Transfer_Date, access: r.Access_Log_Timestamp, reason: r.Reason_For_Transfer },
        recovery: { level: r.Identity_Recovery_Level, score: Number(r.Identity_Recovery_Score) },
        alteration: {
          flag: r.Record_Alteration_Flag,
          type: r.PRALAYA_Alteration_Type,
          signature: r.Signature_Valid_Flag,
          authenticity: Number(r.Record_Authenticity_Score),
          falsified: r.Falsified_To_Protect_Flag
        }
      };
    },

    inspect(id) {
      const g = get(id);
      if (g.error) return g;
      const fields = {};
      COLUMNS.forEach((c) => { fields[c] = g.record[c]; });
      return { id: g.id, fields };
    },

    relations(id) {
      const g = get(id);
      if (g.error) return g;
      const r = g.record;
      const links = rel(r).map((lid) => {
        const target = byId.get(lid);
        return target ? summary(target) : { id: lid, missing: true };
      });
      return { id: g.id, name: r.Original_Name, degree: rel(r).length, links };
    },

    evidence(id) {
      const g = get(id);
      if (g.error) return g;
      const r = g.record;
      return {
        id: g.id,
        name: r.Original_Name,
        fragments: Number(r.Evidence_Fragment_Count) || 0,
        authenticity: Number(r.Record_Authenticity_Score),
        signature: r.Signature_Valid_Flag,
        altered: r.Record_Alteration_Flag,
        alteration: r.PRALAYA_Alteration_Type,
        falsified: r.Falsified_To_Protect_Flag,
        access: r.Access_Log_Timestamp,
        vault: r.Vault_Case_ID,
        manifest: r.Transfer_Manifest_ID,
        medical: r.Medical_Tag_ID
      };
    },

    recover(id) {
      const g = get(id);
      if (g.error) return g;
      const r = g.record;
      return {
        id: g.id,
        name: r.Original_Name,
        level: r.Identity_Recovery_Level,
        score: Number(r.Identity_Recovery_Score),
        status: r.Identity_Record_Status,
        mappingConfidence: Number(r.Identity_Mapping_Confidence),
        previous: r.Previous_Identifier || null,
        mlPrediction: { occupation: r.ML_Predicted_Occupation, confidence: Number(r.ML_Occupation_Confidence) },
        trueOccupation: r.Original_Occupation,
        occupationMismatch: r.ML_Predicted_Occupation !== r.Original_Occupation
      };
    }
  };

  /* ---------- list / search ---------- */
  const PAGE_SIZE = 15;
  function list(page) {
    const total = rows.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const p = Math.min(Math.max(1, page || 1), pages);
    const slice = rows.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE).map(summary);
    return { page: p, pages, total, rows: slice };
  }

  const SEARCH_FIELDS = [
    ["Sanctuary_ID", "id"], ["Original_Name", "name"], ["Original_Occupation", "occupation"],
    ["Original_Skills", "skills"], ["Original_Sector_Of_Residence", "sector"],
    ["Reason_For_Transfer", "reason"], ["Identity_Record_Status", "status"],
    ["PRALAYA_Alteration_Type", "alteration"], ["Previous_Identifier", "previous"],
    ["ML_Predicted_Occupation", "ml"], ["Vault_Case_ID", "vault"],
    ["Transfer_Manifest_ID", "manifest"], ["Medical_Tag_ID", "medical"]
  ];
  function search(term, limit) {
    const q = String(term || "").trim().toLowerCase();
    if (!q) return { error: "EMPTY_QUERY", hint: "search needs a term" };
    const hits = [];
    for (const r of rows) {
      const matched = [];
      SEARCH_FIELDS.forEach(([col, label]) => {
        if (String(r[col]).toLowerCase().indexOf(q) >= 0) matched.push(label);
      });
      if (matched.length) {
        hits.push({ id: String(r.Sanctuary_ID).trim(), name: r.Original_Name, status: r.Identity_Record_Status, matched });
      }
      if (hits.length >= (limit || 20)) break;
    }
    return { term, count: hits.length, truncated: hits.length >= (limit || 20), hits };
  }

  return { rows, byId, stats, get, views, list, search, summary, PAGE_SIZE, columns: COLUMNS };
}

module.exports = { Store, parseCsv, COLUMNS, normId, ID_RE };
