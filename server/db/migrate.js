/* ==========================================================================
   Migration runner — applies server/db/migrations/*.sql in order, inside a
   transaction, tracking applied files in schema_migrations.
   Usage: npm run migrate
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const logger = require('../utils/logger');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function migrate() {
    await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

    const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
    let applied = 0;

    for (const file of files) {
        const exists = await db.one('SELECT name FROM schema_migrations WHERE name = $1', [file]);
        if (exists) continue;

        const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
        await db.withTransaction(async (conn) => {
            await conn.exec(sql);
            await conn.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        });
        applied++;
        logger.info('migration applied', { file });
    }
    return { total: files.length, applied };
}

if (require.main === module) {
    migrate()
        .then((res) => {
            logger.info('migrations complete', res);
            return db.close();
        })
        .then(() => process.exit(0))
        .catch((err) => {
            logger.error('migration failed', { message: err.message });
            process.exit(1);
        });
}

module.exports = { migrate };
