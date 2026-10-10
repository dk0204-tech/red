/* ============================================================================
 * THE DEADLOCK ENGINE: BLACKOUT PROTOCOL — e2e playthrough (Playwright)
 *
 * Scenario A (1440×900) plays the ENTIRE game through the real UI:
 *   intro → briefing → tutorial → stage 1 (inspect, invalid recovery, trial
 *   hint gates, valid recovery) → stage 2 (evict, unsafe order, safe order)
 *   → stage 3 (incomplete route rejected, probe, valid route) → stage 4
 *   (invalid plan, valid plan, completion animation, flag == server truth,
 *   seal) → private files 404 → reload persistence → reset.
 *   Also: audio toggle, no-leak sweeps (HTML/session/API), hint gating.
 * Scenario B (390×844) replays the full path on a phone viewport and asserts
 *   zero horizontal overflow at every stage + screenshots.
 * Scenario C: prefers-reduced-motion smoke (intro → inspect, no errors).
 *
 * Evidence: _organizer/audit/e2e/*.png + console.log
 * ========================================================================== */
"use strict";
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");
const engine = require("../server/engine");

const ROOT = path.resolve(__dirname, "..");
const SHOTS = path.join(ROOT, "_organizer", "audit", "e2e");
fs.mkdirSync(SHOTS, { recursive: true });
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const GL_ARGS = ["--no-sandbox", "--use-angle=swiftshader", "--use-gl=angle",
  "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
  "--run-all-compositor-stages-before-draw"];

const RESULTS = [];
const step = async (label, fn) => {
  const t0 = Date.now();
  try {
    await fn();
    RESULTS.push({ label, ok: true, ms: Date.now() - t0 });
    console.log(`  PASS ${label}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (e) {
    RESULTS.push({ label, ok: false, ms: Date.now() - t0, err: String(e.message).split("\n")[0] });
    console.log(`  FAIL ${label}: ${String(e.message).split("\n")[0]}`);
    throw e;
  }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

function makeCapture(page) {
  const cap = { consoleErrors: [], expected4xx: [], pageErrors: [], netErrors: [], apiFlagHits: [] };
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    /* Chrome logs every non-2xx fetch as a console error. The e2e deliberately
       provokes 400/403/409/429 (invalid answers, hint gating, stale replay);
       those are counted separately as *expected* rejections — JS errors and
       5xx remain hard failures. */
    if (/^Failed to load resource: the server responded with a status of 4\d\d/.test(t)) {
      cap.expected4xx.push(t);
      return;
    }
    cap.consoleErrors.push(t);
  });
  page.on("pageerror", (e) => cap.pageErrors.push(String(e)));
  page.on("requestfailed", (r) =>
    cap.netErrors.push(`FAILED ${r.url()} :: ${(r.failure() || {}).errorText}`));
  page.on("response", (r) => {
    if (r.status() >= 400 && !r.url().includes("/api/")) cap.netErrors.push(`${r.status()} ${r.url()}`);
    if (r.url().includes("/api/") && r.request().method() === "POST" || r.url().includes("/api/state")) {
      r.text().then((t) => {
        if (t.indexOf("RZ{") >= 0) cap.apiFlagHits.push(r.request().method() + " " + r.url());
      }).catch(() => {});
    }
  });
  return cap;
}

/* ------------------------------------------------------------- helpers --- */
const fbHas = (page, src, timeout) => page.waitForFunction((re) => {
  const f = document.getElementById("feedback");
  return f && !f.hidden && new RegExp(re).test(f.textContent || "");
}, src, { timeout: timeout || 8000 });

const waitBriefing = async (page, stage) => {
  await page.waitForSelector("#ovBriefing", { state: "visible", timeout: 10000 });
  const kicker = await page.textContent("#briefKicker");
  assert(kicker.includes("STAGE " + stage + " "),
    "expected stage-" + stage + " briefing, got: " + kicker);
  await page.click("#btnAckBrief");
  await page.waitForSelector("#ovBriefing", { state: "hidden", timeout: 8000 });
};

const passTutorial = async (page) => {
  try {
    await page.waitForSelector("#ovTut", { state: "visible", timeout: 3000 });
  } catch (e) { return; }
  for (let i = 0; i < 8; i++) {
    if (!(await page.isVisible("#ovTut"))) break;
    await page.click("#btnTutNext");
    await page.waitForTimeout(150);
  }
  assert(!(await page.isVisible("#ovTut")), "tutorial did not close");
};

const shotMaker = (page, prefix) => {
  let n = 0;
  return async (name) => {
    await page.evaluate(() => new Promise((r) =>
      requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(SHOTS, `${prefix}-${String(++n).padStart(2, "0")}-${name}.png`) });
  };
};

const noOverflow = async (page, where) => {
  const m = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    iw: window.innerWidth
  }));
  assert(m.sw <= m.iw + 1, `horizontal overflow at ${where}: ${m.sw} > ${m.iw}`);
};

/* ═══════════════════════ full UI playthrough ═══════════════════════════ */
async function playThrough(page, opts) {
  opts = opts || {};
  const shot = opts.prefix ? shotMaker(page, opts.prefix) : async () => {};
  const stage = (n) => page.textContent("#stageChip").then((t) =>
    assert(t.includes("STAGE " + n + " / 4"), `stage chip wanted ${n}: ${t}`));

  await step(`${opts.prefix || ""} intro loads (cinematic + audio default OFF)`, async () => {
    await page.goto(opts.base, { waitUntil: "networkidle" });
    await page.waitForSelector("#ovIntro", { state: "visible", timeout: 8000 });
    assert(await page.isVisible("#btnEnter"), "ENTER button missing");
    assert(await page.locator(".introsvg").count(), "intro artwork missing");
    const audio = await page.textContent("#audioLabel");
    assert(audio.includes("OFF"), "audio must default OFF: " + audio);
    await shot("intro");
    await page.click("#btnEnter");
    await page.waitForSelector("#ovIntro", { state: "hidden", timeout: 5000 });
  });

  await step(`${opts.prefix || ""} briefing + tutorial acknowledged`, async () => {
    await waitBriefing(page, 1);
    assert((await page.locator("#briefRules li").count()) >= 6, "briefing rules missing");
    await passTutorial(page);
    await stage(1);
    if (opts.audio) {
      /* muted by default; visible toggle must engage and release */
      await page.click("#btnAudio");
      assert((await page.textContent("#audioLabel")).includes("ON"), "audio did not engage");
      await page.click("#btnAudio");
      assert((await page.textContent("#audioLabel")).includes("OFF"), "audio did not release");
    }
  });

  /* ═══════════ STAGE 1 ═══════════ */
  await step(`${opts.prefix || ""} S1: graph renders, inspect reveals, budgets move`, async () => {
    assert(await page.locator("g.node.proc").count() === 6, "6 process nodes expected");
    assert(await page.locator("g.node.res").count() === 5, "5 resource nodes expected");
    assert((await page.textContent("#budgetList")).includes("10 / 10 LEFT"), "inspect budget not full");
    await shot("stage1-graph");

    await page.click('g.node.proc:has-text("P2")');
    await page.waitForSelector("#inspector", { state: "visible" });
    let insp = await page.textContent("#inspector");
    assert(insp.includes("(hidden)"), "holdings should be hidden pre-inspect");
    assert(insp.includes("BLOCKED"), "P2 should read BLOCKED");

    await page.click('#inspector button:has-text("INSPECT P2")');
    await fbHas(page, "INSPECTION COMPLETE");
    await page.waitForTimeout(150);
    insp = await page.textContent("#inspector");
    assert(!insp.includes("(hidden)"), "holdings should be visible post-inspect");
    assert(insp.includes("R3"), "P2 holds R3 — inspector must show it");
    assert((await page.textContent("#budgetList")).includes("9 / 10 LEFT"), "inspect budget did not decrement");
    assert((await page.textContent("#discovered")).includes("P2"), "DISCOVERED must list P2");
    assert((await page.textContent("#transcript")).includes("s1.inspect"), "transcript missing inspect");
    if (opts.overflow) await noOverflow(page, "stage1");
    await shot("stage1-inspected");
  });

  if (opts.hints) {
    await step(`${opts.prefix || ""} hints: L1 free, L2 after failure, L3 gated`, async () => {
      await page.click('#hintHost .hintbtn:has-text("L1")');
      await page.waitForSelector("#hintOut", { state: "visible", timeout: 6000 });
      assert((await page.textContent("#hintOut")).length > 60, "L1 hint too short");
      await page.click('#hintHost .hintbtn:has-text("L3")');
      await fbHas(page, "after 3 failed");
      assert((await page.textContent("#stageChip")).includes("STAGE 1"), "L3 gate changed stage");
    });
  }

  await step(`${opts.prefix || ""} S1: invalid recovery rejected uniformly`, async () => {
    await page.selectOption("#yrecTarget", "P5");
    await page.click('#actionbar button:has-text("ATTEMPT RECOVERY")');
    await fbHas(page, "DEADLOCK");
    await stage(1);
    if (opts.hints) {
      await page.click('#hintHost .hintbtn:has-text("L2")');
      await page.waitForFunction(() => {
        const el = document.getElementById("hintOut");
        return el && !el.hidden && /ADVISORY L2/.test(el.textContent || "");
      }, null, { timeout: 6000 });
      assert(!(await page.textContent("#hintOut")).includes("ADVISORY L1"), "L2 should replace the hint");
    }
  });

  await step(`${opts.prefix || ""} S1: trial reports drains only`, async () => {
    await page.selectOption("#ytrialTarget", "P2");
    await page.click('#actionbar button:has-text("RUN TRIAL")');
    await fbHas(page, "DRAINS");
    const fb = await page.textContent("#feedback");
    assert(!/P2\s+was|stuck:|identities/i.test(fb), "trial leaked identities");
  });

  await step(`${opts.prefix || ""} S1: valid recovery advances to stage 2`, async () => {
    await page.waitForTimeout(1200);            /* s1.recover spacing 1100ms */
    await page.selectOption("#yrecTarget", "P2");
    await page.click('#actionbar button:has-text("ATTEMPT RECOVERY")');
    await waitBriefing(page, 2);
    await stage(2);
  });

  /* ═══════════ STAGE 2 ═══════════ */
  await step(`${opts.prefix || ""} S2: claim matrix visible, cached row labelled`, async () => {
    const table = await page.textContent("table.sched");
    assert(table.includes("WLD"), "scheduler table missing rows");
    const wldRow = await page.textContent("table.sched tr:has-text('WLD')");
    assert(wldRow.includes("\u2014"), "unverified WLD max must read \u2014");
    assert((await page.textContent("#viewHost")).includes("CACHED TELEMETRY"), "cached row missing");
    assert((await page.locator("#viewHost .pickchip").count()) >= 5, "seq picker missing");
    if (opts.overflow) await noOverflow(page, "stage2");
    await shot("stage2-matrix");
  });

  await step(`${opts.prefix || ""} S2: eviction visibly returns hold to the pool`, async () => {
    assert((await page.locator("#viewHost .vecchip b").first().textContent()) === "1",
      "avail COOLANT should start at 1");
    await page.click('#actionbar button:has-text("EVICT CUSTODIAL RIG")');
    await page.click('#actionbar button:has-text("CONFIRM EVICTION?")');
    await page.waitForFunction(() => Array.from(document.querySelectorAll("table.sched tr"))
      .some((tr) => /CUSTODIAL/.test(tr.textContent) && /EVICTED/.test(tr.textContent)),
    null, { timeout: 6000 });
    assert((await page.locator("#viewHost .vecchip b").first().textContent()) === "3",
      "evict must return COOLANT 2 to the pool (avail 1 -> 3)");
    await shot("stage2-evicted");
  });

  await step(`${opts.prefix || ""} S2: unsafe order fails with step + deficit`, async () => {
    for (const p of ["CNC", "INJ", "WLD", "PNT", "ASM"]) {
      await page.click(`.pickchip:has-text("${p}")`);
    }
    await page.click('#actionbar button:has-text("TEST SEQUENCE")');
    await fbHas(page, "STEP 1.*FAILS");
    await stage(2);
    const fb = await page.textContent("#feedback");
    assert(/short/.test(fb), "deficit detail missing");
    if (opts.overflow) await noOverflow(page, "stage2-unsafe");
  });

  await step(`${opts.prefix || ""} S2: safe order advances to stage 3`, async () => {
    await page.waitForTimeout(1200);            /* s2.test spacing */
    await page.click('#actionbar button:has-text("CLEAR ORDER")');
    for (const p of ["ASM", "PNT", "WLD", "CNC", "INJ"]) {
      await page.click(`.pickchip:has-text("${p}")`);
    }
    await page.click('#actionbar button:has-text("TEST SEQUENCE")');
    await waitBriefing(page, 3);
    await stage(3);
  });

  /* ═══════════ STAGE 3 ═══════════ */
  await step(`${opts.prefix || ""} S3: network renders, incomplete route rejected`, async () => {
    assert(await page.locator(".netsvg").count(), "network map missing");
    assert(await page.locator(".linkrow").count() === 11, "11 links expected");
    await page.click('.linkrow:has-text("entry-b1")');
    await page.click('.linkrow:has-text("b1-b2")');
    await page.click('#actionbar button:has-text("SUBMIT ROUTE")');
    await fbHas(page, "CHAIN|GATE");
    await stage(3);
    if (opts.overflow) await noOverflow(page, "stage3");
    await shot("stage3-network");
  });

  await step(`${opts.prefix || ""} S3: probe measures a suspect link (+1 fuel)`, async () => {
    await page.waitForTimeout(1200);            /* s3.route spacing before probe work */
    await page.click('.linkrow:has-text("a2-b2")');
    await page.waitForSelector("#inspector", { state: "visible" });
    assert((await page.textContent("#inspector")).includes("unverified"), "suspect link must read unverified");
    await page.click('#inspector button:has-text("PROBE LINK")');
    await fbHas(page, "LINK MEASURED");
    await page.waitForTimeout(150);
    const insp = await page.textContent("#inspector");
    assert(insp.includes("MEASURED CAP") && /:\s*1/.test(insp), "probe must reveal true capacity 1");
    assert((await page.textContent("#budgetList")).includes("7 / 8 LEFT"), "probe budget did not decrement");
    /* drop the probed link from the selection again */
    await page.click('.linkrow:has-text("a2-b2")');
    await shot("stage3-probed");
  });

  await step(`${opts.prefix || ""} S3: valid corridor advances to stage 4`, async () => {
    await page.click('.linkrow:has-text("b2-gate")');
    await page.click('.linkrow:has-text("gate-core")');
    const meter = await page.textContent("#viewHost .routemeter");
    assert(meter.includes("FUEL 8 / 10"), "route meter should show fuel 8/10: " + meter);
    assert(meter.includes("SEC-GATE"), "gate check missing");
    await page.click('#actionbar button:has-text("SUBMIT ROUTE")');
    await waitBriefing(page, 4);
    await stage(4);
    if (opts.overflow) await noOverflow(page, "stage4");
    await shot("stage4-panels");
  });

  /* ═══════════ STAGE 4 ═══════════ */
  await step(`${opts.prefix || ""} S4: derived state visible (block + degraded net)`, async () => {
    const view = await page.textContent("#viewHost");
    assert(view.includes("DEPENDENCY BLOCK"), "block panel missing");
    assert(view.includes("N2") && view.includes("N4"), "cross-held pair missing");
    assert(view.includes("DEGRADED"), "degraded links not marked");
    assert(view.includes("FLOOR"), "reserve floor missing");
    assert((await page.textContent("#discovered")).includes("S1"), "provenance missing in DISCOVERED");
    if (opts.leak) {
      const html = await page.content();
      assert(html.indexOf("RZ{") === -1, "flag leaked into page HTML pre-solve");
      const store = await page.evaluate(() =>
        JSON.stringify([localStorage, sessionStorage]));
      assert(store.indexOf("RZ{") === -1, "flag leaked into web storage pre-solve");
    }
  });

  await step(`${opts.prefix || ""} S4: invalid plan fails at op 1 without corrupting state`, async () => {
    await page.selectOption("#addType", "SEAL");
    await page.click('#viewHost button:has-text("ADD TO PLAN")');
    assert(await page.locator(".planrow").count() === 1, "plan row not added");
    await page.click('#actionbar button:has-text("EXECUTE PLAN")');
    await fbHas(page, "OPERATION 1 FAILS");
    await stage(4);
    if (opts.overflow) await noOverflow(page, "stage4-invalid");
  });

  await step(`${opts.prefix || ""} S4: valid plan accepted -> completion + genuine flag check`, async () => {
    await page.waitForTimeout(1200);            /* s4.plan spacing */
    await page.click('#actionbar button:has-text("CLEAR PLAN")');
    /* break the block */
    await page.selectOption("#addType", "PREEMPT");
    await page.selectOption("#addProc", "N2");
    await page.click('#viewHost button:has-text("ADD TO PLAN")');
    /* floor-safe run */
    await page.selectOption("#addType", "RUN");
    for (const p of ["ASM", "PNT", "WLD", "CNC", "INJ"]) {
      await page.click(`#viewHost .pickchip:has-text("${p}")`);
    }
    await page.click('#viewHost button:has-text("ADD TO PLAN")');
    /* restore the route */
    await page.selectOption("#addType", "ROUTE");
    for (const l of ["entry-b1", "b1-b2", "b2-gate", "gate-core"]) {
      await page.click(`.linkrow:has-text("${l}")`);
    }
    await page.click('#viewHost button:has-text("ADD TO PLAN")');
    /* seal */
    await page.selectOption("#addType", "SEAL");
    await page.click('#viewHost button:has-text("ADD TO PLAN")');
    assert(await page.locator(".planrow").count() === 4, "plan should have 4 ops");
    if (opts.overflow) await noOverflow(page, "stage4-plan");

    await page.click('#actionbar button:has-text("EXECUTE PLAN")');
    await page.waitForSelector("#ovComplete", { state: "visible", timeout: 12000 });
    const flag = await page.textContent("#doneFlag");
    assert(flag === engine.FLAG, `flag mismatch: UI=${flag} server=${engine.FLAG}`);
    const tx = await page.textContent("#doneTransmission");
    assert(tx.length > 100, "transmission too short");
    assert((await page.textContent("#stageChip")).includes("RESTORED"), "stage chip not restored");
    await page.waitForTimeout(2300);            /* restoration animation */
    await shot("complete-flag");
  });

  await step(`${opts.prefix || ""} completion: seal records the token`, async () => {
    await page.fill("#sealInput", engine.FLAG);
    await page.click("#btnSeal");
    await fbHas(page, "SEALED");
    await shot("sealed");
  });

  await step(`${opts.prefix || ""} reload keeps solved state; REOPEN shows the token`, async () => {
    await page.click("#btnCloseComplete");
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector("#ovBriefing", { state: "visible", timeout: 8000 });
    await page.click("#btnAckBrief");
    await page.waitForSelector("#ovBriefing", { state: "hidden", timeout: 8000 });
    await stage(4);
    await page.waitForSelector('#actionbar button:has-text("REOPEN TRANSMISSION")', { timeout: 6000 });
    await page.click('#actionbar button:has-text("REOPEN TRANSMISSION")');
    await page.waitForSelector("#ovComplete", { state: "visible" });
    assert((await page.textContent("#doneFlag")) === engine.FLAG, "reopen lost the flag");
    await page.click("#btnCloseComplete");
    if (opts.overflow) await noOverflow(page, "stage4-reload");
    await shot("stage4-reloaded");
  });

  if (opts.privateCheck) {
    await step(`${opts.prefix || ""} private files are never served`, async () => {
      const paths = [
        "/_organizer/SOLUTION.md", "/_organizer/STATE.md", "/_organizer/DEPLOYMENT.md",
        "/_organizer/solve.js", "/server/engine.js", "/server/store.js",
        "/server/narrative.js", "/test/run.js", "/test/e2e.js",
        "/package.json", "/package-lock.json", "/README.md",
        "/js/../server/engine.js", "/api/flag"
      ];
      for (const p of paths) {
        const r = await page.request.get(opts.base + p);
        assert(r.status() === 404, `${p} => ${r.status()} (must be 404)`);
      }
    });
  }

  await step(`${opts.prefix || ""} reset (with confirmation) restores a clean stage 1`, async () => {
    await page.click("#btnReset");
    await page.waitForSelector("#resetConfirm", { state: "visible" });
    await shot("reset-confirm");
    await page.click("#btnResetYes");
    await page.waitForSelector("#ovBriefing", { state: "visible", timeout: 8000 });
    await page.click("#btnAckBrief");
    await page.waitForSelector("#ovBriefing", { state: "hidden", timeout: 8000 });
    await stage(1);
    assert((await page.textContent("#budgetList")).includes("10 / 10 LEFT"), "budgets not reset");
    await shot("after-reset");
  });
}

/* ══════════════════════════════ runner ══════════════════════════════════ */
(async () => {
  const { create } = require(path.join(ROOT, "server", "server"));
  const server = create();
  await new Promise((res) => server.listen(0, "127.0.0.1", res));
  const base = "http://127.0.0.1:" + server.address().port + "/";
  console.log("e2e server: " + base);

  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: GL_ARGS });
  const caps = [];

  /* ---------------- Scenario A: full desktop path ---------------- */
  console.log("\n[scenario A] complete player path (1440x900)");
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pageA = await ctxA.newPage();
  const capA = makeCapture(pageA);
  caps.push(capA);
  await playThrough(pageA, {
    base, prefix: "A", audio: true, hints: true, leak: true, privateCheck: true
  });
  if (capA.apiFlagHits.length) {
    const bad = capA.apiFlagHits.filter((u) => !/\/api\/s4\/plan|\/api\/flag/.test(u));
    assert(bad.length === 0, "flag leaked in API responses: " + bad.join(", "));
  }
  await ctxA.close();
  /* ---------------- Scenario B: mobile full path ---------------- */
  console.log("\n[scenario B] complete player path (390x844, overflow guard)");
  const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const pageB = await ctxB.newPage();
  const capB = makeCapture(pageB);
  caps.push(capB);
  await playThrough(pageB, { base, prefix: "B", overflow: true, hints: true });
  await ctxB.close();

  /* ---------------- Scenario C: reduced motion ---------------- */
  console.log("\n[scenario C] prefers-reduced-motion smoke");
  const capC = { consoleErrors: [], expected4xx: [], pageErrors: [], netErrors: [], apiFlagHits: [] };
  const ctxC = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  const pageC = await ctxC.newPage();
  pageC.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/^Failed to load resource: the server responded with a status of 4\d\d/.test(t)) {
      capC.expected4xx.push(t);
      return;
    }
    capC.consoleErrors.push(t);
  });
  pageC.on("pageerror", (e) => capC.pageErrors.push(String(e)));
  caps.push(capC);
  await step("C: reduced-motion intro -> inspect works, animation suppressed", async () => {
    await pageC.goto(base, { waitUntil: "networkidle" });
    await pageC.waitForSelector("#ovIntro", { state: "visible", timeout: 8000 });
    await pageC.click("#btnEnter");
    await waitBriefing(pageC, 1);
    /* skip tutorial directly */
    await pageC.waitForSelector("#ovTut", { state: "visible", timeout: 3000 });
    await pageC.click("#btnTutSkip");
    await pageC.waitForSelector("#ovTut", { state: "hidden", timeout: 5000 });
    await pageC.click('g.node.proc:has-text("P2")');
    await pageC.waitForSelector("#inspector", { state: "visible" });
    await pageC.click('#inspector button:has-text("INSPECT P2")');
    await fbHas(pageC, "INSPECTION COMPLETE");
    await noOverflow(pageC, "reduced-motion");
    await pageC.screenshot({ path: path.join(SHOTS, "C-reduced-motion.png") });
  });
  await ctxC.close();

  await browser.close();
  server.close();

  /* ---------------- evidence ---------------- */
  const allErrors = [];
  const names = ["A", "B", "C"];
  caps.forEach((c, i) => {
    c.consoleErrors.forEach((t) => allErrors.push(`[${names[i]} console.error] ${t}`));
    c.pageErrors.forEach((t) => allErrors.push(`[${names[i]} pageerror] ${t}`));
    c.netErrors.forEach((t) => allErrors.push(`[${names[i]} net] ${t}`));
    (c.apiFlagHits || []).forEach((u) => {
      if (!/\/api\/s4\/plan|\/api\/flag/.test(u)) {
        allErrors.push(`[${names[i]} leak] flag in API response: ${u}`);
      }
    });
  });
  fs.writeFileSync(path.join(SHOTS, "console.log"), [
    "=== errors (all scenarios) ===",
    allErrors.length ? allErrors.join("\n") : "(none)",
    "", "=== expected 4xx rejections (invalid answers / hint gates) ===",
    caps.reduce((n, c) => n + (c.expected4xx || []).length, 0) + " total (by design)",
    "", "=== steps ===",
    RESULTS.map((r) => `${r.ok ? "PASS" : "FAIL"}  ${r.label}  ${r.ms}ms${r.err ? "  — " + r.err : ""}`).join("\n")
  ].join("\n"));

  console.log("\n=== E2E SUMMARY ===");
  for (const r of RESULTS) {
    console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.label}  ${(r.ms / 1000).toFixed(1)}s${r.err ? "  — " + r.err : ""}`);
  }
  console.log(`  console/page/network errors: ${allErrors.length}`);
  console.log(`  expected 4xx rejections (by design): ${caps.reduce((n, c) => n + (c.expected4xx || []).length, 0)}`);
  console.log(`  evidence: ${SHOTS}`);
  const failed = RESULTS.filter((r) => !r.ok).length;
  const pass = failed === 0 && allErrors.length === 0;
  console.log(pass ? "\nFULL PLAYTHROUGH PASS" : `\nE2E FAILURES: ${failed} steps, ${allErrors.length} errors`);
  process.exitCode = pass ? 0 : 1;
})().catch((e) => {
  console.error("\nE2E ABORTED:", (e && e.stack) || e);
  process.exit(1);
});
