import type { CSSProperties } from "react";
import { useRemaining } from "../../net/clock";
import { computeStandings } from "../../../shared/standings";
import { currentRound, matchComplete } from "../../../shared/state";
import { BadgeStrip } from "../../components/BadgeStrip";
import { RoomChip } from "../../components/RoomChip";
import { roomStore } from "../../net/room";
import type { RoomState } from "../../../shared/state";
import { TEAM_COLORS, rosterOf } from "../../../shared/teams";
import { HostHeader } from "./HostHeader";

type Props = {
  room: RoomState;
  /** Present during an inter-round countdown; un-readying still cancels it. */
  countdown?: { endsAt: number; offset: number };
};

export function HostStandings({ room, countdown }: Props) {
  const standings = computeStandings(rosterOf(room), room.history);
  const remaining = useRemaining(countdown?.endsAt ?? 0, countdown?.offset ?? 0);
  const done = matchComplete(room);
  // On the final screen the round marker would otherwise read one past the
  // last round played, because `currentRound` names the round about to start.
  const marker = done ? room.settings.roundCount : currentRound(room) - 1;

  return (
    <main className="screen screen--host host-standings">
      <HostHeader
        left={<h1 className="host-standings__title">{done ? "Final standings" : "Standings"}</h1>}
        round={marker}
        of={room.settings.roundCount}
        right={<RoomChip code={room.code} />}
      />

      <ol className="standings-list">
        {standings.map((s) => (
          <li
            className="card standing-card"
            key={s.id}
            style={
              s.colorIndex !== null
                ? ({ "--accent": `var(${TEAM_COLORS[s.colorIndex].token})` } as CSSProperties)
                : undefined
            }
          >
            <span className="standing-card__place">{s.place}</span>
            {s.colorIndex === null ? (
              <span className="standing-card__avatar">{s.emoji}</span>
            ) : (
              <span className="standing-card__swatch" aria-hidden="true" />
            )}
            <span className="standing-card__name">
              {s.name}
              {s.colorIndex !== null && (
                <span className="standing-card__members">
                  {s.members.map((id) => room.players.find((p) => p.id === id)?.emoji ?? "").join("")}
                </span>
              )}
            </span>
            <BadgeStrip places={s.badges} />
            <span className="standing-card__points">{s.points}</span>
          </li>
        ))}
      </ol>

      <div className="host-standings__footer">
        {countdown ? (
          <>
            <p className="get-ready">Get ready… {remaining}</p>
            <button
              type="button"
              className="btn btn--secondary btn--small"
              onClick={() => roomStore.send({ type: "cancelStart" })}
            >
              Stop
            </button>
          </>
        ) : done ? (
          <button
            type="button"
            className="btn"
            onClick={() => roomStore.send({ type: "backToLobby" })}
          >
            Back to lobby
          </button>
        ) : (
          <>
            <p className="host-standings__hint">Starting early readies everyone up.</p>
            <button
              type="button"
              className="btn"
              onClick={() => roomStore.send({ type: "startGame" })}
            >
              Next round
            </button>
          </>
        )}
      </div>
    </main>
  );
}
