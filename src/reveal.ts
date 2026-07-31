import { useEffect, useState } from "react";
import { nextChangeAt, stepAt } from "../shared/reveal";
import type { CardView, RevealSchedule, RowView } from "../shared/reveal";
import type { RowReveal } from "./components/WordList";
import { roomStore } from "./net/room";

/**
 * Alternating class suffix. See `RowReveal.pop` for why every flash needs one.
 *
 * Fed an *ordinal* — how many strikes, trail arrivals or manual marks there have
 * been — never a step number. Two strikes two steps apart share a step parity, so
 * the class string would not change and the flash would simply be skipped.
 */
export function parity(ordinal: number): "a" | "b" {
  return ordinal % 2 === 1 ? "a" : "b";
}

/**
 * A row's manual mark as one class suffix: which way its last tap went, plus the
 * parity, so tapping the same word off and on again plays twice.
 *
 * Shared by both screens rather than written twice — the TV draws a mark exactly
 * as the phone that made it does, and either of them can un-draw it: the scorer
 * on their own list, the host on anybody's.
 */
export function selfMarkClass(row: RowView): RowReveal["selfMark"] {
  if (row.selfMarks === 0) return null;
  return `${row.selfStruck ? "strike" : "restore"}-${parity(row.selfMarks)}`;
}

/**
 * The card's reaction to a manual mark — the feathered ring, red on the way down
 * and green on the way up — or null when the room's last mark was not on this
 * card. Returned as a class rather than a boolean because it carries the
 * direction *and* the parity: two marks on one card have to flash twice.
 *
 * A space-prefixed string so both callers can append it directly.
 */
export function selfMarkCardClass(card: CardView): string {
  if (card.selfDirection === null) return "";
  const dir = card.selfDirection === "struck" ? "strike" : "restore";
  return ` card--self-${dir}-${parity(card.selfMarkCount)}`;
}

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
