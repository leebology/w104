import { describe, expect, test } from "vitest";
import { allowedEdits, editDistance, isMatch, normalize, scoreRound } from "./scoring";
import { rosterOf } from "./teams";
import { defaultSettings } from "./gamemodes";
import { makeTeams } from "./teams";
import { createRoom } from "./state";
import type { Entry, Player, Room } from "./state";
import type { Scorer } from "./teams";

describe("normalize", () => {
  test("folds case", () => {
    expect(normalize("Zendaya")).toBe("zendaya");
  });

  test("strips diacritics so Beyoncé and beyonce merge", () => {
    expect(normalize("Beyoncé")).toBe("beyonce");
  });

  test("strips punctuation", () => {
    expect(normalize("O'Brien")).toBe("obrien");
    expect(normalize("Lupita Nyong'o!")).toBe("lupita nyongo");
  });

  test("collapses and trims whitespace", () => {
    expect(normalize("  Taylor   Swift  ")).toBe("taylor swift");
  });
});

describe("editDistance", () => {
  test("counts a deletion", () => {
    expect(editDistance("zendaya", "zendya")).toBe(1);
  });

  test("counts a transposition as one edit", () => {
    expect(editDistance("adele", "adlee")).toBe(1);
  });

  test("is zero for identical strings", () => {
    expect(editDistance("rihanna", "rihanna")).toBe(0);
  });
});

describe("allowedEdits", () => {
  test("demands exact match below 5 characters", () => {
    expect(allowedEdits("anne", "anna")).toBe(0);
  });

  test("allows one edit at 5-8 characters", () => {
    expect(allowedEdits("zendya", "zendaya")).toBe(1);
  });

  test("allows two edits at 9+ characters", () => {
    expect(allowedEdits("scarlet johanson", "scarlett johansson")).toBe(2);
  });

  test("measures against the shorter string", () => {
    expect(allowedEdits("cher", "cherilyn sarkisian")).toBe(0);
  });
});

describe("isMatch", () => {
  test("merges a plausible typo", () => {
    expect(isMatch("zendaya", "zendya")).toBe(true);
  });

  test("keeps short lookalike names apart", () => {
    expect(isMatch("anne", "anna")).toBe(false);
  });

  test("keeps genuinely different long names apart", () => {
    expect(isMatch("kate hudson", "kate winslet")).toBe(false);
  });

  test("merges identical strings", () => {
    expect(isMatch("adele", "adele")).toBe(true);
  });
});

function entry(by: string, text: string, at: number): Entry {
  return { text, at, by };
}

function teamRoom(teamCount: number, assignments: (string | null)[]): Room {
  const base = createRoom("PLUM", 1000);
  return {
    ...base,
    settings: { ...defaultSettings("ffa"), teamCount },
    teams: makeTeams(teamCount),
    players: assignments.map((teamId, i): Player => ({
      id: `p${i}`, name: `P${i}`, emoji: "🐙",
      ready: false, connected: true, teamId,
    })),
  };
}

const scorers: Scorer[] = [
  { id: "a", name: "Akshay", emoji: "🐙", colorIndex: null, members: ["a"] },
  { id: "b", name: "Aidan", emoji: "🦊", colorIndex: null, members: ["b"] },
  { id: "c", name: "Liam", emoji: "🐸", colorIndex: null, members: ["c"] },
];

/** Spread into an entry literal: `{ text: "Zendaya", ...by("a", 1) }`. */
const by = (id: string, n: number) => ({ at: n, by: id });

describe("scoreRound", () => {
  test("a word only one player wrote is unique", () => {
    const results = scoreRound({
      scorers,
      entries: {
        a: [{ text: "Zendaya", ...by("a", 1) }],
        b: [{ text: "Adele", ...by("b", 2) }],
        c: [],
      },
    });
    const a = results.scorers.find((p) => p.id === "a")!;
    expect(a.total).toBe(1);
    expect(a.unique).toBe(1);
    expect(a.entries[0]).toEqual({
      text: "Zendaya",
      by: "a",
      unique: true,
      group: 0,
      alsoBy: [],
    });
  });

  test("matching entries share a group and non-matching ones do not", () => {
    const results = scoreRound({
      scorers,
      entries: {
        a: [{ text: "Adele", ...by("a", 1) }, { text: "Cher", ...by("a", 2) }],
        b: [{ text: "adele", ...by("b", 3) }],
        c: [{ text: "Cher", ...by("c", 4) }],
      },
    });
    const group = (id: string, i: number) =>
      results.scorers.find((s) => s.id === id)!.entries[i].group;

    // Two distinct collisions, each pairing a different set of scorers.
    expect(group("a", 0)).toBe(group("b", 0)); // Adele / adele
    expect(group("a", 1)).toBe(group("c", 0)); // Cher / Cher
    expect(group("a", 0)).not.toBe(group("a", 1));
  });

  test("one scorer's two words cancelled by the same rival get distinct groups", () => {
    // The case that makes `group` necessary: `alsoBy` is ["b"] for both of a's
    // entries, so it cannot tell these two clusters apart on its own.
    const results = scoreRound({
      scorers,
      entries: {
        a: [{ text: "Adele", ...by("a", 1) }, { text: "Cher", ...by("a", 2) }],
        b: [{ text: "Adele", ...by("b", 3) }, { text: "Cher", ...by("b", 4) }],
        c: [],
      },
    });
    const a = results.scorers.find((s) => s.id === "a")!;
    expect(a.entries[0].alsoBy).toEqual(a.entries[1].alsoBy); // identical
    expect(a.entries[0].group).not.toBe(a.entries[1].group); // still separable
  });

  test("a shared word scores for nobody and carries the other emoji", () => {
    const results = scoreRound({
      scorers,
      entries: {
        a: [{ text: "Adele", ...by("a", 1) }],
        b: [{ text: "adele", ...by("b", 2) }],
        c: [],
      },
    });
    const a = results.scorers.find((p) => p.id === "a")!;
    expect(a.unique).toBe(0);
    expect(a.entries[0].unique).toBe(false);
    expect(a.entries[0].alsoBy).toEqual(["b"]);
  });

  test("a typo still counts as the same word", () => {
    const results = scoreRound({
      scorers,
      entries: {
        a: [{ text: "Zendaya", ...by("a", 1) }],
        b: [{ text: "Zendya", ...by("b", 2) }],
        c: [],
      },
    });
    expect(results.scorers.find((p) => p.id === "a")!.unique).toBe(0);
  });

  test("three players on one word list both other emoji", () => {
    const results = scoreRound({
      scorers,
      entries: {
        a: [{ text: "Adele", ...by("a", 1) }],
        b: [{ text: "adele", ...by("b", 2) }],
        c: [{ text: "ADELE", ...by("c", 3) }],
      },
    });
    expect(results.scorers.find((s) => s.id === "a")!.entries[0].alsoBy.sort())
      .toEqual(["b", "c"]);
  });

  test("a player repeating a word does not inflate their total", () => {
    const results = scoreRound({
      scorers,
      entries: {
        a: [{ text: "Adele", ...by("a", 1) }, { text: "adele", ...by("a", 2) }],
        b: [],
        c: [],
      },
    });
    const a = results.scorers.find((p) => p.id === "a")!;
    expect(a.total).toBe(1);
    expect(a.unique).toBe(1);
  });

  test("blank entries are discarded", () => {
    const results = scoreRound({
      scorers,
      entries: { a: [{ text: "   ", ...by("a", 1) }], b: [], c: [] },
    });
    expect(results.scorers.find((p) => p.id === "a")!.total).toBe(0);
  });

  test("short lookalikes both score", () => {
    const results = scoreRound({
      scorers,
      entries: {
        a: [{ text: "Anne", ...by("a", 1) }],
        b: [{ text: "Anna", ...by("b", 2) }],
        c: [],
      },
    });
    expect(results.scorers.find((p) => p.id === "a")!.unique).toBe(1);
    expect(results.scorers.find((p) => p.id === "b")!.unique).toBe(1);
  });

  test("a player with no entries scores zero", () => {
    const results = scoreRound({
      scorers,
      entries: { a: [{ text: "Adele", ...by("a", 1) }], b: [], c: [] },
    });
    const c = results.scorers.find((p) => p.id === "c")!;
    expect(c.total).toBe(0);
    expect(c.unique).toBe(0);
    expect(c.entries).toEqual([]);
  });

  test("entries stay in submission order", () => {
    const results = scoreRound({
      scorers,
      entries: {
        a: [{ text: "Cher", ...by("a", 3) }, { text: "Adele", ...by("a", 1) }],
        b: [],
        c: [],
      },
    });
    expect(results.scorers.find((p) => p.id === "a")!.entries.map((e) => e.text))
      .toEqual(["Adele", "Cher"]);
  });
});

describe("scoreRound with teams", () => {
  test("two teammates writing the same word count it once for the team", () => {
    const room = teamRoom(2, ["t0", "t0", "t1"]);
    const results = scoreRound({
      scorers: rosterOf(room),
      entries: {
        p0: [entry("p0", "zendaya", 1)],
        p1: [entry("p1", "Zendaya", 2)],
        p2: [entry("p2", "adele", 3)],
      },
    });
    const t0 = results.scorers.find((s) => s.id === "t0")!;
    expect(t0.total).toBe(1);
    expect(t0.unique).toBe(1);
    expect(t0.entries[0].by).toBe("p0");
  });

  test("two teams sharing a word cancel it for both", () => {
    const room = teamRoom(2, ["t0", "t1"]);
    const results = scoreRound({
      scorers: rosterOf(room),
      entries: {
        p0: [entry("p0", "zendaya", 1)],
        p1: [entry("p1", "zendaya", 2)],
      },
    });
    for (const s of results.scorers) {
      expect(s.unique).toBe(0);
      expect(s.entries[0].unique).toBe(false);
    }
    expect(results.scorers.find((s) => s.id === "t0")!.entries[0].alsoBy).toEqual(["t1"]);
  });

  test("a team's list is its members' merged in submission order", () => {
    const room = teamRoom(2, ["t0", "t0", "t1"]);
    const results = scoreRound({
      scorers: rosterOf(room),
      entries: {
        p0: [entry("p0", "adele", 3)],
        p1: [entry("p1", "cher", 1)],
        p2: [entry("p2", "dido", 2)],
      },
    });
    const t0 = results.scorers.find((s) => s.id === "t0")!;
    expect(t0.entries.map((e) => e.text)).toEqual(["cher", "adele"]);
    expect(t0.entries.map((e) => e.by)).toEqual(["p1", "p0"]);
  });

  test("a one-member scorer scores exactly as a solo player always did", () => {
    const results = scoreRound({
      scorers: rosterOf(teamRoom(0, [null, null])),
      entries: {
        p0: [entry("p0", "zendaya", 1), entry("p0", "adele", 2)],
        p1: [entry("p1", "adele", 3)],
      },
    });
    const p0 = results.scorers.find((s) => s.id === "p0")!;
    expect(p0.total).toBe(2);
    expect(p0.unique).toBe(1);
    expect(p0.entries[1].alsoBy).toEqual(["p1"]);
  });
});
