import type { CSSProperties } from "react";
import type { ScoredEntry } from "../../shared/scoring";
import type { PlayerId } from "../../shared/state";
import type { ScorerId } from "../../shared/teams";

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
};

/**
 * One player's scored words. The host column and the player's own phone render
 * exactly the same structure at different sizes — that repetition is the whole
 * reason this is a component.
 *
 * Plain rows, never pills or chips. A struck word is one somebody else also
 * wrote, trailed by their emoji; the strikethrough is self-explanatory and
 * needs no caption.
 */
export function WordList({
  entries, size = 16, empty = "No words this round.", labelFor, authorFor,
}: Props) {
  if (entries.length === 0) {
    return <div className="word-list"><p className="word-list__empty">{empty}</p></div>;
  }
  return (
    <div className="word-list" style={{ "--word-size": `${size}px` } as CSSProperties}>
      {entries.map((entry, i) => (
        <div className="word-row" key={`${entry.text}-${i}`}>
          {authorFor && <span className="word-row__by">{authorFor(entry.by)}</span>}
          <span className={entry.unique ? "word" : "word word--struck"}>{entry.text}</span>
          {entry.alsoBy.length > 0 && (
            <span className="word-row__also">{entry.alsoBy.map(labelFor).join("")}</span>
          )}
        </div>
      ))}
    </div>
  );
}
