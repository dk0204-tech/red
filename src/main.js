/* ==========================================================================
   THE LAST DATASET — boot orchestration (spec §17, §18, §33).

   health → event → ctfs → progress, all timeboxed and offline-tolerant.
   Refreshes progress on a 30s interval and on window focus — never per frame.
   ========================================================================== */
'use strict';

window.manuMain = (function () {

    const REFRESH_MS = 30000;
    const GATE_KEY = 'manu_offline_guest';   // cleared when the player signs in

    let refreshTimer = null;
    let started = false;

    async function boot() {
        if (started) return;
        started = true;

        // 1. Health + event + CTF config — one round, each independent.
        const healthP = manuApi.health().then(
            d => d,
            err => { throw err; }
        );

        let healthy = false;
        try {
            await healthP;
            healthy = true;
        } catch (err) {
            healthy = false;
        }
        manuState.setOnline(healthy);

        if (healthy) {
            manuApi.event().then(
                d => { if (d && d.event) manuState.setEvent(d.event); },
                () => { /* keep defaults */ }
            );

            try {
                const data = await manuApi.ctfs();
                manuState.setCtfs((data && data.ctfs) || []);
            } catch (err) {
                manuState.loadCachedCtfs();
            }
        } else {
            // Offline: last-known config so terminals still resolve.
            manuState.loadCachedCtfs();
        }

        // 2. Session
        if (manuApi.hasToken()) {
            try {
                const me = await manuApi.me();
                manuState.setSession(me.user, { id: me.user.teamId, name: me.user.teamName });
                await refreshProgress();
            } catch (err) {
                manuApi.clearToken();
                manuState.setSession(null, null);
            }
        }

        // 3. Gate or guest
        const isGuest = safeGet(GATE_KEY) === '1';
        if (!manuState.state.signedIn && healthy && !isGuest && window.manuAuth) {
            manuAuth.show();
        } else if (!manuState.state.signedIn) {
            manuState.state.offlineMode = !healthy || isGuest;
            afterSession();
        }

        // 4. Periodic refresh (not per frame) + instant refresh on focus.
        if (refreshTimer) clearInterval(refreshTimer);
        refreshTimer = setInterval(() => { if (manuState.state.signedIn) refreshProgress(); }, REFRESH_MS);
        window.addEventListener('focus', () => {
            if (manuState.state.signedIn) refreshProgress();
            else probeHealth();
        });
        window.addEventListener('online', probeHealth);
        window.addEventListener('offline', () => manuState.setOnline(false));
    }

    async function probeHealth() {
        try {
            await manuApi.health();
            manuState.setOnline(true);
        } catch (err) {
            manuState.setOnline(false);
        }
    }

    async function refreshProgress() {
        if (!manuApi.hasToken()) return null;
        try {
            const data = await manuApi.progress();
            manuState.setOnline(true);
            manuState.setProgress(data.progress);
            return data.progress;
        } catch (err) {
            if (err && err.isNetwork) manuState.setOnline(false);
            if (err && (err.status === 401 || err.status === 403)) {
                manuApi.clearToken();
                manuState.setSession(null, null);
            }
            return null;
        }
    }

    /** Called after sign-in or guest entry — starts the world sync. */
    async function afterSession() {
        if (manuState.state.signedIn) {
            safeRemove(GATE_KEY);
            await refreshProgress();
        } else {
            // Guest: empty server progress → world runs with local availability.
            manuState.setProgress(null);
        }
        manuState.emit('ready', { signedIn: manuState.state.signedIn });
    }

    async function signIn(payload) {
        const data = await (payload.mode === 'register' ? manuApi.register(payload) : manuApi.login(payload));
        manuApi.setToken(data.token);
        manuState.setSession(data.user, data.team || { id: data.user.teamId, name: data.user.teamName });
        if (window.manuAuth) manuAuth.hide();
        await afterSession();
        return data;
    }

    function continueOffline() {
        safeSet(GATE_KEY, '1');
        manuState.state.offlineMode = true;
        if (window.manuAuth) manuAuth.hide();
        afterSession();
    }

    async function signOut() {
        await manuApi.logout();
        manuApi.clearToken();
        manuState.setSession(null, null);
        manuState.setProgress(null);
        if (window.manuAuth) manuAuth.show();
    }

    /* ------------------------------ helpers ------------------------------ */

    function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
    function safeRemove(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }

    return {
        boot: boot,
        refreshProgress: refreshProgress,
        signIn: signIn,
        continueOffline: continueOffline,
        signOut: signOut
    };
})();
