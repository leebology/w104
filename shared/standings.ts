import type { Results } from "./scoring";
import type { PlayerId, RoundPlace, RoundSummary } from "./state";
import type { Scorer, ScorerId } from "./teams";

export type Standing = {
  id: ScorerId;
  name: string;
  emoji: string;
  /** The team's accent; null for a player. */
  colorIndex: number | null;
  /** Who this row is made of. [self] for a player. */
  members: PlayerId[];
  /** Sum of `roundPoints` across every round this scorer was scored in. */
  points: number;
  /** Place per round, in play order. The badge strip renders this directly. */
  badges: number[];
  /**
   * Points earned in the **most recent** round, or null for a scorer who was
   * not in it. The standings screens print it beside the running total, so a
   * room reading the board between rounds can see what the round just played
   * was worth rather than having to diff two numbers in their heads.
   */
  last: number | null;
  /** 1-based standing position. Ties share a place. */
  place: number;
};

/**
 * What one round's finishing place is worth.
 *
 * Inverted against the place itself: **first takes a point for every scorer in
 * the round and last always takes exactly one**, so a round is worth more the
 * bigger the room and the total only ever goes up. Ties share a place and
 * therefore share its points, and the places a tie skips are simply never
 * awarded — coming 2nd= in a four-way is worth 3, and nobody takes the 2 that
 * 3rd place would have been.
 *
 * `size` is the number of scorers *that round* had, taken from the round's own
 * `places` record rather than from the room as it stands now — a player who
 * joined for round three must not retroactively make round one worth more.
 */
export function roundPoints(place: number, size: number): number {
  return Math.max(1, size - place + 1);
}

/**
 * Standard competition ranking on an ascending score: equal scores share a
 * place and the places after a tie are skipped, so 1,2,2,4 rather than
 * 1,2,2,3. A shared place must cost what it costs — dense ranking would make
 * tying *cheaper* than losing outright.
 *
 * Callers wanting a descending rank pass a negated score.
 */
function rankAscending<T>(items: T[], scoreOf: (item: T) => number): Map<T, number> {
  const sorted = [...items].sort((a, b) => scoreOf(a) - scoreOf(b));
  const places = new Map<T, number>();
  sorted.forEach((item, i) => {
    const prev = i > 0 ? sorted[i - 1] : undefined;
    const place =
      prev !== undefined && scoreOf(prev) === scoreOf(item) ? places.get(prev)! : i + 1;
    places.set(item, place);
  });
  return places;
}

/** Ranks one round's results by unique words, highest first. */
export function placeRound(results: Results): Record<ScorerId, RoundPlace> {
  const ranked = rankAscending(results.scorers, (s) => -s.unique);
  const places: Record<ScorerId, RoundPlace> = {};
  for (const s of results.scorers) {
    places[s.id] = { unique: s.unique, total: s.total, place: ranked.get(s)! };
  }
  return places;
}

/**
 * Match standings: **highest points first**, ties sharing a place.
 *
 * Iterates the live scorer list and looks history up by id, never the
 * reverse. That direction is what makes a kicked player vanish from the
 * standings with no special-casing, while a merely disconnected player keeps
 * their seat, points and badges — and it is what lets a team keep its points
 * when one of its members is removed.
 */
export function computeStandings(
  scorers: Scorer[],
  history: RoundSummary[],
): Standing[] {
  const rows = scorers.map((s) => {
    // Rounds this scorer was actually in, paired with how big that round was.
    // A scorer absent from a round contributes nothing to their total and no
    // badge, which is what lets somebody join mid-match without a hole in the
    // strip or a phantom last place.
    const scored = history
      .map((summary) => ({
        place: summary.places[s.id]?.place,
        size: Object.keys(summary.places).length,
      }))
      .filter((r): r is { place: number; size: number } => r.place !== undefined);
    const earned = scored.map((r) => roundPoints(r.place, r.size));
    return {
      id: s.id,
      name: s.name,
      emoji: s.emoji,
      colorIndex: s.colorIndex,
      members: s.members,
      badges: scored.map((r) => r.place),
      points: earned.reduce((sum, points) => sum + points, 0),
      // The round just played, not the last one *this* scorer was in: somebody
      // who sat the round out gained nothing, and printing an older round's
      // points beside their total would read as if they had.
      last:
        history.length > 0 && history[history.length - 1].places[s.id] !== undefined
          ? earned[earned.length - 1]
          : null,
      place: 0,
    };
  });

  // Negated, because `rankAscending` ranks upward and the highest total now
  // wins. Ties still share a place and still skip the ones behind them.
  const ranked = rankAscending(rows, (row) => -row.points);
  return rows
    .map((row) => ({ ...row, place: ranked.get(row)! }))
    .sort((a, b) => a.place - b.place);
}
