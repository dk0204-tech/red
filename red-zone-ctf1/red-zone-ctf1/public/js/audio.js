"use strict";

/* PRALAYA interface sound — tiny WebAudio synth. No files, no autoplay:
   the AudioContext is created (and resumed) on the first user gesture,
   so browsers never block. State is remembered per-tab. */

(function () {
  var ctx = null;
  var unlocked = false;
  var enabled = true;

  try {
    enabled = sessionStorage.getItem("pralaya.sound") !== "0";
  } catch (err) {
    enabled = true;
  }

  function unlock() {
    if (unlocked) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      unlocked = true;
      if (ctx.state === "suspended") ctx.resume();
    } catch (err) {
      ctx = null;
    }
  }

  ["pointerdown", "keydown"].forEach(function (evt) {
    document.addEventListener(evt, unlock, { once: true, passive: true });
  });

  function tone(freq, opts) {
    if (!enabled || !ctx) return;
    var o = opts || {};
    var t0 = ctx.currentTime + (o.delay || 0);
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = o.type || "sine";
    osc.frequency.setValueAtTime(freq, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + (o.dur || 0.1));
    var vol = o.vol || 0.03;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + (o.dur || 0.1));
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + (o.dur || 0.1) + 0.03);
  }

  var SOUNDS = {
    tick: function () { tone(1180, { type: "square", dur: 0.03, vol: 0.012 }); },
    ok: function () {
      tone(660, { type: "sine", dur: 0.07, vol: 0.03 });
      tone(880, { type: "sine", dur: 0.09, vol: 0.03, delay: 0.07 });
    },
    warn: function () { tone(430, { type: "triangle", dur: 0.12, vol: 0.03 }); },
    err: function () { tone(210, { type: "sawtooth", dur: 0.17, vol: 0.035, to: 150 }); },
    discover: function () {
      tone(740, { type: "triangle", dur: 0.08, vol: 0.035 });
      tone(1110, { type: "triangle", dur: 0.14, vol: 0.035, delay: 0.08 });
    },
    recover: function () {
      [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) {
        tone(f, { type: "sine", dur: 1.3, vol: 0.045, delay: i * 0.12 });
      });
      tone(261.6, { type: "sine", dur: 1.6, vol: 0.04, delay: 0.1 });
    },
  };

  window.PRALAYA_AUDIO = {
    play: function (name) {
      if (!enabled || !ctx) return;
      var fn = SOUNDS[name];
      if (fn) {
        try { fn(); } catch (err) { /* audio is decoration */ }
      }
    },
    toggle: function () {
      enabled = !enabled;
      try { sessionStorage.setItem("pralaya.sound", enabled ? "1" : "0"); } catch (err) {}
      return enabled;
    },
    isEnabled: function () { return enabled; },
  };
})();
