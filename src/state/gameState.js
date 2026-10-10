/* ==========================================================================
   THE LAST DATASET — game state store (spec §32 state/gameState.js).
   Single source of truth for: auth session, server event clock, CTF config
   (from GET /api/ctfs — the ONLY source of CTF URLs), team progress, and
   local preferences (graphics/audio — the only thing LocalStorage keeps).
   ========================================================================== */
'use strict';

window.manuState = (function () {

    const PREFS_KEY = 'MANU_PREFS_V1';
    const CTF_CACHE_KEY = 'MANU_CTF_CACHE_V1';

    const state = {
        online: false,          // backend reachable on last sync
        signedIn: false,
        offlineMode: false,     // player chose to continue without an account
        user: null,
        team: null,
        event: null,            // { start, end, now, status, remainingMs, … }
        eventSyncedAt: 0,       // client ms timestamp when event.now was read
        ctfs: [],               // enabled CTFs from the API
        ctfByZone: {},          // zone id → ctf
        ctfBySlug: {},          // slug → ctf
        progress: null,         // server progress payload
        prefs: {}               // graphics/audio only
    };

    /* ------------------------------ events -------------------------------- */

    const listeners = {};

    function on(eventName, callback) {
        (listeners[eventName] = listeners[eventName] || []).push(callback);
        return callback;
    }

    function emit(eventName, payload) {
        const list = listeners[eventName];
        if (list) for (let i = 0; i < list.length; i++) {
            try { list[i](payload); } catch (err) { console.warn('manuState listener error:', err); }
        }
    }

    /* ------------------------------- prefs -------------------------------- */

    function loadPrefs() {
        try {
            const raw = localStorage.getItem(PREFS_KEY);
            state.prefs = raw ? JSON.parse(raw) : {};
        } catch (e) { state.prefs = {}; }
        if (typeof state.prefs.shadows !== 'boolean') state.prefs.shadows = true;
        if (typeof state.prefs.reducedMotion !== 'boolean') state.prefs.reducedMotion = false;
        if (typeof state.prefs.muted !== 'boolean') state.prefs.muted = false;
    }

    function setPref(key, value) {
        state.prefs[key] = value;
        try { localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs)); } catch (e) { /* ignore */ }
        emit('prefs', state.prefs);
    }

    /* ------------------------------ setters ------------------------------- */

    function setOnline(online) {
        if (state.online !== online) {
            state.online = online;
            emit('connection', online);
        }
    }

    function setSession(user, team) {
        state.user = user || null;
        state.team = team || null;
        state.signedIn = !!user;
        emit('session', { user: state.user, team: state.team });
    }

    function setEvent(event) {
        state.event = event;
        state.eventSyncedAt = Date.now();
        emit('event', event);
    }

    function setCtfs(ctfs) {
        state.ctfs = Array.isArray(ctfs) ? ctfs : [];
        state.ctfByZone = {};
        state.ctfBySlug = {};
        for (const c of state.ctfs) {
            state.ctfBySlug[c.slug] = c;
            if (c.zone) state.ctfByZone[c.zone] = c;
        }
        // Cache for offline resilience (URLs were validated server-side).
        try { localStorage.setItem(CTF_CACHE_KEY, JSON.stringify({ at: Date.now(), ctfs: state.ctfs })); } catch (e) { /* ignore */ }
        emit('ctfs', state.ctfs);
    }

    function loadCachedCtfs() {
        try {
            const raw = localStorage.getItem(CTF_CACHE_KEY);
            if (!raw) return false;
            const data = JSON.parse(raw);
            if (!data || !Array.isArray(data.ctfs) || !data.ctfs.length) return false;
            state.ctfs = data.ctfs;
            state.ctfByZone = {};
            state.ctfBySlug = {};
            for (const c of state.ctfs) {
                state.ctfBySlug[c.slug] = c;
                if (c.zone) state.ctfByZone[c.zone] = c;
            }
            return true;
        } catch (e) { return false; }
    }

    function setProgress(progress) {
        const previous = state.progress;
        state.progress = progress || null;
        emit('progress', { progress: state.progress, previous: previous });
    }

    /* ------------------------------ getters ------------------------------- */

    function ctfForZone(zoneId) {
        return state.ctfByZone[zoneId] || null;
    }

    function ctfForSlug(slug) {
        return state.ctfBySlug[slug] || null;
    }

    /** CTF status: locked | available | visited | solved (server-authoritative). */
    function statusForCtf(slugOrZone) {
        if (!state.progress) return 'available';
        const ctf = state.ctfBySlug[slugOrZone];
        const slug = ctf ? slugOrZone : slugOrZone; // zone ids resolve too
        if (state.progress.ctfs && state.progress.ctfs[slug] !== undefined) return state.progress.ctfs[slug];
        const byZone = state.ctfByZone[slugOrZone];
        if (byZone && state.progress.ctfs) return state.progress.ctfs[byZone.slug] || 'available';
        return 'available';
    }

    function restoration() {
        return state.progress ? (state.progress.restoration || 0) : 0;
    }

    function solvedCount() {
        return state.progress ? (state.progress.solvedCount || 0) : 0;
    }

    function totalCount() {
        if (state.progress && state.progress.totalCount) return state.progress.totalCount;
        return state.ctfs.length || 0;
    }

    /** Remaining ms computed from the SERVER clock (never the client clock). */
    function remainingMs() {
        if (!state.event) return null;
        const serverNow = Date.parse(state.event.now);
        if (Number.isNaN(serverNow)) return null;
        const elapsedSinceSync = Date.now() - state.eventSyncedAt;
        const end = Date.parse(state.event.end);
        if (Number.isNaN(end)) return null;
        return Math.max(0, end - (serverNow + elapsedSinceSync));
    }

    loadPrefs();

    return {
        state: state,
        on: on,
        emit: emit,
        setOnline: setOnline,
        setSession: setSession,
        setEvent: setEvent,
        setCtfs: setCtfs,
        loadCachedCtfs: loadCachedCtfs,
        setProgress: setProgress,
        ctfForZone: ctfForZone,
        ctfForSlug: ctfForSlug,
        statusForCtf: statusForCtf,
        restoration: restoration,
        solvedCount: solvedCount,
        totalCount: totalCount,
        remainingMs: remainingMs,
        setPref: setPref,
        loadPrefs: loadPrefs
    };
})();
