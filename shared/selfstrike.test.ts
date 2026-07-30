import { describe, expect, test } from "vitest";
import {
  NO_SELF_MARKS,
  isSelfStruck,
  markCount,
  toggleMark,
  totalMarks,
} from "./selfstrike";

describe("toggleMark", () => {
  test("strikes an untouched row", () => {
    const marks = toggleMark(NO_SELF_MARKS, "p1:0", true, 1_000);
    expect(isSelfStruck(marks, "p1:0")).toBe(true);
    expect(marks.last).toEqual({ row: "p1:0", at: 1_000 });
  });

  test("restores it on the second tap", () => {
    const struck = toggleMark(NO_SELF_MARKS, "p1:0", true, 1_000);
    const back = toggleMark(struck, "p1:0", false, 2_000);
    expect(isSelfStruck(back, "p1:0")).toBe(false);
    // The count keeps climbing rather than going back to zero — it is what the
    // strike and restore animations alternate their parity off.
    expect(markCount(back, "p1:0")).toBe(2);
    expect(back.last).toEqual({ row: "p1:0", at: 2_000 });
  });

  test("returns the identical object when the row is already that way", () => {
    const struck = toggleMark(NO_SELF_MARKS, "p1:0", true, 1_000);
    expect(toggleMark(struck, "p1:0", true, 2_000)).toBe(struck);
    expect(toggleMark(NO_SELF_MARKS, "p1:0", false, 1_000)).toBe(NO_SELF_MARKS);
  });

  test("leaves every other row alone", () => {
    const marks = toggleMark(
      toggleMark(NO_SELF_MARKS, "p1:0", true, 1_000),
      "p2:3",
      true,
      2_000,
    );
    expect(isSelfStruck(marks, "p1:0")).toBe(true);
    expect(isSelfStruck(marks, "p2:3")).toBe(true);
    expect(isSelfStruck(marks, "p1:1")).toBe(false);
  });

  test("does not mutate what it was given", () => {
    const struck = toggleMark(NO_SELF_MARKS, "p1:0", true, 1_000);
    toggleMark(struck, "p1:1", true, 2_000);
    expect(Object.keys(struck.counts)).toEqual(["p1:0"]);
    expect(NO_SELF_MARKS.counts).toEqual({});
  });
});

describe("totalMarks", () => {
  test("counts every tap, not every struck row", () => {
    let marks = toggleMark(NO_SELF_MARKS, "p1:0", true, 1);
    marks = toggleMark(marks, "p1:1", true, 2);
    marks = toggleMark(marks, "p1:0", false, 3);
    expect(totalMarks(marks)).toBe(3);
  });

  // The version number HostScoring memoizes its placement against: it has to
  // move on every accepted mark, or a late self-strike would not re-rank.
  test("rises by exactly one per accepted tap", () => {
    let marks = NO_SELF_MARKS;
    for (let i = 1; i <= 5; i++) {
      marks = toggleMark(marks, "p1:0", i % 2 === 1, i);
      expect(totalMarks(marks)).toBe(i);
    }
  });

  test("is zero for no marks", () => {
    expect(totalMarks(NO_SELF_MARKS)).toBe(0);
  });
});
