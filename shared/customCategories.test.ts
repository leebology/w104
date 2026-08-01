import { describe, expect, it } from "vitest";
import {
  HAND_SIZE, MAX_QUOTA, VOTE_BUDGET,
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

  it("trims what a player typed, with no length cap", () => {
    const long = "x".repeat(40);
    const pool = buildPool(seats(1), { p0: [`  spaced  `, long] }, 2, HOUSE, 0.1);
    expect(pool[0].text).toBe("spaced");
    expect(pool[1].text).toBe(long);
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

import { buildDeal, exposureFor as expo } from "./customCategories";
import type { Hand } from "./customCategories";

/** A room where everybody wrote every slot. */
function room(players: number, quota: number, roll = 0.42) {
  const ids = seats(players);
  const drafts: Record<string, string[]> = {};
  ids.forEach((id, i) => {
    drafts[id] = Array.from({ length: quota }, (_, s) => `${id}-cat-${s}`);
  });
  const pool = buildPool(ids, drafts, quota, HOUSE, roll);
  return { ids, pool, deal: buildDeal(pool, ids, quota, roll) };
}

describe("buildDeal", () => {
  const shapes: Array<[number, number]> = [
    [3, 3], [3, 4], [4, 3], [4, 4], [5, 2], [5, 3],
    [6, 2], [7, 2], [8, 1], [8, 2], [10, 1], [10, 2],
    [13, 1], [20, 1], [30, 1],
  ];

  it("gives every player exactly VOTE_BUDGET hands of HAND_SIZE", () => {
    for (const [players, quota] of shapes) {
      const { ids, deal } = room(players, quota);
      for (const id of ids) {
        expect(deal[id]).toHaveLength(VOTE_BUDGET);
        for (const hand of deal[id]) {
          expect(hand.cardIds).toHaveLength(HAND_SIZE);
        }
      }
    }
  });

  it("never repeats a card inside one hand", () => {
    for (const [players, quota] of shapes) {
      const { ids, deal } = room(players, quota);
      for (const id of ids) {
        for (const hand of deal[id]) {
          expect(new Set(hand.cardIds).size).toBe(HAND_SIZE);
        }
      }
    }
  });

  it("never deals a player their own card", () => {
    for (const [players, quota] of shapes) {
      const { ids, pool, deal } = room(players, quota);
      const authorOf = new Map(pool.map((c) => [c.id, c.authorId]));
      for (const id of ids) {
        for (const hand of deal[id]) {
          for (const cardId of hand.cardIds) {
            expect(authorOf.get(cardId)).not.toBe(id);
          }
        }
      }
    }
  });

  it("shows every card exactly the same number of times", () => {
    for (const [players, quota] of shapes) {
      const { ids, pool, deal } = room(players, quota);
      const seen = new Map<string, number>(pool.map((c) => [c.id, 0]));
      for (const id of ids) {
        for (const hand of deal[id]) {
          for (const cardId of hand.cardIds) {
            seen.set(cardId, (seen.get(cardId) ?? 0) + 1);
          }
        }
      }
      const counts = [...seen.values()];
      // Exact, not ±1. This is the property that makes the vote fair.
      expect(new Set(counts).size).toBe(1);
      expect(counts[0]).toBe(expo(quota));
    }
  });

  it("spreads a player's repeats evenly", () => {
    for (const [players, quota] of shapes) {
      const { ids, deal } = room(players, quota);
      for (const id of ids) {
        const mine = new Map<string, number>();
        for (const hand of deal[id]) {
          for (const cardId of hand.cardIds) {
            mine.set(cardId, (mine.get(cardId) ?? 0) + 1);
          }
        }
        const counts = [...mine.values()];
        expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("does not filter teammates out — there is no team filter at all", () => {
    // A team filter would break equal exposure, which is why the deal knows
    // nothing about teams. Asserted as a shape property: with 4 players and a
    // quota of 3, every one of the 9 non-own cards must be reachable.
    const { ids, pool, deal } = room(4, 3);
    const authorOf = new Map(pool.map((c) => [c.id, c.authorId]));
    const mine = new Set(deal[ids[0]].flatMap((h) => h.cardIds));
    const others = pool.filter((c) => authorOf.get(c.id) !== ids[0]);
    expect(mine.size).toBe(others.length);
  });

  it("deals a player their own cards only when there is nobody else", () => {
    for (const players of [1, 2]) {
      const quota = quotaFor(players, 3);
      const { ids, deal } = room(players, quota);
      for (const id of ids) {
        expect(deal[id]).toHaveLength(VOTE_BUDGET);
        for (const hand of deal[id]) {
          expect(hand.cardIds).toHaveLength(HAND_SIZE);
          expect(new Set(hand.cardIds).size).toBe(HAND_SIZE);
        }
      }
    }
  });

  it("gives two rolls two different deals", () => {
    const a = room(8, 2, 0.11);
    const b = room(8, 2, 0.88);
    const flat = (d: Record<string, Hand[]>) =>
      JSON.stringify(Object.values(d).map((hs) => hs.map((h) => h.cardIds)));
    expect(flat(a.deal)).not.toBe(flat(b.deal));
  });

  it("returns an empty deal for an empty room", () => {
    expect(buildDeal([], [], 1, 0.5)).toEqual({});
  });
});

import {
  BOARD_CAP,
  boardCards,
  customShares,
  customTextShares,
  mergeBoard,
  pickCustomCategory,
} from "./customCategories";

const card = (id: string, text: string, authorId: string | null = "p0") =>
  ({ id, text, authorId, slot: 0 });

describe("boardCards", () => {
  it("keeps every card on the board while votes are landing", () => {
    const pool = [card("c0", "a"), card("c1", "b"), card("c2", "c")];
    const { shown, packCount } = boardCards(pool, { c1: 2 });
    expect(shown).toHaveLength(3);
    expect(packCount).toBe(0);
    expect(shown[0].id).toBe("c1");
  });

  it("caps the board at ten and counts the rest", () => {
    const pool = Array.from({ length: 30 }, (_, i) => card(`c${i}`, `t${i}`));
    const { shown, packCount } = boardCards(pool, { c5: 4, c9: 2 });
    expect(shown).toHaveLength(BOARD_CAP);
    expect(packCount).toBe(20);
    expect(shown[0].id).toBe("c5");
    expect(shown[1].id).toBe("c9");
  });

  it("orders identically for identical votes, by id", () => {
    const pool = [card("c2", "b"), card("c0", "a"), card("c1", "c")];
    expect(boardCards(pool, {}).shown.map((c) => c.id)).toEqual(["c0", "c1", "c2"]);
  });
});

describe("customShares", () => {
  it("is computed over voted cards only and sums to 100", () => {
    const pool = [card("c0", "a"), card("c1", "b"), card("c2", "c")];
    const shares = customShares(pool, { p0: { c0: 1 }, p1: { c1: 2 } });
    expect(shares.c2).toBeUndefined();
    expect(shares.c0 + shares.c1).toBe(100);
  });
});

describe("mergeBoard", () => {
  it("adds the tallies of identical texts into one entry", () => {
    const pool = [card("c0", "a", "p0"), card("c1", "a", "p1"), card("c2", "b")];
    const merged = mergeBoard(pool, { c0: 2, c1: 3, c2: 1 });
    expect(merged).toHaveLength(2);
    expect(merged[0].text).toBe("a");
    expect(merged[0].votes).toBe(5);
    expect(merged[0].cards.map((c) => c.id)).toEqual(["c0", "c1"]);
    expect(merged[1].votes).toBe(1);
  });

  it("keeps everyone who wrote the text, so the reveal loses nobody", () => {
    const pool = [card("c0", "a", "p0"), card("c1", "a", null), card("c2", "a", "p1")];
    const merged = mergeBoard(pool, {});
    expect(merged[0].cards.map((c) => c.authorId)).toEqual(["p0", null, "p1"]);
  });

  it("holds the order it was given, first appearance winning the slot", () => {
    const pool = [card("c0", "b"), card("c1", "a"), card("c2", "b")];
    expect(mergeBoard(pool, {}).map((e) => e.text)).toEqual(["b", "a"]);
  });

  it("leaves distinct texts alone", () => {
    const pool = [card("c0", "a"), card("c1", "b")];
    const merged = mergeBoard(pool, { c0: 1, c1: 1 });
    expect(merged.map((e) => e.cards.length)).toEqual([1, 1]);
  });
});

describe("customTextShares", () => {
  it("gives a merged text one share, not two halves of one", () => {
    // The bug this exists for: both cards read "a", so "a" is certain to be
    // drawn — and the board used to say 50% twice.
    const pool = [card("c0", "a", "p0"), card("c1", "a", "p1")];
    const shares = customTextShares(pool, { p0: { c0: 1 }, p1: { c1: 1 } });
    expect(shares.a).toBe(100);
  });

  it("agrees with the weight the draw actually uses", () => {
    // Two "a" cards at one vote each against one "b" at two: the draw sums by
    // text, so "a" and "b" are even, and the board must say so.
    const pool = [card("c0", "a", "p0"), card("c1", "a", "p1"), card("c2", "b")];
    const shares = customTextShares(pool, { p0: { c0: 1, c2: 2 }, p1: { c1: 1 } });
    expect(shares.a).toBe(50);
    expect(shares.b).toBe(50);
  });

  it("is computed over voted cards only and sums to 100", () => {
    const pool = [card("c0", "a"), card("c1", "b"), card("c2", "c")];
    const shares = customTextShares(pool, { p0: { c0: 1 }, p1: { c1: 2 } });
    expect(shares.c).toBeUndefined();
    expect(shares.a + shares.b).toBe(100);
  });
});

describe("pickCustomCategory", () => {
  it("draws a voted card before an unvoted one", () => {
    const pool = [card("c0", "alpha"), card("c1", "beta")];
    const votes = { p0: { c1: 3 } };
    for (const roll of [0, 0.25, 0.5, 0.75, 0.999]) {
      expect(pickCustomCategory(pool, votes, [], roll)).toBe("beta");
    }
  });

  it("falls back to the unvoted cards once the voted ones are spent", () => {
    const pool = [card("c0", "alpha"), card("c1", "beta")];
    const votes = { p0: { c1: 3 } };
    expect(pickCustomCategory(pool, votes, ["beta"], 0.5)).toBe("alpha");
  });

  it("merges identical texts into one entry with the summed weight", () => {
    // Two people wrote "smells". Two cards and two tallies through voting;
    // one entry in the draw, weighted 1 + 1 against "other"'s 2 — so the two
    // outcomes are equally likely rather than "smells" being half as likely.
    const pool = [
      card("c0", "smells", "p0"),
      card("c1", "smells", "p1"),
      card("c2", "other", "p2"),
    ];
    const votes = { p0: { c1: 1 }, p1: { c0: 1 }, p2: { c2: 2 } };
    expect(pickCustomCategory(pool, votes, [], 0.1)).toBe("smells");
    // 0.4 is the discriminating roll: correctly summed, "smells" is 2 of 4
    // and the boundary sits at 0.5, so 0.4 still lands on "smells". A buggy
    // merge that only counts one card's tally (first-wins or max instead of
    // sum) makes "smells" 1 of 3, pulling the boundary down to ~0.333 — at
    // which point 0.4 falls on "other" instead. 0.1 and 0.9 sit clear of both
    // boundaries and cannot tell the two implementations apart.
    expect(pickCustomCategory(pool, votes, [], 0.4)).toBe("smells");
    expect(pickCustomCategory(pool, votes, [], 0.9)).toBe("other");
  });

  it("never redraws a category already played", () => {
    const pool = [card("c0", "alpha"), card("c1", "beta")];
    expect(pickCustomCategory(pool, {}, ["alpha"], 0.9)).toBe("beta");
  });
});

import { slotStatesFor } from "./customCategories";

describe("slotStatesFor", () => {
  it("reads done from the text and writing from the cursor", () => {
    expect(slotStatesFor(["a", "", ""], 1, 3)).toEqual(["done", "writing", "empty"]);
  });

  it("does not call a slot writing once it is committed", () => {
    expect(slotStatesFor(["a", "b"], 0, 2)).toEqual(["done", "done"]);
  });

  it("treats whitespace as blank", () => {
    expect(slotStatesFor(["   "], 0, 1)).toEqual(["writing"]);
  });

  it("pads a short or missing draft array to the quota", () => {
    expect(slotStatesFor(undefined, 0, 2)).toEqual(["writing", "empty"]);
  });
});
