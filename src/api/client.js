/* ==========================================================================
   THE LAST DATASET — centralized API client (spec §33).
   Every network call in the game goes through window.manuApi. No scattered
   fetch() anywhere else. All requests are timeboxed so a slow network can
   never freeze the 3D game.
   ========================================================================== */
'use strict';

window.manuApi = (function () {

    const TOKEN_KEY = 'manu_token';
    const DEFAULT_TIMEOUT = 6000;

    class ApiError extends Error {
        constructor(message, status, code) {
            super(message);
            this.name = 'ApiError';
            this.status = status;      // 0 = network failure
            this.code = code || 'error';
            this.isNetwork = status === 0;
        }
    }

    let token = '';
    try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { token = ''; }

    function setToken(next) {
        token = String(next || '');
        try {
            if (token) localStorage.setItem(TOKEN_KEY, token);
            else localStorage.removeItem(TOKEN_KEY);
        } catch (e) { /* private mode — session-only token */ }
    }

    async function request(path, options) {
        const opts = options || {};
        const method = opts.method || 'GET';
        const useAuth = opts.auth !== false;

        const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), opts.timeout || DEFAULT_TIMEOUT) : null;

        const headers = { 'accept': 'application/json' };
        if (opts.body !== undefined) headers['content-type'] = 'application/json';
        if (useAuth && token) headers.authorization = 'Bearer ' + token;

        let res;
        try {
            res = await fetch(path, {
                method: method,
                headers: headers,
                body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
                signal: controller ? controller.signal : undefined
            });
        } catch (err) {
            throw new ApiError('CONNECTION ERROR — the Sanctuary network could not be reached.', 0, 'network');
        } finally {
            if (timer) clearTimeout(timer);
        }

        let data = null;
        try { data = await res.json(); } catch (e) { data = null; }

        if (!res.ok) {
            throw new ApiError(
                (data && data.error) || ('Request failed (' + res.status + ').'),
                res.status,
                (data && data.code) || 'error'
            );
        }
        return data;
    }

    /* --------------------------- game data ------------------------------- */

    const api = {
        /* GET /api/health */
        health: () => request('/api/health', { auth: false }),

        /* GET /api/event — server clock + timestamps */
        event: () => request('/api/event', { auth: false }),

        /* GET /api/ctfs — the ONLY source of CTF URLs */
        ctfs: () => request('/api/ctfs', { auth: false }),

        /* GET /api/ctfs/:id */
        ctf: (id) => request('/api/ctfs/' + encodeURIComponent(id), { auth: false }),

        /* GET /api/progress — requires a session */
        progress: () => request('/api/progress'),

        /* GET /api/leaderboard */
        leaderboard: (limit) => request('/api/leaderboard' + (limit ? '?limit=' + limit : ''), { auth: false }),

        /* POST /api/ctfs/:id/launch — records a visit, never a solve */
        launch: (slug) => request('/api/ctfs/' + encodeURIComponent(slug) + '/launch', {
            method: 'POST', body: {}, timeout: 4000
        }),

        /* ------------------------------ auth ------------------------------ */
        register: (payload) => request('/api/auth/register', { method: 'POST', body: payload, auth: false }),
        login: (payload) => request('/api/auth/login', { method: 'POST', body: payload, auth: false }),
        logout: () => request('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {}),
        me: () => request('/api/auth/me'),

        /* --------------------------- helpers ------------------------------ */
        hasToken: () => !!token,
        setToken: setToken,
        clearToken: () => setToken(''),
        ApiError: ApiError
    };

    return api;
})();
