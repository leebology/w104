import { useEffect, useMemo, useRef, useState } from "react";
import { TeamBadge } from "../../components/TeamBadge";
import { WordList, scorerMark } from "../../components/WordList";
import type { RowReveal } from "../../components/WordList";
import { useMarquee } from "../../marquee";
import {
  parity,
  prefersReducedMotion,
  selfMarkCardClass,
  selfMarkClass,
  useRevealStep,
} from "../../reveal";
import { roomStore } from "../../net/room";
import {
  buildSchedule,
  cardView,
  rowView,
  seededRng,
  uniqueDirection,
} from "../../../shared/reveal";
import { driverOf, scrollFraction } from "../../../shared/mirror";
import type { SelfMarks } from "../../../shared/selfstrike";
import { currentRound } from "../../../shared/state";
import type { PlayerId, RoomState } from "../../../shared/state";
import type { Results } from "../../../shared/scoring";

/**
 * The mirror's send rate: a trailing send every `MIRROR_INTERVAL` while the
 * finger moves, plus one `MIRROR_SETTLE` after it stops.
 *
 * The settle send is what guarantees the TV ends up exactly where the finger
 * did rather than up to one interval short of it.
 *
 * The interval is chosen rather than assumed. Every message wakes the
 * hibernating Durable Object and counts against `doRequestsPerDay`, which is
 * 100,000/day *account-wide* and shared between staging and production
 * (`shared/usage.ts`). At 100ms the mirror alone would be roughly 2,000
 * messages a match and about fifty matches a day; at 250ms it is roughly 800
 * and about 125 matches a day, and the host's easing (see `HostScoring`)
 * closes the visual gap.
 */
const MIRROR_INTERVAL = 250;
const MIRROR_SETTLE = 150;

type Props = {
  room: RoomState;
  results: Results;
  playerId: PlayerId;
  /** Server time the reveal began — the TV's reveal and this one share it. */
  startedAt: number;
  skipped: boolean;
  /** Words disowned by hand, this room over. See shared/selfstrike.ts. */
  marks: SelfMarks;
};

/**
 * Your own results, on your own phone — the same two cards as one host column.
 *
 * The whole list is on screen from the first frame, unlike the TV: it is your
 * list and you already know what is on it. What arrives over time is the *bad
 * news* — a word going through, the UNIQUE count dropping — and it arrives on
 * the beat the TV strikes it, because both derive their line count from the same
 * schedule and the same `scoring.startedAt`. Reading a strike here before the
 * room has seen it would give away the reveal.
 *
 * It is also the one screen where a player can *change* the round: tapping a word
 * that scored disowns it, and tapping it again takes it back. That is a request
 * like any other — the mark lives on the room's scoring phase, so the TV crosses
 * the word out too and the banked standings agree with what the room was shown.
 */
export function PlayerScoring({
  room, results, playerId, startedAt, skipped, marks,
}: Props) {
  const me = results.scorers.find((s) => s.members.includes(playerId));
  const [reduced] = useState(prefersReducedMotion);

  // The identical arguments HostScoring builds with. The two schedules must not
  // drift: this screen's strikes are timed against the TV's.
  const schedule = useMemo(
    () =>
      buildSchedule(results, {
        playerOrder: "shortest",
        lineOrder: "entry",
        rng: seededRng(`${room.code}:${currentRound(room)}:reveal`),
        lineMs: room.revealLineMs,
      }),
    [results, room.code, room.history.length, room.revealLineMs],
  );
  const { step } = useRevealStep(schedule, startedAt, skipped, reduced);

  /** The scroll box itself, not the card around it. */
  const listBox = useRef<HTMLDivElement | null>(null);
  const sentAt = useRef(0);
  const lastSent = useRef<number | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * The mirror drives this phone's own column on the TV — but only once the
   * reveal has run out.
   *
   * Until then the TV is still following its own newest revealed line, and its
   * column holds *only revealed rows* while this screen has shown the whole
   * list since the first frame: the row under a finger here may not exist there
   * yet. `step >= lastStep` is the same instant on every device, because both
   * screens count it off the same `scoring.startedAt` against the same
   * schedule, and a FAST FORWARD lands it on all of them together.
   *
   * The TV holds what arrives and starts applying at its own later gate — see
   * `HostScoring`. That gap is deliberate and is why this side does not wait
   * for it.
   *
   * A team shares one column, so only one member's scroll can drive it.
   * `party/server.ts` already enforces that and stays the security boundary,
   * but checking `driverOf` here too means the rest of the team never sends
   * at all: without it every teammate would tick the Durable Object at 4Hz
   * for a message the server was always going to drop. `me` is guarded
   * against `undefined` because the "not in this round" return happens later
   * in this function, below where `mirroring` is used.
   */
  const mirroring =
    me !== undefined &&
    step >= schedule.lastStep &&
    driverOf(room, me.id) === playerId;

  useEffect(() => {
    const box = listBox.current;
    if (!box || !mirroring) return;

    const push = () => {
      const at = scrollFraction(box.scrollTop, box.scrollHeight, box.clientHeight);
      // Null is a list shorter than its box: no position to mirror, so nothing
      // is sent at all. An unchanged rounded value is the free dedupe the
      // three-decimal quantization buys.
      if (at === null || at === lastSent.current) return;
      lastSent.current = at;
      sentAt.current = Date.now();
      roomStore.send({ type: "scrollTo", at });
    };

    const onScroll = () => {
      if (Date.now() - sentAt.current >= MIRROR_INTERVAL) push();
      if (settleTimer.current !== null) clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(push, MIRROR_SETTLE);
    };

    box.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      box.removeEventListener("scroll", onScroll);
      if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    };
  }, [mirroring]);

  // A word too long for the phone's column clips and travels, same as on the TV.
  // Re-measured on a manual mark as well: a word losing its bold weight is a
  // word that may now fit.
  const list = useMarquee<HTMLDivElement>([me?.entries, step, marks]);
  const emojiOf = (id: string) => room.players.find((p) => p.id === id)?.emoji ?? "";
  // Exactly the trail the TV draws — a face, or the team's swatch. The two must
  // agree: the room is looking at both copies of the same word.
  const labelFor = (id: string) => {
    const s = results.scorers.find((x) => x.id === id);
    return s ? scorerMark(s) : "?";
  };
  const ready = room.players.find((p) => p.id === playerId)?.ready ?? false;

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

  const card = cardView(schedule, me, step, marks);
  const direction = uniqueDirection(schedule, card, startedAt);

  /**
   * Every row, always — `revealed` is deliberately ignored. A row the TV has not
   * reached yet reads as not-struck with no trail, which is exactly what this
   * screen should be showing.
   *
   * `strikeDelayMs` is zero throughout: the hold exists so a word on the TV
   * never *appears* pre-struck, and here the word has been on screen all along.
   */
  const reveal = (index: number): RowReveal => {
    const row = rowView(schedule, me.id, index, step, marks);
    return {
      // The two strikes look the same and only one of them is yours to undo.
      struck: row.struck || row.selfStruck,
      strikeDelayMs: 0,
      alsoShown: row.alsoShown,
      pop: row.popCount === 0 ? null : parity(row.popCount),
      selfMark: selfMarkClass(row),
    };
  };

  return (
    <main className="screen screen--mobile screen--locked player-scoring">
      <div
        className={
          `card id-card${me.colorIndex !== null ? " id-card--team" : ""}` +
          selfMarkCardClass(card)
        }
      >
        {/* The same feathered ring the TV's card takes, and the same overlay
            child rather than the card itself — on `.card` it would fight the
            hard offset shadow. Red for a word disowned, green for one taken
            back. */}
        <span className="card__penalty" aria-hidden="true" />

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
              {/* Opens at TOTAL and counts down as the TV strikes words
                  through, blinking on each one. Keyed on the count of things
                  that have moved it — revealed strikes plus manual marks — for
                  the same reason the host's is, see HostScoring.

                  The green blink is the one the round cannot cause: only taking
                  a word back moves this number up. */}
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
                {card.unique}
              </span>
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

      <div className="card list-card" ref={list}>
        <WordList
          entries={me.entries}
          size={19}
          labelFor={labelFor}
          authorFor={me.colorIndex !== null ? emojiOf : undefined}
          reveal={reveal}
          listRef={listBox}
          // The request is fire-and-forget, like every other client action: the
          // struck state comes back in the next `state` push, so there is no
          // optimistic copy to reconcile. A round trip is one hop and nothing
          // here is racing a timer.
          onSelfStrike={(index) =>
            roomStore.send({
              type: "selfStrike",
              index,
              struck: !rowView(schedule, me.id, index, step, marks).selfStruck,
            })
          }
        />
        {/* Said once, quietly, under the list. Without it the only clue that a
            word can be tapped is that it happens to be tappable. */}
        <p className="list-card__hint">Tap a word to cross it out</p>
      </div>

      <div className="player-scoring__footer">
        {/* The same mechanic as the lobby and standings: everyone ready moves
            the room on with no host action. The host's Standings button still
            works, and still overrides a room that is only half ready. */}
        <button
          type="button"
          className={ready ? "btn btn--secondary btn--block" : "btn btn--block"}
          onClick={() => roomStore.send({ type: "ready", ready: !ready })}
        >
          {ready ? "Not ready" : "Ready up"}
        </button>
      </div>
    </main>
  );
}
