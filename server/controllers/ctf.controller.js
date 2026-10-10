/* CTF controller — public configuration reads, launch tracking, admin CRUD. */
'use strict';

const ctfService = require('../services/ctf.service');
const progressService = require('../services/progress.service');
const { asyncHandler, httpError } = require('../middleware/error.middleware');
const { launchLimiter } = require('../middleware/rateLimit.middleware');

/** GET /api/ctfs — the ONLY source of CTF URLs for the frontend. */
const list = asyncHandler(async (req, res) => {
    const ctfs = await ctfService.list({ includeDisabled: false });
    let statuses = null;
    if (req.user) {
        const progress = await progressService.getProgress(req.user);
        statuses = progress.ctfs;
    }
    res.json({
        ctfs: ctfs.map(c => Object.assign({}, c, { status: statuses ? statuses[c.slug] : null }))
    });
});

/** GET /api/ctfs/:id — accepts slug, numeric id or zone id. */
const getOne = asyncHandler(async (req, res) => {
    const row = await ctfService.get(req.params.id);
    if (!row.enabled && !(req.user && req.user.role === 'admin')) {
        throw httpError(410, 'This CTF is currently disabled.', 'ctf_disabled');
    }
    const ctf = require('../models/ctf.model').toPublic(row);
    let status = null;
    if (req.user) {
        const progress = await progressService.getProgress(req.user);
        status = progress.ctfs[ctf.slug] || null;
    }
    res.json({ ctf: Object.assign({}, ctf, { status }) });
});

/** POST /api/ctfs/:id/launch — records a visit, never a solve. */
const launch = [
    launchLimiter,
    asyncHandler(async (req, res) => {
        const result = await ctfService.recordLaunch(req.params.id, req.user, req.ip);
        res.status(201).json(result);
    })
];

/* ----------------------------- admin CRUD -------------------------------- */

const adminList = asyncHandler(async (req, res) => {
    const [ctfs, activity] = await Promise.all([
        ctfService.list({ includeDisabled: true }),
        require('../models/ctf.model').activity()
    ]);
    const activityBySlug = new Map(activity.map(a => [a.slug, a]));
    res.json({
        ctfs: ctfs.map(c => Object.assign({}, c, {
            launches: activityBySlug.get(c.slug) ? activityBySlug.get(c.slug).launches : 0,
            solves: activityBySlug.get(c.slug) ? activityBySlug.get(c.slug).solves : 0
        }))
    });
});

const adminCreate = asyncHandler(async (req, res) => {
    const ctf = await ctfService.create(req.body || {}, req.user);
    res.status(201).json({ ctf });
});

const adminUpdate = asyncHandler(async (req, res) => {
    const ctf = await ctfService.update(req.params.id, req.body || {}, req.user);
    res.json({ ctf });
});

const adminSetEnabled = asyncHandler(async (req, res) => {
    const enabled = req.body && typeof req.body.enabled === 'boolean' ? req.body.enabled : true;
    const ctf = await ctfService.setEnabled(req.params.id, enabled, req.user);
    res.json({ ctf });
});

const adminDelete = asyncHandler(async (req, res) => {
    const result = await ctfService.remove(req.params.id, req.user);
    res.json(result);
});

module.exports = { list, getOne, launch, adminList, adminCreate, adminUpdate, adminSetEnabled, adminDelete };
