import { describe, expect, test } from "vitest";
import { TEAM_COLORS, makeTeams } from "./teams";
import { MAX_TEAM_COUNT, MIN_TEAM_COUNT, snapTeamCount } from "./gamemodes";

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
