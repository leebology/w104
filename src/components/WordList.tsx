import { Fragment } from "react";
import type { CSSProperties, ReactNode, Ref } from "react";
import type { ScoredEntry } from "../../shared/scoring";
import type { PlayerId } from "../../shared/state";
import { TEAM_COLORS } from "../../shared/teams";
import type { ScorerId } from "../../shared/teams";

/**
 * One row's state during the host's reveal. Absent, the list is static and every
 * row is drawn from `entry.unique` — which is what a player's own phone shows.
 */
export type RowReveal = {
  struck: boolean;
  /**
   * How long the word holds in plain ink before the strike draws through it. A
   * word never appears pre-struck: this is the row-enter duration on the line's
   * own reveal, and zero on a back-check, where the row is already on screen.
   */
  strikeDelayMs: number;
  /** The scorers already revealed to have had this word too. */
  alsoShown: ScorerId[];
  /**
   * Alternating parity for the trail's pop. An identical animation string does
   * not restart, so a trail growing on consecutive lines would otherwise
   * coalesce and read as a deliberate cooldown.
   */
  pop: "a" | "b" | null;
  /**
   * Self-validation, as one class suffix: the row's last manual mark and an
   * alternating parity so two taps in a row both fire. `strike-*` draws the red
   * line through, `restore-*` takes it back in green. Null when the row has
   * never been marked — which is every row on the host's screen and most rows on
   * the player's.
   */
  selfMark: "strike-a" | "strike-b" | "restore-a" | "restore-b" | null;
};

/**
 * How one scorer appears in another scorer's "somebody else had this too" trail.
 *
 * A player is their own face. A team has none, so it is a bare swatch in its own
 * accent — the colour is what the room navigates teams by all game, and it says
 * which team in less room than the name did while leaving the word beside it the
 * width it needs. Nothing rides inside the swatch: a team's list is shared, so
 * *which member* typed the duplicate is not what a struck word is asking.
 *
 * Shared by both results screens rather than written twice — the TV and the
 * phone draw the identical trail, and a trail that disagreed between them would
 * have two people looking at the same word and counting different rivals.
 */
export function scorerMark(
  scorer: { name: string; emoji: string; colorIndex: number | null },
): ReactNode {
  if (scorer.colorIndex === null) return scorer.emoji;
  return (
    <span
      className="word-row__team"
      // Set per element, exactly as `TeamBadge` does, so the swatch is correct
      // wherever it is dropped.
      style={{ "--accent": `var(${TEAM_COLORS[scorer.colorIndex].token})` } as CSSProperties}
      title={scorer.name}
    />
  );
}

type Props = {
  entries: ScoredEntry[];
  /** Entry size in px; the attribution emoji trail 3px behind it. */
  size?: number;
  empty?: string;
  /**
   * How another scorer that also had this word is shown in the trail: a face
   * for a player, a swatch in the team's colour for a team. A node rather than
   * a string because of the swatch — see `.word-row__team`.
   */
  labelFor: (id: ScorerId) => ReactNode;
  /**
   * Author label, rendered only in team play — the list is shared there, so
   * "who wrote this" is real information. Omitted, nothing is shown.
   */
  authorFor?: (id: PlayerId) => string;
  /**
   * The host reveal. Returns null for a row that has not been revealed yet,
   * which is not rendered at all. Omitted, the whole list is on screen.
   */
  reveal?: (index: number) => RowReveal | null;
  /**
   * Renders the scroll box with nothing in it. Frame 1 of the reveal, where the
   * empty-state string would lie: it means "this player wrote nothing", and the
   * lists have simply not been dealt their words yet.
   */
  pending?: boolean;
  /** The scroll box, so the revealing column can follow its newest line. */
  listRef?: Ref<HTMLDivElement>;
  /**
   * Self-validation, on a player's own list only. Given the row index when a row
   * is tapped. Wired to rows the round *scored*: a duplicate is already struck
   * and there is no point to take back, so those stay plain text with no hit
   * target at all. Omitted, the whole list is inert — which is the host's case.
   */
  onSelfStrike?: (index: number) => void;
};

/**
 * One player's scored words. The host column and the player's own phone render
 * exactly the same structure at different sizes — that repetition is the whole
 * reason this is a component.
 *
 * Plain rows, never pills or chips. A struck word is one somebody else also
 * wrote, trailed by their emoji; the strikethrough is self-explanatory and
 * needs no caption.
 *
 * Both the word and the trail are clip boxes with a single nowrap run inside,
 * so anything too long is cut off and travels. The 60/40 split between them is
 * load-bearing: without it a four-emoji trail takes the row and squeezes the
 * word — the thing being read — down to nothing. The clip box carries the pop
 * and the run carries the travel, one transform each, so the two never fight.
 * Whoever renders this owns calling `measureMarquee` over it (see src/marquee.ts).
 */
export function WordList({
  entries, size = 16, empty = "No words this round.", labelFor, authorFor,
  reveal, pending, listRef, onSelfStrike,
}: Props) {
  const style = { "--word-size": `${size}px` } as CSSProperties;

  if (pending) {
    return <div className="word-list" ref={listRef} style={style} />;
  }
  if (entries.length === 0) {
    return (
      <div className="word-list" ref={listRef} style={style}>
        <p className="word-list__empty">{empty}</p>
      </div>
    );
  }

  return (
    <div className="word-list" ref={listRef} style={style}>
      {entries.map((entry, i) => {
        const row = reveal ? reveal(i) : null;
        if (reveal && row === null) return null;

        const struck = row ? row.struck : !entry.unique;
        const alsoShown = row ? row.alsoShown : entry.alsoBy;
        // A manual mark owns the animation when it has one: `word--striking` is
        // a constant class, so a word struck by hand, taken back and struck
        // again would not re-fire it. The suffix carries its own parity.
        const word =
          `word word--clip${struck ? " word--struck" : ""}` +
          (row?.selfMark
            ? ` word--self-${row.selfMark}`
            : row && struck
              ? " word--striking"
              : "");
        // Only rows the round scored are tappable — see `onSelfStrike`.
        const tappable = onSelfStrike !== undefined && entry.alsoBy.length === 0;

        const body = (
          <>
            {authorFor && <span className="word-row__by">{authorFor(entry.by)}</span>}
            <span
              className={word}
              data-marquee=""
              style={
                row ? ({ "--strike-delay": `${row.strikeDelayMs}ms` } as CSSProperties) : undefined
              }
            >
              <span className="marquee">{entry.text}</span>
            </span>
            {alsoShown.length > 0 && (
              <span
                className={
                  "word-row__also" + (row?.pop ? ` word-row__also--pop-${row.pop}` : "")
                }
                data-marquee=""
              >
                <span className="marquee">
                  {alsoShown.map((id, k) => (
                    <Fragment key={`${id}-${k}`}>{labelFor(id)}</Fragment>
                  ))}
                </span>
              </span>
            )}
          </>
        );

        // A real button, not a tap handler on the div: this is the only control
        // on the results screen, it has to be reachable without a pointer, and
        // `aria-pressed` is what says "this word is crossed out" to a reader
        // that cannot see the line through it.
        return tappable ? (
          <button
            type="button"
            className="word-row word-row--tappable"
            key={`${entry.text}-${i}`}
            aria-pressed={struck}
            onClick={() => onSelfStrike!(i)}
          >
            {body}
          </button>
        ) : (
          <div className="word-row" key={`${entry.text}-${i}`}>{body}</div>
        );
      })}
    </div>
  );
}
