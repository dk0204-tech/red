/* ==========================================================================
   JWT helpers — participants and admins share one signing secret, but the
   role claim decides authorization.
   ========================================================================== */
'use strict';

const jwt = require('jsonwebtoken');
const env = require('../config/env');

function signToken(user) {
    const payload = {
        sub: user.id,                 // user id
        username: user.username,
        role: user.role || 'player',
        teamId: user.team_id !== undefined ? user.team_id : user.teamId
    };
    return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });
}

function verifyToken(token) {
    return jwt.verify(token, env.JWT_SECRET);
}

module.exports = { signToken, verifyToken };
