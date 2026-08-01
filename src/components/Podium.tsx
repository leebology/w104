import type { CSSProperties } from "react";
import type { Player, RoomState } from "../../shared/state";
import type { Standing } from "../../shared/standings";
import { ordinal } from "../ordinal";
import { BadgeStrip } from "./BadgeStrip";
import { ReadyMark } from "./ReadyMark";
import { TeamBadge } from "./TeamBadge";

/**
 * Plinth height as a percentage of the staircase box, by place. Percentages
 * rather than the design's pixels because the TV owns whatever viewport it is
 * given — 720p up to 1080p — and a staircase drawn at fixed heights either
 * floats in the middle of a big screen or overruns a small one. The ratios
 * between the steps are the design's; only the unit changed.
 *
 * Indexed by *place*, not by column, which is the whole reason ties share a
 * step: two players on 2nd both read `STEP[1]`, and nobody stands on 3rd.
 */
const STEP = [52, 40.5, 36, 32, 26, 23, 20, 16, 12.5, 10];

/** The note under the place reads across a room; below 7th there is no room for it. */
const NOTE_LIMIT = 6;

function stepOf(place: number): number {
  return STEP[Math.min(place, STEP.length) - 1];
}

type Readiness = "ready" | "waiting" | "dropped";

/**
 * A row's readiness, aggregated over whoever it is made of. A solo player has
 * one member and so answers directly; a team is ready when every member still
 * in the room is, which is the same thing `everyoneReady` gates the countdown
 * on. A row nobody is connected to has dropped — for a team that means the
 * whole team left, not one member of it.
 */
function readinessOf(members: Player[]): Readiness {
  const here = members.filter((p) => p.connected);
  if (here.length === 0) return "dropped";
  return here.every((p) => p.ready) ? "ready" : "waiting";
}

/**
 * The line under the place. "TIED" is the one that matters — a shared step is
 * visible from across the room but ambiguous with a rounding error, so it gets
 * said out loud. A clean sweep is worth naming; everything else stays quiet
 * rather than inventing a superlative for 6th.
 */
function noteOf(s: Standing, tied: boolean): string | null {
  if (tied) return "TIED";
  if (s.place === 1 && s.badges.length > 1 && s.badges.every((b) => b === 1)) {
    return "WON EVERY ROUND";
  }
  return null;
}

type Props = {
  room: RoomState;
  standings: Standing[];
  /**
   * Match over. The same staircase, with the between-rounds furniture removed:
   * readiness is meaningless once there is no next round to be ready for. A
   * dropped row keeps saying so, because that is a fact about the result and
   * not about what happens next.
   */
  final?: boolean;
};

/**
 * The standings as a staircase — one plinth per scorer, ordered strictly by
 * rank left to right so 1st is always leftmost. Deliberately *not* the
 * centred-podium arrangement (2nd, 1st, 3rd): that shape only orders its first
 * three and leaves everyone behind them in an unreadable heap, and this board
 * runs to ten.
 *
 * Height is place, tint is place, and the ribbon is reserved for the top
 * three, so the same fact is carried three ways for a screen that is read from
 * a sofa. Ties share all three.
 */
export function Podium({ room, standings, final }: Props) {
  const shared = new Set(
    standings
      .map((s) => s.place)
      .filter((place, i, all) => all.indexOf(place) !== i),
  );

  return (
    <ol className="podium">
      {standings.map((s) => {
        const members = s.members
          .map((id) => room.players.find((p) => p.id === id))
          .filter((p): p is Player => p !== undefined);
        const state = readinessOf(members);
        const note = noteOf(s, shared.has(s.place));
        const team = s.colorIndex !== null;
        // Capped so an 11th place — impossible at a cap of 10, but cheap to
        // hold — still lands on the last tier rather than falling off the ramp.
        const rank = Math.min(s.place, 9);

        return (
          <li
            className="podium-col"
            key={s.id}
            data-rank={rank}
            data-state={state}
            data-team={team ? "" : undefined}
            style={{ "--plinth": `${stepOf(s.place)}%` } as CSSProperties}
          >
            {s.place <= 3 && (
              <span className="podium-ribbon" aria-hidden="true">
                <i className="podium-ribbon__tail podium-ribbon__tail--l" />
                <i className="podium-ribbon__tail podium-ribbon__tail--r" />
                <span className="podium-ribbon__medal">{s.place}</span>
              </span>
            )}

            {team ? (
              // Faces *and* names. A row of emoji says how many people a team
              // is, which is not the question anyone asks of a final board —
              // "who was on that?" is, and at the end of a match it is the only
              // place the answer still exists on screen.
              <span className="podium-col__roster">
                {members.map((p) => (
                  <span className="podium-col__member" key={p.id}>
                    <span className="podium-col__member-emoji">{p.emoji}</span>
                    <span className="podium-col__member-name">{p.name || "…"}</span>
                  </span>
                ))}
              </span>
            ) : (
              <span className="podium-col__avatar">{s.emoji}</span>
            )}

            {/* A team is named by its badge, on the plinth — never twice. */}
            {!team && <span className="podium-col__name">{s.name}</span>}

            {final && state !== "dropped" ? null : state === "ready" ? (
              // The lobby's tag, the same one the standings list and the results
              // card wear — see `ReadyMark`. The two chips below are the states
              // that are *not* ready, and they keep the podium's own shape.
              <ReadyMark />
            ) : (
              <span className={`podium-chip podium-chip--${state}`}>
                {state === "dropped"
                  ? "DROPPED"
                  : team
                    ? `${members.filter((p) => p.connected && p.ready).length}/${
                        members.filter((p) => p.connected).length
                      } READY`
                    : "NOT READY"}
              </span>
            )}

            <div className="podium-plinth">
              {team && (
                <TeamBadge
                  name={s.name}
                  colorIndex={s.colorIndex!}
                  className="team-badge--sm"
                />
              )}
              <span className="podium-plinth__place">{ordinal(s.place)}</span>
              {note && rank <= NOTE_LIMIT && (
                <span className="podium-plinth__note">{note}</span>
              )}
              {rank <= NOTE_LIMIT && (
                <span className="podium-plinth__points">{s.points} PTS</span>
              )}
              <BadgeStrip
                places={s.badges}
                categories={room.history.map((h) => h.category)}
                className="badge-strip--plinth"
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
