"use strict";

/**
 * Data store: loads the real PARENT_FINAL.csv once at boot and exposes every
 * derived view the challenge needs. Nothing here is hand-typed; every id list,
 * every sum and the fragment slice itself is computed from the file.
 */

const fs = require("fs");
const path = require("path");
const csv = require("./csv");

const DATA_PATH =
  process.env.PARENT_CSV || path.join(__dirname, "..", "data", "PARENT_FINAL.csv");

const EXPECTED_ROW_COUNT = 120;

/** Fragment 1 membership rule (the in-world recovery directive). */
const FRAGMENT_RULE = Object.freeze({
  Identity_Record_Status: "IDENTITY_VERIFIED",
  Falsified_To_Protect_Flag: "False",
  Signature_Valid_Flag: "True",
});

/** The five columns delivered in FRAGMENT_1.csv. */
const FRAGMENT_COLUMNS = Object.freeze([
  "Sanctuary_ID",
  "Original_Name",
  "Original_Occupation",
  "Original_Skills",
  "Original_Sector_Of_Residence",
]);

/** Fields returned by the public case projection. Falsified_To_Protect_Flag is
 *  deliberately absent: the transparency portal "withholds integrity fields". */
const CASE_VIEW_FIELDS = Object.freeze([
  "Sanctuary_ID",
  "Original_Name",
  "Original_Occupation",
  "Original_Skills",
  "Original_Sector_Of_Residence",
  "Identity_Record_Status",
  "Signature_Valid_Flag",
  "Evidence_Fragment_Count",
  "Record_Authenticity_Score",
  "Identity_Mapping_Confidence",
  "Record_Alteration_Flag",
  "PRALAYA_Alteration_Type",
  "Identity_Recovery_Level",
  "Vault_Case_ID",
  "Transfer_Manifest_ID",
  "Transfer_Date",
  "Reason_For_Transfer",
  "Access_Log_Timestamp",
  "Previous_Identifier",
  "Relationship_History",
]);

/**
 * Synchronization journal structure — the archive's event windows. The window
 * layout is part of the in-world journal; every count inside it is computed
 * from the real dataset at boot (see syncJournal()).
 *
 * SW-03 covers the exact window in which the recovery manifest was compiled
 * (manifest.generated = 2024-09-18T02:14:07Z). Attestations must reference it.
 */
const SYNC_EVENTS = Object.freeze([
  { id: "SW-01", from: "2024-01-01T00:00:00Z", to: "2024-07-01T00:00:00Z",
    outcome: "completed", note: "transfer indexing resumed after grid loss" },
  { id: "SW-02", from: "2024-07-01T00:00:00Z", to: "2024-09-17T00:00:00Z",
    outcome: "completed", note: "pre-collapse transfer wave" },
  { id: "SW-03", from: "2024-09-17T00:00:00Z", to: "2024-09-19T00:00:00Z",
    outcome: "aborted", writer: "CUSTODIAN-7",
    note: "recovery manifest compiled 02:14:07Z · final adjudication pass aborted · reindex pending" },
  { id: "SW-04", from: "2024-09-19T00:00:00Z", to: "2025-01-01T00:00:00Z",
    outcome: "completed", note: "post-collapse stabilization sweep" },
  { id: "SW-05", from: "2025-01-01T00:00:00Z", to: "2026-01-01T00:00:00Z",
    outcome: "completed", note: "identity adjudication backlog cleared" },
  { id: "SW-06", from: "2026-01-01T00:00:00Z", to: "2027-01-01T00:00:00Z",
    outcome: "degraded", note: "board-clock drift; journal writes deferred" },
]);

/** The event that compiled the recovery manifest (derived from the windows). */
const MANIFEST_COMPILE_EVENT = "SW-03";

/** Rows 1..N of the file are the cases published on the transparency log. */
const RELEASED_COUNT = 6;

const REQUIRED_COLUMNS = Object.freeze([
  ...FRAGMENT_COLUMNS,
  "Identity_Record_Status",
  "Falsified_To_Protect_Flag",
  "Signature_Valid_Flag",
  "Evidence_Fragment_Count",
  "Record_Authenticity_Score",
  "Identity_Mapping_Confidence",
  "Record_Alteration_Flag",
  "PRALAYA_Alteration_Type",
  "Identity_Recovery_Level",
  "Vault_Case_ID",
  "Transfer_Date",
  "Reason_For_Transfer",
  "Access_Log_Timestamp",
]);

function toCount(value) {
  const n = Number.parseInt(String(value).trim(), 10);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`Evidence_Fragment_Count is not a non-negative integer: ${JSON.stringify(value)}`);
  }
  return n;
}

function load() {
  const text = fs.readFileSync(DATA_PATH, "utf8");
  const rows = csv.toObjects(text);
  if (rows.length === 0) throw new Error(`parent dataset is empty: ${DATA_PATH}`);
  if (rows.length !== EXPECTED_ROW_COUNT) {
    console.warn(
      `[store] WARNING: expected ${EXPECTED_ROW_COUNT} rows in PARENT_FINAL.csv, found ${rows.length}`
    );
  }

  for (const col of REQUIRED_COLUMNS) {
    if (!(col in rows[0])) {
      throw new Error(`parent dataset is missing required column: ${col}`);
    }
  }

  const byId = new Map();
  for (const row of rows) {
    const id = row.Sanctuary_ID;
    if (!id || byId.has(id)) throw new Error(`duplicate or empty Sanctuary_ID: ${JSON.stringify(id)}`);
    byId.set(id, row);
  }

  const releasedRows = rows.slice(0, RELEASED_COUNT);
  const releasedIds = releasedRows.map((r) => r.Sanctuary_ID);
  const releasedSet = new Set(releasedIds);

  const matchesRule = (row) =>
    row.Identity_Record_Status === FRAGMENT_RULE.Identity_Record_Status &&
    row.Falsified_To_Protect_Flag === FRAGMENT_RULE.Falsified_To_Protect_Flag &&
    row.Signature_Valid_Flag === FRAGMENT_RULE.Signature_Valid_Flag;

  // The true Fragment 1 row set, computed from the file.
  const fragmentRows = rows.filter(matchesRule).map((r) => ({ ...r }));

  // Candidates the archive *believes* belong to Fragment 1: the two conditions
  // the recovery manifest checks (verified + signature valid). One of them is
  // the near-miss trap because it fails the falsification condition.
  const candidateRows = rows.filter(
    (r) =>
      r.Identity_Record_Status === FRAGMENT_RULE.Identity_Record_Status &&
      r.Signature_Valid_Flag === FRAGMENT_RULE.Signature_Valid_Flag
  );

  const trapRows = candidateRows.filter(
    (r) => r.Falsified_To_Protect_Flag !== FRAGMENT_RULE.Falsified_To_Protect_Flag
  );

  if (fragmentRows.length === 0) throw new Error("fragment selection returned no rows");
  if (trapRows.length === 0) {
    console.warn("[store] WARNING: no near-miss trap row found (verified + signed + falsified).");
  }

  const fragmentIds = fragmentRows.map((r) => r.Sanctuary_ID).sort();

  const partA = releasedRows
    .map((r) => `${r.Sanctuary_ID}:${r.Evidence_Fragment_Count}`)
    .join("|");

  const partB = rows
    .filter((r) => !releasedSet.has(r.Sanctuary_ID))
    .reduce((sum, r) => sum + toCount(r.Evidence_Fragment_Count), 0);

  // Exact string the SIGNER-01 recipe on /status describes.
  const signerRecipe = `PRALAYA::${partA}||${partB}`;

  /* ---- forensics derived from real columns (honest, computed at boot) ---- */

  const parseAccess = (value) => Date.parse(String(value).replace(" ", "T") + "Z");
  const windowStart = (ev) => Date.parse(ev.from);
  const windowEnd = (ev) => Date.parse(ev.to);

  /** Journal event whose window contains this record's access timestamp. */
  const eventFor = (row) => {
    const t = parseAccess(row.Access_Log_Timestamp);
    for (const ev of SYNC_EVENTS) {
      if (t >= windowStart(ev) && t < windowEnd(ev)) return ev.id;
    }
    return null; // record exists outside the journal
  };

  /** Who last wrote the record: the Custodian touches everything it altered.
   *  NOTE: this is a superset of the falsified records — deliberately NOT a
   *  discriminator for the fragment rule (57 touched vs 34 falsified). */
  const provenanceOf = (row) =>
    row.Record_Alteration_Flag === "True" ? "CUSTODIAN-7" : "SYNC-DAEMON";

  const caseView = (row) => {
    const view = {};
    for (const field of CASE_VIEW_FIELDS) view[field] = row[field];
    view.released = releasedSet.has(row.Sanctuary_ID);
    view.provenance = provenanceOf(row);
    view.sync_event = eventFor(row);
    return view;
  };

  /** The sync journal: structure is story, every count is computed from data. */
  const syncJournal = () =>
    SYNC_EVENTS.map((ev) => {
      const start = windowStart(ev);
      const end = windowEnd(ev);
      const touched = rows.filter((r) => {
        const t = parseAccess(r.Access_Log_Timestamp);
        return t >= start && t < end;
      });
      return {
        id: ev.id,
        from: ev.from,
        to: ev.to,
        outcome: ev.outcome,
        ...(ev.writer ? { writer: ev.writer } : {}),
        records_touched: touched.length,
        custodian_writes: touched.filter((r) => r.Record_Alteration_Flag === "True").length,
        note: ev.note,
      };
    });

  /** Deep-archive index counts (§18: the world is bigger than what's served). */
  const indexReport = () => {
    const byStatus = new Map();
    for (const r of rows) {
      byStatus.set(r.Identity_Record_Status, (byStatus.get(r.Identity_Record_Status) || 0) + 1);
    }
    return {
      records_indexed: rows.length,
      published: releasedRows.length,
      identity_verified: byStatus.get("IDENTITY_VERIFIED") || 0,
      partially_reconstructed: byStatus.get("PARTIALLY_RECONSTRUCTED") || 0,
      locked: byStatus.get("LOCKED") || 0,
      custodian_touched: rows.filter((r) => r.Record_Alteration_Flag === "True").length,
      out_of_journal: rows.filter((r) => eventFor(r) === null).length,
      recovery_fragments_total: 4,
      recovery_fragments_recovered: 0,
    };
  };

  const auditRows = rows.map((r) => [
    r.Sanctuary_ID,
    r.Falsified_To_Protect_Flag,
    r.Record_Alteration_Flag,
  ]);

  const auditCsv = () =>
    csv.stringify([["Sanctuary_ID", "Falsified_To_Protect_Flag", "Record_Alteration_Flag"], ...auditRows]);

  const fragmentCsv = () =>
    csv.stringify([
      [...FRAGMENT_COLUMNS],
      ...fragmentRows
        .slice()
        .sort((a, b) => (a.Sanctuary_ID < b.Sanctuary_ID ? -1 : 1))
        .map((r) => FRAGMENT_COLUMNS.map((c) => r[c])),
    ]);

  return {
    rows,
    byId,
    releasedRows,
    releasedIds,
    releasedSet,
    fragmentRows,
    fragmentIds,
    candidateRows,
    trapRows,
    partA,
    partB,
    signerRecipe,
    caseView,
    syncJournal,
    indexReport,
    auditCsv,
    fragmentCsv,
    MANIFEST_COMPILE_EVENT,
    SYNC_EVENTS,
    FRAGMENT_COLUMNS,
    FRAGMENT_RULE,
    RELEASED_COUNT,
  };
}

module.exports = { load, FRAGMENT_COLUMNS, FRAGMENT_RULE, RELEASED_COUNT };
