/* =====================================================================
   THE LAST DATASET // CTF 03 — js/inspector.js
   Metadata Inspector: every field is clickable and gets analysed.
   Field click -> analysis sheet (timestamp / seal / chain / cross-checks)
   Actions    -> COMPARE (parent<->child) · TRACE (provenance) · ADD EVIDENCE
   ===================================================================== */
"use strict";

const AUDIT_WINDOW = 7.5;
const AUTH_FLOOR = 0.5;
const BLANK_MIN = 2;

const Inspector = {
  root: null,
  rec: null,
  onEvidence: null,   /* cb({id,label}) — wired by app.js */

  ensure() {
    if (this.root) return;
    const d = document.createElement("aside");
    d.className = "inspector";
    d.id = "inspector";
    d.innerHTML = `
      <div class="insp-head">
        <div>
          <div class="k">METADATA INSPECTOR</div>
          <h3 id="ih-id">—</h3>
          <div class="sub" id="ih-sub">—</div>
        </div>
        <button class="insp-x" id="ih-x" aria-label="close">✕</button>
      </div>
      <div class="insp-body" id="ih-body"></div>`;
    document.body.appendChild(d);
    this.root = d;
    d.querySelector("#ih-x").addEventListener("click", () => this.close());
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") { this.close(); closeModal(); } });
  },

  close() { if (this.root) this.root.classList.remove("open"); },

  async open(id) {
    this.ensure();
    const rec = await J("/api/record/" + id);
    if (rec.error) { toast("record not found: " + id, "err"); return; }
    this.rec = rec;
    const d = rec.derived;
    this.root.querySelector("#ih-id").textContent = rec.id;
    this.root.querySelector("#ih-sub").textContent =
      `${(rec.parent.Original_Name || "").toUpperCase()} · ${rec.parent.Identity_Record_Status}`;

    const gapTxt = fmtLag(d.gapDays);
    const breach = d.gapDays > AUDIT_WINDOW;
    const atEdge = Math.abs(d.gapDays - AUDIT_WINDOW) < 1e-9;
    const unsealed = d.auth < AUTH_FLOOR;

    const row = (mk, mv, cls, flag, note, field) => `
      <div class="mrow ${cls}" data-field="${field || ""}">
        <span class="mk">${mk}</span>
        <span class="mv">${esc(mv)}</span>
        <span class="mflag">${flag || ""}</span>
        ${note ? `<span class="sub-note">${note}</span>` : ""}
      </div>`;

    const parentRows = [
      row("RECORD ID", rec.id, "", "◈", "", "Sanctuary_ID"),
      row("ORIGINAL NAME", "▮".repeat(Math.max(3, Math.min(12, (rec.parent.Original_Name || "x").length))), "", "REDACTED", "", "Original_Name"),
      row("CREATED (TRANSFER)", rec.parent.Transfer_Date, "", "▸", "", "Transfer_Date"),
      row("MODIFIED (AUDIT)", rec.parent.Access_Log_Timestamp,
        breach ? "anom" : (atEdge ? "anom" : ""),
        breach ? "⚠ ANOMALOUS" : "✔", breach ? "LAG " + gapTxt + " — PAST THE STATUTORY WINDOW" : "", "Access_Log_Timestamp"),
      row("SOURCE", rec.derived.vault, d.sectorMismatch ? "" : "", "↳", "", "Vault_Case_ID"),
      row("MANIFEST", d.manifest, "", "↳", "", "Transfer_Manifest_ID"),
      row("MEDICAL TAG", d.tag, "", "↳", "", "Medical_Tag_ID"),
      row("STATUS", d.status, d.status === "LOCKED" ? "anom" : "", d.status === "LOCKED" ? "⚠ LOCKED" : "✔", "", "Identity_Record_Status"),
      row("PREVIOUS ID", d.prevId || "—", d.prevId ? "anom" : "", d.prevId ? "RENAMED" : "", "", "Previous_Identifier"),
      row("AUTHENTICITY", d.auth.toFixed(3),
        unsealed ? "anom" : "ok-f", unsealed ? "⚠ UNSEALED" : "✔ SEALED", unsealed ? "BELOW THE 0.500 ARCHIVAL FLOOR" : "", "Record_Authenticity_Score"),
      row("SIGNATURE", d.signature ? "True" : "False", d.signature ? "ok-f" : "anom", d.signature ? "✔ VALID" : "⚠ INVALID", "", "Signature_Valid_Flag"),
      row("ALTERATION", d.alterationType, d.altered ? "anom" : "ok-f", d.altered ? "⚠ EDIT ADMITTED" : "✔ CLEAN", "", "PRALAYA_Alteration_Type"),
      row("RECOVERY LEVEL", d.recoveryLevel, "", "", "", "Identity_Recovery_Level")
    ].join("");

    const childRows = rec.child ? [
      row("CHILD PROFILE", rec.id, "", "LINKED", "", "child"),
      row("SECTOR (CHILD)", d.sectorChild, d.sectorMismatch ? "anom" : "",
        d.sectorMismatch ? "⚠ ≠ " + d.sectorParent : "✔ MATCHES PARENT",
        d.sectorMismatch ? "PROVENANCE MISMATCH — exposure disagrees with the parent residence" : "", "Sector_Exposure"),
      row("BLANK SKILL CELLS", d.childBlanks + " / 11", d.childBlanks >= BLANK_MIN ? "anom" : (d.childBlanks ? "" : "ok-f"),
        d.childBlanks >= BLANK_MIN ? "⚠ ERASURE PATTERN" : (d.childBlanks ? "1 — SURVEY GAP" : "✔ COMPLETE"),
        d.childBlanks >= BLANK_MIN ? "BLANKS: " + d.childBlankCols.join(", ").toUpperCase() : "", "blanks"),
      row("OCCUPATION", rec.child.Original_Occupation_Category, "", rec.child.Original_Occupation_Category === rec.parent.Original_Occupation ? "✔ AGREES" : "⚠ CONFLICT", "", "Original_Occupation_Category")
    ].join("") : row("CHILD PROFILE", "MISSING", "anom", "⚠ NO LINK", "", "");

    this.root.querySelector("#ih-body").innerHTML = `
      <div class="insp-sec">
        <span class="k">PARENT METADATA · PARENT_FINAL.csv</span>
        ${parentRows}
      </div>
      <div class="insp-sec">
        <span class="k">CHILD PROFILE · CHILD_FINAL.csv</span>
        ${childRows}
      </div>
      <div class="insp-sec">
        <span class="k">ACTIONS</span>
        <div class="insp-actions">
          <button class="tag sm" id="ia-compare">COMPARE</button>
          <button class="tag sm" id="ia-trace">TRACE</button>
          <button class="tag sm" id="ia-graph">GRAPH</button>
          <button class="tag sm" id="ia-ev">ADD EVIDENCE</button>
        </div>
        <p class="note" style="margin-top:12px">Click any metadata row to open its analysis sheet.</p>
      </div>`;

    this.root.querySelectorAll(".mrow[data-field]").forEach((el) => {
      const f = el.dataset.field;
      if (!f) return;
      el.addEventListener("click", () => this.fieldSheet(f));
    });
    this.root.querySelector("#ia-compare").addEventListener("click", () => this.compare());
    this.root.querySelector("#ia-trace").addEventListener("click", () => this.trace());
    this.root.querySelector("#ia-graph").addEventListener("click", () => { this.close(); window.ProvGraph && ProvGraph.jump(this.rec.id); });
    this.root.querySelector("#ia-ev").addEventListener("click", () => {
      this.addEvidence([
        { id: "RECORD-" + this.rec.id, label: "parent metadata · " + this.rec.id },
        { id: "CHILD-" + this.rec.id, label: "child profile · " + this.rec.id },
        { id: "CHECKSUM-" + checksum(this.rec.id + JSON.stringify(this.rec.derived)).slice(0, 4).toUpperCase(), label: "integrity digest · " + this.rec.id }
      ]);
      toast("EVIDENCE FILED · " + this.rec.id, "good");
    });

    this.root.classList.add("open");
  },

  addEvidence(list) {
    (Array.isArray(list) ? list : [list]).forEach((e) => {
      if (this.onEvidence) this.onEvidence(e);
      if (window.App) App.localEvidence(e);
    });
  },

  /* ---------- analysis sheets ---------- */
  fieldSheet(field) {
    const r = this.rec;
    const d = r.derived;
    let title = field.replace(/_/g, " ");
    let sub = "FIELD ANALYSIS · " + r.id;
    let table = "";
    let verdict = "";

    const K = (k, v) => `<tr><th>${k}</th><td>${esc(v)}</td></tr>`;

    if (field === "Access_Log_Timestamp" || field === "Transfer_Date") {
      title = "TIMESTAMP ANALYSIS";
      const breach = d.gapDays > AUDIT_WINDOW;
      const atEdge = Math.abs(d.gapDays - AUDIT_WINDOW) < 1e-9;
      table = K("CREATED (TRANSFER)", r.parent.Transfer_Date + " 00:00:00") +
        K("MODIFIED (AUDIT)", r.parent.Access_Log_Timestamp) +
        K("MEASURED LAG", fmtLag(d.gapDays) + "  (" + d.gapDays.toFixed(4) + " days)") +
        K("STATUTORY WINDOW", "7 days 12 hours  (7.5000 days)");
      verdict = breach
        ? `<div class="verdict breach"><span class="vtag">⚠ ANOMALOUS</span><span>the audit clock ran ${fmtLag(d.gapDays)} — past the statutory window.</span></div>`
        : atEdge
          ? `<div class="verdict edge"><span class="vtag">AT THE LIMIT</span><span>exactly 7d 12h — inside the window. Equality is not breach.</span></div>`
          : `<div class="verdict clean"><span class="vtag">✔ WITHIN WINDOW</span><span>${fmtLag(d.gapDays)} after transfer — the audit entry is timely.</span></div>`;
    } else if (field === "Record_Authenticity_Score") {
      title = "SEAL ANALYSIS";
      const unsealed = d.auth < AUTH_FLOOR;
      table = K("AUTHENTICITY", d.auth.toFixed(3)) +
        K("ARCHIVAL FLOOR", "0.500") +
        K("SEAL STATE", unsealed ? "UNSEALED" : "SEALED") +
        K("CROSS-CHECK · SIGNATURE", d.signature ? "True" : "False") +
        K("CROSS-CHECK · STATUS", d.status);
      verdict = unsealed
        ? `<div class="verdict breach"><span class="vtag">⚠ UNSEALED</span><span>below the 0.500 floor — provenance cannot be vouched for.</span></div>`
        : `<div class="verdict clean"><span class="vtag">✔ SEALED</span><span>at or above the archival floor.</span></div>`;
    } else if (field === "Vault_Case_ID" || field === "Transfer_Manifest_ID" || field === "Medical_Tag_ID") {
      title = "PROVENANCE CHAIN";
      const vn = Number(String(d.vault).split("-")[1]);
      const aligned = Number(String(d.manifest).split("-")[1]) - 1000 === vn &&
        Number(String(d.tag).split("-")[1]) - 2000 === vn;
      table = K("VAULT CASE", d.vault) + K("MANIFEST", d.manifest) + K("MEDICAL TAG", d.tag) +
        K("CHAIN ALIGNMENT", aligned ? "VC(n) → TM(n+1000) → MT(n+2000)" : "MISALIGNED");
      verdict = aligned
        ? `<div class="verdict clean"><span class="vtag">✔ CHAIN INTACT</span><span>identifiers align — but alignment only proves filing, not truth.</span></div>`
        : `<div class="verdict breach"><span class="vtag">⚠ MISALIGNED</span><span>the chain does not resolve.</span></div>`;
    } else if (field === "Previous_Identifier") {
      title = "IDENTITY HISTORY";
      table = K("PREVIOUS ID", d.prevId || "—") +
        K("ALTERATION TYPE", d.alterationType) +
        K("RECOVERY LEVEL", d.recoveryLevel);
      verdict = d.prevId
        ? `<div class="verdict edge"><span class="vtag">RENAMED</span><span>the record carries an old identifier — identity was reissued.</span></div>`
        : `<div class="verdict clean"><span class="vtag">✔ NO RENAME</span><span>no previous identifier on file.</span></div>`;
    } else if (field === "PRALAYA_Alteration_Type" || field === "Record_Alteration_Flag") {
      title = "ALTERATION ANALYSIS";
      table = K("ALTERATION FLAG", r.parent.Record_Alteration_Flag) +
        K("ALTERATION TYPE", r.parent.PRALAYA_Alteration_Type) +
        K("FALSIFIED TO PROTECT", r.parent.Falsified_To_Protect_Flag) +
        K("FLAG ↔ TYPE", (r.parent.Record_Alteration_Flag === "True") === (r.parent.PRALAYA_Alteration_Type !== "none") ? "CONSISTENT" : "CONFLICT");
      verdict = d.altered
        ? `<div class="verdict edge"><span class="vtag">EDIT ADMITTED</span><span>the archive admits this record was altered.</span></div>`
        : `<div class="verdict clean"><span class="vtag">✔ CLEAN</span><span>no alteration recorded.</span></div>`;
    } else if (field === "Signature_Valid_Flag") {
      title = "SIGNATURE ANALYSIS";
      table = K("SIGNATURE", d.signature ? "True" : "False") +
        K("AUTHENTICITY", d.auth.toFixed(3)) +
        K("ALTERATION", d.alterationType);
      verdict = d.signature
        ? `<div class="verdict clean"><span class="vtag">✔ VALID</span><span>signature checks out against the record.</span></div>`
        : `<div class="verdict breach"><span class="vtag">⚠ INVALID</span><span>the record does not carry a valid signature.</span></div>`;
    } else if (field === "Identity_Record_Status") {
      title = "STATUS ANALYSIS";
      table = K("STATUS", d.status) + K("RECOVERY LEVEL", d.recoveryLevel) +
        K("AUTHENTICITY", d.auth.toFixed(3)) + K("PREVIOUS ID", d.prevId || "—");
      verdict = d.status === "LOCKED"
        ? `<div class="verdict breach"><span class="vtag">⚠ LOCKED</span><span>held out of recovery — check why before trusting it.</span></div>`
        : `<div class="verdict clean"><span class="vtag">✔ ${d.status}</span><span>available to recovery.</span></div>`;
    } else if (field === "blanks") {
      title = "CHILD PROFILE INTEGRITY";
      table = K("BLANK SKILL CELLS", d.childBlanks + " of 11") +
        K("BLANK COLUMNS", d.childBlankCols.join(", ") || "—") +
        K("PARENT ALTERATION", r.parent.Record_Alteration_Flag + " (" + r.parent.PRALAYA_Alteration_Type + ")") +
        K("SURVEY GAP / ERASURE", d.childBlanks >= BLANK_MIN ? "ERASURE PATTERN" : (d.childBlanks === 1 ? "SURVEY GAP" : "COMPLETE"));
      verdict = (d.childBlanks >= BLANK_MIN && d.altered)
        ? `<div class="verdict breach"><span class="vtag">⚠ ERASURE</span><span>${d.childBlanks} blanks over an admitted edit — both conditions hold.</span></div>`
        : `<div class="verdict edge"><span class="vtag">NOT ERASURE</span><span>${d.childBlanks >= BLANK_MIN ? "blanks present, but the parent carries no alteration flag" : "not enough blanks for an erasure finding"}.</span></div>`;
    } else if (field === "Sector_Exposure") {
      title = "SECTOR CROSS-CHECK";
      table = K("PARENT RESIDENCE", d.sectorParent) + K("CHILD EXPOSURE", d.sectorChild) +
        K("AGREEMENT", d.sectorMismatch ? "MISMATCH" : "MATCH");
      verdict = d.sectorMismatch
        ? `<div class="verdict edge"><span class="vtag">⚠ MISMATCH</span><span>provenance disagreement between the two artifacts.</span></div>`
        : `<div class="verdict clean"><span class="vtag">✔ AGREES</span><span>both artifacts report the same sector.</span></div>`;
    } else if (field === "Original_Name") {
      title = "IDENTITY SHEET";
      table = K("NAME", "▮▮▮▮▮▮▮ (redacted at intake)") +
        K("OCCUPATION", r.parent.Original_Occupation) +
        K("ML PREDICTION", r.parent.ML_Predicted_Occupation + " (" + r.parent.ML_Occupation_Confidence + ")") +
        K("MAPPING CONFIDENCE", r.parent.Identity_Mapping_Confidence);
      verdict = `<div class="verdict"><span class="vtag">REDACTED</span><span>names are withheld — the metadata is what identifies this record.</span></div>`;
    } else if (field === "Sanctuary_ID") {
      title = "IDENTIFIER SHEET";
      table = K("SANCTUARY ID", r.id) + K("VAULT CASE", d.vault) +
        K("RELATIONSHIPS", (r.parent.Relationship_History || "").split(";").length + " linked records") +
        K("EVIDENCE FRAGMENTS", r.parent.Evidence_Fragment_Count);
      verdict = `<div class="verdict clean"><span class="vtag">✔ RESOLVED</span><span>identifier resolves across both artifacts.</span></div>`;
    } else if (field === "Original_Occupation_Category") {
      title = "OCCUPATION CROSS-CHECK";
      table = K("PARENT OCCUPATION", r.parent.Original_Occupation) +
        K("CHILD CATEGORY", r.child ? r.child.Original_Occupation_Category : "—");
      verdict = r.child && r.child.Original_Occupation_Category === r.parent.Original_Occupation
        ? `<div class="verdict clean"><span class="vtag">✔ AGREES</span><span>both artifacts agree.</span></div>`
        : `<div class="verdict breach"><span class="vtag">⚠ CONFLICT</span><span>the artifacts disagree.</span></div>`;
    } else {
      table = K("FIELD", field) + K("VALUE", r.parent[field] !== undefined ? r.parent[field] : (r.child ? r.child[field] : "—"));
      verdict = `<div class="verdict"><span class="vtag">RECORDED</span><span>raw metadata value as filed.</span></div>`;
    }

    openModal(`
      <h3>${title}</h3>
      <div class="mk-sub">${sub}</div>
      <table class="kv">${table}</table>
      ${verdict}
      <div style="margin-top:18px;display:flex;gap:10px;flex-wrap:wrap">
        <button class="tag sm" data-act="insp-compare">COMPARE</button>
        <button class="tag sm" data-act="insp-trace">TRACE</button>
        <button class="tag sm" data-act="insp-filefield::${esc(field)}">ADD EVIDENCE</button>
      </div>`);
  },

  fileField(field) {
    const id = this.rec.id;
    const map = {
      Access_Log_Timestamp: { id: "TIMESTAMP-" + id, label: "audit clock · " + id },
      Transfer_Date: { id: "TIMESTAMP-" + id, label: "transfer clock · " + id },
      Record_Authenticity_Score: { id: "SEAL-" + id, label: "authenticity seal · " + id },
      Vault_Case_ID: { id: "PROVENANCE-" + id, label: "chain of custody · " + id },
      blanks: { id: "CHILD-" + id, label: "child profile · " + id },
      Sector_Exposure: { id: "SECTOR-" + id, label: "sector cross-check · " + id }
    };
    const item = map[field] || { id: "FIELD-" + id, label: field + " · " + id };
    this.addEvidence(item);
    toast("EVIDENCE FILED · " + item.id, "good");
    closeModal();
  },

  /* ---------- parent <-> child comparison ---------- */
  compare() {
    const r = this.rec, d = r.derived;
    const crow = (k, v, cls) => `<div class="crow ${cls || ""}"><span class="ck">${k}</span><span class="cv">${esc(v)}</span></div>`;
    const parentSide = [
      crow("Sanctuary ID", r.id),
      crow("Occupation", r.parent.Original_Occupation),
      crow("Sector (residence)", d.sectorParent, d.sectorMismatch ? "diff" : ""),
      crow("Status", r.parent.Identity_Record_Status),
      crow("Previous ID", d.prevId || "—", d.prevId ? "diff" : ""),
      crow("Alteration", d.alterationType, d.altered ? "diff" : ""),
      crow("Authenticity", d.auth.toFixed(3), d.auth < AUTH_FLOOR ? "diff" : ""),
      crow("Signature", String(d.signature), d.signature ? "" : "diff"),
      crow("Transfer date", r.parent.Transfer_Date),
      crow("Audit stamp", r.parent.Access_Log_Timestamp, d.gapDays > AUDIT_WINDOW ? "diff" : ""),
      crow("Recovery level", d.recoveryLevel),
      crow("Evidence fragments", r.parent.Evidence_Fragment_Count)
    ].join("");

    const scoreRows = r.child
      ? (r.scoreColumns || Object.keys(r.child).filter((k) => k.endsWith("_Score")))
        .map((k) => {
          const v = r.child[k];
          return crow(k.replace(/_Score$/, "").replace(/_/g, " "), v === "" ? "— blank —" : v, v === "" ? "blank" : "");
        }).join("")
      : crow("profile", "MISSING", "blank");

    const childSide = [
      crow("Sanctuary ID", r.id),
      crow("Occupation category", r.child ? r.child.Original_Occupation_Category : "—",
        r.child && r.child.Original_Occupation_Category !== r.parent.Original_Occupation ? "diff" : ""),
      crow("Sector (exposure)", d.sectorChild, d.sectorMismatch ? "diff" : ""),
      ...scoreRows ? [crow("— skill profile —", "", "") + scoreRows] : []
    ].join("");

    openModal(`
      <h3>PARENT ↔ CHILD COMPARISON</h3>
      <div class="mk-sub">${r.id} · PARENT_FINAL.csv vs CHILD_FINAL.csv</div>
      <div class="cmp">
        <div class="cmp-col"><div class="cmp-h">PARENT RECORD</div>${parentSide}</div>
        <div class="cmp-col"><div class="cmp-h child">CHILD RECORD</div>${childSide}</div>
      </div>
      <div class="cmp-note">Highlighted rows disagree between artifacts, or fall outside the published rules.</div>
      <div class="verdict ${d.childBlanks >= BLANK_MIN && d.altered ? "breach" : "clean"}">
        <span class="vtag">${d.childBlanks >= BLANK_MIN && d.altered ? "⚠ ERASURE PATTERN" : "✔ NO ERASURE FINDING"}</span>
        <span>child blanks ${d.childBlanks}/${d.childBlankCols.length ? "11" : "11"} · parent altered ${d.altered ? "yes" : "no"}</span>
      </div>
      <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap">
        <button class="tag sm" data-act="insp-trace">TRACE</button>
        <button class="tag sm" data-act="file-pair::${r.id}">ADD EVIDENCE</button>
      </div>`);
  },

  /* ---------- provenance trace ---------- */
  async trace() {
    const id = this.rec.id;
    const t = await J("/api/record/" + id + "/trace");
    const rel = await J("/api/record/" + id + "/relations");
    if (t.error) return;
    const d = this.rec.derived;
    const rows = t.chain.map((c, i) => `
      <tr><th>${c.kind}</th><td><b>${esc(c.value)}</b><br><span class="dim" style="font-size:11px">${esc(c.note)}</span></td></tr>`).join("");
    const links = (rel.links || []).map((l) =>
      `<tr><th>${l.id}</th><td>${esc(l.status || "")} · ${esc(l.alterationType || "")} · auth ${l.auth != null ? Number(l.auth).toFixed(3) : "—"} · sig ${l.signature}</td></tr>`).join("");
    openModal(`
      <h3>PROVENANCE TRACE</h3>
      <div class="mk-sub">CHAIN OF CUSTODY · ${id}</div>
      <table class="kv">${rows}</table>
      <div class="k" style="margin-top:18px">LINKED RECORDS · Relationship_History</div>
      <table class="kv">${links || '<tr><td class="dim">none</td></tr>'}</table>
      <div class="verdict ${d.auth < AUTH_FLOOR || d.gapDays > AUDIT_WINDOW ? "breach" : "clean"}">
        <span class="vtag">${d.auth < AUTH_FLOOR || d.gapDays > AUDIT_WINDOW ? "⚠ TRAIL SUSPECT" : "✔ TRAIL COHERENT"}</span>
        <span>seal ${d.auth.toFixed(3)} · lag ${fmtLag(d.gapDays)} · ${d.alterationType}</span>
      </div>
      <div style="margin-top:16px">
        <button class="tag sm" data-act="provgraph-jump::${id}">OPEN GRAPH</button>
        <button class="tag sm" data-act="file-evidence::PROVENANCE-${id}::chain of custody · ${id}">ADD EVIDENCE</button>
      </div>`);
  }
};

/* ---------------- shared helpers ---------------- */
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function fmtLag(days) {
  const whole = Math.floor(days);
  const hrs = Math.round((days - whole) * 24);
  return whole + "d " + String(hrs).padStart(2, "0") + "h";
}
function checksum(s) {
  let h1 = 0x811c9dc5, h2 = 0x1000193;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 + s.charCodeAt(i), 2246822519) >>> 0;
  }
  return (h1.toString(16) + h2.toString(16)).padEnd(16, "0");
}
function openModal(html) {
  const m = document.getElementById("modal");
  document.getElementById("modal-body").innerHTML = html;
  m.hidden = false;
}
function closeModal() { document.getElementById("modal").hidden = true; }
function toast(msg, kind) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = kind || "";
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 2600);
}

window.Inspector = Inspector;
/* shared rule constants — explicit globals so every module (and the test
   harness) reads the same published thresholds */
window.AUDIT_WINDOW = AUDIT_WINDOW;
window.AUTH_FLOOR = AUTH_FLOOR;
window.BLANK_MIN = BLANK_MIN;
window.esc = esc;
window.fmtLag = fmtLag;
window.openModal = openModal;
window.closeModal = closeModal;
window.toast = toast;
