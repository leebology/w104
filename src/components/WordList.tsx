import type { CSSProperties, Ref } from "react";
import type { ScoredEntry } from "../../shared/scoring";
import type { PlayerId } from "../../shared/state";
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
};

type Props = {
  entries: ScoredEntry[];
  /** Entry size in px; the attribution emoji trail 3px behind it. */
  size?: number;
  empty?: string;
  /** Short label for another scorer that also had the word. */
  labelFor: (id: ScorerId) => string;
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
  reveal, pending, listRef,
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
        const word =
          `word word--clip${struck ? " word--struck" : ""}` +
          (row && struck ? " word--striking" : "");

        return (
          <div className="word-row" key={`${entry.text}-${i}`}>
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
                <span className="marquee">{alsoShown.map(labelFor).join("")}</span>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
