/**
 * One chip per round played, showing that round's finishing place. Gold for a
 * win, cream otherwise — the strip is the score, not decoration, so a run of
 * wins should read across a room at a glance.
 */
export function BadgeStrip({ places }: { places: number[] }) {
  if (places.length === 0) return null;
  return (
    <ol className="badge-strip">
      {places.map((place, i) => (
        <li
          className={place === 1 ? "badge badge--first" : "badge"}
          key={i}
          title={`Round ${i + 1}: ${place}`}
        >
          {place}
        </li>
      ))}
    </ol>
  );
}
