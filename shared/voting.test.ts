import { describe, expect, it, test } from "vitest";
import {
  BALLOT_SIZE,
  CATEGORIES,
  CATEGORY_POOL,
  DEFAULT_CATEGORY,
  RANDOM_CATEGORY,
  ballotOf,
  buildBallot,
  votableBallot,
} from "./categories";
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

/**
 * A match's ballot, as the draw now takes it: eight categories chosen for this
 * room, not the whole pool. Written out rather than drawn so the weighting
 * tests below can name the categories they are weighting.
 */
const POOL = [
  "song", "movie", "car make/model", "food",
  "job", "bird", "island", "plant",
] as const;
const BALLOT = [...POOL, RANDOM_CATEGORY];

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
      p1: { song: 1, "car make/model": 3 },
    };
    expect(tallyVotes(votes)).toEqual({ song: 3, movie: 1, "car make/model": 3 });
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
    expect(voteShares({ p0: { song: 1, movie: 1 } }, BALLOT)).toEqual({ song: 50, movie: 50 });
  });

  test("shares always sum to exactly 100", () => {
    // 3 categories at 1 vote each is 33.33% apiece — largest remainder has to
    // hand the spare point to somebody.
    const shares = voteShares({ p0: { song: 1, movie: 1, "car make/model": 1 } }, BALLOT);
    expect(Object.values(shares).reduce((a, b) => a + b, 0)).toBe(100);
  });

  test("a seven-way split still sums to exactly 100", () => {
    const row: Record<string, number> = {};
    for (const c of CATEGORIES.slice(0, 7)) row[c] = 1;
    const shares = voteShares({ p0: row }, BALLOT);
    expect(Object.values(shares).reduce((a, b) => a + b, 0)).toBe(100);
  });

  test("the spare point goes to the largest remainder", () => {
    // 2/3 = 66.66 (remainder .66), 1/3 = 33.33 (remainder .33).
    expect(voteShares({ p0: { song: 2, movie: 1 } }, BALLOT)).toEqual({ song: 67, movie: 33 });
  });

  test("ties in the remainder break by pool order, deterministically", () => {
    // Insertion order is car make/model, song, movie — the opposite of pool
    // order — so this only passes if the tie-break actually consults
    // CATEGORIES rather than riding Array.prototype.sort's stability over
    // insertion order.
    // song is earliest in CATEGORIES among the three, so it takes the spare
    // point regardless of the order votes were entered in.
    const shares = voteShares({ p0: { "car make/model": 1, song: 1, movie: 1 } }, BALLOT);
    expect(shares.song).toBe(34);
    expect(shares.movie).toBe(33);
    expect(shares["car make/model"]).toBe(33);
  });

  test("no votes yields no shares rather than a divide by zero", () => {
    expect(voteShares({}, BALLOT)).toEqual({});
  });
});

describe("spentCategories", () => {
  test("reads the categories out of history, oldest first", () => {
    const history = [
      { category: "song", places: {} },
      { category: "car make/model", places: {} },
    ];
    expect(spentCategories({ history })).toEqual(["song", "car make/model"]);
  });

  test("a fresh match has spent nothing", () => {
    expect(spentCategories({ history: [] })).toEqual([]);
  });
});

describe("the ballot against the round cap", () => {
  /**
   * The draw runs at round N with N-1 spent, so the worst case is round
   * MAX_ROUND_COUNT with one category left. A ballot shorter than the match
   * would make the last-resort guard in `pickCategory` reachable and let a
   * match replay a category — which is why `buildBallot` is asked for
   * `max(BALLOT_SIZE, roundCount)` rather than a flat eight.
   */
  test("a full-length match still gets a category per round", () => {
    const ballot = buildBallot("PLUM:1000", Math.max(BALLOT_SIZE, MAX_ROUND_COUNT));
    expect(ballot.length).toBeGreaterThanOrEqual(MAX_ROUND_COUNT);
  });

  test("an ordinary match votes between exactly eight", () => {
    expect(buildBallot("PLUM:1000", BALLOT_SIZE)).toHaveLength(8);
  });

  test("the pool is deep enough that a ballot is a real choice from it", () => {
    expect(CATEGORY_POOL.length).toBeGreaterThan(BALLOT_SIZE * 2);
  });

  test("the default category is one the pool can actually draw", () => {
    expect(CATEGORIES).toContain(DEFAULT_CATEGORY);
  });

  test("a ballot holds no duplicates", () => {
    for (let i = 0; i < 50; i++) {
      const ballot = buildBallot(`PLUM:${i}`);
      expect(new Set(ballot).size).toBe(ballot.length);
    }
  });

  test("different matches get different ballots", () => {
    const a = buildBallot("PLUM:1000").join("|");
    const b = buildBallot("PLUM:2000").join("|");
    expect(a).not.toBe(b);
  });

  test("the same match rebuilds the same ballot", () => {
    expect(buildBallot("PLUM:1000")).toEqual(buildBallot("PLUM:1000"));
  });

  /**
   * The templated entries are what make a pool this size feel larger: the slot
   * is drawn once, and the round it produces differs every match.
   */
  test("templates resolve to concrete categories", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      for (const c of buildBallot(`PLUM:${i}`, CATEGORY_POOL.length)) seen.add(c);
    }
    const letters = [...seen].filter((c) => c.startsWith("word starting with "));
    expect(letters.length).toBeGreaterThan(1);
    // Never one of the six letters that make the round a memory test.
    for (const c of letters) {
      expect("ZXQVNR").not.toContain(c.slice("word starting with ".length));
    }
    expect([...seen].some((c) => c.endsWith(" thing"))).toBe(true);
  });
});

describe("ballotOf", () => {
  test("uses the match's ballot when it has one", () => {
    expect(ballotOf({ code: "PLUM", ballot: ["bird"] })).toEqual(["bird"]);
  });

  /**
   * A room stored before the field existed, a view jump onto a voting screen,
   * and the lobby all read an empty one — and every client has to reach the
   * same answer as the server without it being broadcast first.
   */
  test("falls back to something derived from the room code", () => {
    const fallback = ballotOf({ code: "PLUM", ballot: [] });
    expect(fallback).toHaveLength(BALLOT_SIZE);
    expect(fallback).toEqual(ballotOf({ code: "PLUM", ballot: [] }));
    expect(fallback).not.toEqual(ballotOf({ code: "MOSS", ballot: [] }));
  });

  test("the random option is last on the votable ballot and never in the pool", () => {
    const votable = votableBallot({ code: "PLUM", ballot: [...POOL] });
    expect(votable).toContain(RANDOM_CATEGORY);
    expect(votable[votable.length - 1]).toBe(RANDOM_CATEGORY);
    expect(CATEGORIES as readonly string[]).not.toContain(RANDOM_CATEGORY);
  });
});

describe("pickCategory", () => {
  const votes: VoteMap = { p0: { song: 3 }, p1: { movie: 1 } };
  // song weighs 3, movie weighs 1, so the cumulative edge is at 0.75.

  test("a low roll lands in the heavy category", () => {
    expect(pickCategory(votes, [], 0, POOL)).toBe("song");
    expect(pickCategory(votes, [], 0.74, POOL)).toBe("song");
  });

  test("a roll past the edge lands in the light category", () => {
    expect(pickCategory(votes, [], 0.75, POOL)).toBe("movie");
    expect(pickCategory(votes, [], 0.99, POOL)).toBe("movie");
  });

  test("a roll of exactly 1 does not fall off the end", () => {
    expect(pickCategory(votes, [], 1, POOL)).toBe("movie");
  });

  test("proportions hold across the whole roll space", () => {
    let song = 0;
    for (let i = 0; i < 1000; i++) {
      if (pickCategory(votes, [], i / 1000, POOL) === "song") song += 1;
    }
    expect(song).toBe(750);
  });

  test("a spent category is never drawn again", () => {
    // song is spent, so every roll must land on movie even though song
    // carries three quarters of the vote.
    for (const roll of [0, 0.25, 0.5, 0.75, 0.99]) {
      expect(pickCategory(votes, ["song"], roll, POOL)).toBe("movie");
    }
  });

  test("shares recalculate once a category is spent", () => {
    const three: VoteMap = { p0: { song: 2, movie: 1, "car make/model": 1 } };
    // With song spent the pool is movie:1 car make/model:1 — an even split
    // at 0.5.
    expect(pickCategory(three, ["song"], 0.49, POOL)).toBe("movie");
    expect(pickCategory(three, ["song"], 0.51, POOL)).toBe("car make/model");
  });

  test("once the voted categories are spent it draws from the unvoted ones", () => {
    const drawn = pickCategory(votes, ["song", "movie"], 0, POOL);
    expect(drawn).toBe(POOL.find((c) => c !== "song" && c !== "movie"));
    expect(["song", "movie"]).not.toContain(drawn);
  });

  test("the unvoted fallback is uniform, not weighted", () => {
    // 8 categories remain after song and movie are spent; a roll of 0.5 lands
    // on the 5th of them (indices 0-7, edge at 4/8 = 0.5). Derived from the
    // live pool rather than hardcoded, so resizing the pool moves the
    // expectation with it.
    const remaining = POOL.filter((c) => c !== "song" && c !== "movie");
    const mid = remaining.length / 2;
    expect(pickCategory(votes, ["song", "movie"], 0.5, POOL)).toBe(remaining[mid]);
  });

  test("no votes at all still yields a category", () => {
    expect(POOL).toContain(pickCategory({}, [], 0.5, POOL));
  });

  test("an all-spent pool falls back rather than throwing", () => {
    expect(POOL).toContain(pickCategory(votes, [...POOL], 0.5, POOL));
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
      expect(pickCategory(votes, [], i / 100, POOL)).not.toBe(RANDOM_CATEGORY);
    }
  });

  test("an all-random room draws uniformly over the whole pool", () => {
    const votes: VoteMap = { p0: { [RANDOM_CATEGORY]: 3 } };
    // One segment covering the whole roll space, so the conditional position
    // inside it *is* the roll — every category has to come up.
    const drawn = new Set<string>();
    for (let i = 0; i < 1000; i++) drawn.add(pickCategory(votes, [], i / 1000, POOL));
    expect(drawn.size).toBe(POOL.length);
  });

  test("it never draws a spent category", () => {
    const votes: VoteMap = { p0: { [RANDOM_CATEGORY]: 2 } };
    for (let i = 0; i < 200; i++) {
      expect(pickCategory(votes, ["song", "movie"], i / 200, POOL)).not.toBe("song");
    }
  });

  test("it competes as an ordinary weight", () => {
    // song 1, random 3 — the segments are [0, .25) and [.25, 1), so three
    // quarters of the roll space goes to a uniform draw.
    const votes: VoteMap = { p0: { song: 1, [RANDOM_CATEGORY]: 3 } };
    expect(pickCategory(votes, [], 0.24, POOL)).toBe("song");
    let song = 0;
    for (let i = 0; i < 1000; i++) {
      if (pickCategory(votes, [], i / 1000, POOL) === "song") song += 1;
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
    expect(pickCategory(votes, [], 0, POOL)).toBe(POOL[0]);
    expect(pickCategory(votes, [], 0.999, POOL)).toBe(POOL[POOL.length - 1]);
  });

  test("random votes count toward the shares the room is shown", () => {
    const shares = voteShares({ p0: { song: 1, [RANDOM_CATEGORY]: 1 } }, BALLOT);
    expect(shares).toEqual({ song: 50, [RANDOM_CATEGORY]: 50 });
  });

  test("random loses a remainder tie to every category", () => {
    // It is last on the ballot, so the ballot-order tie-break puts it last —
    // the point being that it has an order at all, where CATEGORIES.indexOf
    // would have given it -1 and floated it to the front.
    const shares = voteShares({ p0: { song: 1, movie: 1, [RANDOM_CATEGORY]: 1 } }, BALLOT);
    expect(shares.song).toBe(34);
    expect(shares[RANDOM_CATEGORY]).toBe(33);
  });
});

describe("voteShares with an explicit order", () => {
  it("breaks remainder ties by the given order rather than the ballot", () => {
    const votes = { a: { x: 1 }, b: { y: 1 }, c: { z: 1 } };
    const shares = voteShares(votes, ["z", "y", "x"]);
    expect(shares.x + shares.y + shares.z).toBe(100);
    // 33.33 each: the extra point goes to whichever sorts first in `order`.
    expect(shares.z).toBe(34);
  });
});
