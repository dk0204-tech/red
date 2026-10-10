/* Health endpoint — used for deployment monitoring / uptime checks. */
'use strict';

const db = require('../config/database');
const env = require('../config/env');
const pkg = require('../../package.json');

async function health(req, res) {
    const database = await db.ping();
    res.status(database === 'connected' ? 200 : 503).json({
        status: database === 'connected' ? 'ok' : 'degraded',
        database,
        version: pkg.version,
        uptime: Math.round(process.uptime()),
        env: env.NODE_ENV,
        time: new Date().toISOString()
    });
}

module.exports = { health };
