import { useEffect, useMemo, useRef, useState } from "react";
import { warningsFor } from "../shared/roundwarnings";

/**
 * The warning mark to show right now, or null.
 *
 * Fed `remaining` from `useRemaining`, so the pause behaviour comes for free:
 * a held round's clock stops moving and nothing crosses. Marks are keyed to
 * *values* of remaining, never to elapsed time, which is what makes that true
 * with no code.
 */
export function useRoundWarning(
  remaining: number,
  durationSec: number,
  /**
   * The round's deadline, used purely as the round's identity — a new one
   * means a new round, and the fired set resets with nothing watching for it.
   */
  endsAt: number,
): number | null {
  const marks = useMemo(() => warningsFor(durationSec), [durationSec]);
  const fired = useRef<Set<number>>(new Set());
  const seeded = useRef(0);
  const [mark, setMark] = useState<number | null>(null);

  useEffect(() => {
    if (seeded.current !== endsAt) {
      // New round. Bank everything already behind us without showing it: a
      // phone joining at 45 seconds left on a three-minute round must not
      // flash "1:30 LEFT" on arrival, which is both startling and false.
      //
      // `>=` rather than `>` so arriving exactly on a mark banks it rather
      // than warning about a moment this client did not witness. It cannot
      // suppress a warning on a round joined at the whistle: every mark is
      // strictly less than durationSec, so nothing is banked at full time.
      fired.current = new Set(marks.filter((m) => m >= remaining));
      seeded.current = endsAt;
      setMark(null);
      return;
    }
    // The round is over. debugSkip moves the deadline to now, so `remaining`
    // reaches 0 while the phase is still `playing` for one round trip — with
    // no guard the room would flash "0:10 LEFT" as the round ended.
    if (remaining <= 0) return;

    const crossed = marks.filter((m) => remaining <= m && !fired.current.has(m));
    if (crossed.length === 0) return;
    for (const m of crossed) fired.current.add(m);
    // A locked phone's tab can jump from 60 straight to 5. Firing every mark
    // it skipped would burst three bands at once; the smallest is the one
    // still closest to true.
    setMark(Math.min(...crossed));
  }, [remaining, marks, endsAt]);

  return mark;
}
