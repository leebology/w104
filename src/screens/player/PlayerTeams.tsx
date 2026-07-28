import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useRemaining } from "../../net/clock";
import { roomStore } from "../../net/room";
import { MAX_TEAM_NAME_LEN, TEAM_COLORS, membersOf, teamOf } from "../../../shared/teams";
import type { PlayerId, RoomState } from "../../../shared/state";

type Props = {
  room: RoomState;
  playerId: PlayerId;
  /** Present once the countdown out of team select is running. */
  countdown?: { endsAt: number; offset: number };
};

export function PlayerTeams({ room, playerId, countdown }: Props) {
  const mine = teamOf(room, playerId);
  const remaining = useRemaining(countdown?.endsAt ?? 0, countdown?.offset ?? 0);

  // Mirrors the server's name while not being edited, exactly as Stepper's
  // draft mirrors its value — committing on every keystroke would fight the
  // echo of a teammate's own edit.
  const [draft, setDraft] = useState(mine?.name ?? "");
  useEffect(() => setDraft(mine?.name ?? ""), [mine?.name]);

  return (
    <main className="screen screen--mobile screen--locked player-teams">
      <p className="player-teams__room">ROOM {room.code} · PICK A TEAM</p>

      {mine ? (
        <section
          className="card player-teams__mine"
          style={{ "--accent": `var(${TEAM_COLORS[mine.colorIndex].token})` } as CSSProperties}
        >
          <input
            className="player-teams__name"
            value={draft}
            maxLength={MAX_TEAM_NAME_LEN}
            aria-label="Team name"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() =>
              roomStore.send({ type: "setTeamName", teamId: mine.id, name: draft })
            }
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              e.currentTarget.blur();
            }}
          />
          <ul className="player-teams__members">
            {membersOf(room, mine.id).map((p) => (
              <li key={p.id}>
                {p.emoji} {p.name}
                {p.id === playerId && " (you)"}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="player-teams__hint">Tap a colour to join it.</p>
      )}

      <ul className="player-teams__grid">
        {room.teams.map((team) => (
          <li key={team.id}>
            <button
              type="button"
              className={team.id === mine?.id ? "team-tile team-tile--mine" : "team-tile"}
              style={{ "--accent": `var(${TEAM_COLORS[team.colorIndex].token})` } as CSSProperties}
              onClick={() => roomStore.send({ type: "joinTeam", teamId: team.id })}
            >
              <span className="team-tile__name">{team.name}</span>
              <span className="team-tile__count">
                {membersOf(room, team.id).map((p) => p.emoji).join("") || "—"}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div className="player-teams__footer">
        {countdown && <p className="get-ready get-ready--small">Get ready… {remaining}</p>}
        {/* Leaving *is* un-readying — there is no separate button, and this is
            the only way to stop the countdown once it has started. */}
        {mine && (
          <button
            type="button"
            className="btn btn--secondary btn--block"
            onClick={() => roomStore.send({ type: "leaveTeam" })}
          >
            Leave team
          </button>
        )}
      </div>
    </main>
  );
}
