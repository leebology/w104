/**
 * Row shapes for the score archive, and the pure mapping from a `Room` onto
 * them. See docs/superpowers/specs/2026-07-28-score-persistence-design.md.
 *
 * **No D1 here, and no Cloudflare runtime.** This module turns game state into
 * plain objects and nothing else; `party/archive.ts` is the only file that
 * knows a database exists. That split is what lets every rule below be tested
 * in milliseconds by the existing `shared/**` suite, which is also why the
 * mapping does not live in `party/` alongside the binding.
 */
import { BALLOT } from "./categories";
import { normalize } from "./scoring";
import type { Results } from "./scoring";
import { computeStandings } from "./standings";
import { rosterOf } from "./teams";
import type { ScorerId } from "./teams";
import type { PlayerId, Room } from "./state";
import { tallyVotes } from "./voting";

export type PlayerRow = {
  player_id: PlayerId;
  first_seen_at: number;
  last_seen_at: number;
  user_agent: string | null;
  country: string | null;
};

export type GameRow = {
  game_id: string;
  lobby_code: string;
  host_player_id: PlayerId | null;
  settings: string;
  scoring_version: number;
  lobby_created_at: number;
  started_at: number;
};

export type ParticipationRow = {
  game_id: string;
  player_id: PlayerId;
  name: string;
  emoji: string;
  role: "host" | "player";
  team_id: string | null;
  team_name: string | null;
};

export type RoundRow = {
  round_id: string;
  game_id: string;
  round_index: number;
  category: string;
  started_at: number;
  ended_at: number;
};

export type RoundScoreRow = {
  round_id: string;
  scorer_id: ScorerId;
  scorer_type: "player" | "team";
  unique_count: number;
  total_count: number;
  place: number;
};

export type WordRow = {
  round_id: string;
  player_id: PlayerId;
  scorer_id: ScorerId;
  raw: string;
  normalized: string;
  submitted_at: number;
  ms_into_round: number;
  ordinal: number;
  counted: 0 | 1;
  is_unique: 0 | 1 | null;
  collision_group: number | null;
};

export type GameCategoryRow = {
  game_id: string;
  category: string;
  vote_total: number;
  was_played: 0 | 1;
};

export type VoteRow = {
  game_id: string;
  player_id: PlayerId;
  category: string;
  count: number;
};

export type GameResultRow = {
  game_id: string;
  scorer_id: ScorerId;
  scorer_type: "player" | "team";
  place: number;
  total_score: number;
};

/**
 * Deterministic, so a retried alarm or a reconnect that re-runs a transition
 * collides with the row it already wrote instead of duplicating it. Every
 * insert in `party/archive.ts` pairs this with ON CONFLICT DO NOTHING.
 */
export function gameId(code: string, startedAt: number): string {
  return `${code}:${startedAt}`;
}

export function roundId(game: string, roundIndex: number): string {
  return `${game}:${roundIndex}`;
}

/** Teams are the only scorer that is not a player; `rosterOf` guarantees it. */
const scorerType = (colorIndex: number | null): "player" | "team" =>
  colorIndex === null ? "player" : "team";

export type PlayerMeta = { userAgent?: string; country?: string };

export type GameStartContext = {
  gameId: string;
  lobbyCreatedAt: number;
  startedAt: number;
  scoringVersion: number;
  /** Captured at the connect gate; absent for anyone who joined before it. */
  meta?: Record<PlayerId, PlayerMeta>;
};

/**
 * Written once, when a match actually starts. Deliberately not at room
 * creation: a lobby nobody ever started is noise, and `startGame` is the only
 * edge that says a match happened.
 */
export function gameStartRows(
  room: Room,
  ctx: GameStartContext,
): { players: PlayerRow[]; game: GameRow; participation: ParticipationRow[] } {
  const seats: Array<{ id: PlayerId; name: string; emoji: string; role: "host" | "player" }> =
    room.players.map((p) => ({ id: p.id, name: p.name, emoji: p.emoji, role: "player" }));

  // The host holds no seat in `players` and never scores, but leaving them out
  // entirely would make "who hosts the most" unanswerable. They are archived
  // as a participant with role 'host' and no team.
  if (room.hostId !== null && !seats.some((s) => s.id === room.hostId)) {
    seats.push({ id: room.hostId, name: "", emoji: "", role: "host" });
  }

  const players: PlayerRow[] = seats.map((s) => ({
    player_id: s.id,
    first_seen_at: ctx.startedAt,
    last_seen_at: ctx.startedAt,
    user_agent: ctx.meta?.[s.id]?.userAgent ?? null,
    country: ctx.meta?.[s.id]?.country ?? null,
  }));

  const participation: ParticipationRow[] = seats.map((s) => {
    const player = room.players.find((p) => p.id === s.id);
    const team = player?.teamId
      ? room.teams.find((t) => t.id === player.teamId)
      : undefined;
    return {
      game_id: ctx.gameId,
      player_id: s.id,
      // Display identity as it stood THAT night. People rename themselves
      // between games; storing this on `player` would let last-write-wins
      // destroy the history.
      name: s.name,
      emoji: s.emoji,
      role: s.role,
      team_id: team?.id ?? null,
      team_name: team?.name ?? null,
    };
  });

  return {
    players,
    participation,
    game: {
      game_id: ctx.gameId,
      lobby_code: room.code,
      host_player_id: room.hostId,
      settings: JSON.stringify(room.settings),
      scoring_version: ctx.scoringVersion,
      lobby_created_at: ctx.lobbyCreatedAt,
      started_at: ctx.startedAt,
    },
  };
}

/**
 * The category pool as offered that night, with final vote counts.
 *
 * Written when the first round banks, **not** at match start: voting happens
 * after `startGame`, so at match start there is nothing to record. Votes are
 * immutable once voting closes, so the first bank is the earliest moment they
 * are both complete and safe.
 *
 * The *ballot* rather than the pool, so `random` gets a row like everything
 * else: a vote for it is one of the votes cast that night, and a snapshot that
 * left it out would make the counts fail to add up. It simply never earns
 * `was_played` — the match-end update sets that from the categories actually
 * drawn, and `random` is never one of them.
 */
export function voteRows(
  room: Room,
  game: string,
): { categories: GameCategoryRow[]; votes: VoteRow[] } {
  const totals = tallyVotes(room.votes);
  const categories: GameCategoryRow[] = BALLOT.map((category) => ({
    game_id: game,
    category,
    vote_total: totals[category] ?? 0,
    was_played: 0, // set by the match-end update; a round may not exist yet
  }));

  const votes: VoteRow[] = [];
  for (const [playerId, row] of Object.entries(room.votes)) {
    for (const [category, count] of Object.entries(row)) {
      if (count > 0) votes.push({ game_id: game, player_id: playerId, category, count });
    }
  }
  return { categories, votes };
}

export type RoundContext = {
  gameId: string;
  /** 0-based. `history.length` at the moment the round is banked. */
  roundIndex: number;
  startedAt: number;
  endedAt: number;
};

/**
 * One banked round.
 *
 * **Must be called with the room as it stood BEFORE `showStandings`.** That
 * transition is the single place `entries` is emptied, so a room read after it
 * has no words left to archive.
 */
export function roundRows(
  room: Room,
  results: Results,
  places: Record<ScorerId, { unique: number; total: number; place: number }>,
  ctx: RoundContext,
): { round: RoundRow; scores: RoundScoreRow[]; words: WordRow[] } {
  const id = roundId(ctx.gameId, ctx.roundIndex);
  const scorers = rosterOf(room);

  const scores: RoundScoreRow[] = scorers.flatMap((scorer) => {
    const place = places[scorer.id];
    if (place === undefined) return [];
    return [{
      round_id: id,
      scorer_id: scorer.id,
      scorer_type: scorerType(scorer.colorIndex),
      unique_count: place.unique,
      total_count: place.total,
      place: place.place,
    }];
  });

  const scored = new Map(results.scorers.map((s) => [s.id, s.entries]));
  // Ordinal is per PLAYER — "their nth submission this round" — even in team
  // play, where the shared list interleaves several people.
  const ordinals = new Map<PlayerId, number>();
  const words: WordRow[] = [];

  for (const scorer of scorers) {
    // Re-derive exactly what `scoreRound` flattened: the members' lists merged
    // in submission order. Walking it in the same order lets the scored
    // entries be consumed in step, so no fuzzy re-matching is needed.
    const merged = scorer.members
      .flatMap((memberId) => room.entries[memberId] ?? [])
      .sort((a, b) => a.at - b.at);
    const entries = scored.get(scorer.id) ?? [];
    const seen = new Set<string>();
    let next = 0;

    for (const entry of merged) {
      const norm = normalize(entry.text);
      const ordinal = (ordinals.get(entry.by) ?? 0) + 1;
      ordinals.set(entry.by, ordinal);

      // Blanks and a scorer's own repeats never reached scoring. Archiving
      // them anyway is what keeps "how many did they type" separable from
      // "how many counted" — and in team play it is the only trace of two
      // teammates racing to the same answer.
      const counted = norm !== "" && !seen.has(norm);
      let isUnique: 0 | 1 | null = null;
      let group: number | null = null;
      if (counted) {
        seen.add(norm);
        const s = entries[next++];
        if (s !== undefined) {
          isUnique = s.unique ? 1 : 0;
          group = s.unique ? null : s.group;
        }
      }

      words.push({
        round_id: id,
        player_id: entry.by,
        scorer_id: scorer.id,
        raw: entry.text,
        normalized: norm,
        submitted_at: entry.at,
        ms_into_round: entry.at - ctx.startedAt,
        ordinal,
        counted: counted ? 1 : 0,
        is_unique: isUnique,
        collision_group: group,
      });
    }
  }

  return {
    round: {
      round_id: id,
      game_id: ctx.gameId,
      round_index: ctx.roundIndex,
      category: room.category,
      started_at: ctx.startedAt,
      ended_at: ctx.endedAt,
    },
    scores,
    words,
  };
}

/**
 * Final standings as rows. `computeStandings` already ranks by golf points
 * with ties sharing a place, so this is a projection rather than a second
 * ranking implementation.
 */
export function gameResultRows(room: Room, game: string): GameResultRow[] {
  return computeStandings(rosterOf(room), room.history).map((s) => ({
    game_id: game,
    scorer_id: s.id,
    scorer_type: scorerType(s.colorIndex),
    place: s.place,
    total_score: s.points,
  }));
}

/** Categories this match actually drew, for the match-end `was_played` update. */
export function playedCategories(room: Room): string[] {
  return [...new Set(room.history.map((h) => h.category))];
}
