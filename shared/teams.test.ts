import { describe, expect, test } from "vitest";
import { TEAM_COLORS, assignStragglers, balanceTeams, makeTeams, membersOf, rosterOf, teamOf, teamsEnabled } from "./teams";
import { MAX_TEAM_COUNT, MIN_TEAM_COUNT, snapTeamCount, defaultSettings } from "./gamemodes";
import { createRoom } from "./state";
import type { Player, Room } from "./state";

describe("the colour catalog", () => {
  test("has one colour per possible team", () => {
    expect(TEAM_COLORS).toHaveLength(MAX_TEAM_COUNT);
  });

  test("every token and default name is distinct", () => {
    expect(new Set(TEAM_COLORS.map((c) => c.token)).size).toBe(MAX_TEAM_COUNT);
    expect(new Set(TEAM_COLORS.map((c) => c.name)).size).toBe(MAX_TEAM_COUNT);
  });

  test("every token is a CSS custom property name", () => {
    for (const c of TEAM_COLORS) expect(c.token.startsWith("--team-")).toBe(true);
  });
});

describe("makeTeams", () => {
  test("builds n teams with index-derived ids and ascending colours", () => {
    const teams = makeTeams(3);
    expect(teams.map((t) => t.id)).toEqual(["t0", "t1", "t2"]);
    expect(teams.map((t) => t.colorIndex)).toEqual([0, 1, 2]);
  });

  test("names each team after its colour", () => {
    expect(makeTeams(2).map((t) => t.name)).toEqual([
      TEAM_COLORS[0].name,
      TEAM_COLORS[1].name,
    ]);
  });

  test("clamps to the catalog rather than running off the end", () => {
    expect(makeTeams(MAX_TEAM_COUNT + 5)).toHaveLength(MAX_TEAM_COUNT);
  });

  test("a count below the minimum makes no teams at all", () => {
    expect(makeTeams(0)).toEqual([]);
    expect(makeTeams(1)).toEqual([]);
  });
});

describe("snapTeamCount", () => {
  test("a lone team is not a thing — 1 snaps to off", () => {
    expect(snapTeamCount(1)).toBe(0);
  });

  test("leaves off and every real count alone", () => {
    expect(snapTeamCount(0)).toBe(0);
    for (let n = MIN_TEAM_COUNT; n <= MAX_TEAM_COUNT; n++) {
      expect(snapTeamCount(n)).toBe(n);
    }
  });
});

function withTeams(count: number, assignments: (string | null)[]): Room {
  const room = createRoom("PLUM", 1000);
  return {
    ...room,
    settings: { ...defaultSettings("ffa"), teamCount: count },
    teams: makeTeams(count),
    players: assignments.map((teamId, i): Player => ({
      id: `p${i}`, name: `P${i}`, emoji: "🐙",
      ready: false, connected: true, teamId,
    })),
  };
}

describe("teamsEnabled", () => {
  test("off at 0 and at a snapped-away 1", () => {
    expect(teamsEnabled({ ...defaultSettings("ffa"), teamCount: 0 })).toBe(false);
    expect(teamsEnabled({ ...defaultSettings("ffa"), teamCount: 1 })).toBe(false);
  });

  test("on across the whole legal range", () => {
    for (let n = MIN_TEAM_COUNT; n <= MAX_TEAM_COUNT; n++) {
      expect(teamsEnabled({ ...defaultSettings("ffa"), teamCount: n })).toBe(true);
    }
  });

  test("an unknown mode falls back to the default, which does declare it", () => {
    // Settings are validated against the *active mode's* descriptors, never
    // against a field's mere existence. `modeSpec` never throws and never
    // returns undefined, so an id off disk or off the wire resolves to
    // DEFAULT_MODE — which exposes teamCount, hence true.
    expect(
      teamsEnabled({ ...defaultSettings("ffa"), mode: "nope" as never, teamCount: 4 }),
    ).toBe(true);
  });
});

describe("teamOf and membersOf", () => {
  test("finds a player's team", () => {
    const room = withTeams(2, ["t0", "t1", "t0"]);
    expect(teamOf(room, "p2")?.id).toBe("t0");
    expect(teamOf(room, "nobody")).toBeUndefined();
  });

  test("an unassigned player is on no team", () => {
    const room = withTeams(2, [null, "t1"]);
    expect(teamOf(room, "p0")).toBeUndefined();
  });

  test("members come back in roster order", () => {
    const room = withTeams(2, ["t0", "t1", "t0"]);
    expect(membersOf(room, "t0").map((p) => p.id)).toEqual(["p0", "p2"]);
    expect(membersOf(room, "t1").map((p) => p.id)).toEqual(["p1"]);
  });
});

describe("a fresh room", () => {
  test("has no teams and nobody on one", () => {
    const room = createRoom("PLUM", 1000);
    expect(room.teams).toEqual([]);
    expect(room.settings.teamCount).toBe(0);
  });
});

function roster(...teamIds: (string | null)[]): Player[] {
  return teamIds.map((teamId, i) => ({
    id: `p${i}`, name: `P${i}`, emoji: "🐙",
    ready: false, connected: true, teamId,
  }));
}

describe("assignStragglers", () => {
  test("drops an unassigned player into the emptiest team", () => {
    const out = assignStragglers(roster("t0", "t0", null), makeTeams(2));
    expect(out[2].teamId).toBe("t1");
  });

  test("breaks a tie by lowest colour index", () => {
    const out = assignStragglers(roster(null), makeTeams(3));
    expect(out[0].teamId).toBe("t0");
  });

  test("spreads two stragglers rather than stacking them", () => {
    const out = assignStragglers(roster(null, null), makeTeams(2));
    expect(out.map((p) => p.teamId)).toEqual(["t0", "t1"]);
  });

  test("leaves assigned players exactly where they are", () => {
    const out = assignStragglers(roster("t1", "t1", null), makeTeams(2));
    expect(out.map((p) => p.teamId)).toEqual(["t1", "t1", "t0"]);
  });

  test("treats a teamId that names no live team as unassigned", () => {
    const out = assignStragglers(roster("gone"), makeTeams(2));
    expect(out[0].teamId).toBe("t0");
  });

  test("returns the identical array when everyone already has a team", () => {
    const players = roster("t0", "t1");
    expect(assignStragglers(players, makeTeams(2))).toBe(players);
  });

  test("returns the identical array when there are no teams", () => {
    const players = roster(null, null);
    expect(assignStragglers(players, [])).toBe(players);
  });
});

describe("balanceTeams", () => {
  /** How many players ended up on each team, in team order. */
  const sizes = (players: Player[], teams: ReturnType<typeof makeTeams>) =>
    teams.map((t) => players.filter((p) => p.teamId === t.id).length);

  test("deals everybody, including the ones who already chose", () => {
    // The case the button exists for: the whole room piled onto Red. The old
    // behaviour left them there and only placed stragglers, so pressing it
    // changed nothing at all.
    const teams = makeTeams(2);
    const piled = roster("t0", "t0", "t0", "t0");
    expect(sizes(balanceTeams(piled, teams, 0.42), teams)).toEqual([2, 2]);
  });

  test("splits as evenly as the roster allows", () => {
    const teams = makeTeams(3);
    const players = roster(null, null, null, null, null, null, null);
    // Seven across three: 3/2/2 in some order, never 4/2/1.
    const out = sizes(balanceTeams(players, teams, 0.7), teams).sort();
    expect(out).toEqual([2, 2, 3]);
  });

  test("bots are dealt like anybody else", () => {
    const teams = makeTeams(2);
    const players = roster(null, null, null, null).map((p, i) =>
      i >= 2 ? { ...p, isBot: true as const } : p,
    );
    const out = balanceTeams(players, teams, 0.1);
    expect(out.every((p) => p.teamId !== null)).toBe(true);
    expect(sizes(out, teams)).toEqual([2, 2]);
  });

  test("the same roll always deals the same way", () => {
    const teams = makeTeams(3);
    const players = roster(null, null, null, null, null);
    const a = balanceTeams(players, teams, 0.31).map((p) => p.teamId);
    const b = balanceTeams(players, teams, 0.31).map((p) => p.teamId);
    expect(a).toEqual(b);
  });

  test("different rolls deal differently, so pressing again re-sorts", () => {
    // Not a guarantee for any *one* pair of rolls — an even split can come up
    // twice — so this asserts over a spread: a hundred rolls of eight players
    // across two teams cannot all produce the same assignment unless the roll
    // is being ignored.
    const teams = makeTeams(2);
    const players = roster(null, null, null, null, null, null, null, null);
    const deals = new Set(
      Array.from({ length: 100 }, (_, i) =>
        balanceTeams(players, teams, i / 100).map((p) => p.teamId).join(""),
      ),
    );
    expect(deals.size).toBeGreaterThan(1);
  });

  test("order out is order in — only teamId moves", () => {
    const teams = makeTeams(2);
    const players = roster(null, null, null, null);
    const out = balanceTeams(players, teams, 0.55);
    expect(out.map((p) => p.id)).toEqual(["p0", "p1", "p2", "p3"]);
    expect(out.map((p) => p.name)).toEqual(["P0", "P1", "P2", "P3"]);
  });

  test("returns the identical array when there are no teams", () => {
    const players = roster(null, null);
    expect(balanceTeams(players, [], 0.5)).toBe(players);
  });

  test("returns the identical array when the deal changes nothing", () => {
    // One player, one team: wherever the shuffle puts them, they are already
    // there. The no-op contract is what stops `reduce` broadcasting for it.
    // The team is built by hand because `makeTeams(1)` is empty by design —
    // one team is not a match.
    const players = roster("t0");
    const single = [{ id: "t0", colorIndex: 0, name: TEAM_COLORS[0].name }];
    expect(balanceTeams(players, single, 0.5)).toBe(players);
  });

  test("an empty room is a no-op rather than a divide by zero", () => {
    const players: Player[] = [];
    expect(balanceTeams(players, makeTeams(2), 0.5)).toBe(players);
  });
});

describe("rosterOf", () => {
  test("with teams off, one scorer per player", () => {
    // withTeams(0) already gives teamCount 0 and makeTeams(0) === [].
    const scorers = rosterOf(withTeams(0, [null, null]));
    expect(scorers.map((s) => s.id)).toEqual(["p0", "p1"]);
    expect(scorers[0].members).toEqual(["p0"]);
    expect(scorers[0].colorIndex).toBeNull();
  });

  test("with teams on, one scorer per team", () => {
    const room = withTeams(2, ["t0", "t1", "t0"]);
    const scorers = rosterOf(room);
    expect(scorers.map((s) => s.id)).toEqual(["t0", "t1"]);
    expect(scorers[0].members).toEqual(["p0", "p2"]);
    expect(scorers[0].name).toBe(TEAM_COLORS[0].name);
    expect(scorers[0].colorIndex).toBe(0);
  });

  test("empty teams are excluded — this is the one place that rule lives", () => {
    const room = withTeams(4, ["t0", "t0"]);
    expect(rosterOf(room).map((s) => s.id)).toEqual(["t0"]);
  });
});
