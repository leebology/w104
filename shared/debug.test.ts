import { describe, expect, test } from "vitest";
import { DEBUG_WORDS, DEFAULT_FILL_COUNT, fillWordsFor, pickDebugWords } from "./debug";

/** A `rand` that walks a fixed sequence, so a draw is reproducible. */
function seeded(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

describe("pickDebugWords", () => {
  test("returns the number asked for", () => {
    expect(pickDebugWords(8, seeded([0.1, 0.9, 0.5, 0.3])).length).toBe(8);
  });

  test("never repeats — a duplicate would be rejected by submitEntry", () => {
    const words = pickDebugWords(40, Math.random);
    expect(new Set(words).size).toBe(40);
  });

  test("only draws from the pool", () => {
    const pool = new Set<string>(DEBUG_WORDS);
    for (const word of pickDebugWords(30, Math.random)) {
      expect(pool.has(word)).toBe(true);
    }
  });

  test("is deterministic for a given rand", () => {
    const seq = [0.7, 0.2, 0.44, 0.91, 0.05];
    expect(pickDebugWords(5, seeded(seq))).toEqual(pickDebugWords(5, seeded(seq)));
  });

  test("caps at the pool size rather than looping forever", () => {
    expect(pickDebugWords(10_000, Math.random).length).toBe(DEBUG_WORDS.length);
  });

  test("a rand pinned at 1 stays inside the array", () => {
    // Math.random() is [0,1), but the clamp is what makes that an assumption
    // this function does not have to trust.
    const words = pickDebugWords(6, () => 0.999999999999);
    expect(words.length).toBe(6);
    expect(words.every((w) => typeof w === "string")).toBe(true);
  });

  test("zero and negative counts are empty, not a throw", () => {
    expect(pickDebugWords(0, Math.random)).toEqual([]);
    expect(pickDebugWords(-3, Math.random)).toEqual([]);
  });

  test("the pool is big enough for a full room at the default fill", () => {
    // Ten players is MAX_PLAYERS; each draws independently, but a pool smaller
    // than one player's draw would silently shorten every list.
    expect(DEBUG_WORDS.length).toBeGreaterThan(DEFAULT_FILL_COUNT * 10);
  });
});

describe("DEBUG_WORDS", () => {
  test("has no duplicates of its own", () => {
    expect(new Set<string>(DEBUG_WORDS).size).toBe(DEBUG_WORDS.length);
  });

  test("is all lowercase single words, so nothing normalizes away", () => {
    for (const word of DEBUG_WORDS) {
      expect(word).toMatch(/^[a-z]+$/);
    }
  });
});

describe("fillWordsFor", () => {
  test("deals one list per scorer, each the requested length", () => {
    const lists = fillWordsFor(4, 8, Math.random);
    expect(lists.length).toBe(4);
    for (const list of lists) expect(list.length).toBe(8);
  });

  test("a scorer's own list never repeats — submitEntry would reject it", () => {
    for (const list of fillWordsFor(6, 8, Math.random)) {
      expect(new Set(list).size).toBe(list.length);
    }
  });

  test("lists overlap, which is the entire point", () => {
    // Independent draws from the 140-word pool would collide about half a word
    // per pair; the shared sub-pool is what makes the scoring screen show
    // struck-through duplicates at all.
    //
    // Measured over many draws rather than one. A single pair drawing 8 each
    // from a 24-word pool misses entirely about 1.7% of the time — a test that
    // fails one CI run in sixty is worse than no test. Averaging pins the
    // property the function actually promises, and P(this mean is 0) is nil.
    const trials = 200;
    let total = 0;
    for (let i = 0; i < trials; i++) {
      const [a, b] = fillWordsFor(2, 8, Math.random) as [string[], string[]];
      total += a.filter((w) => b.includes(w)).length;
    }
    const mean = total / trials;
    // Independent draws from the full pool would average 8*8/140 ≈ 0.46.
    expect(mean).toBeGreaterThan(2);
  });

  test("but every scorer still keeps a chance at words of their own", () => {
    // The sub-pool is perScorer * (scorerCount + 1), so it is strictly larger
    // than what all scorers combined can hold.
    const lists = fillWordsFor(3, 8, Math.random);
    const pool = new Set(lists.flat());
    expect(pool.size).toBeGreaterThan(8);
  });

  test("one scorer alone still gets a full list", () => {
    expect(fillWordsFor(1, 8, Math.random)[0]!.length).toBe(8);
  });

  test("zero scorers or zero words is empty, not a throw", () => {
    expect(fillWordsFor(0, 8, Math.random)).toEqual([]);
    expect(fillWordsFor(4, 0, Math.random)).toEqual([]);
  });

  test("a full room at the default fill stays inside the pool", () => {
    const lists = fillWordsFor(10, DEFAULT_FILL_COUNT, Math.random);
    expect(lists.length).toBe(10);
    for (const list of lists) expect(list.length).toBe(DEFAULT_FILL_COUNT);
  });
});
