/* Admin dashboard controllers — organizer-only (requireAdmin). */
'use strict';

const db = require('../config/database');
const teams = require('../models/team.model');
const submissions = require('../models/submission.model');
const auditModel = require('../models/audit.model');
const eventService = require('../services/event.service');
const leaderboardService = require('../services/leaderboard.service');
const { asyncHandler, httpError } = require('../middleware/error.middleware');
const v = require('../middleware/validate');

/** GET /api/admin/overview */
const overview = asyncHandler(async (req, res) => {
    const [teamRow, userRow, solveRow, launchRow] = await Promise.all([
        db.one('SELECT count(*)::int AS total, count(*) FILTER (WHERE created_at > now() - interval \'7 days\')::int AS recent FROM teams'),
        db.one('SELECT count(*)::int AS total FROM users'),
        db.one(`SELECT count(*)::int AS total, COALESCE(sum(points), 0)::int AS points FROM submissions WHERE status = 'solved'`),
        db.one('SELECT count(*)::int AS total FROM ctf_launches')
    ]);
    const event = await eventService.getEvent();
    const activity = await require('../models/ctf.model').activity();

    res.json({
        overview: {
            totalTeams: teamRow.total,
            recentTeams: teamRow.recent,
            totalUsers: userRow.total,
            ctfsSolved: solveRow.total,
            totalPoints: solveRow.points,
            totalLaunches: launchRow.total,
            event
        },
        ctfActivity: activity.map(a => ({
            id: a.slug, name: a.name, enabled: !!a.enabled,
            launches: Number(a.launches), solves: Number(a.solves)
        }))
    });
});

/** GET /api/admin/teams */
const listTeams = asyncHandler(async (req, res) => {
    const rows = await teams.listForAdmin();
    res.json({
        teams: rows.map(r => ({
            id: r.id,
            name: r.name,
            joinCode: r.join_code,
            members: Number(r.members),
            solved: Number(r.solved),
            points: Number(r.points),
            lastActivity: r.last_activity || r.last_launch || null,
            createdAt: r.created_at
        }))
    });
});

/** GET /api/admin/submissions */
const listSubmissions = asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 500);
    const rows = await submissions.listForAdmin(limit);
    res.json({
        submissions: rows.map(r => ({
            id: r.id,
            team: r.team,
            user: r.username || null,
            ctf: r.slug,
            ctfName: r.ctf_name,
            sector: r.sector,
            status: r.status,
            points: r.points,
            solvedAt: r.solved_at
        }))
    });
});

/** GET /api/admin/leaderboard */
const adminLeaderboard = asyncHandler(async (req, res) => {
    res.json({ leaderboard: await leaderboardService.getLeaderboard(200) });
});

/** GET /api/admin/event */
const getEvent = asyncHandler(async (req, res) => {
    res.json({ event: await eventService.getEvent() });
});

/** PUT /api/admin/event */
const updateEvent = asyncHandler(async (req, res) => {
    const body = req.body || {};
    let startTime, endTime;
    if (body.start !== undefined) {
        const t = Date.parse(body.start);
        if (Number.isNaN(t)) throw httpError(400, 'Invalid start timestamp.', 'validation_error');
        startTime = new Date(t).toISOString();
    }
    if (body.end !== undefined) {
        const t = Date.parse(body.end);
        if (Number.isNaN(t)) throw httpError(400, 'Invalid end timestamp.', 'validation_error');
        endTime = new Date(t).toISOString();
    }
    if (startTime && endTime && Date.parse(endTime) <= Date.parse(startTime)) {
        throw httpError(400, 'Event end must be after start.', 'validation_error');
    }

    const event = await eventService.updateEvent({
        eventName: body.name !== undefined ? v.str(body, 'name', { max: 80 }) : undefined,
        startTime,
        endTime,
        isActive: body.isActive !== undefined ? !!body.isActive : undefined
    });
    await auditModel.record(req.user.id, 'event.update', { event });
    res.json({ event });
});

/** GET /api/admin/audit */
const audit = asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    res.json({ logs: await auditModel.list(limit) });
});

module.exports = { overview, listTeams, listSubmissions, adminLeaderboard, getEvent, updateEvent, audit };
