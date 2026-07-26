import type { CSSProperties } from "react";
import type { Player } from "../../shared/state";

/**
 * A stable pulse interval per player, 0.9s–1.6s, so the dots on the host
 * screen breathe out of step with each other. Derived from the id rather than
 * randomised, or every re-render would resynchronise them.
 */
function pulseInterval(id: string): string {
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
  if (!player.connected) classes.push("player-pill--offline");
  return (
    <li className={classes.join(" ")}>
      <span className="player-pill__avatar">{player.emoji}</span>
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
        <span
          className={
            player.ready
              ? "player-pill__ready"
              : "player-pill__ready player-pill__ready--waiting"
          }
          aria-label={player.ready ? "ready" : "not ready"}
        >
          {player.ready ? "✓" : "···"}
        </span>
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

