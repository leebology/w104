import { MAX_TEAM_COUNT, MIN_TEAM_COUNT } from "./gamemodes";

export type TeamId = string;

export type Team = {
  id: TeamId;
  /**
   * Index into TEAM_COLORS. Fixed at creation and never written again:
   * renaming a team must not recolour it, and the colour is what players
   * actually navigate by across the room.
   */
  colorIndex: number;
  name: string;
};

/** Matches the server's MAX_NAME_LEN for players. */
export const MAX_TEAM_NAME_LEN = 20;

/**
 * One accent per possible team. `token` names a CSS custom property rather
 * than carrying a hex value — `src/style.css` owns the actual colour, and
 * `shared/` must not know about DOM styling.
 */
export const TEAM_COLORS = [
  { token: "--team-red", name: "Red" },
  { token: "--team-blue", name: "Blue" },
  { token: "--team-green", name: "Green" },
  { token: "--team-yellow", name: "Yellow" },
  { token: "--team-purple", name: "Purple" },
  { token: "--team-orange", name: "Orange" },
  { token: "--team-pink", name: "Pink" },
  { token: "--team-teal", name: "Teal" },
  { token: "--team-lime", name: "Lime" },
  { token: "--team-cyan", name: "Cyan" },
] as const;

/**
 * `count` fresh teams, team i taking TEAM_COLORS[i]. Ids are index-derived so
 * they are stable, readable in a JSON dump, and need no id generator.
 *
 * A count under MIN_TEAM_COUNT yields no teams at all rather than one: the
 * caller has already decided teams are on, and "one team" is not a match.
 */
export function makeTeams(count: number): Team[] {
  if (count < MIN_TEAM_COUNT) return [];
  const n = Math.min(count, MAX_TEAM_COUNT);
  return Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    colorIndex: i,
    name: TEAM_COLORS[i].name,
  }));
}
