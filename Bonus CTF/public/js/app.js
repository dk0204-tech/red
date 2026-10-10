/* ============================================================================
   app.js — controller for THE DEADLOCK ENGINE: BLACKOUT PROTOCOL.
   Owns the API client (ver / stale / rate handling), overlay flow (intro,
   briefing, tutorial, completion), client selection state, and rendering.
   Server state is the single source of truth; nothing is validated here.
   ========================================================================== */
"use strict";

(function () {
  const $ = (id) => document.getElementById(id);

  /* ------------------------------------------------------------- state --- */
  let state = null;              /* last server state view */
  let briefing = null;           /* current stage briefing */
  let sel = freshSel();
  let fb = null;                 /* current feedback banner */
  let briefResolve = null;
  let tutResolve = null;
  let tutCur = 0;
  let lastTransmission = "";

  function freshSel() {
    return {
      node: null, nodeKind: null,
      trialOp: "preempt", trialTarget: null,
      recOp: "preempt", recTarget: null,
      seq: [], confirmEvict: false,
      linkFocus: null, links: new Set(), pulse: new Set(),
      plan: [], addType: "PREEMPT", addProc: null, addRes: null,
      hintData: null
    };
  }

  /* --------------------------------------------------------- transport --- */
  async function getState() {
    const r = await fetch("/api/state", { cache: "no-store" });
    if (!r.ok) throw new Error("state " + r.status);
    return r.json();
  }

  async function post(path, body) {
    body = Object.assign({}, body || {});
    body.ver = state.ver;
    let r, json = {};
    try {
      r = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      json = await r.json();
    } catch (e) {
      fb = {
        kind: "", code: "LINK",
        text: "The console lost contact with the engine.",
        detail: "Is the facility server still running? Retry when the link is back."
      };
      render();
      return null;
    }

    const prevStage = state.stage;
    if (json.state) state = json.state;

    /* stale state version — resync transparently */
    if (r.status === 409 && json.code === "STALE") {
      try { state = await getState(); } catch (e) { /* keep current */ }
      toast("Console resynced to the live engine — re-read the display.", "bad");
      render();
      return { status: r.status, json };
    }

    if (r.ok) {
      fb = null;
      if (path === "/api/s1/trial") {
        const t = json.trial || {};
        fb = {
          kind: "info", code: "TRIAL",
          title: "TRIAL RESULT \u2014 ",
          text: t.drains
            ? "the candidate intervention DRAINS the system: every process can finish."
            : "the intervention stalls: " + (t.stuckCount != null ? t.stuckCount : "?") +
              " process(es) remain blocked. Identities are withheld by design."
        };
      } else if (path === "/api/s1/inspect" || path === "/api/s2/inspect") {
        fb = {
          kind: "info", code: "REVEALED",
          title: "INSPECTION COMPLETE \u2014 ",
          text: "hidden properties of " + (json.target || "target") +
            " are now in DISCOVERED and on the map."
        };
      } else if (path === "/api/s3/probe") {
        const p = json.probe || {};
        fb = {
          kind: "info", code: "PROBED",
          title: "LINK MEASURED \u2014 ",
          text: p.id + " true capacity " + p.cap + ", fuel cost now " + p.cost +
            ". Measurement is permanent on that link."
        };
      } else if (path === "/api/s2/evict") {
        fb = {
          kind: "good", code: "EVICTED",
          title: "CUSTODIAL RIG EVICTED \u2014 ",
          text: "its hold returned to the pool and it left the resident set for this session."
        };
      } else if (path === "/api/s4/plan") {
        fb = {
          kind: "good", code: "PLAN ACCEPTED",
          title: "PROTOCOL ACCEPTED \u2014 ",
          text: "every operation validated against the live model."
        };
      } else if (path === "/api/flag") {
        fb = {
          kind: "good", code: "SEALED",
          title: "COMPLETION SEALED \u2014 ",
          text: "the recovery token is recorded for this session."
        };
      }

      if (state.stage !== prevStage) await stageUp(prevStage);

      if (path === "/api/s4/plan" && json.flag) {
        try { sessionStorage.setItem("dz-flag", json.flag); } catch (e) { /* private mode */ }
        lastTransmission = json.transmission || "";
        openComplete(json.flag, lastTransmission);
        Audio2.restore();
      }
      render();
      return { status: r.status, json };
    }

    /* ---- failure: build contextual feedback from server explanation ---- */
    const title = [];
    if (json.failedAt != null) {
      if (path === "/api/s2/test") {
        title.push("STEP " + (json.failedAt + 1) + (json.proc ? " (" + json.proc + ")" : "") + " FAILS");
      } else {
        title.push("OPERATION " + (json.failedAt + 1) + " FAILS");
      }
    }
    let detail = "";
    if (json.deficit) {
      const parts = Object.keys(json.deficit).map((k) => k + " short " + json.deficit[k]);
      if (parts.length) detail = parts.join(", ");
    }
    if (json.link) {
      detail += (detail ? " \u00B7 " : "") + "link " + json.link +
        (json.actual != null ? " measures capacity " + json.actual : "");
    }
    if (json.code === "BUDGET") {
      detail += (detail ? " \u00B7 " : "") + "budget spent: " + json.used + " / " + json.max;
    }
    if (json.retryMs) {
      detail += (detail ? " \u00B7 " : "") + "wait " + (Math.ceil(json.retryMs / 100) / 10) + "s";
    }
    if (json.need != null) {
      detail += (detail ? " \u00B7 " : "") + "needs " + json.need + " failed attempts, you have " + json.have;
    }

    let text = json.msg;
    if (!text) {
      if (json.code === "SPACING") text = "Rate spacing: the engine throttles this action.";
      else if (json.code === "BUDGET") text = "That diagnostic budget is exhausted for this session.";
      else if (json.code === "RATE") text = "Too many requests slow down.";
      else if (json.code === "LOCKED") text = "Stage " + (json.stage || "?") + " is locked until the current stage clears.";
      else if (json.code === "NOVER" || json.code === "STALE") text = "State version mismatch.";
      else text = "Request rejected by the engine.";
    }
    fb = { kind: "", code: json.code || String(r.status), title: title.length ? title[0] + " \u2014 " : "", text, detail };

    /* highlight the failing link when the server names it */
    if (json.link) {
      sel.pulse = new Set([json.link]);
      setTimeout(() => { sel.pulse = new Set(); render(); }, 4000);
    }

    if (state.stage !== prevStage) await stageUp(prevStage);
    render();
    return { status: r.status, json };
  }

  /* ------------------------------------------------------- transitions --- */
  async function stageUp(prevStage) {
    Audio2.stageUp();
    fb = null;
    sel = freshSel();
    toast("STAGE CLEAR \u2014 subsystem " + prevStage + " recovered.", "good");
    await showBriefing();
  }

  function showBriefing() {
    return fetch("/api/briefing").then((r) => r.json()).then((b) => {
      briefing = b;
      $("briefKicker").textContent = "STAGE " + b.stage + " BRIEFING \u00B7 " + (b.stageTitle || "");
      $("briefTitle").textContent = b.title;
      const body = $("briefBody");
      body.innerHTML = "";
      if (b.stageClear) {
        const clear = document.createElement("p");
        clear.className = "transmission";
        clear.textContent = b.stageClear;
        body.appendChild(clear);
      }
      (b.body || []).forEach((line) => {
        const p = document.createElement("p");
        p.textContent = line;
        body.appendChild(p);
      });
      const rules = $("briefRules");
      rules.innerHTML = "";
      (b.rules || []).forEach((r2) => {
        const li = document.createElement("li");
        li.textContent = r2;
        rules.appendChild(li);
      });
      $("ovBriefing").hidden = false;
      $("btnAckBrief").focus();
      render();
      return new Promise((res) => { briefResolve = res; });
    });
  }

  function showTutorial(fromStart) {
    const steps = (state.tutorial && state.tutorial.steps) || [];
    tutCur = fromStart ? 0 : (state.tutorial ? state.tutorial.step : 0);
    if (tutCur >= steps.length) return Promise.resolve();
    fillTut();
    $("ovTut").hidden = false;
    $("btnTutNext").focus();
    return new Promise((res) => { tutResolve = res; });
  }

  function fillTut() {
    const steps = state.tutorial.steps;
    $("tutStepTitle").textContent = "TUTORIAL \u00B7 STEP " + (tutCur + 1) + " / " + steps.length;
    $("tutText").textContent = steps[tutCur].text;
    $("btnTutNext").textContent = tutCur + 1 >= steps.length ? "FINISH" : "NEXT";
  }

  /* ------------------------------------------------------- flag / seal --- */
  function openComplete(flag, transmission) {
    $("doneTransmission").textContent = transmission || lastTransmission || "";
    lastTransmission = transmission || lastTransmission;
    $("doneFlag").textContent = flag || "\u2014 token not cached in this tab \u2014";
    $("btnCopyFlag").disabled = !flag;
    $("sealResult").hidden = true;
    $("sealInput").value = "";
    $("ovComplete").hidden = false;
    $("btnCloseComplete").focus();
  }

  async function sealFlag() {
    const value = $("sealInput").value.trim();
    if (!value) return;
    const r = await post("/api/flag", { value });
    const out = $("sealResult");
    out.hidden = false;
    if (r && r.status === 200) {
      out.className = "small ok";
      out.textContent = "SEALED \u2014 completion recorded for this session.";
    } else {
      out.className = "small no";
      out.textContent = "REJECTED \u2014 transmission not authorized (wrong token, or the protocol is not yet complete).";
    }
    render();
  }

  /* --------------------------------------------------------- UI helpers --- */
  function toast(msg, kind) {
    const t = $("toast");
    t.textContent = msg;
    t.className = "toast " + (kind || "");
    t.hidden = false;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.hidden = true; }, 3400);
  }

  function render() {
    if (state) UI.render(state, sel);
  }

  function updateAudioBtn() {
    const on = Audio2.isEnabled();
    $("btnAudio").setAttribute("aria-pressed", on ? "true" : "false");
    $("audioLabel").textContent = on ? "AUDIO ON" : "AUDIO OFF";
  }

  /* ----------------------------------------------------------- wiring ---- */
  const bus = {
    post,
    patch: (p) => { Object.assign(sel, p); render(); },
    patchLink: (id) => {
      const next = new Set(sel.links);
      if (next.has(id)) next.delete(id); else next.add(id);
      sel.links = next;
      sel.linkFocus = id;
      Audio2.select();
      render();
    },
    hint: async (level) => {
      let r, j = {};
      try {
        r = await fetch("/api/hint?stage=" + state.stage + "&level=" + level);
        j = await r.json();
      } catch (e) {
        toast("Advisory link failed.", "bad");
        return;
      }
      if (r.ok) {
        sel.hintData = j;
        Audio2.confirm();
        fb = null;
      } else if (j.code === "GATED") {
        fb = {
          kind: "info", code: "GATED",
          title: "ADVISORY LOCKED \u2014 ",
          text: "level " + level + " opens after " + j.need +
            " failed attempt(s) on this stage; you have " + j.have + "."
        };
        Audio2.deny();
      } else if (j.code === "SPACING") {
        toast("Pause briefly between advisory requests.", "bad");
        Audio2.deny();
      } else {
        toast("Advisory unavailable: " + (j.code || r.status), "bad");
      }
      render();
    },
    briefing: () => briefing,
    feedback: () => fb,
    reopen: () => {
      let flag = null;
      try { flag = sessionStorage.getItem("dz-flag"); } catch (e) { /* ignore */ }
      openComplete(flag, lastTransmission);
    }
  };

  function wire() {
    /* audio */
    $("btnAudio").addEventListener("click", () => { Audio2.toggle(); updateAudioBtn(); });
    /* overlays */
    $("btnEnter").addEventListener("click", () => {
      $("ovIntro").hidden = true;
      try { sessionStorage.setItem("dz-intro", "1"); } catch (e) { /* ignore */ }
      afterIntro();
    });
    $("btnAckBrief").addEventListener("click", async () => {
      const r = await post("/api/ack", { kind: "briefing" });
      if (r && r.status === 200) {
        $("ovBriefing").hidden = true;
        const resolve = briefResolve; briefResolve = null;
        if (resolve) resolve();
        showTutorial(false);
      }
    });
    $("btnTutNext").addEventListener("click", async () => {
      const steps = state.tutorial.steps;
      const nextStep = tutCur + 1;
      await post("/api/ack", { kind: "tutorial", step: nextStep });
      if (nextStep >= steps.length) {
        $("ovTut").hidden = true;
        const resolve = tutResolve; tutResolve = null;
        if (resolve) resolve();
      } else {
        tutCur = nextStep;
        fillTut();
        $("btnTutNext").focus();
      }
    });
    $("btnTutSkip").addEventListener("click", async () => {
      await post("/api/ack", { kind: "tutorial" });
      $("ovTut").hidden = true;
      const resolve = tutResolve; tutResolve = null;
      if (resolve) resolve();
    });
    $("btnBriefing").addEventListener("click", () => { if ($("ovBriefing").hidden) showBriefing(); });
    $("btnTut").addEventListener("click", () => { if ($("ovTut").hidden) showTutorial(true); });

    /* complete / seal */
    $("btnCopyFlag").addEventListener("click", async () => {
      const text = $("doneFlag").textContent;
      try {
        await navigator.clipboard.writeText(text);
        toast("Recovery token copied.", "good");
      } catch (e) {
        toast("Copy failed \u2014 select the token manually.", "bad");
      }
    });
    $("btnSeal").addEventListener("click", sealFlag);
    $("sealInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); sealFlag(); }
    });
    $("btnCloseComplete").addEventListener("click", () => { $("ovComplete").hidden = true; });

    /* reset */
    $("btnReset").addEventListener("click", () => { $("resetConfirm").hidden = false; });
    $("btnResetNo").addEventListener("click", () => { $("resetConfirm").hidden = true; });
    $("btnResetYes").addEventListener("click", async () => {
      $("resetConfirm").hidden = true;
      const r = await post("/api/reset", { confirm: true });
      if (r && r.status === 200) {
        sel = freshSel();
        fb = null;
        $("ovComplete").hidden = true;
        toast("Session wiped \u2014 budgets, progress, and advisories reset.", "good");
        render();
        /* cross-stage resets already open the briefing inside post();
           a same-stage reset keeps the current rules on screen */
        if ($("ovBriefing").hidden && briefing === null) showBriefing();
      }
    });
  }

  /* ------------------------------------------------------------ boot ----- */
  async function afterIntro() {
    await showBriefing();
    await showTutorial(false);
  }

  async function boot() {
    Audio2.init();
    updateAudioBtn();
    wire();
    UI.bind(bus);
    try {
      state = await getState();
    } catch (e) {
      document.getElementById("stageTitleEl").textContent = "ENGINE OFFLINE";
      document.getElementById("objectiveEl").textContent =
        "Could not reach the facility server. Start it with: npm start";
      return;
    }
    sel = freshSel();
    render();
    let seen = false;
    try { seen = sessionStorage.getItem("dz-intro") === "1"; } catch (e) { /* ignore */ }
    if (seen) afterIntro();
    else $("ovIntro").hidden = false;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
