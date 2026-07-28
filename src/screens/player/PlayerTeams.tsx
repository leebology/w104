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

/** Marks the team name as editable without spending a line of copy on it. */
function PenGlyph() {
  return (
    <svg
      className="player-teams__pen"
      viewBox="0 0 24 24"
      width="17"
      height="17"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 20h4l11-11-4-4L4 16z" />
      <path d="M14 5l4 4" />
    </svg>
  );
}

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
      <p className="plaque player-teams__plaque">Pick a team</p>

      {mine ? (
        <section
          className="player-teams__mine"
          style={{ "--accent": `var(${TEAM_COLORS[mine.colorIndex].token})` } as CSSProperties}
        >
          {/* The colour is a strip *inside* the card rather than a top border,
              so the ink outline stays continuous on all four sides. */}
          <span className="player-teams__strip" />
          <span className="player-teams__joined">Joined!</span>
          {/* The pen leads the name rather than trailing it: trailing, it
              collides with the JOINED! badge pinned to this card's top-right
              corner, and a long team name pushes it straight under one. */}
          <div className="player-teams__title">
            <PenGlyph />
            <input
              className="player-teams__name"
              value={draft}
              maxLength={MAX_TEAM_NAME_LEN}
              aria-label="Team name — shared with your teammates"
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
          </div>
          {/* Says whose name it is. The field is shared and last write wins,
              so a teammate's edit arriving under your thumb has to be the
              expected thing rather than a glitch. */}
          <p className="player-teams__shared">Your whole team can rename this</p>
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

      {mine && (
        <div className="divider player-teams__divider">
          <span>OR SWITCH TO</span>
        </div>
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
              <span className="team-tile__strip" />
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
        {/* Leaving *is* un-readying — there is no separate button, and once
            the countdown is running this is the room's only brake, since the
            TV has no Stop button by design. It does not change its wording or
            its colour to say so: it is the same action either way, and a
            button that restyles itself mid-countdown reads as a different
            button appearing under the thumb already reaching for it. */}
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
