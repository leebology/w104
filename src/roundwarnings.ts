import { useEffect, useMemo, useRef, useState } from "react";
import { warningsFor } from "../shared/roundwarnings";

/**
 * The warning mark to show right now, or null.
 *
 * Detects a new round by tracking whether `remaining` has increased beyond
 * what we've seen for the current `durationSec`. A held-then-resumed round
 * stays in the same round session since `remaining` stays frozen during pause,
 * so bands are not cut short on resume.
 *
 * `remaining` comes from `useRemaining`, which already freezes the clock
 * during a pause, so pause/resume is implicit: when the host resumes,
 * `remaining` does not jump up (only `endsAt` changes), so we correctly stay
 * in the same round session and any displayed mark persists.
 */
export function useRoundWarning(
  remaining: number,
  durationSec: number,
  /**
   * Included in the function signature for compatibility with the broader
   * architecture, but not used for round identity — `remaining` tracks
   * elapsed time and is the real signal of a new round.
   */
  endsAt: number,
): number | null {
  const marks = useMemo(() => warningsFor(durationSec), [durationSec]);
  const fired = useRef<Set<number>>(new Set());
  const durationMaxRemaining = useRef<Record<number, number>>({});
  const [mark, setMark] = useState<number | null>(null);

  useEffect(() => {
    let isNewRound = false;

    if (!(durationSec in durationMaxRemaining.current)) {
      // First time seeing this duration: definitely a new round.
      isNewRound = true;
      durationMaxRemaining.current[durationSec] = remaining;
    } else if (remaining > durationMaxRemaining.current[durationSec]) {
      // remaining increased for this duration, so the round has reset:
      // definitely a new round.
      isNewRound = true;
      durationMaxRemaining.current[durationSec] = remaining;
    }

    if (isNewRound) {
      // New round. Bank everything already behind us without showing it: a
      // phone joining at 45 seconds left on a three-minute round must not
      // flash "1:30 LEFT" on arrival, which is both startling and false.
      //
      // `>=` rather than `>` so arriving exactly on a mark banks it rather
      // than warning about a moment this client did not witness. It cannot
      // suppress a warning on a round joined at the whistle: every mark is
      // strictly less than durationSec, so nothing is banked at full time.
      fired.current = new Set(marks.filter((m) => m >= remaining));
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
  }, [remaining, marks, durationSec]);

  return mark;
}
