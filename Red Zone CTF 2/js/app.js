/* =====================================================================
   RED ZONE // THE SILENT EDIT — app.js
   Screen router (map -> red zone -> terminal), boot sequence,
   flag submission panel, hints, telemetry.
   No expected flag exists anywhere in this file.
   ===================================================================== */
"use strict";

/* ---------------- shared helpers ---------------- */
const RZ = {
  $(sel, root) { return (root || document).querySelector(sel); },
  $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); },
  esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  },
  async api(path, opts) {
    const res = await fetch(path, Object.assign({
      headers: { "Accept": "application/json" },
      cache: "no-store"
    }, opts || {}));
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) {
      const err = new Error((data && (data.error || data.title)) || ("HTTP " + res.status));
      err.status = res.status; err.data = data;
      throw err;
    }
    return data;
  },
  flash(kind) {
    const el = RZ.$("#fx-flash");
    if (!el) return;
    el.className = "fx-flash " + kind;
    window.setTimeout(() => { el.className = "fx-flash"; }, kind === "on-red" ? 260 : 340);
  },
  store: {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
      catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ }
    }
  }
};
window.RZ = RZ;

/* ---------------- clocks ---------------- */
function tickClocks() {
  const d = new Date();
  const t = String(d.getUTCHours()).padStart(2, "0") + ":" +
            String(d.getUTCMinutes()).padStart(2, "0") + ":" +
            String(d.getUTCSeconds()).padStart(2, "0") + " UTC";
  document.querySelectorAll(".clock").forEach((el) => { el.textContent = t; });
}

/* ---------------- router: MAIN GAME -> RED ZONE -> TERMINAL ---------------- */
const SCREENS = ["map", "zone", "terminal"];
function currentScreen() {
  const h = location.hash || "#/";
  if (h.indexOf("#/terminal") === 0) return "terminal";
  if (h.indexOf("#/zone") === 0) return "zone";
  return "map";
}
function route() {
  const name = SCREENS.indexOf(currentScreen()) >= 0 ? currentScreen() : "map";
  document.body.dataset.screen = name;
  SCREENS.forEach((s) => {
    const el = document.getElementById("screen-" + s);
    if (el) el.hidden = s !== name;
  });
  if (name === "terminal" && window.Terminal) window.Terminal.ensure();
  if (name === "map") loadMapStats();
  window.scrollTo(0, 0);
}

/* ---------------- map telemetry ---------------- */
let mapLoaded = false;
async function loadMapStats() {
  if (mapLoaded) return;
  try {
    const s = await RZ.api("/api/status");
    mapLoaded = true;
    RZ.$("#st-records").textContent = s.records;
    RZ.$("#st-altered").textContent = s.altered;
    RZ.$("#st-untouched").textContent = s.untouched;
    RZ.$("#st-sig").textContent = s.signatureFailed;
    RZ.$("#st-falsified").textContent = s.falsified;
    RZ.$("#st-evidence").textContent = s.evidenceTotal;
    RZ.$("#zc-locked").textContent = s.locked;
    if (s.bySector) {
      Object.keys(s.bySector).forEach((sector) => {
        const el = document.getElementById("zc-" + sector.toLowerCase());
        if (el) el.textContent = s.bySector[sector];
      });
    }
  } catch (e) {
    mapLoaded = false;
    RZ.$("#st-records").textContent = "offline";
  }
}

/* ---------------- recovery protocol panel ---------------- */
async function loadProtocol() {
  const el = RZ.$("#proto-body");
  if (!el) return;
  try {
    const p = await RZ.api("/api/protocol");
    el.textContent = p.protocol;
  } catch (e) {
    el.textContent = "protocol unavailable — is the archive node running?";
  }
}

/* ---------------- hints ---------------- */
function revealedHints() { return RZ.store.get("rz2.hints", []); }

function addHintEntry(n, text) {
  const body = RZ.$("#hintbody");
  body.hidden = false;
  if (body.querySelector('.hentry[data-n="' + n + '"]')) return;
  body.insertAdjacentHTML("beforeend",
    '<div class="hentry" data-n="' + n + '"><b>HINT ' + n + "</b><br>" + RZ.esc(text) + "</div>");
}
function paintHintButtons(list) {
  document.querySelectorAll(".hintbtn").forEach((btn) => {
    const num = Number(btn.dataset.hint);
    const open = list.indexOf(num) >= 0;
    const locked = !open && !(num === 1 || list.indexOf(num - 1) >= 0);
    btn.classList.toggle("open", open);
    btn.classList.toggle("locked", locked);
    btn.disabled = open;
  });
}
async function revealHint(n) {
  const list = revealedHints();
  const isNew = list.indexOf(n) < 0;
  if (isNew && !(n === 1 || list.indexOf(n - 1) >= 0)) {
    const body = RZ.$("#hintbody");
    body.hidden = false;
    if (!body.querySelector(".locked-msg")) {
      body.insertAdjacentHTML("afterbegin",
        '<div class="err locked-msg">hint ' + n + " is sealed — reveal hint " + (n - 1) + " first</div>");
    }
    return false;
  }
  try {
    const data = await RZ.api("/api/hint/" + n);
    if (isNew) {
      list.push(n);
      list.sort((a, b) => a - b);
      RZ.store.set("rz2.hints", list);
      paintHintButtons(list);
    }
    addHintEntry(n, data.hint);
    if (window.Terminal) window.Terminal.print("HINT " + n + " — " + data.hint, "amb");
    return true;
  } catch (e) {
    return false;
  }
}
function hydrateHints() {
  const list = revealedHints();
  paintHintButtons(list);
  if (!list.length) return;
  const body = RZ.$("#hintbody");
  body.hidden = false;
  list.forEach((n) => {
    RZ.api("/api/hint/" + n)
      .then((d) => addHintEntry(n, d.hint))
      .catch(() => {});
  });
}

/* ---------------- flag submission (server decides) ---------------- */
async function submitFlag(raw) {
  const value = String(raw == null ? "" : raw).trim();
  const input = RZ.$("#flag-input");
  if (input && document.activeElement !== input) input.value = value;
  if (!value) return false;

  const result = RZ.$("#auth-result");
  const title = RZ.$("#auth-title");
  const lines = RZ.$("#auth-lines");
  const btn = RZ.$("#flag-submit");
  if (btn) btn.disabled = true;

  if (window.Terminal) window.Terminal.print("submit " + value, "cmd");

  try {
    const res = await RZ.api("/api/flag", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flag: value })
    });
    result.hidden = false;
    result.className = "auth-result " + (res.granted ? "granted" : "denied");
    title.textContent = res.title;
    lines.textContent = (res.lines || []).join("\n");
    RZ.flash(res.granted ? "on-ok" : "on-red");
    (res.lines || []).forEach((l) => {
      if (window.Terminal) window.Terminal.print(RZ.esc(l), res.granted ? "ok" : "err");
    });
    if (res.granted && window.Terminal) {
      window.Terminal.print("archive unlocked — recovery complete.", "ok");
      document.body.classList.add("granted");
    }
    return !!res.granted;
  } catch (e) {
    result.hidden = false;
    result.className = "auth-result denied";
    title.textContent = "CHANNEL ERROR";
    lines.textContent = "> archive node unreachable";
    return false;
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ---------------- boot sequence ---------------- */
const BOOT_LINES = [
  { t: "PRALAYA ARCHIVE NODE SEC-00 // COLD BOOT" },
  { t: "bios ....................... rz/4.11 (rev burned)", c: "amb" },
  { t: "memory check ............... 64K OK" },
  { t: "mount /data/PARENT_FINAL.csv .. 120 records .. OK", c: "ok" },
  { t: "indexing sanctuary ids ...... 120/120" },
  { t: "relationship graph .......... 360 edges" },
  { t: "signature chain ............. 23 FAILED", c: "bad" },
  { t: "integrity ................... DEGRADED", c: "amb" },
  { t: "PRALAYA daemon .............. RUNNING (unsupervised)", c: "bad" },
  { t: "red zone seal ............... BREACHED", c: "bad" },
  { t: "console ..................... READY", c: "ok" },
  { t: "" },
  { t: "type `help` for commands · `brief` for the intercepted log", c: "amb" }
];

function bootTerminal() {
  const mask = RZ.$("#bootmask");
  const log = RZ.$("#bootlog");
  if (!mask || !log) return Promise.resolve();
  mask.hidden = false;
  log.innerHTML = "";

  return new Promise((resolve) => {
    let i = 0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      mask.hidden = true;
      window.removeEventListener("keydown", skip);
      mask.removeEventListener("click", skip);
      resolve();
    };
    const skip = () => finish();
    window.addEventListener("keydown", skip, { once: true });
    mask.addEventListener("click", skip, { once: true });

    const step = () => {
      if (done) return;
      if (i >= BOOT_LINES.length) {
        window.setTimeout(finish, 420);
        return;
      }
      const l = BOOT_LINES[i++];
      const cls = l.c ? ' class="' + l.c + '"' : "";
      log.insertAdjacentHTML("beforeend", "<div" + cls + ">" + RZ.esc(l.t) + "</div>");
      window.setTimeout(step, l.t ? 90 : 30);
    };
    step();
  });
}

/* ---------------- wire up ---------------- */
document.addEventListener("DOMContentLoaded", () => {
  tickClocks();
  window.setInterval(tickClocks, 1000);

  window.addEventListener("hashchange", route);
  route();

  loadProtocol();
  hydrateHints();

  const card = RZ.$("#card-redzone");
  if (card) card.addEventListener("click", () => { location.hash = "#/zone"; });

  document.querySelectorAll(".hintbtn").forEach((btn) => {
    btn.addEventListener("click", () => revealHint(Number(btn.dataset.hint)));
  });

  const form = RZ.$("#flag-form");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      submitFlag(RZ.$("#flag-input").value);
    });
  }

  RZ.submitFlag = submitFlag;
  RZ.revealHint = revealHint;
  RZ.bootTerminal = bootTerminal;
});
