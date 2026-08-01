import { COUNTDOWN_MS } from "./reduce";

/**
 * How many numbers the Get Ready card shows on its way down.
 *
 * Five, always — "5, 4, 3, 2, 1" is what a room chants, and it is what the
 * card said back when the phase was five seconds long and nothing was playing
 * over it. `COUNTDOWN_MS` is no longer five seconds and never will be again:
 * it is set by the lead-in clip (see the note on it in `shared/reduce.ts`), so
 * a card counting whole seconds would open on whatever number that file's
 * length happened to round up to — 8, today, and something else the next time
 * somebody swaps the music.
 *
 * So the count is decoupled from the clock. The card always opens on this
 * number and always lands on 1, and the *step* stretches to fill whatever the
 * audio needs — 1.48 seconds a number at the current pair. A beat longer than
 * a second is the right way round for a card being read across a room, and the
 * numbers land on the music rather than drifting against it.
 */
export const COUNTDOWN_TICKS = 5;

/** How long each number is on screen. Not a whole second — see above. */
export const TICK_MS = COUNTDOWN_MS / COUNTDOWN_TICKS;

/**
 * The number on the Get Ready card, from the milliseconds left on the phase.
 *
 * Pure and shared so the TV and every phone map the same instant to the same
 * numeral: each device counts locally against its own `clockOffset` (nothing
 * about a countdown is ticked over the wire), and two devices dividing the
 * remaining time differently would have the room chanting out of step with
 * itself.
 *
 * Clamped at both ends. The top guards clock skew — a phone whose offset puts
 * it a hair before the phase opened must not flash a 6 — and the bottom is why
 * the card never shows 0: the whistle is the server's alarm, not this
 * function's arithmetic, and a card that hit 0 while the room was still waiting
 * on the tick would read as a stall.
 */
export function countdownNumber(msLeft: number): number {
  const n = Math.ceil(msLeft / TICK_MS);
  return Math.min(COUNTDOWN_TICKS, Math.max(1, n));
}
