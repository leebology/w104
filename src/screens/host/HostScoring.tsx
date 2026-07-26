import type { CSSProperties } from "react";
import { RoomChip } from "../../components/RoomChip";
import { WordList } from "../../components/WordList";
import { roomStore } from "../../net/room";
import type { Results } from "../../../shared/scoring";
import type { RoomState } from "../../../shared/state";
import { HostHeader } from "./HostHeader";

/**
 * One row up to five players, two balanced rows up to the ten-player cap —
 * six players read better as 3+3 than as 5+1. Never more than five across:
 * past that the words stop being legible from a sofa.
 */
function columnsFor(n: number): number {
  return n <= 5 ? Math.max(n, 1) : Math.ceil(n / 2);
}

type Props = { room: RoomState; results: Results };

export function HostScoring({ room, results }: Props) {
  const ranked = [...results.players].sort(
    (a, b) => b.unique - a.unique || b.total - a.total,
  );

  return (
    <main className="screen screen--host host-scoring">
      <HostHeader
        left={<h1 className="host-scoring__title">Results · {room.category}</h1>}
        round={room.round}
        right={<RoomChip code={room.code} />}
      />

      <div
        className="results"
        style={{ "--cols": columnsFor(ranked.length) } as CSSProperties}
      >
        {ranked.map((p, i) => (
          <section className="result-col" key={p.id}>
            <div className="card id-card">
              <div className="id-card__row">
                <span className="id-card__avatar">{p.emoji}</span>
                <div className="id-card__who">
                  <span className="id-card__name">{p.name}</span>
                  <span className="id-card__meta">RANK {i + 1}</span>
                </div>
                <div className="id-card__stats">
                  <div className="stat">
                    <span className="stat__num stat__num--unique">{p.unique}</span>
                    <span className="stat__label">UNIQUE</span>
                  </div>
                  <div className="stat">
                    <span className="stat__num">{p.total}</span>
                    <span className="stat__label">TOTAL</span>
                  </div>
                </div>
              </div>
            </div>
            {/* The list scrolls inside its card; the grid around it never
                grows, so the New Round button stays on screen. */}
            <div className="card list-card">
              <WordList entries={p.entries} size={16} empty="Nothing written." />
            </div>
          </section>
        ))}
      </div>

      <div className="host-scoring__footer">
        <button
          type="button"
          className="btn"
          onClick={() => roomStore.send({ type: "newGame" })}
        >
          New round
        </button>
      </div>
    </main>
  );
}
