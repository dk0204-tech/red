"use strict";

/* PRALAYA entry page — restrained boot / signal-recovery sequence.
 *
 * Atmosphere only. The lines below deliberately contain no puzzle data,
 * no field names, no endpoint names, no ids and no secrets: they foreshadow
 * the terminal's condition, nothing more.
 *
 * Behaviour: typed boot log with a load bar -> reveal. Skippable at any
 * point (button or ENTER); remembered per-tab so a re-visit starts at the
 * reveal. Honours prefers-reduced-motion by rendering the final state
 * immediately. When revealed, ENTER continues into the archive.
 */

(function () {
  var LINES = [
    { text: "[00.004] initializing archive node ............... OK", tone: "ok" },
    { text: "[00.019] memory index ............................ OK", tone: "ok" },
    { text: "[00.036] establishing local connection ........... OK  node: RED-ZONE-04", tone: "ok" },
    { text: "[00.058] mounting record store .................. PARTIAL", tone: "warn" },
    { text: "[00.086] shard sweep: 1,041 objects unrecoverable", tone: "err" },
    { text: "[00.118] archive integrity ...................... 71.4%", tone: "warn" },
    { text: "[00.146] network status ........................ DEGRADED", tone: "warn" },
    { text: "[00.174] custodian status ....................... UNKNOWN", tone: "warn" },
    { text: "[00.202] last sync .............................. 184 days ago", tone: "warn" },
    { text: "[00.230] staff endpoints ........................ UNVERIFIED", tone: "warn" },
    { text: "[00.244] buffer [████████████████████░░] 91%", tone: "ok", bar: true },
    { text: "[00.281] carrier lock acquired — signal stable", tone: "ok" },
    { text: "WARNING: this terminal is not registered to", tone: "err" },
    { text: "         the current archive authority.", tone: "err" },
  ];

  var TICK_MS = 16;          /* log refresh interval */
  var CHARS_PER_TICK = 14;   /* ~875 chars/sec — fast terminal print */
  var GAP_TICKS = 3;         /* ~50ms between lines */
  var FINISH_PAUSE_TICKS = 20; /* brief hold before the reveal (~320ms) */

  var logEl = document.getElementById("boot-log");
  var revealEl = document.getElementById("hero-reveal");
  var skipBtn = document.getElementById("boot-skip");
  if (!logEl || !revealEl || !skipBtn) return;

  var reduced =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var seen = false;
  try {
    seen = sessionStorage.getItem("pralaya.boot.seen") === "1";
  } catch (err) {
    seen = false;
  }

  var timer = null;
  var done = false;

  function remember() {
    try {
      sessionStorage.setItem("pralaya.boot.seen", "1");
    } catch (err) {
      /* storage unavailable — skip control still works */
    }
  }

  function buildLine(line) {
    var div = document.createElement("div");
    div.className = "boot-line tone-" + line.tone;
    div.textContent = line.text;
    if (line.bar) div.className += " boot-bar";
    return div;
  }

  function showAllLines() {
    logEl.textContent = "";
    for (var i = 0; i < LINES.length; i++) {
      logEl.appendChild(buildLine(LINES[i]));
    }
  }

  function finish(instant) {
    if (done) return;
    done = true;
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    showAllLines(); /* completes any partially typed line */
    /* capture focus BEFORE hiding the skip control — hiding drops focus to body */
    var hadFocus = document.activeElement === skipBtn;
    skipBtn.hidden = true;
    revealEl.hidden = false;
    if (instant || reduced) {
      revealEl.classList.add("shown");
    } else {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          revealEl.classList.add("shown");
        });
      });
    }
    remember();
    if (hadFocus) {
      var cta = revealEl.querySelector(".hero-cta");
      if (cta) cta.focus();
    }
  }

  /* ENTER: skip the sequence, or continue into the archive once revealed */
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!done) {
      finish(true);
      return;
    }
    var ae = document.activeElement;
    if (!ae || ae === document.body || ae === skipBtn) {
      window.location.href = "/archive";
    }
  });

  skipBtn.addEventListener("click", function () {
    finish(true);
  });

  if (reduced || seen) {
    finish(true);
    return;
  }

  /* ---- animated boot sequence ---- */

  var cursor = document.createElement("span");
  cursor.className = "cursor";

  var lineIdx = 0;
  var charIdx = 0;
  var gapLeft = 5;      /* short beat before the first line */
  var holdLeft = 0;
  var current = null;

  function tick() {
    if (done) return;

    if (holdLeft > 0) {
      holdLeft -= 1;
      if (holdLeft === 0) finish(false);
      return;
    }
    if (gapLeft > 0) {
      gapLeft -= 1;
      return;
    }
    if (lineIdx >= LINES.length) {
      holdLeft = FINISH_PAUSE_TICKS;
      return;
    }

    if (current === null) {
      current = buildLine({ text: "", tone: LINES[lineIdx].tone });
      logEl.appendChild(current);
      logEl.appendChild(cursor);
    }

    var line = LINES[lineIdx];
    var step = line.bar ? 1 : CHARS_PER_TICK;
    var full = line.text;
    charIdx = Math.min(full.length, charIdx + step);
    current.textContent = full.slice(0, charIdx);
    logEl.appendChild(cursor); /* keep the cursor at the tail */

    if (charIdx >= full.length) {
      lineIdx += 1;
      charIdx = 0;
      current = null;
      gapLeft = GAP_TICKS;
    }
  }

  logEl.appendChild(cursor);
  timer = setInterval(tick, TICK_MS);
})();
