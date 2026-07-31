import { useEffect, useRef, useState } from "react";
import { formatClock, useRemaining } from "../../net/clock";
import { parity } from "../../reveal";
import { VOTING_MS } from "../../../shared/reduce";
import { voteBudgetFor } from "../../../shared/customCategories";
import type { Hand, PoolCard } from "../../../shared/customCategories";
import { customShares } from "../../../shared/customCategories";
import { votesSpent } from "../../../shared/voting";
import { isWaiting } from "../../../shared/bots";
import type { PlayerId, RoomState } from "../../../shared/state";
import { roomStore } from "../../net/room";

type Props = {
  room: RoomState;
  playerId: PlayerId;
  hands: Hand[];
  /** `state.clockOffset` — needed even outside `countdown` so the open voting
      deadline counts down against the same clock as everything else. */
  offset: number;
  /** Present once voting has closed and the round countdown is running. */
  countdown?: { endsAt: number; offset: number };
};

/**
 * A hand swap in flight: the pick that started it, which hand it left from,
 * and how far the 840ms timeline has gotten. `fromIndex` is captured once, at
 * the tap, so the animation always plays out the hand the player actually
 * picked from even if the server's echo of `votesSpent` arrives mid-flight.
 */
type Swap = { pickedId: string; fromIndex: number; stage: "flash" | "exit" | "deal" };

/**
 * The custom pool's fork of `PlayerVoting`: one dealt hand of three at a
 * time instead of the stock ballot grid. See
 * docs/design/2026-07-30-custom-categories-brief.md §1e "Custom voting".
 */
export function PlayerVotingCustom({ room, playerId, hands, offset, countdown }: Props) {
  const me = room.players.find((p) => p.id === playerId);
  const pool = room.pool ?? [];
  const poolById = new Map<string, PoolCard>(pool.map((c) => [c.id, c]));
  const mine = room.votes[playerId] ?? {};
  const budget = voteBudgetFor();
  const spent = votesSpent(mine);
  const left = budget - spent;
  const closed = countdown !== undefined;
  const locked = left === 0 || closed;
  const waitingOn = room.players.filter((p) => p.connected && !isWaiting(p)).length;
  const shares = closed ? customShares(pool, room.votes) : {};

  const votingEndsAt = room.phase.name === "voting" ? room.phase.endsAt : 0;
  const remaining = useRemaining(
    closed ? countdown.endsAt : votingEndsAt,
    closed ? countdown.offset : offset,
    closed ? null : room.paused,
  );

  // The numeral pops on every vote, same as the stock ballot's counter.
  const [bump, setBump] = useState(0);
  useEffect(() => { setBump((n) => n + 1); }, [spent]);

  // The hand swap: one ordinal that only ever climbs, so `parity` gives the
  // flash and the deal-in a fresh class on every occurrence — an unchanged
  // class name would not restart either keyframe.
  const ordinalRef = useRef(0);
  const [swap, setSwap] = useState<Swap | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => { timersRef.current.forEach(clearTimeout); }, []);

  const handIndex = Math.min(spent, Math.max(budget - 1, 0));

  const handlePick = (cardId: string) => {
    // No reset, no skip, no back — a tap mid-swap or once locked is ignored
    // rather than queued.
    if (swap || locked) return;
    roomStore.send({ type: "castVote", category: cardId });
    ordinalRef.current += 1;
    const fromIndex = handIndex;
    setSwap({ pickedId: cardId, fromIndex, stage: "flash" });
    const t1 = setTimeout(() => {
      setSwap((s) => (s ? { ...s, stage: "exit" } : s));
    }, 180);
    const t2 = setTimeout(() => {
      setSwap((s) => {
        if (!s) return s;
        // The last hand has no next deal to swap into — the server's own
        // `left === 0` / `closed` takes it from here.
        return s.fromIndex + 1 < budget ? { ...s, stage: "deal" } : null;
      });
    }, 520);
    const t3 = setTimeout(() => setSwap(null), 840);
    timersRef.current.push(t1, t2, t3);
  };

  const slotIds: string[] =
    swap && (swap.stage === "flash" || swap.stage === "exit")
      ? hands[swap.fromIndex]?.cardIds ?? []
      : swap && swap.stage === "deal"
        ? hands[swap.fromIndex + 1]?.cardIds ?? []
        : hands[handIndex]?.cardIds ?? [];
  const dealing = swap?.stage === "deal";
  const dealParity = parity(ordinalRef.current);

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
          {left > 0 && (
            <span className="player-voting__pips">
              {Array.from({ length: budget }, (_, i) => (
                <span key={i} className={i < spent ? "pip pip--spent" : "pip"} />
              ))}
            </span>
          )}
        </span>
      </section>

      {locked ? (
        <div className="player-voting__hand">
          {pool
            .filter((card) => (mine[card.id] ?? 0) > 0)
            .map((card, i) => {
              const n = mine[card.id] ?? 0;
              const house = card.authorId === null;
              const author = card.authorId !== null
                ? room.players.find((p) => p.id === card.authorId)
                : undefined;
              return (
                <div
                  key={card.id}
                  className="vote-tile vote-tile--hand vote-tile--voted vote-tile--locked vote-tile--picked"
                >
                  <span className="vote-tile__name">{card.text}</span>
                  <span className="vote-tile__badge">
                    {me?.emoji}
                    {n > 1 && <span className="vote-tile__times">×{n}</span>}
                  </span>
                  {closed && (
                    <div className="vote-tile__pick-foot">
                      <span className="vote-tile__chance">
                        <span className="vote-tile__pct">{shares[card.id] ?? 0}%</span>
                        <span className="vote-tile__chance-label">CHANCE</span>
                      </span>
                      {room.authorsRevealed && (
                        house ? (
                          <span
                            className="author-chip author-chip--house"
                            style={{ animationDelay: `${420 + i * 140}ms` }}
                          >
                            HOUSE CARD
                          </span>
                        ) : (
                          <span
                            className="author-chip"
                            style={{ animationDelay: `${420 + i * 140}ms` }}
                          >
                            <span className="author-chip__emoji">{author?.emoji}</span>
                            <span className="author-chip__name">{author?.name}</span>
                          </span>
                        )
                      )}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      ) : (
        <div className="player-voting__hand">
          {/* Position-keyed, not card-keyed: the same three slots persist
              across every dealt hand, which is exactly why the flash and the
              deal-in need alternating classes rather than a single one. */}
          {slotIds.map((cardId, i) => {
            const card = poolById.get(cardId);
            const picked = swap?.pickedId === cardId;
            const cls = [
              "vote-tile",
              "vote-tile--hand",
              swap?.stage === "flash" && picked ? `vote-tile--flash-${dealParity}` : "",
              swap?.stage === "exit" && picked ? "vote-tile--exit-up" : "",
              swap?.stage === "exit" && !picked ? "vote-tile--exit-down" : "",
              dealing ? `vote-tile--deal-${dealParity}` : "",
            ].filter(Boolean).join(" ");
            return (
              <button
                key={`slot-${i}`}
                type="button"
                className={cls}
                style={dealing ? { animationDelay: `${i * 80}ms` } : undefined}
                disabled={!!swap}
                onClick={() => handlePick(cardId)}
              >
                <span className="vote-tile__name">{card?.text}</span>
              </button>
            );
          })}
        </div>
      )}

      {closed ? (
        <div className="player-voting__foot">
          <p className="get-ready get-ready--small">Get ready… {remaining}</p>
        </div>
      ) : (
        <div className="timer-bar player-voting__bar">
          <span className="timer-bar__num">{formatClock(remaining)}</span>
          <span className="timer-track">
            <span
              className="timer-track__fill"
              style={{ width: `${Math.min(100, (remaining / (VOTING_MS / 1000)) * 100)}%` }}
            />
          </span>
        </div>
      )}
    </main>
  );
}
