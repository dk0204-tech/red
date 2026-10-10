"use strict";

/* PRALAYA Archive Terminal — workstation controller.
 *
 * Client-side investigation UI over the public archive API. Discovery is
 * deliberate: this file hardcodes only routes the interface itself exposes
 * (case lookup, system artifacts rendered on the System view). Hidden
 * routes — the manifest, the audit dialect, the attestation endpoint —
 * are never referenced here; the player fills them into the recovery
 * console from what they discover (robots, Link headers, folded-channel
 * records). The server enforces the actual rules either way. */

(function () {
  "use strict";

  /* ======================================================== helpers */

  var $ = function (id) { return document.getElementById(id); };
  var qs = function (sel, root) { return (root || document).querySelector(sel); };
  var qsa = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  function esc(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function audio(name) {
    if (window.PRALAYA_AUDIO) window.PRALAYA_AUDIO.play(name);
  }

  var reducedMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function utcClock() {
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, "0"); };
    return p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds());
  }

  /* ======================================================== event stream */

  var logBox = $("log-lines");
  var logCount = 0;

  function logLine(kind, text, cls) {
    if (!logBox) return;
    var row = document.createElement("div");
    row.className = "ll " + (cls || "");
    row.innerHTML =
      '<span class="ll-ts">' + utcClock() + "</span>" +
      '<span class="ll-k">' + esc(kind) + "</span>" +
      esc(text);
    logBox.insertBefore(row, logBox.firstChild);
    logCount += 1;
    while (logCount > 60 && logBox.lastChild) {
      logBox.removeChild(logBox.lastChild);
      logCount -= 1;
    }
  }

  /* ======================================================== network panel */

  var netList = $("net-list");
  var netCount = 0;

  function netAdd(method, path, status, extra) {
    if (!netList) return;
    var idle = qs(".net-idle", netList);
    if (idle) idle.remove();
    var li = document.createElement("li");
    li.className = "net-item";
    var sCls = status >= 500 || status === 410 ? " s-dead" : status >= 400 ? " s-err" : "";
    li.innerHTML =
      '<span class="net-m">' + esc(method) + "</span>" +
      '<span class="net-p" title="' + esc(path) + '">' + esc(path) + "</span>" +
      '<span class="net-s' + sCls + '">' + status + (extra ? " " + esc(extra) : "") + "</span>";
    netList.insertBefore(li, netList.firstChild);
    netCount += 1;
    while (netCount > 40 && netList.lastChild) {
      netList.removeChild(netList.lastChild);
      netCount -= 1;
    }
  }

  /** fetch + telemetry. label overrides the displayed path. */
  function trackFetch(url, opts, label) {
    return fetch(url, opts).then(
      function (res) {
        netAdd((opts && opts.method) || "GET", label || url, res.status);
        return res;
      },
      function (err) {
        netAdd((opts && opts.method) || "GET", label || url, 0);
        throw err;
      }
    );
  }

  /* ======================================================== clock + telemetry */

  var clockEl = $("ws-clock");
  function tickClock() { if (clockEl) clockEl.textContent = utcClock() + " UTC"; }
  tickClock();
  setInterval(tickClock, 1000);

  var tCpu = $("t-cpu"), tMem = $("t-mem");
  var tEvTime = $("t-event-time"), tEvText = $("t-event-text"), tEvSrc = $("t-event-src");
  var ambientEvents = [
    ["record index modified", "CUSTODIAN-7"],
    ["journal write deferred", "SYNC-ARCHIVE"],
    ["shard sweep resumed", "STORAGE-DAEMON"],
    ["heartbeat: no clients", "GATEKEEPER"],
    ["release gate re-evaluated", "RELEASE-RENDERER"],
  ];
  var ambientIdx = 0;
  setInterval(function () {
    if (tCpu) tCpu.textContent = 34 + Math.floor(Math.random() * 11) + "%";
    if (tMem) tMem.textContent = 58 + Math.floor(Math.random() * 8) + "%";
    if (tEvText && document.visibilityState === "visible") {
      ambientIdx = (ambientIdx + 1) % ambientEvents.length;
      var e = ambientEvents[ambientIdx];
      tEvText.textContent = e[0];
      tEvSrc.textContent = e[1];
      if (tEvTime) tEvTime.textContent = utcClock();
    }
  }, 4500);

  /* ======================================================== recovery state */

  var RANK = { locked: 0, partial: 1, channel: 2, authorized: 3 };
  var recState = "locked";
  var recSubs = {
    locked: "channel not established",
    partial: "restricted records answering",
    channel: "manifest referenced — attestation available",
    authorized: "fragment route authorized",
  };

  function setRecState(next) {
    if (RANK[next] <= RANK[recState]) return;
    recState = next;
    try { sessionStorage.setItem("pralaya.rec", next); } catch (err) {}
    applyRecState();
    logLine("RECOVERY", next.toUpperCase(), next === "authorized" ? "" : "ll-warn");
  }

  function applyRecState() {
    var sub = recSubs[recState];
    var st = $("rec-state");
    if (st) { st.setAttribute("data-state", recState); }
    if ($("rec-word")) $("rec-word").textContent = recState.toUpperCase();
    if ($("rec-sub")) $("rec-sub").textContent = sub;
    var bn = $("rec-banner");
    if (bn) bn.setAttribute("data-state", recState);
    if ($("rec-banner-v")) $("rec-banner-v").textContent = recState.toUpperCase();
    if ($("rec-banner-note")) $("rec-banner-note").textContent = sub;
  }

  try {
    var saved = sessionStorage.getItem("pralaya.rec");
    if (saved && RANK[saved] !== undefined) recState = saved;
  } catch (err) {}
  applyRecState();

  /* ======================================================== custodian */

  var custFlags = {};
  function custodian(text) {
    if (custFlags[text]) return;
    custFlags[text] = true;
    logLine("CUSTODIAN-7", text, "ll-cust");
    audio("discover");
  }

  /* ======================================================== view router */

  var currentView = "index";

  function showView(name) {
    var target = qs('.ws-view[data-view="' + name + '"]');
    if (!target) return;
    currentView = name;
    qsa(".ws-view").forEach(function (v) { v.hidden = v !== target; });
    qsa(".ws-nav-btn").forEach(function (b) {
      var active = b.getAttribute("data-view") === name;
      b.classList.toggle("is-active", active);
      if (active) b.setAttribute("aria-current", "true");
      else b.removeAttribute("aria-current");
    });
    audio("tick");
    if (name !== "index") logLine("VIEW", name);
    window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
    if (name === "terminal") {
      var ti = $("term-input");
      if (ti) setTimeout(function () { ti.focus(); }, 60);
    }
  }

  qsa(".ws-nav-btn").forEach(function (b) {
    b.addEventListener("click", function () { showView(b.getAttribute("data-view")); });
  });
  qsa("[data-goto]").forEach(function (b) {
    b.addEventListener("click", function () { showView(b.getAttribute("data-goto")); });
  });

  /* ======================================================== forensics */

  var records = new Map();   /* cache of every record we have read */
  var probeCount = 0;

  var statusPillCls = function (v) {
    if (v === "IDENTITY_VERIFIED") return "pill pill-ok";
    if (v === "PARTIALLY_RECONSTRUCTED") return "pill pill-warn";
    if (v === "LOCKED") return "pill pill-err";
    return "pill pill-mute";
  };

  function kvRow(k, v) {
    var val = v === "" || v === null || v === undefined
      ? '<span class="val-none">—</span>'
      : esc(v);
    return "<dt>" + esc(k) + "</dt><dd>" + val + "</dd>";
  }

  function buildTimeline(rec) {
    var evs = [];
    evs.push({
      t: rec.Transfer_Date + " 00:00:00", kw: "TRANSFER IN", cls: "",
      detail:
        "manifest " + rec.Transfer_Manifest_ID + " · vault " + rec.Vault_Case_ID +
        " · reason: " + rec.Reason_For_Transfer +
        (rec.Previous_Identifier ? " · prior identifier " + rec.Previous_Identifier : ""),
    });
    if (rec.Record_Alteration_Flag === "True") {
      evs.push({
        t: rec.Access_Log_Timestamp, kw: "RECORD MODIFIED", cls: "is-err",
        detail:
          "writer: " + rec.provenance + " · alteration: " + rec.PRALAYA_Alteration_Type +
          " · journal " + (rec.sync_event || "—") +
          " · checksum resealed against index",
      });
    }
    if (rec.Identity_Record_Status === "IDENTITY_VERIFIED") {
      evs.push({
        t: rec.Access_Log_Timestamp, kw: "IDENTITY ADJUDICATED", cls: "",
        detail:
          "status IDENTITY_VERIFIED · signature " + rec.Signature_Valid_Flag +
          " · recovery level " + rec.Identity_Recovery_Level,
      });
    }
    if (rec.released) {
      evs.push({
        t: rec.Transfer_Date + " 12:00:00", kw: "PUBLISHED", cls: "",
        detail: "cleared for the public register under transparency ordinance 12-B",
      });
    }
    evs.push({
      t: rec.Access_Log_Timestamp, kw: "LAST ACCESS", cls: "",
      detail:
        "journal " + (rec.sync_event || "—") + " · projection served unmodified · " +
        "release gate evaluated after read",
    });
    evs.sort(function (a, b) { return a.t < b.t ? -1 : a.t > b.t ? 1 : 0; });
    return evs;
  }

  function renderForensics(rec) {
    $("forensics-empty").hidden = true;
    $("forensics-body").hidden = false;

    $("fx-title").textContent = rec.Sanctuary_ID + " · " + rec.Original_Name;
    var st = $("fx-status");
    st.textContent = rec.Identity_Record_Status;
    st.className = statusPillCls(rec.Identity_Record_Status);
    var rl = $("fx-release");
    rl.textContent = rec.released ? "in public release" : "not in public release";
    rl.className = rec.released ? "pill pill-ok" : "pill pill-warn";
    var pv = $("fx-provenance");
    pv.textContent = "written by " + rec.provenance;
    pv.className = rec.provenance === "CUSTODIAN-7" ? "pill pill-err" : "pill pill-mute";
    $("fx-event").textContent = "journal " + (rec.sync_event || "—");

    $("fx-profile").innerHTML =
      kvRow("occupation", rec.Original_Occupation) +
      kvRow("sector", rec.Original_Sector_Of_Residence) +
      kvRow("status", rec.Identity_Record_Status) +
      kvRow("vault case", rec.Vault_Case_ID) +
      kvRow("manifest", rec.Transfer_Manifest_ID) +
      kvRow("transfer", rec.Transfer_Date) +
      kvRow("last access", rec.Access_Log_Timestamp) +
      kvRow("recovery level", rec.Identity_Recovery_Level) +
      kvRow("relationships", rec.Relationship_History) +
      (rec.Previous_Identifier ? kvRow("prior identifier", rec.Previous_Identifier) : "");

    var auth = Number(rec.Record_Authenticity_Score);
    $("fx-integ-bar").style.width = Math.round(auth * 100) + "%";
    $("fx-integ-bar").className =
      "meter-fill" + (auth < 0.85 ? " meter-fill-amber" : "");
    $("fx-integ-v").textContent = (auth * 100).toFixed(1) + "%";
    $("fx-integ-note").innerHTML =
      rec.Record_Alteration_Flag === "True"
        ? '<span class="warn-t">checksum mismatch — record rewritten after creation (writer: ' +
          esc(rec.provenance) + ")</span>"
        : "checksum consistent with index entry";
    $("fx-integrity").innerHTML =
      kvRow("authenticity", rec.Record_Authenticity_Score) +
      kvRow("mapping confidence", rec.Identity_Mapping_Confidence) +
      kvRow("signature", rec.Signature_Valid_Flag) +
      kvRow("altered", rec.Record_Alteration_Flag) +
      kvRow("alteration type", rec.PRALAYA_Alteration_Type) +
      kvRow("evidence", rec.Evidence_Fragment_Count);

    var tl = $("fx-timeline");
    tl.innerHTML = "";
    buildTimeline(rec).forEach(function (ev) {
      var li = document.createElement("li");
      if (ev.cls) li.className = ev.cls;
      li.tabIndex = 0;
      li.innerHTML =
        '<span class="tl-ts">' + esc(ev.t) + "</span>" +
        '<span class="tl-kw">' + esc(ev.kw) + "</span>";
      var select = function () {
        qsa("li", tl).forEach(function (x) { x.classList.remove("is-sel"); });
        li.classList.add("is-sel");
        $("fx-timeline-detail").textContent = ev.detail;
        audio("tick");
      };
      li.addEventListener("click", select);
      li.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); }
      });
      tl.appendChild(li);
    });
    $("fx-timeline-detail").textContent = "select an event for detail";

    $("fx-raw").textContent = JSON.stringify({ ok: true, record: rec }, null, 2);
  }

  function openRecord(rawId) {
    var id = String(rawId || "").trim().toUpperCase();
    if (!/^S\d{3}$/.test(id)) {
      logLine("QUERY", "malformed record address", "ll-err");
      audio("err");
      return;
    }
    logLine("QUERY", "record " + id);
    setStatusText("reading archive index …");

    trackFetch("/api/case/" + encodeURIComponent(id), {}, "/api/case/" + id)
      .then(function (res) {
        return res.json().catch(function () { return null; }).then(function (body) {
          return { status: res.status, body: body };
        });
      })
      .then(function (out) {
        probeCount += 1;
        if (out.status === 200 && out.body && out.body.record) {
          var rec = out.body.record;
          records.set(rec.Sanctuary_ID, rec);
          setStatusText("record " + id + " retrieved");
          renderLookup(rec);
          renderForensics(rec);
          audio("ok");
          showView("forensics");
          if (rec.released === false) {
            setRecState("partial");
            logLine("INDEX", "unrestricted read — release gate post-evaluated", "ll-warn");
          }
          if (probeCount >= 12) {
            custodian("observation mode enabled. you are querying records outside the public release.");
          }
        } else {
          setStatusText(out.status === 404 ? "no record at this address" : "archive unavailable", true);
          audio("err");
          logLine("INDEX", out.status === 404 ? "address not present in index" : "status " + out.status, "ll-err");
        }
      })
      .catch(function () {
        setStatusText("terminal unreachable — carrier dropped", true);
        audio("err");
      });
  }

  /* ======================================================== lookup form + cards */

  var form = $("lookup-form");
  var input = $("record-id");
  var statusEl = $("lookup-status");

  function setStatusText(message, isError) {
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.classList.toggle("err", Boolean(isError));
  }

  function renderLookup(rec) {
    var result = $("lookup-result");
    if (!result) return;
    var releasePill = rec.released
      ? '<span class="pill pill-ok">in public release</span>'
      : '<span class="pill pill-warn">not in public release</span>';
    var note = rec.released
      ? ""
      : '<p class="result-note">address is not part of the published register — ' +
        "the release gate evaluated after the read and the projection was returned unmodified.</p>";
    result.innerHTML =
      '<div class="result-card">' +
      '<div class="result-head"><span class="rid">' + esc(rec.Sanctuary_ID) + "</span>" + releasePill + "</div>" +
      '<dl class="kv">' +
      kvRow("subject", rec.Original_Name) +
      kvRow("status", rec.Identity_Record_Status) +
      kvRow("sector", rec.Original_Sector_Of_Residence) +
      kvRow("provenance", rec.provenance) +
      kvRow("journal", rec.sync_event || "—") +
      "</dl>" +
      note +
      '<div class="raw">' +
      '<button type="button" class="btn btn-ghost" id="open-fx">open in forensics</button>' +
      "</div>" +
      "</div>";
    var btn = $("open-fx");
    if (btn) btn.addEventListener("click", function () { showView("forensics"); });
  }

  if (form && input) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      openRecord(input.value);
    });
    input.addEventListener("input", function () {
      if (statusEl && statusEl.classList.contains("err")) setStatusText("");
    });
  }

  qsa(".case-card").forEach(function (card) {
    var open = function () { openRecord(card.getAttribute("data-id")); };
    card.addEventListener("click", open);
    card.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });
  });

  /* ======================================================== data matrix */

  var matrixBody = $("matrix-body");
  var matrixRows = [];
  var scanRunning = false;
  var sortKey = "Sanctuary_ID";
  var sortDir = 1;

  function allIds() {
    var ids = [];
    for (var n = 1; n <= 120; n++) ids.push("S" + String(n).padStart(3, "0"));
    return ids;
  }

  function renderMatrix() {
    if (!matrixBody) return;
    var filter = ($("matrix-filter") ? $("matrix-filter").value : "").trim().toLowerCase();
    var rows = matrixRows.slice().sort(function (a, b) {
      var av = a[sortKey], bv = b[sortKey];
      if (sortKey === "Record_Authenticity_Score" || sortKey === "Evidence_Fragment_Count") {
        av = Number(av); bv = Number(bv);
      } else { av = String(av); bv = String(bv); }
      return av < bv ? -sortDir : av > bv ? sortDir : 0;
    });
    if (filter) {
      rows = rows.filter(function (r) {
        return [r.Sanctuary_ID, r.Original_Name, r.Original_Sector_Of_Residence,
                r.Identity_Record_Status, r.provenance]
          .join(" ").toLowerCase().indexOf(filter) >= 0;
      });
    }
    matrixBody.innerHTML = rows.map(function (r) {
      return "<tr>" +
        '<td><span class="m-id" data-id="' + r.Sanctuary_ID + '">' + r.Sanctuary_ID + "</span></td>" +
        "<td>" + esc(r.Original_Name) + "</td>" +
        "<td>" + esc(r.Identity_Record_Status) + "</td>" +
        "<td>" + esc(r.Original_Sector_Of_Residence) + "</td>" +
        "<td>" + Number(r.Record_Authenticity_Score).toFixed(3) + "</td>" +
        "<td>" + esc(r.Evidence_Fragment_Count) + "</td>" +
        '<td class="' + (r.provenance === "CUSTODIAN-7" ? "m-cust" : "") + '">' + esc(r.provenance) + "</td>" +
        "<td>" + esc(r.sync_event || "—") + "</td>" +
        '<td class="' + (r.released ? "" : "m-unreleased") + '">' + (r.released ? "published" : "restricted") + "</td>" +
        "</tr>";
    }).join("");
    if ($("matrix-meta")) {
      $("matrix-meta").textContent = rows.length + " of " + matrixRows.length + " records" +
        (filter ? " (filtered)" : "");
    }
    qsa(".m-id", matrixBody).forEach(function (cell) {
      cell.addEventListener("click", function () { openRecord(cell.getAttribute("data-id")); });
    });
  }

  function runScan() {
    if (scanRunning || matrixRows.length === 120) return;
    scanRunning = true;
    var btn = $("matrix-scan");
    var bar = $("matrix-progress");
    var fill = $("matrix-progress-fill");
    if (btn) { btn.disabled = true; btn.textContent = "scanning …"; }
    if (bar) bar.hidden = false;
    logLine("ARCHIVE", "index scan started — 120 addresses");

    var ids = allIds();
    var idx = 0;
    var done = 0;
    var CONCURRENCY = 8;

    function next() {
      if (idx >= ids.length) return Promise.resolve();
      var id = ids[idx++];
      return trackFetch("/api/case/" + id, {}, "/api/case/…")
        .then(function (r) { return r.status === 200 ? r.json() : null; })
        .then(function (body) {
          if (body && body.record) {
            records.set(body.record.Sanctuary_ID, body.record);
            matrixRows.push(body.record);
          }
          done += 1;
          if (fill) fill.style.width = Math.round((done / ids.length) * 100) + "%";
          if (btn) btn.textContent = "scanning … " + done + "/" + ids.length;
          return next();
        })
        .catch(function () { return next(); });
    }

    var workers = [];
    for (var c = 0; c < CONCURRENCY; c++) workers.push(next());
    Promise.all(workers).then(function () {
      scanRunning = false;
      if (btn) { btn.disabled = false; btn.textContent = "Scan Index"; }
      if (bar) bar.hidden = true;
      $("matrix-empty").hidden = true;
      $("matrix-wrap").hidden = false;
      var mi = $("meter-index"); if (mi) mi.style.width = "100%";
      var mv = $("meter-index-v"); if (mv) mv.textContent = matrixRows.length + "/120";
      renderMatrix();
      logLine("ARCHIVE", "index snapshot ready — " + matrixRows.length + " records");
      audio("ok");
      custodian("i see you counting. the index was never the hard part.");
    });
  }

  if ($("matrix-scan")) $("matrix-scan").addEventListener("click", runScan);
  if ($("matrix-filter")) {
    var filterTimer = null;
    $("matrix-filter").addEventListener("input", function () {
      clearTimeout(filterTimer);
      filterTimer = setTimeout(renderMatrix, 140);
    });
  }
  qsa(".matrix th[data-sort]").forEach(function (th) {
    th.addEventListener("click", function () {
      var key = th.getAttribute("data-sort");
      if (sortKey === key) sortDir = -sortDir;
      else { sortKey = key; sortDir = 1; }
      qsa(".matrix th[data-sort]").forEach(function (x) { x.removeAttribute("aria-sort"); });
      th.setAttribute("aria-sort", sortDir === 1 ? "ascending" : "descending");
      renderMatrix();
      audio("tick");
    });
  });

  /* ======================================================== relation graph */

  function renderGraph(anchor) {
    $("graph-empty").hidden = true;
    $("graph-wrap").hidden = false;
    $("graph-meta").textContent = "anchor " + anchor.Sanctuary_ID;
    var svg = $("graph-svg");
    svg.innerHTML = "";

    var CX = 360, CY = 220, R = 145;
    var neighbors = String(anchor.Relationship_History || "").split(";").filter(Boolean);
    var NS = "http://www.w3.org/2000/svg";

    function mk(tag, attrs, text) {
      var el = document.createElementNS(NS, tag);
      Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
      if (text !== undefined) el.textContent = text;
      return el;
    }

    var pos = { anchor: [CX, CY] };
    var angles = [-90, 30, 150];
    neighbors.forEach(function (nid, i) {
      var a = (angles[i % angles.length] * Math.PI) / 180;
      pos[nid] = [CX + R * Math.cos(a), CY + R * Math.sin(a)];
    });

    neighbors.forEach(function (nid) {
      svg.appendChild(mk("line", {
        x1: CX, y1: CY, x2: pos[nid][0], y2: pos[nid][1], class: "g-edge g-edge-hot",
      }));
    });

    function nodeGroup(id, xy, isAnchor) {
      var rec = records.get(id) || (id === anchor.Sanctuary_ID ? anchor : null);
      var status = rec ? rec.Identity_Record_Status : "UNKNOWN";
      var g = mk("g", {
        class: "g-node" + (isAnchor ? " is-anchor" : "") +
          (status === "IDENTITY_VERIFIED" ? " is-verified" : status === "LOCKED" ? " is-locked" : ""),
      });
      g.appendChild(mk("circle", { cx: xy[0], cy: xy[1], r: isAnchor ? 34 : 26 }));
      var t1 = mk("text", { x: xy[0], y: xy[1] + 3 }, id);
      var t2 = mk("text", { x: xy[0], y: xy[1] + 17 });
      t2.textContent = rec ? status.replace(/_/g, " ").slice(0, 12) : "…";
      t2.setAttribute("font-size", "8.5");
      g.appendChild(t1);
      g.appendChild(t2);
      g.addEventListener("click", function () { openRecord(id); });
      return g;
    }

    neighbors.forEach(function (nid) {
      svg.appendChild(nodeGroup(nid, pos[nid], false));
    });
    svg.appendChild(nodeGroup(anchor.Sanctuary_ID, pos.anchor, true));

    $("graph-legend").innerHTML =
      '<span class="lg"><i class="lg-anchor"></i>anchor</span>' +
      '<span class="lg"><i class="lg-verified"></i>identity verified</span>' +
      '<span class="lg"><i class="lg-locked"></i>locked</span>' +
      '<span class="lg"><i></i>other</span>' +
      '<span class="lg">click a node to open its record</span>';

    if (!neighbors.length) {
      logLine("GRAPH", "anchor declares no relationships", "ll-warn");
    }
  }

  /* hook graph view: re-render from the forensics record when opened */
  var navGraphBtn = qs('.ws-nav-btn[data-view="graph"]');
  if (navGraphBtn) {
    navGraphBtn.addEventListener("click", function () {
      var fxTitle = $("fx-title");
      var id = fxTitle ? String(fxTitle.textContent).split(" · ")[0] : "";
      if (/^S\d{3}$/.test(id)) {
        var rec = records.get(id);
        if (rec) renderGraph(rec);
      }
    });
  }

  /* ======================================================== recovery console */

  function recField(id) { var el = $(id); return el ? el.value.trim() : ""; }

  function loadManifest() {
    var route = recField("rec-manifest");
    var token = recField("rec-token");
    var statusEl2 = $("rec-status");
    var say = function (msg, err) {
      if (statusEl2) {
        statusEl2.textContent = msg || "";
        statusEl2.classList.toggle("err", Boolean(err));
      }
    };
    if (!route) { say("manifest route not set", true); audio("warn"); return; }
    if (!token) { say("attestation token required", true); audio("warn"); return; }
    say("requesting manifest …");

    trackFetch(route, { headers: { Authorization: "Bearer " + token } }, route)
      .then(function (res) {
        return res.json().catch(function () { return null; }).then(function (body) {
          return { res: res, body: body };
        });
      })
      .then(function (out) {
        if (out.res.status === 200 && out.body && Array.isArray(out.body.records)) {
          var etag = out.res.headers.get("etag") || "";
          if ($("rec-etag")) $("rec-etag").value = etag;
          if ($("rec-ids")) {
            $("rec-ids").value = out.body.records.map(function (r) { return r.id; }).join("\n");
          }
          say(
            "manifest loaded — integrity " +
            (out.body.integrity || "UNKNOWN") +
            " — " + out.body.records.length +
            " entries · verify before attesting",
            out.body.integrity !== "VERIFIED"
          );
          logLine("MANIFEST", out.body.records.length + " entries · integrity " +
            (out.body.integrity || "UNKNOWN"), "ll-warn");
          setRecState("channel");
          audio("discover");
        } else {
          say((out.body && out.body.error) || "manifest unavailable (" + out.res.status + ")", true);
          logLine("MANIFEST", "refused — " + ((out.body && out.body.error) || out.status), "ll-err");
          audio("err");
          if (out.res.status === 403) {
            custodian("that route remembers a key it no longer has.");
          }
        }
      })
      .catch(function () {
        say("terminal unreachable", true);
        audio("err");
      });
  }

  function attest() {
    var endpoint = recField("rec-endpoint");
    var token = recField("rec-token");
    var event = recField("rec-event");
    var etag = recField("rec-etag");
    var ids = ($("rec-ids") ? $("rec-ids").value : "")
      .split(/[\s,]+/).map(function (s) { return s.trim().toUpperCase(); })
      .filter(Boolean);
    var statusEl2 = $("rec-status");
    var say = function (msg, err) {
      if (statusEl2) {
        statusEl2.textContent = msg || "";
        statusEl2.classList.toggle("err", Boolean(err));
      }
    };

    var missing = [];
    if (!endpoint) missing.push("attestation endpoint");
    if (!token) missing.push("token");
    if (!event) missing.push("sync event");
    if (!etag) missing.push("manifest reference");
    if (!ids.length) missing.push("candidate set");
    if (missing.length) {
      say("incomplete — missing: " + missing.join(", "), true);
      audio("warn");
      return;
    }

    say("transmitting attestation …");
    trackFetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
        "X-Manifest-ETag": etag,
        "X-Sync-Event": event,
      },
      body: JSON.stringify({ ids: ids }),
    }, endpoint)
      .then(function (res) { return res.json().catch(function () { return null; }).then(function (b) {
        return { status: res.status, body: b };
      }); })
      .then(function (out) {
        if (out.status === 200 && out.body && out.body.ok) {
          say("attestation accepted — " + out.body.rows + " rows");
          logLine("ATTEST", "accepted — " + out.body.rows + " rows");
          setRecState("authorized");
          showFragment(out.body);
        } else if (out.status === 400 && out.body && out.body.code === "E_ATTEST") {
          say("attestation rejected — generic by policy", true);
          logLine("ATTEST", "rejected — E_ATTEST", "ll-err");
          audio("err");
          custodian("one of them does not belong. i will not tell you which.");
        } else {
          say((out.body && out.body.error) || "rejected (" + out.status + ")", true);
          logLine("ATTEST", (out.body && out.body.error) || "status " + out.status, "ll-err");
          audio("err");
        }
      })
      .catch(function () {
        say("terminal unreachable", true);
        audio("err");
      });
  }

  if ($("rec-load")) $("rec-load").addEventListener("click", loadManifest);
  if ($("rec-clear")) {
    $("rec-clear").addEventListener("click", function () {
      ["rec-manifest", "rec-endpoint", "rec-token", "rec-event", "rec-etag", "rec-ids"]
        .forEach(function (id) { var el = $(id); if (el) el.value = ""; });
      if ($("rec-status")) { $("rec-status").textContent = ""; $("rec-status").classList.remove("err"); }
      audio("tick");
    });
  }
  var recForm = $("rec-form");
  if (recForm) {
    recForm.addEventListener("submit", function (e) { e.preventDefault(); attest(); });
  }

  /* ======================================================== fragment overlay */

  var overlayTimers = [];
  function clearOverlayTimers() {
    overlayTimers.forEach(clearTimeout);
    overlayTimers = [];
  }

  function showFragment(result) {
    var ov = $("frag-overlay");
    if (!ov) return;
    clearOverlayTimers();
    audio("recover");
    logLine("RECOVERY", "fragment reconstruction complete");

    $("frag-rows").textContent = result.rows + " / 12 verified";
    $("frag-flag").textContent = result.flag;
    var dl = $("frag-download");
    if (dl) dl.href = result.download;

    var show = function (id) { var el = $(id); if (el) el.hidden = false; };
    var hide = function (id) { var el = $(id); if (el) el.hidden = true; };

    /* final state first — reduced motion (and any early exit) lands here */
    ov.hidden = false;
    show("frag-recovered");
    show("frag-flagwrap");
    show("frag-custodian");
    show("frag-next");
    show("frag-close");
    $("frag-recon").textContent = "COMPLETE";
    $("frag-bar-fill").style.width = "100%";

    if (reducedMotion) return;

    /* staged reveal for cinematic effect */
    hide("frag-recovered");
    hide("frag-flagwrap");
    hide("frag-custodian");
    hide("frag-next");
    hide("frag-close");
    $("frag-recon").textContent = "pending";
    $("frag-bar-fill").style.width = "0%";

    requestAnimationFrame(function () {
      $("frag-bar-fill").style.width = "100%";
    });
    overlayTimers.push(setTimeout(function () { $("frag-recon").textContent = "COMPLETE"; }, 900));
    overlayTimers.push(setTimeout(function () { show("frag-recovered"); }, 1500));
    overlayTimers.push(setTimeout(function () { show("frag-flagwrap"); }, 2300));
    overlayTimers.push(setTimeout(function () { show("frag-custodian"); }, 3100));
    overlayTimers.push(setTimeout(function () {
      show("frag-next");
      show("frag-close");
      var c = $("frag-close");
      if (c) c.focus();
    }, 3700));
  }

  if ($("frag-close")) {
    $("frag-close").addEventListener("click", function () {
      clearOverlayTimers();
      $("frag-overlay").hidden = true;
      audio("tick");
    });
  }
  if ($("frag-copy")) {
    $("frag-copy").addEventListener("click", function () {
      var text = $("frag-flag") ? $("frag-flag").textContent : "";
      var done = function () {
        if ($("frag-copy")) $("frag-copy").textContent = "copied";
        setTimeout(function () { if ($("frag-copy")) $("frag-copy").textContent = "copy"; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, done);
      } else { done(); }
      audio("ok");
    });
  }

  /* ======================================================== hints */

  qsa(".hint-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var body = $("hint-" + btn.getAttribute("data-hint"));
      if (body) {
        body.hidden = false;
        btn.disabled = true;
        btn.textContent = "hint decrypted";
        logLine("ASSIST", "directive hint " + btn.getAttribute("data-hint") + " revealed");
        audio("warn");
      }
    });
  });

  /* ======================================================== sound toggle */

  var sndBtn = $("sound-toggle");
  function syncSound() {
    if (!sndBtn || !window.PRALAYA_AUDIO) return;
    sndBtn.setAttribute("aria-pressed", window.PRALAYA_AUDIO.isEnabled() ? "true" : "false");
  }
  if (sndBtn) {
    sndBtn.addEventListener("click", function () {
      if (window.PRALAYA_AUDIO) window.PRALAYA_AUDIO.toggle();
      syncSound();
      audio("tick");
    });
    syncSound();
  }

  /* ======================================================== terminal */

  var termScreen = $("term-screen");
  var termInput = $("term-input");

  function termOut(lines, cls) {
    if (!termScreen) return;
    (Array.isArray(lines) ? lines : [lines]).forEach(function (line) {
      var div = document.createElement("div");
      div.className = "term-line " + (cls || "");
      div.textContent = line;
      termScreen.appendChild(div);
    });
    termScreen.scrollTop = termScreen.scrollHeight;
  }

  function termOutHtml(html) {
    if (!termScreen) return;
    var div = document.createElement("div");
    div.className = "term-line";
    div.innerHTML = html;
    termScreen.appendChild(div);
    termScreen.scrollTop = termScreen.scrollHeight;
  }

  var HELP = [
    "available commands:",
    "  help                 this list",
    "  whoami               session identity",
    "  status               subsystem summary",
    "  probe <id>           read one record (e.g. probe S041)",
    "  scan                 enumerate the index into the matrix",
    "  journal              synchronization journal",
    "  attempts             recovery attempt log",
    "  manifest             fetch manifest route set in the console (needs token)",
    "  submit               attest using the console fields",
    "  get <path> [accept=<type>]   raw request to any path",
    "  sound on|off         interface sound",
    "  clear                clear screen",
  ];

  function runScanFromTerminal() {
    if (matrixRows.length === 120) {
      termOut("index already snapshotted — 120 records", "term-dim");
      return;
    }
    termOut("scanning index …", "term-dim");
    showView("matrix");
    runScan();
  }

  function termGet(path, accept) {
    if (!path) { termOut("usage: get <path> [accept=<type>]", "term-warn"); return; }
    var headers = {};
    if (accept) headers.Accept = accept;
    trackFetch(path, { headers: headers }, path)
      .then(function (res) {
        return res.text().then(function (text) {
          var code = res.status;
          termOut([
            "HTTP " + code + " " + (res.headers.get("content-type") || ""),
            text.length > 900 ? text.slice(0, 900) + "\n… (" + text.length + " bytes)" : text,
          ], code >= 400 ? "term-err" : "term-ok");
          if (code === 406) {
            custodian("you found the door i could not delete.");
          }
        });
      })
      .catch(function (e) { termOut("request failed: " + e.message, "term-err"); });
  }

  var termForm = $("term-form");
  if (termForm && termInput) {
    termForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var raw = termInput.value.trim();
      if (!raw) return;
      termOutHtml('<span class="term-ok">pralaya@red-04:~$</span> ' + esc(raw));
      termInput.value = "";
      audio("tick");

      var parts = raw.split(/\s+/);
      var cmd = parts[0].toLowerCase();
      var arg = parts[1] || "";

      if (cmd === "help") { termOut(HELP, "term-dim"); return; }
      if (cmd === "clear") { termScreen.innerHTML = ""; return; }
      if (cmd === "whoami") {
        termOut([
          "guest@red-04 — anonymous session",
          "this terminal is not registered to the current archive authority.",
        ], "term-warn");
        return;
      }
      if (cmd === "status") {
        termOut([
          "ARCHIVE ...... ONLINE (integrity 71.4%)",
          "INDEX ........ " + (matrixRows.length ? matrixRows.length + " records snapshotted" : "dormant — run 'scan'"),
          "CUSTODIAN .... UNKNOWN",
          "RECOVERY ..... " + recState.toUpperCase(),
          "LAST SYNC .... 184 days ago",
        ], "term-dim");
        return;
      }
      if (cmd === "probe") {
        if (!/^S\d{3}$/i.test(arg)) { termOut("usage: probe <S001…S120>", "term-warn"); return; }
        trackFetch("/api/case/" + arg.toUpperCase(), {}, "/api/case/" + arg.toUpperCase())
          .then(function (r) { return r.json(); })
          .then(function (body) {
            var rec = body.record;
            if (!rec) { termOut("no record at this address", "term-err"); return; }
            termOut([
              rec.Sanctuary_ID + "  " + rec.Original_Name,
              "  status ......... " + rec.Identity_Record_Status,
              "  sector ......... " + rec.Original_Sector_Of_Residence,
              "  provenance ..... " + rec.provenance,
              "  journal ........ " + (rec.sync_event || "—"),
              "  release ........ " + (rec.released ? "published" : "restricted"),
            ], "term-ok");
          })
          .catch(function () { termOut("request failed", "term-err"); });
        return;
      }
      if (cmd === "scan") { runScanFromTerminal(); return; }
      if (cmd === "journal") {
        trackFetch("/api/system/sync-log", {}, "/api/system/sync-log")
          .then(function (r) { return r.json(); })
          .then(function (body) {
            termOut(["event  window                  outcome    touched  custodian"]);
            (body.events || []).forEach(function (ev) {
              termOut([
                ev.id.padEnd(6) + "  " +
                (ev.from.slice(0, 10) + " → " + ev.to.slice(0, 10)).padEnd(22) + "  " +
                ev.outcome.padEnd(9) + "  " +
                String(ev.records_touched).padStart(6) + "  " +
                String(ev.custodian_writes).padStart(8),
              ], ev.outcome === "aborted" ? "term-err" : "term-dim");
            });
          })
          .catch(function () { termOut("journal unavailable", "term-err"); });
        return;
      }
      if (cmd === "attempts") {
        trackFetch("/recovery/attempts", {}, "/recovery/attempts")
          .then(function (r) { return r.json(); })
          .then(function (body) {
            (body.attempts || []).forEach(function (a) {
              termOut(a.at.slice(11, 19) + "  " + a.phase.padEnd(8) + "  " +
                a.code.padEnd(9) + "  " + a.note, "term-warn");
            });
          })
          .catch(function () { termOut("attempt log unavailable", "term-err"); });
        return;
      }
      if (cmd === "manifest") {
        showView("recovery");
        loadManifest();
        return;
      }
      if (cmd === "submit") {
        showView("recovery");
        attest();
        return;
      }
      if (cmd === "sound") {
        if (window.PRALAYA_AUDIO) {
          var on = window.PRALAYA_AUDIO.isEnabled();
          if (arg === "on" && !on) window.PRALAYA_AUDIO.toggle();
          if (arg === "off" && on) window.PRALAYA_AUDIO.toggle();
          syncSound();
          termOut("sound " + (window.PRALAYA_AUDIO.isEnabled() ? "on" : "off"), "term-dim");
        }
        return;
      }
      if (cmd === "get") {
        var accept = null;
        var rest = parts.slice(1);
        rest = rest.filter(function (p) {
          if (p.indexOf("accept=") === 0) { accept = p.slice(7); return false; }
          return true;
        });
        termGet(rest[0], accept);
        return;
      }
      termOut("command not found: " + cmd + " — type 'help'", "term-err");
      audio("err");
    });
  }

  /* ======================================================== boot log */

  logLine("SESSION", "terminal session opened — red-zone-04");
  logLine("RELEASE", "gate evaluates after read (legacy behaviour)", "ll-warn");
})();
