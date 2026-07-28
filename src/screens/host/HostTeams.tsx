import type { CSSProperties } from "react";
import { useRemaining } from "../../net/clock";
import { RoomChip } from "../../components/RoomChip";
import { roomStore } from "../../net/room";
import { TEAM_COLORS, membersOf } from "../../../shared/teams";
import { currentRound } from "../../../shared/state";
import type { RoomState } from "../../../shared/state";
import { HostHeader, PlayerCount } from "./HostHeader";

type Props = {
  room: RoomState;
  /** Present once the countdown out of team select is running. */
  countdown?: { endsAt: number; offset: number };
};

/**
 * The room's view of team selection. No Stop button during the countdown:
 * cancelling would clear everyone's readiness while they are all still on a
 * team, which nothing could then undo. Leaving a team is the cancel, and it
 * happens on the phones.
 */
export function HostTeams({ room, countdown }: Props) {
  const remaining = useRemaining(countdown?.endsAt ?? 0, countdown?.offset ?? 0);
  const unassigned = room.players.filter((p) => p.teamId === null);

  return (
    <main className="screen screen--host host-teams">
      {/* Same header shape as HostVoting, which also sits before a round has
          started: `currentRound` names the round about to be played. */}
      <HostHeader
        left={<RoomChip code={room.code} />}
        round={currentRound(room)}
        of={room.settings.roundCount}
        right={<PlayerCount n={room.players.length} />}
      />

      <div
        className="team-grid"
        style={{ "--cols": Math.min(room.teams.length, 5) } as CSSProperties}
      >
        {room.teams.map((team) => (
          <section
            className="card team-panel"
            key={team.id}
            style={{ "--accent": `var(${TEAM_COLORS[team.colorIndex].token})` } as CSSProperties}
          >
            {/* The name is live and the accent is not — renaming must never
                recolour a team, because the colour is what the room is
                actually navigating by. */}
            <h2 className="team-panel__name">{team.name}</h2>
            <ul className="team-panel__members">
              {membersOf(room, team.id).map((p) => (
                <li key={p.id} className={p.connected ? "" : "team-member--gone"}>
                  <span className="team-member__avatar">{p.emoji}</span>
                  <span className="team-member__name">{p.name}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {unassigned.length > 0 && (
        <div className="team-unassigned">
          <span className="team-unassigned__label">STILL PICKING</span>
          {unassigned.map((p) => (
            <span className="team-unassigned__avatar" key={p.id} title={p.name}>
              {p.emoji}
            </span>
          ))}
        </div>
      )}

      <div className="host-teams__footer">
        {countdown ? (
          <p className="get-ready">Get ready… {remaining}</p>
        ) : (
          <>
            <p className="host-teams__hint">
              Anyone still picking gets dropped into the emptiest team.
            </p>
            <button
              type="button"
              className="btn"
              onClick={() => roomStore.send({ type: "startGame" })}
            >
              Continue
            </button>
          </>
        )}
      </div>
    </main>
  );
}
