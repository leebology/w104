import { describe, expect, test } from "vitest";
import { CATEGORIES } from "./categories";
import { tallyVotes, voteBudget, voteShares, votesSpent } from "./voting";
import type { VoteMap } from "./voting";

describe("voteBudget", () => {
  test("one round and two rounds both give a single vote", () => {
    expect(voteBudget({ roundCount: 1 })).toBe(1);
    expect(voteBudget({ roundCount: 2 })).toBe(1);
  });

  test("beyond two rounds it is one less than the round count", () => {
    expect(voteBudget({ roundCount: 3 })).toBe(2);
    expect(voteBudget({ roundCount: 4 })).toBe(3);
    expect(voteBudget({ roundCount: 10 })).toBe(9);
  });

  test("the floor holds against a nonsense round count", () => {
    expect(voteBudget({ roundCount: 0 })).toBe(1);
    expect(voteBudget({ roundCount: -5 })).toBe(1);
  });
});

describe("votesSpent", () => {
  test("sums a row", () => {
    expect(votesSpent({ song: 2, movie: 1 })).toBe(3);
  });

  test("a player who has not voted has spent nothing", () => {
    expect(votesSpent(undefined)).toBe(0);
    expect(votesSpent({})).toBe(0);
  });
});

describe("tallyVotes", () => {
  test("adds every player's row together", () => {
    const votes: VoteMap = {
      p0: { song: 2, movie: 1 },
      p1: { song: 1, car: 3 },
    };
    expect(tallyVotes(votes)).toEqual({ song: 3, movie: 1, car: 3 });
  });

  test("an empty pool tallies to nothing", () => {
    expect(tallyVotes({})).toEqual({});
  });

  test("zero-count entries are dropped rather than carried as zero", () => {
    expect(tallyVotes({ p0: { song: 0, movie: 2 } })).toEqual({ movie: 2 });
  });
});

describe("voteShares", () => {
  test("clean thirds and halves", () => {
    expect(voteShares({ p0: { song: 1, movie: 1 } })).toEqual({ song: 50, movie: 50 });
  });

  test("shares always sum to exactly 100", () => {
    // 3 categories at 1 vote each is 33.33% apiece — largest remainder has to
    // hand the spare point to somebody.
    const shares = voteShares({ p0: { song: 1, movie: 1, car: 1 } });
    expect(Object.values(shares).reduce((a, b) => a + b, 0)).toBe(100);
  });

  test("a seven-way split still sums to exactly 100", () => {
    const row: Record<string, number> = {};
    for (const c of CATEGORIES.slice(0, 7)) row[c] = 1;
    const shares = voteShares({ p0: row });
    expect(Object.values(shares).reduce((a, b) => a + b, 0)).toBe(100);
  });

  test("the spare point goes to the largest remainder", () => {
    // 2/3 = 66.66 (remainder .66), 1/3 = 33.33 (remainder .33).
    expect(voteShares({ p0: { song: 2, movie: 1 } })).toEqual({ song: 67, movie: 33 });
  });

  test("ties in the remainder break by pool order, deterministically", () => {
    // song is earlier in CATEGORIES than movie, so it takes the spare point.
    const shares = voteShares({ p0: { song: 1, movie: 1, car: 1 } });
    expect(shares.song).toBe(34);
    expect(shares.movie).toBe(33);
    expect(shares.car).toBe(33);
  });

  test("no votes yields no shares rather than a divide by zero", () => {
    expect(voteShares({})).toEqual({});
  });
});
