import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  parity,
  prefersReducedMotion,
  selfMarkCardClass,
  selfMarkClass,
  useRevealStep,
} from "../../reveal";
import { RoomChip } from "../../components/RoomChip";
import { TeamBadge } from "../../components/TeamBadge";
import { WordList } from "../../components/WordList";
import type { RowReveal } from "../../components/WordList";
import { useMarquee } from "../../marquee";
import { roomStore } from "../../net/room";
import {
  REVEAL_TIMING,
  activeColumn,
  buildSchedule,
  cardView,
  cueStep,
  entryOrder,
  finalOrder,
  finalRanks,
  rowView,
  seededRng,
  uniqueDirection,
  withSelfStrikes,
} from "../../../shared/reveal";
import { totalMarks } from "../../../shared/selfstrike";
import type { SelfMarks } from "../../../shared/selfstrike";
import type { Results } from "../../../shared/scoring";
import { computeStandings } from "../../../shared/standings";
import { currentRound } from "../../../shared/state";
import type { RoomState } from "../../../shared/state";
import { rosterOf } from "../../../shared/teams";
import type { ScorerId } from "../../../shared/teams";
import { HostHeader } from "./HostHeader";

/**
 * One row up to five players, two balanced rows up to the ten-player cap —
 * six players read better as 3+3 than as 5+1. Never more than five across:
 * past that the words stop being legible from a sofa.
 */
function columnsFor(n: number): number {
  return n <= 5 ? Math.max(n, 1) : Math.ceil(n / 2);
}

/* Timings. Every one of these is in the design handoff's timing table; the CSS
   side of each pairing lives in style.css under the same name. Frames 1 and 2
   are paced from `REVEAL_TIMING` in shared/reveal.ts, because the phones run
   them too; everything below is the host's alone. */

/** Frame 3: the swap, and the beat the X travel trails the Y travel by. */
const SWAP_DURATION = 1600;
const SWAP_X_DELAY = 180;

/**
 * The mirror eases toward each target rather than snapping to it. At 60fps a
 * 0.25 factor closes ~99% in about 280ms — near enough one send interval, so a
 * 4Hz stream reads as continuous motion without stacking noticeable lag on top
 * of the interval itself.
 */
const MIRROR_EASE = 0.25;

/** How long a column keeps its driven marker after the last message. */
const MIRROR_IDLE = 2000;

/**
 * FAST FORWARD is a compressed run, not a hard cut: the outstanding strikes all
 * land on one frame, the grid takes a single penalty ring together as the
 * acknowledgement, and then the podium still arrives as a moment — at 1.6×.
 */
const ACK_RING = 320;
const FF_SPEED = 1.6;

/**
 * The footer's dead window, ≈920ms end to end. A host mashing FAST FORWARD would
 * otherwise land the second press on STANDINGS and blow straight past the
 * results, so the two buttons never share a hit target, the footer is
 * deliberately *empty* between them, and STANDINGS ignores clicks while it
 * arrives.
 */
const FOOTER_OUT = 160;
const FOOTER_GAP = 480;
const FOOTER_IN = 280;

/**
 * Frame 1 deals in, frame 2 reveals, frame 3 ranks. `ack` is the single beat
 * FAST FORWARD spends acknowledging the strikes it just landed.
 *
 * Derived, not stored: frames 1 and 2 are a function of elapsed time, so the
 * only state behind this is "frame 3 has begun" and "we are mid-ack".
 */
type Phase = "deal" | "reveal" | "ack" | "rank";

/**
 * FAST FORWARD leaves, the footer is deliberately empty, then STANDINGS arrives
 * ignoring clicks. `ff` and `ready` are the two resting states.
 */
type Footer = "ff" | "out" | "gap" | "entering" | "ready";

const FOOTER_NEXT: Partial<Record<Footer, { to: Footer; after: number }>> = {
  out: { to: "gap", after: FOOTER_OUT },
  gap: { to: "entering", after: FOOTER_GAP },
  entering: { to: "ready", after: FOOTER_IN },
};

const MEDALS = ["gold", "silver", "bronze"] as const;
const PLACES = ["1ST", "2ND", "3RD"] as const;

type Props = {
  room: RoomState;
  results: Results;
  /** Server time the reveal began; every client counts its lines from here. */
  startedAt: number;
  skipped: boolean;
  /** Words their own scorers disowned. See shared/selfstrike.ts. */
  marks: SelfMarks;
};

/**
 * The round's results, played to the room as three frames.
 *
 * All of the state is `phase` plus one integer `step`; every struck word, every
 * emoji trail, every UNIQUE count and every rank is derived from that integer
 * against a schedule built once in `shared/reveal.ts`. Nothing is stored per row
 * and nothing is diffed — which is exactly why FAST FORWARD is a one-line
 * assignment rather than a second code path.
 */
export function HostScoring({ room, results, startedAt, skipped, marks }: Props) {
  // Read once. A host changing their OS motion setting mid-round is not a case
  // worth a subscription, and re-deriving the phase from it would restart the
  // sequence under them.
  const [reduced] = useState(prefersReducedMotion);

  const round = currentRound(room);
  const seed = `${room.code}:${round}`;

  // Shortest list first, so the reveal builds: each column has more to say than
  // the one before it, and the longest list — the one most likely to hold the
  // round's winner — lands last. `PlayerScoring` builds the identical schedule
  // from the identical arguments; the two must not drift.
  const schedule = useMemo(
    () =>
      buildSchedule(results, {
        playerOrder: "shortest",
        lineOrder: "entry",
        rng: seededRng(`${seed}:reveal`),
      }),
    [results, seed],
  );

  // Round one has nothing to deal in the order of; every round after deals in
  // match standings, best first, so the swap at the end says who moved.
  const placeOf = useMemo(() => {
    if (room.history.length === 0) return null;
    const standings = computeStandings(rosterOf(room), room.history);
    return Object.fromEntries(standings.map((s) => [s.id, s.place]));
  }, [room]);

  const dealOrder = useMemo(
    () => entryOrder(results.scorers, placeOf, seededRng(`${seed}:deal`)),
    [results, placeOf, seed],
  );
  // The placement is taken from the *self-validated* round, so the podium can
  // never disagree with the standings that get banked off the same numbers.
  //
  // Memoized on the mark count rather than on `marks` itself: `room` is replaced
  // wholesale on every state push, so the object identity changes when somebody
  // merely readies up, and a fresh `finalIds` would re-run the swap below. Every
  // accepted mark adds exactly one to the total, so the count is an exact
  // version number for the set.
  const marksVersion = totalMarks(marks);
  const placed = useMemo(() => withSelfStrikes(results, marks), [results, marksVersion]);

  /**
   * The finishing order, with a **stable identity for as long as the order
   * itself holds**.
   *
   * That is the whole point of the second memo, not the cost of the sort. A mark
   * that drops somebody's UNIQUE without moving anybody past anybody else must
   * not re-run the swap: the cards are already where they belong, and replaying
   * a 1.6s re-choreography to arrive at the same grid reads as a glitch. Keyed on
   * the joined order, so only a genuine change of positions is a change here —
   * `ranks` is free to move underneath it, since renumbering a plaque costs
   * nothing and moves no card.
   */
  const order = useMemo(() => finalOrder(placed.scorers).map((s) => s.id), [placed]);
  // Separated by NUL, which no scorer id can contain, so the key is unambiguous.
  // **Written as the escape `\0`, never as a raw NUL byte in the source.** Git
  // calls any file with a NUL in its first 8KB binary, and this one used to have
  // one: `git diff` reported "Bin 25344 -> 28552 bytes" and no reviewer, PR view
  // or diff tool could read a single line of the most intricate file in the repo.
  const orderKey = order.join("\0");
  const finalIds = useMemo(() => order, [orderKey]);
  const ranks = useMemo(() => finalRanks(placed.scorers), [placed]);
  const byId = useMemo(
    () => new Map(results.scorers.map((s) => [s.id, s])),
    [results],
  );

  // Frames 1 and 2, off the clock rather than off a chain of timers — the same
  // derivation every phone is running. See src/reveal.ts.
  const { step, dealt } = useRevealStep(schedule, startedAt, skipped, reduced);

  /** Frame 3 has begun. */
  const [ranked, setRanked] = useState(reduced);
  /** Mid-acknowledgement of a FAST FORWARD. */
  const [acking, setAcking] = useState(false);
  /** 0 pre-swap, 1 in flight, 2 settled — the plaques and medals land on 2. */
  const [rankStage, setRankStage] = useState(() => (reduced ? 2 : 0));
  const [speed, setSpeed] = useState(1);
  const [footer, setFooter] = useState<Footer>(() => (reduced ? "ready" : "ff"));
  const [travel, setTravel] = useState<Record<ScorerId, { x: number; y: number }>>({});
  /**
   * How many choreographies have started. An *ordinal*, and it exists for the
   * same reason every other one on this screen does: the swap class alternates
   * A/B off its parity, so a second swap is guaranteed to re-fire.
   *
   * Load-bearing, not belt-and-braces. Clearing the class and re-adding it does
   * not restart an animation on its own here: both of those state changes happen
   * inside one passive-effect flush, React commits them in the same task, and the
   * browser never paints — or recalculates — in between. The animation is simply
   * replaced by an identical one that has already finished, and its `both` fill
   * snaps the card onto the new position with no travel at all. That is the
   * "it instantly switches positions" bug, and only a changed animation-name
   * fixes it.
   */
  const [swapGen, setSwapGen] = useState(0);

  const columns = useRef(new Map<ScorerId, HTMLElement | null>());
  const lists = useRef(new Map<ScorerId, HTMLDivElement | null>());
  /**
   * The mirror's targets, as fractions of each column's scrollable range.
   *
   * Refs, not state, and that is the whole point: this screen renders up to ten
   * columns of up to 200 rows, and a 4Hz value in the render tree would
   * re-render all of it four times a second per scrolling player. The values
   * are written straight onto the DOM nodes above instead — the same
   * imperative call the measured swap makes, and for the same reason.
   */
  const mirrorTargets = useRef(new Map<ScorerId, number>());
  /** Kicks the rAF loop when a new target lands. Set by the effect below. */
  const mirrorPump = useRef<() => void>(() => {});
  /** Per-column timers that clear the driven marker. */
  const mirrorIdle = useRef(new Map<ScorerId, ReturnType<typeof setTimeout>>());
  /** The ack fires once per screen; see the effect below. */
  const acked = useRef(reduced);

  const phase: Phase = ranked ? "rank" : acking ? "ack" : dealt ? "reveal" : "deal";

  // The reveal ran out on its own: two beats of the ordinary cadence, then the
  // swap. FAST FORWARD takes the `acked` path below instead.
  useEffect(() => {
    if (ranked || acking || !dealt) return;
    if (step < schedule.lastStep) return;
    const id = setTimeout(() => setRanked(true), REVEAL_TIMING.LINE_INTERVAL * 2);
    return () => clearTimeout(id);
  }, [ranked, acking, dealt, step, schedule.lastStep]);

  // FAST FORWARD, arriving as room state so the TV and the phones land every
  // outstanding strike on the same frame. Depends on `skipped` alone and guards
  // on a ref: with `acking` in the dep array, setting it would immediately
  // re-run this effect's cleanup and clear the timer that ends the ack.
  useEffect(() => {
    if (!skipped || acked.current) return;
    acked.current = true;
    setAcking(true);
    setSpeed(FF_SPEED);
    const id = setTimeout(() => {
      setAcking(false);
      setRanked(true);
    }, ACK_RING);
    return () => clearTimeout(id);
  }, [skipped]);

  /**
   * A change of *positions* after the swap — a word disowned once the podium is
   * already up, which actually moves somebody — has to be re-choreographed from a
   * clean grid rather than re-measured. Both swap animations hold their end
   * state, so the cards are sitting on transforms, and measuring now would take
   * each card's destination for its origin and fly them all somewhere wrong.
   *
   * Dropping back to stage 0 clears every transform; the effect below measures on
   * the commit after. This runs on a change of `finalIds`, whose identity is
   * deliberately stable while the order holds — a mark that changes nobody's
   * position never reaches here. Skipped under reduced motion, which renders the
   * settled end state from first paint and has no swap to replay.
   */
  useEffect(() => {
    if (reduced) return;
    setRankStage(0);
    setTravel({});
  }, [finalIds, reduced]);

  /**
   * The swap is measured, not calculated: the DOM stays in deal order for the
   * whole screen's life and each column is translated to the slot its final rank
   * earns it. Measuring means the arithmetic of the grid — two rows, a short
   * last row, the 20vw cap — is never duplicated here.
   *
   * The rects are only trustworthy at stage 0, which is why the reset above and
   * this are two effects rather than one: `getBoundingClientRect` flushes layout,
   * so by the time this runs the cleared classes are committed and every card is
   * back at its dealt slot. The browser will not have *painted* that frame — see
   * `swapGen` — which is exactly why the animation needs a new name rather than a
   * cleared class.
   */
  useEffect(() => {
    if (phase !== "rank" || reduced) return;
    // Only from the clean grid — see above.
    if (rankStage !== 0) return;
    const rects = dealOrder.map((id) => columns.current.get(id)?.getBoundingClientRect());
    const next: Record<ScorerId, { x: number; y: number }> = {};
    dealOrder.forEach((id, from) => {
      const to = finalIds.indexOf(id);
      const a = rects[from];
      const b = rects[to];
      if (!a || !b) return;
      next[id] = { x: b.left - a.left, y: b.top - a.top };
    });
    setTravel(next);
    setRankStage(1);
    setSwapGen((gen) => gen + 1);
  }, [phase, reduced, rankStage, dealOrder, finalIds, speed]);

  /**
   * Stage 1 → 2: the cards have finished flying, so the plaques and medals land.
   *
   * **Its own effect, and that is the whole point.** This used to be a
   * `setTimeout` at the end of the measuring effect above — which reads
   * `rankStage` and therefore has it in its dependency array. Arming the timer
   * and calling `setRankStage(1)` in the same pass meant the state change
   * immediately invalidated those deps, React ran the cleanup, and
   * `clearTimeout` destroyed the timer that update had just armed. The re-run
   * then fell straight out of the `rankStage !== 0` guard without scheduling a
   * replacement, so **stage 2 was unreachable**: no medals, no gold card, and
   * `RANK n` still showing only because it is gated on `>= 1`.
   *
   * Keyed on stage 1 instead, nothing clears this until the stage it is waiting
   * for actually arrives — or a re-rank drops the grid back to 0, which is a
   * cancellation this *should* honour.
   */
  useEffect(() => {
    if (rankStage !== 1 || reduced) return;
    const id = setTimeout(
      () => setRankStage(2),
      (SWAP_X_DELAY + SWAP_DURATION) / speed,
    );
    return () => clearTimeout(id);
  }, [rankStage, reduced, speed]);

  // The footer swaps the moment the reveal is over — whether it ran out or was
  // skipped — so FAST FORWARD is never left on screen as a control with nothing
  // left to skip.
  useEffect(() => {
    if (footer !== "ff") return;
    if (phase !== "ack" && phase !== "rank") return;
    setFooter("out");
  }, [phase, footer]);

  // One timer per stage rather than three scheduled at once: this effect's
  // cleanup runs on every `footer` change, so a batch would clear the later two
  // the instant the first one landed and the footer would stall empty.
  useEffect(() => {
    const next = FOOTER_NEXT[footer];
    if (!next) return;
    const id = setTimeout(() => setFooter(next.to), next.after);
    return () => clearTimeout(id);
  }, [footer]);

  const active = phase === "reveal" ? activeColumn(schedule, step) : null;

  // Only the revealing column follows its newest line. A back-check landing
  // elsewhere must not yank another column away from where the room is looking.
  useEffect(() => {
    if (active === null) return;
    const list = lists.current.get(active);
    if (!list) return;
    list.scrollTo({
      top: list.scrollHeight,
      behavior: reduced ? "auto" : "smooth",
    });
  }, [active, step, reduced]);

  // Buffered from the moment they arrive, whether or not the cards have settled
  // yet — see the gate below.
  //
  // This effect owns the idle timers from creation to teardown: it schedules
  // them, so it clears them. Hanging that on the rAF effect below would tie it
  // to `rankStage`, which is wrong twice — that effect registers no cleanup at
  // all until `rankStage` first reaches 2, so an unmount before then (the host
  // hitting Standings inside the ~600ms the button is live before the swap
  // settles) strands both the timer and the class; and a 2 -> 0 re-rank would
  // wipe markers that should still be showing, since a marker's life is the
  // phone's last scroll, not the swap's.
  useEffect(() => {
    const off = roomStore.onColumnScroll((scorer, at) => {
      mirrorTargets.current.set(scorer, at);
      mirrorPump.current();

      /**
       * The driven marker, toggled straight on the node rather than through
       * a class in the render tree — same reason as the scroll itself, and it
       * keeps the whole mirror out of React.
       *
       * Safe against a re-render: `WordList` renders a constant
       * `className="word-list"`, so React's diff finds no change and never
       * rewrites the attribute. A `viewNonce` remount does drop it, which is
       * correct — that is a fresh screen.
       */
      const box = lists.current.get(scorer);
      if (!box) return;
      box.classList.add("word-list--driven");
      const prev = mirrorIdle.current.get(scorer);
      if (prev !== undefined) clearTimeout(prev);
      mirrorIdle.current.set(
        scorer,
        setTimeout(() => box.classList.remove("word-list--driven"), MIRROR_IDLE),
      );
    });
    return () => {
      off();
      for (const [id, timer] of mirrorIdle.current) {
        clearTimeout(timer);
        // Clearing a timer cancels the callback that would have taken the class
        // off, so drop it here too.
        lists.current.get(id)?.classList.remove("word-list--driven");
      }
      mirrorIdle.current.clear();
    };
  }, []);

  /**
   * The mirror engages only once the cards are settled in final order.
   *
   * Between the reveal running out and `rankStage === 2` the TV is finishing
   * the last column's own auto-scroll and then flying the measured swap, and a
   * mirror fighting either would read as a bug. The phones start sending
   * earlier on purpose: **buffering rather than dropping** is what makes the
   * gap invisible, so a player who scrolls during the swap and then stops still
   * sees the TV arrive where they left it with no second gesture.
   *
   * One rAF loop for the whole grid, started on demand and stopping the moment
   * every column has arrived — not one loop per column, and not a loop left
   * spinning on an idle results screen.
   */
  useEffect(() => {
    if (rankStage !== 2) return;
    let frame = 0;

    const advance = () => {
      frame = 0;
      let busy = false;
      for (const [id, at] of mirrorTargets.current) {
        const box = lists.current.get(id);
        if (!box) continue;
        const range = box.scrollHeight - box.clientHeight;
        // Nothing to scroll: the phone would not have sent, but a column can
        // also be shorter here than there.
        if (range <= 0) continue;
        const delta = at * range - box.scrollTop;
        if (Math.abs(delta) < 0.5) {
          box.scrollTop = at * range;
          continue;
        }
        // Reduced motion has no easing to do and lands on the first frame.
        const before = box.scrollTop;
        box.scrollTop += reduced ? delta : delta * MIRROR_EASE;
        // Keep going only while the column is *actually moving*. `range` comes
        // from `scrollHeight`/`clientHeight`, which the CSSOM rounds to
        // integers, but assigning `scrollTop` clamps against the true
        // fractional maximum — so `at * range` can name a position a pixel
        // past anywhere the box can reach. Looping on remaining distance would
        // then never converge: the write clamps, nothing moves, and the next
        // frame computes the same delta forever, at 60fps, forcing a layout
        // per column per frame with nothing on screen to show for it.
        if (box.scrollTop !== before) busy = true;
      }
      if (busy) frame = requestAnimationFrame(advance);
    };

    const kick = () => {
      if (frame === 0) frame = requestAnimationFrame(advance);
    };
    mirrorPump.current = kick;
    // Whatever arrived while the swap was still flying.
    kick();

    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      mirrorPump.current = () => {};
    };
  }, [rankStage, reduced]);

  const results_ = useMarquee<HTMLDivElement>([step, phase, rankStage, marks]);

  const teams = results.scorers.some((s) => s.colorIndex !== null);
  const emojiOf = (id: string) => room.players.find((p) => p.id === id)?.emoji ?? "";
  // A team has no emoji of its own, so it identifies itself by name in the
  // "somebody else had this too" trail.
  const labelFor = (id: string) => {
    const s = byId.get(id);
    if (!s) return "?";
    return s.colorIndex === null ? s.emoji : ` ${s.name}`;
  };

  // Asks the server rather than jumping locally: the phones are watching the
  // same reveal, and a skip the TV kept to itself would leave them crawling
  // through lines the room has already seen. The round trip is one hop.
  const skip = () => {
    if (phase !== "deal" && phase !== "reveal") return;
    roomStore.send({ type: "fastForward" });
  };

  // Reduced motion renders the settled end state on first paint, which includes
  // the cards already sitting in final order rather than translated into it.
  const slots = reduced ? finalIds : dealOrder;

  return (
    <main className="screen screen--host host-scoring">
      {/* The chip leads, as it does on every other host screen — the join
          instruction is the one thing on a TV that has to be in the same
          corner every time, so the screen's own title takes the far end. */}
      <HostHeader
        left={<RoomChip code={room.code} />}
        round={round}
        of={room.settings.roundCount}
        right={<h1 className="host-scoring__title">Results · {room.category}</h1>}
      />

      <div
        className="results"
        ref={results_}
        style={{ "--cols": columnsFor(slots.length) } as CSSProperties}
      >
        {slots.map((id, slot) => {
          const scorer = byId.get(id);
          if (!scorer) return null;
          const card = cardView(schedule, scorer, step, marks);
          const direction = uniqueDirection(schedule, card, startedAt);
          const cue = cueStep(schedule, id);
          const rank = ranks[id];
          const medal = rank <= MEDALS.length ? MEDALS[rank - 1] : null;
          const flight = travel[id];

          const col = ["result-col"];
          if (phase === "deal") col.push("result-col--deal");
          if (phase === "reveal" && cue !== null && step === cue) col.push("result-col--cue");
          if (active === id) col.push("result-col--live");
          // A/B off the swap ordinal, so a re-rank is a different animation-name
          // and therefore actually plays. See `swapGen`.
          if (rankStage >= 1) col.push(`result-col--swapped-${parity(swapGen)}`);
          if (rankStage === 1) col.push("result-col--flight");

          const face = ["card", "result-card"];
          if (scorer.colorIndex !== null) face.push("result-card--team");
          if (active === id) face.push("result-card--live");
          if (card.flinchCount > 0) face.push(`result-card--hit-${parity(card.flinchCount)}`);
          // The ring for a word its own scorer just disowned, or took back.
          const selfRing = selfMarkCardClass(card);
          if (selfRing !== "") face.push(selfRing.trim());
          if (phase === "ack") face.push("result-card--ack");
          if (rankStage === 2 && medal) face.push(`result-card--${medal}`);

          const reveal = (index: number): RowReveal | null => {
            const row = rowView(schedule, id, index, step, marks);
            if (!row.revealed) return null;
            return {
              // A word its own scorer disowned reads the same as one another
              // column took: it lost. Only the phone that struck it can undo it.
              struck: row.struck || row.selfStruck,
              strikeDelayMs: row.backCheck ? 0 : REVEAL_TIMING.STRIKE_HOLD,
              alsoShown: row.alsoShown,
              pop: row.popCount === 0 ? null : parity(row.popCount),
              selfMark: selfMarkClass(row),
            };
          };

          return (
            <section
              className={col.join(" ")}
              key={id}
              ref={(el) => {
                columns.current.set(id, el);
              }}
              style={
                {
                  "--deal-rank": slot,
                  "--travel-x": `${flight ? flight.x : 0}px`,
                  "--travel-y": `${flight ? flight.y : 0}px`,
                  // The X travel trails the Y travel only when the card is
                  // changing rows — vertical first is what stops an eight-player
                  // two-row swap reading as a shuffle.
                  "--swap-x-delay": `${flight && flight.y !== 0 ? SWAP_X_DELAY : 0}ms`,
                  "--swap-dur": `${SWAP_DURATION / speed}ms`,
                } as CSSProperties
              }
            >
              {/* One card per player, not two: merging the identity block and
                  the word list behind a hairline buys back a border pair, a
                  shadow and a gap — around 30px of vertical, which is what
                  makes the six-to-ten player two-row layout readable. It is
                  also what lets the penalty ring cover the whole reaction
                  rather than half a card flinching. */}
              <div className={face.join(" ")}>
                {/* An overlay child, never the card itself: on `.card` the ring
                    would fight the hard offset shadow. */}
                <span className="card__penalty" aria-hidden="true" />

                {/* A team is named by its tab, exactly as it was in team select
                    and on the phones — so the line below drops the swatch and
                    the name it would otherwise repeat. */}
                {scorer.colorIndex !== null && (
                  <TeamBadge
                    name={scorer.name}
                    colorIndex={scorer.colorIndex}
                    className="team-badge--sm"
                  />
                )}

                {rankStage === 2 && medal && (
                  <span className={`medal-plaque medal-plaque--${medal}`}>
                    {PLACES[rank - 1]}
                  </span>
                )}

                <div className="id-card__head">
                  {scorer.colorIndex === null ? (
                    // The name gets a full-width line of its own. Sharing one
                    // row with RANK and both stat pairs collides for any name
                    // over about five characters inside a 240px track.
                    <div className="id-card__line">
                      <span className="id-card__avatar">{scorer.emoji}</span>
                      <span className="id-card__name" data-marquee="">
                        <span className="marquee">{scorer.name}</span>
                      </span>
                    </div>
                  ) : (
                    // Who the team is — the round and the match both score the
                    // team, so this is the only place a player's own face
                    // appears on the results screen.
                    <div className="id-card__members">
                      {scorer.members.map((member) => (
                        <span key={member}>{emojiOf(member)}</span>
                      ))}
                    </div>
                  )}

                  <div className="id-card__foot">
                    {/* Deal order is not rank. A placeholder number would be
                        read as a standing, and hiding the line would shift the
                        row's height when the real one arrives. */}
                    <span className="id-card__meta">
                      {rankStage >= 1 ? `RANK ${rank}` : "—"}
                    </span>
                    <div className="id-card__stats">
                      <div className="stat">
                        {/* Keyed on the strike count, which remounts the
                            element on every strike and so restarts the blink
                            unconditionally. A class alternated by parity — what
                            the card's own dip has to use, since remounting a
                            card would drop its scroll position and its
                            measured rect — cannot survive two strikes landing
                            an even number of steps apart: the class string is
                            unchanged, the animation never re-fires, and the
                            count silently drops with no flash at all. */}
                        <span
                          key={`${card.strikeCount}:${card.selfMarkCount}`}
                          className={
                            "stat__num stat__num--unique" +
                            (direction === "up"
                              ? " stat__num--flash-up"
                              : direction === "down"
                                ? " stat__num--flash"
                                : "")
                          }
                        >
                          {/* Nothing is revealed yet, so there is no
                              provisional score. It resolves to TOTAL as the
                              reveal opens and only ever counts down. */}
                          {phase === "deal" ? "—" : card.unique}
                        </span>
                        <span className="stat__label">UNIQUE</span>
                      </div>
                      <div className="stat">
                        <span className="stat__num">{scorer.total}</span>
                        <span className="stat__label">TOTAL</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="result-card__rule" />

                {/* The list scrolls inside its card; the grid around it never
                    grows, so the footer button stays on screen. */}
                <WordList
                  entries={scorer.entries}
                  size={15}
                  empty="Nothing written."
                  labelFor={labelFor}
                  authorFor={teams ? emojiOf : undefined}
                  reveal={reveal}
                  pending={phase === "deal"}
                  listRef={(el) => {
                    lists.current.set(id, el);
                  }}
                />
              </div>
            </section>
          );
        })}
      </div>

      {/* Fixed height and its own positioning context, so swapping the two
          buttons never reflows the grid above it. */}
      <div className="host-scoring__footer">
        {(footer === "ff" || footer === "out") && (
          <button
            type="button"
            className={`btn-ff${footer === "out" ? " btn-ff--out" : ""}`}
            onClick={skip}
          >
            Fast forward
          </button>
        )}
        {(footer === "entering" || footer === "ready") && (
          <button
            type="button"
            className={`btn host-scoring__go${footer === "entering" ? " host-scoring__go--entering" : ""}`}
            onClick={() => roomStore.send({ type: "showStandings" })}
          >
            Standings
          </button>
        )}
      </div>
    </main>
  );
}
