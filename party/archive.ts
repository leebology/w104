/**
 * The only file that knows the score archive exists.
 *
 * See docs/superpowers/specs/2026-07-28-score-persistence-design.md. The rules
 * this module exists to hold:
 *
 *   * **The game never reads it.** Every statement here is an INSERT or an
 *     UPDATE. There is no SELECT, and adding one would make the archive load
 *     bearing for play, which it must never be.
 *   * **It is allowed to fail.** Every entry point swallows its errors after
 *     logging. Callers wrap these in `ctx.waitUntil` so a slow D1 write cannot
 *     stall a round; a lost row is a worse outcome than a stalled party only
 *     in the abstract.
 *   * **Every insert is idempotent.** Ids are deterministic (see
 *     `shared/archive.ts`) and every statement carries ON CONFLICT DO NOTHING,
 *     because an alarm that retries or a reconnect that replays a transition
 *     will re-run these calls.
 *
 * All the mapping from game state to rows lives in `shared/archive.ts`, where
 * it is unit-tested without a database.
 */
import type {
  GameCategoryRow, GameResultRow, GameRow, ParticipationRow, PlayerRow,
  RoundRow, RoundScoreRow, VoteRow, WordRow,
} from "../shared/archive";

/**
 * D1 caps how many statements one `batch` may carry, and a ten-player round at
 * the entry cap is a couple of thousand word rows. Chunking keeps every call
 * comfortably inside the limit; the chunks are independent because each
 * statement is individually idempotent, so a partial failure loses rows rather
 * than corrupting anything.
 */
const CHUNK = 50;

async function runChunked(
  db: D1Database,
  statements: D1PreparedStatement[],
): Promise<void> {
  for (let i = 0; i < statements.length; i += CHUNK) {
    await db.batch(statements.slice(i, i + CHUNK));
  }
}

/**
 * Wraps the whole call so an archive failure can never reach the game loop.
 * Returns nothing: there is no success path a caller could branch on, by
 * design — if this module could change what the room does, it would be part
 * of the game rather than a record of it.
 */
async function guard(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`archive: ${label} failed`, err);
  }
}

export async function archiveGameStart(
  db: D1Database,
  rows: { players: PlayerRow[]; game: GameRow; participation: ParticipationRow[] },
): Promise<void> {
  await guard("gameStart", async () => {
    const statements: D1PreparedStatement[] = [];

    for (const p of rows.players) {
      statements.push(
        db.prepare(
          `INSERT INTO player (player_id, first_seen_at, last_seen_at, user_agent, country)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(player_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
        ).bind(p.player_id, p.first_seen_at, p.last_seen_at, p.user_agent, p.country),
      );
    }

    // Parents before children: D1 enforces foreign keys, so `game` has to land
    // before anything referencing it. Same reason the player loop runs first.
    statements.push(
      db.prepare(
        `INSERT INTO game (game_id, lobby_code, host_player_id, settings,
                           scoring_version, lobby_created_at, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(game_id) DO NOTHING`,
      ).bind(
        rows.game.game_id, rows.game.lobby_code, rows.game.host_player_id,
        rows.game.settings, rows.game.scoring_version,
        rows.game.lobby_created_at, rows.game.started_at,
      ),
    );

    for (const p of rows.participation) {
      statements.push(
        db.prepare(
          `INSERT INTO participation (game_id, player_id, name, emoji, role, team_id, team_name)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(game_id, player_id) DO NOTHING`,
        ).bind(p.game_id, p.player_id, p.name, p.emoji, p.role, p.team_id, p.team_name),
      );
    }

    await runChunked(db, statements);
  });
}

export async function archiveVotes(
  db: D1Database,
  rows: { categories: GameCategoryRow[]; votes: VoteRow[] },
): Promise<void> {
  await guard("votes", async () => {
    const statements: D1PreparedStatement[] = [];
    for (const c of rows.categories) {
      statements.push(
        db.prepare(
          `INSERT INTO game_category (game_id, category, vote_total, was_played)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(game_id, category) DO NOTHING`,
        ).bind(c.game_id, c.category, c.vote_total, c.was_played),
      );
    }
    for (const v of rows.votes) {
      statements.push(
        db.prepare(
          `INSERT INTO vote (game_id, player_id, category, count)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(game_id, player_id, category) DO NOTHING`,
        ).bind(v.game_id, v.player_id, v.category, v.count),
      );
    }
    await runChunked(db, statements);
  });
}

export async function archiveRound(
  db: D1Database,
  rows: { round: RoundRow; scores: RoundScoreRow[]; words: WordRow[] },
): Promise<void> {
  await guard("round", async () => {
    const r = rows.round;
    // The round row goes in its own call, before the rows that reference it.
    // Chunking means the children can span several batches, and a foreign key
    // cannot be satisfied by a parent sitting in a later one.
    await db.prepare(
      `INSERT INTO round (round_id, game_id, round_index, category, started_at, ended_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(round_id) DO NOTHING`,
    ).bind(r.round_id, r.game_id, r.round_index, r.category, r.started_at, r.ended_at).run();

    const statements: D1PreparedStatement[] = [];
    for (const s of rows.scores) {
      statements.push(
        db.prepare(
          `INSERT INTO round_score (round_id, scorer_id, scorer_type,
                                    unique_count, total_count, place)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(round_id, scorer_id) DO NOTHING`,
        ).bind(s.round_id, s.scorer_id, s.scorer_type, s.unique_count, s.total_count, s.place),
      );
    }
    for (const w of rows.words) {
      // `word` has a surrogate INTEGER PRIMARY KEY, so it has no natural
      // conflict target to lean on. The DELETE makes a replayed round
      // idempotent the only way available: clear this round's words first,
      // then write them again. Safe because a banked round never changes.
      statements.push(
        db.prepare(
          `INSERT INTO word (round_id, player_id, scorer_id, raw, normalized,
                             submitted_at, ms_into_round, ordinal, counted,
                             is_unique, collision_group)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          w.round_id, w.player_id, w.scorer_id, w.raw, w.normalized,
          w.submitted_at, w.ms_into_round, w.ordinal, w.counted,
          w.is_unique, w.collision_group,
        ),
      );
    }

    await db.prepare(`DELETE FROM word WHERE round_id = ?`).bind(r.round_id).run();
    await runChunked(db, statements);
  });
}

export async function archiveMatchEnd(
  db: D1Database,
  gameId: string,
  results: GameResultRow[],
  played: string[],
  endedAt: number,
  completed: boolean,
  abandonedPhase: string | null,
): Promise<void> {
  await guard("matchEnd", async () => {
    const statements: D1PreparedStatement[] = [
      db.prepare(
        `UPDATE game SET ended_at = ?, completed = ?, abandoned_phase = ?
         WHERE game_id = ?`,
      ).bind(endedAt, completed ? 1 : 0, abandonedPhase, gameId),
    ];

    for (const r of results) {
      statements.push(
        db.prepare(
          `INSERT INTO game_result (game_id, scorer_id, scorer_type, place, total_score)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(game_id, scorer_id) DO NOTHING`,
        ).bind(r.game_id, r.scorer_id, r.scorer_type, r.place, r.total_score),
      );
    }

    // `was_played` is set here rather than when the pool was written, because
    // at that point no round had been drawn yet.
    for (const category of played) {
      statements.push(
        db.prepare(
          `UPDATE game_category SET was_played = 1 WHERE game_id = ? AND category = ?`,
        ).bind(gameId, category),
      );
    }

    await runChunked(db, statements);
  });
}
