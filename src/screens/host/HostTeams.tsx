import type { CSSProperties } from "react";
import { useRemaining } from "../../net/clock";
import { RoomChip } from "../../components/RoomChip";
import { TeamBadge } from "../../components/TeamBadge";
import { pulseInterval } from "../../components/Roster";
import { roomStore } from "../../net/room";
import { TEAM_COLORS, membersOf } from "../../../shared/teams";
import type { RoomState } from "../../../shared/state";
import { HostExit, HostHeader, HostHeaderRight, PlayerCount } from "./HostHeader";

type Props = {
  room: RoomState;
  /** Present once the countdown out of team select is running. */
  countdown?: { endsAt: number; offset: number };
};

/**
 * The room's view of team selection. No Stop button during the countdown:
 * cancelling would clear everyone's readiness while they are all still on a
 * team, which nothing could then undo. Leaving a team is the cancel, and it
 * happens on the phones — which is why the hint says so rather than leaving
 * the room to work out that the TV has no brake on it.
 *
 * "Back to room" is a different thing entirely and lives top-right with every
 * other host back-out: it abandons team select rather than pausing it, and is
 * offered throughout, countdown included.
 */
export function HostTeams({ room, countdown }: Props) {
  const remaining = useRemaining(countdown?.endsAt ?? 0, countdown?.offset ?? 0);
  const unassigned = room.players.filter((p) => p.teamId === null);

  return (
    <main className="screen screen--host host-teams">
      {/* No round marker: team selection only ever happens before round one,
          so the number could not change while this screen is up. */}
      <HostHeader
        left={<RoomChip code={room.code} />}
        right={
          <HostHeaderRight>
            <PlayerCount n={room.players.length} />
            <HostExit
              label="Back to room"
              onClick={() => roomStore.send({ type: "backToLobby" })}
            />
          </HostHeaderRight>
        }
      />

      <p className="plaque host-teams__plaque">Pick a team</p>

      {/* Fixed-width panels, five to a row. Adding a team adds a panel rather
          than shrinking the others, so the card a player is aiming at does
          not move under them as the room fills up. */}
      <div
        className="team-grid"
        style={{ "--cols": Math.min(room.teams.length, 5) } as CSSProperties}
      >
        {room.teams.map((team) => (
          <section
            className="team-panel"
            key={team.id}
            style={{ "--accent": `var(${TEAM_COLORS[team.colorIndex].token})` } as CSSProperties}
          >
            {/* The tab rides over the panel's corner rather than being a top
                border, so the ink outline stays unbroken on all four sides.
                Same badge on every screen that names a team — see TeamBadge. */}
            <TeamBadge name={team.name} colorIndex={team.colorIndex} />
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
          <ul className="team-unassigned__list">
            {unassigned.map((p) => (
              <li className="pill team-straggler" key={p.id}>
                <span
                  className="team-member__avatar team-member__avatar--bob"
                  style={{ "--bob": pulseInterval(p.id) } as CSSProperties}
                >
                  {p.emoji}
                </span>
                <span className="team-straggler__name">{p.name || "…"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="host-teams__footer">
        {countdown ? (
          <>
            <p className="get-ready get-ready--tv">Get ready… {remaining}</p>
          </>
        ) : (
          <>
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
