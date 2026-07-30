import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { prefersReducedMotion, useRevealStep } from "../../reveal";
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
} from "../../../shared/reveal";
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

/**
 * Alternating class suffix. See RowReveal.pop for why every flash needs one.
 *
 * Fed an *ordinal* — how many strikes or trail arrivals there have been — never
 * a step number. Two strikes two steps apart share a step parity, so the class
 * string would not change and the flash would simply be skipped.
 */
function parity(ordinal: number): "a" | "b" {
  return ordinal % 2 === 1 ? "a" : "b";
}

type Props = {
  room: RoomState;
  results: Results;
  /** Server time the reveal began; every client counts its lines from here. */
  startedAt: number;
  skipped: boolean;
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
export function HostScoring({ room, results, startedAt, skipped }: Props) {
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
  const finalIds = useMemo(() => finalOrder(results.scorers).map((s) => s.id), [results]);
  const ranks = useMemo(() => finalRanks(results.scorers), [results]);
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

  const columns = useRef(new Map<ScorerId, HTMLElement | null>());
  const lists = useRef(new Map<ScorerId, HTMLDivElement | null>());
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
   * The swap is measured, not calculated: the DOM stays in deal order for the
   * whole screen's life and each column is translated to the slot its final rank
   * earns it. Measuring means the arithmetic of the grid — two rows, a short
   * last row, the 20vw cap — is never duplicated here.
   */
  useEffect(() => {
    if (phase !== "rank" || reduced) return;
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
    const id = setTimeout(
      () => setRankStage(2),
      (SWAP_X_DELAY + SWAP_DURATION) / speed,
    );
    return () => clearTimeout(id);
  }, [phase, reduced, dealOrder, finalIds, speed]);

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

  const results_ = useMarquee<HTMLDivElement>([step, phase, rankStage]);

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
          const card = cardView(schedule, scorer, step);
          const cue = cueStep(schedule, id);
          const rank = ranks[id];
          const medal = rank <= MEDALS.length ? MEDALS[rank - 1] : null;
          const flight = travel[id];

          const col = ["result-col"];
          if (phase === "deal") col.push("result-col--deal");
          if (phase === "reveal" && cue !== null && step === cue) col.push("result-col--cue");
          if (active === id) col.push("result-col--live");
          if (rankStage >= 1) col.push("result-col--swapped");
          if (rankStage === 1) col.push("result-col--flight");

          const face = ["card", "result-card"];
          if (scorer.colorIndex !== null) face.push("result-card--team");
          if (active === id) face.push("result-card--live");
          if (card.flinchCount > 0) face.push(`result-card--hit-${parity(card.flinchCount)}`);
          if (phase === "ack") face.push("result-card--ack");
          if (rankStage === 2 && medal) face.push(`result-card--${medal}`);

          const reveal = (index: number): RowReveal | null => {
            const row = rowView(schedule, id, index, step);
            if (!row.revealed) return null;
            return {
              struck: row.struck,
              strikeDelayMs: row.backCheck ? 0 : REVEAL_TIMING.STRIKE_HOLD,
              alsoShown: row.alsoShown,
              pop: row.popCount === 0 ? null : parity(row.popCount),
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
                          key={card.strikeCount}
                          className={
                            "stat__num stat__num--unique" +
                            (card.strikeCount > 0 ? " stat__num--flash" : "")
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
