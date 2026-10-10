/* ==========================================================================
   001_init.sql — full PostgreSQL schema for THE LAST DATASET platform.
   Applied idempotently by server/db/migrate.js.
   ========================================================================== */

CREATE TABLE IF NOT EXISTS teams (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    join_code   TEXT NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    email         TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'player',   -- 'player' | 'admin'
    team_id       INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_team ON users(team_id);

CREATE TABLE IF NOT EXISTS ctf_challenges (
    id            SERIAL PRIMARY KEY,
    slug          TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    sector        TEXT NOT NULL DEFAULT 'community',
    zone          TEXT,                              -- in-world terminal id (zone_vault, …)
    description   TEXT NOT NULL DEFAULT '',
    points        INTEGER NOT NULL DEFAULT 100,
    difficulty    TEXT NOT NULL DEFAULT 'MEDIUM',
    external_url  TEXT NOT NULL DEFAULT '',
    enabled       BOOLEAN NOT NULL DEFAULT true,
    display_order INTEGER NOT NULL DEFAULT 1,
    terminal_label TEXT,
    fragment_id   TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ctf_sector ON ctf_challenges(sector);
CREATE INDEX IF NOT EXISTS idx_ctf_zone ON ctf_challenges(zone);

CREATE TABLE IF NOT EXISTS ctf_launches (
    id         SERIAL PRIMARY KEY,
    ctf_id     INTEGER NOT NULL REFERENCES ctf_challenges(id) ON DELETE CASCADE,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    team_id    INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    ip_hash    TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_launch_ctf ON ctf_launches(ctf_id);
CREATE INDEX IF NOT EXISTS idx_launch_team ON ctf_launches(team_id);

CREATE TABLE IF NOT EXISTS submissions (
    id        SERIAL PRIMARY KEY,
    user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    team_id   INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    ctf_id    INTEGER NOT NULL REFERENCES ctf_challenges(id) ON DELETE CASCADE,
    status    TEXT NOT NULL DEFAULT 'solved',        -- solved | attempt
    solved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    points    INTEGER NOT NULL DEFAULT 0,
    UNIQUE (team_id, ctf_id)                          -- no duplicate scoring
);
CREATE INDEX IF NOT EXISTS idx_sub_team ON submissions(team_id);
CREATE INDEX IF NOT EXISTS idx_sub_ctf ON submissions(ctf_id);

CREATE TABLE IF NOT EXISTS event_state (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    event_name  TEXT NOT NULL,
    start_time  TIMESTAMPTZ NOT NULL,
    end_time    TIMESTAMPTZ NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id        SERIAL PRIMARY KEY,
    user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action    TEXT NOT NULL,
    metadata  JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
