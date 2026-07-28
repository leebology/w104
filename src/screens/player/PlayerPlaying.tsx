import { useEffect, useRef } from "react";
import { TeamBadge } from "../../components/TeamBadge";
import { teamsEnabled, teamOf } from "../../../shared/teams";
import type { PlayerId, RoomState } from "../../../shared/state";
import type { LocalEntry } from "../../net/room";

type Props = {
  room: RoomState;
  playerId: PlayerId;
  entries: LocalEntry[];
};

/**
 * No clock here on purpose. The countdown lives on the TV, where everyone
 * reads it at once; on the phone it only competed with the one thing this
 * screen is for, which is getting words down.
 */
export function PlayerPlaying({ room, playerId, entries }: Props) {
  const list = useRef<HTMLDivElement>(null);
  const shared = teamsEnabled(room.settings);
  const team = teamOf(room, playerId);
  const emojiOf = (id: PlayerId) =>
    room.players.find((p) => p.id === id)?.emoji ?? "";

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
          {entries.length === 0 && (
            <p className="playing__empty">Type anything. Obvious answers score nothing.</p>
          )}
          {entries.map((entry, i) => (
            <div className="word-row" key={entry.seq ?? `${entry.at}-${i}`}>
              {/* In team play the list is the whole team's, so a word needs
                  to say who got it — otherwise teammates re-type each
                  other's. Never shown in free-for-all, where every word is
                  yours and the emoji would be noise. */}
              {shared && entry.by !== playerId && (
                <span className="word-row__by">{emojiOf(entry.by)}</span>
              )}
              <span className="word">{entry.text}</span>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
