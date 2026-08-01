import type { CSSProperties } from "react";
import { useRemaining } from "../../net/clock";
import { GetReady } from "../../components/GetReady";
import { RoomChip } from "../../components/RoomChip";
import { TeamBadge } from "../../components/TeamBadge";
import { pulseInterval } from "../../components/Roster";
import { roomStore } from "../../net/room";
import { TEAM_COLORS, membersOf } from "../../../shared/teams";
import { seatedPlayers } from "../../../shared/waiting";
import type { RoomState } from "../../../shared/state";
import { HostBackToRoom, HostHeader } from "./HostHeader";

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
  // Seated players only. A latecomer without a team is not a straggler this
  // screen can do anything about — the host's Continue does not place them and
  // Auto sort does not deal them — so listing them here would say Continue is
  // about to fix something it will not touch. The header strip is where they
  // are named, hollow until they pick.
  const unassigned = seatedPlayers(room.players).filter((p) => p.teamId === null);
  // What steps back behind the card: the picking is over, so the panels and the
  // stragglers dim. The footer does not — Auto sort stays legal through the
  // count, and it is the only lever the TV has left while it runs.
  const dim = countdown ? " countdown-dim" : "";

  return (
    <main className="screen screen--host host-teams">
      {/* No round marker: team selection only ever happens before round one,
          so the number could not change while this screen is up. */}
      <HostHeader
        left={<RoomChip room={room} />}
        right={<HostBackToRoom />}
      />

      <p className={`plaque host-teams__plaque${dim}`}>Pick a team</p>

      {/* Fixed-width panels, five to a row. Adding a team adds a panel rather
          than shrinking the others, so the card a player is aiming at does
          not move under them as the room fills up. */}
      <div
        className={`team-grid${dim}`}
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
                Same badge on every screen that names a team — see TeamBadge.
                `--lg`: the panel is wide enough now to read at TV distance. */}
            <TeamBadge name={team.name} colorIndex={team.colorIndex} className="team-badge--lg" />
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
        <div className={`team-unassigned${dim}`}>
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
        {/* Bottom-left rather than beside Continue: it rearranges the room
            rather than advancing it, so it does not share the gold forward
            action's spot. Left up through the countdown too — joinTeam and
            leaveTeam both stay legal there, and this is no different. */}
        <button
          type="button"
          className="btn btn--secondary host-teams__sort"
          onClick={() => roomStore.send({ type: "balanceTeams" })}
        >
          Auto sort
        </button>
        {/* The forward action goes while the count runs — it has already been
            pressed, and the card below says so louder than a disabled button
            could. */}
        {!countdown && (
          <button
            type="button"
            className="btn"
            onClick={() => roomStore.send({ type: "startGame" })}
          >
            Continue
          </button>
        )}
      </div>

      {/* The same card every other countdown in the game wears, posed over the
          dimmed panels. It used to be the old gold plaque tucked in the footer,
          which made the one countdown a room reads from furthest away the one
          drawn smallest. No Stop button: this count is not cancellable at all
          (see `cancelStart`), and leaving a team on a phone is the brake. */}
      {countdown && (
        <div className="countdown-pose">
          <GetReady remaining={remaining} label="CATEGORY VOTE" />
        </div>
      )}
    </main>
  );
}
