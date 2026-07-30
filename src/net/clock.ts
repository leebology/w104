import { useEffect, useState } from "react";

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

/** `m:ss` — the form the host timer's big numerals are drawn in. */
export function formatClock(seconds: number): string {
  const safe = Math.max(0, seconds);
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}
