import { describe, expect, test } from "vitest";
import { computeStandings, placeRound } from "./standings";
import type { Results } from "./scoring";
import type { Player, RoundSummary } from "./state";

function player(id: string): Player {
  return {
    id, name: id.toUpperCase(), emoji: "🐙",
    ready: false, connected: true, teamId: null,
  };
}

/** Results carrying only the fields placeRound reads. */
function results(...rows: [string, number, number][]): Results {
  return {
    scorers: rows.map(([id, unique, total]) => ({
      id,
      name: id.toUpperCase(),
      emoji: "🐙",
      colorIndex: null,
      members: [id],
      unique,
      total,
      entries: [],
    })),
  };
}

/** A round summary from unique/total pairs, placed by placeRound. */
function round(...rows: [string, number, number][]): RoundSummary {
  return { category: "woman", places: placeRound(results(...rows)) };
}

describe("placeRound", () => {
  test("ranks by unique words, highest first", () => {
    const places = placeRound(results(["a", 2, 9], ["b", 7, 7], ["c", 5, 5]));
    expect(places.a.place).toBe(3);
    expect(places.b.place).toBe(1);
    expect(places.c.place).toBe(2);
  });

  test("carries unique and total through unchanged", () => {
    const places = placeRound(results(["a", 3, 8]));
    expect(places.a).toEqual({ unique: 3, total: 8, place: 1 });
  });

  test("tied players share a place and the next place is skipped", () => {
    // Standard competition ranking: 7,5,5,2 -> 1,2,2,4. Nobody takes 3rd.
    const places = placeRound(results(["a", 7, 7], ["b", 5, 5], ["c", 5, 6], ["d", 2, 2]));
    expect(places.a.place).toBe(1);
    expect(places.b.place).toBe(2);
    expect(places.c.place).toBe(2);
    expect(places.d.place).toBe(4);
  });

  test("everyone tied shares first place", () => {
    const places = placeRound(results(["a", 4, 4], ["b", 4, 9], ["c", 4, 1]));
    expect([places.a.place, places.b.place, places.c.place]).toEqual([1, 1, 1]);
  });

  test("total words never breaks a tie on unique", () => {
    const places = placeRound(results(["a", 3, 30], ["b", 3, 3]));
    expect(places.a.place).toBe(1);
    expect(places.b.place).toBe(1);
  });

  test("a player with no unique words is still ranked", () => {
    const places = placeRound(results(["a", 1, 4], ["b", 0, 6]));
    expect(places.b.place).toBe(2);
  });

  test("no players yields no places", () => {
    expect(placeRound(results())).toEqual({});
  });
});

describe("computeStandings", () => {
  const roster = [player("a"), player("b"), player("c")];

  test("empty history puts everyone on zero points, all tied first", () => {
    const standings = computeStandings(roster, []);
    expect(standings.map((s) => s.points)).toEqual([0, 0, 0]);
    expect(standings.map((s) => s.place)).toEqual([1, 1, 1]);
    expect(standings.map((s) => s.badges)).toEqual([[], [], []]);
  });

  test("one round: points are that round's places", () => {
    const standings = computeStandings(roster, [round(["a", 7, 7], ["b", 5, 5], ["c", 2, 2])]);
    expect(standings.map((s) => [s.id, s.points])).toEqual([["a", 1], ["b", 2], ["c", 3]]);
  });

  test("points accumulate and the lowest total ranks first", () => {
    const history = [
      round(["a", 7, 7], ["b", 5, 5], ["c", 2, 2]), // a=1 b=2 c=3
      round(["a", 1, 1], ["b", 9, 9], ["c", 4, 4]), // a=3 b=1 c=2
      round(["a", 8, 8], ["b", 1, 1], ["c", 4, 4]), // a=1 b=3 c=2
    ];
    const standings = computeStandings(roster, history);
    // a=1+3+1=5, b=2+1+3=6, c=3+2+2=7
    expect(standings.map((s) => [s.id, s.points])).toEqual([["a", 5], ["b", 6], ["c", 7]]);
  });

  test("badges record the place from each round in play order", () => {
    const history = [
      round(["a", 7, 7], ["b", 5, 5], ["c", 2, 2]),
      round(["a", 1, 1], ["b", 9, 9], ["c", 4, 4]),
    ];
    const a = computeStandings(roster, history).find((s) => s.id === "a")!;
    expect(a.badges).toEqual([1, 3]);
  });

  test("players level on points are co-winners sharing first place", () => {
    const history = [
      round(["a", 7, 7], ["b", 5, 5], ["c", 2, 2]), // a=1 b=2 c=3
      round(["a", 2, 2], ["b", 5, 5], ["c", 7, 7]), // a=3 b=2 c=1
    ];
    const standings = computeStandings(roster, history);
    // Every player totals 4.
    expect(standings.map((s) => s.points)).toEqual([4, 4, 4]);
    expect(standings.map((s) => s.place)).toEqual([1, 1, 1]);
  });

  test("returns players already sorted by place", () => {
    const standings = computeStandings(roster, [round(["a", 1, 1], ["b", 9, 9], ["c", 4, 4])]);
    expect(standings.map((s) => s.id)).toEqual(["b", "c", "a"]);
    expect(standings.map((s) => s.place)).toEqual([1, 2, 3]);
  });

  test("a kicked player drops out entirely despite appearing in history", () => {
    const history = [round(["a", 7, 7], ["b", 5, 5], ["c", 2, 2])];
    const standings = computeStandings([player("a"), player("c")], history);
    expect(standings.map((s) => s.id)).toEqual(["a", "c"]);
    expect(standings.find((s) => s.id === "c")!.points).toBe(3);
  });

  test("carries name and emoji from the live roster, not from history", () => {
    const renamed = [{ ...player("a"), name: "Renamed", emoji: "🦊" }];
    const standings = computeStandings(renamed, [round(["a", 1, 1])]);
    expect(standings[0].name).toBe("Renamed");
    expect(standings[0].emoji).toBe("🦊");
  });

  test("a player missing from a round contributes nothing rather than throwing", () => {
    const history: RoundSummary[] = [
      round(["a", 5, 5], ["b", 1, 1]),
      { category: "woman", places: placeRound(results(["a", 3, 3])) },
    ];
    const b = computeStandings(roster, history).find((s) => s.id === "b")!;
    expect(b.badges).toEqual([2]);
    expect(b.points).toBe(2);
  });
});
