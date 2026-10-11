/* ============================================================================
   THE LAST DATASET — CTF CONFIGURATION  ( SINGLE SOURCE OF TRUTH )
   ============================================================================
   Exactly 5 CTF locations exist. They are completed IN ORDER:

       CTF 1  GHOST SIGNAL      (Relay District)      — Red Zone CTF 1
       CTF 2  SANCTUARY ARCHIVE (Archive Precinct)
       CTF 3  CHILD DATASET     (Research Block)
       CTF 4  CENTRAL ATRIUM    (Central Plaza)
       CTF 5  BIOARCHIVE        (Bio-Quarantine)

   ► Every entry carries TWO addresses:
       devUrl  the 127.0.0.1 address of the challenge service on the
               developer's own machine. It is used ONLY while the game
               itself is served from a local host (localhost / 127.0.0.1).
       url     the PUBLIC address of the deployed challenge service. It is
               used by any deployed page, and it is empty until the
               organizer sets it — the terminal then stays safely disabled
               ("CTF CHANNEL NOT CONFIGURED") instead of pointing a player
               at their own machine. Keep it a complete https:// address.

   ► Two ways to set the public addresses — do not do both:
       1. Deployed with the game server: set CTF_URL_1 … CTF_URL_5 (see
          .env.example). The server publishes them at GET /api/ctf/links and
          the game picks them up automatically at boot; the values here stay
          as the offline fallback.
       2. Static-only host: fill in the `url` values below before deploying.

   ► CTF 1 ships with the provided Red Zone CTF 1 backend
     (red-zone-ctf1/ — "PRALAYA Archive Terminal"), which listens on
     http://127.0.0.1:8080 by default and is auto-started by `npm start`.
     Point `url` / CTF_URL_1 at your deployed Red Zone instance for the live event.

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
        devUrl: 'http://127.0.0.1:8080',   // local development only
        url: ''                            // Red Zone CTF 1 — PRALAYA Archive Terminal (public address)
    },
    {
        id: 2,
        name: 'SANCTUARY ARCHIVE',
        location: 'ARCHIVE PRECINCT',
        zone: 'zone_vault',
        devUrl: 'http://127.0.0.1:8081',   // local development only
        url: ''                            // Red Zone CTF 2 — THE SILENT EDIT (public address)
    },
    {
        id: 3,
        name: 'CHILD DATASET',
        location: 'RESEARCH BLOCK',
        zone: 'zone_ai',
        devUrl: 'http://127.0.0.1:8082',   // local development only
        url: ''                            // Red Zone CTF 3 — METADATA FORENSICS (public address)
    },
    {
        id: 4,
        name: 'CENTRAL ATRIUM',
        location: 'CENTRAL PLAZA',
        zone: 'zone_atrium',
        devUrl: 'http://127.0.0.1:8090',   // local development only
        url: ''                            // CTF 4 — THE DEADLOCK ENGINE (public address)
    },
    {
        id: 5,
        name: 'BIOARCHIVE',
        location: 'BIO-QUARANTINE',
        zone: 'zone_bio',
        devUrl: 'http://127.0.0.1:8083',   // local development only
        url: ''                            // CTF 5 — THE LAST GATEKEEPER (public address)
    }
]);

/* --------------------------------------------- Environment detection ----- */
/* A page served from a local host is a developer's own machine: only there
   may a challenge be reached at 127.0.0.1. Every other host (the deployed
   site) uses the public address, never a local one. */
function ctfIsLocalPage() {
    try {
        const h = String((typeof location !== 'undefined' && location.hostname) || '').toLowerCase();
        return h === '' || h === 'localhost' || h === '127.0.0.1' ||
               h === '::1' || h === '[::1]' || h.slice(-10) === '.localhost';
    } catch (err) {
        return false;   // unknown host → safest is "not local"
    }
}

/* True for loopback / private-network targets. The launcher refuses these for
   any page that is not itself local, whatever a config value or a server says. */
function ctfIsLocalAddress(url) {
    try {
        const h = new URL(String(url), (typeof location !== 'undefined' && location.href) || 'http://localhost/').hostname.toLowerCase();
        return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' ||
               h === '::1' || h === '[::1]' || h.slice(-10) === '.localhost' ||
               /^10\./.test(h) || /^192\.168\./.test(h) ||
               /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h);
    } catch (err) {
        return true;   // unparseable → treat as unsafe
    }
}

/* The address a terminal must use right now. Never returns a local address
   for a deployed page. */
function ctfEntryUrl(entry) {
    if (!entry) return null;
    if (ctfIsLocalPage()) return entry.devUrl || entry.url || null;
    const url = entry.url || null;
    return (url && ctfIsLocalAddress(url)) ? null : url;
}

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
    const url = ctfEntryUrl(entry);
    return {
        id: entry.id,
        name: entry.name,
        zone: entry.zone,
        url: url,
        ok: isValidCTFUrl(url)
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

/* ==================== Deployment-provided public addresses ================ */
/* GET /api/ctf/links returns the addresses the organizer configured for this
   deployment (server env CTF_URL_1 … CTF_URL_5). They are validated by the
   server's own URL policy before they are handed out, and they are optional:
   without them the compiled `url` values above are used. */

/* Merge a { "1": "https://…" } map into the live config. Returns how many
   addresses were applied. Malformed / disallowed values are ignored. */
function ctfApplyLinks(links) {
    if (!links || typeof links !== 'object') return 0;
    let applied = 0;
    CTF_CONFIG.forEach(function (entry) {
        const candidate = links[entry.id] !== undefined ? links[entry.id] : links[String(entry.id)];
        if (!isValidCTFUrl(candidate)) return;
        // A local address is never acceptable for a deployed page.
        if (!ctfIsLocalPage() && ctfIsLocalAddress(candidate)) return;
        entry.url = candidate;
        applied++;
    });
    return applied;
}

/* One-shot, non-blocking, never fatal — a page without a backend (static
   host) simply keeps the compiled values. */
function ctfRefreshLinks() {
    try {
        return fetch('/api/ctf/links', { headers: { accept: 'application/json' } })
            .then(function (res) { return res.ok ? res.json() : null; })
            .then(function (data) { return data && data.links ? ctfApplyLinks(data.links) : 0; })
            .catch(function () { return 0; });
    } catch (err) {
        return Promise.resolve(0);
    }
}

/* Handy for maintenance / debugging from the console. */
function ctfStatus() {
    return CTF_CONFIG.map(function (c) {
        const url = ctfEntryUrl(c);
        return {
            id: c.id, name: c.name, zone: c.zone,
            url: url,
            ready: isValidCTFUrl(url),
            mode: ctfIsLocalPage() ? 'development' : 'production'
        };
    });
}
