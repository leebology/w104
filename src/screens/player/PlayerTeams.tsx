import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { roomStore } from "../../net/room";
import { GetReady } from "../../components/GetReady";
import { TeamGrid } from "../../components/TeamGrid";
import { MAX_TEAM_NAME_LEN, TEAM_COLORS, teamOf } from "../../../shared/teams";
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

  // Mirrors the server's name while not being edited, exactly as Stepper's
  // draft mirrors its value — committing on every keystroke would fight the
  // echo of a teammate's own edit.
  const [draft, setDraft] = useState(mine?.name ?? "");
  useEffect(() => setDraft(mine?.name ?? ""), [mine?.name]);

  // The tiles step back behind the card once the count is running; the Leave
  // button below does not, for the same reason the lobby keeps Ready lit —
  // leaving a team is this room's only brake on the countdown.
  const dim = countdown ? " countdown-dim" : "";

  return (
    <main className="screen screen--mobile screen--locked player-teams">
      {/* One slot at the top of the screen, holding the title *or* the name
          editor — never both, and never one above the other. Once you are on a
          team the instruction has been followed and the tab that replaces it
          says the same thing better, so the room the two would have taken
          between them goes to the grid instead. Its height is fixed to the
          plaque's, so the swap does not move the tiles below. */}
      <div className={`player-teams__title-slot${dim}`}>
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
              // Opening the editor holds the countdown out of team select, and
              // closing it lets `settle` derive one — the same arrangement the
              // host's drawers have with the lobby. Without it a room where
              // everybody has a team counts down while you are still typing,
              // and the phase goes out from under the word.
              onFocus={() => roomStore.send({ type: "setTeamNaming", naming: true })}
              onBlur={() => {
                roomStore.send({ type: "setTeamName", teamId: mine.id, name: draft });
                roomStore.send({ type: "setTeamNaming", naming: false });
              }}
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

      {/* The tiles themselves are `TeamGrid`, shared with the waiting room —
          a latecomer picks a team from the same grid, on a screen that is not
          this one. Everything around it differs between the two and stays
          here. */}
      <TeamGrid room={room} playerId={playerId} dim={countdown !== undefined} />

      {/* The same card the TV is showing and the same one every other countdown
          in the game wears, posed over the dimmed tiles rather than squeezed
          into the footer as the old small plaque. It is deliberately over the
          grid and not over the Leave button below it. */}
      {countdown && (
        <div className="countdown-pose">
          <GetReady endsAt={countdown.endsAt} offset={countdown.offset} label="CATEGORY VOTE" />
        </div>
      )}

      <div className="player-teams__footer">
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
