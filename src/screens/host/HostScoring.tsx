import { roomStore } from "../../net/room";
import type { Results } from "../../../shared/scoring";

export function HostScoring({ results }: { results: Results }) {
  const ranked = [...results.players].sort(
    (a, b) => b.unique - a.unique || b.total - a.total,
  );
  return (
    <main className="host">
      <h1>Scores</h1>
      <table className="scores">
        <thead>
          <tr><th /><th>Player</th><th>Unique</th><th>Total</th></tr>
        </thead>
        <tbody>
          {ranked.map((p, i) => (
            <tr key={p.id}>
              <td>{i + 1}</td>
              <td><span className="emoji">{p.emoji}</span> {p.name}</td>
              <td className="num">{p.unique}</td>
              <td className="num">{p.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={() => roomStore.send({ type: "newGame" })}>
        New game
      </button>
    </main>
  );
}
