/* Integration routes (service-to-service) — mounted by routes/index.js. */
'use strict';

const express = require('express');
const integration = require('../controllers/integration.controller');

const router = express.Router();

router.post('/ctf-complete', integration.complete[0], integration.complete[1]);

module.exports = router;
