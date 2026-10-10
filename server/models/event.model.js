/* event_state model. */
'use strict';

const db = require('../config/database');
const env = require('../config/env');

async function get() {
    return db.one('SELECT * FROM event_state WHERE id = 1');
}

async function update({ eventName, startTime, endTime, isActive }) {
    return db.one(
        `UPDATE event_state
            SET event_name = $1, start_time = $2, end_time = $3, is_active = $4, id = 1
         WHERE id = 1
         RETURNING *`,
        [eventName, startTime, endTime, isActive]
    );
}

/** Fallback used before the seed row exists (or when the DB is down). */
function fromEnv() {
    return {
        id: 1,
        event_name: env.EVENT_NAME,
        start_time: env.EVENT_START,
        end_time: env.EVENT_END,
        is_active: true
    };
}

module.exports = { get, update, fromEnv };
