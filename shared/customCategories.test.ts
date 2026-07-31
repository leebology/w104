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
