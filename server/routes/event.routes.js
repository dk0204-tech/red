/* Event routes — mounted by routes/index.js. */
'use strict';

const express = require('express');
const core = require('../controllers/progress.controller');

const router = express.Router();

router.get('/', core.getEvent);

module.exports = router;
