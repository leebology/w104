import { useEffect, useState } from "react";
import { formatClock, useRemaining } from "../../net/clock";
import { CATEGORIES } from "../../../shared/categories";
import { VOTING_MS } from "../../../shared/reduce";
import { voteBudget, votesSpent } from "../../../shared/voting";
import { currentRound } from "../../../shared/state";
import type { PlayerId, RoomState } from "../../../shared/state";
import { roomStore } from "../../net/room";

type Props = {
  room: RoomState;
  playerId: PlayerId;
  /** Present once voting has closed and the round countdown is running. */
  countdown?: { endsAt: number; offset: number };
};

export function PlayerVoting({ room, playerId, countdown }: Props) {
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
  const waitingOn = room.players.filter((p) => p.connected && !p.ready).length;

  const votingEndsAt = room.phase.name === "voting" ? room.phase.endsAt : 0;
  const remaining = useRemaining(
    closed ? countdown.endsAt : votingEndsAt,
    closed ? countdown.offset : 0,
  );

  // The numeral is the loudest thing on the screen and it changes on every
  // tap, so it gets the feedback — not the card around it.
  const [bump, setBump] = useState(0);
  useEffect(() => { setBump((n) => n + 1); }, [spent]);

  return (
    <main className="screen screen--mobile screen--locked player-voting">
      <p className="player-voting__meta">
        ROOM {room.code} · ROUND {currentRound(room)} OF {room.settings.roundCount} ·{" "}
        {budget} {budget === 1 ? "VOTE" : "VOTES"} EACH
      </p>

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
          <span className="player-voting__pips">
            {Array.from({ length: budget }, (_, i) => (
              <span
                key={i}
                className={i < spent ? "pip pip--spent" : "pip"}
              />
            ))}
          </span>
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

      <div className="player-voting__foot">
        {closed ? (
          <p className="get-ready get-ready--small">Get ready… {remaining}</p>
        ) : (
          <>
            <span className="player-voting__timer">
              <span
                className="player-voting__timer-fill"
                style={{ width: `${Math.min(100, (remaining / (VOTING_MS / 1000)) * 100)}%` }}
              />
            </span>
            <span className="player-voting__clock">{formatClock(remaining)}</span>
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
          </>
        )}
      </div>
    </main>
  );
}
