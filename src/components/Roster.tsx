import type { CSSProperties } from "react";
import type { Player } from "../../shared/state";
import { isWaiting } from "../../shared/bots";

/**
 * A stable animation interval per player, 0.9s–1.6s, so the bobbing avatars on
 * the host screen move out of step with each other. Derived from the id rather
 * than randomised, or every re-render would resynchronise them.
 */
export function pulseInterval(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return `${(0.9 + (hash % 8) * 0.1).toFixed(2)}s`;
}

type PillProps = {
  player: Player;
  /** `lobby` shows readiness; `playing` is the name and the face alone. */
  variant: "playing" | "lobby";
  onKick?: (id: string) => void;
};


export function PlayerPill({ player, variant, onKick }: PillProps) {
  const classes = ["pill", "player-pill"];
  // Readiness is the whole pill, not a glyph beside the name: a ready player
  // lifts off the page in gold and a waiting one sits flat and sunken, so the
  // host can read the room's state from the shape of the row alone, at a
  // distance where a tick mark is already gone.
  // A debug bot reads as ready, matching the one predicate the rules use
  // (`everyoneReady` never waits on one). A pill that sat flat forever while
  // the room started anyway would misreport the only thing this pill says.
  const ready = isWaiting(player);
  if (variant === "lobby") {
    classes.push(ready ? "player-pill--ready" : "player-pill--waiting");
  }
  if (!player.connected) classes.push("player-pill--offline");
  const bobbing = variant === "lobby" && !ready;

  const body = (
    <>
      <span
        className={bobbing ? "player-pill__avatar player-pill__avatar--bob" : "player-pill__avatar"}
        style={bobbing ? ({ "--bob": pulseInterval(player.id) } as CSSProperties) : undefined}
      >
        {player.emoji}
      </span>
      <span className="player-pill__name">{player.name || "…"}</span>
      {/* Nothing trails the name during a round. The pulsing dot that used to
          sit here said only "somebody is writing", which every pill said at
          once — ten of them blinking out of step were the busiest thing on a
          screen whose job is the category. */}
      {variant === "lobby" && ready && <span className="player-pill__mark">✓ READY</span>}
    </>
  );

  // Without a kick handler the pill is a read-out, and a read-out is not a
  // control: it stays an `li` with no tab stop and nothing to press.
  if (!onKick) return <li className={classes.join(" ")}>{body}</li>;

  /**
   * The whole pill is the kick target — there is no × any more.
   *
   * The × was a 24px circle inside a pill on a screen read from a sofa, and it
   * had to sit next to READY without being mistaken for part of it. Hovering
   * the pill instead gives the action the whole shape to say itself in: the
   * pill goes to ink, tilts off true, and the roster row is replaced outright
   * by the words KICK PLAYER. Nothing about it is subtle, which is the point —
   * this removes a person from the game on a single click.
   *
   * The label rides *over* the pill rather than replacing its children, so the
   * pill keeps the width its name gave it and the row does not reflow under
   * the cursor.
   *
   * **How wide the pill is decides which words fit on it.** A ready pill carries
   * the READY tag, which is enough width for KICK PLAYER behind any name at all.
   * A waiting pill is only as wide as the name, so a short one leaves the label
   * hanging off both ends as a bubble visibly bigger than the thing it belongs
   * to — that pill gets the one word instead. The `aria-label` says the whole
   * thing either way; this is only what is drawn.
   */
  const short = (player.name || "").trim().length < 7 && !ready;

  return (
    <li className="player-pill-slot">
      <button
        type="button"
        className={`${classes.join(" ")} player-pill--kickable`}
        aria-label={`Kick ${player.name || "player"}`}
        onClick={() => onKick(player.id)}
      >
        {body}
        <span className="player-pill__kick" aria-hidden="true">
          {short ? "Kick" : "Kick player"}
        </span>
      </button>
    </li>
  );
}

