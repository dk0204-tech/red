/* Auth controller — thin wrapper over the auth service. */
'use strict';

const authService = require('../services/auth.service');
const { asyncHandler } = require('../middleware/error.middleware');
const v = require('../middleware/validate');

const register = asyncHandler(async (req, res) => {
    const result = await authService.register({
        username: v.str(req.body, 'username', { max: 24 }),
        password: req.body ? req.body.password : undefined,
        teamName: v.str(req.body, 'teamName', { required: false, max: 32 }),
        teamCode: v.str(req.body, 'teamCode', { required: false, max: 16 }),
        email: v.str(req.body, 'email', { required: false, max: 120 })
    });
    setAuthCookie(res, result.token);
    res.status(201).json(result);
});

const login = asyncHandler(async (req, res) => {
    const result = await authService.login({
        username: v.str(req.body, 'username', { max: 24 }),
        password: req.body ? req.body.password : undefined
    });
    setAuthCookie(res, result.token);
    res.json(result);
});

const me = asyncHandler(async (req, res) => {
    const user = await authService.profile(req.user.id);
    res.json({ user });
});

const logout = asyncHandler(async (req, res) => {
    res.clearCookie('manu_token');
    res.json({ ok: true });
});

/* Optional convenience cookie for the admin dashboard (HttpOnly). */
function setAuthCookie(res, token) {
    res.cookie('manu_token', token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 12 * 60 * 60 * 1000,
        path: '/'
    });
}

module.exports = { register, login, me, logout };
