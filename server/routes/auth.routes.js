/* Auth routes — mounted by routes/index.js (kept as a named module so the
   tree matches the documented architecture). */
'use strict';

const express = require('express');
const { authLimiter } = require('../middleware/rateLimit.middleware');
const { requireAuth } = require('../middleware/auth.middleware');
const auth = require('../controllers/auth.controller');

const router = express.Router();

router.post('/register', authLimiter, auth.register);
router.post('/login', authLimiter, auth.login);
router.post('/logout', auth.logout);
router.get('/me', requireAuth, auth.me);

module.exports = router;
