import type { ReactNode } from "react";
import { useCountdownFace } from "../net/clock";

type Props = {
  /** The countdown phase's deadline on the server's clock. */
  endsAt: number;
  /** `state.clockOffset` — the card counts against it locally, like every timer. */
  offset: number;
  /**
   * The turquoise tab overhanging the card's top-left corner — "ROUND 3", or
   * "CATEGORY VOTE" for the one countdown that does not lead to a round. It is
   * a tab rather than a line in the note below because it is the only part of
   * this card that changes between the four places it is used, and a room
   * glancing up mid-conversation reads the corner, not the caption.
   */
  label: string;
  /**
   * The host's cancel. Absent on the phones, and absent on the two host screens
   * whose countdown is deliberately not cancellable — see `cancelStart` in
   * shared/reduce.ts for why the team-select and post-voting counts refuse it.
   */
  onStop?: () => void;
  /** Anything extra under the note. Nothing uses it yet; it keeps the card closed. */
  children?: ReactNode;
};

/**
 * The countdown, at the size a room reads across a room.
 *
 * One card for every count in the game — the lobby readying up, the one after
 * the category vote, and the one between rounds — rather than the plaque, the
 * TV-sized plaque and the big card the standings screen used to have to itself.
 * They are all the same moment, so they are all the same object; the phones get
 * it too, scaled by CSS and never by a second component.
 *
 * It carries no category. Nothing here can name one: the draw happens at the
 * whistle (see `tick` in shared/reduce.ts), so there is nothing to name until
 * the round is already running.
 *
 * **It takes the deadline, not a number**, and works its own face out. Five
 * one-second numbers and then START, over a phase the audio makes longer than
 * the five — so a screen that did its own arithmetic would be a screen that
 * could get it wrong, and there are eleven of them. `useRemaining` is whole
 * seconds of the *phase* and is deliberately not what feeds this; see
 * `shared/countdown.ts`.
 */
export function GetReady({ endsAt, offset, label, onStop, children }: Props) {
  const face = useCountdownFace(endsAt, offset);
  const start = face === "start";

  return (
    <div className="get-ready-pose">
      <div className="get-ready-card">
        <span className="get-ready-card__tab">{label}</span>
        {/* The caption goes when the count does: once the card says START it is
            no longer telling the room to get ready, it is telling them they are
            off. Hidden rather than unmounted — it keeps its box, so the card
            does not lose a line's height at the last beat and deflate on the
            one frame that should land like a punch. */}
        <span
          className={
            start ? "get-ready-card__label get-ready-card__label--spent" : "get-ready-card__label"
          }
        >
          GET READY
        </span>
        <span
          className={
            start ? "get-ready-card__count get-ready-card__count--start" : "get-ready-card__count"
          }
        >
          {start ? "START" : face}
        </span>
      </div>
      {/* No caption. It read "Un-ready for more time" and nobody needs telling:
          the Ready button they just pressed is still under their thumb, still
          lit, and still says Not ready. A five-second card with a sentence on it
          is a sentence nobody finishes reading. */}
      {onStop && (
        <button
          type="button"
          className="btn btn--secondary btn--small"
          onClick={onStop}
        >
          Stop
        </button>
      )}
      {children}
    </div>
  );
}
