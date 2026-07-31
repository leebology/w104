/**
 * The scoring reveal's pacing, in a module of its own.
 *
 * The same arrangement `shared/rng.ts` is in, and for the same reason: its
 * callers sit on opposite sides of the codebase. `shared/reveal.ts` builds the
 * schedule from these numbers, and `shared/state.ts` needs the default cadence
 * to seed `Room.revealLineMs` — but state cannot import reveal without closing
 * a cycle through `scoring.ts` (see the header of `shared/selfstrike.ts`, which
 * exists because of the same wall). Nothing is imported here, so nothing can
 * cycle through it.
 *
 * `shared/reveal.ts` re-exports the lot, so every existing import site is
 * unchanged.
 */

/**
 * The pacing of frames 1 and 2, in milliseconds.
 *
 * Shared rather than the host screen's own because the reveal is not only the
 * host's: every phone derives the same `step` from the same schedule and the
 * same `scoring.startedAt`, so a second copy of these numbers would put the TV
 * and the phones on visibly different lines.
 */
export const REVEAL_TIMING = {
  /** Frame 1: per-card deal delay, and how long one card's swing lasts. */
  DEAL_STAGGER: 150,
  DEAL_DURATION: 920,
  /**
   * Frame 2: one line, every time, whatever the list length. No accelerating
   * stagger, no length-scaled timing, no batching past a threshold — the single
   * cadence is what pulls the whole room to the same word at the same moment.
   *
   * The default, not a constant: the debug menu can move the room's cadence off
   * it, which is why `buildSchedule` takes the figure rather than reading this.
   */
  LINE_INTERVAL: 400,
  /**
   * The extra beat before a column's first line. Not dead time: the next card
   * shakes through it, so the room's eye is already on the list about to fill.
   */
  COLUMN_PAUSE: 1_000,
  /** How long a word holds in plain ink before its own strike draws through. */
  STRIKE_HOLD: 180,
} as const;

/**
 * What the debug slider may set the line cadence to, in milliseconds.
 *
 * The floor is a real reveal rather than an instant one — below about 50ms a
 * line the strike animation cannot finish before the next word lands and the
 * whole thing reads as a flicker. The ceiling is where a ten-word column takes
 * a quarter of a minute, which is already past what a room will sit through.
 */
export const MIN_LINE_MS = 50;
export const MAX_LINE_MS = 1_500;

/**
 * Bounds and floors a cadence. The wire is not trusted with this: it is the
 * denominator of every step in the reveal's schedule, and a NaN or a zero would
 * put every line on the same millisecond.
 */
export function clampLineMs(ms: number): number {
  if (!Number.isFinite(ms)) return REVEAL_TIMING.LINE_INTERVAL;
  return Math.max(MIN_LINE_MS, Math.min(MAX_LINE_MS, Math.round(ms)));
}
