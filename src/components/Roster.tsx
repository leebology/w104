import type { CSSProperties } from "react";
import type { Player } from "../../shared/state";
import { isWaiting } from "../../shared/bots";

/**
 * A stable animation interval per player, 0.9s–1.6s, so the dots and bobbing
 * avatars on the host screen move out of step with each other. Derived from
 * the id rather than randomised, or every re-render would resynchronise them.
 */
export function pulseInterval(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return `${(0.9 + (hash % 8) * 0.1).toFixed(2)}s`;
}

type PillProps = {
  player: Player;
  /** `playing` shows the activity dot; `lobby` shows readiness. */
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
  return (
    <li className={classes.join(" ")}>
      <span
        className={bobbing ? "player-pill__avatar player-pill__avatar--bob" : "player-pill__avatar"}
        style={bobbing ? ({ "--bob": pulseInterval(player.id) } as CSSProperties) : undefined}
      >
        {player.emoji}
      </span>
      <span className="player-pill__name">{player.name || "…"}</span>
      {variant === "playing" ? (
        // Purely decorative. It says somebody is writing, never how much —
        // per-player counts are deliberately absent from the broadcast and
        // must not become inferable from this dot.
        <span
          className="player-pill__dot"
          style={{ "--pulse": pulseInterval(player.id) } as CSSProperties}
          aria-hidden="true"
        />
      ) : (
        ready && <span className="player-pill__mark">✓ READY</span>
      )}
      {onKick && (
        <button
          type="button"
          className="player-pill__kick"
          aria-label={`Remove ${player.name || "player"}`}
          onClick={() => onKick(player.id)}
        >
          ×
        </button>
      )}
    </li>
  );
}

