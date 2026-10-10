/* teams model — teams of 1–2 participants. */
'use strict';

const db = require('../config/database');

const MAX_TEAM_SIZE = 2;

async function findByName(name) {
    return db.one('SELECT * FROM teams WHERE lower(name) = lower($1)', [name]);
}

async function findByCode(code) {
    return db.one('SELECT * FROM teams WHERE upper(join_code) = upper($1)', [code]);
}

async function findById(id) {
    return db.one('SELECT * FROM teams WHERE id = $1', [id]);
}

async function create(name, joinCode) {
    return db.one('INSERT INTO teams (name, join_code) VALUES ($1, $2) RETURNING *', [name, joinCode]);
}

async function memberCount(teamId) {
    const row = await db.one('SELECT count(*)::int AS n FROM users WHERE team_id = $1', [teamId]);
    return row ? row.n : 0;
}

async function listForAdmin() {
    const res = await db.query(
        `SELECT t.id, t.name, t.join_code, t.created_at,
                count(DISTINCT u.id)::int AS members,
                count(DISTINCT s.id)::int AS solved,
                COALESCE(sum(DISTINCT s.points), 0) AS points,
                max(s.solved_at) AS last_activity,
                max(l.created_at) AS last_launch
         FROM teams t
         LEFT JOIN users u ON u.team_id = t.id
         LEFT JOIN submissions s ON s.team_id = t.id
         LEFT JOIN ctf_launches l ON l.team_id = t.id
         GROUP BY t.id
         ORDER BY t.created_at ASC`
    );
    return res.rows;
}

module.exports = { findByName, findByCode, findById, create, memberCount, listForAdmin, MAX_TEAM_SIZE };
