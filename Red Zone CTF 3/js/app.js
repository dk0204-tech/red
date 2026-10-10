/* =====================================================================
   THE LAST DATASET // CTF 03 — js/app.js
   Stage router · evidence tray · hints · assembly console · recovery.
   No flag is ever embedded here — the digest is computed from the
   player's own filed extracts, and the server validates it.
   ===================================================================== */
"use strict";

/* ---------- pure JS sha256 (works without secure-context APIs) ---------- */
function sha256hex(str) {
  const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const bytes = new TextEncoder().encode(str);
  const bitLen = bytes.length * 8;
  const withPad = new Uint8Array((((bytes.length + 8) >> 6) + 1) * 64);
  withPad.set(bytes);
  withPad[bytes.length] = 0x80;
  const dv = new DataView(withPad.buffer);
  dv.setUint32(withPad.length - 4, bitLen >>> 0, false);
  dv.setUint32(withPad.length - 8, Math.floor(bitLen / 4294967296), false);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < withPad.length; off += 64) {
    const w = new Uint32Array(64);
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  return H.map((x) => x.toString(16).padStart(8, "0")).join("");
}

const STAGES = [
  ["case", "I", "Case intake"],
  ["exhibits", "II", "Exhibits"],
  ["meta", "III", "Provenance"],
  ["timeline", "IV", "Chronology"],
  ["correlation", "V", "Correlation"],
  ["reconstruction", "VI", "Reconstruction"],
  ["rec", "VII", "Recovery"]
];
const BRIEF_KEY = {
  case: "intake", exhibits: "exhibits", meta: "provenance",
  timeline: "chronology", correlation: "correlation",
  reconstruction: "reconstruction", rec: "recovery"
};

const App = {
  state: null,
  briefs: null,
  cur: "case",
  local: [],          /* session evidence added from the inspector */
  opened: new Set(),  /* exhibits opened this session */

  async init() {
    this.state = await J("/api/state");
    this.briefs = (await J("/api/briefs")).briefs;
    try { this.local = JSON.parse(localStorage.getItem("ctf3.ev") || "[]"); } catch (e) { this.local = []; }

    document.getElementById("btn-enter").addEventListener("click", () => this.enter());
    document.getElementById("modal-x").addEventListener("click", closeModal);
    document.getElementById("modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });
    document.getElementById("tray-toggle").addEventListener("click", () => {
      document.getElementById("tray").classList.toggle("collapsed");
    });
    Inspector.onEvidence = (e) => this.localEvidence(e);
    this.tickClock();
    setInterval(() => this.tickClock(), 1000);
    this.startTicker();
    this.startNoise();
    setTimeout(() => document.body.classList.add("revealed"), 2400);

    /* deep state: resume where the node left off */
    if (this.state.progress.intake) this.enter(true);
  },

  async enter(resume) {
    if (resume !== true) {
      document.body.classList.add("jit");
      const r = await J("/api/intake", { method: "POST", body: "{}" });
      if (r.ok) this.state = await J("/api/state");
      setTimeout(() => {
        document.getElementById("hero").classList.add("leaving");
        document.body.classList.remove("jit");
        setTimeout(() => {
          document.getElementById("hero").style.display = "none";
          document.getElementById("app").hidden = false;
          document.getElementById("tray").hidden = false;
          this.boot();
        }, 620);
      }, 340);
    } else {
      document.getElementById("hero").style.display = "none";
      document.getElementById("app").hidden = false;
      document.getElementById("tray").hidden = false;
      this.boot();
    }
  },

  async boot() {
    this.state = await J("/api/state");
    this.renderNav();
    this.renderTray();
    const p = this.state.progress;
    let first = p.solved ? "rec"
      : p.reconstruction ? "reconstruction"
        : (p.provenance && p.chronology) ? "correlation"
          : p.exhibits.parent && p.exhibits.child ? "meta"
            : "case";
    /* deep link: /#timeline opens that stage when unlocked */
    const hash = String(location.hash || "").replace("#", "");
    if (STAGES.some((s) => s[0] === hash) && (this.state.unlocked || []).indexOf(hash) >= 0) first = hash;
    this.go(first);
  },

  renderNav() {
    const unlocked = this.state.unlocked || [];
    const p = this.state.progress;
    const done = {
      case: p.intake,
      exhibits: p.exhibits.parent && p.exhibits.child,
      meta: !!p.provenance,
      timeline: !!p.chronology,
      correlation: !!p.correlation,
      reconstruction: !!p.reconstruction,
      rec: p.solved
    };
    document.getElementById("nav").innerHTML = STAGES.map(([k, n, l]) => {
      const lock = unlocked.indexOf(k) < 0;
      return `<button class="nav-a ${this.cur === k ? "on" : ""} ${lock ? "locked" : ""}" data-k="${k}">
        <i>${n}</i>${l}${lock ? '<span class="s">SEALED</span>' : (done[k] ? '<span class="done">✔</span>' : "")}</button>`;
    }).join("");
    document.querySelectorAll(".nav-a").forEach((b) => b.addEventListener("click", () => this.go(b.dataset.k)));

    const ev = (this.state.evidence || []).length + this.local.length;
    document.getElementById("ev-count").textContent = ev;
    document.getElementById("integrity").textContent = p.solved ? "VERIFIED" : "COMPROMISED";
    document.getElementById("integrity").className = p.solved ? "ok" : "bad";
    document.getElementById("recovery-state").textContent = p.solved ? "COMPLETE" : "OPEN";
    document.getElementById("recovery-state").className = p.solved ? "ok" : "";
  },

  async go(key) {
    const unlocked = this.state.unlocked || [];
    if (unlocked.indexOf(key) < 0) { toast("STAGE SEALED — finish the prior stage", "err"); return; }
    this.cur = key;
    this.renderNav();
    try { history.replaceState(null, "", "#" + key); } catch (e) { /* file:// */ }
    const main = document.getElementById("m");
    main.innerHTML = `<div class="stage-body" id="sb"></div>`;
    const sb = document.getElementById("sb");
    const b = this.briefs[BRIEF_KEY[key]];

    const head = (num, title, sub) => `
      <div class="stage-head"><span class="num">${num}</span><h2>${title}</h2><span class="sub">${sub}</span></div>
      <div class="progress-strip">${STAGES.map(([k], i) => {
        const dk = { case: "intake", exhibits: "exhibits", meta: "provenance", timeline: "chronology", correlation: "correlation", reconstruction: "reconstruction", rec: "solved" }[k];
        const p = this.state.progress;
        const isDone = dk === "exhibits" ? (p.exhibits.parent && p.exhibits.child) : !!p[dk];
        return `<span class="p ${isDone ? "done" : (k === key ? "cur" : "")}"></span>`;
      }).join("")}</div>`;

    const paperBrief = () => `
      <div class="paper scanline">
        <div class="stamp">${numRoman(key)}</div>
        <h2>${esc(b.title)}</h2>
        ${b.body.map((l) => l ? `<p>${esc(l)}</p>` : "<br>").join("")}
      </div>`;

    const num = numRoman(key);
    const views = {
      case: () => this.vCase(sb, head, paperBrief),
      exhibits: () => this.vExhibits(sb, head, paperBrief),
      meta: () => this.vMeta(sb, head, paperBrief),
      timeline: () => this.vTimeline(sb, head, paperBrief),
      correlation: () => this.vCorrelation(sb, head, paperBrief),
      reconstruction: () => this.vRecon(sb, head, paperBrief),
      rec: () => this.vRec(sb, head, paperBrief)
    };
    void num;
    await views[key]();
    main.scrollIntoView({ behavior: "instant", block: "start" });
  },

  /* ---------------- views ---------------- */
  async vCase(sb, head, paperBrief) {
    const brief = (await J("/api/brief")).log;
    const done = this.state.progress.intake;
    sb.innerHTML = head("I", "CASE INTAKE", "REF CHILD-17 · NODE 07") + `
      <div class="two-col">
        <div>
          ${paperBrief()}
          <div class="paper">
            <h3>INTAKE MEMO</h3>
            <pre style="white-space:pre-wrap;font:12.4px/1.75 var(--mono);color:var(--ink);margin:0">${esc(brief)}</pre>
            <div style="margin-top:16px">
              ${done
                ? '<span class="badge ok" style="font-size:12px">INTAKE ACKNOWLEDGED</span>'
                : '<button class="tag paper-ink" id="ack">ACKNOWLEDGE INTAKE</button>'}
            </div>
          </div>
        </div>
        <div>
          <div class="card card-amber">
            <span class="k">PUBLISHED RULES</span>
            <ul class="rule-list" style="list-style:none;padding:0;margin:0;color:var(--tx);font-size:12.6px">
              <li style="border-color:var(--line)"><b class="am">III · ARCHIVAL FLOOR</b><br><span class="dim">authenticity below 0.500 = unsealed</span></li>
              <li style="border-color:var(--line)"><b class="am">IV · STATUTORY WINDOW</b><br><span class="dim">audit later than 7d 12h = moved clock</span></li>
              <li style="border-color:var(--line)"><b class="am">V · CHILD INTEGRITY</b><br><span class="dim">≥2 blank cells over an admitted edit = erasure</span></li>
            </ul>
          </div>
          ${this.hintPanel()}
          <div class="card">
            <span class="k">NODE STATUS</span>
            <div class="note">
              parent records ............ <b class="tx">${this.state.stats.records}</b><br>
              child records ............. <b class="tx">${this.state.stats.childRecords}</b><br>
              altered in parent ......... <b class="bad">${this.state.stats.altered}</b><br>
              signatures failed ......... <b class="bad">${this.state.stats.signatureFailed}</b><br>
              child profiles w/ blanks .. <b class="am">${this.state.stats.childWithBlanks}</b>
            </div>
          </div>
        </div>
      </div>`;
    const ack = document.getElementById("ack");
    if (ack) ack.addEventListener("click", async () => {
      await J("/api/intake", { method: "POST", body: "{}" });
      await this.refresh();
      toast("INTAKE ACKNOWLEDGED · EXHIBITS UNLOCKED", "good");
      this.go("exhibits");
    });
    this.renderHints(sb);
  },

  async vExhibits(sb, head, paperBrief) {
    const data = await J("/api/exhibits");
    const insp = this.state.progress.exhibits;
    const seen = new Set();
    if (insp.parent) seen.add("PARENT_FINAL.csv");
    if (insp.child) seen.add("CHILD_FINAL.csv");
    this.opened = seen;

    sb.innerHTML = head("II", "EXHIBITS", "ARTIFACTS IN CUSTODY") + `
      ${paperBrief()}
      <div class="ex-grid" id="ex-grid">${data.exhibits.map((x) => this.exCard(x, seen.has(x.name))).join("")}</div>
      <div class="card card-accent" id="ex-status"></div>`;
    this.renderExStatus();

    data.exhibits.forEach((x) => {
      const btn = document.getElementById("insp-" + x.no);
      btn.addEventListener("click", () => this.inspectExhibit(x));
    });
    this.renderHints(sb);
  },

  exCard(x, opened) {
    return `<div class="ex-card ${opened ? "opened" : ""}" id="card-${x.no}">
      <span class="opened-mark">✔ OPENED</span>
      <div class="ex-no">EVIDENCE ${x.no}</div>
      <h3>${esc(x.name)}</h3>
      <div class="ex-kind">${esc(x.kind)}</div>
      <div class="ex-status ${x.status.indexOf("INTACT") >= 0 ? "ok" : ""}">${esc(x.status)}</div>
      <div class="ex-stat">
        <span><b>${x.records}</b>RECORDS</span>
        <span><b>${x.columns}</b>COLUMNS</span>
      </div>
      <div class="ex-fields">FIELDS · ${x.fields.map(esc).join(" · ")}</div>
      <div class="ex-sha">sha256 ${esc(x.sha256)}</div>
      <div class="ex-actions">
        <button class="tag sm paper-ink" id="insp-${x.no}">INSPECT</button>
        <button class="tag sm paper-ink" data-act="verify-sha">VERIFY SHA</button>
      </div>
    </div>`;
  },

  inspectExhibit(x) {
    openModal(`
      <h3>EXHIBIT ${x.no} — ${esc(x.name)}</h3>
      <div class="mk-sub">${esc(x.kind)}</div>
      <table class="kv">
        <tr><th>RECORDS</th><td>${x.records}</td></tr>
        <tr><th>COLUMNS</th><td>${x.columns}</td></tr>
        <tr><th>SHA-256</th><td>${esc(x.sha256)}</td></tr>
        <tr><th>STATUS</th><td>${esc(x.status)}</td></tr>
        <tr><th>KEY FIELDS</th><td>${x.fields.map(esc).join("<br>")}</td></tr>
      </table>
      <p class="note">Custody sheet matches the artifact on disk. Opened exhibits count toward stage progression.</p>
      <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap">
        <button class="tag sm" id="mx-open">MARK OPENED</button>
        <button class="tag sm" data-act="open-dataset::${x.name.indexOf("PARENT") === 0 ? "parent" : "child"}">OPEN IN EXPLORER</button>
      </div>`);
    document.getElementById("mx-open").addEventListener("click", async () => {
      this.opened.add(x.name);
      const r = await J("/api/exhibits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inspected: [...this.opened] })
      });
      closeModal();
      if (r.ok) {
        toast("BOTH EXHIBITS OPENED · STAGES III–V UNLOCKED", "good");
        await this.refresh();
        this.go("meta");
      } else {
        toast(r.msg || "open both exhibits", "err");
        const card = document.getElementById("card-" + x.no);
        if (card && this.opened.has(x.name)) card.classList.add("opened");
        this.renderExStatus();
      }
    });
  },

  renderExStatus() {
    const el = document.getElementById("ex-status");
    if (!el) return;
    const p = this.state.progress.exhibits;
    const n = (p.parent ? 1 : 0) + (p.child ? 1 : 0);
    el.innerHTML = `<span class="k">CUSTODY</span>
      <div class="note">exhibits opened: <b class="${n === 2 ? "ok" : "am"}">${n}/2</b> —
      ${n === 2 ? "stages III, IV and V are unlocked" : "both exhibits must be opened before any extract can be filed"}</div>`;
  },

  openDataset(which) {
    closeModal();
    this.go(which === "parent" ? "meta" : "correlation");
  },

  /* ---- stage III: provenance ---- */
  vMeta(sb, head, paperBrief) {
    sb.innerHTML = head("III", "METADATA / PROVENANCE", "RULE III · ARCHIVAL FLOOR") + `
      ${paperBrief()}
      <div id="graph-slot"></div>
      <div class="two-col">
        <div>
          <div class="k" style="margin-bottom:10px">PARENT DATASET EXPLORER · PARENT_FINAL.csv</div>
          <div id="ex-slot"></div>
        </div>
        <div>
          ${this.hintPanel()}
          <div class="card card-amber">
            <span class="k">HOW TO WORK THIS STAGE</span>
            <div class="note">
              1 · sort <b>Record Authenticity Score</b> ascending in the table header<br>
              2 · every record below <b class="bad">0.500</b> is unsealed — click rows to confirm in the inspector<br>
              3 · tick them, then <b>FILE EXTRACT · RULE III</b><br>
              4 · the provenance graph shows the chain each record claims
            </div>
          </div>
        </div>
      </div>`;

    const ex = new Explorer({
      dataset: "parent",
      limit: 15,
      selectable: true,
      filters: [
        { key: "", label: "ALL" },
        { key: "altered", label: "ALTERED" },
        { key: "locked", label: "LOCKED" },
        { key: "prev", label: "RENAMED" }
      ],
      fileLabel: "FILE EXTRACT · RULE III",
      onInspect: (id) => { Inspector.open(id); ProvGraph.render(document.getElementById("graph-slot"), id); },
      onFile: async (ids) => {
        const r = await J("/api/provenance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids })
        });
        if (r.ok) { toast("EXTRACT ACCEPTED · RULE III", "good"); this.onStageAccepted("provenance", r); }
        else { toast(r.msg || "EXTRACT REJECTED", "err"); this.onStageRejected("provenance", r); }
        this.refreshHints();
      }
    });
    document.getElementById("ex-slot").appendChild(ex.el);
    ex.load();
    ProvGraph.render(document.getElementById("graph-slot"), "S001");
    this.renderHints(sb);
  },

  /* ---- stage IV ---- */
  async vTimeline(sb, head, paperBrief) {
    sb.innerHTML = head("IV", "CHRONOLOGY", "RULE IV · STATUTORY WINDOW") + `
      ${paperBrief()}
      <div class="two-col">
        <div id="chron-slot"></div>
        <div>
          ${this.hintPanel()}
          <div class="card card-amber">
            <span class="k">HOW TO WORK THIS STAGE</span>
            <div class="note">
              1 · the lanes show <b>transfer</b> and <b>audit</b> events across 2024–2026<br>
              2 · <b>SORT BY LAG</b> in the ledger — the worst offenders rise<br>
              3 · red markers are past the window; amber ones sit <b>exactly</b> on it<br>
              4 · mark every breach, then <b>FILE EXTRACT · RULE IV</b>
            </div>
          </div>
        </div>
      </div>`;
    await Chronology.render(document.getElementById("chron-slot"));
    this.renderHints(sb);
  },

  /* ---- stage V: parent <-> child ---- */
  async vCorrelation(sb, head, paperBrief) {
    const led = await J("/api/ledger");
    sb.innerHTML = head("V", "PARENT ↔ CHILD CORRELATION", "RULE V · CHILD INTEGRITY") + `
      ${paperBrief()}
      <div class="two-col">
        <div>
          <div class="k" style="margin-bottom:10px">CORRELATION LEDGER · BOTH ARTIFACTS JOINED ON Sanctuary_ID</div>
          <div class="explorer">
            <div class="explorer-bar">
              <input type="search" id="co-q" placeholder="search id, alteration, blank column…">
              <button class="f-chip on" data-f="">ALL</button>
              <button class="f-chip" data-f="blank2">≥2 BLANKS</button>
              <button class="f-chip" data-f="altered">ALTERED</button>
              <button class="f-chip" data-f="both">BOTH RAW</button>
              <span class="ex-meta" id="co-meta"></span>
            </div>
            <div class="tbl-wrap" style="max-height:400px">
              <table class="data">
                <thead><tr>
                  <th class="pick"></th><th>RECORD</th><th>PARENT ALTERATION</th>
                  <th>CHILD BLANKS</th><th>BLANK COLUMNS</th><th>SECTOR Δ</th><th></th>
                </tr></thead>
                <tbody id="co-tbody"></tbody>
              </table>
            </div>
            <div class="file-bar">
              <span class="selinfo" id="co-selinfo">0 SELECTED</span>
              <button class="tag sm ghost" id="co-clear">CLEAR</button>
              <span style="flex:1"></span>
              <button class="tag" id="co-file" disabled>FILE EXTRACT · RULE V</button>
            </div>
          </div>
          <div class="card card-amber">
            <span class="k">HOW TO WORK THIS STAGE</span>
            <div class="note">
              Rule V needs <b>both</b> conditions on the same record:<br>
              · child profile has <b class="bad">≥ 2 blank skill cells</b>, <b>and</b><br>
              · the parent carries <b class="am">Record_Alteration_Flag = True</b>.<br>
              The tint marks records missing skills — check their parent flag before ticking.
              Click any row for the full parent ↔ child comparison.
            </div>
          </div>
        </div>
        <div>
          ${this.hintPanel()}
          <div class="card">
            <span class="k">CHILD DATASET EXPLORER</span>
            <div id="co-child-slot"></div>
          </div>
        </div>
      </div>`;

    this.ledger = led.rows;
    this.pickedCorr = new Set();
    this.corrFilter = "";
    this.renderCorrLedger();

    const q = document.getElementById("co-q");
    q.addEventListener("input", () => { this.corrSearch = q.value.toLowerCase(); this.renderCorrLedger(); });
    document.querySelectorAll("#sb .f-chip[data-f]").forEach((b) => b.addEventListener("click", () => {
      document.querySelectorAll("#sb .f-chip[data-f]").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      this.corrFilter = b.dataset.f;
      this.renderCorrLedger();
    }));
    document.getElementById("co-clear").addEventListener("click", () => {
      this.pickedCorr.clear(); this.renderCorrLedger();
    });
    document.getElementById("co-file").addEventListener("click", async () => {
      const ids = [...this.pickedCorr].sort();
      if (!ids.length) return;
      const r = await J("/api/correlation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids })
      });
      if (r.ok) { toast("EXTRACT ACCEPTED · RULE V", "good"); this.onStageAccepted("correlation", r); }
      else { toast(r.msg || "EXTRACT REJECTED", "err"); this.onStageRejected("correlation", r); }
      this.refreshHints();
    });

    const childEx = new Explorer({
      dataset: "child", limit: 10,
      filters: [{ key: "", label: "ALL" }, { key: "blanks", label: "HAS BLANKS" }],
      onInspect: (id) => Inspector.open(id),
      inspectLabel: "COMPARE"
    });
    document.getElementById("co-child-slot").appendChild(childEx.el);
    childEx.load();
    this.renderHints(sb);
  },

  corrRows() {
    let rows = this.ledger;
    if (this.corrFilter === "blank2") rows = rows.filter((r) => r.blanks >= 2);
    if (this.corrFilter === "altered") rows = rows.filter((r) => r.altered);
    if (this.corrFilter === "both") rows = rows.filter((r) => r.blanks >= 1 && r.altered);
    if (this.corrSearch) {
      rows = rows.filter((r) =>
        (r.id + " " + r.alterationType + " " + r.blankCols.join(" ")).toLowerCase().includes(this.corrSearch));
    }
    return rows;
  },

  renderCorrLedger() {
    const rows = this.corrRows();
    const tb = document.getElementById("co-tbody");
    if (!tb) return;
    const shown = rows.slice(0, 60);
    tb.innerHTML = shown.map((r) => `
      <tr data-id="${r.id}" class="${this.pickedCorr.has(r.id) ? "picked" : ""} ${r.blanks >= 2 ? "sel" : ""}"
          style="${r.blanks >= 2 ? "background:rgba(168,50,42,.07)" : ""}">
        <td class="pick"><input class="pickbox" type="checkbox" data-pick="${r.id}" ${this.pickedCorr.has(r.id) ? "checked" : ""}></td>
        <td><b>${r.id}</b></td>
        <td class="${r.altered ? "mut" : ""}">${r.altered ? "True · " + esc(r.alterationType) : "False · none"}</td>
        <td class="${r.blanks >= 2 ? "mut" : ""}">${r.blanks} / 11</td>
        <td class="${r.blanks >= 2 ? "mut" : ""}" style="font-size:11px">${r.blankCols.length ? esc(r.blankCols.join(", ")) : "—"}</td>
        <td class="${r.sectorMismatch ? "mut" : ""}">${r.sectorMismatch ? "⚠ Δ" : "—"}</td>
        <td><button class="rowbtn" data-cmp="${r.id}">COMPARE</button></td>
      </tr>`).join("") || `<tr><td colspan="7" style="text-align:center;color:var(--tx-faint);padding:20px">NO MATCHES</td></tr>`;

    tb.querySelectorAll("[data-pick]").forEach((cb) => cb.addEventListener("change", (e) => {
      e.stopPropagation();
      if (cb.checked) this.pickedCorr.add(cb.dataset.pick); else this.pickedCorr.delete(cb.dataset.pick);
      this.renderCorrLedger();
    }));
    tb.querySelectorAll("[data-cmp]").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      Inspector.open(b.dataset.cmp).then(() => Inspector.compare());
    }));
    tb.querySelectorAll("tr[data-id]").forEach((tr) => tr.addEventListener("click", (ev) => {
      if (ev.target.closest("input,button")) return;
      const id = tr.dataset.id;
      if (this.pickedCorr.has(id)) this.pickedCorr.delete(id); else this.pickedCorr.add(id);
      this.renderCorrLedger();
    }));

    document.getElementById("co-meta").textContent =
      `${rows.length} ROWS · ${rows.filter((r) => r.blanks >= 2).length} WITH ≥2 BLANKS`;
    const n = this.pickedCorr.size;
    document.getElementById("co-selinfo").textContent =
      `${n} SELECTED${n ? " · " + [...this.pickedCorr].sort().join(" ") : ""}`;
    document.getElementById("co-file").disabled = n === 0;
  },

  /* ---- stage VI: reconstruction ---- */
  async vRecon(sb, head, paperBrief) {
    const st = await J("/api/state");
    this.state = st;
    const p = st.progress;
    const proto = (await J("/api/protocol")).protocol;
    const seg = (v, label) => `
      <div class="stamp-card ${v ? "approved" : ""}">
        <span class="k">${label}</span>
        <div class="cnt">${v ? v.length : "—"}</div>
        <div class="ids">${v ? esc(v.join(",")) : "not filed"}</div>
      </div>`;

    sb.innerHTML = head("VI", "RECONSTRUCTION", "ASSEMBLE THE MATERIAL") + `
      ${paperBrief()}
      <div class="stamps">
        ${seg(p.provenance, "PROVENANCE · RULE III")}
        ${seg(p.chronology, "CHRONOLOGY · RULE IV")}
        ${seg(p.correlation, "CORRELATION · RULE V")}
      </div>
      <div class="two-col">
        <div class="console">
          <label>ASSEMBLY CONSOLE · MATERIAL</label>
          <textarea id="asm-mat" spellcheck="false">${p.reconstruction ? esc([p.provenance, p.chronology, p.correlation].map((a) => a.join(",")).join("|")) : ""}</textarea>
          <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap">
            <button class="tag" id="asm-go" ${p.reconstruction ? "" : "disabled"}>COMPUTE DIGEST</button>
            <button class="tag ghost" id="asm-reset">RESET FROM FILED EXTRACTS</button>
          </div>
          <div class="out" id="asm-out">awaiting material…</div>
        </div>
        <div>
          <div class="card card-accent">
            <span class="k">PROTOCOL</span>
            <pre style="white-space:pre-wrap;font:12px/1.75 var(--mono);color:var(--tx);margin:0">${esc(proto)}</pre>
          </div>
          ${this.hintPanel()}
        </div>
      </div>`;

    const out = document.getElementById("asm-out");
    document.getElementById("asm-go").addEventListener("click", () => {
      const mat = document.getElementById("asm-mat").value.trim();
      if (!mat) { toast("material is empty", "err"); return; }
      const digest = sha256hex(mat);
      const flag = "RZ{" + digest.slice(0, 32) + "}";
      out.innerHTML =
        `material\n  <b>${esc(mat)}</b>\n\n` +
        `sha256\n  <b>${digest}</b>\n\n` +
        `reconstructed value\n  <span class="flagline">${flag}</span>\n\n` +
        `<span class="dim">carry this value to stage VII — the archive validates it server-side.</span>`;
      App.reconFlag = flag;
      toast("DIGEST COMPUTED", "good");
      if (!document.getElementById("asm-use")) {
        const b = document.createElement("button");
        b.className = "tag ok-b"; b.id = "asm-use"; b.textContent = "OPEN RECOVERY →";
        b.style.marginTop = "12px";
        b.addEventListener("click", () => this.go("rec"));
        out.appendChild(document.createElement("div")).appendChild(b);
      }
    });
    document.getElementById("asm-reset").addEventListener("click", async () => {
      const s = await J("/api/state");
      document.getElementById("asm-mat").value =
        [s.progress.provenance, s.progress.chronology, s.progress.correlation]
          .map((a) => (a || []).join(",")).join("|");
      toast("material rebuilt from filed extracts", "");
    });
    this.renderHints(sb);
  },

  /* ---- stage VII: recovery ---- */
  async vRec(sb, head, paperBrief) {
    const solved = this.state.progress.solved;
    sb.innerHTML = head("VII", "RECOVERY", "CHILD-17 RELEASE") + `
      ${paperBrief()}
      <div class="two-col">
        <div>
          <div class="card card-accent">
            <span class="k">SUBMIT RECONSTRUCTED VALUE</span>
            <div class="flagbox">
              <input type="text" id="flag-in" placeholder="RZ{32 hex characters}" autocomplete="off" spellcheck="false"
                     value="${esc(App.reconFlag || "")}">
              <button class="tag" id="flag-go">SUBMIT</button>
            </div>
            <div class="resp" id="flag-resp" hidden></div>
          </div>
          <div class="term" id="term">$ node07 --await-reconstruction
<span class="cursor"></span></div>
          <div id="reveal-slot"></div>
        </div>
        <div>
          ${this.hintPanel()}
          <div class="card">
            <span class="k">BEFORE YOU SUBMIT</span>
            <div class="note">
              · three extracts must be filed (stages III–V)<br>
              · material = <b>prov|chron|corr</b>, ascending, comma separated<br>
              · value = <b class="am">RZ{ sha256(material)[0…31] }</b><br>
              · the assembly console computes it for you
            </div>
          </div>
        </div>
      </div>`;

    document.getElementById("flag-go").addEventListener("click", () => this.submitFlag());
    document.getElementById("flag-in").addEventListener("keydown", (e) => { if (e.key === "Enter") this.submitFlag(); });
    if (solved) this.showReveal(null, true);
    this.renderHints(sb);
  },

  async submitFlag() {
    const input = document.getElementById("flag-in");
    const resp = document.getElementById("flag-resp");
    const term = document.getElementById("term");
    const val = input.value.trim();
    if (!val) { toast("enter a value", "err"); return; }

    resp.hidden = false;
    resp.className = "resp";
    resp.textContent = "> transmitting…";

    const r = await J("/api/flag", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flag: val })
    });

    if (r.granted) {
      resp.className = "resp granted";
      resp.textContent = "> FLAG ACCEPTED";
      await this.cinematic(r);
      this.showReveal(r);
      await this.refresh();
      toast("CHILD DATASET RECOVERED", "good");
    } else {
      resp.className = "resp denied";
      resp.textContent = ["> " + r.title].concat(r.lines || []).join("\n");
      term.innerHTML = `$ node07 --verify ${esc(val.slice(0, 20))}…\n> ${esc(r.title)}\n> ${(r.lines || []).join("\n  ")}\n<span class="cursor"></span>`;
      toast(r.title || "RECONSTRUCTION FAILED", "err");
      this.refreshHints();
    }
  },

  cinematic(r) {
    const term = document.getElementById("term");
    term.textContent = "";
    const lines = (r.lines || []).concat(["> FLAG ACCEPTED"]);
    let i = 0;
    return new Promise((done) => {
      const step = () => {
        if (i >= lines.length) {
          term.innerHTML += '\n<span class="ok">■ RECOVERY COMPLETE — CHILD-17 RELEASED</span>\n<span class="cursor"></span>';
          return done();
        }
        term.textContent += (i ? "\n" : "") + lines[i];
        i++;
        setTimeout(step, 420);
      };
      step();
    });
  },

  async showReveal(r, already) {
    const slot = document.getElementById("reveal-slot");
    if (!slot) return;
    slot.innerHTML = `
      <div class="reveal-panel">
        <div class="rp-bar">FLAG ACCEPTED</div>
        <div class="rp-body">
          <div class="k">RECOVERY RECORD · CHILD-17</div>
          <h2>CHILD DATASET RECOVERED</h2>
          <div class="reveal-grid">
            <div class="rg"><span class="k">PROVENANCE</span><b>VERIFIED</b></div>
            <div class="rg"><span class="k">INTEGRITY</span><b>VERIFIED</b></div>
            <div class="rg"><span class="k">RECORDS</span><b>RECOVERED</b></div>
            <div class="rg"><span class="k">METADATA</span><b>RECONSTRUCTED</b></div>
          </div>
          <div class="reveal-actions">
            <button class="tag" id="rv-open">OPEN CHILD DATASET</button>
            <a class="tag ghost" style="text-decoration:none" href="/api/download/child" download="CHILD_FINAL.csv">DOWNLOAD DATASET</a>
          </div>
          <p class="note" style="margin-top:18px">120 profiles · 14 columns · released by Node 07 after reconstruction.</p>
        </div>
      </div>`;
    document.getElementById("rv-open").addEventListener("click", () => this.openRecovered());
    void r; void already;
  },

  async openRecovered() {
    const csv = await fetch("/api/download/child").then((x) => x.text());
    const lines = csv.trim().split("\n");
    const h = lines[0].split(",");
    const rows = lines.slice(1).map((l) => l.split(","));
    openModal(`
      <h3>CHILD DATASET — RECOVERED</h3>
      <div class="mk-sub">CHILD_FINAL.csv · ${rows.length} records · integrity verified</div>
      <div style="max-height:52vh;overflow:auto;border:1px solid var(--line2)">
        <table class="data">
          <thead><tr>${h.map((c) => `<th>${esc(c.replace(/_/g, " "))}</th>`).join("")}</tr></thead>
          <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td class="${c === "" ? "blank-cell" : ""}">${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>
      <div style="margin-top:14px">
        <a class="tag sm" style="text-decoration:none" href="/api/download/child" download="CHILD_FINAL.csv">DOWNLOAD CSV</a>
        <button class="tag sm ghost" data-act="modal-close">CLOSE</button>
      </div>`);
  },

  /* ---------------- shared ---------------- */
  hintPanel() {
    return `<div class="card"><span class="k">FIELD NOTES · HINTS</span><div class="hint-list" id="hint-slot-${this.cur}"></div></div>`;
  },

  async renderHints(sb) {
    const slot = sb.querySelector('[id^="hint-slot-"]');
    if (!slot) return;
    const unlocked = this.state.hints || [];
    let html = "";
    for (let n = 1; n <= 5; n++) {
      const on = unlocked.indexOf(n) >= 0;
      let text = "";
      if (on) {
        const r = await J("/api/hint/" + n);
        text = r.hint || "";
      }
      html += `<div class="hint ${on ? "" : "locked"}">
        <span class="k">HINT ${String(n).padStart(2, "0")}</span>
        ${on ? `<p>${esc(text)}</p>` : "<p>████████████████████████████</p><span class='locktag'>LOCKED</span>"}
      </div>`;
    }
    slot.innerHTML = html;
  },

  async refreshHints() {
    this.state = await J("/api/state");
    this.renderNav();
    this.renderTray();
    this.renderHints(document.getElementById("sb") || document.body);
  },

  async refresh() {
    this.state = await J("/api/state");
    this.renderNav();
    this.renderTray();
  },

  async onStageAccepted(field, resp) {
    if (resp.evidence) this.state.evidence = resp.evidence;
    if (resp.unlocked) this.state.unlocked = resp.unlocked;
    if (resp.hints) this.state.hints = resp.hints;
    this.state.progress[field] = resp.ids;
    if (resp.reconstruction) this.state.progress.reconstruction = true;
    this.renderNav();
    this.renderTray();
    this.go(this.cur);
  },

  onStageRejected(field, resp) {
    if (resp.hints) this.state.hints = resp.hints;
    this.renderHints(document.getElementById("sb") || document.body);
    void field;
  },

  localEvidence(item) {
    if (this.local.some((x) => x.id === item.id)) return;
    this.local.push(item);
    try { localStorage.setItem("ctf3.ev", JSON.stringify(this.local)); } catch (e) { /* private mode */ }
    this.renderTray();
    this.renderNav();
  },

  renderTray() {
    const items = (this.state && this.state.evidence ? this.state.evidence : []).concat(this.local);
    const seen = new Set();
    const uniq = items.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
    document.getElementById("tray-count").textContent = uniq.length;
    document.getElementById("tray-items").innerHTML = uniq.length
      ? uniq.map((e) => `<span class="ev-chip" data-id="${esc(e.id)}"><span class="di">◈</span><b>${esc(e.id)}</b><span class="dim">${esc(e.label || "")}</span></span>`).join("")
      : '<span class="tray-empty">NO EVIDENCE FILED YET — OPEN THE EXHIBITS</span>';
    if (window.App) App.renderNav && (document.getElementById("ev-count").textContent = uniq.length);
  },

  tickClock() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    const s = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC`;
    const el = document.getElementById("side-clock");
    if (el) el.textContent = s;
  },

  startTicker() {
    const tk = document.getElementById("tk");
    if (!tk) return;
    const hx = () => Array.from({ length: 24 }, () => "0123456789abcdef"[Math.random() * 16 | 0]).join("");
    const stamps = ["UNVERIFIED", "CORRUPT", "WRITER=? ?", "SEALED?", "LAG>7.5?"];
    setInterval(() => {
      const y = 2024 + Math.floor(Math.random() * 3);
      const m = String(1 + Math.floor(Math.random() * 12)).padStart(2, "0");
      const hh = String(Math.floor(Math.random() * 24)).padStart(2, "0");
      tk.innerHTML += `sha:${hx()}  audit ${y}-${m}-17 ${hh}:??:??  ${stamps[Math.random() * stamps.length | 0]}<br>`;
      while (tk.childNodes.length > 8) tk.removeChild(tk.firstChild);
    }, 620);
  },

  startNoise() {
    const c = document.getElementById("noise");
    if (!c) return;
    const ctx = c.getContext("2d");
    let w, h;
    const resize = () => { w = c.width = Math.floor(innerWidth / 2); h = c.height = Math.floor(innerHeight / 2); };
    resize();
    addEventListener("resize", resize);
    setInterval(() => {
      const img = ctx.createImageData(w, h);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const v = Math.random() * 255 | 0;
        d[i] = d[i + 1] = d[i + 2] = v;
        d[i + 3] = 26;
      }
      ctx.putImageData(img, 0, 0);
    }, 110);
  }
};

function numRoman(key) {
  return ({ case: "I", exhibits: "II", meta: "III", timeline: "IV", correlation: "V", reconstruction: "VI", rec: "VII" })[key] || "";
}

window.sha256hex = sha256hex;
window.App = App;

/* ---- global action delegation (CSP forbids inline event handlers) ---- */
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-act]");
  if (!t) return;
  const parts = t.dataset.act.split("::");
  const act = parts[0], a1 = parts[1], a2 = parts[2];
  switch (act) {
    case "modal-close": closeModal(); break;
    case "insp-compare": Inspector.compare(); break;
    case "insp-trace": Inspector.trace(); break;
    case "insp-open": Inspector.open(a1); break;
    case "insp-filefield": Inspector.fileField(a1); break;
    case "provgraph-jump": closeModal(); ProvGraph.jump(a1); break;
    case "chron-mark": Chronology.mark(a1); break;
    case "open-dataset": App.openDataset(a1); break;
    case "verify-sha": toast("sha256 verified against the custody sheet", "good"); break;
    case "file-evidence": {
      const item = { id: a1, label: a2 || "" };
      if (Inspector.onEvidence) Inspector.onEvidence(item);
      App.localEvidence(item);
      toast("EVIDENCE FILED · " + a1, "good");
      break;
    }
    case "file-pair": {
      const pair = [
        { id: "RECORD-" + a1, label: "parent metadata · " + a1 },
        { id: "CHILD-" + a1, label: "child profile · " + a1 }
      ];
      pair.forEach((it) => {
        if (Inspector.onEvidence) Inspector.onEvidence(it);
        App.localEvidence(it);
      });
      toast("EVIDENCE FILED · RECORD-" + a1 + " + CHILD-" + a1, "good");
      break;
    }
    default: break;
  }
});

/* ---- boot exactly once ---- */
function bootOnce() {
  if (window.__ctf3booted) return;
  window.__ctf3booted = true;
  App.init();
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootOnce);
else bootOnce();
