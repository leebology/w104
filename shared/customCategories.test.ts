import { describe, expect, it } from "vitest";
import {
  HAND_SIZE, MAX_CATEGORY_LEN, MAX_QUOTA, VOTE_BUDGET,
  exposureFor, quotaFor, voteBudgetFor,
} from "./customCategories";

describe("quotaFor", () => {
  it("keeps a small room's pool worth voting on", () => {
    expect(quotaFor(3, 1)).toBe(3);
    expect(quotaFor(4, 1)).toBe(3);
    expect(quotaFor(5, 1)).toBe(2);
    expect(quotaFor(8, 1)).toBe(1);
    expect(quotaFor(20, 1)).toBe(1);
  });

  it("grows the pool to half again the round count", () => {
    expect(quotaFor(3, 10)).toBe(4);
    expect(quotaFor(4, 10)).toBe(4);
    expect(quotaFor(5, 10)).toBe(3);
    expect(quotaFor(8, 10)).toBe(2);
    expect(quotaFor(10, 10)).toBe(2);
    expect(quotaFor(20, 10)).toBe(1);
  });

  it("never exceeds the writing ceiling for a real room", () => {
    for (let p = 3; p <= 30; p++) {
      for (let r = 1; r <= 10; r++) {
        expect(quotaFor(p, r)).toBeLessThanOrEqual(MAX_QUOTA);
        expect(quotaFor(p, r)).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("covers the round count at every real room size", () => {
    for (let p = 3; p <= 30; p++) {
      for (let r = 1; r <= 10; r++) {
        expect(p * quotaFor(p, r)).toBeGreaterThanOrEqual(r);
      }
    }
  });

  it("bends the rules for one- and two-player rooms", () => {
    // Exact coverage, no excess, no ceiling — with a floor of three so a hand
    // of three distinct cards exists at all.
    expect(quotaFor(1, 1)).toBe(3);
    expect(quotaFor(1, 10)).toBe(10);
    expect(quotaFor(2, 1)).toBe(2);
    expect(quotaFor(2, 10)).toBe(5);
  });
});

describe("voteBudgetFor", () => {
  it("is four, and four is what makes exposure exact", () => {
    expect(voteBudgetFor()).toBe(VOTE_BUDGET);
    // 12 is the only product of HAND_SIZE and a workable budget that every
    // quota from 1 to MAX_QUOTA divides. This test is the reason the number
    // is 4 — if it fails, the vote count has been changed without the maths.
    for (let q = 1; q <= MAX_QUOTA; q++) {
      expect((HAND_SIZE * VOTE_BUDGET) % q).toBe(0);
    }
  });
});

describe("exposureFor", () => {
  it("is a whole number for every real quota", () => {
    expect(exposureFor(1)).toBe(12);
    expect(exposureFor(2)).toBe(6);
    expect(exposureFor(3)).toBe(4);
    expect(exposureFor(4)).toBe(3);
  });
});

import { buildPool, publicPool } from "./customCategories";

const seats = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);
const HOUSE = ["woman", "animal", "song", "movie", "country"];

describe("buildPool", () => {
  it("puts one card in every slot, in seat-major order", () => {
    const pool = buildPool(
      seats(3),
      { p0: ["a", "b"], p1: ["c", "d"], p2: ["e", "f"] },
      2,
      HOUSE,
      0.5,
    );
    expect(pool).toHaveLength(6);
    expect(pool.map((c) => c.text)).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(pool.map((c) => c.authorId)).toEqual(["p0", "p0", "p1", "p1", "p2", "p2"]);
    expect(pool.map((c) => c.slot)).toEqual([0, 1, 0, 1, 0, 1]);
  });

  it("backfills a blank slot with a house card", () => {
    const pool = buildPool(seats(2), { p0: ["a", ""], p1: ["", "d"] }, 2, HOUSE, 0.5);
    expect(pool.map((c) => c.authorId)).toEqual(["p0", null, null, "p1"]);
    expect(pool[1].text).not.toBe("");
    expect(HOUSE).toContain(pool[1].text);
  });

  it("makes every card a house card when nobody writes anything", () => {
    const pool = buildPool(seats(3), {}, 1, HOUSE, 0.2);
    expect(pool).toHaveLength(3);
    expect(pool.every((c) => c.authorId === null)).toBe(true);
  });

  it("trims and caps what a player typed", () => {
    const long = "x".repeat(40);
    const pool = buildPool(seats(1), { p0: [`  spaced  `, long] }, 2, HOUSE, 0.1);
    expect(pool[0].text).toBe("spaced");
    expect(pool[1].text).toHaveLength(MAX_CATEGORY_LEN);
  });

  it("gives every card a unique id that does not name its seat", () => {
    const pool = buildPool(
      seats(4),
      { p0: ["a"], p1: ["b"], p2: ["c"], p3: ["d"] },
      1,
      HOUSE,
      0.7,
    );
    const ids = pool.map((c) => c.id);
    expect(new Set(ids).size).toBe(4);
    // Seat-major order must not be recoverable from the ids, or a client
    // holding the public pool could read authorship straight off them.
    expect(ids).not.toEqual([...ids].sort());
  });
});

describe("publicPool", () => {
  it("hides authors and re-orders by id while voting is open", () => {
    const pool = buildPool(
      seats(3),
      { p0: ["a"], p1: ["b"], p2: ["c"] },
      1,
      HOUSE,
      0.33,
    );
    const shown = publicPool(pool, false);
    expect(shown.every((c) => c.authorId === null)).toBe(true);
    expect(shown.map((c) => c.id)).toEqual([...shown.map((c) => c.id)].sort());
  });

  it("restores authors at the close", () => {
    const pool = buildPool(seats(2), { p0: ["a"], p1: ["b"] }, 1, HOUSE, 0.33);
    const shown = publicPool(pool, true);
    expect(shown.map((c) => c.authorId).sort()).toEqual(["p0", "p1"]);
  });
});
