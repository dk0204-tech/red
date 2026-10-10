/* CTF verification routes — mounted at /api/ctf by routes/index.js. */
'use strict';

const express = require('express');
const ctrl = require('../controllers/ctf-verify.controller');

const router = express.Router();

router.post('/session', ctrl.createSession);
router.get('/state', ctrl.getState);
router.post('/verify', ctrl.verifyFlag);
router.get('/reward/:which', ctrl.downloadReward);

module.exports = router;
