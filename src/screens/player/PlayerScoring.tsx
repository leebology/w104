import type { PlayerId } from "../../../shared/state";
import type { Results } from "../../../shared/scoring";

export function PlayerScoring({ results, playerId }: { results: Results; playerId: PlayerId }) {
  const me = results.players.find((p) => p.id === playerId);
  if (!me) return <main><p>You weren't in this round.</p></main>;

  return (
    <main>
      <h1>{me.emoji} {me.name}</h1>
      <p className="score">
        <strong>{me.unique}</strong> unique · {me.total} total
      </p>
      <ol className="entries">
        {me.entries.map((entry, i) => (
          <li key={i} className={entry.unique ? "" : "struck"}>
            <span>{entry.text}</span>
            {entry.alsoBy.length > 0 && (
              <span className="alsoBy">{entry.alsoBy.join(" ")}</span>
            )}
          </li>
        ))}
      </ol>
      {me.entries.length === 0 && <p className="hint">No words this round.</p>}
      <p className="hint">Waiting for the host to start a new game…</p>
    </main>
  );
}
