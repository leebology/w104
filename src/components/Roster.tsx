import type { Player } from "../../shared/state";

export function Roster({ players, onKick }: { players: Player[]; onKick?: (id: string) => void }) {
  if (players.length === 0) return <p className="hint">Waiting for players…</p>;
  return (
    <ul className="roster">
      {players.map((p) => (
        <li key={p.id} className={p.connected ? "" : "offline"}>
          <span className="emoji">{p.emoji}</span>
          <span className="name">{p.name}</span>
          <span className="ready">{p.ready ? "READY" : "…"}</span>
          {!p.connected && <span className="tag">offline</span>}
          {onKick && (
            <button type="button" className="kick" onClick={() => onKick(p.id)}>
              kick
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
