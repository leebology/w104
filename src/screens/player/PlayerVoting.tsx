import { useEffect, useState } from "react";
import { formatClock, useRemaining } from "../../net/clock";
import { CATEGORIES } from "../../../shared/categories";
import { VOTING_MS } from "../../../shared/reduce";
import { voteBudget, voteShares, votesSpent } from "../../../shared/voting";
import { isWaiting } from "../../../shared/bots";
import type { PlayerId, RoomState } from "../../../shared/state";
import { roomStore } from "../../net/room";

type Props = {
  room: RoomState;
  playerId: PlayerId;
  /** `state.clockOffset` — needed even outside `countdown` so the open voting
      deadline counts down against the same clock as everything else. */
  offset: number;
  /** Present once voting has closed and the round countdown is running. */
  countdown?: { endsAt: number; offset: number };
};

export function PlayerVoting({ room, playerId, offset, countdown }: Props) {
  const me = room.players.find((p) => p.id === playerId);
  const mine = room.votes[playerId] ?? {};
  const budget = voteBudget(room.settings);
  const spent = votesSpent(mine);
  const left = budget - spent;
  const closed = countdown !== undefined;
  // Locked either because this player is done, or because voting is over —
  // a player who never spent their votes before the 60s expired locks too,
  // rather than being handed a live grid during the countdown.
  const locked = left === 0 || closed;
  const waitingOn = room.players.filter((p) => p.connected && !isWaiting(p)).length;
  // Only once voting has closed. While it is open the tally is still moving,
  // and a percentage that ticks under the player's thumb reads as a score
  // rather than as the odds it is. Any badged category holds at least this
  // player's own vote, so this can never render 0%.
  const shares = closed ? voteShares(room.votes) : {};

  const votingEndsAt = room.phase.name === "voting" ? room.phase.endsAt : 0;
  const remaining = useRemaining(
    closed ? countdown.endsAt : votingEndsAt,
    closed ? countdown.offset : offset,
  );

  // The numeral is the loudest thing on the screen and it changes on every
  // tap, so it gets the feedback — not the card around it.
  const [bump, setBump] = useState(0);
  useEffect(() => { setBump((n) => n + 1); }, [spent]);

  return (
    <main className="screen screen--mobile screen--locked player-voting">
      {/* No round marker: voting only ever happens before round one. */}
      <section className="card player-voting__head">
        {left > 0 ? (
          <span className="player-voting__count" key={bump}>{left}</span>
        ) : (
          <span className="player-voting__avatar">{me?.emoji}</span>
        )}
        <span className="player-voting__head-text">
          <span className="player-voting__head-title">
            {left > 0 ? `${left === 1 ? "vote" : "votes"} left` : "you're in"}
          </span>
          {left === 0 && (
            <span className="player-voting__head-sub">
              all {budget} {budget === 1 ? "vote" : "votes"} spent
              {waitingOn > 0 && ` — waiting on ${waitingOn}`}
            </span>
          )}
          {/* The pips are a budget meter, so they go once the budget is
              gone — the line above already says it is all spent. */}
          {left > 0 && (
            <span className="player-voting__pips">
              {Array.from({ length: budget }, (_, i) => (
                <span key={i} className={i < spent ? "pip pip--spent" : "pip"} />
              ))}
            </span>
          )}
        </span>
      </section>

      <ul className={locked ? "player-voting__grid player-voting__grid--locked" : "player-voting__grid"}>
        {CATEGORIES.map((category) => {
          const n = mine[category] ?? 0;
          const cls = [
            "vote-tile",
            n > 0 ? "vote-tile--voted" : "",
            locked ? "vote-tile--locked" : "",
          ].filter(Boolean).join(" ");
          return (
            <li key={category}>
              <button
                type="button"
                className={cls}
                aria-disabled={locked}
                disabled={locked}
                onClick={() => roomStore.send({ type: "castVote", category })}
              >
                <span className="vote-tile__name">{category}</span>
                {n > 0 && closed && (
                  <span className="vote-tile__chance">
                    <span className="vote-tile__pct">{shares[category] ?? 0}%</span>
                    <span className="vote-tile__chance-label">CHANCE</span>
                  </span>
                )}
                {n > 0 && (
                  <span className="vote-tile__badge">
                    {me?.emoji}
                    {n > 1 && <span className="vote-tile__times">×{n}</span>}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {closed ? (
        <div className="player-voting__foot">
          <p className="get-ready get-ready--small">Get ready… {remaining}</p>
        </div>
      ) : (
        <>
          <div className="player-voting__foot">
            {/* Reset is the only way to change a vote — tiles add, they never
                toggle, which keeps a stacked tile unambiguous. It goes away
                once voting is over, since the server rejects it there. */}
            <button
              type="button"
              className="btn btn--secondary btn--block"
              onClick={() => roomStore.send({ type: "resetVotes" })}
            >
              Reset votes
            </button>
          </div>
          {/* The host's timer bar, not a phone-sized imitation of it: the same
              cream strip, the same Bungee clock, the same teal fill. It is one
              object, and the room is watching both copies of it at once. */}
          <div className="timer-bar player-voting__bar">
            <span className="timer-bar__num">{formatClock(remaining)}</span>
            <span className="timer-track">
              <span
                className="timer-track__fill"
                style={{ width: `${Math.min(100, (remaining / (VOTING_MS / 1000)) * 100)}%` }}
              />
            </span>
          </div>
        </>
      )}
    </main>
  );
}
