import { CATEGORIES } from "../../../shared/categories";
import { tallyVotes } from "../../../shared/voting";
import { currentRound } from "../../../shared/state";
import type { RoomState } from "../../../shared/state";
import { RoomChip } from "../../components/RoomChip";
import { roomStore } from "../../net/room";
import { HostHeader, PlayerCount } from "./HostHeader";

type Props = {
  room: RoomState;
  /** Present once voting has closed and the round countdown is running. */
  countdown?: { endsAt: number; offset: number };
};

export function HostVoting({ room }: Props) {
  const totals = tallyVotes(room.votes);

  return (
    <main className="screen screen--host host-voting">
      <HostHeader
        left={<RoomChip code={room.code} />}
        round={currentRound(room)}
        of={room.settings.roundCount}
        right={<PlayerCount n={room.players.length} />}
      />
      <ul className="host-voting__grid">
        {CATEGORIES.map((c) => (
          <li key={c} className="card">
            {c} — {totals[c] ?? 0}
          </li>
        ))}
      </ul>
      <div className="host-voting__footer">
        <button
          type="button"
          className="btn btn--secondary btn--small"
          onClick={() => roomStore.send({ type: "backToLobby" })}
        >
          Back to room
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => roomStore.send({ type: "startGame" })}
        >
          Continue
        </button>
      </div>
    </main>
  );
}
