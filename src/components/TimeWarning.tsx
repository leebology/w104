import { formatClock } from "../net/clock";

/**
 * The band that flashes as a round runs down.
 *
 * Same language as `.reject-banner`, deliberately: full opacity on the first
 * frame then fading, because a message that fades *in* is a message
 * half-missed — and `pointer-events: none`, because it sits over a list
 * somebody is typing into.
 *
 * `variant` is the anchor, not the look. On the phone the band sits high
 * rather than centre: the reject banner owns the centre, and a duplicate
 * submitted at ten seconds left would otherwise put two bands on one strip of
 * pixels.
 */
export function TimeWarning({ mark, variant }: {
  mark: number;
  variant: "player" | "host";
}) {
  return (
    <p className={`time-warning time-warning--${variant}`} role="status">
      {formatClock(mark)} LEFT
    </p>
  );
}
