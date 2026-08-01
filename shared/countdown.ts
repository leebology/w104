import { COUNTDOWN_MS } from "./reduce";

/**
 * How many numbers the Get Ready card shows on its way down.
 *
 * Five, always — "5, 4, 3, 2, 1" is what a room chants.
 */
export const COUNTDOWN_TICKS = 5;

/**
 * How long each number is on screen. **One second, exactly.**
 *
 * This used to be `COUNTDOWN_MS / COUNTDOWN_TICKS`, which stretched the step to
 * whatever the lead-in clip needed — 1.48s a number at the current pair. The
 * numbers landed on the music, but a room chanting along counts in seconds and
 * nothing else, so a card counting in 1.48s beats is a card the room falls out
 * of step with by about two numerals. A count is a count; the audio does not get
 * to redefine the second.
 */
export const TICK_MS = 1_000;

/**
 * The tail of the phase the count does not cover, held on START.
 *
 * `COUNTDOWN_MS` is set by the lead-in clip and is longer than five seconds
 * (see the note on it in `shared/reduce.ts`), so decoupling the step from the
 * phase leaves a gap. START is what fills it: the count runs out, the card
 * stops counting and says what is about to happen instead, and the clip plays
 * its last bars under a screen that is no longer pretending to measure them.
 *
 * It sits at the **end**, not the beginning: the numbers are what a room needs
 * warning from, so they run first and the whistle lands on START. Floored at 0
 * so a `COUNTDOWN_MS` of five seconds or less — a shorter clip, one day — simply
 * has no START frame rather than a negative window that swallows the count.
 */
export const START_HOLD_MS = Math.max(0, COUNTDOWN_MS - COUNTDOWN_TICKS * TICK_MS);

/** What the card shows: a numeral, or the word that replaces it. */
export type CountdownFace = number | "start";

/**
 * The face of the Get Ready card, from the milliseconds left on the phase.
 *
 * Pure and shared so the TV and every phone map the same instant to the same
 * face: each device counts locally against its own `clockOffset` (nothing about
 * a countdown is ticked over the wire), and two devices dividing the remaining
 * time differently would have the room chanting out of step with itself.
 *
 * Clamped at both ends. The top guards clock skew — a phone whose offset puts
 * it a hair before the phase opened must not flash a 6 — and the bottom is why
 * the card never shows 0: past the count there is START, and the whistle itself
 * is the server's alarm rather than this function's arithmetic, so a card that
 * hit 0 while the room was still waiting on the tick would read as a stall.
 */
export function countdownFace(msLeft: number): CountdownFace {
  if (msLeft <= START_HOLD_MS) return "start";
  const n = Math.ceil((msLeft - START_HOLD_MS) / TICK_MS);
  return Math.min(COUNTDOWN_TICKS, Math.max(1, n));
}
