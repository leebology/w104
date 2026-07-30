import { useMemo, useState } from "react";
import { TeamBadge } from "../../components/TeamBadge";
import { WordList } from "../../components/WordList";
import type { RowReveal } from "../../components/WordList";
import { useMarquee } from "../../marquee";
import { prefersReducedMotion, useRevealStep } from "../../reveal";
import { roomStore } from "../../net/room";
import { buildSchedule, cardView, rowView, seededRng } from "../../../shared/reveal";
import { currentRound } from "../../../shared/state";
import type { PlayerId, RoomState } from "../../../shared/state";
import type { Results } from "../../../shared/scoring";

type Props = {
  room: RoomState;
  results: Results;
  playerId: PlayerId;
  /** Server time the reveal began — the TV's reveal and this one share it. */
  startedAt: number;
  skipped: boolean;
};

/** Alternating class suffix for the trail's pop. See HostScoring's `parity`. */
function parity(ordinal: number): "a" | "b" {
  return ordinal % 2 === 1 ? "a" : "b";
}

/**
 * Your own results, on your own phone — the same two cards as one host column.
 *
 * The whole list is on screen from the first frame, unlike the TV: it is your
 * list and you already know what is on it. What arrives over time is the *bad
 * news* — a word going through, the UNIQUE count dropping — and it arrives on
 * the beat the TV strikes it, because both derive their line count from the same
 * schedule and the same `scoring.startedAt`. Reading a strike here before the
 * room has seen it would give away the reveal.
 */
export function PlayerScoring({ room, results, playerId, startedAt, skipped }: Props) {
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
      }),
    [results, room.code, room.history.length],
  );
  const { step } = useRevealStep(schedule, startedAt, skipped, reduced);

  // A word too long for the phone's column clips and travels, same as on the TV.
  // Re-measured as the reveal runs: a growing emoji trail changes the room left
  // for the word beside it.
  const list = useMarquee<HTMLDivElement>([me?.entries, step]);
  const emojiOf = (id: string) => room.players.find((p) => p.id === id)?.emoji ?? "";
  // A team has no emoji of its own, so it identifies itself by name in the
  // "somebody else had this too" trail.
  const labelFor = (id: string) => {
    const s = results.scorers.find((x) => x.id === id);
    if (!s) return "?";
    return s.colorIndex === null ? s.emoji : ` ${s.name}`;
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

  const card = cardView(schedule, me, step);

  /**
   * Every row, always — `revealed` is deliberately ignored. A row the TV has not
   * reached yet reads as not-struck with no trail, which is exactly what this
   * screen should be showing.
   *
   * `strikeDelayMs` is zero throughout: the hold exists so a word on the TV
   * never *appears* pre-struck, and here the word has been on screen all along.
   */
  const reveal = (index: number): RowReveal => {
    const row = rowView(schedule, me.id, index, step);
    return {
      struck: row.struck,
      strikeDelayMs: 0,
      alsoShown: row.alsoShown,
      pop: row.popCount === 0 ? null : parity(row.popCount),
    };
  };

  return (
    <main className="screen screen--mobile screen--locked player-scoring">
      <div className={`card id-card${me.colorIndex !== null ? " id-card--team" : ""}`}>
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
                  through, blinking on each one. Keyed on the strike count for
                  the same reason the host's is — see HostScoring. */}
              <span
                key={card.strikeCount}
                className={
                  "stat__num stat__num--unique" +
                  (card.strikeCount > 0 ? " stat__num--flash" : "")
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
        />
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
