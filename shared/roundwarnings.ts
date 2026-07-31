/**
 * Which points in a round get a warning band, and in what order they fire.
 *
 * Pure and duration-derived: every client computes the same set from the same
 * round length, so the TV and the phones warn together without anything
 * riding on the wire. See
 * docs/superpowers/specs/2026-07-31-round-time-warnings-design.md.
 */

/**
 * The urgency warnings, in seconds remaining. Already at least
 * WARNING_GAP_SEC apart from one another, which is why the tail needs no
 * separation check among its own members — only the halfway candidate does.
 */
export const TAIL_SEC = [60, 30, 10];

/**
 * The closest two warnings may sit. Twenty seconds is the gap between the
 * tightest pair the tail already ships — 30 and 10 — so it is the spacing the
 * screen is known to survive.
 */
export const WARNING_GAP_SEC = 20;

/**
 * Seconds-remaining marks for a round of `durationSec`, descending.
 *
 * The halfway mark is a *candidate*, never a member: it survives only when it
 * clears the top of the tail by WARNING_GAP_SEC. That single comparison
 * removes every collision the naive set has — half lands exactly on a tail
 * member at 20s, 60s and 120s — with no per-duration special case.
 *
 * **The order of the two operations is load-bearing.** Merged into the tail
 * and sorted by urgency, half on a 15-second round is 7, which is *more*
 * urgent than the tail's 10: it would be kept first, and 10 would then be
 * dropped for sitting inside its gap. The round would warn at 7 seconds
 * having discarded the more urgent warning to keep the less urgent one.
 */
export function warningsFor(durationSec: number): number[] {
  const tail = TAIL_SEC.filter((s) => s < durationSec);
  const half = Math.floor(durationSec / 2);
  const top = tail.length ? Math.max(...tail) : 0;
  return half >= top + WARNING_GAP_SEC ? [half, ...tail] : tail;
}
