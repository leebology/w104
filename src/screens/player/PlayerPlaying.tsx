import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { TeamBadge } from "../../components/TeamBadge";
import { TimeWarning } from "../../components/TimeWarning";
import { useRemaining } from "../../net/clock";
import { useRoundWarning } from "../../roundwarnings";
import { teamsEnabled, teamOf } from "../../../shared/teams";
import type { PlayerId, RoomState } from "../../../shared/state";
import type { LocalEntry } from "../../net/room";

type Props = {
  room: RoomState;
  playerId: PlayerId;
  entries: LocalEntry[];
  offset: number;
};

/**
 * A small pie in the corner, not the host's full timer bar with its numeral:
 * the round screen's job is getting words down, so the countdown is a glance,
 * not a second thing to read. A conic-gradient slice draws itself with no
 * SVG geometry to keep in sync with a ring's radius. Teal rather than a new
 * colour — the same fill the "OK," plaque and the host timer bar use.
 *
 * Takes `remaining` rather than reading the clock itself: the screen also
 * needs it for the time warnings, and two `useRemaining` calls would mean two
 * intervals that can land a tick apart.
 */
function TimerWheel({ remaining, durationSec, paused }: {
  remaining: number;
  durationSec: number;
  /** `RoomState.paused` — the wheel holds its slice rather than draining. */
  paused: number | null;
}) {
  const frac = durationSec > 0 ? Math.max(0, Math.min(1, remaining / durationSec)) : 0;
  return (
    <div
      className={`playing__timer${paused !== null ? " playing__timer--paused" : ""}`}
      style={{ "--frac": frac } as CSSProperties}
      aria-hidden="true"
    />
  );
}

export function PlayerPlaying({ room, playerId, entries, offset }: Props) {
  const list = useRef<HTMLDivElement>(null);
  const shared = teamsEnabled(room.settings);
  const team = teamOf(room, playerId);
  const emojiOf = (id: PlayerId) =>
    room.players.find((p) => p.id === id)?.emoji ?? "";

  // Narrowed once here rather than at each use: hooks cannot be called
  // conditionally, and the round screen renders under other phases briefly.
  const round = room.phase.name === "playing" ? room.phase : null;
  const remaining = useRemaining(round?.endsAt ?? 0, offset, room.paused);
  const warning = useRoundWarning(remaining, room.settings.durationSec);

  // Scrolls the list by its own `scrollTop`, never `scrollIntoView` on a
  // trailing sentinel. `block: "end"` aligns the sentinel with the scrollport's
  // bottom edge, which scrolls the list's reserved bottom padding — the strip
  // the entry input sits over — clean out of view, and the newest word lands
  // underneath the input. `scrollHeight` counts that padding, so this stops
  // above it. It also cannot scroll the page, which `scrollIntoView` can.
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  // Sizing against the on-screen keyboard is `.screen--locked` plus
  // src/viewport.ts, applied to every locked screen rather than measured in
  // here: this component used to set its own height from `visualViewport`,
  // which shrank the screen but left the page behind it full height, so the
  // area below the list stayed as visible dead space. The entry input lives
  // outside this component (see PlayerView) so it can stay mounted and focused
  // across phase changes.
  return (
    <main className="screen screen--mobile screen--locked playing">
      {round && (
        <TimerWheel
          remaining={remaining}
          durationSec={room.settings.durationSec}
          paused={room.paused}
        />
      )}
      {/* Keyed on the mark alone, not on the round: `.reject-banner`'s
          reject-fade plays once on insertion and then holds at opacity 0, so
          a static key across a round would flash only the first warning and
          silently update the text under an already-invisible node for the
          rest. Marks are distinct within a round by construction, and the
          screen remounts at the next round's boundary regardless. */}
      {round && warning !== null && (
        <TimeWarning key={warning} mark={warning} variant="player" />
      )}
      <div className="playing__head">
        <span className="playing__name-a">NAME A:</span>
        <div className="banner playing__banner">
          <span className="banner__text">{room.category}</span>
        </div>
      </div>

      {/* In team play the list is the whole team's, shared by every
          teammate's socket — not only this player's own words. The card
          runs to the bottom of the screen and the entry input sits over
          its last line, so typing reads as writing directly onto the
          list. The input itself is still mounted in PlayerView — it has
          to outlive this screen to keep the keyboard up — which is why
          the two are aligned in CSS rather than nested here. */}
      <div className={`card playing__card${team ? " playing__card--team" : ""}`}>
        {/* Whose list this is. The words on it are the whole team's, so the
            card says so in the same tab the team wore in team select. */}
        {team && (
          <TeamBadge
            name={team.name}
            colorIndex={team.colorIndex}
            className="team-badge--playing"
          />
        )}
        <div className="word-list playing__list" ref={list}>
          {entries.map((entry, i) => (
            <div className="word-row" key={entry.seq ?? `${entry.at}-${i}`}>
              <span className="word">{entry.text}</span>
              {/* In team play the list is the whole team's, so a word needs
                  to say who got it — otherwise teammates re-type each
                  other's. Never shown in free-for-all, where every word is
                  yours and the emoji would be noise. Always on the right,
                  after the word — `justify-content: space-between` on
                  `.word-row` puts a lone word at the left either way, so
                  every row's text lines up on the same edge. */}
              {shared && entry.by !== playerId && (
                <span className="word-row__by">{emojiOf(entry.by)}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
