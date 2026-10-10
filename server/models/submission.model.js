/* submissions (progress) + ctf_launches models. */
'use strict';

const db = require('../config/database');

/* ------------------------------- launches -------------------------------- */

async function recordLaunch({ ctfId, userId, teamId, ipHash }) {
    const res = await db.query(
        'INSERT INTO ctf_launches (ctf_id, user_id, team_id, ip_hash) VALUES ($1, $2, $3, $4) RETURNING *',
        [ctfId, userId || null, teamId || null, ipHash || null]
    );
    return res.rows[0];
}

async function visitedCtfIds(teamId) {
    if (!teamId) return [];
    const res = await db.query(
        'SELECT DISTINCT ctf_id FROM ctf_launches WHERE team_id = $1',
        [teamId]
    );
    return res.rows.map(r => r.ctf_id);
}

async function launchCount(teamId) {
    if (!teamId) return 0;
    const row = await db.one('SELECT count(*)::int AS n FROM ctf_launches WHERE team_id = $1', [teamId]);
    return row ? row.n : 0;
}

/* ------------------------------ submissions ------------------------------ */

async function findSolved(teamId, ctfId) {
    return db.one(
        "SELECT * FROM submissions WHERE team_id = $1 AND ctf_id = $2 AND status = 'solved'",
        [teamId, ctfId]
    );
}

/** Insert a solve. Returns { inserted: boolean } — unique(team_id, ctf_id) prevents duplicates. */
async function insertSolve({ userId, teamId, ctfId, points }) {
    const res = await db.query(
        `INSERT INTO submissions (user_id, team_id, ctf_id, status, points)
         VALUES ($1, $2, $3, 'solved', $4)
         ON CONFLICT (team_id, ctf_id) DO NOTHING
         RETURNING *`,
        [userId || null, teamId, ctfId, points]
    );
    return { inserted: res.rows.length > 0, row: res.rows[0] || null };
}

async function solvedCtfIds(teamId) {
    if (!teamId) return [];
    const res = await db.query(
        "SELECT ctf_id FROM submissions WHERE team_id = $1 AND status = 'solved'",
        [teamId]
    );
    return res.rows.map(r => r.ctf_id);
}

async function solvedDetails(teamId) {
    if (!teamId) return [];
    const res = await db.query(
        `SELECT s.ctf_id, c.slug, s.solved_at, s.points
         FROM submissions s JOIN ctf_challenges c ON c.id = s.ctf_id
         WHERE s.team_id = $1 AND s.status = 'solved'`,
        [teamId]
    );
    return res.rows;
}

async function listForAdmin(limit) {
    const res = await db.query(
        `SELECT s.id, s.status, s.solved_at, s.points,
                u.username, t.name AS team, c.slug, c.name AS ctf_name, c.sector
         FROM submissions s
         LEFT JOIN users u ON u.id = s.user_id
         JOIN teams t ON t.id = s.team_id
         JOIN ctf_challenges c ON c.id = s.ctf_id
         ORDER BY s.solved_at DESC
         LIMIT $1`,
        [limit || 200]
    );
    return res.rows;
}

module.exports = { recordLaunch, visitedCtfIds, launchCount, findSolved, insertSolve, solvedCtfIds, solvedDetails, listForAdmin };
