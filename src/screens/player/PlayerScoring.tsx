import { TeamBadge } from "../../components/TeamBadge";
import { WordList } from "../../components/WordList";
import { currentRound } from "../../../shared/state";
import type { PlayerId, RoomState } from "../../../shared/state";
import type { Results } from "../../../shared/scoring";

type Props = { room: RoomState; results: Results; playerId: PlayerId };

/** Your own results, on your own phone — the same two cards as one host column. */
export function PlayerScoring({ room, results, playerId }: Props) {
  const me = results.scorers.find((s) => s.members.includes(playerId));
  const emojiOf = (id: string) => room.players.find((p) => p.id === id)?.emoji ?? "";
  // A team has no emoji of its own, so it identifies itself by name in the
  // "somebody else had this too" trail.
  const labelFor = (id: string) => {
    const s = results.scorers.find((x) => x.id === id);
    if (!s) return "?";
    return s.colorIndex === null ? s.emoji : ` ${s.name}`;
  };
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
      <div className={`card id-card${me.colorIndex !== null ? " id-card--team" : ""}`}>
        {/* Same tab the team wore in team select and during the round. */}
        {me.colorIndex !== null && (
          <TeamBadge
            name={me.name}
            colorIndex={me.colorIndex}
            className="team-badge--sm"
          />
        )}
        <div className="id-card__row">
          {me.colorIndex === null && <span className="id-card__avatar">{me.emoji}</span>}
          <div className="id-card__who">
            {me.colorIndex === null && <span className="id-card__name">{me.name}</span>}
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
        {/* Who the team is, under the card — the round and the match both
            score the team, so this is the only place a player's own face
            appears on the results screen. */}
        {me.colorIndex !== null && (
          <div className="id-card__members">
            {me.members.map((id) => (
              <span key={id}>{emojiOf(id)}</span>
            ))}
          </div>
        )}
      </div>

      <div className="card list-card">
        <WordList
          entries={me.entries}
          size={19}
          labelFor={labelFor}
          authorFor={me.colorIndex !== null ? emojiOf : undefined}
        />
      </div>

      <p className="player-scoring__footer">
        Waiting for the host to start a new round…
      </p>
    </main>
  );
}
