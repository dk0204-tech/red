/* ==========================================================================
   Progress service — server-authoritative team progression.

   States per CTF:  LOCKED → AVAILABLE → VISITED → SOLVED
   Sectors:          COMMUNITY → RADIO → FORENSICS → RESEARCH
   A sector unlocks when every enabled CTF of the previous sector is solved.
   ========================================================================== */
'use strict';

const ctfModel = require('../models/ctf.model');
const submissions = require('../models/submission.model');

const SECTOR_META = {
    community: { number: 1, name: 'COMMUNITY', code: 'SEC-01-COM' },
    radio: { number: 2, name: 'RADIO', code: 'SEC-02-RAD' },
    forensics: { number: 3, name: 'FORENSICS', code: 'SEC-03-FOR' },
    research: { number: 4, name: 'RESEARCH', code: 'SEC-04-RES' }
};

function computeSectorStates(ctfs, solvedSet) {
    const states = {};
    let previousCleared = true;

    for (const sector of ctfModel.SECTOR_ORDER) {
        const inSector = ctfs.filter(c => c.sector === sector);
        const cleared = inSector.every(c => solvedSet.has(c.slug));
        let state;
        if (!previousCleared) state = 'locked';
        else if (cleared) state = 'cleared';
        else state = 'active';
        states[sector] = state;
        previousCleared = previousCleared && (cleared || inSector.length === 0);
    }
    return states;
}

function statusForCtf(ctfPublic, { solvedSet, visitedSet, sectorStates }) {
    if (solvedSet.has(ctfPublic.slug)) return 'solved';
    if (sectorStates[ctfPublic.sector] === 'locked') return 'locked';
    if (visitedSet.has(ctfPublic.slug)) return 'visited';
    return 'available';
}

/**
 * Full progress payload for a signed-in team.
 */
async function getProgress(user) {
    const teamId = user && user.teamId ? user.teamId : null;
    const ctfs = (await ctfModel.listEnabled()).map(ctfModel.toPublic);

    const solvedIds = teamId ? await submissions.solvedCtfIds(teamId) : [];
    const visitedIds = teamId ? await submissions.visitedCtfIds(teamId) : [];
    const details = teamId ? await submissions.solvedDetails(teamId) : [];

    // Map DB ids → slugs (only enabled CTFs participate in the payload).
    const slugById = new Map(ctfs.map(c => [c.dbId, c.slug]));
    const solvedSlugs = new Set(solvedIds.map(id => slugById.get(id)).filter(Boolean));
    const visitedSlugs = new Set(visitedIds.map(id => slugById.get(id)).filter(Boolean));

    const sectorStates = computeSectorStates(ctfs, solvedSlugs);

    const ctfStatuses = {};
    for (const c of ctfs) {
        ctfStatuses[c.slug] = statusForCtf(c, { solvedSet: solvedSlugs, visitedSet: visitedSlugs, sectorStates });
    }

    const totalPoints = ctfs.reduce((sum, c) => sum + c.points, 0);
    const points = ctfs.filter(c => solvedSlugs.has(c.slug)).reduce((sum, c) => sum + c.points, 0);
    const restoration = totalPoints > 0 ? Math.round((points / totalPoints) * 100) : 0;

    const fragments = ctfs
        .filter(c => solvedSlugs.has(c.slug) && c.fragmentId)
        .map(c => c.fragmentId);

    const lastSolved = details.length
        ? details.map(d => d.solved_at).sort().slice(-1)[0]
        : null;

    return {
        teamId: teamId,
        online: true,
        ctfs: ctfStatuses,
        solved: [...solvedSlugs],
        visited: [...visitedSlugs],
        sectors: sectorStates,
        sectorMeta: SECTOR_META,
        points,
        totalPoints,
        solvedCount: solvedSlugs.size,
        totalCount: ctfs.length,
        restoration,
        fragments,
        lastSolved,
        finalUnlocked: Object.values(sectorStates).every(s => s === 'cleared')
    };
}

/** Progress payload for a visitor with no session (offline / guest view). */
function emptyProgress(ctfs) {
    const enabled = (ctfs || []).filter(c => c.enabled);
    const sectorStates = computeSectorStates(enabled, new Set());
    const totalPoints = enabled.reduce((s, c) => s + c.points, 0);
    return {
        teamId: null,
        online: false,
        ctfs: Object.fromEntries(enabled.map(c => [c.slug, sectorStates[c.sector] === 'locked' ? 'locked' : 'available'])),
        solved: [],
        visited: [],
        sectors: sectorStates,
        sectorMeta: SECTOR_META,
        points: 0,
        totalPoints,
        solvedCount: 0,
        totalCount: enabled.length,
        restoration: 0,
        fragments: [],
        lastSolved: null,
        finalUnlocked: false
    };
}

module.exports = { getProgress, emptyProgress, computeSectorStates, statusForCtf, SECTOR_META };
