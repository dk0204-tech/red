/* =====================================================================
   THE LAST DATASET // CTF 03 — js/timeline.js
   Chronology view: two-lane timeline (transfer / audit) + lag ledger.
   Every lag is measured against the published statutory window (7d 12h).
   Boundary cases (exactly 7.5d) are marked AT LIMIT — equality is not breach.
   ===================================================================== */
"use strict";

const Chronology = {
  events: [],
  picked: new Set(),
  sortByLag: true,
  mount: null,

  async render(mount) {
    this.mount = mount;
    const t = await J("/api/timeline");
    if (t.error) { mount.innerHTML = '<p class="note">timeline unavailable</p>'; return; }

    /* measure every lag client-side (the player's instrument) */
    this.events = t.events.map((e) => {
      const ms = Date.parse(e.audit.replace(" ", "T") + "Z") - Date.parse(e.transfer + "T00:00:00Z");
      const gap = ms / 86400000;
      const atLimit = Math.abs(gap - AUDIT_WINDOW) < 1e-9;
      return Object.assign({}, e, {
        gap,
        atLimit,
        breach: gap > AUDIT_WINDOW
      });
    });

    mount.innerHTML = `
      <div class="chron-controls">
        <button class="tag sm ${this.sortByLag ? "" : "ghost"}" id="ch-sortlag">SORT BY LAG</button>
        <button class="tag sm ${this.sortByLag ? "ghost" : ""}" id="ch-sorttime">SORT BY DATE</button>
        <button class="tag sm ghost" id="ch-top">SHOW WORST 7</button>
        <span class="note">window = 7 days 12 hours · measure before you mark</span>
      </div>

      <div class="tl-wrap">
        <svg class="tl-svg" id="tl-svg" viewBox="0 0 1000 220" role="img" aria-label="transfer and audit lanes"></svg>
        <div class="tl-legend">
          <span><span class="dot"></span>within window</span>
          <span><span class="dot" style="background:var(--am)"></span>exactly at the limit — not breach</span>
          <span><span class="dot b"></span>past the window — anomalous</span>
          <span class="dim">click a marker for its timestamp analysis</span>
        </div>
      </div>

      <div class="explorer" id="ch-ledger">
        <div class="explorer-bar">
          <span class="k">LAG LEDGER</span>
          <span class="ex-meta" id="ch-meta"></span>
        </div>
        <div class="tbl-wrap" style="max-height:340px">
          <table class="data">
            <thead><tr>
              <th class="pick"></th><th>RECORD</th><th>TRANSFER</th><th>AUDIT</th>
              <th class="lag-sort" id="ch-lagh">LAG <span class="arr">▼</span></th><th>VERDICT</th><th></th>
            </tr></thead>
            <tbody id="ch-tbody"></tbody>
          </table>
        </div>
        <div class="file-bar">
          <span class="selinfo" id="ch-selinfo">0 SELECTED</span>
          <button class="tag sm ghost" id="ch-clear">CLEAR</button>
          <span style="flex:1"></span>
          <button class="tag" id="ch-file" disabled>FILE EXTRACT · RULE IV</button>
        </div>
      </div>`;

    this.drawLanes();
    this.renderLedger();

    mount.querySelector("#ch-sortlag").addEventListener("click", () => { this.sortByLag = true; this.renderLedger(); });
    mount.querySelector("#ch-sorttime").addEventListener("click", () => { this.sortByLag = false; this.renderLedger(); });
    mount.querySelector("#ch-top").addEventListener("click", () => {
      this.sortByLag = true;
      this.picked = new Set(this.sorted().slice(0, 7).filter((e) => e.breach).map((e) => e.id));
      this.renderLedger();
      toast("7 WORST LAGS MARKED — verify each before filing", "");
    });
    mount.querySelector("#ch-clear").addEventListener("click", () => { this.picked.clear(); this.renderLedger(); });
    mount.querySelector("#ch-file").addEventListener("click", () => this.file());
  },

  sorted() {
    const list = this.events.slice();
    if (this.sortByLag) list.sort((a, b) => b.gap - a.gap || a.id.localeCompare(b.id));
    else list.sort((a, b) => a.transfer.localeCompare(b.transfer) || a.id.localeCompare(b.id));
    return list;
  },

  drawLanes() {
    const svg = document.getElementById("tl-svg");
    if (!svg) return;
    const W = 1000, PAD = 46;
    const times = this.events.flatMap((e) => [Date.parse(e.transfer + "T00:00:00Z"), Date.parse(e.audit.replace(" ", "T") + "Z")]);
    const min = Math.min(...times), max = Math.max(...times);
    const x = (t) => PAD + ((t - min) / (max - min)) * (W - PAD * 2);

    const LANE_T = 74, LANE_A = 152;

    /* year ticks */
    let ticks = "";
    for (let y = 2024; y <= 2026; y++) {
      for (let q = 0; q < 4; q++) {
        const t = Date.UTC(y, q * 3, 1);
        if (t < min || t > max) continue;
        const px = x(t);
        ticks += `<line class="axis" x1="${px}" y1="${LANE_T - 26}" x2="${px}" y2="${LANE_A + 26}" stroke-dasharray="2 6"></line>`;
        if (q === 0) ticks += `<text class="tick" x="${px}" y="30" text-anchor="middle">${y}</text>`;
      }
    }

    const markers = this.events.map((e) => {
      const tx = x(Date.parse(e.transfer + "T00:00:00Z"));
      const ax = x(Date.parse(e.audit.replace(" ", "T") + "Z"));
      const cls = e.breach ? "breach" : (e.atLimit ? "" : "");
      const fill = e.breach ? "var(--rd)" : (e.atLimit ? "var(--am)" : "var(--cy)");
      return `
        <g class="ev ${cls}" data-id="${e.id}">
          <line x1="${tx}" y1="${LANE_T}" x2="${ax}" y2="${LANE_A}" stroke="${e.breach ? "#a8322a4d" : "#2b272199"}" stroke-width="1"></line>
          <circle cx="${tx}" cy="${LANE_T}" r="4" fill="#7fa6a0"></circle>
          <circle cx="${ax}" cy="${LANE_A}" r="4.6" fill="${fill}" ${e.breach ? 'class="b"' : ""}></circle>
          ${e.breach ? `<text x="${ax}" y="${LANE_A - 12}" text-anchor="middle" fill="#d2564b" font-size="11">⚠</text>` : ""}
          ${e.atLimit ? `<text x="${ax}" y="${LANE_A - 12}" text-anchor="middle" fill="#b8862b" font-size="11">│</text>` : ""}
        </g>`;
    }).join("");

    svg.innerHTML = `
      <text class="lane-label" x="6" y="${LANE_T + 4}">TRANSFER</text>
      <text class="lane-label" x="6" y="${LANE_A + 4}">AUDIT</text>
      <line class="axis" x1="${PAD}" y1="${LANE_T}" x2="${W - 20}" y2="${LANE_T}"></line>
      <line class="axis" x1="${PAD}" y1="${LANE_A}" x2="${W - 20}" y2="${LANE_A}"></line>
      ${ticks}
      ${markers}`;

    svg.querySelectorAll(".ev").forEach((g) => g.addEventListener("click", () => {
      const e = this.events.find((x) => x.id === g.dataset.id);
      this.sheet(e);
    }));
  },

  sheet(e) {
    const breach = e.breach, atLimit = e.atLimit;
    openModal(`
      <h3>TIMESTAMP ANALYSIS</h3>
      <div class="mk-sub">${e.id} · ${esc(e.type).replace(/_/g, " ").toUpperCase()}</div>
      <table class="kv">
        <tr><th>CREATED (TRANSFER)</th><td>${e.transfer} 00:00:00</td></tr>
        <tr><th>MODIFIED (AUDIT)</th><td>${e.audit}</td></tr>
        <tr><th>MEASURED LAG</th><td><b>${fmtLag(e.gap)}</b> (${e.gap.toFixed(4)} days)</td></tr>
        <tr><th>STATUTORY WINDOW</th><td>7 days 12 hours (7.5000 days)</td></tr>
      </table>
      ${breach
        ? `<div class="verdict breach"><span class="vtag">⚠ ANOMALOUS</span><span>audit written ${fmtLag(e.gap)} after transfer — past the window. The clock was moved.</span></div>`
        : atLimit
          ? `<div class="verdict edge"><span class="vtag">AT THE LIMIT</span><span>exactly 7d 12h. Inside the window — equality is not breach.</span></div>`
          : `<div class="verdict clean"><span class="vtag">✔ WITHIN WINDOW</span><span>${fmtLag(e.gap)} after transfer — timely audit entry.</span></div>`}
      <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap">
        <button class="tag sm" data-act="chron-mark::${e.id}">MARK THIS RECORD</button>
        <button class="tag sm" data-act="file-evidence::TIMESTAMP-${e.id}::audit clock · ${e.id}">ADD EVIDENCE</button>
        <button class="tag sm ghost" data-act="insp-open::${e.id}">OPEN INSPECTOR</button>
      </div>`);
  },

  mark(id) {
    this.picked.add(id);
    this.renderLedger();
    closeModal();
    toast("MARKED · " + id, "");
  },

  renderLedger() {
    const list = this.sorted();
    const tb = document.getElementById("ch-tbody");
    if (!tb) return;
    tb.innerHTML = list.map((e) => {
      const v = e.breach
        ? '<span class="badge no">⚠ BREACH</span>'
        : e.atLimit ? '<span class="badge" style="border-color:var(--am);color:var(--am)">AT LIMIT</span>'
          : '<span class="badge ok">WITHIN</span>';
      return `<tr data-id="${e.id}" class="${this.picked.has(e.id) ? "picked" : ""}">
        <td class="pick"><input class="pickbox" type="checkbox" data-pick="${e.id}" ${this.picked.has(e.id) ? "checked" : ""}></td>
        <td><b>${e.id}</b></td>
        <td>${e.transfer}</td>
        <td>${e.audit}</td>
        <td class="${e.breach ? "mut" : ""}">${fmtLag(e.gap)} <span class="faint">(${e.gap.toFixed(3)})</span></td>
        <td>${v}</td>
        <td><button class="rowbtn" data-an="${e.id}">ANALYZE</button></td>
      </tr>`;
    }).join("");

    tb.querySelectorAll("[data-pick]").forEach((cb) => cb.addEventListener("change", () => {
      if (cb.checked) this.picked.add(cb.dataset.pick); else this.picked.delete(cb.dataset.pick);
      this.renderLedger();
    }));
    tb.querySelectorAll("[data-an]").forEach((b) => b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.sheet(this.events.find((x) => x.id === b.dataset.an));
    }));
    tb.querySelectorAll("tr[data-id]").forEach((tr) => tr.addEventListener("click", (ev) => {
      if (ev.target.closest("input,button")) return;
      const id = tr.dataset.id;
      if (this.picked.has(id)) this.picked.delete(id); else this.picked.add(id);
      this.renderLedger();
    }));

    const n = this.picked.size;
    document.getElementById("ch-selinfo").textContent =
      `${n} SELECTED${n ? " · " + [...this.picked].sort().join(" ") : ""}`;
    document.getElementById("ch-file").disabled = n === 0;
    document.getElementById("ch-meta").textContent =
      `${this.events.length} EVENTS · ${this.events.filter((e) => e.breach).length} PAST WINDOW · WINDOW 7.5D`;
  },

  async file() {
    const ids = [...this.picked].sort();
    if (!ids.length) return;
    const r = await J("/api/chronology", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids })
    });
    if (r.ok) {
      toast("EXTRACT ACCEPTED · RULE IV", "good");
      App.onStageAccepted("chronology", r);
    } else {
      toast(r.msg || "EXTRACT REJECTED", "err");
      App.onStageRejected("chronology", r);
    }
    App.refreshHints();
  }
};

window.Chronology = Chronology;
