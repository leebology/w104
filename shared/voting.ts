import { CATEGORIES } from "./categories";
import type { MatchSettings, PlayerId } from "./state";

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
 * screen — an unstable sort here would make the reveal flicker between renders.
 */
export function voteShares(votes: VoteMap): Record<string, number> {
  const totals = tallyVotes(votes);
  const entries = Object.entries(totals);
  const sum = entries.reduce((a, [, n]) => a + n, 0);
  if (sum === 0) return {};

  const exact = entries.map(([category, n]) => ({
    category,
    value: (n * 100) / sum,
    order: CATEGORIES.indexOf(category as (typeof CATEGORIES)[number]),
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
