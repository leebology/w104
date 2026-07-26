import { useEffect, useState } from "react";

/**
 * Whole seconds until `endsAt` on the server's clock. Ticks locally rather
 * than waiting on the network — the server broadcasts the deadline once and
 * every phone counts down on its own.
 */
export function useRemaining(endsAt: number, offset: number): number {
  const compute = () => Math.max(0, Math.ceil((endsAt - (Date.now() + offset)) / 1000));
  const [remaining, setRemaining] = useState(compute);

  useEffect(() => {
    setRemaining(compute());
    const id = setInterval(() => setRemaining(compute()), 200);
    return () => clearInterval(id);
    // `compute` is intentionally excluded: it closes over Date.now() and is a
    // new function identity every render, so including it would tear down
    // and restart the interval on every render instead of only when the
    // deadline or offset actually changes.
  }, [endsAt, offset]);

  return remaining;
}

/** `m:ss` — the form the host timer's big numerals are drawn in. */
export function formatClock(seconds: number): string {
  const safe = Math.max(0, seconds);
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}
