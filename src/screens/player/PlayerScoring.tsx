import { WordList } from "../../components/WordList";
import { currentRound } from "../../../shared/state";
import type { PlayerId, RoomState } from "../../../shared/state";
import type { Results } from "../../../shared/scoring";

type Props = { room: RoomState; results: Results; playerId: PlayerId };

/** Your own results, on your own phone — the same two cards as one host column. */
export function PlayerScoring({ room, results, playerId }: Props) {
  const me = results.scorers.find((s) => s.id === playerId);
  const labelFor = (id: string) =>
    results.scorers.find((s) => s.id === id)?.emoji || "?";
  if (!me) {
    return (
      <main className="screen screen--centered">
        <div className="card centered-card">
          <p className="notice">You weren’t in this round.</p>
          <p className="notice notice--dim">Hang on for the next one.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="screen screen--mobile screen--locked player-scoring">
      <div className="card id-card">
        <div className="id-card__row">
          <span className="id-card__avatar">{me.emoji}</span>
          <div className="id-card__who">
            <span className="id-card__name">{me.name}</span>
            <span className="id-card__meta">
              ROOM {room.code} · ROUND {currentRound(room)}
            </span>
          </div>
          <div className="id-card__stats">
            <div className="stat">
              <span className="stat__num stat__num--unique">{me.unique}</span>
              <span className="stat__label">UNIQUE</span>
            </div>
            <div className="stat">
              <span className="stat__num">{me.total}</span>
              <span className="stat__label">TOTAL</span>
            </div>
          </div>
        </div>
      </div>

      <div className="card list-card">
        <WordList entries={me.entries} size={19} labelFor={labelFor} />
      </div>

      <p className="player-scoring__footer">
        Waiting for the host to start a new round…
      </p>
    </main>
  );
}
