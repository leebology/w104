import { CATEGORIES } from "./categories";
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
 */
export function pickCategory(
  votes: VoteMap,
  spent: readonly string[],
  roll: number,
): string {
  const isSpent = new Set(spent);
  const available = CATEGORIES.filter((c) => !isSpent.has(c));

  // Unreachable at 16 categories and MAX_ROUND_COUNT 10 — a guard, not a case.
  if (available.length === 0) {
    return weightedPick(CATEGORIES.map((c) => [c, 1]), roll);
  }

  const totals = tallyVotes(votes);
  const voted = available.filter((c) => (totals[c] ?? 0) > 0);
  if (voted.length > 0) {
    return weightedPick(voted.map((c) => [c, totals[c]]), roll);
  }

  // Every voted category is spent: the rest of the match draws uniformly from
  // what nobody asked for, rather than repeating a category or ending early.
  return weightedPick(available.map((c) => [c, 1]), roll);
}

/**
 * Walks the cumulative distribution. The clamp matters: a roll of exactly 1 —
 * or a float that lands a hair past the final edge — would otherwise fall off
 * the end of the scan and reach the fallback return.
 */
function weightedPick(weights: Array<[string, number]>, roll: number): string {
  const total = weights.reduce((sum, [, w]) => sum + w, 0);
  let target = Math.min(Math.max(roll, 0), 0.999999999) * total;
  for (const [category, weight] of weights) {
    target -= weight;
    if (target < 0) return category;
  }
  return weights[weights.length - 1][0];
}
