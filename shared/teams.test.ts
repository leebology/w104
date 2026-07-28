import { describe, expect, test } from "vitest";
import { TEAM_COLORS, assignStragglers, makeTeams, membersOf, teamOf, teamsEnabled } from "./teams";
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
