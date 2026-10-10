/* ==========================================================================
   THE LAST DATASET — cinematic terminal sequence (spec §10).

   Full-screen CRT takeover: multi-line typed boot, scanlines, flicker,
   sound, progress bar — ~1.3 s total, always skippable with Escape.
   Ends in one of: opening (tab navigates) | blocked | unconfigured |
   disabled | error — each with the right fallback UI.
   ========================================================================== */
'use strict';

window.manuTerminal = (function () {

    const PHASE1 = [
        '> TERMINAL WAKE',
        '> NODE IDENTIFIED',
        '> SANCTUARY NETWORK',
        '> AUTHENTICATION REQUIRED'
    ];
    const PHASE2 = [
        '> ESTABLISHING SECURE CHANNEL...',
        '> ROUTING REQUEST...',
        '> EXTERNAL ARCHIVE FOUND',
        '> CHANNEL READY'
    ];
    const FINAL = [
        'CONNECTION ESTABLISHED',
        'OPENING EXTERNAL CTF'
    ];

    const T1 = 110;   // ms per phase-1 line
    const T2 = 95;    // ms per phase-2 line
    const TF = 110;   // ms per final line
    const HOLD = 320; // ms hold before close

    let el = null;
    let running = false;
    let skipRequested = false;
    let currentCfg = null;
    let timers = [];

    function cacheEls() {
        if (el) return el;
        el = {
            root: document.getElementById('terminal-overlay'),
            title: document.getElementById('terminal-title'),
            lines: document.getElementById('terminal-lines'),
            bar: document.getElementById('terminal-progress'),
            screen: document.getElementById('terminal-screen'),
            end: document.getElementById('terminal-end')
        };
        return el;
    }

    function beep(freq, ms) {
        try {
            if (typeof audio !== 'undefined' && audio && audio.playBeep) audio.playBeep(freq, ms);
        } catch (e) { /* audio is cosmetic */ }
    }

    function later(fn, ms) {
        const id = setTimeout(fn, ms);
        timers.push(id);
        return id;
    }

    function clearTimers() {
        timers.forEach(clearTimeout);
        timers = [];
    }

    function reducedMotion() {
        return !!(window.manuState && manuState.state.prefs.reducedMotion) ||
            (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    /* ------------------------------ internals ----------------------------- */

    function typeLine(text, cls) {
        const e = cacheEls();
        const line = document.createElement('div');
        line.className = 'term-line ' + (cls || '');
        e.lines.appendChild(line);

        if (reducedMotion() || skipRequested) {
            line.textContent = text;
            return 0;
        }
        // Fast chunked reveal — reads as typing without extending the timeline.
        let i = 0;
        const step = Math.max(2, Math.ceil(text.length / 6));
        const id = setInterval(() => {
            i = Math.min(text.length, i + step);
            line.textContent = text.slice(0, i);
            if (i >= text.length) clearInterval(id);
        }, 14);
        timers.push(id);
        return 1;
    }

    function resetScreen(title) {
        const e = cacheEls();
        clearTimers();
        skipRequested = false;
        e.title.textContent = title || 'CTF TERMINAL';
        e.lines.innerHTML = '';
        e.bar.style.width = '0%';
        e.end.innerHTML = '';
        e.end.hidden = true;
        e.root.hidden = false;
        e.root.classList.add('active');
        e.root.setAttribute('aria-hidden', 'false');
        e.screen.classList.remove('flicker-out');
    }

    function setProgress(pct) {
        const e = cacheEls();
        e.bar.style.width = pct + '%';
    }

    function endPanel(kind, options) {
        const e = cacheEls();
        e.end.hidden = false;
        e.screen.classList.add('flicker-out');
        const opts = options || {};

        const head = document.createElement('div');
        head.className = 'term-end-head ' + kind;
        const body = document.createElement('div');
        body.className = 'term-end-body';
        const buttons = document.createElement('div');
        buttons.className = 'term-end-buttons';

        const addBtn = (label, primary, handler) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'term-btn' + (primary ? ' primary' : '');
            b.textContent = label;
            b.addEventListener('click', handler);
            buttons.appendChild(b);
            return b;
        };

        if (kind === 'opening') {
            head.textContent = 'CTF CHANNEL OPEN';
            body.textContent = 'Challenge launched in a new tab. Solve it there — the world updates when the archive reports back.';
            addBtn('RETURN', false, () => close());
            later(() => close(), 900);
        } else if (kind === 'blocked') {
            head.textContent = 'CTF CHANNEL READY';
            body.textContent = 'Your browser blocked the external archive.';
            addBtn('OPEN CTF', true, () => {
                if (opts.url && window.manuLauncher) manuLauncher.openDirect(opts.url);
            });
            addBtn('RETURN', false, () => close());
        } else if (kind === 'unconfigured') {
            head.textContent = 'CTF CHANNEL NOT CONFIGURED';
            body.textContent = 'This challenge will be available soon. The archive node is waiting for its uplink.';
            addBtn('RETURN TO WORLD', false, () => close());
        } else if (kind === 'disabled') {
            head.textContent = 'CHANNEL SUSPENDED';
            body.textContent = 'This archive node is temporarily offline.';
            addBtn('RETURN TO WORLD', false, () => close());
        } else if (kind === 'error') {
            head.textContent = 'CONNECTION ERROR';
            body.textContent = 'The Sanctuary network could not reach this archive node.';
            addBtn('RETRY', true, () => {
                close();
                if (typeof opts.onRetry === 'function') later(opts.onRetry, 60);
            });
            addBtn('RETURN TO WORLD', false, () => close());
        }

        e.end.appendChild(head);
        e.end.appendChild(body);
        e.end.appendChild(buttons);
        const firstBtn = buttons.querySelector('button');
        if (firstBtn) later(() => firstBtn.focus(), 40);
    }

    /* -------------------------------- public ------------------------------ */

    /**
     * Run the cinematic handshake.
     * cfg = { title, kind: 'launch'|'status', onLaunched?, endKind?, url?, onRetry?, onDone? }
     */
    function run(cfg) {
        const options = cfg || {};
        const e = cacheEls();
        if (running) return;
        running = true;
        currentCfg = options;

        resetScreen(options.title);
        beep(880, 0.07);

        let t = 0;
        const fast = reducedMotion();
        const step1 = fast ? 40 : T1;
        const step2 = fast ? 30 : T2;
        const stepF = fast ? 40 : TF;
        const totalLines = PHASE1.length + PHASE2.length + FINAL.length;

        PHASE1.forEach((line, idx) => later(() => { typeLine(line, 'dim'); setProgress(Math.round(((idx + 1) / totalLines) * 70)); }, t += step1));
        later(() => beep(988, 0.06), t);
        PHASE2.forEach((line, idx) => later(() => { typeLine(line, 'accent'); setProgress(70 + Math.round(((idx + 1) / totalLines) * 25)); }, t += step2));
        later(() => beep(1174, 0.09), t);
        FINAL.forEach((line, idx) => later(() => { typeLine(line, 'success'); setProgress(95 + idx); }, t += stepF));

        // The external tab navigates exactly when the cinematic says it does.
        if (options.kind !== 'status') {
            later(() => { if (typeof options.onLaunched === 'function') options.onLaunched(); }, t);
        }

        later(() => {
            setProgress(100);
            finish(options);
        }, t + HOLD);
    }

    /** Final state of a launch/status sequence. */
    function finish(options) {
        if (options.endKind) {
            endPanel(options.endKind, options);
            beep(options.endKind === 'opening' ? 1320 : 320, 0.1);
            if (options.endKind === 'opening') later(close, 900);
        }
        running = false;
        if (typeof options.onDone === 'function') options.onDone(options.endKind || null);
    }

    /* Short status-only sequence (no external launch): visited/locked/solved. */
    function statusSequence(cfg) {
        const options = cfg || {};
        const e = cacheEls();
        if (running) return;
        running = true;
        currentCfg = options;
        resetScreen(options.title);

        let t = 0;
        const lines = options.lines || ['> NODE ONLINE'];
        const fast = reducedMotion();
        lines.forEach((line, idx) => later(() => {
            typeLine(line, idx === lines.length - 1 ? 'success' : 'dim');
            setProgress(Math.round(((idx + 1) / lines.length) * 100));
            if (idx === lines.length - 1) beep(1174, 0.08);
        }, t += (fast ? 40 : 130)));

        later(() => {
            running = false;
            currentCfg = null;
            if (options.autoClose !== false) later(close, options.holdMs || 700);
            if (typeof options.onDone === 'function') options.onDone();
        }, t + 200);
    }

    function close() {
        const e = cacheEls();
        clearTimers();
        running = false;
        skipRequested = false;
        e.root.classList.remove('active');
        e.root.setAttribute('aria-hidden', 'true');
        later(() => { if (!running) e.root.hidden = true; }, 260);
    }

    /* Escape during a running sequence fast-forwards to its end state. */
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (cacheEls().root && !cacheEls().root.hidden && running) {
            e.stopPropagation();
            skipNow();
        }
    }, true);

    /* Fast-forward: render every line instantly, then finish. */
    function skipNow() {
        const options = currentCfg || {};
        const e = cacheEls();
        clearTimers();
        skipRequested = true;

        const lines = options.kind === 'status'
            ? (options.lines || ['> NODE ONLINE'])
            : PHASE1.concat(PHASE2, FINAL);
        e.lines.innerHTML = '';
        lines.forEach((text, idx) => {
            const cls = options.kind === 'status'
                ? (idx === lines.length - 1 ? 'success' : 'dim')
                : (idx < PHASE1.length ? 'dim' : (idx < PHASE1.length + PHASE2.length ? 'accent' : 'success'));
            typeLine(text, cls);
        });
        setProgress(100);

        if (options.kind === 'status') {
            running = false;
            currentCfg = null;
            if (options.autoClose !== false) later(close, 300);
            if (typeof options.onDone === 'function') options.onDone();
            return;
        }
        if (typeof options.onLaunched === 'function') options.onLaunched();
        finish(options);
    }

    return { run: run, statusSequence: statusSequence, close: close, isRunning: () => running };
})();
