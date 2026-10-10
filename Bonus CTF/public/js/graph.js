/* ============================================================================
   graph.js — custom SVG renderers for the facility graph (stage 1) and the
   network map (stages 3 & 4). Fully data-driven: every id, coordinate, label
   and capacity comes from the server view; nothing canonical is hardcoded.
   ========================================================================== */
"use strict";

window.Graph = (function () {
  const NS = "http://www.w3.org/2000/svg";

  function el(name, attrs, parent) {
    const n = document.createElementNS(NS, name);
    if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function txt(str, attrs, parent) {
    const t = el("text", attrs, parent);
    t.textContent = str;
    return t;
  }
  function onActivate(node, fn) {
    node.addEventListener("click", fn);
    node.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(e); }
    });
  }
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

  /* ═══════════════════ STAGE 1 — resource allocation graph ═══════════════ */
  function s1(view, opts) {
    opts = opts || {};
    view = view || {};
    const procs = view.processes || {};
    const reses = view.resources || {};
    const pids = Object.keys(procs);
    const rids = Object.keys(reses);

    const svg = el("svg", {
      viewBox: "0 0 660 440",
      class: "graphsvg",
      role: "img"
    });
    svg.setAttribute("aria-label",
      "Resource allocation graph: " + pids.length + " processes and " + rids.length + " resource types. Select a node for details.");

    const cx = 330, cy = 216, RX = 262, RY = 164, rRX = 128, rRY = 80;
    const pos = {};
    pids.forEach((id, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, pids.length);
      pos[id] = { x: cx + RX * Math.cos(a), y: cy + RY * Math.sin(a), kind: "proc" };
    });
    rids.forEach((id, i) => {
      const a = -Math.PI / 2 + ((i + 0.5) * 2 * Math.PI) / Math.max(1, rids.length);
      pos[id] = { x: cx + rRX * Math.cos(a), y: cy + rRY * Math.sin(a), kind: "res" };
    });

    /* ---- edges (under nodes) ---- */
    const gEdges = el("g", { class: "edges" }, svg);
    /* wait-for edges: process -> resource (always visible, per rules) */
    for (const p in procs) {
      const waiting = procs[p].waitingOn || [];
      for (const r of waiting) {
        if (!pos[p] || !pos[r]) continue;
        el("line", {
          class: "edge wait",
          x1: pos[p].x, y1: pos[p].y, x2: pos[r].x, y2: pos[r].y
        }, gEdges);
      }
    }
    /* hold edges: resource -> holder (only for inspected resources) */
    for (const r in reses) {
      const holders = reses[r].holders;
      if (!holders || !pos[r]) continue;
      for (const p in holders) {
        if (!pos[p]) continue;
        el("line", {
          class: "edge hold",
          x1: pos[r].x, y1: pos[r].y, x2: pos[p].x, y2: pos[p].y
        }, gEdges);
      }
    }

    /* ---- resource nodes ---- */
    for (const r in reses) {
      const d = reses[r];
      const p = pos[r];
      if (!p) continue;
      const known = d.cap != null;
      const g = el("g", {
        class: "node res" + (known ? "" : " unknown") + (opts.selected === r ? " selected" : ""),
        transform: "translate(" + p.x + "," + p.y + ")",
        tabindex: "0", role: "button"
      }, svg);
      g.setAttribute("aria-label",
        "Resource " + r + " " + d.label + ", " +
        (known
          ? "capacity " + d.cap + ", free " + d.free + ", held by " +
            (Object.keys(d.holders || {}).join(", ") || "nobody")
          : "capacities hidden, inspect to reveal") +
        (waitersOf(r, procs).length ? ", waited on by " + waitersOf(r, procs).join(", ") : ""));
      el("circle", { class: "body", r: 30 }, g);
      txt(r, { class: "nid", y: 5 }, g);
      txt(d.label, { class: "nsub", y: 46 }, g);
      if (known) {
        txt("CAP " + d.cap + " \u00B7 FREE " + d.free,
          { class: "nsub", y: 60, fill: "#4dd2ff" }, g);
        const hlist = Object.keys(d.holders || {});
        txt(hlist.length ? "HELD " + hlist.map((h) => h + "\u00D7" + d.holders[h]).join(" ") : "UNHELD",
          { class: "nsub", y: 73, fill: "#7d8a96" }, g);
      } else {
        txt("UNKNOWN", { class: "nsub", y: 60, fill: "#7d8a96" }, g);
      }
      onActivate(g, () => opts.onSelect && opts.onSelect(r, "res"));
    }

    /* ---- process nodes ---- */
    for (const p in procs) {
      const d = procs[p];
      const q = pos[p];
      if (!q) continue;
      const blocked = d.status === "BLOCKED";
      const known = d.holds != null;
      const g = el("g", {
        class: "node proc " + (blocked ? "blocked" : "running") +
          (known ? "" : " unknown") + (opts.selected === p ? " selected" : ""),
        transform: "translate(" + q.x + "," + q.y + ")",
        tabindex: "0", role: "button"
      }, svg);
      g.setAttribute("aria-label",
        "Process " + p + " " + d.label + ", " + d.status.toLowerCase() +
        ", waiting for " + ((d.waitingOn || []).join(", ") || "nothing") +
        (known ? ", holding " + Object.keys(d.holds || {}).join(", ") : ", holdings hidden"));
      el("rect", { class: "body", x: -56, y: -26, width: 112, height: 52, rx: 5 }, g);
      /* status bar */
      el("rect", {
        x: -56, y: -26, width: 5, height: 52,
        fill: blocked ? "#ff4d4d" : "#45d17f", rx: 2
      }, g);
      if (blocked) el("rect", { class: "pulse", x: -60, y: -30, width: 120, height: 60, rx: 7,
        fill: "none", stroke: "#ff4d4d", "stroke-width": 1.4 }, g);
      txt(p, { class: "nid", y: -3 }, g);
      const waitStr = (d.waitingOn || []).length ? " \u00B7 " + d.waitingOn.join(",") : "";
      txt(d.status + waitStr,
        { class: "nsub", y: 13, fill: blocked ? "#ff9d9d" : "#7fe0a8" }, g);
      txt(d.label, { class: "nsub", y: 40, fill: "#7d8a96" }, g);
      if (known) {
        const h = Object.keys(d.holds || {});
        txt(h.length ? "HOLDS " + h.join(", ") : "HOLDS \u2014",
          { class: "nsub", y: 53, fill: "#4dd2ff" }, g);
      }
      onActivate(g, () => opts.onSelect && opts.onSelect(p, "proc"));
    }

    return svg;
  }

  function waitersOf(rid, procs) {
    const out = [];
    for (const p in procs) {
      if ((procs[p].waitingOn || []).indexOf(rid) >= 0) out.push(p);
    }
    return out;
  }

  /* ═══════════════════ STAGE 3/4 — network map ═══════════════════════════ */
  function net(view, opts) {
    opts = opts || {};
    view = view || {};
    const nodes = view.nodes || [];
    const links = view.links || [];
    const byId = {};
    nodes.forEach((n) => (byId[n.id] = n));

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach((n) => {
      minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
    });
    if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 660; maxY = 340; }
    const padX = 62, padY = 64;
    const vb = (minX - padX) + " " + (minY - padY) + " " +
      (maxX - minX + padX * 2) + " " + (maxY - minY + padY * 2);

    const svg = el("svg", { viewBox: vb, class: "netsvg", role: "img" });
    svg.setAttribute("aria-label",
      "Network map with " + links.length + " links from ingress to core. " +
      "Select a link to inspect, probe, or add it to the route.");

    const sel = opts.selected || new Set();
    const gLinks = el("g", { class: "links" }, svg);
    const gNodes = el("g", { class: "nnode-g" }, svg);

    links.forEach((l) => {
      const a = byId[l.a], b = byId[l.b];
      if (!a || !b) return;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const cls = ["link"];
      if (!l.up) cls.push("down");
      else if (l.unverified) cls.push("suspect");
      else if (l.probed) cls.push("probed");
      if (l.degraded) cls.push("degraded");
      if (sel.has(l.id)) cls.push("selected");
      if (opts.pulse && opts.pulse.has(l.id)) cls.push("pulse");

      const g = el("g", { class: cls.join(" "), "data-link": l.id }, gLinks);
      el("line", {
        class: "wire cls" + l.cls,
        x1: a.x, y1: a.y, x2: b.x, y2: b.y
      }, g);

      /* two-line label at midpoint */
      const capStr = l.cap == null ? "CAP ?" : "CAP " + l.cap;
      const l1 = !l.up ? "DOWN" :
        l.unverified ? "UNVERIFIED \u00B7 " + capStr : capStr;
      const l2 = "C" + l.cls + " \u00B7 FUEL " + l.cost + (l.degraded ? " \u00B7 DEGRADED" : "");
      txt(l1, { class: "lmid", x: mx, y: my - 7 }, g);
      txt(l2, { class: "lmid", x: mx, y: my + 13 }, g);

      /* invisible hit target + accessibility */
      const hit = el("line", {
        class: "hitline", x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        tabindex: "0", role: "button"
      }, g);
      hit.setAttribute("aria-label",
        "Link " + l.id + ", class " + l.cls + ", " +
        (l.up ? "up" : "down") + ", " +
        (l.unverified ? "capacity unverified" : capStr.toLowerCase()) +
        ", fuel " + l.cost + (l.probed ? ", probed" : l.degraded ? ", degraded" : "") +
        (sel.has(l.id) ? ", selected for route" : ""));
      onActivate(hit, () => opts.onLink && opts.onLink(l.id));
    });

    nodes.forEach((n) => {
      const role = n.role || "junction";
      const g = el("g", { class: "nnode " + role, transform: "translate(" + n.x + "," + n.y + ")" }, gNodes);
      if (role === "entry") {
        el("rect", { class: "body", x: -17, y: -17, width: 34, height: 34, rx: 4 }, g);
      } else if (role === "core") {
        el("path", { class: "body", d: "M0,-21 L21,0 L0,21 L-21,0 Z" }, g);
      } else if (role === "gate") {
        el("path", {
          class: "body",
          d: "M-14,-16 L14,-16 L21,0 L14,16 L-14,16 L-21,0 Z"
        }, g);
        txt("!", { class: "nid", y: 5, fill: "#ffb638" }, g);
      } else {
        el("circle", { class: "body", r: 16 }, g);
      }
      txt(n.label, { class: "nid", y: 36 }, g);
    });

    return svg;
  }

  /* ---- shared client-side route analysis (uses ONLY published view data) -- */
  function analyzeRoute(view, linkIds) {
    const links = view.links || [];
    const nodes = view.nodes || [];
    const byId = {}, adj = {};
    nodes.forEach((n) => { byId[n.id] = n; adj[n.id] = []; });
    let cost = 0, bottleneck = null, allKnown = true, anyDown = false;
    linkIds.forEach((id) => {
      const l = links.find((x) => x.id === id);
      if (!l) return;
      cost += l.cost || 0;
      if (!l.up) anyDown = true;
      if (l.cap == null) allKnown = false;
      else bottleneck = bottleneck == null ? l.cap : Math.min(bottleneck, l.cap);
      if (adj[l.a] && adj[l.b]) { adj[l.a].push(l.b); adj[l.b].push(l.a); }
    });
    /* connectivity: walk from entry-side endpoint to the other end */
    const deg = {};
    let start = null, ends = 0;
    linkIds.forEach((id) => {
      const l = links.find((x) => x.id === id);
      if (!l) return;
      deg[l.a] = (deg[l.a] || 0) + 1;
      deg[l.b] = (deg[l.b] || 0) + 1;
    });
    Object.keys(deg).forEach((k) => { if (deg[k] === 1) { ends++; if (!start) start = k; } });
    let connected = linkIds.length > 0 && ends === 2;
    if (connected) {
      const seen = new Set([start]);
      const stack = [start];
      while (stack.length) {
        const cur = stack.pop();
        for (const nb of adj[cur] || []) if (!seen.has(nb)) { seen.add(nb); stack.push(nb); }
      }
      connected = Object.keys(deg).every((k) => seen.has(k));
    }
    const traversesRoles = new Set();
    linkIds.forEach((id) => {
      const l = links.find((x) => x.id === id);
      if (!l) return;
      [l.a, l.b].forEach((nid) => {
        if (byId[nid] && byId[nid].role) traversesRoles.add(byId[nid].role);
      });
    });
    return {
      cost,
      bottleneck,
      allKnown,
      anyDown,
      connected,
      hasEntry: traversesRoles.has("entry"),
      hasCore: traversesRoles.has("core"),
      hasGate: traversesRoles.has("gate"),
      count: linkIds.length
    };
  }

  return { s1, net, analyzeRoute };
})();
