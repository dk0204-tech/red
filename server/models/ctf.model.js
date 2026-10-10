/* ctf_challenges model + public serialization. */
'use strict';

const db = require('../config/database');

const SECTOR_ORDER = ['community', 'radio', 'forensics', 'research'];

function toPublic(row) {
    if (!row) return null;
    return {
        id: row.slug,
        dbId: row.id,
        slug: row.slug,
        name: row.name,
        sector: row.sector,
        zone: row.zone || null,
        description: row.description || '',
        points: row.points,
        difficulty: row.difficulty,
        externalUrl: row.external_url,
        enabled: !!row.enabled,
        order: row.display_order,
        terminalLabel: row.terminal_label || row.name,
        fragmentId: row.fragment_id || null,
        updatedAt: row.updated_at
    };
}

async function listAll() {
    const res = await db.query('SELECT * FROM ctf_challenges ORDER BY display_order ASC, id ASC');
    return res.rows;
}

async function listEnabled() {
    const res = await db.query('SELECT * FROM ctf_challenges WHERE enabled = true ORDER BY display_order ASC, id ASC');
    return res.rows;
}

async function findBySlug(slug) {
    return db.one('SELECT * FROM ctf_challenges WHERE slug = $1', [slug]);
}

async function findById(id) {
    if (!Number.isInteger(Number(id))) return null;
    return db.one('SELECT * FROM ctf_challenges WHERE id = $1', [Number(id)]);
}

/** Accepts slug, numeric id or zone id. */
async function findRef(ref) {
    if (ref === undefined || ref === null) return null;
    const value = String(ref);
    let row = await findBySlug(value);
    if (!row && /^\d+$/.test(value)) row = await findById(value);
    if (!row) row = await db.one('SELECT * FROM ctf_challenges WHERE zone = $1', [value]);
    return row;
}

async function create(data) {
    return db.one(
        `INSERT INTO ctf_challenges
            (slug, name, sector, zone, description, points, difficulty, external_url, enabled, display_order, terminal_label, fragment_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING *`,
        [data.slug, data.name, data.sector, data.zone, data.description, data.points,
         data.difficulty, data.externalUrl, data.enabled, data.displayOrder, data.terminalLabel, data.fragmentId]
    );
}

async function update(id, data) {
    return db.one(
        `UPDATE ctf_challenges SET
            slug = $2, name = $3, sector = $4, zone = $5, description = $6,
            points = $7, difficulty = $8, external_url = $9, enabled = $10,
            display_order = $11, terminal_label = $12, fragment_id = $13,
            updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [id, data.slug, data.name, data.sector, data.zone, data.description,
         data.points, data.difficulty, data.externalUrl, data.enabled, data.displayOrder,
         data.terminalLabel, data.fragmentId]
    );
}

async function remove(id) {
    const res = await db.query('DELETE FROM ctf_challenges WHERE id = $1', [Number(id)]);
    return res.rowCount > 0;
}

async function activity() {
    const res = await db.query(
        `SELECT c.id, c.slug, c.name, c.enabled,
                count(DISTINCT l.id)::int AS launches,
                count(DISTINCT s.id)::int AS solves
         FROM ctf_challenges c
         LEFT JOIN ctf_launches l ON l.ctf_id = c.id
         LEFT JOIN submissions s ON s.ctf_id = c.id AND s.status = 'solved'
         GROUP BY c.id
         ORDER BY c.display_order ASC, c.id ASC`
    );
    return res.rows;
}

module.exports = { listAll, listEnabled, findBySlug, findById, findRef, create, update, remove, activity, toPublic, SECTOR_ORDER };
