/* =====================================================================
   THE LAST DATASET // CTF 03 — js/graph.js
   Interactive provenance graph built from the REAL chain:
   Vault Case -> Transfer Manifest -> Medical Tag -> Record -> Child.
   Suspicious nodes (broken rules) glow red. Nodes are clickable.
   ===================================================================== */
"use strict";

const ProvGraph = {
  mount: null,
  current: "S001",

  /* is this record suspicious under any published rule? */
  isSuspect(d) {
    return d.auth < AUTH_FLOOR || d.gapDays > AUDIT_WINDOW || (d.childBlanks >= BLANK_MIN && d.altered);
  },

  async render(mount, id) {
    this.mount = mount;
    if (id) this.current = id;
    const rec = await J("/api/record/" + this.current);
    if (rec.error) { mount.innerHTML = '<p class="note">record not found</p>'; return; }
    const d = rec.derived;
    const sus = this.isSuspect(d);
    this.current = rec.id;

    const W = 760, NODE_W = 300, NODE_H = 54, GAP = 96, X = 40;
    const chain = [
      { k: "VAULT CASE", v: d.vault, n: "custody container" },
      { k: "TRANSFER MANIFEST", v: d.manifest, n: "filed with the move" },
      { k: "MEDICAL TAG", v: d.tag, n: "condition at intake" },
      { k: "PARENT RECORD", v: rec.id, n: rec.parent.Original_Occupation + " · " + d.sectorParent },
      { k: "CHILD PROFILE", v: d.childPresent ? rec.id : "ABSENT", n: d.childPresent ? d.childBlanks + " blank cells · " + d.sectorChild : "no linked profile" }
    ];
    const H = chain.length * GAP + 40;

    /* which nodes carry a defect */
    const flags = [
      false,
      false,
      false,
      d.auth < AUTH_FLOOR || d.gapDays > AUDIT_WINDOW || d.altered,
      (d.childBlanks >= BLANK_MIN && d.altered) || d.sectorMismatch
    ];

    const nodes = chain.map((c, i) => {
      const y = 20 + i * GAP;
      const hot = flags[i];
      return `
        <g class="node ${hot ? "sus" : ""}" data-i="${i}" transform="translate(${X},${y})" style="cursor:pointer">
          <rect width="${NODE_W}" height="${NODE_H}" rx="2"></rect>
          <text class="nk" x="14" y="20">${c.k}</text>
          <text x="14" y="40">${esc(c.v)}${hot ? "   ⚠" : ""}</text>
        </g>
        ${i < chain.length - 1 ? `
          <path class="edge ${hot || flags[i + 1] ? "hot" : ""}"
                d="M${X + NODE_W / 2} ${y + NODE_H} L${X + NODE_W / 2} ${y + GAP}"></path>
          <path class="edge ${hot || flags[i + 1] ? "hot" : ""}"
                d="M${X + NODE_W / 2} ${y + GAP - 8} l-5 -8 m5 8 l5 -8"></path>
          <text class="elabel" x="${X + NODE_W / 2 + 12}" y="${y + GAP / 2 + 4}">${esc(edgeLabel(i, d))}</text>` : ""}`;
    }).join("");

    mount.innerHTML = `
      <div class="graph-wrap">
        <span class="k">PROVENANCE GRAPH · ${rec.id}</span>
        <svg class="prov-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="provenance chain for ${rec.id}">
          ${nodes}
        </svg>
        <div class="prov-legend">
          <span><i></i>node resolves</span>
          <span><i class="s"></i>node carries a defect under a published rule</span>
          <span class="dim">click a node for its analysis sheet</span>
        </div>
        <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <input type="search" id="pg-q" placeholder="record id…" value="${rec.id}"
                 style="background:#0d0c0b;border:1px solid var(--line2);color:var(--tx);padding:7px 11px;font:13px var(--mono);width:150px;outline:0">
          <button class="tag sm" id="pg-go">TRACE</button>
          <button class="tag sm" id="pg-inspect">OPEN INSPECTOR</button>
          <button class="tag sm" id="pg-ev">ADD EVIDENCE</button>
          ${sus ? '<span class="badge no">TRAIL SUSPECT</span>' : '<span class="badge ok">TRAIL COHERENT</span>'}
        </div>
      </div>`;

    const fieldFor = ["Vault_Case_ID", "Transfer_Manifest_ID", "Medical_Tag_ID", "Sanctuary_ID", "blanks"];
    mount.querySelectorAll(".node").forEach((g) => g.addEventListener("click", () => {
      Inspector.current = rec.id;
      Inspector.rec = rec;
      Inspector.fieldSheet(fieldFor[Number(g.dataset.i)]);
    }));

    const q = mount.querySelector("#pg-q");
    const go = async () => {
      const v = (q.value || "").trim().toUpperCase();
      if (!/^S\d{3}$/.test(v)) { toast("format: S001…S120", "err"); return; }
      this.render(mount, v);
    };
    mount.querySelector("#pg-go").addEventListener("click", go);
    q.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    mount.querySelector("#pg-inspect").addEventListener("click", () => Inspector.open(rec.id));
    mount.querySelector("#pg-ev").addEventListener("click", () => {
      Inspector.onEvidence && Inspector.onEvidence({ id: "PROVENANCE-" + rec.id, label: "chain of custody · " + rec.id });
      App.localEvidence({ id: "PROVENANCE-" + rec.id, label: "chain of custody · " + rec.id });
      toast("EVIDENCE FILED · PROVENANCE-" + rec.id, "good");
    });
  },

  /* jump here from anywhere (inspector GRAPH button) */
  async jump(id) {
    if (window.App) await App.go("meta");
    const el = document.getElementById("graph-slot");
    if (el) this.render(el, id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }
};

function edgeLabel(i, d) {
  return ["names the container", "records the move", "stamped at intake", "joins by Sanctuary_ID"][i] || "";
}

window.ProvGraph = ProvGraph;
