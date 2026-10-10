/* ============================================================================
   audio.js — synthesized console audio. Muted by default, opt-in only.
   No files, no network: everything is WebAudio oscillators/noise.
   ========================================================================== */
"use strict";

window.Audio2 = (function () {
  var ctx = null;
  var master = null;
  var humNodes = [];
  var enabled = false;           /* persisted preference, default OFF */
  var reduced = false;

  function ensureCtx() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);
    } catch (e) { ctx = null; }
    return ctx;
  }

  function applyGain() {
    if (!ctx || !master) return;
    var target = enabled ? 0.5 : 0;
    try {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(target, ctx.currentTime, 0.08);
    } catch (e) { master.gain.value = target; }
  }

  function startHum() {
    if (!ctx || humNodes.length) return;
    /* low dual-tone reactor hum, very quiet */
    [55, 55.7].forEach(function (f, i) {
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.type = "sawtooth";
      o.frequency.value = f;
      g.gain.value = i === 0 ? 0.05 : 0.035;
      var lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 160;
      o.connect(lp); lp.connect(g); g.connect(master);
      o.start();
      humNodes.push(o, g, lp);
    });
  }

  function blip(freq, dur, type, vol) {
    if (!enabled || !ensureCtx()) return;
    try {
      if (ctx.state === "suspended") ctx.resume();
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.type = type || "square";
      o.frequency.value = freq;
      g.gain.value = 0;
      o.connect(g); g.connect(master);
      var t = ctx.currentTime;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol || 0.22, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.12));
      o.start(t);
      o.stop(t + (dur || 0.12) + 0.03);
    } catch (e) { /* audio is cosmetic; never break the UI */ }
  }

  function noiseBurst(dur, vol, cutoff) {
    if (!enabled || !ensureCtx()) return;
    try {
      var len = Math.floor(ctx.sampleRate * (dur || 0.25));
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      var src = ctx.createBufferSource();
      src.buffer = buf;
      var f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = cutoff || 900;
      var g = ctx.createGain();
      g.gain.value = vol || 0.18;
      src.connect(f); f.connect(g); g.connect(master);
      src.start();
    } catch (e) { /* ignore */ }
  }

  var api = {
    /** Read persisted preference (never enabled by default). */
    init: function () {
      reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
      try { enabled = localStorage.getItem("dz-audio") === "1"; } catch (e) { enabled = false; }
      if (enabled && ensureCtx()) { applyGain(); startHum(); }
      return enabled;
    },
    isEnabled: function () { return enabled; },
    toggle: function () {
      enabled = !enabled;
      try { localStorage.setItem("dz-audio", enabled ? "1" : "0"); } catch (e) { /* private mode */ }
      if (enabled && ensureCtx()) {
        if (ctx.state === "suspended") ctx.resume();
        applyGain();
        startHum();
      } else {
        applyGain();
      }
      return enabled;
    },
    /* ---- feedback cues ---- */
    select: function () { blip(660, 0.06, "square", 0.12); },
    confirm: function () { blip(520, 0.07, "sine", 0.16); blip(780, 0.1, "sine", 0.14); },
    deny: function () { blip(170, 0.16, "sawtooth", 0.2); },
    stageUp: function () {
      if (!enabled) return;
      blip(392, 0.1, "sine", 0.16);
      setTimeout(function () { blip(523, 0.1, "sine", 0.16); }, 110);
      setTimeout(function () { blip(659, 0.16, "sine", 0.18); }, 220);
      noiseBurst(0.4, 0.05, 400);
    },
    restore: function () {
      if (!enabled) return;
      if (reduced) { blip(523, 0.2, "sine", 0.16); return; }
      noiseBurst(1.4, 0.1, 300);
      [261, 329, 392, 523, 659].forEach(function (f, i) {
        setTimeout(function () { blip(f, 0.28, "triangle", 0.14); }, i * 260);
      });
    }
  };
  return api;
})();
