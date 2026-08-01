import { describe, expect, test } from "vitest";
import {
  MAX_LINE_MS,
  MIN_LINE_MS,
  REVEAL_TIMING,
  activeColumn,
  buildSchedule,
  cardView,
  cueStep,
  entryOrder,
  finalOrder,
  finalRanks,
  nextChangeAt,
  rowKey,
  rowView,
  seededRng,
  stepAt,
  uniqueDirection,
  withSelfStrikes,
} from "./reveal";
import { NO_SELF_MARKS, toggleMark } from "./selfstrike";
import { scoreRound } from "./scoring";
import type { Results } from "./scoring";
import type { Scorer } from "./teams";

/** A free-for-all roster: one scorer per player, ids `p1`… */
function soloRoster(n: number): Scorer[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player ${i + 1}`,
    emoji: "🙂",
    colorIndex: null,
    members: [`p${i + 1}`],
  }));
}

/** Scores the given lists, one per player, in order. */
function score(lists: string[][]): Results {
  const scorers = soloRoster(lists.length);
  const entries = Object.fromEntries(
    lists.map((words, i) => [
      scorers[i].id,
      words.map((text, j) => ({ text, by: scorers[i].id, at: j })),
    ]),
  );
  return scoreRound({ scorers, entries });
}

const inEntryOrder = (rng = seededRng("fixed")) =>
  ({ playerOrder: "random", lineOrder: "entry", rng }) as const;

describe("seededRng", () => {
  test("is deterministic for a given seed", () => {
    const a = seededRng("room-JADE:1");
    const b = seededRng("room-JADE:1");
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  test("differs between seeds", () => {
    expect(seededRng("round-1")()).not.toBe(seededRng("round-2")());
  });

  test("stays in [0, 1)", () => {
    const rng = seededRng("bounds");
    for (let i = 0; i < 500; i++) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("buildSchedule", () => {
  test("gives every row its own step, one column at a time", () => {
    const results = score([
      ["adele", "rihanna"],
      ["beyonce", "cher"],
    ]);
    const schedule = buildSchedule(results, inEntryOrder());

    expect(schedule.order).toHaveLength(2);
    expect(schedule.lastStep).toBe(4);
    const [first, second] = schedule.order;
    expect(schedule.colStart[first]).toBe(1);
    expect(schedule.colStart[second]).toBe(3);
    expect(schedule.stepOf[rowKey(first, 0)]).toBe(1);
    expect(schedule.stepOf[rowKey(first, 1)]).toBe(2);
    expect(schedule.stepOf[rowKey(second, 0)]).toBe(3);
  });

  test("an empty list takes no steps and no beat", () => {
    const results = score([["adele"], [], ["cher"]]);
    const schedule = buildSchedule(results, inEntryOrder());

    expect(schedule.order).not.toContain("p2");
    expect(schedule.colStart["p2"]).toBeUndefined();
    expect(schedule.lastStep).toBe(2);
  });

  test("nobody wrote anything", () => {
    const schedule = buildSchedule(score([[], []]), inEntryOrder());
    expect(schedule.order).toEqual([]);
    expect(schedule.lastStep).toBe(0);
    expect(activeColumn(schedule, 0)).toBeNull();
  });

  test("pacing is uniform — no list length changes any interval", () => {
    // Steps are consecutive integers regardless of how long a list is: the
    // driver spends the same wall time on every line.
    const schedule = buildSchedule(
      score([["a1", "a2", "a3", "a4", "a5"], ["b1"]]),
      inEntryOrder(),
    );
    const steps = Object.values(schedule.stepOf).sort((a, b) => a - b);
    expect(steps).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("shortest-first orders columns by list length", () => {
    const results = score([["a1", "a2", "a3"], ["b1"], ["c1", "c2"]]);
    const schedule = buildSchedule(results, {
      playerOrder: "shortest",
      lineOrder: "entry",
      rng: seededRng("x"),
    });
    expect(schedule.order).toEqual(["p2", "p3", "p1"]);
  });

  test("longest-first is the reverse", () => {
    const results = score([["a1", "a2", "a3"], ["b1"], ["c1", "c2"]]);
    const schedule = buildSchedule(results, {
      playerOrder: "longest",
      lineOrder: "entry",
      rng: seededRng("x"),
    });
    expect(schedule.order).toEqual(["p1", "p3", "p2"]);
  });

  test("duplicates-first holds a column's uniques back to the end", () => {
    const results = score([
      ["shared one", "mine alone", "shared two"],
      ["shared one", "shared two"],
    ]);
    const schedule = buildSchedule(results, {
      playerOrder: "shortest", // p2 (2 words) first, p1 second
      lineOrder: "duplicates",
      rng: seededRng("x"),
    });
    // p1's own line order: the two shared words, then "mine alone" last.
    expect(schedule.stepOf[rowKey("p1", 1)]).toBe(schedule.lastStep);
  });

  test("a seed replays the same column order", () => {
    const results = score([["a"], ["b"], ["c"], ["d"], ["e"]]);
    const one = buildSchedule(results, inEntryOrder(seededRng("JADE:3")));
    const two = buildSchedule(results, inEntryOrder(seededRng("JADE:3")));
    expect(one.order).toEqual(two.order);
  });

  test("partners are the other scorers' matching rows, fuzzy match included", () => {
    // "zendya" is one edit from "zendaya" at 6 characters, so they cluster.
    const results = score([
      ["zendaya", "solo word"],
      ["zendya"],
    ]);
    const schedule = buildSchedule(results, inEntryOrder());
    expect(schedule.partners[rowKey("p1", 0)]).toEqual([
      { scorerId: "p2", index: 0 },
    ]);
    expect(schedule.partners[rowKey("p1", 1)]).toEqual([]);
  });

  test("the cadence defaults to REVEAL_TIMING and paces every step", () => {
    const schedule = buildSchedule(score([["a", "b"]]), inEntryOrder());
    expect(schedule.lineMs).toBe(REVEAL_TIMING.LINE_INTERVAL);
    // Step 1 opens the only column, so it pays the column pause as well.
    expect(schedule.timeOf[1] - schedule.timeOf[0]).toBe(
      REVEAL_TIMING.LINE_INTERVAL + REVEAL_TIMING.COLUMN_PAUSE,
    );
    expect(schedule.timeOf[2] - schedule.timeOf[1]).toBe(REVEAL_TIMING.LINE_INTERVAL);
  });

  test("a supplied cadence scales the column pause with it", () => {
    const half = REVEAL_TIMING.LINE_INTERVAL / 2;
    const schedule = buildSchedule(score([["a", "b"]]), {
      ...inEntryOrder(),
      lineMs: half,
    });
    expect(schedule.lineMs).toBe(half);
    expect(schedule.timeOf[2] - schedule.timeOf[1]).toBe(half);
    expect(schedule.timeOf[1] - schedule.timeOf[0]).toBe(
      half + REVEAL_TIMING.COLUMN_PAUSE / 2,
    );
  });

  test("an out-of-range cadence is clamped rather than trusted", () => {
    const fast = buildSchedule(score([["a"]]), { ...inEntryOrder(), lineMs: 0 });
    expect(fast.lineMs).toBe(MIN_LINE_MS);
    const slow = buildSchedule(score([["a"]]), { ...inEntryOrder(), lineMs: 1e9 });
    expect(slow.lineMs).toBe(MAX_LINE_MS);
    const junk = buildSchedule(score([["a"]]), { ...inEntryOrder(), lineMs: NaN });
    expect(junk.lineMs).toBe(REVEAL_TIMING.LINE_INTERVAL);
  });
});

describe("rowView", () => {
  const results = score([
    ["adele", "rihanna"], // p1
    ["adele", "cher"], //    p2
  ]);
  // Fixed order so the assertions can talk about columns by name.
  const schedule = buildSchedule(results, {
    playerOrder: "shortest",
    lineOrder: "entry",
    rng: seededRng("x"),
  });
  // Equal lengths, stable sort: p1 then p2. Steps 1,2 then 3,4.

  test("a row is not rendered before its step", () => {
    expect(rowView(schedule, "p1", 0, 0).revealed).toBe(false);
    expect(rowView(schedule, "p1", 0, 1).revealed).toBe(true);
  });

  test("the first column strikes nothing", () => {
    expect(rowView(schedule, "p1", 0, 2).struck).toBe(false);
    expect(rowView(schedule, "p1", 0, 2).alsoShown).toEqual([]);
  });

  test("back-check: an already-revealed row flips when a later column lands", () => {
    const before = rowView(schedule, "p1", 0, 2);
    const after = rowView(schedule, "p1", 0, 3);
    expect(before.struck).toBe(false);
    expect(after.struck).toBe(true);
    expect(after.backCheck).toBe(true);
    expect(after.struckAt).toBe(3);
    expect(after.alsoShown).toEqual(["p2"]);
  });

  test("a partner with two near-spellings appears in the trail once", () => {
    const twice = score([["zendaya"], ["zendya", "zendaya"]]);
    const sched = buildSchedule(twice, {
      playerOrder: "shortest", // p1 (1 word) first, p2 second
      lineOrder: "entry",
      rng: seededRng("x"),
    });
    expect(rowView(sched, "p1", 0, sched.lastStep).alsoShown).toEqual(["p2"]);
  });

  test("a word landing already-duplicated strikes on its own step, not before", () => {
    const row = rowView(schedule, "p2", 0, 3);
    expect(row.struck).toBe(true);
    expect(row.struckAt).toBe(3);
    // Not a back-check: this is the active column's own word, so its card must
    // not flinch at it.
    expect(row.backCheck).toBe(false);
  });

  test("the trail grows as more columns land, and pops each time", () => {
    const three = score([
      ["adele", "rihanna"], // p1: steps 1,2
      ["adele"], //            p2: step 3
      ["adele"], //            p3: step 4
    ]);
    const s = buildSchedule(three, {
      playerOrder: "longest",
      lineOrder: "entry",
      rng: seededRng("x"),
    });
    expect(s.order).toEqual(["p1", "p2", "p3"]);

    expect(rowView(s, "p1", 0, 2).alsoShown).toEqual([]);
    expect(rowView(s, "p1", 0, 3).alsoShown).toEqual(["p2"]);
    expect(rowView(s, "p1", 0, 3).poppedAt).toBe(3);
    expect(rowView(s, "p1", 0, 4).alsoShown).toEqual(["p2", "p3"]);
    expect(rowView(s, "p1", 0, 4).poppedAt).toBe(4);
  });

  test("a scorer appears once in the trail even with two near-spellings", () => {
    const results2 = score([
      ["zendaya"], //            p1
      ["zendaya", "zendya"], //  p2 — both cluster with p1's
    ]);
    const s = buildSchedule(results2, {
      playerOrder: "shortest",
      lineOrder: "entry",
      rng: seededRng("x"),
    });
    expect(s.order).toEqual(["p1", "p2"]);
    expect(rowView(s, "p1", 0, s.lastStep).alsoShown).toEqual(["p2"]);
  });

  test("the last column is a cascade — many rows strike on one step", () => {
    const results2 = score([
      ["adele", "cher", "pink"], // p1: 1,2,3
      ["adele", "cher", "pink"], // p2: 4,5,6
    ]);
    const s = buildSchedule(results2, {
      playerOrder: "shortest",
      lineOrder: "entry",
      rng: seededRng("x"),
    });
    // Nothing struck while only p1 is out…
    expect(cardView(s, results2.scorers[0], 3).unique).toBe(3);
    // …then p1's three rows go one at a time as p2 lands each word.
    expect(cardView(s, results2.scorers[0], 4).unique).toBe(2);
    expect(cardView(s, results2.scorers[0], 6).unique).toBe(0);
  });

  test("an unrevealed row never reports struck, however many partners are out", () => {
    const results2 = score([
      ["adele"], //          p1
      ["cher", "adele"], //  p2 — "adele" is its second line
    ]);
    const s = buildSchedule(results2, {
      playerOrder: "longest",
      lineOrder: "entry",
      rng: seededRng("x"),
    });
    expect(s.order).toEqual(["p2", "p1"]);
    // p2's "adele" is out at step 2; p1's row does not exist yet at step 2.
    expect(rowView(s, "p1", 0, 2).revealed).toBe(false);
    expect(rowView(s, "p1", 0, 2).struck).toBe(false);
    // It lands at step 3 and strikes on that same step, never earlier.
    expect(rowView(s, "p1", 0, 3).struckAt).toBe(3);
  });
});

describe("cardView", () => {
  test("UNIQUE opens at TOTAL and only counts down", () => {
    const results = score([
      ["adele", "cher", "pink"],
      ["adele", "rihanna"],
    ]);
    const schedule = buildSchedule(results, {
      playerOrder: "longest",
      lineOrder: "entry",
      rng: seededRng("x"),
    });
    const p1 = results.scorers[0];

    const counts = [];
    for (let step = 0; step <= schedule.lastStep; step++) {
      counts.push(cardView(schedule, p1, step).unique);
    }
    expect(counts[0]).toBe(p1.total);
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
    }
    expect(counts[counts.length - 1]).toBe(p1.unique);
  });

  test("every scorer's final UNIQUE matches the scored result", () => {
    const results = score([
      ["adele", "cher", "pink", "sia"],
      ["adele", "rihanna", "sia"],
      ["cher", "madonna"],
    ]);
    const schedule = buildSchedule(results, inEntryOrder());
    for (const scorer of results.scorers) {
      expect(cardView(schedule, scorer, schedule.lastStep).unique).toBe(scorer.unique);
    }
  });

  test("the active card does not flinch at its own words", () => {
    const results = score([["adele"], ["adele"]]);
    const schedule = buildSchedule(results, {
      playerOrder: "shortest",
      lineOrder: "entry",
      rng: seededRng("x"),
    });
    const [first, second] = schedule.order;
    const at = (id: string) => results.scorers.find((s) => s.id === id)!;

    // Step 2 strikes both: the first column back-checks (it flinches), the
    // second is the active column landing its own duplicate (it does not).
    expect(cardView(schedule, at(first), 2).flinchAt).toBe(2);
    expect(cardView(schedule, at(second), 2).flinchAt).toBeNull();
    // The stat blinks on both, because both counts moved.
    expect(cardView(schedule, at(second), 2).struckAt).toBe(2);
  });

  test("an empty list holds zero of everything", () => {
    const results = score([["adele"], []]);
    const schedule = buildSchedule(results, inEntryOrder());
    const empty = results.scorers[1];
    expect(cardView(schedule, empty, schedule.lastStep)).toEqual({
      shown: 0,
      unique: 0,
      struckAt: null,
      flinchAt: null,
      strikeCount: 0,
      flinchCount: 0,
      selfMarkCount: 0,
      selfDirection: null,
      selfMarkAt: null,
    });
  });

  test("a wholly duplicated list ends on UNIQUE 0", () => {
    const results = score([
      ["adele", "cher"],
      ["adele", "cher", "pink"],
    ]);
    const schedule = buildSchedule(results, inEntryOrder());
    expect(cardView(schedule, results.scorers[0], schedule.lastStep).unique).toBe(0);
  });
});

describe("activeColumn and cueStep", () => {
  const results = score([["a1", "a2"], ["b1"]]);
  const schedule = buildSchedule(results, {
    playerOrder: "longest",
    lineOrder: "entry",
    rng: seededRng("x"),
  });

  test("no column is active before the first line or after the last", () => {
    expect(activeColumn(schedule, 0)).toBeNull();
    expect(activeColumn(schedule, schedule.lastStep + 1)).toBeNull();
  });

  test("the active column is the one whose lines are landing", () => {
    expect(activeColumn(schedule, 1)).toBe("p1");
    expect(activeColumn(schedule, 2)).toBe("p1");
    expect(activeColumn(schedule, 3)).toBe("p2");
  });

  test("a column is cued on its predecessor's last line", () => {
    expect(cueStep(schedule, "p1")).toBe(0);
    expect(cueStep(schedule, "p2")).toBe(2);
  });
});

describe("finalOrder and finalRanks", () => {
  const scorer = (id: string, unique: number, total: number) => ({
    id,
    name: id,
    emoji: "",
    colorIndex: null,
    members: [id],
    unique,
    total,
    entries: [],
  });

  test("orders by unique, then total", () => {
    const order = finalOrder([
      scorer("a", 2, 9),
      scorer("b", 5, 5),
      scorer("c", 2, 12),
    ]);
    expect(order.map((s) => s.id)).toEqual(["b", "c", "a"]);
  });

  test("ties share a place and the next place skips", () => {
    const ranks = finalRanks([
      scorer("a", 5, 7),
      scorer("b", 3, 4),
      scorer("c", 3, 4),
      scorer("d", 1, 1),
    ]);
    expect(ranks).toEqual({ a: 1, b: 2, c: 2, d: 4 });
  });

  test("equal unique but different total is not a tie", () => {
    const ranks = finalRanks([scorer("a", 3, 9), scorer("b", 3, 4)]);
    expect(ranks).toEqual({ a: 1, b: 2 });
  });

  test("a tie for first means two golds and no silver", () => {
    const ranks = finalRanks([
      scorer("a", 4, 6),
      scorer("b", 4, 6),
      scorer("c", 2, 2),
    ]);
    expect(Object.values(ranks).filter((r) => r === 1)).toHaveLength(2);
    expect(Object.values(ranks)).not.toContain(2);
    expect(ranks.c).toBe(3);
  });

  test("a tie is asserted on the derived outcome, not on list lengths", () => {
    // Equal-length lists deriving equal unique *and* equal total. p1 and p2 both
    // write three words, each sharing exactly one with p3.
    const results = score([
      ["adele", "cher", "shared one"],
      ["madonna", "rihanna", "shared two"],
      ["shared one", "shared two"],
    ]);
    const [p1, p2] = results.scorers;
    expect(p1.unique).toBe(p2.unique);
    expect(p1.total).toBe(p2.total);
    expect(finalRanks(results.scorers).p1).toBe(finalRanks(results.scorers).p2);
  });
});

describe("entryOrder", () => {
  const scorers = score([["a"], ["b"], ["c"]]).scorers;

  test("round one is a seeded scatter, stable across replays", () => {
    const one = entryOrder(scorers, null, seededRng("JADE:1"));
    const two = entryOrder(scorers, null, seededRng("JADE:1"));
    expect(one).toEqual(two);
    expect([...one].sort()).toEqual(["p1", "p2", "p3"]);
  });

  test("later rounds deal in standings order, best first", () => {
    const order = entryOrder(scorers, { p1: 3, p2: 1, p3: 2 }, seededRng("x"));
    expect(order).toEqual(["p2", "p3", "p1"]);
  });

  test("a scorer missing from the standings deals last rather than vanishing", () => {
    const order = entryOrder(scorers, { p2: 1, p3: 2 }, seededRng("x"));
    expect(order).toEqual(["p2", "p3", "p1"]);
  });
});

describe("the clock-driven schedule", () => {
  const timing = REVEAL_TIMING;

  test("frame 1 lasts one swing plus a stagger per card", () => {
    const schedule = buildSchedule(score([["a"], ["b"], ["c"]]), inEntryOrder());
    expect(schedule.dealMs).toBe(2 * timing.DEAL_STAGGER + timing.DEAL_DURATION);
    expect(schedule.timeOf[0]).toBe(schedule.dealMs);
  });

  test("a column's first line waits the extra beat; the rest do not", () => {
    const schedule = buildSchedule(
      score([
        ["adele", "cher"],
        ["pink"],
      ]),
      { playerOrder: "shortest", lineOrder: "entry", rng: seededRng("x") },
    );
    // Shortest first: p2's single line opens, then p1's two.
    const [first, second, third] = [1, 2, 3].map((s) => schedule.timeOf[s]);
    expect(first - schedule.dealMs).toBe(timing.LINE_INTERVAL + timing.COLUMN_PAUSE);
    expect(second - first).toBe(timing.LINE_INTERVAL + timing.COLUMN_PAUSE);
    expect(third - second).toBe(timing.LINE_INTERVAL);
  });

  test("stepAt holds at zero through frame 1 and then follows the clock", () => {
    const schedule = buildSchedule(score([["adele", "cher"]]), inEntryOrder());
    expect(stepAt(schedule, 0)).toBe(0);
    expect(stepAt(schedule, schedule.dealMs)).toBe(0);
    expect(stepAt(schedule, schedule.timeOf[1] - 1)).toBe(0);
    expect(stepAt(schedule, schedule.timeOf[1])).toBe(1);
    expect(stepAt(schedule, schedule.timeOf[2])).toBe(2);
  });

  test("stepAt never runs past the last line, however late the client is", () => {
    const schedule = buildSchedule(score([["adele", "cher"]]), inEntryOrder());
    expect(stepAt(schedule, 10 * 60 * 1000)).toBe(schedule.lastStep);
  });

  test("nextChangeAt names the deal edge, then each line, then nothing", () => {
    const schedule = buildSchedule(score([["adele"]]), inEntryOrder());
    expect(nextChangeAt(schedule, 0)).toBe(schedule.dealMs);
    expect(nextChangeAt(schedule, schedule.dealMs)).toBe(schedule.timeOf[1]);
    expect(nextChangeAt(schedule, schedule.timeOf[1])).toBeNull();
  });

  test("a round nobody wrote in has one edge and then nothing", () => {
    const schedule = buildSchedule(score([[], []]), inEntryOrder());
    expect(schedule.lastStep).toBe(0);
    expect(nextChangeAt(schedule, 0)).toBe(schedule.dealMs);
    expect(nextChangeAt(schedule, schedule.dealMs)).toBeNull();
  });
});

describe("flash ordinals", () => {
  /**
   * The bug these exist for: keying a flash off the *step* a strike landed on
   * means two strikes an even number of steps apart share a parity, the class
   * string does not change, the CSS animation never re-fires and the flash is
   * silently skipped. Counting strikes instead alternates on every one.
   */
  test("the strike count rises by one per strike, so its parity alternates", () => {
    // p1 is caught out on cher and pink, two steps apart — same step parity.
    const results = score([
      ["adele", "cher", "pink"],
      ["cher", "sia", "pink"],
    ]);
    const schedule = buildSchedule(results, {
      playerOrder: "shortest",
      lineOrder: "entry",
      rng: seededRng("x"),
    });
    const p1 = results.scorers[0];
    const counts = Array.from(
      { length: schedule.lastStep + 1 },
      (_, step) => cardView(schedule, p1, step).strikeCount,
    );
    // Monotone, and never jumps — every strike gets its own parity flip.
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i] - counts[i - 1]).toBeGreaterThanOrEqual(0);
      expect(counts[i] - counts[i - 1]).toBeLessThanOrEqual(1);
    }
    expect(counts[counts.length - 1]).toBe(2);
    // The steps those two strikes landed on share a parity: the old bug.
    const struckSteps = [0, 1, 2].map(
      (i) => rowView(schedule, p1.id, i, schedule.lastStep).struckAt,
    );
    const landed = struckSteps.filter((s): s is number => s !== null);
    expect(landed).toHaveLength(2);
    expect(landed[0] % 2).toBe(landed[1] % 2);
  });

  test("strikeCount and unique are two views of the same number", () => {
    const results = score([
      ["adele", "cher"],
      ["cher", "pink"],
    ]);
    const schedule = buildSchedule(results, inEntryOrder());
    for (const scorer of results.scorers) {
      for (let step = 0; step <= schedule.lastStep; step++) {
        const card = cardView(schedule, scorer, step);
        expect(card.unique).toBe(scorer.entries.length - card.strikeCount);
      }
    }
  });

  test("flinchCount counts back-checks only, never the active card's own", () => {
    const results = score([
      ["adele", "cher"],
      ["cher"],
    ]);
    const schedule = buildSchedule(results, {
      playerOrder: "longest",
      lineOrder: "entry",
      rng: seededRng("x"),
    });
    // p1 reveals first, so its cher is struck later, from behind: a flinch.
    expect(cardView(schedule, results.scorers[0], schedule.lastStep).flinchCount).toBe(1);
    // p2's own cher lands already duplicated, which is not a flinch.
    expect(cardView(schedule, results.scorers[1], schedule.lastStep).flinchCount).toBe(0);
  });

  test("popCount grows once per arrival in the trail", () => {
    const results = score([["adele"], ["adele"], ["adele"]]);
    const schedule = buildSchedule(results, inEntryOrder());
    const first = schedule.order[0];
    const counts = Array.from(
      { length: schedule.lastStep + 1 },
      (_, step) => rowView(schedule, first, 0, step).popCount,
    );
    expect(counts).toEqual([0, 0, 1, 2]);
  });
});

describe("self-validation", () => {
  const marksFor = (...rows: string[]) =>
    rows.reduce((marks, row, i) => toggleMark(marks, row, true, 1_000 + i), NO_SELF_MARKS);

  test("a self-struck row reads struck and marked, and its partners are unchanged", () => {
    const results = score([["adele", "cher"], ["cher"]]);
    const schedule = buildSchedule(results, inEntryOrder());
    const marks = marksFor(rowKey("p1", 0));

    const row = rowView(schedule, "p1", 0, schedule.lastStep, marks);
    expect(row.selfStruck).toBe(true);
    expect(row.selfMarks).toBe(1);
    // `struck` stays the round's own verdict — adele was nobody else's word.
    // The two are composed by the screens, never folded together here.
    expect(row.struck).toBe(false);
    expect(row.alsoShown).toEqual([]);
  });

  test("marks on one row leave every other row alone", () => {
    const results = score([["adele", "cher"], ["cher"]]);
    const schedule = buildSchedule(results, inEntryOrder());
    const marks = marksFor(rowKey("p1", 0));
    expect(rowView(schedule, "p1", 1, schedule.lastStep, marks).selfStruck).toBe(false);
    expect(rowView(schedule, "p2", 0, schedule.lastStep, marks).selfStruck).toBe(false);
  });

  test("a restore leaves the count behind so the animation can re-fire", () => {
    const results = score([["adele"]]);
    const schedule = buildSchedule(results, inEntryOrder());
    const key = rowKey("p1", 0);
    const marks = toggleMark(marksFor(key), key, false, 2_000);
    const row = rowView(schedule, "p1", 0, schedule.lastStep, marks);
    expect(row.selfStruck).toBe(false);
    expect(row.selfMarks).toBe(2);
  });

  test("UNIQUE drops on a self-strike and comes back on a restore", () => {
    const results = score([["adele", "cher", "pink"]]);
    const schedule = buildSchedule(results, inEntryOrder());
    const p1 = results.scorers[0];
    const key = rowKey("p1", 1);

    expect(cardView(schedule, p1, schedule.lastStep).unique).toBe(3);
    const struck = marksFor(key);
    expect(cardView(schedule, p1, schedule.lastStep, struck).unique).toBe(2);
    const back = toggleMark(struck, key, false, 3_000);
    expect(cardView(schedule, p1, schedule.lastStep, back).unique).toBe(3);
  });

  // The TV and the phone that made the mark have to show the same number, and
  // the phone shows the whole list from the first frame.
  test("a mark counts before its row has been revealed", () => {
    const results = score([["adele", "cher"]]);
    const schedule = buildSchedule(results, inEntryOrder());
    const marks = marksFor(rowKey("p1", 1));
    expect(cardView(schedule, results.scorers[0], 0, marks).unique).toBe(1);
    expect(cardView(schedule, results.scorers[0], 0, marks).shown).toBe(0);
  });

  test("a duplicate cannot be marked down twice", () => {
    const results = score([["adele"], ["adele"]]);
    const schedule = buildSchedule(results, inEntryOrder());
    // A mark that should never have been accepted; `cardView` refuses to
    // subtract the same word both as a duplicate and as a self-strike.
    const marks = marksFor(rowKey("p1", 0));
    const card = cardView(schedule, results.scorers[0], schedule.lastStep, marks);
    expect(card.unique).toBe(0);
    expect(card.selfMarkCount).toBe(0);
  });

  test("selfDirection and selfMarkAt follow only the last mark, on its own card", () => {
    const results = score([["adele"], ["cher"]]);
    const schedule = buildSchedule(results, inEntryOrder());
    const marks = toggleMark(marksFor(rowKey("p1", 0)), rowKey("p2", 0), true, 5_000);

    const p1 = cardView(schedule, results.scorers[0], schedule.lastStep, marks);
    expect(p1.selfDirection).toBeNull();
    expect(p1.selfMarkAt).toBeNull();
    expect(p1.selfMarkCount).toBe(1);

    const p2 = cardView(schedule, results.scorers[1], schedule.lastStep, marks);
    expect(p2.selfDirection).toBe("struck");
    expect(p2.selfMarkAt).toBe(5_000);
  });
});

describe("uniqueDirection", () => {
  const startedAt = 10_000;

  test("is null while nothing has moved the number", () => {
    const results = score([["adele"], ["cher"]]);
    const schedule = buildSchedule(results, inEntryOrder());
    const card = cardView(schedule, results.scorers[0], schedule.lastStep);
    expect(uniqueDirection(schedule, card, startedAt)).toBeNull();
  });

  test("is down for a strike the reveal landed", () => {
    const results = score([["adele"], ["adele"]]);
    const schedule = buildSchedule(results, inEntryOrder());
    const card = cardView(schedule, results.scorers[0], schedule.lastStep);
    expect(uniqueDirection(schedule, card, startedAt)).toBe("down");
  });

  test("is up for a restore made after the last revealed strike", () => {
    const results = score([["adele", "cher"], ["adele"]]);
    const schedule = buildSchedule(results, inEntryOrder());
    const key = rowKey("p1", 1);
    const marks = toggleMark(
      toggleMark(NO_SELF_MARKS, key, true, 90_000),
      key,
      false,
      91_000,
    );
    const card = cardView(schedule, results.scorers[0], schedule.lastStep, marks);
    expect(uniqueDirection(schedule, card, startedAt)).toBe("up");
  });

  // Without ordering the two sources in time, a restore would leave the stat
  // green for the next revealed strike to land on.
  test("a later revealed strike wins over an earlier restore", () => {
    const results = score([["adele", "cher"], ["adele"]]);
    const schedule = buildSchedule(results, inEntryOrder());
    const key = rowKey("p1", 1);
    // Marked and taken back in the first millisecond, before any line was out.
    const marks = toggleMark(toggleMark(NO_SELF_MARKS, key, true, 1), key, false, 2);
    const card = cardView(schedule, results.scorers[0], schedule.lastStep, marks);
    expect(card.selfDirection).toBe("restored");
    expect(uniqueDirection(schedule, card, startedAt)).toBe("down");
  });
});

describe("withSelfStrikes", () => {
  test("returns the identical object when nothing was marked", () => {
    const results = score([["adele"], ["cher"]]);
    expect(withSelfStrikes(results, NO_SELF_MARKS)).toBe(results);
  });

  test("clears the entry's unique and recomputes the scorer's count", () => {
    const results = score([["adele", "cher", "pink"], ["sia"]]);
    const marks = toggleMark(NO_SELF_MARKS, rowKey("p1", 1), true, 1_000);
    const placed = withSelfStrikes(results, marks);

    const p1 = placed.scorers[0];
    expect(p1.entries.map((e) => e.unique)).toEqual([true, false, true]);
    expect(p1.unique).toBe(2);
    // A disowned word is not-unique and alone in its collision group, which is
    // exactly how the archive can tell one from a real collision.
    expect(p1.entries[1].group).toBe(results.scorers[0].entries[1].group);
    // Untouched scorers keep their identity, so nothing downstream re-renders.
    expect(placed.scorers[1]).toBe(results.scorers[1]);
  });

  test("leaves the original results alone", () => {
    const results = score([["adele"]]);
    withSelfStrikes(results, toggleMark(NO_SELF_MARKS, rowKey("p1", 0), true, 1));
    expect(results.scorers[0].unique).toBe(1);
    expect(results.scorers[0].entries[0].unique).toBe(true);
  });

  test("a restored row is scored again", () => {
    const results = score([["adele"]]);
    const key = rowKey("p1", 0);
    const marks = toggleMark(toggleMark(NO_SELF_MARKS, key, true, 1), key, false, 2);
    expect(withSelfStrikes(results, marks).scorers[0].unique).toBe(1);
  });

  test("ignores a mark on a word that was already a duplicate", () => {
    const results = score([["adele"], ["adele"]]);
    const marks = toggleMark(NO_SELF_MARKS, rowKey("p1", 0), true, 1);
    // Already not unique, so there is nothing to clear and no count to change.
    expect(withSelfStrikes(results, marks).scorers[0].unique).toBe(0);
  });
});
