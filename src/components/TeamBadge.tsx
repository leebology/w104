import type { CSSProperties } from "react";
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
 */
export function TeamBadge({ name, colorIndex, className }: Props) {
  return (
    <span
      className={className ? `team-badge ${className}` : "team-badge"}
      style={{ "--accent": `var(${TEAM_COLORS[colorIndex].token})` } as CSSProperties}
    >
      {name}
    </span>
  );
}
