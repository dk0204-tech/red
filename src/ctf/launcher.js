/* ==========================================================================
   THE LAST DATASET — CTF launcher (spec §11, §12, §36).

   Runs entirely inside the player's [E] key gesture so the external tab can
   never be pop-up blocked:

     1. resolve the CTF from GET /api/ctfs (static config as offline fallback)
     2. validate the URL (https only, no javascript:/data:/file:, no placeholder)
     3. reserve a blank tab synchronously + splash
     4. POST /api/ctfs/:id/launch (visit tracking — never a solve)
     5. commit() navigates the reserved tab when the cinematic ends

   If the tab was blocked, the caller shows the CTF CHANNEL READY fallback
   ([OPEN CTF] / [RETURN]) — the button click is a fresh user gesture.
   ========================================================================== */
'use strict';

window.manuLauncher = (function () {

    const MSG_NOT_CONFIGURED = '⛔ CTF CHANNEL NOT CONFIGURED — This challenge will be available soon.';
    const MSG_BLOCKED = '🚫 CTF CHANNEL BLOCKED — Allow pop-ups to access the challenge.';
    const MSG_DISABLED = '⛔ CHANNEL SUSPENDED — This archive node is temporarily offline.';
    const MSG_ERROR = 'CONNECTION ERROR — The Sanctuary network could not reach this archive node.';

    const BAD_SCHEMES = ['javascript:', 'data:', 'file:', 'vbscript:', 'blob:', 'about:'];

    /* Strict client-side URL check. Backend validation is authoritative; this
       is defence in depth for the static offline-fallback config. */
    function isSafeUrl(url) {
        if (typeof url !== 'string' || !url) return false;
        const lower = url.toLowerCase();
        for (let i = 0; i < BAD_SCHEMES.length; i++) {
            if (lower.indexOf(BAD_SCHEMES[i]) === 0) return false;
        }
        if (lower.indexOf('PLACEHOLDER') !== -1) return false;
        return /^https?:\/\//i.test(url);
    }

    function notify(message) {
        if (typeof window.showToast === 'function') window.showToast(message, 3800);
        else if (typeof ctfNotify === 'function') ctfNotify(message);
    }

    /* ------------------------- static fallback --------------------------- */

    function fallbackCtf(zoneId) {
        // config/ctf-links.js (loaded when present) — offline resilience only.
        if (typeof ctfResolve !== 'function') return null;
        try {
            const res = ctfResolve(zoneId);
            if (!res || !res.ok || !isSafeUrl(res.url)) return null;
            return { slug: zoneId, name: zoneId, externalUrl: res.url, terminalLabel: null, source: 'static' };
        } catch (e) { return null; }
    }

    /* ------------------------------ resolve ------------------------------ */

    /**
     * Synchronous — must run inside the user gesture.
     * Returns a handle: { zoneId, ctf, url, tab, reason, launchPromise }.
     */
    function prepare(zoneId) {
        const handle = {
            zoneId: zoneId,
            ctf: null,
            url: null,
            tab: null,
            reason: null,        // 'unconfigured' | 'disabled' | 'blocked' | 'offline' | null
            launched: false
        };

        const ctf = (window.manuState && manuState.ctfForZone(zoneId)) || fallbackCtf(zoneId);
        if (!ctf) {
            handle.reason = manuState && manuState.state.online === false ? 'offline' : 'unconfigured';
            return handle;
        }
        handle.ctf = ctf;

        if (ctf.enabled === false) { handle.reason = 'disabled'; return handle; }
        if (!isSafeUrl(ctf.externalUrl)) { handle.reason = 'unconfigured'; return handle; }
        handle.url = ctf.externalUrl;

        // Reserve the tab NOW (still inside the gesture) so it cannot be blocked.
        try {
            handle.tab = window.open('', '_blank');
        } catch (e) {
            handle.tab = null;
        }
        if (!handle.tab) {
            handle.reason = 'blocked';
        } else {
            try { handle.tab.opener = null; } catch (e) { /* cross-context */ }
            writeSplash(handle.tab);
        }

        // Launch tracking — fire and forget; a tracking failure never blocks play.
        if (ctf.source !== 'static' && window.manuApi && manuApi.hasToken()) {
            handle.launchPromise = manuApi.launch(ctf.slug).then(
                () => { handle.launched = true; },
                (err) => {
                    // 409 = channel not configured server-side, 410 = disabled:
                    // surface those, ignore pure network noise.
                    if (err && (err.code === 'ctf_not_configured')) notify(MSG_NOT_CONFIGURED);
                }
            );
        }
        return handle;
    }

    function writeSplash(win) {
        if (typeof ctfWriteSplash === 'function') {
            try { ctfWriteSplash(win); return; } catch (e) { /* fall through */ }
        }
        try {
            const doc = win.document;
            doc.title = 'MANU PROTOCOL // ESTABLISHING CTF CHANNEL';
            doc.body.textContent = 'MANU PROTOCOL — ESTABLISHING CTF CHANNEL…';
            doc.body.style.cssText = 'margin:0;height:100vh;display:flex;align-items:center;justify-content:center;' +
                'background:#05070d;color:#59e6ff;letter-spacing:3px;font:700 13px monospace';
        } catch (e) { /* cosmetic only */ }
    }

    /* ------------------------------ commit ------------------------------- */

    /* Navigate the reserved tab (or fall back to window.open from a button
       click). Returns true when the challenge was handed to the browser. */
    function commit(handle) {
        if (!handle || !handle.url) return false;

        if (handle.tab) {
            try {
                const doc = handle.tab.document;
                const a = doc.createElement('a');
                a.rel = 'noopener noreferrer';
                a.href = handle.url;
                a.style.display = 'none';
                doc.body.appendChild(a);
                a.click();
                return true;
            } catch (e) {
                try { handle.tab.location.href = handle.url; return true; } catch (e2) { /* blocked */ }
            }
        }
        // Reserved tab died — try a direct open (works when called from a click).
        const fresh = window.open(handle.url, '_blank', 'noopener,noreferrer');
        return !!fresh;
    }

    /* Called from the fallback UI's [OPEN CTF] button — a fresh gesture. */
    function openDirect(url) {
        if (!isSafeUrl(url)) { notify(MSG_NOT_CONFIGURED); return false; }
        const win = window.open(url, '_blank', 'noopener,noreferrer');
        if (!win) { notify(MSG_BLOCKED); return false; }
        return true;
    }

    function close(handle) {
        if (handle && handle.tab) {
            try { handle.tab.close(); } catch (e) { /* already navigated */ }
            handle.tab = null;
        }
    }

    return {
        prepare: prepare,
        commit: commit,
        openDirect: openDirect,
        close: close,
        isSafeUrl: isSafeUrl,
        messages: {
            NOT_CONFIGURED: MSG_NOT_CONFIGURED,
            BLOCKED: MSG_BLOCKED,
            DISABLED: MSG_DISABLED,
            ERROR: MSG_ERROR
        }
    };
})();
