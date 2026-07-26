import type { CSSProperties } from "react";
import type { ScoredEntry } from "../../shared/scoring";

type Props = {
  entries: ScoredEntry[];
  /** Entry size in px; the attribution emoji trail 3px behind it. */
  size?: number;
  empty?: string;
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
export function WordList({ entries, size = 16, empty = "No words this round." }: Props) {
  if (entries.length === 0) {
    return <div className="word-list"><p className="word-list__empty">{empty}</p></div>;
  }
  return (
    <div className="word-list" style={{ "--word-size": `${size}px` } as CSSProperties}>
      {entries.map((entry, i) => (
        <div className="word-row" key={`${entry.text}-${i}`}>
          <span className={entry.unique ? "word" : "word word--struck"}>{entry.text}</span>
          {entry.alsoBy.length > 0 && (
            <span className="word-row__also">{entry.alsoBy.join("")}</span>
          )}
        </div>
      ))}
    </div>
  );
}
