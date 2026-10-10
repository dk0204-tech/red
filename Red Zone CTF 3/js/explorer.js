/* =====================================================================
   THE LAST DATASET // CTF 03 — js/explorer.js
   Forensic dataset explorer: search · filter · sort · paginate · select.
   Talks to /api/dataset/:which — never loads the whole set at once.
   ===================================================================== */
"use strict";

const J = (u, o) => fetch(u, o).then((r) => r.json().catch(() => ({ error: "BAD_JSON" })));

class Explorer {
  /**
   * opts: { dataset:'parent'|'child', limit, filters:[{key,label}],
   *         selectable:bool, inspectLabel:'INSPECT', onInspect(id,row) }
   */
  constructor(opts) {
    this.o = Object.assign({ dataset: "parent", limit: 15, filters: [], selectable: false }, opts);
    this.q = "";
    this.page = 1;
    this.sort = "Sanctuary_ID";
    this.dir = "asc";
    this.filter = "";
    this.rows = [];
    this.columns = [];
    this.total = 0;
    this.pages = 1;
    this.picked = new Set();
    this.el = document.createElement("div");
    this.el.className = "explorer";
  }

  endpoint() {
    const p = new URLSearchParams({
      q: this.q, page: String(this.page), limit: String(this.o.limit),
      sort: this.sort, dir: this.dir
    });
    if (this.filter) p.set("filter", this.filter);
    return "/api/dataset/" + this.o.dataset + "?" + p.toString();
  }

  async load() {
    const d = await J(this.endpoint());
    if (d.error) { this.el.innerHTML = '<div class="explorer-bar">LOAD FAILED — ' + d.error + "</div>"; return; }
    this.rows = d.rows;
    this.columns = d.columns;
    this.total = d.total;
    this.pages = d.pages;
    this.page = d.page;
    this.sort = d.sort;
    this.dir = d.dir;
    this.render();
  }

  /* keep selection across pages */
  toggle(id) {
    if (this.picked.has(id)) this.picked.delete(id);
    else this.picked.add(id);
    this.renderFoot();
    this.renderRows();
  }
  clear() { this.picked.clear(); this.renderFoot(); this.renderRows(); }
  selected() { return [...this.picked].sort(); }

  cellClass(col, val) {
    if (val === "") return "blank-cell";
    if (col === "Record_Alteration_Flag" && val === "True") return "mut";
    if (col === "Signature_Valid_Flag" && val === "False") return "mut";
    if (col === "PRALAYA_Alteration_Type" && val !== "none") return "mut";
    if (col === "Falsified_To_Protect_Flag" && val === "True") return "mut";
    if (col === "Record_Authenticity_Score" && Number(val) < 0.5) return "mut";
    if (col === "Identity_Record_Status" && val === "LOCKED") return "mut";
    if (col === "Previous_Identifier" && val) return "mut";
    return "";
  }

  /* which columns to show (dataset-specific shortlist keeps it readable) */
  visibleColumns() {
    if (this.o.dataset === "child") {
      return ["Sanctuary_ID", "Technical_Skill_Score", "Medical_Skill_Score",
        "Communication_Skill_Score", "Leadership_Score", "Team_Coordination_Score",
        "Sector_Exposure", "Original_Occupation_Category"];
    }
    return ["Sanctuary_ID", "Original_Name", "Transfer_Date", "Vault_Case_ID",
      "Record_Alteration_Flag", "PRALAYA_Alteration_Type", "Record_Authenticity_Score",
      "Signature_Valid_Flag", "Access_Log_Timestamp", "Identity_Record_Status"];
  }

  render() {
    const f = this.o.filters.map((x) =>
      `<button class="f-chip ${this.filter === x.key ? "on" : ""}" data-f="${x.key}">${x.label}</button>`).join("");
    this.el.innerHTML = `
      <div class="explorer-bar">
        <input type="search" id="ex-q" placeholder="search ids, names, vault cases…" value="${this.escape(this.q)}">
        ${f}
        <span class="ex-meta" id="ex-meta"></span>
      </div>
      <div class="tbl-wrap"><table class="data"><thead id="ex-thead"></thead><tbody id="ex-tbody"></tbody></table></div>
      <div class="explorer-foot" id="ex-foot"></div>
      <div class="file-bar" id="ex-file" hidden></div>`;

    const qEl = this.el.querySelector("#ex-q");
    let t = null;
    qEl.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => { this.q = qEl.value.slice(0, 64); this.page = 1; this.load(); }, 220);
    });
    this.el.querySelectorAll(".f-chip").forEach((b) => b.addEventListener("click", () => {
      this.filter = this.filter === b.dataset.f ? "" : b.dataset.f;
      this.page = 1;
      this.load();
    }));

    this.renderHead();
    this.renderRows();
    this.renderFoot();
  }

  renderHead() {
    const cols = this.visibleColumns().filter((c) => this.columns.includes(c) || c === "Sanctuary_ID");
    const extra = this.o.dataset === "child" ? [] : [];
    this.el.querySelector("#ex-thead").innerHTML =
      (this.o.selectable ? '<th class="pick" data-nosort="1"></th>' : "") +
      cols.map((c) => {
        const on = this.sort === c;
        return `<th data-c="${c}" class="${on ? "sorted" : ""}">${c.replace(/_/g, " ")} <span class="arr">${on ? (this.dir === "asc" ? "▲" : "▼") : "◆"}</span></th>`;
      }).join("") +
      '<th data-nosort="1"></th>';

    this.el.querySelectorAll("#ex-thead th[data-c]").forEach((th) => th.addEventListener("click", () => {
      const c = th.dataset.c;
      if (this.sort === c) this.dir = this.dir === "asc" ? "desc" : "asc";
      else { this.sort = c; this.dir = "asc"; }
      this.load();
    }));
    void extra;
  }

  renderRows() {
    const cols = this.visibleColumns().filter((c) => this.columns.includes(c) || c === "Sanctuary_ID");
    const tb = this.el.querySelector("#ex-tbody");
    if (!this.rows.length) {
      tb.innerHTML = `<tr><td colspan="99" style="color:var(--tx-faint);padding:22px;text-align:center;letter-spacing:.14em">NO RECORDS MATCH THE QUERY</td></tr>`;
      return;
    }
    tb.innerHTML = this.rows.map((r) => {
      const id = r.Sanctuary_ID;
      const picked = this.picked.has(id);
      return `<tr data-id="${id}" class="${picked ? "picked" : ""}">
        ${this.o.selectable ? `<td class="pick"><input class="pickbox" type="checkbox" ${picked ? "checked" : ""} data-pick="${id}"></td>` : ""}
        ${cols.map((c) => `<td class="${this.cellClass(c, r[c])}">${this.escape(r[c])}</td>`).join("")}
        <td><button class="rowbtn" data-ins="${id}">${this.o.inspectLabel || "INSPECT"}</button></td>
      </tr>`;
    }).join("");

    tb.querySelectorAll("[data-pick]").forEach((cb) => cb.addEventListener("change", (e) => {
      e.stopPropagation();
      this.toggle(cb.dataset.pick);
    }));
    tb.querySelectorAll("[data-ins]").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this.o.onInspect) this.o.onInspect(b.dataset.ins, this.rows.find((r) => r.Sanctuary_ID === b.dataset.ins));
    }));
    tb.querySelectorAll("tr[data-id]").forEach((tr) => tr.addEventListener("click", () => {
      if (this.o.selectable) this.toggle(tr.dataset.id);
      else if (this.o.onInspect) this.o.onInspect(tr.dataset.id, this.rows.find((r) => r.Sanctuary_ID === tr.dataset.id));
    }));
  }

  renderFoot() {
    this.el.querySelector("#ex-meta").textContent =
      `${this.total} RECORDS · SORT ${this.sort.replace(/_/g, " ").toUpperCase()} ${this.dir.toUpperCase()}`;

    const foot = this.el.querySelector("#ex-foot");
    foot.innerHTML = `
      <button class="pgbtn" id="ex-prev" title="previous">‹</button>
      <span class="pginfo">PAGE ${this.page} / ${this.pages}</span>
      <button class="pgbtn" id="ex-next" title="next">›</button>
      <span class="pginfo faint">· ${this.total} TOTAL</span>`;
    const prev = foot.querySelector("#ex-prev"), next = foot.querySelector("#ex-next");
    prev.disabled = this.page <= 1;
    next.disabled = this.page >= this.pages;
    prev.addEventListener("click", () => { if (this.page > 1) { this.page--; this.load(); } });
    next.addEventListener("click", () => { if (this.page < this.pages) { this.page++; this.load(); } });

    const bar = this.el.querySelector("#ex-file");
    if (this.o.selectable) {
      bar.hidden = false;
      const n = this.picked.size;
      bar.innerHTML = `
        <span class="selinfo">${n} SELECTED${n ? " · " + [...this.picked].sort().join(" ") : ""}</span>
        <button class="tag sm ghost" id="ex-clear" ${n ? "" : "disabled"}>CLEAR</button>
        <span style="flex:1"></span>
        ${this.o.fileLabel ? `<button class="tag" id="ex-file-btn" ${n ? "" : "disabled"}>${this.o.fileLabel}</button>` : ""}`;
      const c = bar.querySelector("#ex-clear");
      if (c) c.addEventListener("click", () => this.clear());
      const fb = bar.querySelector("#ex-file-btn");
      if (fb && this.o.onFile) fb.addEventListener("click", () => this.o.onFile(this.selected()));
    }
  }

  escape(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
}

window.Explorer = Explorer;
window.J = J;
