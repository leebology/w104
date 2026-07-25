import { expect, test } from "vitest";
import { CODE_WORDS, makeRoomCode } from "./words";

test("every code is a word from the list", () => {
  for (let i = 0; i < 200; i++) {
    expect(CODE_WORDS).toContain(makeRoomCode().toLowerCase());
  }
});

test("codes are uppercase for display", () => {
  const code = makeRoomCode();
  expect(code).toBe(code.toUpperCase());
});

test("the supplied random source selects the word", () => {
  expect(makeRoomCode(() => 0)).toBe(CODE_WORDS[0].toUpperCase());
});

test("a random source returning almost 1 stays in bounds", () => {
  expect(makeRoomCode(() => 0.999999)).toBe(
    CODE_WORDS[CODE_WORDS.length - 1].toUpperCase(),
  );
});

test("a random source returning exactly 1 stays in bounds", () => {
  expect(makeRoomCode(() => 1)).toBe(
    CODE_WORDS[CODE_WORDS.length - 1].toUpperCase(),
  );
});

test("the list is long enough that collisions are rare", () => {
  expect(CODE_WORDS.length).toBeGreaterThanOrEqual(64);
});

test("the list has no duplicates", () => {
  expect(new Set(CODE_WORDS).size).toBe(CODE_WORDS.length);
});
