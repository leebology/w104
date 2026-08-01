import { MAX_TEAM_COUNT, MIN_TEAM_COUNT, modeSpec } from "./gamemodes";
import { seededRng } from "./rng";
import type { MatchSettings, Player, PlayerId, Room } from "./state";
import { inWaitingRoom, isSeated } from "./waiting";

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
 *
 * The order is the palette: team i takes entry i, so the first five teams —
 * by far the common case — get the five most separated hues. The last two
 * slots are the ones that had to give way to the poster palette: there is no
 * second teal (it would collide with `--teal`, the timer fill and the "OK,"
 * plaque) and no second red-pink (it would vanish into the `--pink` field).
 * Brown is the tenth because it is the only remaining hue that survives both.
 */
export const TEAM_COLORS = [
  { token: "--team-red", name: "Red" },
  { token: "--team-blue", name: "Blue" },
  { token: "--team-green", name: "Green" },
  { token: "--team-yellow", name: "Yellow" },
  { token: "--team-purple", name: "Purple" },
  { token: "--team-orange", name: "Orange" },
  { token: "--team-pink", name: "Pink" },
  { token: "--team-cyan", name: "Cyan" },
  { token: "--team-lime", name: "Lime" },
  { token: "--team-brown", name: "Brown" },
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
 * Whether somebody has this team's name open in the editor right now.
 *
 * Connected members only, the same population `settle` holds the countdown
 * for — a flag stranded on a locked phone holds nothing, so it must not be
 * drawn on the TV either. Derived here rather than in the two screens that
 * show it, so the tag and the hold can never disagree about who is typing.
 */
export function isBeingNamed(view: TeamView, teamId: TeamId): boolean {
  return view.players.some(
    (p) => p.teamId === teamId && p.connected && p.naming === true,
  );
}

/** A PlayerId or a TeamId — whichever owns the word list being scored. */
export type ScorerId = string;

/**
 * Whoever owns a word list. One per player when teams are off, one per
 * non-empty team when they are on. Everything downstream of the round —
 * scoring, placement, standings — works on this rather than on `Player`, so
 * teams need no parallel code path.
 */
export type Scorer = {
  id: ScorerId;
  name: string;
  /** The player's emoji; "" for a team, which is identified by its colour. */
  emoji: string;
  /** The team's accent; null for a player. */
  colorIndex: number | null;
  /** [self] for a player; the roster for a team. */
  members: PlayerId[];
};

/**
 * This match's scorers. **The one place the "empty teams do not score" rule
 * is enforced** — no render or scoring site has to remember it.
 *
 * **And the one place the waiting room is kept out of the match**, which is the
 * same kind of rule and so lives in the same place. Everything downstream is
 * then correct without knowing the waiting room exists: no column in the
 * reveal, no place in the round, no row on the standings board, no claim on a
 * mirrored column, no words in the archive. A team whose only member is waiting
 * is left empty by the filter and dropped by the rule below it.
 *
 * `membersOf` is deliberately *not* filtered — it is display truth, and the
 * team tiles want to show a latecomer who has picked.
 */
export function rosterOf(
  view: TeamView & Pick<Room, "settings">,
): Scorer[] {
  if (!teamsEnabled(view.settings)) {
    return view.players.filter(isSeated).map((p) => ({
      id: p.id,
      name: p.name,
      emoji: p.emoji,
      colorIndex: null,
      members: [p.id],
    }));
  }
  return view.teams
    .map((t) => ({
      id: t.id,
      name: t.name,
      emoji: "",
      colorIndex: t.colorIndex,
      members: membersOf(view, t.id).filter(isSeated).map((p) => p.id),
    }))
    .filter((s) => s.members.length > 0);
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
 * **The waiting room is never placed.** Admission requires a team the latecomer
 * chose (see `admitWaiting` in `shared/reduce.ts`), and a placement they never
 * made is not one they can be held to — so this leaves them exactly where they
 * are, whether that is on a team or on none. They still *count* toward team
 * sizes once they have picked one, because they will be on it next round and
 * the point of this function is an even split.
 *
 * Returns the identical array when nothing changed, per the no-op rule.
 */
export function assignStragglers(players: Player[], teams: Team[]): Player[] {
  if (teams.length === 0) return players;
  const live = new Set(teams.map((t) => t.id));
  const onTeam = (p: Player) => p.teamId !== null && live.has(p.teamId);
  const needsTeam = (p: Player) => isSeated(p) && !onTeam(p);
  if (!players.some(needsTeam)) return players;

  const counts = new Map<TeamId, number>(teams.map((t) => [t.id, 0]));
  for (const p of players) {
    if (onTeam(p)) counts.set(p.teamId!, counts.get(p.teamId!)! + 1);
  }

  return players.map((p) => {
    if (!needsTeam(p)) return p;
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

/**
 * The host's "Auto sort" button: deal **everybody** out again, at random,
 * across teams of as equal a size as the roster allows.
 *
 * One job, not two. It used to leave anyone already on a team where they were
 * and only place the stragglers, which meant the button could not fix the case
 * it was most often pressed for — six people who all piled onto Red. Everyone
 * is dealt, including the ones who chose, and including the bots, which are
 * seats in every layout this screen is used to look at.
 *
 * `roll` is a uniform [0,1) from the caller, exactly as the category draw takes
 * one: the shuffle has to be *random* — a deterministic round-robin makes a
 * second press a no-op, and the host pressing again wants a different answer —
 * while this function stays pure and testable against a fixed roll.
 *
 * Order out is order in. Only `teamId` moves, so the roster's own order — which
 * every other screen derives a stable member list from — is untouched.
 *
 * **The waiting room is not dealt.** This is the host re-dealing *the match*,
 * and the match does not include somebody who is not in it yet; their team is
 * theirs to pick, for the reason `assignStragglers` leaves them alone too.
 *
 * Returns the identical array when nothing changes, per the no-op rule.
 */
export function balanceTeams(players: Player[], teams: Team[], roll: number): Player[] {
  if (teams.length === 0 || players.length === 0) return players;

  const rng = seededRng(`balance:${roll}`);
  // Deal positions, not players: `order[i]` is the index in `players` of the
  // i-th person dealt. Assigning round-robin over a shuffled order is what
  // makes the split even *and* the pairing arbitrary — shuffling the teams
  // instead would only rename an even split, and shuffling the assignment
  // itself would let one team come out three larger.
  const order = players.map((_, i) => i).filter((i) => !inWaitingRoom(players[i]));
  if (order.length === 0) return players;
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  const next = [...players];
  let changed = false;
  order.forEach((index, dealt) => {
    const team = teams[dealt % teams.length];
    if (next[index].teamId === team.id) return;
    next[index] = { ...next[index], teamId: team.id };
    changed = true;
  });
  return changed ? next : players;
}
