import { describe, expect, test } from "vitest";
import { computeStandings, placeRound } from "./standings";
import type { Results } from "./scoring";
import type { RoundSummary } from "./state";
import type { Scorer } from "./teams";

/** A solo scorer — one player who is their own team of one. */
function player(id: string): Scorer {
  return { id, name: id.toUpperCase(), emoji: "🐙", colorIndex: null, members: [id] };
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

  test("one round: a place pays out inverted, three scorers", () => {
    const standings = computeStandings(roster, [round(["a", 7, 7], ["b", 5, 5], ["c", 2, 2])]);
    expect(standings.map((s) => [s.id, s.points])).toEqual([["a", 3], ["b", 2], ["c", 1]]);
  });

  test("last place always takes exactly one, whatever the room size", () => {
    const two = computeStandings([player("a"), player("b")], [round(["a", 7, 7], ["b", 5, 5])]);
    expect(two.map((s) => [s.id, s.points])).toEqual([["a", 2], ["b", 1]]);
  });

  test("points accumulate and the highest total ranks first", () => {
    const history = [
      round(["a", 7, 7], ["b", 5, 5], ["c", 2, 2]), // a=1 b=2 c=3 -> 3 2 1
      round(["a", 1, 1], ["b", 9, 9], ["c", 4, 4]), // a=3 b=1 c=2 -> 1 3 2
      round(["a", 8, 8], ["b", 1, 1], ["c", 4, 4]), // a=1 b=3 c=2 -> 3 1 2
    ];
    const standings = computeStandings(roster, history);
    // a=3+1+3=7, b=2+3+1=6, c=1+2+2=5
    expect(standings.map((s) => [s.id, s.points])).toEqual([["a", 7], ["b", 6], ["c", 5]]);
  });

  test("`last` is what the round just played paid, and null for a sit-out", () => {
    const history: RoundSummary[] = [
      round(["a", 7, 7], ["b", 5, 5], ["c", 2, 2]),
      { category: "woman", places: placeRound(results(["a", 3, 3], ["c", 1, 1])) },
    ];
    const standings = computeStandings(roster, history);
    // Round two had two scorers: a came 1st for 2, c came 2nd for 1.
    expect(standings.find((s) => s.id === "a")!.last).toBe(2);
    expect(standings.find((s) => s.id === "c")!.last).toBe(1);
    expect(standings.find((s) => s.id === "b")!.last).toBeNull();
  });

  test("`last` is null before any round has been banked", () => {
    expect(computeStandings(roster, []).map((s) => s.last)).toEqual([null, null, null]);
  });

  test("a shared place shares its payout, and the skipped one is never awarded", () => {
    // b and c tie on unique, so both take 2nd of three: 2 points each, and the
    // 1 that 3rd place would have paid goes to nobody.
    const standings = computeStandings(roster, [
      round(["a", 7, 7], ["b", 5, 5], ["c", 5, 5]),
    ]);
    expect(standings.map((s) => [s.id, s.points])).toEqual([["a", 3], ["b", 2], ["c", 2]]);
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
      round(["a", 7, 7], ["b", 5, 5], ["c", 2, 2]), // a=1 b=2 c=3 -> 3 2 1
      round(["a", 2, 2], ["b", 5, 5], ["c", 7, 7]), // a=3 b=2 c=1 -> 1 2 3
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
    // The round is still scored as the three-hander it was: c came 3rd of
    // three and took 1, and the kick does not reprice it.
    expect(standings.find((s) => s.id === "c")!.points).toBe(1);
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
    // 2nd of the two scorers round one had, and nothing for the round they
    // were not in.
    expect(b.points).toBe(1);
  });
});

function scorer(id: string, members: string[], colorIndex: number | null): Scorer {
  return { id, name: id.toUpperCase(), emoji: "", colorIndex, members };
}

describe("computeStandings over teams", () => {
  test("a team places as one row and carries its members", () => {
    const scorers = [scorer("t0", ["p0", "p1"], 0), scorer("t1", ["p2"], 1)];
    const standings = computeStandings(scorers, [
      round(["t0", 5, 5], ["t1", 2, 2]),
      round(["t0", 4, 4], ["t1", 9, 9]),
    ]);
    expect(standings.map((s) => s.id)).toEqual(["t0", "t1"]);
    expect(standings[0].points).toBe(3); // 1st + 2nd
    expect(standings[0].members).toEqual(["p0", "p1"]);
    expect(standings[0].colorIndex).toBe(0);
  });

  test("a team whose member was kicked keeps its points and badges", () => {
    // Iterating the live roster and looking history up by id is what buys
    // this — the same direction that already keeps a disconnected player's
    // badges and makes a kicked one vanish.
    const before = [scorer("t0", ["p0", "p1"], 0), scorer("t1", ["p2"], 1)];
    const history = [round(["t0", 5, 5], ["t1", 2, 2])];
    const after = [scorer("t0", ["p0"], 0), scorer("t1", ["p2"], 1)];
    expect(computeStandings(after, history)[0].points).toBe(
      computeStandings(before, history)[0].points,
    );
  });

  test("a player scorer keeps its emoji and a null colour", () => {
    const standings = computeStandings(
      [{ id: "a", name: "A", emoji: "🐙", colorIndex: null, members: ["a"] }],
      [round(["a", 3, 3])],
    );
    expect(standings[0].emoji).toBe("🐙");
    expect(standings[0].colorIndex).toBeNull();
    expect(standings[0].members).toEqual(["a"]);
  });
});
