/* =====================================================================
   RED ZONE // THE SILENT EDIT — terminal.js
   Interactive archive console. Every command hits the backend API;
   responses are rendered live from PARENT_FINAL.csv via the server.
   No answers and no expected flag exist in this file.
   ===================================================================== */
"use strict";

/* ---------------- sha-256 (offline helper for `hash`) ---------------- */
const K256 = [
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
];
function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
function sha256Hex(str) {
  const bytes = new TextEncoder().encode(String(str));
  const len = bytes.length;
  const total = Math.ceil((len + 9) / 64) * 64;
  const buf = new Uint8Array(total);
  buf.set(bytes);
  buf[len] = 0x80;
  const view = new DataView(buf.buffer);
  const bits = len * 8;
  view.setUint32(total - 8, Math.floor(bits / 4294967296));
  view.setUint32(total - 4, bits >>> 0);
  const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const w = new Int32Array(64);
  for (let off = 0; off < total; off += 64) {
    let t;
    for (t = 0; t < 16; t++) w[t] = view.getUint32(off + t * 4);
    for (t = 16; t < 64; t++) {
      const a15 = w[t - 15], a2 = w[t - 2];
      w[t] = (w[t - 16] + (rotr(a15,7) ^ rotr(a15,18) ^ (a15 >>> 3)) +
                   w[t - 7] + (rotr(a2,17) ^ rotr(a2,19) ^ (a2 >>> 10))) | 0;
    }
    let a=h[0],b=h[1],c=h[2],d=h[3],e=h[4],f=h[5],g=h[6],hh=h[7];
    for (t = 0; t < 64; t++) {
      const S1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K256[t] + w[t]) | 0;
      const S0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22);
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) | 0;
      hh=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0;
    }
    h[0]=(h[0]+a)|0; h[1]=(h[1]+b)|0; h[2]=(h[2]+c)|0; h[3]=(h[3]+d)|0;
    h[4]=(h[4]+e)|0; h[5]=(h[5]+f)|0; h[6]=(h[6]+g)|0; h[7]=(h[7]+hh)|0;
  }
  let out = "";
  for (let i = 0; i < 8; i++) out += (h[i] >>> 0).toString(16).padStart(8, "0");
  return out;
}

/* ---------------- rendering ---------------- */
const esc = (s) => RZ.esc(s);
let out, input, form;
const history = [];
let histIdx = -1;
let booted = false;
let busy = false;

function pad(s, n) {
  s = String(s == null ? "" : s);
  return s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n);
}
function leader(label, value) {
  return (label + " ").padEnd(19, ".") + " " + value;
}
function scrollBottom() { if (out) out.scrollTop = out.scrollHeight; }
function caret() {
  if (!out) return;
  out.querySelectorAll(".live").forEach((el) => el.classList.remove("live"));
  if (out.lastElementChild) out.lastElementChild.classList.add("live");
  scrollBottom();
}
function print(text, cls) {
  if (!out) return;
  const el = document.createElement("div");
  el.className = "line" + (cls ? " " + cls : "");
  el.textContent = String(text);
  out.appendChild(el);
  caret();
}
function printHtml(html, cls) {
  if (!out) return;
  const el = document.createElement("div");
  el.className = "line" + (cls ? " " + cls : "");
  el.innerHTML = html;
  out.appendChild(el);
  caret();
}
function rule(ch) { print(new Array(58).join(ch || "─"), "rule"); }
function banner(t) { printHtml('<span class="k">' + esc(t) + "</span>", "banner"); }
function err(msg) { print("> " + msg, "err"); }
function waiting() {
  const el = document.createElement("div");
  el.className = "line diml";
  el.textContent = "··· querying archive";
  out.appendChild(el);
  scrollBottom();
  return el;
}
function shortStatus(s) {
  return s === "IDENTITY_VERIFIED" ? "VERIFIED" : s === "PARTIALLY_RECONSTRUCTED" ? "PARTIAL" : s || "—";
}

/* ---------------- api with friendly errors ---------------- */
async function call(path, waitEl) {
  try {
    const data = await RZ.api(path);
    if (waitEl) waitEl.remove();
    return data;
  } catch (e) {
    if (waitEl) waitEl.remove();
    if (e.data && e.data.hint) err(e.data.hint);
    else if (e.data && e.data.error) err("archive refused: " + e.data.error);
    else err("archive unreachable — is the node running? (npm start)");
    return null;
  }
}

/* ---------------- commands ---------------- */
const COMMANDS = {
  help() {
    banner("AVAILABLE COMMANDS");
    [
      ["status", "archive telemetry"],
      ["brief", "intercepted maintenance log — the rules"],
      ["protocol", "recovery key format"],
      ["list [page|all]", "roster pages"],
      ["probe <SANCTUARY_ID>", "compact record profile"],
      ["inspect <SANCTUARY_ID>", "all 26 fields of a record"],
      ["relations <SANCTUARY_ID>", "linked triad"],
      ["evidence <SANCTUARY_ID>", "evidence & provenance"],
      ["recover <SANCTUARY_ID>", "identity reconstruction"],
      ["search <TERM>", "full-text archive search"],
      ["hash <TEXT>", "sha256 hex digest"],
      ["hint [1-3]", "progressive hints"],
      ["submit <FLAG>", "submit a recovery signature"],
      ["clear", "wipe the console"],
      ["boot", "replay boot sequence"]
    ].forEach(([c, d]) => print(pad(c, 26) + " " + d));
    print("");
    print("start with: brief · then probe/list/search the archive", "diml");
  },

  async status() {
    const w = waiting();
    const s = await call("/api/status", w);
    if (!s) return;
    banner("ARCHIVE STATUS // " + s.service);
    print(leader("dataset", s.dataset));
    print(leader("records", s.records));
    print(leader("altered by pralaya", s.altered));
    print(leader("untouched", s.untouched));
    print(leader("signature failures", s.signatureFailed));
    print(leader("falsified to protect", s.falsified));
    print(leader("record status", "verified " + s.verified + " · partial " + s.partial + " · locked " + s.locked));
    print(leader("alteration types", Object.keys(s.alterationTypes).map((k) => k + " " + s.alterationTypes[k]).join(" · ")));
    print(leader("evidence fragments", s.evidenceTotal));
  },

  async brief() {
    const w = waiting();
    const b = await call("/api/brief", w);
    if (!b) return;
    banner("INTERCEPTED MAINTENANCE LOG");
    printHtml(esc(b.log).replace(/\n/g, "<br>"));
  },

  async protocol() {
    const w = waiting();
    const p = await call("/api/protocol", w);
    if (!p) return;
    banner("RECOVERY PROTOCOL");
    printHtml(esc(p.protocol).replace(/\n/g, "<br>"));
  },

  async list(args) {
    const all = /^all$/i.test(args || "");
    const page = all ? 1 : Number(args || "1");
    if (!all && (!Number.isInteger(page) || page < 1)) { err("usage: list [1..8 | all]"); return; }
    const w = waiting();
    const data = await call(all ? "/api/list?all=1" : "/api/list?page=" + page, w);
    if (!data) return;
    banner(all ? "ROSTER — ALL " + data.total + " RECORDS" : "ROSTER — PAGE " + data.page + "/" + data.pages + " (" + data.rows.length + " of " + data.total + ")");
    print(pad("ID", 6) + pad("NAME", 18) + pad("SECTOR", 15) + pad("STATUS", 10) + pad("ALTERATION", 19) + "SIG", "diml");
    data.rows.forEach((r) => {
      print(pad(r.id, 6) + pad(r.name, 18) + pad(r.sector, 15) + pad(shortStatus(r.status), 10) + pad(r.alteration, 19) + r.signature);
    });
    if (!all && data.pages > 1) print("next: list " + (data.page + 1 <= data.pages ? data.page + 1 : 1) + "  ·  everything: list all", "diml");
  },

  async search(args) {
    const term = String(args || "").trim();
    if (!term) { err("usage: search <TERM>  — name, id, occupation, sector, alteration, case id…"); return; }
    const w = waiting();
    const data = await call("/api/search?q=" + encodeURIComponent(term), w);
    if (!data) return;
    banner("SEARCH \"" + term + "\" — " + data.count + " hit(s)");
    data.hits.forEach((h) => {
      print(pad(h.id, 6) + pad(h.name, 20) + pad(shortStatus(h.status), 10) + "matched: " + h.matched.join(", "));
    });
    if (data.truncated) print("result truncated — refine the term", "diml");
  },

  async probe(args) {
    const id = String(args || "").trim();
    if (!id) { err("usage: probe <SANCTUARY_ID>   e.g. probe S001"); return; }
    const w = waiting();
    const d = await call("/api/record/" + encodeURIComponent(id), w);
    if (!d) return;
    banner(d.id + "  " + d.name);
    print(leader("occupation", d.occupation));
    print(leader("status", d.status));
    print(leader("sector", d.sector));
    print(leader("standing", d.standing));
    print(leader("provenance", d.provenance.vault + " · " + d.provenance.manifest + " · " + d.provenance.medical));
    print(leader("journal", "transfer " + d.journal.transfer));
    print("                     access " + d.journal.access + " · " + d.journal.reason, "diml");
    print(leader("recovery", d.recovery.level + " · score " + d.recovery.score));
    print(leader("alteration", d.alteration.type + " · flag " + d.alteration.flag));
    print("                     signature " + d.alteration.signature + " · authenticity " + d.alteration.authenticity + " · falsified " + d.alteration.falsified, "diml");
  },

  async inspect(args) {
    const id = String(args || "").trim();
    if (!id) { err("usage: inspect <SANCTUARY_ID>"); return; }
    const w = waiting();
    const d = await call("/api/record/" + encodeURIComponent(id) + "/inspect", w);
    if (!d) return;
    banner("RAW RECORD " + d.id + " — ALL FIELDS");
    Object.keys(d.fields).forEach((k) => print(pad(k, 32) + d.fields[k]));
  },

  async relations(args) {
    const id = String(args || "").trim();
    if (!id) { err("usage: relations <SANCTUARY_ID>"); return; }
    const w = waiting();
    const d = await call("/api/record/" + encodeURIComponent(id) + "/relations", w);
    if (!d) return;
    banner(d.id + " — " + d.name + " · degree " + d.degree);
    print(pad("ID", 6) + pad("NAME", 18) + pad("SECTOR", 15) + pad("STATUS", 10) + pad("ALTERATION", 19) + pad("SIG", 6) + "EVID", "diml");
    d.links.forEach((l) => {
      if (l.missing) { print(pad(l.id, 6) + "<missing link>", "err"); return; }
      print(pad(l.id, 6) + pad(l.name, 18) + pad(l.sector, 15) + pad(shortStatus(l.status), 10) + pad(l.alteration, 19) + pad(l.signature, 6) + l.evidence);
    });
  },

  async evidence(args) {
    const id = String(args || "").trim();
    if (!id) { err("usage: evidence <SANCTUARY_ID>"); return; }
    const w = waiting();
    const d = await call("/api/record/" + encodeURIComponent(id) + "/evidence", w);
    if (!d) return;
    banner("EVIDENCE — " + d.id + " " + d.name);
    print(leader("fragments", d.fragments));
    print(leader("authenticity", d.authenticity));
    print(leader("signature", d.signature));
    print(leader("altered", d.altered + " · " + d.alteration));
    print(leader("falsified to protect", d.falsified));
    print(leader("access log", d.access));
    print(leader("provenance", d.vault + " · " + d.manifest + " · " + d.medical));
  },

  async recover(args) {
    const id = String(args || "").trim();
    if (!id) { err("usage: recover <SANCTUARY_ID>"); return; }
    const w = waiting();
    const d = await call("/api/record/" + encodeURIComponent(id) + "/recover", w);
    if (!d) return;
    banner("RECONSTRUCTION — " + d.id + " " + d.name);
    print(leader("level", d.level + " · score " + d.score));
    print(leader("status", d.status));
    print(leader("mapping confidence", d.mappingConfidence));
    print(leader("previous identifier", d.previous || "none on file"));
    print(leader("ml prediction", d.mlPrediction.occupation + " (" + d.mlPrediction.confidence + ")"));
    print(leader("true occupation", d.trueOccupation));
    if (d.occupationMismatch) print("  ml disagrees with the original record", "amb");
  },

  async hint(args) {
    let n = Number(String(args || "").trim());
    if (!n) {
      const rev = RZ.store.get("rz2.hints", []);
      n = [1, 2, 3].find((x) => rev.indexOf(x) < 0) || 0;
      if (!n) { err("all hints already revealed"); return; }
    }
    if (!(n >= 1 && n <= 3)) { err("usage: hint [1-3]"); return; }
    await RZ.revealHint(n);
  },

  async submit(args) {
    const value = String(args || "").trim();
    if (!value) { err("usage: submit RZ{<32 hex chars>}"); return; }
    await RZ.submitFlag(value);
  },

  hash(args) {
    const text = String(args || "");
    if (!text) { err("usage: hash <TEXT>   sha256 hex digest"); return; }
    banner("SHA-256");
    print("input  " + (text.length > 60 ? text.slice(0, 57) + "..." : text), "diml");
    print("digest " + sha256Hex(text));
  },

  async clear() {
    if (!out) return;
    out.innerHTML = "";
    print("console wiped.", "diml");
  },

  async boot() {
    if (input) input.disabled = true;
    await RZ.bootTerminal();
    if (input) input.disabled = false;
    bannerHead();
  }
};

/* ---------------- dispatch ---------------- */
async function run(rawCmd) {
  const raw = String(rawCmd || "").trim();
  if (!raw) return;
  print(raw, "cmd");
  history.push(raw);
  if (history.length > 80) history.shift();
  histIdx = history.length;

  const m = raw.match(/^(\S+)\s*([\s\S]*)$/);
  const name = (m ? m[1] : raw).toLowerCase();
  const args = m ? m[2].trim() : "";
  const fn = COMMANDS[name];
  if (!fn) { err("unknown command: " + name + " — type `help`"); return; }
  if (busy) return;
  busy = true;
  if (input) input.disabled = true;
  try {
    await fn(args);
  } catch (e) {
    err("command failed: " + (e && e.message ? e.message : e));
  } finally {
    busy = false;
    if (input) { input.disabled = false; input.focus(); }
    caret();
  }
}

/* ---------------- terminal lifecycle ---------------- */
function bannerHead() {
  banner("=== PRALAYA ARCHIVE // RED ZONE CONSOLE ===");
  print("dataset PARENT_FINAL.csv · 120 records · read-only", "diml");
  print("intercepted rules: `brief`  ·  key format: `protocol`  ·  commands: `help`", "diml");
  print("");
}

async function ensure() {
  if (booted) { if (input) input.focus(); return; }
  booted = true;
  out = RZ.$("#term-out");
  form = RZ.$("#term-form");
  input = RZ.$("#term-in");
  if (!out || !form || !input) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = input.value;
    input.value = "";
    run(v);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!history.length) return;
      histIdx = Math.max(0, histIdx - 1);
      input.value = history[histIdx] || "";
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      histIdx = Math.min(history.length, histIdx + 1);
      input.value = history[histIdx] || "";
    }
  });
  out.addEventListener("click", () => input.focus());

  input.disabled = true;
  await RZ.bootTerminal();
  input.disabled = false;
  bannerHead();
  input.focus();
}

window.Terminal = { ensure, print, printHtml, run, sha256Hex };
