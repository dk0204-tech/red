/* ==========================================================================
   API route table.

   Public     GET    /api/health
              GET    /api/event
              GET    /api/leaderboard
              GET    /api/ctfs
              GET    /api/ctfs/:id

   Player     POST   /api/auth/register | /api/auth/login | /api/auth/logout
              GET    /api/auth/me
              GET    /api/progress
              POST   /api/ctfs/:id/launch

   Service    POST   /api/integrations/ctf-complete   (CTF_SERVICE_TOKEN)

   Admin      GET    /api/admin/overview | /teams | /submissions | /leaderboard
              GET    /api/admin/event       PUT   /api/admin/event
              GET    /api/admin/ctfs        POST  /api/admin/ctfs
              PUT    /api/admin/ctfs/:id    PATCH /api/admin/ctfs/:id/enabled
              DELETE /api/admin/ctfs/:id
              GET    /api/admin/audit
   ========================================================================== */
'use strict';

const express = require('express');
const { attachUser } = require('../middleware/auth.middleware');
const health = require('../controllers/health.controller');

const authRoutes = require('./auth.routes');
const ctfRoutes = require('./ctf.routes');
const ctfVerifyRoutes = require('./ctf-verify.routes');
const progressRoutes = require('./progress.routes');
const eventRoutes = require('./event.routes');
const adminRoutes = require('./admin.routes');
const integrationRoutes = require('./integration.routes');

const router = express.Router();

/* Every request gets a chance to carry a user. */
router.use(attachUser);

router.get('/health', health.health);

router.use('/auth', authRoutes);
router.use('/ctfs', ctfRoutes);
/* In-world flag verification + dataset rewards (game terminals). */
router.use('/ctf', ctfVerifyRoutes);
router.use('/', progressRoutes);
router.use('/event', eventRoutes);
router.use('/admin', adminRoutes);
router.use('/integrations', integrationRoutes);

module.exports = router;
