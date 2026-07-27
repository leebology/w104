import { CATEGORIES } from "../../../shared/categories";
import { voteBudget, votesSpent } from "../../../shared/voting";
import type { PlayerId, RoomState } from "../../../shared/state";
import { roomStore } from "../../net/room";

type Props = {
  room: RoomState;
  playerId: PlayerId;
  /** Present once voting has closed and the round countdown is running. */
  countdown?: { endsAt: number; offset: number };
};

export function PlayerVoting({ room, playerId, countdown }: Props) {
  const mine = room.votes[playerId] ?? {};
  const left = voteBudget(room.settings) - votesSpent(mine);
  const locked = left === 0 || countdown !== undefined;

  return (
    <main className="screen screen--mobile screen--locked player-voting">
      <p className="player-voting__left">{left} votes left</p>
      <ul className="player-voting__grid">
        {CATEGORIES.map((c) => (
          <li key={c}>
            <button
              type="button"
              className="card vote-tile"
              disabled={locked}
              onClick={() => roomStore.send({ type: "castVote", category: c })}
            >
              {c}
              {mine[c] ? ` ×${mine[c]}` : ""}
            </button>
          </li>
        ))}
      </ul>
      {!countdown && (
        <button
          type="button"
          className="btn btn--secondary btn--block"
          onClick={() => roomStore.send({ type: "resetVotes" })}
        >
          Reset votes
        </button>
      )}
    </main>
  );
}
