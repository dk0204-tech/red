/* ==========================================================================
   Leaderboard — sort by (1) points, (2) CTFs solved, (3) earliest solve.
   ========================================================================== */
'use strict';

const db = require('../config/database');

async function getLeaderboard(limit) {
    const res = await db.query(
        `SELECT t.id AS team_id,
                t.name AS team_name,
                count(DISTINCT s.id) AS solved_count,
                COALESCE(sum(s.points), 0) AS points,
                min(s.solved_at) AS first_solved,
                max(s.solved_at) AS last_solved,
                (SELECT count(*) FROM users u WHERE u.team_id = t.id)::int AS members
         FROM teams t
         LEFT JOIN submissions s ON s.team_id = t.id AND s.status = 'solved'
         GROUP BY t.id
         ORDER BY points DESC,
                  solved_count DESC,
                  first_solved ASC NULLS LAST,
                  t.created_at ASC
         LIMIT $1`,
        [limit || 100]
    );

    return res.rows.map((row, index) => ({
        rank: index + 1,
        teamId: row.team_id,
        team: row.team_name,
        members: row.members,
        solved: Number(row.solved_count),
        points: Number(row.points),
        firstSolved: row.first_solved,
        lastSolved: row.last_solved
    }));
}

module.exports = { getLeaderboard };
