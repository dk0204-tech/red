/* Progress / event / leaderboard controllers. */
'use strict';

const progressService = require('../services/progress.service');
const eventService = require('../services/event.service');
const leaderboardService = require('../services/leaderboard.service');
const { asyncHandler } = require('../middleware/error.middleware');

/** GET /api/progress — server-authoritative team progression. */
const getProgress = asyncHandler(async (req, res) => {
    const progress = await progressService.getProgress(req.user);
    res.json({ progress });
});

/** GET /api/event — server clock + timestamps (never trust client clocks). */
const getEvent = asyncHandler(async (req, res) => {
    const event = await eventService.getEvent();
    res.json({ event });
});

/** GET /api/leaderboard */
const getLeaderboard = asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const leaderboard = await leaderboardService.getLeaderboard(limit);
    res.json({ leaderboard, generatedAt: new Date().toISOString() });
});

module.exports = { getProgress, getEvent, getLeaderboard };
