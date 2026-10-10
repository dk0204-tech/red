/* ============================================================
   CTF 5 — THE LAST GATEKEEPER: SPLIT SEAL — app shell
   hash router: #/map → #/approach → #/challenge → #/recovery
   Server is the only authority on completion state.
   ============================================================ */
(function () {
  'use strict';

  const ROUTES = ['map', 'approach', 'challenge', 'recovery'];
  let status = null;          // last /api/status payload
  let pollTimer = null;
  let cinTimer = null;
  let cinTemplate = null;

  const $ = (id) => document.getElementById(id);

  /* ------------------------------------------------------------ helpers */
  function currentRoute() {
    const h = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
    return ROUTES.indexOf(h) >= 0 ? h : 'map';
  }

  async function fetchStatus() {
    try {
      const r = await fetch('/api/status', { cache: 'no-store' });
      if (!r.ok) throw new Error('http ' + r.status);
      status = await r.json();
      renderStatus();
      return status;
    } catch (e) {
      status = { offline: true, backend: { ok: false, detail: String(e.message || e) }, solved: false };
      renderStatus();
      return status;
    }
  }

  function renderStatus() {
    const topPill = $('svc-pill');
    const topText = $('svc-text');
    const backendOk = !!(status.backend && status.backend.ok);
    const solved = !!status.solved;

    if (topPill) {
      topPill.dataset.state = solved ? 'solved' : (backendOk ? 'live' : 'down');
      topText.textContent = solved ? 'FRAGMENT RECOVERED' : (backendOk ? 'GATEKEEPER LIVE' : 'SERVICE OFFLINE');
    }

    // map card
    const cardState = $('zc-ctf5-state');
    const cardCta = $('zc-ctf5-cta');
    if (cardState) {
      cardState.textContent = solved ? 'ARCHIVE FRAGMENT RECOVERED' : 'ARCHIVE FRAGMENT: SEALED — WITNESS REQUIRED';
      cardState.dataset.solved = solved ? '1' : '0';
    }
    if (cardCta) cardCta.textContent = solved ? 'RETURN TO THE GATE →' : 'ENTER RED ZONE →';

    // challenge connection panel
    const conn = $('conn-state');
    if (conn) {
      if (backendOk) {
        conn.dataset.ok = '1';
        conn.textContent = `SERVICE LIVE — ${status.backend.label}`;
      } else {
        conn.dataset.ok = '0';
        conn.textContent = `SERVICE UNAVAILABLE — ${(status.backend && status.backend.detail) || 'unknown error'}`;
      }
    }

    // nc command uses the real host/port
    const nc = $('nc-cmd');
    if (nc && status.tcpPort) {
      const host = location.hostname || 'localhost';
      nc.textContent = `nc ${host} ${status.tcpPort}`;
    }

    // bypass / recovery entry
    const bypass = $('bypass');
    if (bypass) bypass.hidden = !solved;
    const msg = $('flag-msg');
    if (msg && solved && msg.dataset.ok !== '1') {
      msg.textContent = 'VERIFIED — the archive acknowledges your fragment.';
      msg.dataset.ok = '1';
    }
  }

  /* ------------------------------------------------------------- router */
  function show(route) {
    ROUTES.forEach((r) => {
      const el = $('screen-' + r);
      if (el) el.hidden = r !== route;
    });
    document.body.dataset.screen = route;

    const leaf = $('crumb-leaf');
    const crumbs = { map: 'WORLD MAP', approach: 'RED-ZONE-04 APPROACH', challenge: 'SPLIT SEAL', recovery: 'ARCHIVE RECOVERY' };
    if (leaf) leaf.textContent = crumbs[route] || 'WORLD MAP';

    // lifecycle
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (cinTimer) { clearTimeout(cinTimer); cinTimer = null; }

    if (route === 'map') {
      fetchStatus();
      pollTimer = setInterval(fetchStatus, 8000);
    }
    if (route === 'approach') {
      runCinematic();
      fetchStatus();
    }
    if (route === 'challenge') {
      if (window.Terminal) window.Terminal.ensure();
      fetchStatus();
      pollTimer = setInterval(fetchStatus, 2500);
      const fi = $('flag-input');
      if (fi && status && status.solved) fi.blur();
    }
    if (route === 'recovery') {
      enterRecovery();
    }
    window.scrollTo(0, 0);
  }

  function route() { show(currentRoute()); }
  window.addEventListener('hashchange', route);

  /* --------------------------------------------------------- cinematic */
  function runCinematic() {
    const cin = $('cin');
    if (!cin) return;
    if (cinTemplate === null) cinTemplate = cin.innerHTML;
    else cin.innerHTML = cinTemplate; // restarts the staged reveal
    fetchStatus().then((st) => {
      const title = cin.querySelector('.cin-title');
      if (st && st.solved && title) title.setAttribute('data-text', 'RED-ZONE-04 // OPEN');
    });
    cinTimer = setTimeout(() => {
      if (currentRoute() === 'approach') location.hash = '#/challenge';
    }, 5600);
  }

  /* ---------------------------------------------------------- recovery */
  function enterRecovery() {
    const bar = $('rec-bar'); const s1 = $('rec-1'); const s2 = $('rec-2');
    const frag = $('rec-frag'); const blocked = $('rec-blocked'); const back = $('rec-back');
    // reset
    if (s2) s2.hidden = true;
    if (frag) frag.hidden = true;
    if (bar) bar.classList.remove('run');
    if (blocked) blocked.hidden = true;
    if (back) back.hidden = true;

    fetchStatus().then((st) => {
      if (st && st.solved) {
        setTimeout(() => bar && bar.classList.add('run'), 250);
        setTimeout(() => { if (s2) s2.hidden = false; }, 1900);
        setTimeout(() => { if (frag) frag.hidden = false; }, 2700);
      } else {
        if (blocked) blocked.hidden = false;
        if (back) back.hidden = false;
      }
    });
  }

  /* --------------------------------------------------------------- wire */
  function boot() {
    // ash particles
    const ash = $('ash');
    if (ash) {
      for (let i = 0; i < 16; i++) {
        const s = document.createElement('i');
        s.style.left = (Math.random() * 100).toFixed(2) + '%';
        s.style.animationDuration = (9 + Math.random() * 14).toFixed(1) + 's';
        s.style.animationDelay = (-Math.random() * 18).toFixed(1) + 's';
        s.style.opacity = (0.25 + Math.random() * 0.5).toFixed(2);
        s.style.transform = 'scale(' + (0.6 + Math.random() * 1.6).toFixed(2) + ')';
        ash.appendChild(s);
      }
    }

    // restrained glitch pulses on titles
    setInterval(() => {
      document.querySelectorAll('.glitch').forEach((g) => {
        g.classList.add('gx');
        setTimeout(() => g.classList.remove('gx'), 480);
      });
    }, 7000);

    // map → approach
    const card5 = $('card-ctf5');
    if (card5) card5.addEventListener('click', () => { location.hash = '#/approach'; });

    // cinematic actions (delegated — innerHTML is re-rendered each visit)
    const approach = $('screen-approach');
    if (approach) {
      approach.addEventListener('click', (e) => {
        if (e.target && e.target.id === 'cin-breach') location.hash = '#/challenge';
      });
    }

    // copy nc command
    const copyBtn = $('copy-nc');
    if (copyBtn) copyBtn.addEventListener('click', () => {
      const txt = $('nc-cmd').textContent;
      const done = () => { copyBtn.textContent = 'COPIED'; setTimeout(() => (copyBtn.textContent = 'COPY'), 1400); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, done);
      else done();
    });

    // flag submission — server-side validation only
    const form = $('flag-form');
    if (form) form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = $('flag-input');
      const msg = $('flag-msg');
      const value = (input.value || '').trim();
      msg.dataset.ok = '';
      if (!value) { msg.textContent = 'The gatekeeper waits for a fragment.'; return; }
      msg.textContent = 'VERIFYING…';
      try {
        const r = await fetch('/api/flag', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ flag: value }),
        });
        const data = await r.json();
        if (data.ok) {
          msg.textContent = '✓ ' + (data.msg || 'ARCHIVE FRAGMENT VERIFIED');
          msg.dataset.ok = '1';
          input.value = '';
          fetchStatus();
        } else {
          msg.textContent = '✗ ' + (data.msg || 'REJECTED');
          msg.dataset.ok = '0';
        }
      } catch (err) {
        msg.textContent = '✗ transport error — is the CTF 5 server running?';
        msg.dataset.ok = '0';
      }
    });

    // recovery entry / return
    const openRec = $('open-recovery');
    if (openRec) openRec.addEventListener('click', () => { location.hash = '#/recovery'; });
    const ret = $('rec-return');
    if (ret) ret.addEventListener('click', () => { location.hash = '#/map'; });
    const back = $('rec-back');
    if (back) back.addEventListener('click', () => { location.hash = '#/map'; });

    // boot state
    fetchStatus().then(route);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
