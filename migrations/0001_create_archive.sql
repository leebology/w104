-- Score archive, v1.
--
-- See docs/superpowers/specs/2026-07-28-score-persistence-design.md.
--
-- The whole point of this database is that the GAME NEVER READS IT. Every
-- statement that runs against it is an INSERT or an UPDATE issued from
-- party/archive.ts after play has already happened. If this database were
-- unreachable the match would play identically.
--
-- Two consequences of that, both load-bearing for the shapes below:
--   * Denormalisation that would be a drift risk in live state is safe here.
--     A row is written once and never revised, so a copy cannot disagree with
--     its source the way a stored round counter could. `lobby_code` is
--     duplicated out of `game_id` on purpose.
--   * Ids are deterministic rather than generated, so a retried alarm or a
--     reconnect re-running a transition collides instead of duplicating.
--     Every insert pairs with ON CONFLICT DO NOTHING.

-- One row per browser that has ever played. This identifies a SEAT, not a
-- person: it is the localStorage UUID from src/net/identity.ts, so clearing
-- site data, switching browsers, or iOS Safari's 7-day storage eviction all
-- produce a new one. Nothing here should assume one row is one human.
CREATE TABLE IF NOT EXISTS player (
  player_id     TEXT PRIMARY KEY,
  first_seen_at INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  user_agent    TEXT,
  country       TEXT
);

CREATE TABLE IF NOT EXISTS game (
  -- `${lobby_code}:${started_at}`. Deterministic so retries collide.
  game_id          TEXT PRIMARY KEY,
  -- Deliberately duplicated out of game_id: room codes are recycled, so this
  -- is not unique, and queries should never have to parse the primary key.
  lobby_code       TEXT NOT NULL,
  host_player_id   TEXT REFERENCES player(player_id),
  -- JSON MatchSettings. JSON because the gamemode catalog owns this shape and
  -- it changes when a mode is added; nothing joins on it.
  settings         TEXT NOT NULL,
  -- Bumped by hand when normalize/allowedEdits/isMatch change, so a later
  -- replay knows which games it can compare like for like.
  scoring_version  INTEGER NOT NULL,
  lobby_created_at INTEGER NOT NULL,
  started_at       INTEGER NOT NULL,
  ended_at         INTEGER,
  completed        INTEGER NOT NULL DEFAULT 0,  -- 0 = abandoned mid-match
  abandoned_phase  TEXT
);
CREATE INDEX IF NOT EXISTS game_by_code ON game(lobby_code);

-- Display identity is per-game, not per-player: people change their name and
-- emoji between sessions, and the same device hosts one night and plays the
-- next. Storing these on `player` would make last-write-wins destroy history.
CREATE TABLE IF NOT EXISTS participation (
  game_id   TEXT NOT NULL REFERENCES game(game_id),
  player_id TEXT NOT NULL REFERENCES player(player_id),
  name      TEXT NOT NULL,
  emoji     TEXT NOT NULL,
  role      TEXT NOT NULL,   -- 'host' | 'player'; the host holds no seat and never scores
  team_id   TEXT,            -- null when teams are off
  team_name TEXT,
  PRIMARY KEY (game_id, player_id)
);

CREATE TABLE IF NOT EXISTS round (
  round_id    TEXT PRIMARY KEY,   -- `${game_id}:${round_index}`
  game_id     TEXT NOT NULL REFERENCES game(game_id),
  -- Stored explicitly, unlike the live game where the round number is derived
  -- from history.length. This is an immutable snapshot; there is no cancel to
  -- decrement it.
  round_index INTEGER NOT NULL,
  category    TEXT NOT NULL,
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER NOT NULL,
  UNIQUE (game_id, round_index)
);
CREATE INDEX IF NOT EXISTS round_by_game ON round(game_id);

-- Keyed by SCORER, not player: one row per player in free-for-all, one per
-- non-empty team in team play. Mirrors rosterOf() in shared/teams.ts.
CREATE TABLE IF NOT EXISTS round_score (
  round_id     TEXT NOT NULL REFERENCES round(round_id),
  scorer_id    TEXT NOT NULL,
  scorer_type  TEXT NOT NULL,   -- 'player' | 'team'
  unique_count INTEGER NOT NULL,
  total_count  INTEGER NOT NULL,
  place        INTEGER NOT NULL,
  PRIMARY KEY (round_id, scorer_id)
);

-- Final standings as rows rather than a JSON column on `game`, so "who has won
-- the most" is a GROUP BY instead of a blob to unpack.
CREATE TABLE IF NOT EXISTS game_result (
  game_id     TEXT NOT NULL REFERENCES game(game_id),
  scorer_id   TEXT NOT NULL,
  scorer_type TEXT NOT NULL,
  place       INTEGER NOT NULL,
  total_score INTEGER NOT NULL,
  PRIMARY KEY (game_id, scorer_id)
);

-- The pool AS OFFERED that night. CATEGORIES is a constant today and will
-- change; snapshotting it keeps old vote data interpretable.
CREATE TABLE IF NOT EXISTS game_category (
  game_id    TEXT NOT NULL REFERENCES game(game_id),
  category   TEXT NOT NULL,
  vote_total INTEGER NOT NULL DEFAULT 0,
  was_played INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (game_id, category)
);

CREATE TABLE IF NOT EXISTS vote (
  game_id   TEXT NOT NULL REFERENCES game(game_id),
  player_id TEXT NOT NULL REFERENCES player(player_id),
  category  TEXT NOT NULL,
  -- Counts, not a set: stacking votes on one category is the strategic move.
  count     INTEGER NOT NULL,
  PRIMARY KEY (game_id, player_id, category)
);

CREATE TABLE IF NOT EXISTS word (
  word_id       INTEGER PRIMARY KEY,
  round_id      TEXT NOT NULL REFERENCES round(round_id),
  player_id     TEXT NOT NULL REFERENCES player(player_id),
  -- Who it scored for. The team in team play, else the same as player_id.
  scorer_id     TEXT NOT NULL,
  raw           TEXT NOT NULL,   -- as typed
  normalized    TEXT NOT NULL,   -- what scoring actually compared
  submitted_at  INTEGER NOT NULL,
  ms_into_round INTEGER NOT NULL,
  ordinal       INTEGER NOT NULL,
  -- 0 = never reached scoring: blank, or a repeat of this scorer's own earlier
  -- word. Keeps "how many did they type" separate from "how many counted".
  counted       INTEGER NOT NULL,
  -- What actually happened on the night. Null when !counted. Kept alongside
  -- the replayable inputs above so tuning allowedEdits cannot rewrite history.
  is_unique     INTEGER,
  -- Union-find cluster root from scoreRound, unique within a round. Null when
  -- the word was unique. Self-join on (round_id, collision_group) gives every
  -- "who cancelled whose word" pair, including 3+ way collisions.
  collision_group INTEGER
);
-- One index only. Every per-round query goes through it, and each extra index
-- is a second row write against the 100k/day free-tier budget. An index on
-- `normalized` waits until a global word-frequency feature actually needs it.
CREATE INDEX IF NOT EXISTS word_by_round ON word(round_id);
