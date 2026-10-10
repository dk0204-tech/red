/* Admin routes — mounted by routes/index.js behind requireAdmin. */
'use strict';

const express = require('express');
const { requireAdmin } = require('../middleware/auth.middleware');
const admin = require('../controllers/admin.controller');
const ctf = require('../controllers/ctf.controller');

const router = express.Router();

router.use(requireAdmin);

router.get('/overview', admin.overview);
router.get('/teams', admin.listTeams);
router.get('/submissions', admin.listSubmissions);
router.get('/leaderboard', admin.adminLeaderboard);
router.get('/event', admin.getEvent);
router.put('/event', admin.updateEvent);
router.get('/ctfs', ctf.adminList);
router.post('/ctfs', ctf.adminCreate);
router.put('/ctfs/:id', ctf.adminUpdate);
router.patch('/ctfs/:id/enabled', ctf.adminSetEnabled);
router.delete('/ctfs/:id', ctf.adminDelete);
router.get('/audit', admin.audit);

module.exports = router;
