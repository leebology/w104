import { useEffect, useState } from "react";
import { formatClock, useRemaining } from "../../net/clock";
import { BALLOT, RANDOM_CATEGORY } from "../../../shared/categories";
import { VOTING_MS } from "../../../shared/reduce";
import { customEnabled } from "../../../shared/gamemodes";
import type { Hand } from "../../../shared/customCategories";
import { voteBudget, voteShares, votesSpent } from "../../../shared/voting";
import { isWaiting } from "../../../shared/bots";
import { currentRound } from "../../../shared/state";
import type { PlayerId, RoomState } from "../../../shared/state";
import { GetReady } from "../../components/GetReady";
import { roomStore } from "../../net/room";
import { PlayerVotingCustom } from "./PlayerVotingCustom";

type Props = {
  room: RoomState;
  playerId: PlayerId;
  hands: Hand[];
  /** `state.clockOffset` — needed even outside `countdown` so the open voting
      deadline counts down against the same clock as everything else. */
  offset: number;
  /** Present once voting has closed and the round countdown is running. */
  countdown?: { endsAt: number; offset: number };
  /** This player's own committed categories — only the custom fork's
      transition reads it (see `PlayerVotingCustom`). Optional because the
      stock ballot never receives it — `PlayerView` only threads `drafts`
      through where it already threads `hands`. */
  drafts?: string[];
};

export function PlayerVoting({ room, playerId, hands, offset, countdown, drafts }: Props) {
  if (customEnabled(room.settings) && room.pool) {
    return (
      <PlayerVotingCustom
        room={room} playerId={playerId} hands={hands}
        offset={offset} countdown={countdown} drafts={drafts ?? []}
      />
    );
  }

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
    // Held from the debug menu, the voting deadline stops being maintained —
    // see HostVoting. The countdown that follows it cannot be held.
    closed ? null : room.paused,
  );

  // The numeral is the loudest thing on the screen and it changes on every
  // tap, so it gets the feedback — not the card around it.
  const [bump, setBump] = useState(0);
  useEffect(() => { setBump((n) => n + 1); }, [spent]);

  return (
    <main className="screen screen--mobile screen--locked player-voting">
      {/* No round marker: voting only ever happens before round one. */}
      <section className={`card player-voting__head${closed ? " countdown-dim" : ""}`}>
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

      <ul
        className={
          (locked ? "player-voting__grid player-voting__grid--locked" : "player-voting__grid") +
          (closed ? " countdown-dim" : "")
        }
      >
        {BALLOT.map((category) => {
          const n = mine[category] ?? 0;
          // Last on the ballot and the full width of the grid: it is on every
          // ballot every match, it is the one option that is not a subject, and
          // a half-width tile alone on the final row would read as a category
          // the list had run out of room for.
          const random = category === RANDOM_CATEGORY;
          const cls = [
            "vote-tile",
            random ? "vote-tile--random" : "",
            n > 0 ? "vote-tile--voted" : "",
            locked ? "vote-tile--locked" : "",
          ].filter(Boolean).join(" ");
          return (
            <li key={category} className={random ? "player-voting__wide" : undefined}>
              <button
                type="button"
                className={cls}
                aria-disabled={locked}
                disabled={locked}
                onClick={() => roomStore.send({ type: "castVote", category })}
              >
                <span className="vote-tile__name">
                  {random ? "🎲 random" : category}
                </span>
                {/* Says what a vote here actually buys. Without it "random"
                    reads as an eleventh category rather than as a bet on the
                    draw. */}
                {random && (
                  <span className="vote-tile__note">any category, drawn at the whistle</span>
                )}
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
        // The same card the TV is showing, over the same dimmed screen. There
        // is no Stop on this one on either device — see HostVoting.
        <div className="countdown-pose">
          <GetReady remaining={remaining} label={`ROUND ${currentRound(room)}`} />
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
