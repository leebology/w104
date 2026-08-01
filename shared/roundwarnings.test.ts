import { describe, expect, test } from "vitest";
import { WARNING_GAP_SEC, warningsFor } from "./roundwarnings";
import { MAX_DURATION_SEC, MIN_DURATION_SEC } from "./gamemodes";

describe("warningsFor", () => {
  test("a short round gets the ten-second warning alone", () => {
    expect(warningsFor(15)).toEqual([10]);
    expect(warningsFor(20)).toEqual([10]);
    expect(warningsFor(30)).toEqual([10]);
  });

  test("half is dropped where it would land on a tail member", () => {
    // Exact collisions: 20 -> half 10, 60 -> half 30, 120 -> half 60.
    expect(warningsFor(20)).toEqual([10]);
    expect(warningsFor(60)).toEqual([30, 10]);
    expect(warningsFor(120)).toEqual([60, 30, 10]);
  });

  test("half appears once it clears the tail by the gap", () => {
    expect(warningsFor(159)).toEqual([60, 30, 10]);
    expect(warningsFor(160)).toEqual([80, 60, 30, 10]);
  });

  test("a long round gets all four", () => {
    expect(warningsFor(180)).toEqual([90, 60, 30, 10]);
    expect(warningsFor(600)).toEqual([300, 60, 30, 10]);
  });

  test("the 15-second round keeps 10 rather than half", () => {
    // The ordering trap: half is 7, which is *more* urgent than 10. Merged
    // into the tail and sorted by urgency it would win and then suppress 10,
    // warning later than the set is supposed to.
    expect(warningsFor(15)).toEqual([10]);
    expect(warningsFor(15)).not.toContain(7);
  });

  test("a warning never fires at the moment the round starts", () => {
    // "1:00 left" at 1:00 is not news.
    expect(warningsFor(60)).not.toContain(60);
    expect(warningsFor(30)).not.toContain(30);
  });

  test("a round too short for any warning yields none", () => {
    // Below MIN_DURATION_SEC, so unreachable in play — asserted so the
    // function is total rather than throwing on Math.max of an empty tail.
    expect(warningsFor(10)).toEqual([]);
  });

  test("every legal round length yields a strictly descending list", () => {
    for (let d = MIN_DURATION_SEC; d <= MAX_DURATION_SEC; d++) {
      const out = warningsFor(d);
      for (let i = 1; i < out.length; i++) {
        expect(out[i]).toBeLessThan(out[i - 1]);
      }
    }
  });

  test("every legal round length keeps its warnings a gap apart", () => {
    for (let d = MIN_DURATION_SEC; d <= MAX_DURATION_SEC; d++) {
      const out = warningsFor(d);
      for (let i = 1; i < out.length; i++) {
        expect(out[i - 1] - out[i]).toBeGreaterThanOrEqual(WARNING_GAP_SEC);
      }
    }
  });

  test("no warning is ever at or beyond the round's own length", () => {
    for (let d = MIN_DURATION_SEC; d <= MAX_DURATION_SEC; d++) {
      for (const w of warningsFor(d)) expect(w).toBeLessThan(d);
    }
  });
});
