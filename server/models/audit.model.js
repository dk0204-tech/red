/* audit_logs model — every privileged action is recorded. */
'use strict';

const db = require('../config/database');
const logger = require('../utils/logger');

async function record(userId, action, metadata) {
    try {
        await db.query(
            'INSERT INTO audit_logs (user_id, action, metadata) VALUES ($1, $2, $3)',
            [userId || null, action, JSON.stringify(metadata || {})]
        );
    } catch (err) {
        // Auditing must never break the request path.
        logger.warn('audit write failed', { action, message: err.message });
    }
}

async function list(limit) {
    const res = await db.query(
        `SELECT a.id, a.action, a.metadata, a.created_at, u.username
         FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
         ORDER BY a.created_at DESC LIMIT $1`,
        [limit || 100]
    );
    return res.rows;
}

module.exports = { record, list };
