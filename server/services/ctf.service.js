/* ==========================================================================
   CTF service — configuration CRUD, URL enforcement, launch tracking and
   the secure completion callback used by external CTF applications.
   ========================================================================== */
'use strict';

const crypto = require('crypto');
const ctfModel = require('../models/ctf.model');
const submissions = require('../models/submission.model');
const teams = require('../models/team.model');
const audit = require('../models/audit.model');
const env = require('../config/env');
const { validateCtfUrl } = require('../utils/url');
const { httpError } = require('../middleware/error.middleware');

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ZONE_RE = /^zone_[a-z0-9_]+$/;

function hashIp(ip) {
    if (!ip) return null;
    return crypto.createHash('sha256').update(String(ip)).digest('hex').slice(0, 32);
}

/* ----------------------------- validation -------------------------------- */

function normalizeCtfInput(body, existing) {
    const base = existing || {};
    const slug = String(body.slug !== undefined ? body.slug : base.slug || '').trim().toLowerCase();
    if (!SLUG_RE.test(slug)) {
        throw httpError(400, 'Slug must be lowercase words separated by hyphens (e.g. pralaya-archive).', 'invalid_slug');
    }

    const name = String(body.name !== undefined ? body.name : base.name || '').trim();
    if (!name || name.length > 80) throw httpError(400, 'Name is required (max 80 chars).', 'invalid_name');

    const sector = String(body.sector !== undefined ? body.sector : base.sector || 'community').trim().toLowerCase();
    if (!ctfModel.SECTOR_ORDER.includes(sector)) {
        throw httpError(400, `Sector must be one of: ${ctfModel.SECTOR_ORDER.join(', ')}.`, 'invalid_sector');
    }

    const zoneRaw = body.zone !== undefined ? body.zone : (base.zone === undefined ? '' : base.zone);
    const zone = zoneRaw === null ? null : String(zoneRaw).trim();
    if (zone && !ZONE_RE.test(zone)) throw httpError(400, 'Zone must look like "zone_vault".', 'invalid_zone');

    const points = Number(body.points !== undefined ? body.points : base.points);
    if (!Number.isInteger(points) || points < 0 || points > 100000) {
        throw httpError(400, 'Points must be an integer between 0 and 100000.', 'invalid_points');
    }

    const difficulty = String(body.difficulty !== undefined ? body.difficulty : base.difficulty || 'MEDIUM').trim().toUpperCase();
    if (!['EASY', 'MEDIUM', 'HARD'].includes(difficulty)) {
        throw httpError(400, 'Difficulty must be EASY, MEDIUM or HARD.', 'invalid_difficulty');
    }

    const displayOrder = Number(body.displayOrder !== undefined ? body.displayOrder : base.display_order || base.displayOrder || 1);
    if (!Number.isInteger(displayOrder) || displayOrder < 1 || displayOrder > 999) {
        throw httpError(400, 'Order must be an integer between 1 and 999.', 'invalid_order');
    }

    const externalUrlRaw = body.externalUrl !== undefined ? body.externalUrl : (base.external_url !== undefined ? base.external_url : '');
    const urlCheck = validateCtfUrl(externalUrlRaw);
    if (!urlCheck.ok) throw httpError(400, 'External URL rejected: ' + urlCheck.reason, 'invalid_url');

    const enabled = body.enabled !== undefined ? !!body.enabled : (base.enabled !== undefined ? !!base.enabled : true);

    return {
        slug,
        name,
        sector,
        zone: zone || null,
        description: String(body.description !== undefined ? body.description : base.description || '').slice(0, 1000),
        points,
        difficulty,
        externalUrl: urlCheck.url,
        enabled,
        displayOrder,
        terminalLabel: String(body.terminalLabel !== undefined ? body.terminalLabel : base.terminal_label || name).slice(0, 80),
        fragmentId: String(body.fragmentId !== undefined ? body.fragmentId : base.fragment_id || '').slice(0, 40) || null
    };
}

/* ------------------------------ queries ---------------------------------- */

async function list({ includeDisabled } = {}) {
    const rows = includeDisabled ? await ctfModel.listAll() : await ctfModel.listEnabled();
    return rows.map(ctfModel.toPublic);
}

async function get(ref) {
    const row = await ctfModel.findRef(ref);
    if (!row) throw httpError(404, 'CTF not found.', 'not_found');
    return row;
}

async function create(body, actor) {
    const data = normalizeCtfInput(body, null);
    const clash = await ctfModel.findBySlug(data.slug);
    if (clash) throw httpError(409, 'A CTF with that slug already exists.', 'slug_taken');
    const row = await ctfModel.create(data);
    await audit.record(actor && actor.id, 'ctf.create', { slug: row.slug });
    return ctfModel.toPublic(row);
}

async function update(ref, body, actor) {
    const existing = await ctfModel.findRef(ref);
    if (!existing) throw httpError(404, 'CTF not found.', 'not_found');
    const data = normalizeCtfInput(body, existing);
    if (data.slug !== existing.slug) {
        const clash = await ctfModel.findBySlug(data.slug);
        if (clash) throw httpError(409, 'A CTF with that slug already exists.', 'slug_taken');
    }
    const row = await ctfModel.update(existing.id, data);
    await audit.record(actor && actor.id, 'ctf.update', { slug: row.slug });
    return ctfModel.toPublic(row);
}

async function setEnabled(ref, enabled, actor) {
    const existing = await ctfModel.findRef(ref);
    if (!existing) throw httpError(404, 'CTF not found.', 'not_found');
    const row = await ctfModel.update(existing.id, Object.assign({}, normalizeCtfInput({}, existing), { enabled: !!enabled }));
    await audit.record(actor && actor.id, enabled ? 'ctf.enable' : 'ctf.disable', { slug: row.slug });
    return ctfModel.toPublic(row);
}

async function remove(ref, actor) {
    const existing = await ctfModel.findRef(ref);
    if (!existing) throw httpError(404, 'CTF not found.', 'not_found');
    await ctfModel.remove(existing.id);
    await audit.record(actor && actor.id, 'ctf.delete', { slug: existing.slug });
    return { deleted: true, slug: existing.slug };
}

/* --------------------------- launch tracking ----------------------------- */

/** POST /api/ctfs/:id/launch — a visit, NEVER a solve. */
async function recordLaunch(ref, user, ip) {
    const row = await get(ref);
    if (!row.enabled) throw httpError(410, 'This CTF is currently disabled.', 'ctf_disabled');
    if (!row.external_url) throw httpError(409, 'This CTF channel is not configured yet.', 'ctf_not_configured');

    await submissions.recordLaunch({
        ctfId: row.id,
        userId: user ? user.id : null,
        teamId: user ? user.teamId : null,
        ipHash: hashIp(ip)
    });
    await audit.record(user && user.id, 'ctf.launch', { slug: row.slug });
    return { launched: true, id: row.slug, externalUrl: row.external_url, name: row.name, terminalLabel: row.terminal_label };
}

/* ------------------- secure completion callback (service) ----------------- */

function timingSafeEqual(a, b) {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

function extractServiceToken(req) {
    const header = req.headers.authorization;
    if (header && /^Bearer /i.test(header)) return header.slice(7).trim();
    if (req.headers['x-service-token']) return String(req.headers['x-service-token']).trim();
    if (req.body && typeof req.body.serviceToken === 'string') return req.body.serviceToken;
    return null;
}

/**
 * POST /api/integrations/ctf-complete
 * Called ONLY by external CTF backends holding CTF_SERVICE_TOKEN.
 * Points are taken from our own database — the caller cannot award points.
 */
async function completeFromService(body, req) {
    const token = extractServiceToken(req);
    if (!token || !env.CTF_SERVICE_TOKEN || !timingSafeEqual(token, env.CTF_SERVICE_TOKEN)) {
        await audit.record(null, 'integration.denied', { ip: hashIp(req.ip) });
        throw httpError(401, 'Invalid service token.', 'invalid_service_token');
    }

    if (!body || typeof body !== 'object') throw httpError(400, 'JSON body required.', 'validation_error');

    const ctf = await ctfModel.findRef(body.ctfId !== undefined ? body.ctfId : body.ctf);
    if (!ctf) throw httpError(404, 'Unknown CTF.', 'not_found');
    if (!ctf.enabled) throw httpError(410, 'CTF is disabled.', 'ctf_disabled');

    const result = String(body.result || 'solved').toLowerCase();
    if (!['solved', 'attempt'].includes(result)) {
        throw httpError(400, 'result must be "solved" or "attempt".', 'validation_error');
    }

    // Resolve team by id, join code or name.
    let team = null;
    const teamRef = body.teamId !== undefined ? body.teamId : body.team;
    if (teamRef === undefined || teamRef === null || teamRef === '') {
        throw httpError(400, 'teamId (id, join code or name) is required.', 'validation_error');
    }
    const refStr = String(teamRef).trim();
    if (/^\d+$/.test(refStr)) team = await teams.findById(Number(refStr));
    if (!team) team = await teams.findByCode(refStr);
    if (!team) team = await teams.findByName(refStr);
    if (!team) throw httpError(404, 'Unknown team.', 'team_not_found');

    if (result !== 'solved') {
        await audit.record(null, 'integration.attempt', { ctf: ctf.slug, team: team.name });
        return { accepted: true, result: 'attempt', ctf: ctf.slug, team: team.name };
    }

    const already = await submissions.findSolved(team.id, ctf.id);
    const outcome = await submissions.insertSolve({ userId: null, teamId: team.id, ctfId: ctf.id, points: ctf.points });
    await audit.record(null, 'integration.complete', {
        ctf: ctf.slug, team: team.name, pointsAwarded: outcome.inserted ? ctf.points : 0
    });

    return {
        accepted: true,
        result: 'solved',
        ctf: ctf.slug,
        team: team.name,
        points: outcome.inserted ? ctf.points : 0,
        duplicate: !outcome.inserted,
        firstBlood: !already && outcome.inserted
    };
}

module.exports = {
    list, get, create, update, setEnabled, remove,
    recordLaunch, completeFromService, normalizeCtfInput
};
