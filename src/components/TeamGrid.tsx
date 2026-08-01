import { roomStore } from "../net/room";
import { TeamBadge } from "./TeamBadge";
import { TeamNaming } from "./TeamNaming";
import { isBeingNamed, membersOf } from "../../shared/teams";
import type { PlayerId, RoomState } from "../../shared/state";

type Props = {
  room: RoomState;
  playerId: PlayerId;
  /** Steps the tiles back behind a countdown card posed over them. */
  dim?: boolean;
};

/**
 * The tiles a phone picks a team from.
 *
 * Extracted from `PlayerTeams` because the waiting room needs the same grid: a
 * latecomer must pick a team before the next whistle will take them, and the
 * screen they pick on is not team select. One grid rather than two is the point
 * — the tiles, the colours, the member lists and the joined state are all the
 * same question being asked, and a second copy would be the one that drifted.
 *
 * **Every team keeps its place.** The grid is the full roster in colour order
 * and joining one changes what a tile *says*, never where it sits: the tile you
 * tapped is still under your thumb afterwards. Every tile carries its members by
 * name as well as by face — a room of ten emoji is not a roster anyone can read
 * — and your own name is inverted into an ink pill wherever it appears.
 *
 * Everything around the grid is the screen's own business: the title slot, the
 * name editor, the Leave button and any countdown card all differ between the
 * two callers, and none of them belongs here.
 */
export function TeamGrid({ room, playerId, dim }: Props) {
  const mine = room.players.find((p) => p.id === playerId)?.teamId ?? null;

  return (
    <ul className={dim ? "player-teams__grid countdown-dim" : "player-teams__grid"}>
      {room.teams.map((team) => {
        const joined = team.id === mine;
        const members = membersOf(room, team.id);
        return (
          <li key={team.id}>
            {/* Outside the button, not in it: a `<button>` takes phrasing
                content only, and this tag overhangs the tile's top edge
                rather than sitting inside its box. */}
            {isBeingNamed(room, team.id) && <TeamNaming size="sm" />}
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
  );
}
