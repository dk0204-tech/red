/* CTF routes — mounted by routes/index.js. */
'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const ctf = require('../controllers/ctf.controller');

const router = express.Router();

router.get('/', ctf.list);
router.get('/:id', ctf.getOne);
router.post('/:id/launch', requireAuth, ctf.launch[0], ctf.launch[1]);

module.exports = router;
