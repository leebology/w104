import { describe, expect, test } from "vitest";
import { allowedEdits, editDistance, isMatch, normalize, scoreRound } from "./scoring";

describe("normalize", () => {
  test("folds case", () => {
    expect(normalize("Zendaya")).toBe("zendaya");
  });

  test("strips diacritics so Beyoncé and beyonce merge", () => {
    expect(normalize("Beyoncé")).toBe("beyonce");
  });

  test("strips punctuation", () => {
    expect(normalize("O'Brien")).toBe("obrien");
    expect(normalize("Lupita Nyong'o!")).toBe("lupita nyongo");
  });

  test("collapses and trims whitespace", () => {
    expect(normalize("  Taylor   Swift  ")).toBe("taylor swift");
  });
});

describe("editDistance", () => {
  test("counts a deletion", () => {
    expect(editDistance("zendaya", "zendya")).toBe(1);
  });

  test("counts a transposition as one edit", () => {
    expect(editDistance("adele", "adlee")).toBe(1);
  });

  test("is zero for identical strings", () => {
    expect(editDistance("rihanna", "rihanna")).toBe(0);
  });
});

describe("allowedEdits", () => {
  test("demands exact match below 5 characters", () => {
    expect(allowedEdits("anne", "anna")).toBe(0);
  });

  test("allows one edit at 5-8 characters", () => {
    expect(allowedEdits("zendya", "zendaya")).toBe(1);
  });

  test("allows two edits at 9+ characters", () => {
    expect(allowedEdits("scarlet johanson", "scarlett johansson")).toBe(2);
  });

  test("measures against the shorter string", () => {
    expect(allowedEdits("cher", "cherilyn sarkisian")).toBe(0);
  });
});

describe("isMatch", () => {
  test("merges a plausible typo", () => {
    expect(isMatch("zendaya", "zendya")).toBe(true);
  });

  test("keeps short lookalike names apart", () => {
    expect(isMatch("anne", "anna")).toBe(false);
  });

  test("keeps genuinely different long names apart", () => {
    expect(isMatch("kate hudson", "kate winslet")).toBe(false);
  });

  test("merges identical strings", () => {
    expect(isMatch("adele", "adele")).toBe(true);
  });
});
