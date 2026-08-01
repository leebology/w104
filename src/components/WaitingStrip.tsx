import type { CSSProperties } from "react";
import { TEAM_COLORS, teamsEnabled } from "../../shared/teams";
import { waitingPlayers } from "../../shared/waiting";
import type { Player, RoomState } from "../../shared/state";

/**
 * Past this, the strip stops naming faces and starts counting them. Six is what
 * fits beside the room chip on a 720p header without the code moving, which is
 * the constraint that actually decides it.
 */
const MAX_FACES = 6;

/**
 * Who is joining next round, in the corner the room already reads.
 *
 * **One badge shows the face and the name; two or more show faces only.** That
 * is not a space saving so much as the honest amount of information: one
 * arrival is a person the room can greet by name, and five arrivals are a
 * *number*. Five names here would compete with the room code, which is the one
 * thing in this corner that has to stay legible from a sofa.
 *
 * **Nothing here is a control.** The host's way to remove somebody is kick,
 * from the lobby; a control in this corner sits one pixel from the join
 * instruction on a screen usually being driven from across a room.
 *
 * With teams on, a badge wears its player's team accent as a ring and a hollow
 * one means they have not picked — which is the useful thing on this screen,
 * because that is the only thing standing between a latecomer and the next
 * round (see `admitWaiting` in shared/reduce.ts). The accent is set inline from
 * `TEAM_COLORS`, the way `TeamBadge` sets its own, so the token stays the one
 * source of the colour.
 */
export function WaitingStrip({ room }: { room: RoomState }) {
  const waiting = waitingPlayers(room.players);
  // Renders nothing at all when nobody is waiting — no label, no zero. The
  // common case is a match with an empty waiting room, and the header has to
  // look exactly as it did before this existed.
  if (waiting.length === 0) return null;

  const teams = teamsEnabled(room.settings);
  const shown = waiting.length > MAX_FACES ? waiting.slice(0, MAX_FACES - 1) : waiting;
  const overflow = waiting.length - shown.length;
  const solo = waiting.length === 1;

  const accentOf = (p: Player): CSSProperties | undefined => {
    if (!teams) return undefined;
    const team = room.teams.find((t) => t.id === p.teamId);
    if (!team) return undefined;
    return { "--accent": `var(${TEAM_COLORS[team.colorIndex].token})` } as CSSProperties;
  };

  return (
    <div
      className="waiting-strip"
      // The emoji stack says how many, never who. The names go here so the
      // read-out is not lost on a screen reader.
      aria-label={`Joining next round: ${waiting.map((p) => p.name || "someone").join(", ")}`}
    >
      <span className="waiting-strip__label" aria-hidden="true">NEXT ROUND</span>
      <div className="waiting-strip__faces" aria-hidden="true">
        {shown.map((p) => {
          const classes = ["waiting-face"];
          // Hollow means "no team yet", and only when teams are on — with them
          // off there is nothing to pick and every badge is filled.
          if (teams && room.teams.every((t) => t.id !== p.teamId)) {
            classes.push("waiting-face--unpicked");
          }
          if (!p.connected) classes.push("waiting-face--gone");
          return (
            <span key={p.id} className={classes.join(" ")} style={accentOf(p)}>
              <span className="waiting-face__avatar">{p.emoji}</span>
              {solo && <span className="waiting-face__name">{p.name || "…"}</span>}
            </span>
          );
        })}
        {overflow > 0 && (
          <span className="waiting-face waiting-face--more">+{overflow}</span>
        )}
      </div>
    </div>
  );
}
