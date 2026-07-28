import { MAX_TEAM_COUNT, MIN_TEAM_COUNT, modeSpec } from "./gamemodes";
import type { MatchSettings, Player, PlayerId, Room } from "./state";

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

/** The fields the team derivations read. A subset, so they work on a
 *  server-side `Room` and a client-side `RoomState` alike. */
export type TeamView = Pick<Room, "players" | "teams">;

/**
 * Whether this match is played in teams.
 *
 * The descriptor check is not belt-and-braces: settings are validated against
 * the *active mode's* descriptors and never against a field's mere existence,
 * so a `teamCount` left over from a mode that exposed it must not switch teams
 * on under a mode that does not.
 */
export function teamsEnabled(settings: MatchSettings): boolean {
  if (settings.teamCount < MIN_TEAM_COUNT) return false;
  return modeSpec(settings.mode).settings.some((s) => s.key === "teamCount");
}

export function teamOf(view: TeamView, playerId: PlayerId): Team | undefined {
  const player = view.players.find((p) => p.id === playerId);
  if (!player || player.teamId === null) return undefined;
  return view.teams.find((t) => t.id === player.teamId);
}

/** Derived, never stored. Preserves `players` order. */
export function membersOf(view: TeamView, teamId: TeamId): Player[] {
  return view.players.filter((p) => p.teamId === teamId);
}

/**
 * Places every player who never picked a team into the team with the fewest
 * members, ties breaking by lowest colour index. Assignments are applied one
 * at a time, so two stragglers land on two different teams rather than both
 * on the same smallest one.
 *
 * A `teamId` that names no live team counts as unassigned rather than being
 * left dangling.
 *
 * Returns the identical array when nothing changed, per the no-op rule.
 */
export function assignStragglers(players: Player[], teams: Team[]): Player[] {
  if (teams.length === 0) return players;
  const live = new Set(teams.map((t) => t.id));
  const assigned = (p: Player) => p.teamId !== null && live.has(p.teamId);
  if (players.every(assigned)) return players;

  const counts = new Map<TeamId, number>(teams.map((t) => [t.id, 0]));
  for (const p of players) {
    if (assigned(p)) counts.set(p.teamId!, counts.get(p.teamId!)! + 1);
  }

  return players.map((p) => {
    if (assigned(p)) return p;
    // `teams` is already in colour-index order, so keeping the first strict
    // minimum gives the lowest-index tie-break for free.
    let best = teams[0];
    for (const t of teams) {
      if (counts.get(t.id)! < counts.get(best.id)!) best = t;
    }
    counts.set(best.id, counts.get(best.id)! + 1);
    return { ...p, teamId: best.id };
  });
}
