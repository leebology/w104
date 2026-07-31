import { useEffect, useMemo, useRef, useState } from "react";
import { warningsFor } from "../shared/roundwarnings";

/**
 * The warning mark to show right now, or null.
 *
 * Seeded once on mount with already-passed marks silently banked, then fires
 * marks as `remaining` crosses them. Each mark fires exactly once per round.
 *
 * **Dependency on remount:** This hook is correct only because its consumer
 * (the HostPlaying/PlayerPlaying screens) remounts on every round boundary via
 * `viewNonce`. Keeping the calling component mounted across a round boundary
 * would break the hook — the fired set would never reset for a second round on
 * the same mount.
 */
export function useRoundWarning(
  remaining: number,
  durationSec: number,
): number | null {
  const marks = useMemo(() => warningsFor(durationSec), [durationSec]);
  const fired = useRef<Set<number>>(new Set());
  const seeded = useRef(false);
  const [mark, setMark] = useState<number | null>(null);

  useEffect(() => {
    if (!seeded.current) {
      // First render of this round. Bank everything already behind us without
      // showing it: a phone joining at 45 seconds left on a three-minute round
      // must not flash "1:30 LEFT" on arrival, which is both startling and false.
      //
      // `>=` rather than `>` so arriving exactly on a mark banks it rather
      // than warning about a moment this client did not witness. It cannot
      // suppress a warning on a round joined at the whistle: every mark is
      // strictly less than durationSec, so nothing is banked at full time.
      fired.current = new Set(marks.filter((m) => m >= remaining));
      seeded.current = true;
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
  }, [remaining, marks]);

  return mark;
}
