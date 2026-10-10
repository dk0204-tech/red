/* Progress + leaderboard routes — mounted by routes/index.js. */
'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const core = require('../controllers/progress.controller');

const router = express.Router();

router.get('/progress', requireAuth, core.getProgress);
router.get('/leaderboard', core.getLeaderboard);

module.exports = router;
