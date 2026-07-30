import { describe, expect, test } from "vitest";
import { BALLOT, CATEGORIES, DEFAULT_CATEGORY, RANDOM_CATEGORY } from "./categories";
import { MAX_ROUND_COUNT } from "./gamemodes";
import {
  pickCategory,
  spentCategories,
  tallyVotes,
  voteBudget,
  voteShares,
  votesSpent,
} from "./voting";
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
    // Insertion order is car, song, movie — the opposite of pool order — so
    // this only passes if the tie-break actually consults CATEGORIES rather
    // than riding Array.prototype.sort's stability over insertion order.
    // song is earliest in CATEGORIES among the three, so it takes the spare
    // point regardless of the order votes were entered in.
    const shares = voteShares({ p0: { car: 1, song: 1, movie: 1 } });
    expect(shares.song).toBe(34);
    expect(shares.movie).toBe(33);
    expect(shares.car).toBe(33);
  });

  test("no votes yields no shares rather than a divide by zero", () => {
    expect(voteShares({})).toEqual({});
  });
});

describe("spentCategories", () => {
  test("reads the categories out of history, oldest first", () => {
    const history = [
      { category: "song", places: {} },
      { category: "car", places: {} },
    ];
    expect(spentCategories({ history })).toEqual(["song", "car"]);
  });

  test("a fresh match has spent nothing", () => {
    expect(spentCategories({ history: [] })).toEqual([]);
  });
});

describe("the pool against the round cap", () => {
  test("a full match consumes the pool to the last card without exhausting it", () => {
    // The draw runs at round N with N-1 spent, so the worst case is round
    // MAX_ROUND_COUNT with one category left. Shrinking the pool below the
    // round cap would make the last-resort guard in pickCategory reachable and
    // let a match replay a category — this is the assertion that catches it.
    expect(CATEGORIES.length).toBeGreaterThanOrEqual(MAX_ROUND_COUNT);
  });

  test("the default category is in the pool", () => {
    expect(CATEGORIES).toContain(DEFAULT_CATEGORY);
  });
});

describe("pickCategory", () => {
  const votes: VoteMap = { p0: { song: 3 }, p1: { movie: 1 } };
  // song weighs 3, movie weighs 1, so the cumulative edge is at 0.75.

  test("a low roll lands in the heavy category", () => {
    expect(pickCategory(votes, [], 0)).toBe("song");
    expect(pickCategory(votes, [], 0.74)).toBe("song");
  });

  test("a roll past the edge lands in the light category", () => {
    expect(pickCategory(votes, [], 0.75)).toBe("movie");
    expect(pickCategory(votes, [], 0.99)).toBe("movie");
  });

  test("a roll of exactly 1 does not fall off the end", () => {
    expect(pickCategory(votes, [], 1)).toBe("movie");
  });

  test("proportions hold across the whole roll space", () => {
    let song = 0;
    for (let i = 0; i < 1000; i++) {
      if (pickCategory(votes, [], i / 1000) === "song") song += 1;
    }
    expect(song).toBe(750);
  });

  test("a spent category is never drawn again", () => {
    // song is spent, so every roll must land on movie even though song
    // carries three quarters of the vote.
    for (const roll of [0, 0.25, 0.5, 0.75, 0.99]) {
      expect(pickCategory(votes, ["song"], roll)).toBe("movie");
    }
  });

  test("shares recalculate once a category is spent", () => {
    const three: VoteMap = { p0: { song: 2, movie: 1, car: 1 } };
    // With song spent the pool is movie:1 car:1 — an even split at 0.5.
    expect(pickCategory(three, ["song"], 0.49)).toBe("movie");
    expect(pickCategory(three, ["song"], 0.51)).toBe("car");
  });

  test("once the voted categories are spent it draws from the unvoted ones", () => {
    const drawn = pickCategory(votes, ["song", "movie"], 0);
    expect(drawn).toBe(CATEGORIES.find((c) => c !== "song" && c !== "movie"));
    expect(["song", "movie"]).not.toContain(drawn);
  });

  test("the unvoted fallback is uniform, not weighted", () => {
    // 8 categories remain after song and movie are spent; a roll of 0.5 lands
    // on the 5th of them (indices 0-7, edge at 4/8 = 0.5). Derived from the
    // live pool rather than hardcoded, so resizing the pool moves the
    // expectation with it.
    const remaining = CATEGORIES.filter((c) => c !== "song" && c !== "movie");
    const mid = remaining.length / 2;
    expect(pickCategory(votes, ["song", "movie"], 0.5)).toBe(remaining[mid]);
  });

  test("no votes at all still yields a category", () => {
    expect(CATEGORIES).toContain(pickCategory({}, [], 0.5));
  });

  test("an all-spent pool falls back rather than throwing", () => {
    expect(CATEGORIES).toContain(pickCategory(votes, [...CATEGORIES], 0.5));
  });
});

describe("the random option", () => {
  test("it is on the ballot but never in the pool", () => {
    // The whole arrangement rests on this: everything that reads CATEGORIES as
    // "what a round can be about" — the draw, spentCategories, the archive's
    // played set — stays correct precisely because `random` is not in it.
    expect(CATEGORIES as readonly string[]).not.toContain(RANDOM_CATEGORY);
    expect(BALLOT).toContain(RANDOM_CATEGORY);
    expect(BALLOT[BALLOT.length - 1]).toBe(RANDOM_CATEGORY);
  });

  test("random is never itself drawn", () => {
    const votes: VoteMap = { p0: { [RANDOM_CATEGORY]: 5 } };
    for (let i = 0; i < 100; i++) {
      expect(pickCategory(votes, [], i / 100)).not.toBe(RANDOM_CATEGORY);
    }
  });

  test("an all-random room draws uniformly over the whole pool", () => {
    const votes: VoteMap = { p0: { [RANDOM_CATEGORY]: 3 } };
    // One segment covering the whole roll space, so the conditional position
    // inside it *is* the roll — every category has to come up.
    const drawn = new Set<string>();
    for (let i = 0; i < 1000; i++) drawn.add(pickCategory(votes, [], i / 1000));
    expect(drawn.size).toBe(CATEGORIES.length);
  });

  test("it never draws a spent category", () => {
    const votes: VoteMap = { p0: { [RANDOM_CATEGORY]: 2 } };
    for (let i = 0; i < 200; i++) {
      expect(pickCategory(votes, ["song", "movie"], i / 200)).not.toBe("song");
    }
  });

  test("it competes as an ordinary weight", () => {
    // song 1, random 3 — the segments are [0, .25) and [.25, 1), so three
    // quarters of the roll space goes to a uniform draw.
    const votes: VoteMap = { p0: { song: 1, [RANDOM_CATEGORY]: 3 } };
    expect(pickCategory(votes, [], 0.24)).toBe("song");
    let song = 0;
    for (let i = 0; i < 1000; i++) {
      if (pickCategory(votes, [], i / 1000) === "song") song += 1;
    }
    // 250 rolls land in song's own segment, plus random's share of the
    // uniform draw it hands off to — one tenth of the remaining 750.
    expect(song).toBeGreaterThan(250);
    expect(song).toBeLessThan(400);
  });

  test("the handoff is uniform, not a fixed pick", () => {
    // A roll at the bottom of random's segment and one at the top must land on
    // different categories, or the second stage is ignoring where the roll
    // actually fell and every random win draws the same thing.
    const votes: VoteMap = { p0: { [RANDOM_CATEGORY]: 1 } };
    expect(pickCategory(votes, [], 0)).toBe(CATEGORIES[0]);
    expect(pickCategory(votes, [], 0.999)).toBe(CATEGORIES[CATEGORIES.length - 1]);
  });

  test("random votes count toward the shares the room is shown", () => {
    const shares = voteShares({ p0: { song: 1, [RANDOM_CATEGORY]: 1 } });
    expect(shares).toEqual({ song: 50, [RANDOM_CATEGORY]: 50 });
  });

  test("random loses a remainder tie to every category", () => {
    // It is last on the ballot, so the ballot-order tie-break puts it last —
    // the point being that it has an order at all, where CATEGORIES.indexOf
    // would have given it -1 and floated it to the front.
    const shares = voteShares({ p0: { song: 1, movie: 1, [RANDOM_CATEGORY]: 1 } });
    expect(shares.song).toBe(34);
    expect(shares[RANDOM_CATEGORY]).toBe(33);
  });
});
