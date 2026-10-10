/* ============================================================================
   ui.js — view rendering for THE DEADLOCK ENGINE.
   Pure presentation: builds DOM from the server-provided state view plus the
   client's transient selection. All actions are delegated to the bus (app.js).
   ========================================================================== */
"use strict";

window.UI = (function () {
  let bus = null;
  const $ = (id) => document.getElementById(id);

  const STAGE_NAMES = ["RESOURCE GRAPH", "SCHEDULER SAFETY", "MOVING NETWORK", "BLACKOUT PLAN"];

  /* ------------------------------------------------------------- helpers -- */
  function h(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function btn(label, cls, onclick, disabled, title) {
    const b = h("button", "btn " + (cls || ""), label);
    b.type = "button";
    b.disabled = !!disabled;
    if (title) b.title = title;
    b.addEventListener("click", onclick);
    return b;
  }
  function mkSelect(id, options, value, onchange) {
    const s = document.createElement("select");
    s.className = "field";
    s.id = id;
    options.forEach((o) => {
      const opt = document.createElement("option");
      opt.value = o.v;
      opt.textContent = o.t;
      s.appendChild(opt);
    });
    s.value = value;
    s.addEventListener("change", () => onchange(s.value));
    return s;
  }
  function label(text) {
    const l = h("span", "small dim");
    l.textContent = text;
    return l;
  }
  function budgetLeft(state, id) {
    const b = (state.budgets || []).find((x) => x.id === id);
    return b ? b.max - b.used : null;
  }
  function vec(values, types) {
    return values.map((v, i) => {
      const c = h("span", "vecchip");
      c.appendChild(h("span", "dim", (types && types[i]) || ("#" + (i + 1)) + " "));
      c.appendChild(h("b", null, String(v)));
      return c;
    });
  }
  function codeChip(code) {
    return h("span", "chip info", code || "OK");
  }

  /* ============================================================ panels ==== */
  function renderTrack(state) {
    const ol = $("stageTrack");
    ol.innerHTML = "";
    STAGE_NAMES.forEach((name, i) => {
      const n = i + 1;
      const li = document.createElement("li");
      li.setAttribute("data-state",
        state.solved || state.stage > n ? "done" :
        state.stage === n ? "active" : "locked");
      li.appendChild(h("span", "num", String(n)));
      li.appendChild(h("span", "stname", name));
      if (state.solved || state.stage > n) li.appendChild(h("span", "num", "\u2713"));
      ol.appendChild(li);
    });
    const chip = $("stageChip");
    chip.textContent = "STAGE " + state.stage + " / 4" + (state.solved ? " \u00B7 RESTORED" : "");
  }

  function renderBudgets(state) {
    const host = $("budgetList");
    host.innerHTML = "";
    (state.budgets || []).forEach((b) => {
      const left = b.max - b.used;
      const frac = b.max ? (left / b.max) * 100 : 0;
      const wrap = h("div", "budget" + (left === 0 ? " empty" : frac <= 25 ? " low" : ""));
      const row = h("div", "brow");
      row.appendChild(h("span", "blabel", b.label));
      row.appendChild(h("span", "bval", left + " / " + b.max + " LEFT"));
      wrap.appendChild(row);
      const track = h("div", "btrack");
      const fill = h("div", "bfill");
      fill.style.width = Math.max(0, Math.min(100, frac)) + "%";
      track.appendChild(fill);
      wrap.appendChild(track);
      host.appendChild(wrap);
    });
  }

  function renderDiscovered(state) {
    const ul = $("discovered");
    ul.innerHTML = "";
    const add = (main, val) => {
      const li = document.createElement("li");
      li.appendChild(document.createTextNode(main));
      if (val) { li.appendChild(document.createTextNode(" ")); li.appendChild(h("span", "val", val)); }
      ul.appendChild(li);
    };
    let any = false;
    if (state.stage === 1 && state.resources) {
      for (const r in state.resources) {
        const d = state.resources[r];
        if (d.cap != null) { any = true; add(r + " \u00B7 " + d.label, "cap " + d.cap + " \u00B7 free " + d.free); }
      }
      for (const p in state.processes || {}) {
        const d = state.processes[p];
        if (d.holds) {
          any = true;
          add(p + " \u00B7 " + d.status,
            "holds " + (Object.keys(d.holds).join(", ") || "\u2014") +
            " \u00B7 max " + JSON.stringify(d.max || {}));
        }
      }
    } else if (state.stage === 2 && state.sched) {
      state.sched.procs.forEach((p) => {
        if (p.verified) { any = true; add(p.id + " \u00B7 " + p.label, "max [" + p.max.join(",") + "]"); }
      });
      if (state.sched.evicted) { any = true; add("CUSTODIAL RIG", "EVICTED \u00B7 hold returned"); }
    } else if (state.stage === 3 && state.net) {
      state.net.links.forEach((l) => {
        if (l.probed) { any = true; add(l.id, "measured cap " + l.cap + " \u00B7 fuel " + l.cost); }
      });
      if (state.net.activated) { any = true; add("ROUTE", "ACTIVATED \u00B7 " + (state.net.route || []).length + " links"); }
    } else if (state.stage === 4) {
      if (state.stage1Outcome) {
        any = true;
        add("S1 RECOVERY", (state.stage1Outcome.op || "").toUpperCase() + " " + (state.stage1Outcome.target || ""));
      }
      if (state.sched) { any = true; add("CUSTODIAL RIG", state.sched.evicted ? "EVICTED" : "RESIDENT \u2014 evictable"); }
      if (state.net) {
        const deg = state.net.degraded || {};
        const n = Object.keys(deg).length;
        any = true;
        add("S3 ROUTE", n + " LINK" + (n === 1 ? "" : "S") + " DEGRADED");
        if (state.net.probesUsed) add("S4 PROBES", state.net.probesUsed + " / " + state.net.probeBudget);
      }
    }
    if (!any) {
      const li = h("li", "dim", state.stage === 1 ? "Nothing inspected yet." : "No findings recorded yet.");
      ul.appendChild(li);
    }
  }

  function renderTranscript(state) {
    const ol = $("transcript");
    ol.innerHTML = "";
    const acts = (state.actions || []).slice().reverse();
    if (!acts.length) { ol.appendChild(h("li", "dim", "No actions recorded.")); return; }
    acts.forEach((a) => {
      const li = h("li", a.ok ? "ok" : "err");
      const t = h("span", "ttime", new Date(a.t).toLocaleTimeString());
      li.appendChild(t);
      li.appendChild(document.createTextNode(a.type + " \u2192 " + a.code));
      ol.appendChild(li);
    });
  }

  function renderRules(briefing) {
    const ul = $("rulesList");
    ul.innerHTML = "";
    if (!briefing) { ul.appendChild(h("li", "dim", "Orders arrive with the briefing.")); return; }
    (briefing.rules || []).forEach((r) => {
      const li = document.createElement("li");
      li.textContent = r;
      ul.appendChild(li);
    });
  }

  function renderHints(state, sel) {
    const host = $("hintHost");
    host.innerHTML = "";
    [1, 2, 3].forEach((lvl) => {
      const b = h("button", "hintbtn");
      b.type = "button";
      b.appendChild(h("span", "lvl", "L" + lvl));
      const open = lvl === 1;
      b.appendChild(document.createTextNode(
        lvl === 1 ? "GENERAL ORIENTATION" :
        lvl === 2 ? "TARGETED NUDGE \u2014 needs 1 failed attempt" :
                   "DIRECT GUIDANCE \u2014 needs 3 failed attempts"));
      if (!open) b.appendChild(h("span", "lock", "\u25C6"));
      b.addEventListener("click", () => bus.hint(lvl));
      host.appendChild(b);
    });
    const out = $("hintOut");
    out.innerHTML = "";
    if (sel.hintData) {
      out.hidden = false;
      out.appendChild(h("div", null, sel.hintData.text));
      out.appendChild(h("div", "hnote", "ADVISORY L" + sel.hintData.level + " \u00B7 STAGE " + sel.hintData.stage + " \u00B7 progression-gated"));
    } else {
      out.hidden = true;
    }
  }

  /* ======================================================= engine head ==== */
  function renderHead(state) {
    $("stageKicker").textContent = "STAGE " + state.stage + " \u00B7 " + STAGE_NAMES[state.stage - 1];
    $("stageTitleEl").textContent = state.stageTitle || "\u2014";
    $("objectiveEl").textContent = state.objective || "";
  }

  /* ====================================================== stage 1 view ==== */
  function legendRow(sample, text) {
    const row = h("div", "legendrow");
    row.appendChild(sample);
    row.appendChild(h("span", "dim", text));
    return row;
  }
  function swatch(color, dashed) {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 40 8");
    s.setAttribute("width", "40");
    s.setAttribute("height", "8");
    s.style.verticalAlign = "middle";
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", "1"); line.setAttribute("y1", "4");
    line.setAttribute("x2", "39"); line.setAttribute("y2", "4");
    line.setAttribute("stroke", color);
    line.setAttribute("stroke-width", "3");
    if (dashed) line.setAttribute("stroke-dasharray", "5 4");
    s.appendChild(line);
    return s;
  }

  function viewS1(state, sel) {
    const host = $("viewHost");
    host.innerHTML = "";
    host.appendChild(Graph.s1({ processes: state.processes, resources: state.resources }, {
      selected: sel.node,
      onSelect: (id, kind) => bus.patch({ node: id, nodeKind: kind })
    }));
    const legend = h("div", "linklist");
    legend.style.maxHeight = "none";
    [
      [swatch("#ffb638", true), "WAIT-FOR edge (process \u2192 claimed resource)"],
      [swatch("#4dd2ff", false), "HOLD edge (revealed after INSPECT)"],
      [swatch("#ff4d4d", false), "red bar / pulse \u2014 BLOCKED process"],
      [swatch("#45d17f", false), "green bar \u2014 RUNNING process"],
      [swatch("#7d8a96", true), "dashed outline \u2014 hidden data, inspect to reveal"]
    ].forEach(([sw, t]) => legend.appendChild(legendRow(sw, t)));
    host.appendChild(legend);
  }

  function inspectorS1(state, sel) {
    const box = $("inspector");
    box.innerHTML = "";
    if (!sel.node) { box.hidden = true; return; }
    const isProc = !!(state.processes && state.processes[sel.node]);
    const d = isProc ? state.processes[sel.node] : (state.resources || {})[sel.node];
    if (!d) { box.hidden = true; return; }
    box.hidden = false;
    const close = btn("\u2715", "closebtn", () => bus.patch({ node: null }));
    box.appendChild(close);
    box.appendChild(h("h4", null, sel.node + " \u00B7 " + (d.label || "")));
    const kv = (k, v) => {
      const p = h("p", "kv");
      p.appendChild(h("span", "dim", k + ": "));
      p.appendChild(h("b", null, v));
      box.appendChild(p);
    };
    if (isProc) {
      kv("STATUS", d.status);
      kv("WAITING ON", (d.waitingOn || []).join(", ") || "\u2014");
      kv("HOLDS", d.holds ? Object.keys(d.holds).map((r) => r + "\u00D7" + d.holds[r]).join(", ") : "\u2014 (hidden)");
      kv("MAX CLAIM", d.max ? JSON.stringify(d.max).replace(/"/g, "").replace(/[{}]/g, "") : "\u2014 (hidden)");
    } else {
      kv("CAPACITY", d.cap != null ? String(d.cap) : "\u2014 (hidden)");
      kv("FREE", d.free != null ? String(d.free) : "\u2014 (hidden)");
      kv("HELD BY", d.holders ? (Object.keys(d.holders).map((r) => r + "\u00D7" + d.holders[r]).join(", ") || "nobody") : "\u2014 (hidden)");
    }
    const hidden = isProc ? d.holds == null : d.cap == null;
    const row = h("div", "row");
    const left = budgetLeft(state, "s1.inspect");
    row.appendChild(btn("INSPECT " + sel.node, "btn-primary", () => bus.post("/api/s1/inspect", { target: sel.node }),
      hidden ? false : left <= 0,
      hidden ? "reveal hidden properties (1 inspection)" : "already revealed"));
    box.appendChild(row);
  }

  function actionS1(state, sel) {
    const bar = $("actionbar");
    bar.innerHTML = "";
    const procs = Object.keys(state.processes || {});
    const reses = Object.keys(state.resources || {});
    const mkGroup = (title, opKey, targetKey, path) => {
      const wrap = h("div", "row");
      wrap.appendChild(label(title));
      const opIsProc = sel[opKey] !== "inject";
      const targets = opIsProc ? procs : reses;
      const tval = targets.indexOf(sel[targetKey]) >= 0 ? sel[targetKey] : targets[0];
      wrap.appendChild(mkSelect("x" + opKey, [
        { v: "preempt", t: "PREEMPT" },
        { v: "inject", t: "INJECT" }
      ], sel[opKey], (v) => bus.patch({
        [opKey]: v,
        [targetKey]: (v === "preempt" ? procs : reses)[0]
      })));
      wrap.appendChild(mkSelect("y" + targetKey, targets.map((t) => ({ v: t, t })), tval,
        (v) => bus.patch({ [targetKey]: v })));
      const isRecover = path.indexOf("recover") >= 0;
      const bud = budgetLeft(state, isRecover ? "s1.recover" : "s1.trial");
      wrap.appendChild(btn(
        isRecover ? "ATTEMPT RECOVERY" : "RUN TRIAL",
        isRecover ? "btn-primary" : "",
        () => bus.post(path, { op: sel[opKey], target: tval }),
        bud <= 0,
        bud <= 0 ? "budget exhausted" : "spends 1 of " + bud + " left"));
      return wrap;
    };
    bar.appendChild(mkGroup("TRIAL:", "trialOp", "trialTarget", "/api/s1/trial"));
    bar.appendChild(mkGroup("RECOVERY:", "recOp", "recTarget", "/api/s1/recover"));
  }

  /* ====================================================== stage 2 view ==== */
  function schedTable(state, withFloor) {
    const s2 = state.sched;
    const wrap = h("div", "tablewrap");
    const t = h("table", "sched");
    const thead = document.createElement("thead");
    const trh = document.createElement("tr");
    ["PROCESS", "ALLOC", "MAX", "NEED", "STATUS", ""].forEach((x) => {
      const th = document.createElement("th");
      th.textContent = x;
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    t.appendChild(thead);
    const tb = document.createElement("tbody");
    s2.procs.forEach((p) => {
      const tr = document.createElement("tr");
      if (p.custodial) tr.className = "custodial";
      if (p.evicted) tr.className = "evicted";
      const td = (content) => {
        const c = document.createElement("td");
        if (content instanceof Node) c.appendChild(content); else c.textContent = content;
        tr.appendChild(c);
        return c;
      };
      td(p.id);
      td("[" + p.alloc.join(", ") + "]");
      td(p.max ? "[" + p.max.join(", ") + "]" : "\u2014");
      td(p.need ? "[" + p.need.join(", ") + "]" : "\u2014");
      const st = h("span");
      st.appendChild(codeChip(p.verified ? "VERIFIED" : "UNVERIFIED"));
      if (p.custodial) st.appendChild(h("span", "chip warn", "CUSTODIAL"));
      if (p.evicted) st.appendChild(h("span", "chip bad", "EVICTED"));
      td(st);
      const act = document.createElement("td");
      if (!p.verified) {
        const left = budgetLeft(state, "s2.inspect");
        act.appendChild(btn("INSPECT", "", () => bus.post("/api/s2/inspect", { target: p.id }), left <= 0));
      }
      tr.appendChild(act);
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    wrap.appendChild(t);
    return wrap;
  }

  function viewS2(state, sel) {
    const host = $("viewHost");
    host.innerHTML = "";
    const s2 = state.sched;

    const av = h("div", "vectorrow");
    av.appendChild(label("AVAILABLE POOL"));
    vec(s2.avail, s2.types).forEach((c) => av.appendChild(c));
    av.appendChild(h("span", "chip info", "COLUMNS: " + s2.types.join(" \u00B7 ")));
    host.appendChild(av);

    host.appendChild(schedTable(state, false));

    if (s2.cached) {
      const c = h("div", "routemeter");
      c.appendChild(h("span", "warn", "CACHED TELEMETRY (stale, never authoritative):"));
      for (const k in s2.cached) {
        c.appendChild(h("span", "warn", k + " MAX [" + s2.cached[k].join(", ") + "]"));
      }
      host.appendChild(c);
    }

    /* ---- run-order builder ---- */
    host.appendChild(h("h3", "paneltitle", "RUN ORDER \u2014 every resident exactly once"));
    const pick = h("div", "seqpick");
    const residents = s2.procs.filter((p) => !p.evicted);
    residents.forEach((p) => {
      const used = sel.seq.indexOf(p.id) >= 0;
      const c = btn(p.id + (p.custodial ? " \u00B7CUST" : ""), "pickchip" + (used ? " used" : ""),
        () => bus.patch({ seq: sel.seq.concat([p.id]) }), used);
      pick.appendChild(c);
    });
    host.appendChild(pick);

    const order = h("div", "seqorder");
    sel.seq.forEach((pid, i) => {
      const s = h("span", "step", pid);
      s.title = "click to remove";
      s.style.cursor = "pointer";
      s.tabIndex = 0;
      s.addEventListener("click", () => bus.patch({ seq: sel.seq.filter((_, j) => j !== i) }));
      s.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); s.click(); }
      });
      order.appendChild(s);
    });
    host.appendChild(order);
    if (sel.seq.length && sel.seq.length < residents.length) {
      host.appendChild(h("p", "small dim", sel.seq.length + " of " + residents.length + " residents ordered \u2014 the safety check needs the full set."));
    }
  }

  function actionS2(state, sel) {
    const bar = $("actionbar");
    bar.innerHTML = "";
    const s2 = state.sched;
    const residents = s2.procs.filter((p) => !p.evicted);
    const complete = sel.seq.length === residents.length &&
      residents.every((p) => sel.seq.indexOf(p.id) >= 0);

    if (!s2.evicted) {
      const left = budgetLeft(state, "s2.evict");
      if (!sel.confirmEvict) {
        bar.appendChild(btn("EVICT CUSTODIAL RIG", "btn-danger",
          () => bus.patch({ confirmEvict: true }), left <= 0,
          "returns its hold to the pool, removes it from the resident set"));
      } else {
        bar.appendChild(btn("CONFIRM EVICTION?", "btn-danger",
          () => bus.post("/api/s2/evict", {})));
        bar.appendChild(btn("CANCEL", "", () => bus.patch({ confirmEvict: false })));
      }
    }
    bar.appendChild(btn("TEST SEQUENCE", "btn-primary",
      () => bus.post("/api/s2/test", { seq: sel.seq.slice() }),
      !complete,
      complete ? "submit this order to the safety check" : "order must cover every resident"));
    if (sel.seq.length) bar.appendChild(btn("CLEAR ORDER", "", () => bus.patch({ seq: [] })));
  }

  /* ====================================================== stage 3 view ==== */
  function routeMeter(state, sel, net) {
    const ids = Array.from(sel.links);
    const a = Graph.analyzeRoute(net, ids);
    const wrap = h("div", "routemeter");
    const seg = (text, cls) => wrap.appendChild(h("span", cls, text));
    seg("FUEL " + a.cost + " / " + net.budget, a.cost <= net.budget ? "ok" : "bad");
    if (a.count === 0) seg("SELECT LINKS TO FORM THE ROUTE", "warn");
    else if (!a.allKnown) seg("BOTTLENECK ? (unverified link in route)", "warn");
    else seg("BOTTLENECK " + a.bottleneck + " \u2265 FLOOR " + net.floor,
      a.bottleneck != null && a.bottleneck >= net.floor ? "ok" : "bad");
    seg(a.hasGate ? "SEC-GATE \u2713" : "SEC-GATE \u2717", a.hasGate ? "ok" : "bad");
    seg(a.connected && a.hasEntry && a.hasCore ? "CHAIN \u2713" : "CHAIN \u2717 (INGRESS\u2192CORE)",
      a.connected && a.hasEntry && a.hasCore ? "ok" : "bad");
    if (ids.length) seg(ids.length + " LINK" + (ids.length === 1 ? "" : "S") + " SELECTED", "");
    return wrap;
  }

  function linkList(net, sel) {
    const list = h("div", "linklist");
    net.links.forEach((l) => {
      const on = sel.links.has(l.id);
      const row = h("div", "linkrow" + (on ? " selected" : ""));
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      const left = h("span", null, l.id);
      const right = h("span", "lstate",
        !l.up ? "DOWN" :
        l.unverified ? "SUSPECT \u00B7 cap ?" :
        (l.probed ? "PROBED cap " : "cap ") + l.cap +
        (l.degraded ? " \u00B7 DEG" : "") + " \u00B7 fuel " + l.cost);
      row.appendChild(left);
      row.appendChild(right);
      const act = () => bus.patchLink(l.id);
      row.addEventListener("click", act);
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(); }
      });
      list.appendChild(row);
    });
    return list;
  }

  function linkLegend() {
    const legend = h("div", "linklist");
    legend.style.maxHeight = "none";
    [
      [swatch("#4dd2ff", false), "TRUNK (class 4) \u00B7 gray BRANCH/SPUR lines"],
      [swatch("#ffb638", true), "SUSPECT \u2014 unverified until probed"],
      [swatch("#ff4d4d", true), "DOWN \u2014 cannot carry the route"],
      [swatch("#45d17f", false), "PROBED / SELECTED for the route"],
      [swatch("#8f9aa5", false), "amber non-dashed = DEGRADED (stage 4)"]
    ].forEach(([sw, t]) => legend.appendChild(legendRow(sw, t)));
    return legend;
  }

  function viewS3(state, sel) {
    const host = $("viewHost");
    host.innerHTML = "";
    const net = state.net;
    host.appendChild(Graph.net(net, {
      selected: sel.links,
      pulse: sel.pulse,
      onLink: (id) => bus.patchLink(id)
    }));
    if (net.activated) {
      const ok = h("div", "routemeter");
      ok.appendChild(h("span", "ok", "ROUTE ACTIVATED \u2014 " + (net.route || []).length + " links verified against the model."));
      host.appendChild(ok);
    }
    host.appendChild(routeMeter(state, sel, net));
    host.appendChild(h("h3", "paneltitle", "LINK MANIFEST \u2014 click a row or a wire to select / inspect"));
    host.appendChild(linkList(net, sel));
    host.appendChild(linkLegend());
  }

  function actionS3(state, sel) {
    const bar = $("actionbar");
    bar.innerHTML = "";
    const net = state.net;
    const ids = Array.from(sel.links);
    if (sel.linkFocus) {
      const left = budgetLeft(state, "s3.probe");
      bar.appendChild(btn("PROBE " + sel.linkFocus, "btn-primary",
        () => bus.post("/api/s3/probe", { link: sel.linkFocus }),
        left <= 0 || (net.links.find((l) => l.id === sel.linkFocus) || {}).probed,
        "reveals true capacity, +1 fuel on that link"));
    }
    bar.appendChild(btn("SUBMIT ROUTE (" + ids.length + ")", "btn-green",
      () => bus.post("/api/s3/route", { links: ids }),
      ids.length === 0,
      "validate this selection against the authoritative model"));
    if (ids.length) bar.appendChild(btn("CLEAR SELECTION", "",
      () => bus.patch({ links: new Set() })));
  }

  function inspectorNet(state, sel) {
    const box = $("inspector");
    box.innerHTML = "";
    if (!sel.linkFocus || !state.net) { box.hidden = true; return; }
    const l = (state.net.links || []).find((x) => x.id === sel.linkFocus);
    if (!l) { box.hidden = true; return; }
    box.hidden = false;
    box.appendChild(btn("\u2715", "closebtn", () => bus.patch({ linkFocus: null })));
    box.appendChild(h("h4", null, "LINK \u00B7 " + l.id));
    const kv = (k, v) => {
      const p = h("p", "kv");
      p.appendChild(h("span", "dim", k + ": "));
      p.appendChild(h("b", null, v));
      box.appendChild(p);
    };
    kv("CLASS", l.cls + " \u00B7 class capacity " + l.classCap);
    kv("STATE", !l.up ? "DOWN" : l.unverified ? "SUSPECT (unverified)" : "UP" + (l.degraded ? " \u00B7 DEGRADED" : ""));
    kv("MEASURED CAP", l.cap == null ? "\u2014 (probe to reveal)" : String(l.cap));
    kv("FUEL COST", String(l.cost) + (l.probed ? " (includes probe surcharge)" : ""));
    const row = h("div", "row");
    if (l.suspect && !l.probed) {
      const left = budgetLeft(state, "s3.probe");
      row.appendChild(btn("PROBE LINK", "btn-primary",
        () => bus.post("/api/s3/probe", { link: l.id }), left <= 0));
    }
    row.appendChild(btn(sel.links.has(l.id) ? "REMOVE FROM ROUTE" : "ADD TO ROUTE", "",
      () => bus.patchLink(l.id)));
    box.appendChild(row);
  }

  /* ====================================================== stage 4 view ==== */
  function opSummary(op, net) {
    switch (op.op) {
      case "preempt": return "PREEMPT " + op.proc;
      case "inject": return "INJECT " + op.res;
      case "grant": return "GRANT " + op.res + " \u2192 " + op.proc;
      case "evict": return "EVICT CUSTODIAL RIG";
      case "run": return "RUN " + (op.seq || []).join(" \u2192 ");
      case "route": {
        let cost = 0;
        (op.links || []).forEach((id) => {
          const l = (net.links || []).find((x) => x.id === id);
          if (l) cost += l.cost;
        });
        return "RESTORE ROUTE \u00B7 " + (op.links || []).length + " LINKS \u00B7 FUEL " + cost;
      }
      case "seal": return "SEAL & TRANSMIT";
      default: return String(op.op).toUpperCase();
    }
  }

  function planBuilder(state, sel) {
    const wrap = h("div");
    wrap.appendChild(h("h3", "paneltitle", "PLAN BUILDER \u2014 operations execute top to bottom"));
    const list = h("div", "planlist");
    sel.plan.forEach((op, i) => {
      const row = h("div", "planrow");
      row.appendChild(h("span", "pidx", String(i + 1) + "."));
      row.appendChild(h("span", "pop", op.op.toUpperCase()));
      row.appendChild(h("span", "psum", opSummary(op, state.net)));
      const ctl = h("span", "pctl");
      const mini = (t, fn, dis) => {
        const b = h("button", "mini", t);
        b.type = "button";
        b.disabled = !!dis;
        b.title = t;
        b.addEventListener("click", fn);
        return b;
      };
      ctl.appendChild(mini("\u2191", () => {
        if (i === 0) return;
        const p = sel.plan.slice();
        const tmp = p[i - 1]; p[i - 1] = p[i]; p[i] = tmp;
        bus.patch({ plan: p });
      }));
      ctl.appendChild(mini("\u2193", () => {
        if (i >= sel.plan.length - 1) return;
        const p = sel.plan.slice();
        const tmp = p[i + 1]; p[i + 1] = p[i]; p[i] = tmp;
        bus.patch({ plan: p });
      }));
      ctl.appendChild(mini("\u2715", () => bus.patch({ plan: sel.plan.filter((_, j) => j !== i) })));
      row.appendChild(ctl);
      list.appendChild(row);
    });
    wrap.appendChild(list);

    /* ---- add-op form ---- */
    const add = h("div", "addop");
    add.appendChild(h("h3", "paneltitle", "ADD OPERATION"));
    const fields = h("div", "fields");
    const block = state.block;
    const procs = (block.procs || []).filter((p) => !p.dead).map((p) => p.id);
    const reses = Object.keys(block.caps || {});
    const residents = (state.sched.procs || []).filter((p) => !p.evicted);

    const types = [
      { v: "PREEMPT", t: "PREEMPT" }, { v: "INJECT", t: "INJECT" },
      { v: "GRANT", t: "GRANT" }
    ];
    if (!state.sched.evicted) types.push({ v: "EVICT", t: "EVICT" });
    types.push({ v: "RUN", t: "RUN" }, { v: "ROUTE", t: "ROUTE" }, { v: "SEAL", t: "SEAL" });

    fields.appendChild(mkSelect("addType", types, sel.addType, (v) => bus.patch({ addType: v })));

    if (sel.addType === "PREEMPT" || sel.addType === "GRANT") {
      fields.appendChild(mkSelect("addProc", procs.map((p) => ({ v: p, t: p })),
        procs.indexOf(sel.addProc) >= 0 ? sel.addProc : procs[0],
        (v) => bus.patch({ addProc: v })));
    }
    if (sel.addType === "INJECT" || sel.addType === "GRANT") {
      fields.appendChild(mkSelect("addRes", reses.map((r) => ({ v: r, t: r })),
        reses.indexOf(sel.addRes) >= 0 ? sel.addRes : reses[0],
        (v) => bus.patch({ addRes: v })));
    }
    add.appendChild(fields);

    if (sel.addType === "RUN") {
      add.appendChild(h("p", "small dim", "Select the run order (all residents, exactly once):"));
      const pick = h("div", "seqpick");
      residents.forEach((p) => {
        const used = sel.seq.indexOf(p.id) >= 0;
        pick.appendChild(btn(p.id, "pickchip" + (used ? " used" : ""),
          () => bus.patch({ seq: sel.seq.concat([p.id]) }), used));
      });
      add.appendChild(pick);
      const order = h("div", "seqorder");
      sel.seq.forEach((pid, i) => {
        const s = h("span", "step", pid);
        s.style.cursor = "pointer";
        s.tabIndex = 0;
        s.addEventListener("click", () => bus.patch({ seq: sel.seq.filter((_, j) => j !== i) }));
        order.appendChild(s);
      });
      add.appendChild(order);
    }

    if (sel.addType === "ROUTE") {
      add.appendChild(h("p", "small dim",
        "Select links in the network map or manifest above \u2014 the route meter shows fuel, floor, gate, and chain status live \u2014 then add the operation."));
      add.appendChild(routeMeter(state, sel, state.net));
    }

    const row = h("div", "row");
    const buildOp = () => {
      switch (sel.addType) {
        case "PREEMPT": return { op: "preempt", proc: sel.addProc };
        case "INJECT": return { op: "inject", res: sel.addRes };
        case "GRANT": return { op: "grant", res: sel.addRes, proc: sel.addProc };
        case "EVICT": return { op: "evict" };
        case "RUN": return { op: "run", seq: sel.seq.slice() };
        case "ROUTE": return { op: "route", links: Array.from(sel.links) };
        case "SEAL": return { op: "seal" };
        default: return null;
      }
    };
    row.appendChild(btn("ADD TO PLAN", "btn-primary", () => {
      const op = buildOp();
      if (!op) return;
      const patch = { plan: sel.plan.concat([op]) };
      if (sel.addType === "RUN") patch.seq = [];
      if (sel.addType === "ROUTE") patch.links = new Set();
      bus.patch(patch);
    }, sel.addType === "RUN" ? sel.seq.length !== residents.length :
        sel.addType === "ROUTE" ? sel.links.size === 0 : false));
    add.appendChild(row);
    if (sel.addType === "RUN" && sel.seq.length !== residents.length) {
      add.appendChild(h("p", "small dim", "The RUN operation needs all " + residents.length + " residents in order."));
    }
    wrap.appendChild(add);
    return wrap;
  }

  function viewS4(state, sel) {
    const host = $("viewHost");
    host.innerHTML = "";

    /* provenance banner */
    const prov = h("div", "routemeter");
    if (state.stage1Outcome) {
      prov.appendChild(h("span", "ok",
        "S1 \u2014 " + state.stage1Outcome.op.toUpperCase() + " " + state.stage1Outcome.target));
    } else {
      prov.appendChild(h("span", "warn", "S1 \u2014 no recorded outcome"));
    }
    prov.appendChild(h("span", state.sched.evicted ? "ok" : "warn",
      "S2 \u2014 CUSTODIAL " + (state.sched.evicted ? "EVICTED" : "RESIDENT")));
    const deg = Object.keys(state.net.degraded || {}).length;
    prov.appendChild(h("span", "warn", "S3 \u2014 " + deg + " LINK" + (deg === 1 ? "" : "S") + " DEGRADED"));
    prov.appendChild(h("span", "ok", "RESERVE FLOOR [" + state.sched.floor.join(", ") + "] \u00B7 FUEL " + state.net.budget));
    host.appendChild(prov);

    /* dependency block */
    host.appendChild(h("h3", "paneltitle", "DEPENDENCY BLOCK \u2014 BOOT INTERLOCK"));
    const bw = h("div", "tablewrap");
    const bt = h("table", "sched");
    bt.innerHTML = "<thead><tr><th>RESOURCE</th><th>CAP</th><th>HELD</th><th>FREE</th></tr></thead>";
    const bb = document.createElement("tbody");
    Object.keys(state.block.caps).forEach((r) => {
      const d = state.block.caps[r];
      const tr = document.createElement("tr");
      [r, d.cap, d.held, d.free].forEach((v) => {
        const td = document.createElement("td");
        td.textContent = String(v);
        tr.appendChild(td);
      });
      bb.appendChild(tr);
    });
    bt.appendChild(bb);
    bw.appendChild(bt);
    host.appendChild(bw);

    const bl = h("div", "tablewrap");
    const blt = h("table", "sched");
    blt.innerHTML = "<thead><tr><th>PROCESS</th><th>HOLDS</th><th>MAX</th><th>NEED</th><th>STATE</th></tr></thead>";
    const blb = document.createElement("tbody");
    state.block.procs.forEach((p) => {
      const tr = document.createElement("tr");
      const kv = (v) => { const td = document.createElement("td"); td.textContent = v; tr.appendChild(td); };
      kv(p.id);
      kv(JSON.stringify(p.holds).replace(/"/g, ""));
      kv(JSON.stringify(p.max).replace(/"/g, ""));
      kv(JSON.stringify(p.need).replace(/"/g, ""));
      const st = document.createElement("td");
      st.appendChild(h("span", "chip " + (p.dead ? "ok" : "bad"), p.dead ? "CLEARED" : "CROSS-HELD"));
      tr.appendChild(st);
      blb.appendChild(tr);
    });
    blt.appendChild(blb);
    bl.appendChild(blt);
    host.appendChild(bl);
    host.appendChild(h("p", "small dim",
      "EMERGENCY RESERVE: " + state.emergency + " spare instance per plan" +
      (state.stage1Outcome && state.stage1Outcome.op === "inject" ? " \u00B7 a stage-1 spare is already in the bay" : "") + "."));

    /* scheduler */
    host.appendChild(h("h3", "paneltitle", "SCHEDULER \u2014 floor-safe order required"));
    const av = h("div", "vectorrow");
    av.appendChild(label("AVAILABLE"));
    vec(state.sched.avail, state.sched.types).forEach((c) => av.appendChild(c));
    av.appendChild(label("FLOOR"));
    vec(state.sched.floor, state.sched.types).forEach((c) => {
      c.className = "vecchip floor";
      av.appendChild(c);
    });
    host.appendChild(av);
    host.appendChild(schedTable(state, true));

    /* network */
    host.appendChild(h("h3", "paneltitle", "NETWORK \u2014 degraded route, floor " +
      state.net.floor + ", fuel budget " + state.net.budget + ", probe budget " + state.net.probeBudget));
    host.appendChild(Graph.net(state.net, {
      selected: sel.links,
      pulse: sel.pulse,
      onLink: (id) => bus.patchLink(id)
    }));
    host.appendChild(routeMeter(state, sel, state.net));
    host.appendChild(linkList(state.net, sel));

    /* plan */
    host.appendChild(planBuilder(state, sel));
  }

  function actionS4(state, sel) {
    const bar = $("actionbar");
    bar.innerHTML = "";
    const left = budgetLeft(state, "s4.plan");
    bar.appendChild(btn("EXECUTE PLAN (" + sel.plan.length + " OPS)", "btn-green",
      () => bus.post("/api/s4/plan", { ops: sel.plan.slice() }),
      sel.plan.length === 0 || left <= 0,
      "validated operation-by-operation against the live model"));
    if (sel.plan.length) {
      bar.appendChild(btn("CLEAR PLAN", "", () => bus.patch({ plan: [] })));
    }
    const leftFlag = budgetLeft(state, "flag");
    if (state.solved) {
      bar.appendChild(btn("REOPEN TRANSMISSION", "btn-primary", () => bus.reopen()));
    }
    void leftFlag;
  }

  /* ======================================================== feedback ====== */
  function renderFeedback(state) {
    const box = $("feedback");
    const f = bus.feedback();
    if (!f) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;
    box.className = "feedback " + (f.kind || "");
    box.innerHTML = "";
    box.appendChild(h("span", "fcode", (f.code ? "[" + f.code + "] " : "") + (f.title || "")));
    box.appendChild(document.createTextNode(f.text || ""));
    if (f.detail) box.appendChild(h("div", "fdetail", f.detail));
  }

  /* ========================================================== render ====== */
  function render(state, sel) {
    if (!bus) return;
    renderTrack(state);
    renderBudgets(state);
    renderDiscovered(state);
    renderTranscript(state);
    renderRules(bus.briefing());
    renderHints(state, sel);
    renderHead(state);

    $("viewHost").innerHTML = "";
    $("actionbar").innerHTML = "";
    $("inspector").hidden = true;
    $("inspector").innerHTML = "";

    if (state.stage === 1) {
      viewS1(state, sel);
      inspectorS1(state, sel);
      actionS1(state, sel);
    } else if (state.stage === 2) {
      viewS2(state, sel);
      actionS2(state, sel);
    } else if (state.stage === 3) {
      viewS3(state, sel);
      inspectorNet(state, sel);
      actionS3(state, sel);
    } else if (state.stage === 4) {
      viewS4(state, sel);
      inspectorNet(state, sel);
      actionS4(state, sel);
    }
    renderFeedback(state);
  }

  return { bind: (b) => (bus = b), render, STAGE_NAMES };
})();
