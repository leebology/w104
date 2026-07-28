import { describe, expect, test } from "vitest";
import { allowedEdits, editDistance, isMatch, normalize, scoreRound } from "./scoring";

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

const players = [
  { id: "a", name: "Akshay", emoji: "🐙", ready: true, connected: true, teamId: null },
  { id: "b", name: "Aidan", emoji: "🦊", ready: true, connected: true, teamId: null },
  { id: "c", name: "Liam", emoji: "🐸", ready: true, connected: true, teamId: null },
];

const at = (by: string, n: number) => ({ at: n, by });

describe("scoreRound", () => {
  test("a word only one player wrote is unique", () => {
    const results = scoreRound({
      players,
      entries: {
        a: [{ text: "Zendaya", ...at("a", 1) }],
        b: [{ text: "Adele", ...at("b", 2) }],
        c: [],
      },
    });
    const a = results.players.find((p) => p.id === "a")!;
    expect(a.total).toBe(1);
    expect(a.unique).toBe(1);
    expect(a.entries[0]).toEqual({ text: "Zendaya", unique: true, alsoBy: [] });
  });

  test("a shared word scores for nobody and carries the other emoji", () => {
    const results = scoreRound({
      players,
      entries: {
        a: [{ text: "Adele", ...at("a", 1) }],
        b: [{ text: "adele", ...at("b", 2) }],
        c: [],
      },
    });
    const a = results.players.find((p) => p.id === "a")!;
    expect(a.unique).toBe(0);
    expect(a.entries[0].unique).toBe(false);
    expect(a.entries[0].alsoBy).toEqual(["🦊"]);
  });

  test("a typo still counts as the same word", () => {
    const results = scoreRound({
      players,
      entries: {
        a: [{ text: "Zendaya", ...at("a", 1) }],
        b: [{ text: "Zendya", ...at("b", 2) }],
        c: [],
      },
    });
    expect(results.players.find((p) => p.id === "a")!.unique).toBe(0);
  });

  test("three players on one word list both other emoji", () => {
    const results = scoreRound({
      players,
      entries: {
        a: [{ text: "Adele", ...at("a", 1) }],
        b: [{ text: "adele", ...at("b", 2) }],
        c: [{ text: "ADELE", ...at("c", 3) }],
      },
    });
    expect(results.players.find((p) => p.id === "a")!.entries[0].alsoBy.sort())
      .toEqual(["🐸", "🦊"]);
  });

  test("a player repeating a word does not inflate their total", () => {
    const results = scoreRound({
      players,
      entries: {
        a: [{ text: "Adele", ...at("a", 1) }, { text: "adele", ...at("a", 2) }],
        b: [],
        c: [],
      },
    });
    const a = results.players.find((p) => p.id === "a")!;
    expect(a.total).toBe(1);
    expect(a.unique).toBe(1);
  });

  test("blank entries are discarded", () => {
    const results = scoreRound({
      players,
      entries: { a: [{ text: "   ", ...at("a", 1) }], b: [], c: [] },
    });
    expect(results.players.find((p) => p.id === "a")!.total).toBe(0);
  });

  test("short lookalikes both score", () => {
    const results = scoreRound({
      players,
      entries: {
        a: [{ text: "Anne", ...at("a", 1) }],
        b: [{ text: "Anna", ...at("b", 2) }],
        c: [],
      },
    });
    expect(results.players.find((p) => p.id === "a")!.unique).toBe(1);
    expect(results.players.find((p) => p.id === "b")!.unique).toBe(1);
  });

  test("a player with no entries scores zero", () => {
    const results = scoreRound({
      players,
      entries: { a: [{ text: "Adele", ...at("a", 1) }], b: [], c: [] },
    });
    const c = results.players.find((p) => p.id === "c")!;
    expect(c.total).toBe(0);
    expect(c.unique).toBe(0);
    expect(c.entries).toEqual([]);
  });

  test("entries stay in submission order", () => {
    const results = scoreRound({
      players,
      entries: {
        a: [{ text: "Cher", ...at("a", 3) }, { text: "Adele", ...at("a", 1) }],
        b: [],
        c: [],
      },
    });
    expect(results.players.find((p) => p.id === "a")!.entries.map((e) => e.text))
      .toEqual(["Adele", "Cher"]);
  });
});
