import type { CSSProperties } from "react";
import type { Player, RoomState } from "../../shared/state";
import type { Standing } from "../../shared/standings";
import { ordinal } from "../ordinal";
import { TeamBadge } from "./TeamBadge";

/**
 * Above this many rows the board splits into two columns. Five full-width rows
 * fill a 16:9 screen at a comfortable height; a sixth starts squeezing them
 * below what reads from a sofa, and by ten they are thinner than an avatar.
 */
const SPLIT_ABOVE = 5;

type Props = {
  room: RoomState;
  standings: Standing[];
};

/**
 * The between-rounds board: one full-width row per scorer, the leader in gold,
 * ordered strictly by rank. This is the shape the room argues over between
 * rounds — place, name, readiness and the running total, with nothing on it
 * that needs decoding. The final screen is the podium instead; see
 * `HostStandings`.
 *
 * Up to five scorers the rows run down the screen at full width. From six the
 * board splits into two columns, filled *down* the first and then the second,
 * so reading order stays 1st to last.
 */
export function StandingsList({ room, standings }: Props) {
  const shared = new Set(
    standings.map((s) => s.place).filter((place, i, all) => all.indexOf(place) !== i),
  );

  const split = standings.length > SPLIT_ABOVE;
  const rows = split ? Math.ceil(standings.length / 2) : standings.length;
  // The leader's row is taller than the rest, but only in one column: with two,
  // row one is shared with whoever is mid-table at the top of column two, and
  // there is no honest way to give the height to just one of them.
  const rowTracks = split
    ? `repeat(${rows}, minmax(0, 1fr))`
    : ["1.35fr", ...Array(Math.max(0, rows - 1)).fill("minmax(0, 1fr)")].join(" ");

  return (
    <>
      {/* The one place the scoring direction is stated outright rather than
          implied. The list has the width for a sentence; the podium does not. */}
      <div className="list-explainer">
        <span className="list-explainer__pill">LOWEST TOTAL WINS ↓</span>
        <span>You collect your finishing place each round — come 1st, take 1 point.</span>
      </div>

      <ol
        className={split ? "standings-rows standings-rows--split" : "standings-rows"}
        style={{ "--cols": split ? 2 : 1, "--rows": rowTracks } as CSSProperties}
      >
        {standings.map((s) => {
          const members = s.members
            .map((id) => room.players.find((p) => p.id === id))
            .filter((p): p is Player => p !== undefined);
          const here = members.filter((p) => p.connected);
          const dropped = here.length === 0;
          const isReady = !dropped && here.every((p) => p.ready);
          const team = s.colorIndex !== null;
          const lead = s.place === 1;

          return (
            <li
              className={lead ? "standings-row standings-row--lead" : "standings-row"}
              key={s.id}
              data-dropped={dropped ? "" : undefined}
            >
              <div className="standings-row__place">
                <span className="standings-row__ordinal">{ordinal(s.place)}</span>
                <span className="standings-row__sub">
                  {shared.has(s.place) ? "TIED" : lead ? "LEADING" : "PLACE"}
                </span>
              </div>

              {team ? (
                <span className="standings-row__roster">
                  {members.map((p) => p.emoji).join("")}
                </span>
              ) : (
                <span className="standings-row__avatar">{s.emoji}</span>
              )}

              <div className="standings-row__who">
                {team ? (
                  <span className="standings-row__team">
                    <TeamBadge
                      name={s.name}
                      colorIndex={s.colorIndex!}
                      className="team-badge--sm"
                    />
                  </span>
                ) : (
                  <span className="standings-row__name">{s.name}</span>
                )}
                {dropped ? (
                  <span className="list-chip list-chip--dropped">DROPPED OFF</span>
                ) : isReady ? (
                  <span className="list-chip list-chip--ready">
                    <i className="list-chip__dot" />
                    READY
                  </span>
                ) : (
                  <span className="list-chip list-chip--waiting">
                    {team
                      ? `${here.filter((p) => p.ready).length}/${here.length} READY`
                      : "NOT READY"}
                  </span>
                )}
              </div>

              <div className="standings-row__score">
                <span className="standings-row__points">{s.points}</span>
                <span className="standings-row__unit">PTS</span>
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}
