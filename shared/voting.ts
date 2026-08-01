import { BALLOT, CATEGORIES, RANDOM_CATEGORY } from "./categories";
import type { MatchSettings, PlayerId, RoundSummary } from "./state";

/**
 * Every player's votes. Counts, not a set: stacking several votes on one
 * category to push its odds is the whole strategic move. A nested Record
 * rather than a Map because Durable Object storage serializes as JSON and a
 * Map comes back empty.
 */
export type VoteMap = Record<PlayerId, Record<string, number>>;

/**
 * How many votes each player gets. One less than the round count, floored at
 * one — a single-round match still has a category to choose.
 */
export function voteBudget(settings: Pick<MatchSettings, "roundCount">): number {
  return Math.max(1, settings.roundCount - 1);
}

/** How many of their budget this player has spent. */
export function votesSpent(row: Record<string, number> | undefined): number {
  if (!row) return 0;
  let total = 0;
  for (const n of Object.values(row)) total += n;
  return total;
}

/** Total votes per category across every player. Zero-count keys are dropped. */
export function tallyVotes(votes: VoteMap): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of Object.values(votes)) {
    for (const [category, n] of Object.entries(row)) {
      if (n > 0) out[category] = (out[category] ?? 0) + n;
    }
  }
  return out;
}

/**
 * Integer percentages that sum to exactly 100, by largest remainder. Used by
 * the closed host screen, where three numbers that read 33/33/33 would be a
 * visible bug.
 *
 * Remainder ties break by pool order so the same votes always produce the same
 * screen. Without it the result would still be stable across renders (`sort`
 * has been stable since ES2019), but it would depend on insertion order —
 * i.e. on who voted first — rather than being a fixed property of the votes.
 */
export function voteShares(
  votes: VoteMap,
  /**
   * Remainder tie-break order. Defaults to the built-in ballot; the custom
   * pool passes its own card ids, because `BALLOT.indexOf` would hand every
   * one of them -1 and float them all to the front of every tie.
   */
  order: readonly string[] = BALLOT,
): Record<string, number> {
  return sharesOf(tallyVotes(votes), order);
}

/**
 * `voteShares` over a tally that has already been taken.
 *
 * Split out because the custom pool needs percentages keyed by a card's *text*
 * rather than by its id — two cards reading "smells" are one thing to the draw
 * (see `pickCustomCategory`), so they are one chance — and that tally cannot be
 * expressed as a `VoteMap`. The largest-remainder arithmetic is the part that
 * must not be written twice: two roundings of the same votes that disagree by a
 * point would put the TV and the phones on different numbers.
 */
export function sharesOf(
  totals: Record<string, number>,
  order: readonly string[] = BALLOT,
): Record<string, number> {
  const entries = Object.entries(totals);
  const sum = entries.reduce((a, [, n]) => a + n, 0);
  if (sum === 0) return {};

  const exact = entries.map(([category, n]) => ({
    category,
    value: (n * 100) / sum,
    order: order.indexOf(category),
  }));

  const out: Record<string, number> = {};
  let assigned = 0;
  for (const e of exact) {
    out[e.category] = Math.floor(e.value);
    assigned += out[e.category];
  }

  const byRemainder = [...exact].sort((a, b) => {
    const diff = (b.value % 1) - (a.value % 1);
    return diff !== 0 ? diff : a.order - b.order;
  });
  for (let i = 0; assigned < 100; i++, assigned++) {
    out[byRemainder[i % byRemainder.length].category] += 1;
  }
  return out;
}

/**
 * Categories already played this match. Derived from history, never stored —
 * same reasoning as `currentRound`: history only grows, and only at
 * `showStandings`, so a stored copy would be a second truth that could drift.
 *
 * Because the draw happens at the whistle and the previous round is banked
 * before then, this list is always complete at the moment it is read.
 */
export function spentCategories(view: { history: readonly RoundSummary[] }): string[] {
  return view.history.map((h) => h.category);
}

/**
 * The round's category, weighted by vote share over what is left.
 *
 * `roll` is a uniform [0,1) supplied by the caller rather than taken from
 * Math.random() here: this has to stay pure so `reduce` does, and so the
 * distribution can be tested against fixed rolls instead of a stubbed global.
 *
 * **A vote for `RANDOM_CATEGORY` competes as an ordinary weight and then spends
 * its win on a uniform draw.** It is one segment of the same distribution, so
 * six votes for `random` beat five for `song` exactly as six for `animal`
 * would — and the room that asked to be surprised gets a uniform draw over
 * everything unplayed, not just over what somebody voted for.
 */
export function pickCategory(
  votes: VoteMap,
  spent: readonly string[],
  roll: number,
): string {
  const isSpent = new Set(spent);
  const available = CATEGORIES.filter((c) => !isSpent.has(c));

  // Still unreachable at ten categories and MAX_ROUND_COUNT 10, but with no
  // margin left: round ten draws with nine spent, so `available` is exactly
  // one. A guard, not a case — and the reason a pool smaller than the round
  // cap would be a real bug rather than a shorter game.
  if (available.length === 0) return uniformPick(CATEGORIES, roll);

  const totals = tallyVotes(votes);
  const ballot: Array<[string, number]> = available
    .filter((c) => (totals[c] ?? 0) > 0)
    .map((c) => [c, totals[c]]);
  // Never filtered by `spent`: the random option is not a category, so it is
  // never played and never spent, and it stays on the ballot for every round
  // of the match.
  const random = totals[RANDOM_CATEGORY] ?? 0;
  if (random > 0) ballot.push([RANDOM_CATEGORY, random]);

  // Nobody's vote survives — either nobody voted, or every category anybody
  // voted for has been played. The rest of the match draws uniformly from what
  // is left rather than repeating a category or ending early.
  if (ballot.length === 0) return uniformPick(available, roll);

  const { pick, fraction } = weightedPick(ballot, roll);
  // `fraction` is where the roll landed *inside* the winning segment, and
  // conditional on landing there it is itself uniform on [0,1) — so the one
  // roll the caller supplied pays for both stages of the draw and `reduce`
  // still needs exactly one source of randomness per tick.
  return pick === RANDOM_CATEGORY ? uniformPick(available, fraction) : pick;
}

/** An even chance for every entry. */
function uniformPick(pool: readonly string[], roll: number): string {
  return weightedPick(pool.map((c) => [c, 1]), roll).pick;
}

/**
 * Walks the cumulative distribution, returning the segment the roll landed in
 * and how far into that segment it fell.
 *
 * The final `return` already covers a roll of exactly 1 (or a float that lands
 * a hair past the last edge) falling off the end of the scan, so the clamp is
 * belt-and-braces rather than load-bearing — kept because it costs nothing and
 * rules the case out up front.
 */
export function weightedPick(
  weights: Array<[string, number]>,
  roll: number,
): { pick: string; fraction: number } {
  const total = weights.reduce((sum, [, w]) => sum + w, 0);
  let target = Math.min(Math.max(roll, 0), 0.999999999) * total;
  for (const [category, weight] of weights) {
    // Tested before the subtraction rather than after, which is the same edge
    // as the old `target -= weight; if (target < 0)` — it just leaves `target`
    // holding the position within the winning segment.
    if (target < weight) return { pick: category, fraction: target / weight };
    target -= weight;
  }
  return { pick: weights[weights.length - 1][0], fraction: 0 };
}
