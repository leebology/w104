import type { CSSProperties } from "react";
import { useMarquee } from "../marquee";
import { TEAM_COLORS } from "../../shared/teams";

type Props = {
  name: string;
  colorIndex: number;
  /** Site modifier — `team-badge--sm` on the phone-sized surfaces. */
  className?: string;
};

/**
 * A team's name worn as a tilted tab in its own colour, overhanging the
 * top-left corner of whatever card it names. This is the one way a team
 * identifies itself anywhere in the app — team select, the round, the
 * results — so it is a component rather than a rule each screen re-derives.
 *
 * It sets `--accent` itself instead of inheriting it from the card, so a
 * badge is correct wherever it is dropped; the cards that need the colour
 * for something else still set their own.
 *
 * The name is live and the colour is not: renaming must never recolour a
 * team, because the colour is what the room is actually navigating by.
 *
 * The badge sizes itself to its name up to the width of the card it names, and
 * a name longer than that clips and travels rather than ellipsing — so the tab
 * is its own clip box, with the name as the single run inside it.
 */
export function TeamBadge({ name, colorIndex, className }: Props) {
  const badge = useMarquee<HTMLSpanElement>([name]);
  return (
    <span
      ref={badge}
      data-marquee=""
      className={className ? `team-badge ${className}` : "team-badge"}
      style={{ "--accent": `var(${TEAM_COLORS[colorIndex].token})` } as CSSProperties}
    >
      <span className="marquee">{name}</span>
    </span>
  );
}
