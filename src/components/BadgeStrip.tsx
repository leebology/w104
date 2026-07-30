import { ordinal } from "../ordinal";

type Props = {
  places: number[];
  /**
   * Every round's category, oldest first — `room.history` order, which is the
   * order `places` is already in. Optional because the strip is legible
   * without it; when present each chip can name the round it came from.
   */
  categories?: string[];
  /** Site modifier — `badge-strip--plinth` on the podium's narrow steps. */
  className?: string;
};

/**
 * One chip per round played, showing that round's finishing place. Gold for a
 * win, cream otherwise — the strip is the score, not decoration, so a run of
 * wins should read across a room at a glance.
 *
 * The chips are also the only place the golf sum is itemised: they add up to
 * the row's points, which is what makes a low total legible as a *good* one.
 */
export function BadgeStrip({ places, categories, className }: Props) {
  if (places.length === 0) return null;
  return (
    <ol className={className ? `badge-strip ${className}` : "badge-strip"}>
      {places.map((place, i) => (
        <li
          className={place === 1 ? "badge badge--first" : "badge"}
          key={i}
          title={
            categories?.[i]
              ? `Round ${i + 1} · ${categories[i]}: ${ordinal(place)}`
              : `Round ${i + 1}: ${ordinal(place)}`
          }
        >
          {place}
        </li>
      ))}
    </ol>
  );
}
