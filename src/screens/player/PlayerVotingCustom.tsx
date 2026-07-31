import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { formatClock, useRemaining } from "../../net/clock";
import { parity } from "../../reveal";
import { VOTING_MS } from "../../../shared/reduce";
import { quotaFor, voteBudgetFor } from "../../../shared/customCategories";
import type { Hand, PoolCard } from "../../../shared/customCategories";
import { customShares } from "../../../shared/customCategories";
import { votesSpent } from "../../../shared/voting";
import { isWaiting } from "../../../shared/bots";
import type { PlayerId, RoomState } from "../../../shared/state";
import { roomStore } from "../../net/room";
import { TIMING, useCreatingTransition } from "../../transition";

type Props = {
  room: RoomState;
  playerId: PlayerId;
  hands: Hand[];
  /** `state.clockOffset` — needed even outside `countdown` so the open voting
      deadline counts down against the same clock as everything else. */
  offset: number;
  /** Present once voting has closed and the round countdown is running. */
  countdown?: { endsAt: number; offset: number };
  /** This player's own committed categories — `state.drafts` from
      `PlayerView`, which the server keeps current through the writing phase
      and pushes one final time the instant it closes (`pushPrivateAll` on
      every alarm-driven advance). Never cleared afterward, so it doubles as
      the transition's leave snapshot: `PlayerCreating` has already
      unmounted for real, and this is the only copy of what it last showed
      left on this client. Empty for a player who joined after the writing
      phase closed — or, imprecisely, one who wrote nothing at all; see
      `hasSnapshot` below. */
  drafts: string[];
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
export function PlayerVotingCustom({ room, playerId, hands, offset, countdown, drafts }: Props) {
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

  // The transition (§1c), same reconstruction `HostVotingCustom` uses — see
  // its comment. `hasSnapshot` is `drafts` being non-empty: the server pushes
  // this player's final draft array the moment `creating` closes
  // (`pushPrivateAll` on every alarm-driven advance), so a non-empty array is
  // this client having actually been there. Imprecise in one direction only:
  // a player who wrote nothing at all also reads as "no snapshot" (the
  // server has nothing non-blank to have pushed, either), and quietly skips
  // straight to the entering hand — a graceful miss, not a wrong render.
  const writeQuota = quotaFor(room.players.length, room.settings.roundCount);
  const hasSnapshot = drafts.length > 0;
  const votingOpenedAt = room.phase.name === "voting" ? room.phase.endsAt - VOTING_MS : 0;
  const transition = useCreatingTransition(votingOpenedAt, hasSnapshot);
  const filledDrafts = Array.from({ length: writeQuota }, (_, i) => (drafts[i] ?? "").trim());
  const wasReady = hasSnapshot && filledDrafts.every((d) => d !== "");
  const crossfading = hasSnapshot && !transition.reduced;
  const crossfadeDelay = transition.delay(TIMING.crossfadeAt);

  // The timer bar never leaves, same freeze-then-refill `HostVotingCustom`
  // runs — see its comment. `refilled` only ever flips false -> true, once.
  const [refilled, setRefilled] = useState(
    !hasSnapshot || transition.reduced || transition.elapsedAtMount >= TIMING.timerRefillStart,
  );
  useEffect(() => {
    if (refilled) return;
    const id = setTimeout(
      () => setRefilled(true),
      TIMING.timerRefillStart - transition.elapsedAtMount,
    );
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  // The first hand's own deal-in (§1c: "the first hand deals in from
  // 1060ms"), separate from the hand-*swap*'s deal-in above: this one has no
  // pick behind it, so it is gated on nothing having been spent yet rather
  // than on `swap`, and its stagger is anchored to the transition's clock
  // rather than a locally-timed `i * 80`.
  const initialDealActive = !closed && !swap && spent === 0 && !transition.reduced;
  const dealParity = parity(ordinalRef.current);

  const newCounter = (
    <>
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
    </>
  );

  return (
    <main className="screen screen--mobile screen--locked player-voting">
      {/* No round marker: voting only ever happens before round one. */}
      <section className="card player-voting__head">
        {crossfading ? (
          // The counter stays — the one object that does not leave (§1c) —
          // crossfading its own contents in place rather than being replaced.
          <span className="creating-crossfade creating-crossfade--counter">
            <span className="creating-crossfade__out" style={{ animationDelay: crossfadeDelay }}>
              <span className="player-voting__count">
                {writeQuota - filledDrafts.filter((d) => d !== "").length}
              </span>
              <span className="player-voting__head-text">
                <span className="player-voting__head-title">to write</span>
                <span className="player-voting__pips">
                  {filledDrafts.map((d, i) => (
                    <span key={i} className={d !== "" ? "pip pip--spent" : "pip"} />
                  ))}
                </span>
              </span>
            </span>
            <span className="creating-crossfade__in" style={{ animationDelay: crossfadeDelay }}>
              {newCounter}
            </span>
          </span>
        ) : (
          newCounter
        )}
      </section>

      {transition.showLeaving ? (
        <CreatingLeave
          quota={writeQuota}
          filled={filledDrafts}
          wasReady={wasReady}
          delay={transition.delay}
        />
      ) : locked ? (
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
              dealing || initialDealActive ? `vote-tile--deal-${dealParity}` : "",
            ].filter(Boolean).join(" ");
            const dealStyle = dealing
              ? { animationDelay: `${i * 80}ms` }
              : initialDealActive
                ? { animationDelay: transition.delay(TIMING.handDealStart + i * TIMING.handDealStagger) }
                : undefined;
            return (
              <button
                key={`slot-${i}`}
                type="button"
                className={cls}
                style={dealStyle}
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
          <span className="timer-bar__num">{refilled ? formatClock(remaining) : "0:00"}</span>
          <span className="timer-track">
            <span
              className="timer-track__fill"
              style={{
                width: refilled
                  ? `${Math.min(100, (remaining / (VOTING_MS / 1000)) * 100)}%`
                  : "0%",
              }}
            />
          </span>
        </div>
      )}
    </main>
  );
}

/**
 * The transition's leave overlay on the phone (§1c): the writing card (or,
 * for a player who finished, their committed cards) plus the pager and the
 * commit button leaving together — one fade, not a stagger, since the phone
 * has one author instead of a room of them. Rendered from `drafts`, the only
 * copy of `PlayerCreating`'s last state this client still has (see
 * `PlayerVotingCustom`'s `drafts` prop) — `PlayerCreating` itself has
 * already unmounted for real.
 *
 * Read-only: this is furniture on its way off screen, not a form. The input
 * that used to live here is gone with it — its keyboard dismissal is iOS's
 * own doing the moment `PlayerCreating` unmounted, per the brief's "do not
 * fight it".
 */
function CreatingLeave({
  quota,
  filled,
  wasReady,
  delay,
}: {
  quota: number;
  filled: string[];
  wasReady: boolean;
  delay: (targetMs: number) => string;
}) {
  const style = { "--leave-y": "28px", animationDelay: delay(TIMING.phoneLeaveStart) } as CSSProperties;

  if (wasReady) {
    return (
      <div className="player-creating__ready-cards creating-leave__fade" style={style}>
        {filled.map((text, i) => (
          <div key={i} className="card player-creating__ready-card">
            <span className="player-creating__ready-text">{text}</span>
          </div>
        ))}
      </div>
    );
  }

  // The slot the phone was last sitting on: the first blank, or the last
  // card if every one of them was somehow filled without readying (cannot
  // happen through the real UI, but `filled` is reconstructed from a wire
  // array and this keeps it total).
  const cursor = filled.findIndex((d) => d === "");
  const activeCursor = cursor === -1 ? Math.max(0, quota - 1) : cursor;

  return (
    <>
      <section className="card player-creating__card creating-leave__fade" style={style}>
        <div className="player-creating__card-inner">
          <div className="player-creating__label">
            CARD {activeCursor + 1} OF {quota}
          </div>
          <div className="player-creating__input">{filled[activeCursor]}</div>
        </div>
      </section>

      {quota > 1 && (
        <div className="slot-strip creating-leave__fade" style={style}>
          {Array.from({ length: quota }, (_, i) => (
            <span
              key={i}
              className={[
                "slot-strip__chip",
                i === activeCursor ? "slot-strip__chip--current" : "",
                filled[i] !== "" ? "slot-strip__chip--done" : "",
              ].filter(Boolean).join(" ")}
            >
              {i + 1}
            </span>
          ))}
        </div>
      )}

      <button
        type="button"
        className="btn btn--block player-creating__commit creating-leave__fade"
        style={style}
        disabled
      >
        {activeCursor === quota - 1 ? "DONE" : "NEXT"}
      </button>
    </>
  );
}
