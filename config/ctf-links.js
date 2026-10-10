/* ============================================================================
   THE LAST DATASET — CTF CONFIGURATION  ( SINGLE SOURCE OF TRUTH )
   ============================================================================
   Exactly 5 CTF locations exist. They are completed IN ORDER:

       CTF 1  GHOST SIGNAL      (Relay District)      — Red Zone CTF 1
       CTF 2  SANCTUARY ARCHIVE (Archive Precinct)
       CTF 3  CHILD DATASET     (Research Block)
       CTF 4  CENTRAL ATRIUM    (Central Plaza)
       CTF 5  BIOARCHIVE        (Bio-Quarantine)

   ► BEFORE DEPLOYING: replace ONLY the `url` values inside CTF_CONFIG below.
     Keep them complete "http://" or "https://" addresses. Nothing else in
     the application has to change.

   ► CTF 1 ships with the provided Red Zone CTF 1 backend
     (red-zone-ctf1/ — "PRALAYA Archive Terminal"), which listens on
     http://127.0.0.1:8080 by default and is auto-started by `npm start`.
     Point `url` at your deployed Red Zone instance for the live event.

   ► While a value is missing, empty, malformed, or contains "PLACEHOLDER",
     the matching terminal stays safely disabled: the player is told
     "CTF CHANNEL NOT CONFIGURED" and the rest of the game keeps running.

   ► No flags, answers or challenge content live in this file or anywhere
     in the game frontend — the real CTF backend owns validation.

   Static asset only — no backend, no database, no API calls, no polling.
   ============================================================================ */

/* ---------------------------------------------------- The five CTFs ------- */
/* `zone` keys are the ZONES[].id values defined in index.html.
   `id` is the sequential fragment number (1 → 5). */
const CTF_CONFIG = Object.freeze([
    {
        id: 1,
        name: 'GHOST SIGNAL',
        location: 'RELAY DISTRICT',
        zone: 'zone_bridge',
        url: 'http://127.0.0.1:8080'   // Red Zone CTF 1 — PRALAYA Archive Terminal
    },
    {
        id: 2,
        name: 'SANCTUARY ARCHIVE',
        location: 'ARCHIVE PRECINCT',
        zone: 'zone_vault',
        url: 'http://127.0.0.1:8081'   // Red Zone CTF 2 — THE SILENT EDIT (existing `Red Zone CTF 2/` node)
    },
    {
        id: 3,
        name: 'CHILD DATASET',
        location: 'RESEARCH BLOCK',
        zone: 'zone_ai',
        url: 'http://127.0.0.1:8082'   // Red Zone CTF 3 — METADATA FORENSICS (existing `Red Zone CTF 3/` node)
    },
    {
        id: 4,
        name: 'CENTRAL ATRIUM',
        location: 'CENTRAL PLAZA',
        zone: 'zone_atrium',
        url: 'http://127.0.0.1:8090'   // CTF 4 — THE DEADLOCK ENGINE (existing `Bonus CTF/` node)
    },
    {
        id: 5,
        name: 'BIOARCHIVE',
        location: 'BIO-QUARANTINE',
        zone: 'zone_bio',
        url: 'http://127.0.0.1:8083'   // CTF 5 — THE LAST GATEKEEPER (existing `CTF 5 - THE LAST GATEKEEPER/`)
    }
]);

/* -------------------------------------------------------- In-game text ---- */
const CTF_MSG_NOT_CONFIGURED = '⛔ CTF CHANNEL NOT CONFIGURED — This challenge will be available soon.';
const CTF_MSG_BLOCKED = '🚫 CTF CHANNEL BLOCKED — Allow pop-ups to access the challenge.';

/* ============================== Validation =============================== */

/* A URL is usable only when it is a real http(s) address and is not a
   placeholder. Malformed values are treated as "unavailable", never fatal. */
function isValidCTFUrl(url) {
    return typeof url === 'string' &&
           /^https?:\/\//i.test(url) &&
           !url.includes('PLACEHOLDER');
}

function ctfHas(obj, key) {
    return !!obj && typeof key === 'string' &&
           Object.prototype.hasOwnProperty.call(obj, key);
}

/* Resolve a zone id (or a numeric CTF id) → { id, name, zone, url, ok }.
   Never throws. */
function ctfResolve(terminalId) {
    let entry = null;
    if (typeof terminalId === 'number') {
        entry = CTF_CONFIG.find(c => c.id === terminalId) || null;
    } else if (typeof terminalId === 'string' && terminalId.indexOf('zone_') === 0) {
        entry = CTF_CONFIG.find(c => c.zone === terminalId) || null;
    } else if (typeof terminalId === 'string' && /^ctf\d+$/.test(terminalId)) {
        // legacy slot keys: 'ctf1' … 'ctf5'
        entry = CTF_CONFIG.find(c => c.id === Number(terminalId.slice(3))) || null;
    }
    if (!entry) return { id: null, name: null, zone: terminalId || null, url: null, ok: false };
    return {
        id: entry.id,
        name: entry.name,
        zone: entry.zone,
        url: entry.url,
        ok: isValidCTFUrl(entry.url)
    };
}

/* ============================ Toast bridge ============================== */
/* Reuses the game's existing notification style; degrades gracefully if the
   game toast element is not there yet. */
function ctfNotify(message) {
    if (typeof window.showToast === 'function') {
        window.showToast(message, 3600);
        return;
    }
    const el = document.getElementById('toast');
    if (el) {
        el.innerText = message;
        el.classList.add('show');
        clearTimeout(el._ctfTimer);
        el._ctfTimer = setTimeout(function () { el.classList.remove('show'); }, 3600);
    }
}

/* ======================== New-tab launcher ============================== */
/* The tab is reserved synchronously (so it is opened while the player's
   [E] key / button gesture is still active and cannot be pop-up blocked), given a
   short MANU-styled splash, then navigated to the real challenge.
   window.opener is severed immediately = the "noopener" protection, while
   still letting us detect a genuine pop-up block. */

function ctfWriteSplash(win) {
    try {
        const doc = win.document;
        // Never write into the game's own document (popup collapsed to self).
        if (!doc || !doc.body || doc === document) return;
        doc.title = 'THE LAST DATASET // ESTABLISHING CTF CHANNEL';
        const body = doc.body;
        body.textContent = '';
        body.style.cssText = 'margin:0;height:100vh;display:flex;flex-direction:column;' +
            'align-items:center;justify-content:center;background:#05070d;color:#59e6ff;' +
            'letter-spacing:3px;text-align:center;font:700 13px \'JetBrains Mono\',ui-monospace,monospace';
        const l1 = doc.createElement('div');
        l1.textContent = 'THE LAST DATASET';
        const l2 = doc.createElement('div');
        l2.textContent = 'ESTABLISHING CTF CHANNEL...';
        l2.style.cssText = 'margin-top:12px;color:#ffaa00';
        body.appendChild(l1);
        body.appendChild(l2);
    } catch (err) { /* splash is cosmetic only — never fatal */ }
}

/* Reserve + (optionally delayed) navigate a new tab. Returns the window or null. */
function ctfOpenTab(url, delayMs) {
    if (!isValidCTFUrl(url)) {
        ctfNotify(CTF_MSG_NOT_CONFIGURED);
        return null;
    }

    let win = null;
    try {
        win = window.open('', '_blank');
    } catch (err) {
        win = null;
    }
    // Popup blocked, or the environment collapsed the new tab into this one:
    // treat both as "blocked" — the splash must never wipe the game itself.
    if (!win || win === window || (win.document && win.document === document)) {
        ctfNotify(CTF_MSG_BLOCKED);
        return null;
    }

    try { win.opener = null; } catch (err) { /* cross-context: ignore */ }
    ctfWriteSplash(win);

    const go = function () {
        try {
            // Navigate the reserved tab through a rel="noopener noreferrer"
            // link in the same-origin splash document: no referrer leaked,
            // no reverse-tabnabbing, no extra window created.
            const doc = win.document;
            if (!doc || doc === document) { ctfNotify(CTF_MSG_BLOCKED); return; }
            const a = doc.createElement('a');
            a.rel = 'noopener noreferrer';
            a.href = url;
            a.style.display = 'none';
            doc.body.appendChild(a);
            a.click();
        } catch (err) {
            try { win.location.href = url; } catch (err2) { ctfNotify(CTF_MSG_BLOCKED); }
        }
    };

    if (delayMs > 0) setTimeout(go, delayMs);
    else go();

    return win;
}

/* ---------------------------------------------------------------- API ---- */

/* One-shot launcher. Validate → open the matching challenge in a new tab.
   openCTF(1)            → opens CTF 1 (GHOST SIGNAL).
   openCTF('ctf1')       → legacy slot key, same result.
   Returns the new window, or null when unavailable / blocked. */
function openCTF(ctfId) {
    const key = (typeof ctfId === 'string' && /^\d+$/.test(ctfId)) ? Number(ctfId) : ctfId;
    const res = ctfResolve(key);
    return ctfOpenTab(res.url, 0);
}

/* Terminal flow: called from the [E] key press / button click (user gesture)
   so the tab is reserved immediately, then the challenge loads once the
   terminal's handshake animation finishes (delayMs). */
function openCTFForTerminal(terminalId, delayMs) {
    const res = ctfResolve(terminalId);

    if (!res.ok) {
        ctfNotify(CTF_MSG_NOT_CONFIGURED);
        return null;
    }

    return ctfOpenTab(res.url, typeof delayMs === 'number' ? delayMs : 0);
}

/* Handy for maintenance / debugging from the console. */
function ctfStatus() {
    return CTF_CONFIG.map(function (c) {
        return { id: c.id, name: c.name, zone: c.zone, url: c.url, ready: isValidCTFUrl(c.url) };
    });
}
