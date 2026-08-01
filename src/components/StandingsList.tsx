import type { CSSProperties } from "react";
import type { Player, RoomState } from "../../shared/state";
import type { Standing } from "../../shared/standings";
import { ordinal } from "../ordinal";
import { enterVars } from "../scoringleave";
import { ReadyMark } from "./ReadyMark";
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
  /**
   * Rise in from the bottom edge, one row after another, as the round's
   * results wipe off above. Only when the board arrived that way — see
   * `HostStandings` and `src/scoringleave.ts`.
   */
  entering?: boolean;
};

/**
 * The between-rounds board: one full-width row per scorer, the leader in gold,
 * ordered strictly by rank. This is the shape the room argues over between
 * rounds — place, name, readiness, what the last round paid and the running
 * total, with nothing on it that needs decoding. The final screen is the podium
 * instead; see `HostStandings`.
 *
 * Up to five scorers the rows run down the screen at full width. From six the
 * board splits into two columns, filled *down* the first and then the second,
 * so reading order stays 1st to last.
 */
export function StandingsList({ room, standings, entering }: Props) {
  const split = standings.length > SPLIT_ABOVE;
  const rows = split ? Math.ceil(standings.length / 2) : standings.length;
  // The leader's row is taller than the rest, but only in one column: with two,
  // row one is shared with whoever is mid-table at the top of column two, and
  // there is no honest way to give the height to just one of them. Within one
  // column, a tie for first is several rows all at place 1 — every one of them
  // gets the tall track, not just the first, or a tied leader reads shorter
  // than the scorer standing at the exact same rank above it.
  // `minmax(0, …)` on every track, lead included — a bare `Nfr` track's
  // automatic minimum is its content's max-content size, so two rows on an
  // equal `1.35fr` share still come out unequal the moment one team's roster
  // wraps to a second line and the other's doesn't: the wrapping row's own
  // content forces its track past its fair share, and the fixed total height
  // squeezes the other one to make room. `minmax(0, …)` drops that
  // content-based floor so equal `fr` values mean equal pixels regardless of
  // what either row's content needs.
  const leadRows = split ? 0 : standings.filter((s) => s.place === 1).length;
  const rowTracks = split
    ? `repeat(${rows}, minmax(0, 1fr))`
    : [
        ...Array(leadRows).fill("minmax(0, 1.35fr)"),
        ...Array(Math.max(0, rows - leadRows)).fill("minmax(0, 1fr)"),
      ].join(" ");

  return (
    <>
      <ol
        className={
          (split ? "standings-rows standings-rows--split" : "standings-rows") +
          (entering ? " standings-rows--entering" : "")
        }
        style={
          {
            "--cols": split ? 2 : 1,
            "--rows": rowTracks,
            // Only while it is arriving: the timings are this feature's and
            // nothing else on the board reads them.
            ...(entering ? enterVars : null),
          } as CSSProperties
        }
      >
        {standings.map((s, i) => {
          const members = s.members
            .map((id) => room.players.find((p) => p.id === id))
            .filter((p): p is Player => p !== undefined);
          const here = members.filter((p) => p.connected);
          const dropped = here.length === 0;
          const readyHere = here.filter((p) => p.ready).length;
          const isReady = !dropped && readyHere === here.length;
          const team = s.colorIndex !== null;
          const lead = s.place === 1;

          return (
            <li
              className={lead ? "standings-row standings-row--lead" : "standings-row"}
              key={s.id}
              data-dropped={dropped ? "" : undefined}
              // Reading order, which in the split board is *down* the first
              // column and then the second — so the stagger follows the rank
              // rather than the two columns racing each other.
              style={{ "--row-i": i } as CSSProperties}
            >
              <div className="standings-row__place">
                <span className="standings-row__ordinal">{ordinal(s.place)}</span>
              </div>

              {/* A team stacks: name on top, then the faces and names under it,
                  then the count. The name is what the room navigates a team by,
                  so it leads the block rather than sitting off to one side of
                  it — and the roster answers "who is on that team", which is
                  the question a board between rounds actually gets. */}
              {team ? (
                <div className="standings-row__who standings-row__who--team">
                  <span className="standings-row__team">
                    <TeamBadge
                      name={s.name}
                      colorIndex={s.colorIndex!}
                      className="team-badge--standings"
                    />
                  </span>
                  <span className="standings-row__roster">
                    {members.map((p) => (
                      <span className="standings-row__member" key={p.id}>
                        <span className="standings-row__member-emoji">{p.emoji}</span>
                        <span className="standings-row__member-name">{p.name || "…"}</span>
                      </span>
                    ))}
                  </span>
                  {/* Always the count, never a bare READY — a team is several
                      people and "how many of us are in" is the question its
                      members can act on, which a single pill cannot answer.
                      It changes colour rather than shape when the team is all
                      in, so a complete team does not read as still pending. */}
                  {dropped ? (
                    <span className="list-chip list-chip--dropped">DROPPED OFF</span>
                  ) : (
                    <span
                      className={
                        isReady
                          ? "list-chip list-chip--full"
                          : "list-chip list-chip--waiting"
                      }
                    >
                      {readyHere}/{here.length} READY
                    </span>
                  )}
                </div>
              ) : (
                <>
                  <span className="standings-row__avatar">{s.emoji}</span>
                  <div className="standings-row__who">
                    <span className="standings-row__name">{s.name}</span>
                    {/* A marker for the ones who *are* ready, and silence for
                        the rest: a row with nothing beside it is the room still
                        waiting on it. The lobby's tag, not a second design of
                        the same idea — see `ReadyMark`. */}
                    {dropped ? (
                      <span className="list-chip list-chip--dropped">DROPPED OFF</span>
                    ) : isReady ? (
                      <ReadyMark />
                    ) : null}
                  </div>
                </>
              )}

              <div className="standings-row__score">
                {/* What the round just played was worth, beside what it added
                    up to. Absent for a scorer who was not in it — a blank is
                    honest there, and a "+0" is not. */}
                {s.last !== null && (
                  <span className="standings-row__delta">+{s.last}pts</span>
                )}
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
