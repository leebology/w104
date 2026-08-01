import { useEffect, useState } from "react";
import { TICK_MS, countdownFace } from "../../shared/countdown";
import type { CountdownFace } from "../../shared/countdown";

/**
 * Whole seconds until `endsAt` on the server's clock. Ticks locally rather
 * than waiting on the network — the server broadcasts the deadline once and
 * every phone counts down on its own.
 */
export function useRemaining(
  endsAt: number,
  offset: number,
  /**
   * Milliseconds held on the clock, from `RoomState.paused`, or null when the
   * round is running. While this is set, `endsAt` is stale by design — the
   * server stopped maintaining it the moment the host paused — so counting
   * against it would run the display straight down to 0:00 on a round that is
   * merely stopped. The banked figure is shown frozen instead, and the
   * interval is not started at all.
   */
  pausedMs: number | null = null,
): number {
  const frozen = pausedMs === null ? null : Math.max(0, Math.ceil(pausedMs / 1000));
  const compute = () => Math.max(0, Math.ceil((endsAt - (Date.now() + offset)) / 1000));
  const [remaining, setRemaining] = useState(() => frozen ?? compute());

  useEffect(() => {
    if (frozen !== null) {
      setRemaining(frozen);
      return;
    }
    setRemaining(compute());
    const id = setInterval(() => setRemaining(compute()), 200);
    return () => clearInterval(id);
    // `compute` is intentionally excluded: it closes over Date.now() and is a
    // new function identity every render, so including it would tear down
    // and restart the interval on every render instead of only when the
    // deadline, offset, or hold actually changes.
  }, [endsAt, offset, frozen]);

  return remaining;
}

/**
 * The face of the Get Ready card — 5 down to 1, then START, on the phase's own
 * clock.
 *
 * A separate hook from `useRemaining` rather than a formatting of it: the count
 * does not cover the whole phase (see `START_HOLD_MS`), so whole seconds of
 * remaining time cannot express what the card is showing. The arithmetic itself
 * lives in `shared/countdown.ts` so the TV and the phones cannot drift apart on
 * it; this is only the ticking.
 *
 * There is no `pausedMs` argument, and there is nothing to add: `countdown` is
 * not in `isHoldable` (see the debug menu notes), so this deadline is never
 * stale the way a round's is.
 */
export function useCountdownFace(endsAt: number, offset: number): CountdownFace {
  const compute = () => countdownFace(endsAt - (Date.now() + offset));
  const [face, setFace] = useState(compute);

  useEffect(() => {
    setFace(compute());
    // A quarter of a step, so a face is never more than that late arriving.
    const id = setInterval(() => setFace(compute()), TICK_MS / 4);
    return () => clearInterval(id);
    // `compute` excluded for the reason it is in `useRemaining` above.
  }, [endsAt, offset]);

  return face;
}

/** `m:ss` — the form the host timer's big numerals are drawn in. */
export function formatClock(seconds: number): string {
  const safe = Math.max(0, seconds);
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}
