/* ==========================================================================
   Auth service — registration (teams of 1–2), login, profile.
   Passwords are stored only as bcrypt hashes; JWTs are signed server-side.
   ========================================================================== */
'use strict';

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const users = require('../models/user.model');
const teams = require('../models/team.model');
const audit = require('../models/audit.model');
const { signToken } = require('../utils/jwt');
const { httpError } = require('../middleware/error.middleware');

const USERNAME_RE = /^[A-Za-z0-9_\- ]{3,24}$/;
const TEAM_NAME_RE = /^[A-Za-z0-9_\- ]{3,32}$/;
const SALT_ROUNDS = 10;

function makeJoinCode() {
    return crypto.randomBytes(4).toString('hex').toUpperCase();
}

async function resolveTeam(teamName, teamCode) {
    if (teamCode) {
        const team = await teams.findByCode(String(teamCode).trim());
        if (!team) throw httpError(400, 'Team code not found.', 'invalid_team_code');
        const count = await teams.memberCount(team.id);
        if (count >= teams.MAX_TEAM_SIZE) throw httpError(409, 'That team already has two members.', 'team_full');
        return { team, joined: true };
    }
    if (teamName) {
        const existing = await teams.findByName(teamName);
        if (existing) {
            const count = await teams.memberCount(existing.id);
            if (count >= teams.MAX_TEAM_SIZE) throw httpError(409, 'That team already has two members.', 'team_full');
            return { team: existing, joined: true };
        }
        const team = await teams.create(teamName, makeJoinCode());
        return { team, joined: false };
    }
    // Solo participant gets their own team.
    const name = 'SOLO-' + makeJoinCode();
    const team = await teams.create(name, makeJoinCode());
    return { team, joined: false };
}

async function register({ username, password, teamName, teamCode, email }) {
    if (!USERNAME_RE.test(username)) {
        throw httpError(400, 'Callsign must be 3–24 characters (letters, numbers, space, _ or -).', 'invalid_username');
    }
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
        throw httpError(400, 'Passphrase must be 8–128 characters.', 'invalid_password');
    }
    if (teamName && !TEAM_NAME_RE.test(teamName)) {
        throw httpError(400, 'Team name must be 3–32 characters (letters, numbers, space, _ or -).', 'invalid_team_name');
    }

    const clash = await users.findByUsername(username);
    if (clash) throw httpError(409, 'That callsign is already registered.', 'username_taken');

    const { team } = await resolveTeam(teamName, teamCode);
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await users.create({ username, email, passwordHash, role: 'player', teamId: team.id });

    const token = signToken({ id: user.id, username: user.username, role: user.role, team_id: team.id });
    await audit.record(user.id, 'auth.register', { team: team.name, teamCode: team.join_code });

    return {
        token,
        user: users.toPublic(Object.assign({}, user, { team_name: team.name })),
        team: { id: team.id, name: team.name, joinCode: team.join_code }
    };
}

async function login({ username, password }) {
    const row = await users.findByUsername(username || '');
    if (!row) throw httpError(401, 'Invalid callsign or passphrase.', 'invalid_credentials');
    const ok = await bcrypt.compare(String(password || ''), row.password_hash);
    if (!ok) throw httpError(401, 'Invalid callsign or passphrase.', 'invalid_credentials');

    const token = signToken({ id: row.id, username: row.username, role: row.role, team_id: row.team_id });
    await audit.record(row.id, 'auth.login', { username: row.username });
    return { token, user: users.toPublic(row) };
}

async function profile(userId) {
    const row = await users.findById(userId);
    if (!row) throw httpError(404, 'User not found.', 'not_found');
    return users.toPublic(row);
}

module.exports = { register, login, profile };
