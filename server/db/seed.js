/* ==========================================================================
   Seed script — idempotent.
     • first admin account (ADMIN_EMAIL / ADMIN_PASSWORD or ADMIN_PASSWORD_HASH)
     • event state (EVENT_NAME, EVENT_START, EVENT_END)
     • the four default CTF slots — only inserted when missing, never
       overwriting an organizer's edits.

   Usage: npm run seed
   ========================================================================== */
'use strict';

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../config/database');
const env = require('../config/env');
const logger = require('../utils/logger');

const DEFAULT_CTFS = [
    {
        slug: 'pralaya-archive', name: 'PRALAYA Archive Terminal', sector: 'community',
        zone: 'zone_vault', points: 300, difficulty: 'MEDIUM', display_order: 1,
        terminal_label: 'ACCESS PRALAYA ARCHIVE', fragment_id: 'FRAGMENT-01',
        description: 'Recover the missing archive fragment from the Sanctuary records vault.'
    },
    {
        slug: 'ghost-signal', name: 'Ghost Signal Relay', sector: 'radio',
        zone: 'zone_bridge', points: 300, difficulty: 'MEDIUM', display_order: 2,
        terminal_label: 'ACCESS GHOST SIGNAL RELAY', fragment_id: 'FRAGMENT-02',
        description: 'Trace the decommissioned relay station still transmitting across Sanctuary Zero.'
    },
    {
        slug: 'child-dataset', name: 'Child Dataset Annex', sector: 'forensics',
        zone: 'zone_ai', points: 300, difficulty: 'HARD', display_order: 3,
        terminal_label: 'ACCESS CHILD DATASET ANNEX', fragment_id: 'FRAGMENT-03',
        description: 'Reconstruct the artifact held in the forensic research annex.'
    },
    {
        slug: 'central-atrium', name: 'Central Atrium Core', sector: 'research',
        zone: 'zone_atrium', points: 300, difficulty: 'HARD', display_order: 4,
        terminal_label: 'ACCESS CENTRAL ATRIUM CORE', fragment_id: 'FRAGMENT-04',
        description: 'Open the final passage at the heart of Sanctuary Zero.'
    }
];

function makeJoinCode() {
    return crypto.randomBytes(4).toString('hex').toUpperCase();
}

async function seed() {
    const results = { admin: false, event: false, ctfs: 0 };

    // --- Admin user -------------------------------------------------------
    const existingAdmin = await db.one(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
    if (!existingAdmin) {
        let hash = env.ADMIN_PASSWORD_HASH;
        if (!hash) {
            const password = env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
            hash = await bcrypt.hash(password, 12);
            if (!env.ADMIN_PASSWORD) {
                logger.warn('generated initial admin sign-in (change it after first login): ' + env.ADMIN_EMAIL + ' / ' + password);
            }
        }
        let team = await db.one('SELECT id FROM teams WHERE name = $1', ['SANCTUARY CONTROL']);
        if (!team) {
            team = await db.one(
                'INSERT INTO teams (name, join_code) VALUES ($1, $2) RETURNING id',
                ['SANCTUARY CONTROL', makeJoinCode()]
            );
        }
        await db.query(
            `INSERT INTO users (username, email, password_hash, role, team_id)
             VALUES ($1, $2, $3, 'admin', $4)`,
            ['manu-admin', env.ADMIN_EMAIL, hash, team.id]
        );
        results.admin = true;
    }

    // --- Event state ------------------------------------------------------
    const event = await db.one('SELECT id FROM event_state WHERE id = 1');
    if (!event) {
        await db.query(
            'INSERT INTO event_state (id, event_name, start_time, end_time, is_active) VALUES (1, $1, $2, $3, true)',
            [env.EVENT_NAME, env.EVENT_START, env.EVENT_END]
        );
        results.event = true;
    }

    // --- Default CTF slots ------------------------------------------------
    for (const c of DEFAULT_CTFS) {
        const exists = await db.one('SELECT id FROM ctf_challenges WHERE slug = $1', [c.slug]);
        if (exists) continue;
        await db.query(
            `INSERT INTO ctf_challenges
                (slug, name, sector, zone, description, points, difficulty, external_url, enabled, display_order, terminal_label, fragment_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10,$11)`,
            [c.slug, c.name, c.sector, c.zone, c.description, c.points, c.difficulty, '', c.display_order, c.terminal_label, c.fragment_id]
        );
        results.ctfs++;
    }

    return results;
}

if (require.main === module) {
    (async () => {
        const { migrate } = require('./migrate');
        await migrate();
        const res = await seed();
        logger.info('seed complete', res);
        await db.close();
        process.exit(0);
    })().catch((err) => {
        logger.error('seed failed', { message: err.message });
        process.exit(1);
    });
}

module.exports = { seed, DEFAULT_CTFS };
