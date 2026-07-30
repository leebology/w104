import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useRemaining } from "../../net/clock";
import { roomStore } from "../../net/room";
import { TeamBadge } from "../../components/TeamBadge";
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

/**
 * Team selection, on the phone.
 *
 * **Every team keeps its place for the whole screen.** The grid is the full
 * roster of teams in colour order, and joining one changes what a tile *says*,
 * never where it sits — the tile you tapped is still under your thumb
 * afterwards, which is the only way the screen can answer "which one am I on?"
 * with the thing you were already looking at. The earlier arrangement lifted
 * your team out of the grid and re-drew it at the top, so the act of joining
 * moved every remaining tile and left you reading a card that had arrived from
 * somewhere else.
 *
 * Everything that grows or shrinks is therefore boxed into a fixed slot: the
 * title slot above the grid is the plaque's height whether it is holding the
 * plaque or the name editor that replaces it, and the footer holds the Leave
 * button's height whether or not there is one in it.
 *
 * Every tile carries its members by name as well as by face — a room of ten
 * emoji is not a roster anyone can read across two columns — and your own name
 * is inverted into an ink pill wherever it appears, which is what makes your
 * team identifiable at a glance rather than by counting faces.
 */
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
      {/* One slot at the top of the screen, holding the title *or* the name
          editor — never both, and never one above the other. Once you are on a
          team the instruction has been followed and the tab that replaces it
          says the same thing better, so the room the two would have taken
          between them goes to the grid instead. Its height is fixed to the
          plaque's, so the swap does not move the tiles below. */}
      <div className="player-teams__title-slot">
        {mine ? (
          <div
            className="team-badge player-teams__title"
            style={{ "--accent": `var(${TEAM_COLORS[mine.colorIndex].token})` } as CSSProperties}
          >
            {/* The pen leads the name rather than trailing it: trailing, a long
                name pushes it off the tab's end. */}
            <PenGlyph />
            <input
              className="player-teams__name"
              value={draft}
              // Sized to the name rather than to a fixed width, so the tab is
              // as long as what is written on it.
              size={Math.max(draft.length, 3)}
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
        ) : (
          <p className="plaque player-teams__plaque">Pick a team</p>
        )}
      </div>

      <ul className="player-teams__grid">
        {room.teams.map((team) => {
          const joined = team.id === mine?.id;
          const members = membersOf(room, team.id);
          return (
            <li key={team.id}>
              <button
                type="button"
                className={joined ? "team-tile team-tile--mine" : "team-tile"}
                // Your own team is not a target. Left in the flow and left
                // looking like a tile — it is still the card that answers the
                // screen's question, and removing it is exactly the jump this
                // layout exists to avoid.
                aria-current={joined ? "true" : undefined}
                onClick={() => {
                  if (joined) return;
                  roomStore.send({ type: "joinTeam", teamId: team.id });
                }}
              >
                <TeamBadge
                  name={team.name}
                  colorIndex={team.colorIndex}
                  className="team-badge--sm"
                />
                {joined && <span className="team-tile__joined">JOINED!</span>}
                {/* Spans, not a list: this is inside a `<button>`, which takes
                    phrasing content only — a `<ul>` here is invalid markup that
                    browsers merely tolerate. */}
                <span className="team-tile__members">
                  {members.map((p) => (
                    <span
                      key={p.id}
                      className={
                        (p.id === playerId ? "team-tile__member team-tile__member--you" : "team-tile__member") +
                        (p.connected ? "" : " team-member--gone")
                      }
                    >
                      <span className="team-tile__avatar">{p.emoji}</span>
                      <span className="team-tile__name">{p.name || "…"}</span>
                    </span>
                  ))}
                  {/* An empty team still has to occupy a row, or a tile's height
                      changes the moment its last member leaves. */}
                  {members.length === 0 && (
                    <span className="team-tile__member team-tile__member--empty">nobody yet</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="player-teams__footer">
        {countdown && <p className="get-ready get-ready--small">Get ready… {remaining}</p>}
        {/* Leaving *is* un-readying — there is no separate button, and once
            the countdown is running this is the room's only brake, since the
            TV has no Stop button by design. It does not change its wording or
            its colour to say so: it is the same action either way, and a
            button that restyles itself mid-countdown reads as a different
            button appearing under the thumb already reaching for it.

            Held in a fixed-height slot rather than mounted and unmounted, for
            the same reason the editor above is: it sits below a scrolling grid
            and its arrival would otherwise shorten the grid the moment you
            joined. */}
        <div className="player-teams__leave">
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
      </div>
    </main>
  );
}
