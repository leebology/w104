import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { formatClock, useRemaining } from "../../net/clock";
import { prefersReducedMotion } from "../../reveal";
import { boardCards, customShares, voteBudgetFor } from "../../../shared/customCategories";
import type { PoolCard } from "../../../shared/customCategories";
import { tallyVotes } from "../../../shared/voting";
import { isWaiting } from "../../../shared/bots";
import type { RoomState } from "../../../shared/state";
import { VOTING_MS } from "../../../shared/reduce";
import { RoomChip } from "../../components/RoomChip";
import { roomStore } from "../../net/room";
import { HostHeader, HostHeaderRight, VotingCount } from "./HostHeader";
import { VotingExit, balancedRows } from "./HostVoting";

type Props = {
  room: RoomState;
  /** `state.clockOffset` — needed even outside `countdown` so the open voting
      deadline counts down against the same clock as everything else. */
  offset: number;
  /** Present once voting has closed and the round countdown is running. */
  countdown?: { endsAt: number; offset: number };
};

/**
 * `HostVoting`'s custom-pool fork. Same board, same object, same weighting
 * mechanic, same text scaling — the only fork is what feeds it (`room.pool`
 * instead of `BALLOT`) and what happens at close (chances, then authorship).
 * See docs/design/2026-07-30-custom-categories-brief.md §1d.
 */

/**
 * Zero-vote cards get a fixed cap here, not the stock `nameSize`'s 20px — the
 * brief calls this value out explicitly as the one place custom differs from
 * the ballot board's own scale. Voted cards keep the unchanged formula.
 */
function nameSize(votes: number, max: number): string {
  if (votes === 0) return "30px";
  return `${Math.round(26 + 40 * (votes / max))}px`;
}

export function HostVotingCustom({ room, offset, countdown }: Props) {
  const pool = room.pool ?? [];
  const totals = tallyVotes(room.votes);
  const remaining = useRemaining(
    countdown?.endsAt ?? (room.phase.name === "voting" ? room.phase.endsAt : 0),
    countdown?.offset ?? offset,
    countdown ? null : room.paused,
  );
  const budget = voteBudgetFor();
  const cast = Object.values(totals).reduce((a, b) => a + b, 0);
  // Matches `everyoneReady` in shared/reduce.ts, same as the stock screen.
  const ready = room.players.filter((p) => p.connected && isWaiting(p)).length;

  if (countdown) {
    return (
      <HostVotingCustomClosed
        room={room}
        pool={pool}
        totals={totals}
        remaining={remaining}
        cast={cast}
      />
    );
  }

  const { shown, packCount } = boardCards(pool, totals);
  // One scale across both rows, so a name's size means the same thing
  // wherever the card sits — same reasoning as the stock board's `maxVotes`.
  const maxVotes = Math.max(1, ...shown.map((c) => totals[c.id] ?? 0));
  const rankOf = new Map(shown.map((c, i) => [c.id, i]));
  const rows = balancedRows(
    shown,
    (c) => totals[c.id] ?? 0,
    (c) => rankOf.get(c.id) ?? 0,
  );

  return (
    <main className="screen screen--host host-voting host-voting--custom">
      {/* No round marker: voting only ever happens before round one. */}
      <HostHeader
        left={<RoomChip code={room.code} />}
        right={
          <HostHeaderRight>
            <VotingCount n={room.players.length} ready={ready} />
            <VotingExit room={room} />
          </HostHeaderRight>
        }
      />

      <p className="host-voting__prompt">
        PICK ONE FROM EACH HAND — {budget} {budget === 1 ? "VOTE" : "VOTES"} EACH
      </p>

      <div className="host-voting__grid">
        {rows.map((row, i) => (
          <div className="host-voting__row" key={i}>
            {row.map((card) => {
              const votes = totals[card.id] ?? 0;
              return (
                <div
                  key={card.id}
                  className={
                    (votes > 0 ? "vote-card" : "vote-card vote-card--zero") +
                    " vote-card--custom"
                  }
                  // Card width IS the odds, exactly as the stock board — no
                  // measurement, no JS layout pass. No voter avatars here:
                  // hands stay private until the reveal.
                  style={{
                    flexGrow: votes + 1,
                    "--name-size": nameSize(votes, maxVotes),
                  } as CSSProperties}
                >
                  <span className="vote-card__name">{card.text}</span>
                  {votes > 0 && (
                    <span className="vote-card__foot vote-card__foot--solo">
                      <span className="vote-card__total">{votes}</span>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {packCount > 0 && (
        // A count, never a list — a list would be a second board.
        <div className="host-voting__pack">
          <span className="host-voting__pack-pill">+ {packCount} MORE ON THE BOARD</span>
        </div>
      )}

      <div className="host-voting__footer">
        <span className="host-voting__clock">{formatClock(remaining)}</span>
        <span className="timer-track">
          <span
            className="timer-track__fill"
            style={{ width: `${Math.min(100, (remaining / (VOTING_MS / 1000)) * 100)}%` }}
          />
        </span>
        <button
          type="button"
          className="btn"
          onClick={() => roomStore.send({ type: "startGame" })}
        >
          Continue
        </button>
      </div>
    </main>
  );
}

/**
 * Chances, then authorship — both on this one screen (§1d "Close"). This is a
 * fresh mount, same as the stock `HostVotingClosed`: the open board above has
 * already unmounted by the time this exists, so the "zero-vote cards leave"
 * beat is played out from scratch here rather than inherited from it.
 */
function HostVotingCustomClosed({
  room, pool, totals, remaining, cast,
}: {
  room: RoomState;
  pool: PoolCard[];
  totals: Record<string, number>;
  /** Whole seconds — `useRemaining` returns a number, not a formatted string. */
  remaining: number;
  cast: number;
}) {
  const shares = customShares(pool, room.votes);
  // The same ten (or fewer) cards the open board just had on it, so the
  // "leave" beat has a shape to leave from.
  const { shown } = boardCards(pool, totals);
  const survivors = shown
    .filter((c) => (shares[c.id] ?? 0) > 0)
    .sort((a, b) => (shares[b.id] ?? 0) - (shares[a.id] ?? 0));
  const zeroCards = shown.filter((c) => (shares[c.id] ?? 0) === 0);
  const top = survivors.slice(0, 3);
  const rest = survivors.slice(3);
  // Same steps the stock reveal uses for the name; the chance/share figure
  // gets its own, larger scale here — a deliberate difference the brief
  // calls out, not the stock screen's `rankShareSize` reused.
  const rankNameSize = ["52px", "34px", "30px"];
  const rankChanceSize = ["46px", "34px", "30px"];

  // Computed once at mount, matching `PlayerScoring`'s own reveal — this
  // component is a fresh mount every time voting closes, so there is never a
  // stale reading to worry about.
  const [reduced] = useState(prefersReducedMotion);

  // The 260ms reflow: survivors mount at flex-grow 0 and are pushed to their
  // final share on the next frame, so `.host-voting--closed .vote-card`'s
  // transition has something to animate from. Skipped under reduced motion —
  // cards land at their settled share on the very first frame instead.
  const [grown, setGrown] = useState(reduced);
  useEffect(() => {
    if (reduced) return;
    const raf = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  // Zero-vote cards leave 200ms after the reveal mounts. Reduced motion cuts
  // straight to the settled state — they are simply never shown.
  const [zeroGone, setZeroGone] = useState(reduced);
  useEffect(() => {
    if (reduced || zeroCards.length === 0) return;
    const t = setTimeout(() => setZeroGone(true), 200);
    return () => clearTimeout(t);
    // Runs once per mount: this is a fresh component every time voting
    // closes, so there is exactly one "leave" beat to play.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // S = min(140ms, 2200 / cards), so the whole reveal lands inside 2.6s —
  // comfortably inside the 5-second countdown already running.
  const stagger = Math.min(140, 2200 / Math.max(1, survivors.length));

  // The deadline force-closes voting regardless of readiness, so a board of
  // nothing but zero-vote cards is reachable — the whole `shown` set leaves,
  // and only once it has (or there was never anything to leave) does the
  // room learn nobody voted. Waiting on `zeroGone` here is what lets the
  // "everyone blank" board clear itself before the message lands, rather
  // than the message and the leaving cards fighting for the same frame.
  const showNoVotes = survivors.length === 0 && (zeroGone || zeroCards.length === 0);

  return (
    <main className="screen screen--host host-voting host-voting--custom host-voting--closed">
      <HostHeader
        left={<RoomChip code={room.code} />}
        right={
          <HostHeaderRight>
            <span className="host-header__count">
              VOTING CLOSED · {cast} {cast === 1 ? "VOTE" : "VOTES"} IN
            </span>
            <VotingExit room={room} />
          </HostHeaderRight>
        }
      />

      <div className="host-voting__result">
        {showNoVotes ? (
          // Say nothing about which category — the draw itself hasn't
          // happened yet.
          <p className="host-voting__no-votes">
            No one voted — the room gets a random category.
          </p>
        ) : (
          <>
            {top.length > 0 && (
              <div className="host-voting__row host-voting__row--top">
                {top.map((card, i) => (
                  <ResultCard
                    key={card.id}
                    card={card}
                    room={room}
                    votes={totals[card.id] ?? 0}
                    share={shares[card.id] ?? 0}
                    flexGrow={grown ? shares[card.id] ?? 0 : 0}
                    nameSize={rankNameSize[i]}
                    chanceSize={rankChanceSize[i]}
                    chipIndex={i}
                    stagger={stagger}
                  />
                ))}
              </div>
            )}

            {rest.length > 0 && (
              <div className="host-voting__row host-voting__row--rest">
                {rest.map((card, i) => (
                  <ResultCard
                    key={card.id}
                    card={card}
                    room={room}
                    votes={totals[card.id] ?? 0}
                    share={shares[card.id] ?? 0}
                    small
                    chipIndex={3 + i}
                    stagger={stagger}
                  />
                ))}
              </div>
            )}

            {!zeroGone && zeroCards.length > 0 && (
              // The pack pill goes with them — it never renders here at all,
              // since this is a fresh mount and it was never part of it.
              <div className="host-voting__row host-voting__row--leaving">
                {zeroCards.map((card) => (
                  <div key={card.id} className="vote-card vote-card--custom vote-card--zero vote-card--leaving">
                    <span className="vote-card__name">{card.text}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Nothing here names the drawn category — the draw happens at the
          whistle. No Stop button, same reasoning as the stock reveal. */}
      <div className="host-voting__closed-footer">
        <p className="get-ready get-ready--tv">Get ready… {remaining}</p>
      </div>
    </main>
  );
}

/**
 * One card of the closed reveal: name, the count-to-chance crossfade, and —
 * gated on `room.authorsRevealed`, never on `authorId !== null` alone — the
 * author chip. `authorId` is only genuinely non-null post-reveal; pre-reveal
 * every card's is nulled by `publicPool`, which is why the gate is the flag
 * and not the field.
 */
function ResultCard({
  card, room, votes, share, small, flexGrow, nameSize: nameFontSize, chanceSize, chipIndex, stagger,
}: {
  card: PoolCard;
  room: RoomState;
  votes: number;
  share: number;
  small?: boolean;
  flexGrow?: number;
  nameSize?: string;
  chanceSize?: string;
  chipIndex: number;
  stagger: number;
}) {
  const house = card.authorId === null;
  const author = card.authorId !== null
    ? room.players.find((p) => p.id === card.authorId)
    : undefined;

  return (
    <div
      className={
        small
          ? "vote-card vote-card--custom vote-card--small"
          : "vote-card vote-card--custom"
      }
      style={small ? undefined : { flexGrow }}
    >
      <div className="vote-card__top">
        {/* Reserved from the first frame — `animation-fill-mode: both` on
            `.author-chip` holds its 0%/opacity-0 frame for the whole delay,
            so the box is in flow (and the name below it does not move) long
            before the chip actually pops. */}
        {room.authorsRevealed && (
          <span
            className={house ? "author-chip author-chip--house" : "author-chip"}
            style={{ animationDelay: `${420 + chipIndex * stagger}ms` }}
          >
            {house ? (
              "HOUSE CARD"
            ) : (
              <>
                <span className="author-chip__emoji">{author?.emoji}</span>
                <span className="author-chip__name">{author?.name}</span>
              </>
            )}
          </span>
        )}
        <span className="vote-card__name" style={nameFontSize ? { fontSize: nameFontSize } : undefined}>
          {card.text}
        </span>
      </div>
      <span className="vote-card__foot vote-card__foot--solo">
        <span className="vote-card__crossfade">
          <span
            className="vote-card__total vote-card__total--out"
            style={chanceSize ? { fontSize: chanceSize } : undefined}
          >
            {votes}
          </span>
          <span
            className="vote-card__total vote-card__total--in"
            style={chanceSize ? { fontSize: chanceSize } : undefined}
          >
            {share}%
          </span>
        </span>
      </span>
    </div>
  );
}
