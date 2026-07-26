import type { Results } from "./scoring";
import type { Player, PlayerId, RoundPlace, RoundSummary } from "./state";

export type Standing = {
  id: PlayerId;
  name: string;
  emoji: string;
  /** Sum of places across every round this player was scored in. */
  points: number;
  /** Place per round, in play order. The badge strip renders this directly. */
  badges: number[];
  /** 1-based standing position. Ties share a place. */
  place: number;
};

/**
 * Standard competition ranking on an ascending score: equal scores share a
 * place and the places after a tie are skipped, so 1,2,2,4 rather than
 * 1,2,2,3. Under golf points a shared place must cost what it costs — dense
 * ranking would make tying *cheaper* than losing outright.
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
export function placeRound(results: Results): Record<PlayerId, RoundPlace> {
  const ranked = rankAscending(results.players, (p) => -p.unique);
  const places: Record<PlayerId, RoundPlace> = {};
  for (const p of results.players) {
    places[p.id] = { unique: p.unique, total: p.total, place: ranked.get(p)! };
  }
  return places;
}

/**
 * Match standings: lowest points first, ties sharing a place.
 *
 * Iterates the live roster and looks history up by id, never the reverse.
 * That direction is what makes a kicked player vanish from the standings with
 * no special-casing, while a merely disconnected player keeps their seat,
 * points and badges.
 */
export function computeStandings(
  players: Player[],
  history: RoundSummary[],
): Standing[] {
  const rows = players.map((p) => {
    const badges = history
      .map((summary) => summary.places[p.id]?.place)
      .filter((place): place is number => place !== undefined);
    return {
      id: p.id,
      name: p.name,
      emoji: p.emoji,
      badges,
      points: badges.reduce((sum, place) => sum + place, 0),
      place: 0,
    };
  });

  const ranked = rankAscending(rows, (row) => row.points);
  return rows
    .map((row) => ({ ...row, place: ranked.get(row)! }))
    .sort((a, b) => a.place - b.place);
}
