import type { CSSProperties } from "react";
import { RoomChip } from "../../components/RoomChip";
import { WordList } from "../../components/WordList";
import { roomStore } from "../../net/room";
import type { Results } from "../../../shared/scoring";
import { currentRound } from "../../../shared/state";
import type { RoomState } from "../../../shared/state";
import { TEAM_COLORS } from "../../../shared/teams";
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
  const ranked = [...results.scorers].sort(
    (a, b) => b.unique - a.unique || b.total - a.total,
  );
  const teams = ranked.some((s) => s.colorIndex !== null);
  const emojiOf = (id: string) => room.players.find((p) => p.id === id)?.emoji ?? "";
  // A team has no emoji of its own, so it identifies itself by name in the
  // "somebody else had this too" trail.
  const labelFor = (id: string) => {
    const s = results.scorers.find((x) => x.id === id);
    if (!s) return "?";
    return s.colorIndex === null ? s.emoji : ` ${s.name}`;
  };

  return (
    <main className="screen screen--host host-scoring">
      <HostHeader
        left={<h1 className="host-scoring__title">Results · {room.category}</h1>}
        round={currentRound(room)}
        of={room.settings.roundCount}
        right={<RoomChip code={room.code} />}
      />

      <div
        className="results"
        style={{ "--cols": columnsFor(ranked.length) } as CSSProperties}
      >
        {ranked.map((s, i) => (
          <section className="result-col" key={s.id}>
            <div
              className="card id-card"
              style={
                s.colorIndex !== null
                  ? ({ "--accent": `var(${TEAM_COLORS[s.colorIndex].token})` } as CSSProperties)
                  : undefined
              }
            >
              <div className="id-card__row">
                {s.colorIndex === null ? (
                  <span className="id-card__avatar">{s.emoji}</span>
                ) : (
                  <span className="id-card__swatch" aria-hidden="true" />
                )}
                <div className="id-card__who">
                  <span className="id-card__name">{s.name}</span>
                  <span className="id-card__meta">RANK {i + 1}</span>
                </div>
                <div className="id-card__stats">
                  <div className="stat">
                    <span className="stat__num stat__num--unique">{s.unique}</span>
                    <span className="stat__label">UNIQUE</span>
                  </div>
                  <div className="stat">
                    <span className="stat__num">{s.total}</span>
                    <span className="stat__label">TOTAL</span>
                  </div>
                </div>
              </div>
              {/* Who the team is, under the card — the round and the match
                  both score the team, so this is the only place a player's
                  own face appears on the results screen. */}
              {s.colorIndex !== null && (
                <div className="id-card__members">
                  {s.members.map((id) => (
                    <span key={id}>{emojiOf(id)}</span>
                  ))}
                </div>
              )}
            </div>
            {/* The list scrolls inside its card; the grid around it never
                grows, so the Standings button stays on screen. */}
            <div className="card list-card">
              <WordList
                entries={s.entries}
                size={16}
                empty="Nothing written."
                labelFor={labelFor}
                authorFor={teams ? emojiOf : undefined}
              />
            </div>
          </section>
        ))}
      </div>

      <div className="host-scoring__footer">
        <button
          type="button"
          className="btn"
          onClick={() => roomStore.send({ type: "showStandings" })}
        >
          Standings
        </button>
      </div>
    </main>
  );
}
