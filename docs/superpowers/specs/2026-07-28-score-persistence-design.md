# Score persistence — design

**Date:** 2026-07-28
**Status:** approved, not yet implemented
**Builds on:** `2026-07-26-match-structure-design.md` (rounds and standings),
`2026-07-26-category-voting-design.md` (the pool and the vote), and
`2026-07-27-teams-design.md` (the scorer, not the player, is the unit of
scoring — this spec's schema is keyed the same way).

## Problem

Nothing survives the room. A Durable Object holds the whole match, then
`alarmOutcome` reaps it with `storage.deleteAll()` and every word, score and
placement is gone. There is no way to ask "who has won the most games", "which
category plays best", or "what did anyone actually write" — and no way to build
an end-of-night stats screen, because there is nothing to build it from.

This change adds a **Cloudflare D1 archive**: a read-only-in-practice record of
matches, rounds, scorers, votes and words, written from `party/server.ts` as a
side effect of play and never read back into the game loop.

## Scope

- A D1 database bound to the Worker in all three environments.
- A `party/archive.ts` module: schema, inserts, and nothing else.
- Writes at two moments — round banked, and match ended.
- Per-word submission times, sufficient to plot answer rate across a round.
- Collision (kill-stat) data, votes, and the category pool as offered.

## Non-goals

- **The game never reads D1.** Not for reconnects, not for standings, not for
  anything. The Durable Object stays the sole authority; if the archive is
  unavailable the match plays identically. This is the single most important
  constraint in this document.
- **No stats UI.** This spec lands the data. Screens are a separate pass.
- **No keystroke or character-level capture at all.** Not the intermediate
  text, not keypress counts, not timings between characters. Words and the
  moment they were submitted, and nothing finer. See §6.
- **No cross-match player identity.** A `player_id` is a browser's
  localStorage UUID and nothing more — see §3.
- **No backfill.** There is no historical data to migrate.

---

## 1. Why D1

Already on Cloudflare, already deploying with Wrangler, already SQLite. A D1
binding is a config block; every alternative is a new vendor, a new secret, and
a connection story from a Worker. Free plan limits that matter here: **5 GB
storage, 5M rows read/day, 100k rows written/day** — where *rows written counts
index updates too*, which is the number §5 budgets against.

Three tiers, one binding name (`DB`):

| Tier | Database | Notes |
|---|---|---|
| local | auto-created SQLite file | `wrangler dev` uses it with no remote calls and no quota |
| staging | `w104-staging-archive` | bound in `env.staging`; the `staging` branch writes here |
| prod | `w104-archive` | bound at top level |

**`d1_databases` must be repeated inside `env.staging`.** Named Wrangler
environments do not inherit bindings — the same trap `durable_objects` already
documents in `wrangler.jsonc`. A staging deploy missing it fails at first write,
not at deploy.

## 2. Where the writes happen

Three rules, in priority order.

**No D1 in `shared/`.** `reduce()` is pure and the test suite runs in
milliseconds because of it. All archive code lives in `party/archive.ts`, called
only from `party/server.ts`.

**Never `await` the archive in the tick or alarm path.** Every call goes through
`ctx.waitUntil()` and is wrapped in try/catch that logs and swallows. A D1
timeout must not stall a round, and a failed insert must not break a game. The
archive is allowed to lose data; the game is not allowed to notice.

**Write per round, not per match.** Rooms are abandoned constantly — a host's
phone locks, a party moves on — and `storage.deleteAll()` takes everything with
it. Archiving only at match end would capture exactly the games that finished,
which is the biased half. So:

| Moment | Write |
|---|---|
| first `startGame` of a match | `INSERT` the `player` rows, the `game` row, `participation` |
| first `showStandings` | `INSERT` `game_category` and `vote` |
| `showStandings` (round banked) | `INSERT` the `round`, its `round_score` rows, its `word` rows |
| match complete, or room reaped | `UPDATE game` with `ended_at`/`completed`; `INSERT game_result`; set `was_played` |

**Votes cannot be written at `startGame`** — an earlier draft of this table said
they could, and it was wrong. Voting happens *after* the first `startGame`, so
at that moment the tally is empty. The first round bank is the earliest point
they are both complete and final, since votes are immutable once voting closes.

`showStandings` is also the single place `entries` is emptied, so the round
must be archived from the room **as it stood before that reduce**. A room read
afterwards has no words left in it.

`game_id` is deterministic — `` `${code}:${startedAt}` `` — and every insert is
`ON CONFLICT DO NOTHING`, because alarms and reconnects can re-run a
transition. Related inserts go in one `db.batch()`; D1 has no cross-request
transactions, so a batch is the largest atomic unit available.

## 3. Identity, honestly

`player_id` is the localStorage UUID from `src/net/identity.ts`. It identifies
**a seat, not a person**: clear storage, switch browsers, or open `?p=2` and it
is a new player. The schema should not pretend otherwise, and nothing should be
built on the assumption that one id is one human.

No fingerprinting. `user_agent` and `request.cf.country` are captured because
they are free and make for fun aggregate stats; IP is not stored in any form.

**Display identity is per-game, not per-player.** People change their name and
emoji between sessions, and the same device hosts one night and plays the next.
`name`, `emoji` and `role` therefore live on `participation`, so "Liam 🐸" and
"Big L 🎩" both survive as history rather than one overwriting the other.

The host is archived as a participant with `role = 'host'`, even though they
hold no player slot and never score. `hostId` is a real `PlayerId`; leaving them
out would make "who hosts the most" unanswerable.

## 4. Schema

```sql
CREATE TABLE player (
  player_id     TEXT PRIMARY KEY,          -- localStorage UUID; a seat, not a person
  first_seen_at INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  user_agent    TEXT,
  country       TEXT
);

CREATE TABLE game (
  game_id          TEXT PRIMARY KEY,        -- `${lobby_code}:${started_at}`
  lobby_code       TEXT NOT NULL,           -- NOT unique: room codes are recycled
  host_player_id   TEXT REFERENCES player(player_id),
  settings         TEXT NOT NULL,           -- JSON MatchSettings; shape evolves with the catalog
  scoring_version  INTEGER NOT NULL,        -- see §7
  lobby_created_at INTEGER NOT NULL,
  started_at       INTEGER NOT NULL,
  ended_at         INTEGER,
  completed        INTEGER NOT NULL DEFAULT 0,  -- 0 = abandoned mid-match
  abandoned_phase  TEXT                      -- which screen it died on, when it died
);

CREATE TABLE participation (                 -- one row per player per game
  game_id   TEXT NOT NULL REFERENCES game(game_id),
  player_id TEXT NOT NULL REFERENCES player(player_id),
  name      TEXT NOT NULL,                   -- as displayed THAT night
  emoji     TEXT NOT NULL,
  role      TEXT NOT NULL,                   -- 'host' | 'player'
  team_id   TEXT,                            -- null when teams are off
  team_name TEXT,
  PRIMARY KEY (game_id, player_id)
);

CREATE TABLE round (
  round_id     TEXT PRIMARY KEY,             -- `${game_id}:${round_index}`
  game_id      TEXT NOT NULL REFERENCES game(game_id),
  round_index  INTEGER NOT NULL,             -- explicit: this is a snapshot, not live state
  category     TEXT NOT NULL,
  started_at   INTEGER NOT NULL,             -- captured at the whistle
  ended_at     INTEGER NOT NULL,
  UNIQUE (game_id, round_index)
);

CREATE TABLE round_score (                   -- keyed by SCORER, so teams work
  round_id     TEXT NOT NULL REFERENCES round(round_id),
  scorer_id    TEXT NOT NULL,
  scorer_type  TEXT NOT NULL,                -- 'player' | 'team'
  unique_count INTEGER NOT NULL,
  total_count  INTEGER NOT NULL,
  place        INTEGER NOT NULL,
  PRIMARY KEY (round_id, scorer_id)
);

CREATE TABLE game_result (                   -- final standings, queryable
  game_id     TEXT NOT NULL REFERENCES game(game_id),
  scorer_id   TEXT NOT NULL,
  scorer_type TEXT NOT NULL,
  place       INTEGER NOT NULL,
  total_score INTEGER NOT NULL,
  PRIMARY KEY (game_id, scorer_id)
);

CREATE TABLE game_category (                 -- the pool AS OFFERED that night
  game_id     TEXT NOT NULL REFERENCES game(game_id),
  category    TEXT NOT NULL,
  vote_total  INTEGER NOT NULL DEFAULT 0,
  was_played  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (game_id, category)
);

CREATE TABLE vote (
  game_id   TEXT NOT NULL REFERENCES game(game_id),
  player_id TEXT NOT NULL REFERENCES player(player_id),
  category  TEXT NOT NULL,
  count     INTEGER NOT NULL,                -- votes are counts, not a set
  PRIMARY KEY (game_id, player_id, category)
);

CREATE TABLE word (
  word_id          INTEGER PRIMARY KEY,
  round_id         TEXT NOT NULL REFERENCES round(round_id),
  player_id        TEXT NOT NULL REFERENCES player(player_id),
  scorer_id        TEXT NOT NULL,            -- the team in team play, else the player
  raw              TEXT NOT NULL,            -- as typed
  normalized       TEXT NOT NULL,            -- what scoring actually compared
  submitted_at     INTEGER NOT NULL,         -- server receipt (Entry.at)
  ms_into_round    INTEGER NOT NULL,         -- submitted_at - round.started_at
  ordinal          INTEGER NOT NULL,         -- nth submission by this player this round
  counted          INTEGER NOT NULL,         -- 0 = blank, or a repeat of their own word
  is_unique        INTEGER,                  -- what actually happened; null when !counted
  collision_group  INTEGER                   -- see §8; null = unique
);
CREATE INDEX word_by_round ON word(round_id);
```

One index beyond the primary keys. `word_by_round` is load-bearing (every
per-round query goes through it); a `normalized` index is deliberately omitted
until a global word-frequency feature actually needs it, because each extra
index is a second row write on every insert (§5).

## 5. Volume: storage is free, writes are the constraint

A `word` row is roughly 120 bytes. A long match — 8 players, 20 words each, 10
rounds — is ~1,600 rows, ~190 KB. **5 GB holds tens of thousands of games; storage
will never be the limit.**

Rows written per day is. With one index, each inserted word costs ~2 rows
written, so a long match is ~3,200 and the 100k/day free allowance covers **~30
full-length matches per day** — several hundred typical ones, since most games
are shorter than the maximum on every axis. That is far beyond a party game's
real load.

**Should the word list be one JSON row instead?** It would cut writes ~20×, and
it is the right shape for anything high-frequency. Two reasons this spec does
not do it. First, D1 is SQLite: there is no `jsonb` column type (that is
Postgres). You would store TEXT and query it through `json_each`, so every
word-level question — collisions, fuzzy-match review, category performance,
"has anyone written this before" — becomes a scan and a join against a virtual
table rather than plain SQL. Those are precisely the questions this archive
exists to answer. Second, the write budget above shows the row-per-word version
is affordable at real volume, so the saving buys headroom that is not needed.

**Tripwire:** if daily play ever approaches ~30 long matches, the fix is to roll
*old* rounds into a compacted blob table, not to change the write path. Recent
data stays queryable; history compresses.

Keystroke *arrays* are the case where the JSON instinct is correct — and §6
avoids needing them at all.

## 6. Speed from submission times alone

The original requirement was a per-character WPM chart. **That is not built,**
and the reason is that it cannot be measured honestly here: the game is played
on phones, and swipe typing, autocomplete and IME composition do not emit one
event per character. Phone keystroke counts would be wrong in a consistent
direction, and a chart that is confidently wrong is worse than no chart.

What survives is arguably the better metric for this game anyway. `word.ms_into_round`
and `word.ordinal` give **answer rate** — words produced per minute across the
round — which is what a listing game is actually testing. About twenty points
across a 60-second round, from data the round already generates.

**This needs no new capture whatsoever.** `Entry.at` is already a server receipt
timestamp; `round.started_at` is the only new value, and it is captured
server-side at the whistle. Consequences worth noting:

- `shared/protocol.ts` is unchanged — no new fields on `submitEntry`.
- No client code changes at all. Nothing is instrumented, no listener is
  attached, and the iOS keyboard arrangement in `PlayerView` is untouched.
- No clock-skew correction is needed, because no client timestamp is used.
  Every time in the archive is server time from one clock.
- Socket traffic is unchanged, which keeps the "no per-second broadcasts"
  property intact.

Derived from the same two columns, at read time: **thinking time** (gap between
consecutive submissions), **fast starts** and **panic finishers** (§10).

If per-character speed is ever genuinely wanted, it arrives as its own spec with
the mobile input problem solved first — not as a column bolted onto this one.

## 7. Fuzzy matching, retroactively

Storing `raw` *and* `normalized` is right, and recomputing matches later works —
`normalize`, `editDistance`, `allowedEdits` and `isMatch` are all pure. One
caveat makes it not quite free: **`allowedEdits` will be tuned.** Its thresholds
are exactly the kind of constant that gets adjusted after a night where
something scored wrong. Recomputing after a change silently rewrites history —
you get today's answer, not what happened at the table.

So the archive stores both truths:

- `word.is_unique` and `word.collision_group` — **what actually happened**, the
  immutable record of how the round was scored on the night.
- `word.raw` + `word.normalized` — the inputs, so any algorithm version can be
  replayed over them.
- `game.scoring_version` — an integer bumped by hand whenever `allowedEdits`,
  `normalize` or `isMatch` changes, so a replay knows which games it is
  comparing like for like.

One integer, and "did my threshold change break anything?" becomes a query.

## 8. Kill stats for free

`scoreRound` in `shared/scoring.ts` already runs union-find over every entry,
clustering all spellings of one answer. That cluster **is** the kill stat, and
it is currently discarded after `alsoBy` is projected out of it.

Persisting the cluster root as `word.collision_group` (an integer, unique within
a round; null when the word was unique) needs **no extra table and no extra
rows**. Every kill question is then a self-join:

```sql
-- who cancels whose words most often
SELECT a.player_id AS victim, b.player_id AS nemesis, COUNT(*) AS kills
FROM word a
JOIN word b ON a.round_id = b.round_id
           AND a.collision_group = b.collision_group
           AND a.scorer_id <> b.scorer_id
WHERE a.collision_group IS NOT NULL
GROUP BY victim, nemesis
ORDER BY kills DESC;
```

Three-way and larger collisions fall out correctly with no special case, which
a pairwise `(killer, victim)` table would not manage.

## 9. Archive every submission, not just the scored ones

`scoreRound` drops blanks and a scorer's own repeats before scoring, so
`Results` is **not** the full submission record. The archive walks
`room.entries` — the raw list — and uses `Results` only to stamp `is_unique` and
`collision_group`.

`counted = 0` marks a submission that never reached scoring. This keeps
"how many words did they type" (a typing-speed question) separate from "how many
words counted" (a scoring question), which the current data model conflates. In
team play it is also the only way to see two teammates racing to the same
answer — the shared-list merge currently makes that invisible.

## 10. Derived at read, never stored

Confirmed out of the schema, since each is a query over `word`:

- **Time to first word** — `MIN(ms_into_round)` per player per round.
- **Panic finishers** — `ms_into_round > (duration - 5000)`.
- **Answer rate over the round** — `ordinal` against `ms_into_round`, one point
  per word. The §6 chart.
- **Thinking time** — the gap between consecutive `ms_into_round` values.
- **Category performance** — `round_score` joined to `round.category`.
- **Vote versus enjoyment** — `game_category.vote_total` against words per
  player in the rounds that category was played.

## 11. What changes outside the archive

Smaller than it first looked, because §6 removed every client-side change:

- `wrangler.jsonc` — `d1_databases` at top level and repeated in `env.staging`.
- `migrations/0001_create_archive.sql` — the schema.
- `shared/archive.ts` — new. The row shapes and the pure mapping onto them.
- `party/archive.ts` — new; the only file that imports the D1 binding.
- `party/server.ts` — capture the round window at the whistle; call the archive
  at the moments in §2; hold archive bookkeeping under its own storage key.
- **No change to any file under `src/`.** No client instrumentation, no new UI.
- **No change to `shared/reduce.ts`, `shared/protocol.ts`, or any game rule.**

### Two deviations from the draft, found while building

**The mapping lives in `shared/`, not `party/`.** The draft put it in
`party/archive.ts` and called for it to be unit-tested. Those are
contradictory: `vitest.config.ts` globs `shared/**/*.test.ts` only, so mapping
functions in `party/` would never run. Splitting it — pure row-mapping in
`shared/archive.ts`, the D1 binding alone in `party/archive.ts` — keeps the
tests in the existing suite and still holds the "no D1 in `shared/`" line,
which was the actual point. Widening the vitest glob to `party/` was the
alternative, and it would invite runtime-dependent tests into a suite that is
deliberately runtime-free.

**`shared/scoring.ts` did change**, against the draft's claim that it would
not. `ScoredEntry` gains a `group`, and `SCORING_VERSION` is declared there.
The draft assumed `alsoBy` could reconstruct the collision clusters; it cannot.
One scorer can write two different words each cancelled by exactly the same
rival — one `alsoBy` value, two clusters. The options were re-running union-find
inside the archive, which is a second copy of the clustering that could drift
from the one that actually scored the round, or exposing the cluster id
`scoreRound` already computes and discards. The second is the only one that can
honour §7's rule that the archive records what really happened.

`group` is the raw union-find root rather than a renumbered 0..n id. Dense ids
would read better in a database dump and cost a second pass over every entry —
measurable against the ten-player entry cap, where scoring is already ~5s of
O(n²) work. Nothing needs them contiguous, only equal within a cluster.

Scoring behaviour is unchanged: same uniqueness, same places, same 293 original
tests passing.

The feature remains additive server-side plumbing. If `party/archive.ts` were
deleted the game would behave identically.

## 12. The boundary this moves

`toRoomState()` is the privacy boundary and it governs **the wire** — which
sockets see which words. This spec does not weaken it: nothing new is
broadcast, and `entries` still reaches only its own player or team.

It does change something real, and it should be stated plainly rather than
discovered later: **words now outlive the room.** Today a match is gone within
minutes of ending. After this, every word anyone types is retained
indefinitely (§13), keyed to a browser id that persists across games. That is
the intended feature, but it is a genuine change in kind. It is bounded by what
§6 declines to capture: a submitted word, never a typed-and-deleted one.

## 13. Decisions

Settled 2026-07-28, closing the draft's open questions.

- **Read path: CLI only.** `wrangler d1 execute` from a terminal. No read
  endpoint, no query API, no caching, no stats screen. A screen is a later spec
  written against real data rather than guessed at now — which is also why §1's
  "the game never reads D1" costs nothing today.
- **Staging writes.** `env.staging` gets its own database, written by matches
  played on the `staging` branch at `staging.oknameone.com`. The junk rows are
  the price of the write path being exercised before it reaches production, and
  a real phone test is the only thing that catches an insert bug before a party
  does. Note this is now a *deliberate* test rather than a side effect of an
  open PR — PRs no longer deploy the Worker at all (`HOSTING.md`).
- **No keystroke capture.** Words and submission times only — see §6.
- **Retention: indefinite.** Storage is not a constraint at this volume, and
  global word-frequency stats only get more interesting with age. No scheduled
  deletion and no per-player purge path is built; if one is ever needed,
  everything is keyed by `player_id`, so it stays a single `DELETE`.
- **Abandoned lobbies are archived.** A room that never reaches round one still
  writes its `game` row with `completed = 0` and `abandoned_phase` set. Rooms
  where nobody ever joined are skipped — `startGame` is the trigger, so a lobby
  that never started never produces a row.

## 14. Build order

Each step is independently verifiable, and nothing before step 4 can affect a
live game.

1. Create both D1 databases; add bindings to `wrangler.jsonc` (top level **and**
   `env.staging`); confirm a trivial query runs against each.
2. Schema as a migration file; apply to local and staging.
3. `party/archive.ts` — pure mapping functions from `Room`/`Results` to row
   shapes, unit-tested without a database.
4. Wire the three call sites in `party/server.ts`, each `ctx.waitUntil` +
   try/catch. Verify locally with three tabs, then read the rows back.
5. Deploy to staging via PR; play a full match on real phones; check the row
   counts and spot-check `collision_group` against what the scoring screen
   showed.
