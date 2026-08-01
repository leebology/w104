import { useEffect, useState } from "react";
import { formatClock, useRemaining } from "../../net/clock";
import { prefersReducedMotion } from "../../reveal";
import { boardCards, customShares, voteBudgetFor } from "../../../shared/customCategories";
import type { PoolCard } from "../../../shared/customCategories";
import { tallyVotes } from "../../../shared/voting";
import { isWaiting } from "../../../shared/bots";
import { seatedPlayers } from "../../../shared/waiting";
import { currentRound } from "../../../shared/state";
import type { RoomState } from "../../../shared/state";
import { VOTING_MS } from "../../../shared/reduce";
import { RoomChip } from "../../components/RoomChip";
import { GetReady } from "../../components/GetReady";
import { roomStore } from "../../net/room";
import { TIMING, useCreatingTransition } from "../../transition";
import { CreatingLeaveBoard } from "./HostCreating";
import { HostHeader, HostHeaderRight, VotingCount } from "./HostHeader";
import { VotingExit } from "./HostVoting";

type Props = {
  room: RoomState;
  /** `state.clockOffset` — needed even outside `countdown` so the open voting
      deadline counts down against the same clock as everything else. */
  offset: number;
  /** Present once voting has closed and the round countdown is running. */
  countdown?: { endsAt: number; offset: number };
  /** The last `creating`-phase `RoomState` this client saw — `null` if it
      joined after the writing phase closed. Drives the transition's leave
      overlay only; the closed reveal (`countdown` present) never reads it. */
  creatingSnapshot: RoomState | null;
};

/**
 * `HostVoting`'s custom-pool fork. Same board, same object, same weighting
 * mechanic, same text scaling — the only fork is what feeds it (`room.pool`
 * instead of `BALLOT`) and what happens at close (chances, then authorship).
 * See docs/design/2026-07-30-custom-categories-brief.md §1d.
 */

export function HostVotingCustom({ room, offset, countdown, creatingSnapshot }: Props) {
  const pool = room.pool ?? [];
  const totals = tallyVotes(room.votes);
  // The voting window only — the countdown card counts itself, in numerals
  // that are not seconds. Same as the stock screen; see shared/countdown.ts.
  const remaining = useRemaining(
    room.phase.name === "voting" ? room.phase.endsAt : 0,
    offset,
    room.paused,
  );
  const budget = voteBudgetFor();
  const cast = Object.values(totals).reduce((a, b) => a + b, 0);
  // Matches `everyoneReady` in shared/reduce.ts, same as the stock screen.
  const voters = seatedPlayers(room.players);
  const ready = voters.filter((p) => p.connected && isWaiting(p)).length;

  // The transition (§1c): 1120ms, driven off `voting`'s own `endsAt` rather
  // than a phase of its own — `closeCreating` opens `voting` directly, with
  // no countdown between it and `creating` (see its comment in
  // shared/reduce.ts). `VOTING_MS` is fixed, so `endsAt - VOTING_MS`
  // reconstructs the instant voting opened, the one thing both this screen
  // and `PlayerVotingCustom` derive it from. Called unconditionally — rules
  // of hooks — even though its result only matters on the open board below;
  // the closed reveal (`countdown` present) never reads it.
  const votingOpenedAt = room.phase.name === "voting" ? room.phase.endsAt - VOTING_MS : 0;
  const transition = useCreatingTransition(votingOpenedAt, creatingSnapshot !== null);

  // The timer bar never leaves (§1c): frozen at 0:00 / empty through the
  // leave beat, then re-filling once real voting time is showing on the
  // clock. Gated on having a snapshot at all — a client with nothing to
  // leave from never saw a 0:00 to hold on, so it just shows the real
  // countdown from the first frame, same as the wipe-in below. `refilled`
  // only ever flips false -> true, once.
  const [refilled, setRefilled] = useState(
    !creatingSnapshot || transition.reduced || transition.elapsedAtMount >= TIMING.timerRefillStart,
  );
  useEffect(() => {
    if (refilled) return;
    const id = setTimeout(
      () => setRefilled(true),
      TIMING.timerRefillStart - transition.elapsedAtMount,
    );
    return () => clearTimeout(id);
    // `refilled`'s initial value and `transition.elapsedAtMount` are both
    // fixed at mount — see their own definitions — so there is exactly one
    // timer to arm here, ever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (countdown) {
    return (
      <HostVotingCustomClosed
        room={room}
        pool={pool}
        totals={totals}
        countdown={countdown}
        cast={cast}
      />
    );
  }

  // Whether the header count and the prompt line have anything to crossfade
  // *from*. Reduced motion cuts straight to the settled frame — no old copy
  // ever shows.
  const crossfading = creatingSnapshot !== null && !transition.reduced;
  const oldReady = creatingSnapshot
    ? creatingSnapshot.players.filter((p) => p.connected && p.ready).length
    : 0;
  const crossfadeDelay = transition.delay(TIMING.crossfadeAt);

  return (
    <main className="screen screen--host host-voting host-voting--custom">
      {/* No round marker: voting only ever happens before round one. */}
      <HostHeader
        left={<RoomChip room={room} />}
        right={
          <HostHeaderRight>
            {crossfading ? (
              <span className="creating-crossfade">
                <span className="creating-crossfade__out" style={{ animationDelay: crossfadeDelay }}>
                  <span className="host-header__count">
                    {creatingSnapshot!.players.length}{" "}
                    {creatingSnapshot!.players.length === 1 ? "PLAYER" : "PLAYERS"} · {oldReady} READY
                  </span>
                </span>
                <span className="creating-crossfade__in" style={{ animationDelay: crossfadeDelay }}>
                  <VotingCount n={voters.length} ready={ready} />
                </span>
              </span>
            ) : (
              <VotingCount n={voters.length} ready={ready} />
            )}
            <VotingExit room={room} />
          </HostHeaderRight>
        }
      />

      {crossfading ? (
        <span className="creating-crossfade creating-crossfade--prompt">
          <span className="creating-crossfade__out" style={{ animationDelay: crossfadeDelay }}>
            <p className="plaque host-creating__plaque">WRITE YOUR CATEGORIES</p>
          </span>
          <span className="creating-crossfade__in" style={{ animationDelay: crossfadeDelay }}>
            <p className="host-voting__prompt">
              PICK ONE FROM EACH HAND — {budget} {budget === 1 ? "VOTE" : "VOTES"} EACH
            </p>
          </span>
        </span>
      ) : (
        <p className="host-voting__prompt">
          PICK ONE FROM EACH HAND — {budget} {budget === 1 ? "VOTE" : "VOTES"} EACH
        </p>
      )}

      {transition.showLeaving && creatingSnapshot ? (
        <CreatingLeaveBoard room={creatingSnapshot} delay={transition.delay} />
      ) : (
        // The board itself stays hidden while voting is open — showing it
        // live would let the room watch categories reorder and resize as
        // votes land, mid-vote. It appears once for everyone, all at once,
        // in the closed reveal above.
        <div className="host-voting__grid host-voting__grid--waiting">
          <p className="host-voting__no-votes">Categories reveal once voting closes.</p>
        </div>
      )}

      <div className="host-voting__footer">
        <span className="host-voting__clock">{refilled ? formatClock(remaining) : "0:00"}</span>
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
  room, pool, totals, countdown, cast,
}: {
  room: RoomState;
  pool: PoolCard[];
  totals: Record<string, number>;
  /** The round countdown's deadline; the card counts itself against it. */
  countdown: { endsAt: number; offset: number };
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

  // Computed once at mount, matching `PlayerScoring`'s own reveal — this
  // component is a fresh mount every time voting closes, so there is never a
  // stale reading to worry about.
  const [reduced] = useState(prefersReducedMotion);

  // The board sits still for a beat before it starts moving at all — long
  // enough for the room to look up from their phones at the TV before the
  // cards they didn't vote for vanish out from under them. 3s, not 1s: at
  // 1s the leave and the reflow both read as an instant cut rather than
  // something the room had a chance to see coming.
  const LOOK_UP_MS = 3000;

  // How long the zero-vote row takes to actually fade out, once it starts —
  // shared by the CSS keyframe (`cardLeave`) and the timer that unmounts the
  // row once the fade has had time to finish.
  const LEAVE_MS = 600;

  // The reflow: survivors mount at equal flex-grow and are pushed to their final
  // share after the look-up beat, so `.host-voting--closed .vote-card`'s
  // transition has something to animate from. Skipped under reduced motion —
  // cards land at their settled share on the very first frame instead.
  const [grown, setGrown] = useState(reduced);
  useEffect(() => {
    if (reduced) return;
    const t = setTimeout(() => setGrown(true), LOOK_UP_MS);
    return () => clearTimeout(t);
  }, [reduced]);

  // Zero-vote cards start fading only once the look-up beat is over — the
  // `--leaving` class used to ride on the card from the very first frame, so
  // the fade actually played out (and finished) while the room was still
  // arriving at the screen, well before `zeroGone` ever unmounted them.
  // `leaving` is the flag that actually starts the animation; `zeroGone`
  // removes the row from the DOM only once that animation has had time to
  // finish.
  const [leaving, setLeaving] = useState(reduced);
  useEffect(() => {
    if (reduced || zeroCards.length === 0) return;
    const t = setTimeout(() => setLeaving(true), LOOK_UP_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [zeroGone, setZeroGone] = useState(reduced);
  useEffect(() => {
    if (reduced || zeroCards.length === 0) return;
    const t = setTimeout(() => setZeroGone(true), LOOK_UP_MS + LEAVE_MS);
    return () => clearTimeout(t);
    // Runs once per mount: this is a fresh component every time voting
    // closes, so there is exactly one "leave" beat to play.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // S = min(140ms, 2200 / cards), so the whole reveal — the look-up beat plus
  // the stagger — lands inside ~3.8s, comfortably inside the 5-second
  // countdown already running.
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
        left={<RoomChip room={room} />}
        right={
          <HostHeaderRight>
            <span className="host-header__count">
              VOTING CLOSED · {cast} {cast === 1 ? "VOTE" : "VOTES"} IN
            </span>
            <VotingExit room={room} />
          </HostHeaderRight>
        }
      />

      {/* Same wrapper the stock closed reveal uses: the reveal and the
          countdown card share one stage rather than the reveal absorbing the
          slack and pinning the card to the bottom edge. */}
      <div className="host-voting__stage">
        <div className="host-voting__result">
          {showNoVotes ? (
            // Say nothing about which category — the draw itself hasn't
            // happened yet.
            <p className="host-voting__no-votes">
              No one voted — the room gets a random category.
            </p>
          ) : (
            <>
              {survivors.length > 0 && (
                // One row, one card size — see `.host-voting__row--all`. Two
                // cards on the same chance are drawn the same however far down
                // the order they sit; only the width says anything.
                <div className="host-voting__row host-voting__row--all">
                  {survivors.map((card, i) => (
                    <ResultCard
                      key={card.id}
                      card={card}
                      room={room}
                      votes={totals[card.id] ?? 0}
                      share={shares[card.id] ?? 0}
                      // Equal share before the reflow, never 0 — see the same
                      // line in `HostVoting.tsx`: `.vote-card` is `flex: 1 1 0`,
                      // so a grow of 0 collapses the card onto its `min-width`.
                      flexGrow={grown ? shares[card.id] ?? 0 : 1}
                      chipIndex={i}
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
                    <div
                      key={card.id}
                      className={
                        "vote-card vote-card--custom vote-card--zero" +
                        (leaving ? " vote-card--leaving" : "")
                      }
                    >
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
        <div className="host-voting__countdown">
          <GetReady
            endsAt={countdown.endsAt}
            offset={countdown.offset}
            label={`ROUND ${currentRound(room)}`}
          />
        </div>
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
  card, room, votes, share, flexGrow, chipIndex, stagger,
}: {
  card: PoolCard;
  room: RoomState;
  votes: number;
  share: number;
  flexGrow: number;
  chipIndex: number;
  stagger: number;
}) {
  const house = card.authorId === null;
  const author = card.authorId !== null
    ? room.players.find((p) => p.id === card.authorId)
    : undefined;

  return (
    <div className="vote-card vote-card--custom" style={{ flexGrow }}>
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
        <span className="vote-card__name">{card.text}</span>
      </div>
      <span className="vote-card__foot vote-card__foot--solo">
        <span className="vote-card__crossfade">
          <span className="vote-card__total vote-card__total--out">{votes}</span>
          <span className="vote-card__total vote-card__total--in">{share}%</span>
        </span>
      </span>
    </div>
  );
}
