import { useEffect, useState } from "react";
import { nextChangeAt, stepAt } from "../shared/reveal";
import type { RevealSchedule } from "../shared/reveal";
import { roomStore } from "./net/room";

export function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * How many lines of the reveal are out right now, on the server's clock.
 *
 * The TV and every phone run this against the same schedule and the same
 * `scoring.startedAt`, which is what keeps them on the same word — the same
 * arrangement the round timer uses, and for the same reason: an absolute moment
 * broadcast once, counted locally. Nothing about the reveal is ticked over the
 * wire.
 *
 * One timer, re-armed for the next visible change rather than one per line, so
 * a late callback cannot accumulate into drift.
 */
export function useRevealStep(
  schedule: RevealSchedule,
  startedAt: number,
  /** The host's FAST FORWARD, from `RoomState`. */
  skipped: boolean,
  reduced: boolean,
): { step: number; dealt: boolean } {
  // Both of these mean "show the settled state now": reduced motion never runs
  // frame 1 or 2 at all, and a skip has landed every strike.
  const settled = reduced || skipped;
  const [now, setNow] = useState(() => roomStore.now());

  useEffect(() => {
    if (settled) return;
    const elapsed = roomStore.now() - startedAt;
    const due = nextChangeAt(schedule, elapsed);
    if (due === null) return;
    // `prev + 1` at minimum: an identical value is not a state change, so a
    // callback that fired inside the same millisecond would leave nothing to
    // re-arm the next timer and the reveal would stop where it stood.
    const id = setTimeout(
      () => setNow((prev) => Math.max(prev + 1, roomStore.now())),
      Math.max(0, due - elapsed),
    );
    return () => clearTimeout(id);
  }, [settled, schedule, startedAt, now]);

  if (settled) return { step: schedule.lastStep, dealt: true };
  const elapsed = now - startedAt;
  return { step: stepAt(schedule, elapsed), dealt: elapsed >= schedule.dealMs };
}
