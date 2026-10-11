/* ==========================================================================
   CTF verification controller — the main game's flag-verification surface.

     POST /api/ctf/session        mint a signed anonymous session
     GET  /api/ctf/state          server-authoritative progression for it
     POST /api/ctf/verify         { ctf, flag } → validated completion
     GET  /api/ctf/links          public challenge addresses for this deployment
     GET  /api/ctf/reward/:which  CHILD / PARENT dataset download (authorized)

   Verification is authoritative: a completion is written only after the
   submitted flag is validated against that specific challenge's own logic.
   Opening a challenge, clicking a button or claiming progress client-side
   never completes anything.
   ========================================================================== */
'use strict';

const fs = require('fs');
const verifiers = require('../services/ctf-verifiers');
const progress = require('../services/ctf-progress.service');
const env = require('../config/env');
const logger = require('../utils/logger');
const { validateCtfUrl } = require('../utils/url');
const { asyncHandler, httpError } = require('../middleware/error.middleware');

/* The session token may arrive as a header (API calls) or a query parameter
   (dataset downloads opened in a new tab, where headers cannot be set). */
function tokenFrom(req) {
    const header = req.headers['x-ctf-session'];
    if (typeof header === 'string' && header) return header.trim();
    const auth = req.headers.authorization;
    if (auth && /^Bearer /i.test(auth)) return auth.slice(7).trim();
    if (req.query && typeof req.query.t === 'string' && req.query.t) return req.query.t.trim();
    if (req.body && typeof req.body.session === 'string' && req.body.session) return req.body.session.trim();
    return null;
}

function requireSession(req) {
    const id = progress.parseToken(tokenFrom(req));
    if (!id) throw httpError(401, 'No valid CTF session — open a terminal first.', 'no_session');
    return id;
}

const CTF_NUMBERS = [1, 2, 3, 4, 5];

/**
 * GET /api/ctf/links — the public address of each in-world challenge service
 * for THIS deployment (CTF_URL_1 … CTF_URL_5). Public on purpose: it is the
 * same address every player is sent to, never a flag or a secret.
 *
 * Every value passes the server's own URL policy first, so a localhost or
 * http:// address can never be handed to players from a production instance,
 * and an empty / rejected value is reported as null (terminal stays safely
 * "not configured").
 */
const links = asyncHandler(async (req, res) => {
    const out = {};
    CTF_NUMBERS.forEach((n) => {
        const raw = env.CTF_PUBLIC_URLS[n];
        if (!raw) { out[n] = null; return; }
        const check = validateCtfUrl(raw);
        if (!check.ok) {
            logger.warn('CTF_URL_' + n + ' rejected by the URL policy', { reason: check.reason });
            out[n] = null;
            return;
        }
        out[n] = check.url;
    });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ links: out });
});

/** POST /api/ctf/session */
const createSession = asyncHandler(async (req, res) => {
    const issued = progress.issueSession();
    const state = progress.stateOf(issued.id, true);
    res.status(201).json({ session: issued.token, state: state });
});

/** GET /api/ctf/state */
const getState = asyncHandler(async (req, res) => {
    const id = requireSession(req);
    res.json({ state: progress.stateOf(id, false) });
});

/** POST /api/ctf/verify — { ctf: 1..5, flag: "RZ{...}" } */
const verifyFlag = asyncHandler(async (req, res) => {
    const id = requireSession(req);

    const body = req.body || {};
    const ctf = Number(body.ctf);
    if (!verifiers.isKnownCtf(ctf)) {
        throw httpError(400, 'Unknown CTF.', 'invalid_ctf');
    }

    // Locked terminals cannot be completed, even by a crafted request.
    if (!progress.isUnlocked(id, ctf)) {
        throw httpError(403, 'This terminal is still locked.', 'ctf_locked');
    }

    if (typeof body.flag !== 'string' || !body.flag.trim()) {
        throw httpError(400, 'Enter the flag from the challenge.', 'empty_flag');
    }

    const gate = progress.noteAttempt(id);
    if (!gate.ok) throw httpError(429, 'Too many attempts — wait a moment.', 'rate_limited');

    const verdict = verifiers.verify(ctf, body.flag);

    // A broken/missing challenge verifier must never become a free pass.
    if (verdict.reason === 'unavailable') {
        throw httpError(503, 'Challenge verifier unavailable — try again shortly.', 'verifier_unavailable');
    }

    if (!verdict.ok) {
        return res.json({
            accepted: false,
            code: 'invalid_flag',
            message: 'ACCESS DENIED — INVALID FLAG',
            state: progress.stateOf(id, false)
        });
    }

    const recorded = progress.markSolved(id, ctf);
    const state = recorded.state;

    return res.json({
        accepted: true,
        duplicate: recorded.alreadySolved,
        message: 'FLAG ACCEPTED',
        ctf: ctf,
        name: verifiers.meta(ctf).name,
        nextUnlocked: state.unlocked.filter(n => state.solved.indexOf(n) === -1),
        childDatasetUnlocked: state.childDatasetUnlocked,
        parentDatasetUnlocked: state.parentDatasetUnlocked,
        finalExitUnlocked: state.finalExitUnlocked,
        state: state
    });
});

/** GET /api/ctf/reward/:which — child | parent */
const downloadReward = asyncHandler(async (req, res) => {
    const id = requireSession(req);
    const which = String(req.params.which || '').toLowerCase();

    const result = progress.reward(id, which);
    if (!result.ok) throw httpError(result.status, 'Reward not available.', result.code);

    // Authorized: stream the REAL dataset, never a copy or placeholder.
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Reward', which);
    res.download(result.file, result.filename, (err) => {
        if (err && !res.headersSent) res.status(500).json({ error: 'Download failed.', code: 'download_failed' });
    });
});

module.exports = { createSession, getState, verifyFlag, links, downloadReward };
