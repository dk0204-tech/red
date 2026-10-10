/* users model — parameterized SQL only. */
'use strict';

const db = require('../config/database');

function toPublic(row) {
    if (!row) return null;
    return {
        id: row.id,
        username: row.username,
        email: row.email || null,
        role: row.role,
        teamId: row.team_id,
        teamName: row.team_name || null,
        createdAt: row.created_at
    };
}

async function findByUsername(username) {
    return db.one(
        `SELECT u.*, t.name AS team_name FROM users u
         LEFT JOIN teams t ON t.id = u.team_id
         WHERE lower(u.username) = lower($1) OR lower(u.email) = lower($1)`,
        [username]
    );
}

async function findById(id) {
    return db.one(
        `SELECT u.*, t.name AS team_name FROM users u
         LEFT JOIN teams t ON t.id = u.team_id
         WHERE u.id = $1`,
        [id]
    );
}

async function create({ username, email, passwordHash, role, teamId }) {
    return db.one(
        `INSERT INTO users (username, email, password_hash, role, team_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [username, email || null, passwordHash, role || 'player', teamId || null]
    );
}

module.exports = { findByUsername, findById, create, toPublic };
