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

/**
 * The old floor was 64 against a list of 85, which is why an 85-word code
 * space survived review. The number that matters is the one room creation
 * gives up at: the client tries `MAX_CODE_ATTEMPTS` distinct codes, so a create
 * fails at roughly (live rooms / list length)^6. At 600 that is about two in a
 * hundred thousand with a hundred games running at once — the point where the
 * list has stopped being the thing that breaks first.
 *
 * Deliberately slack against the current count, because words get struck off
 * this list on taste — a homophone spotted late, a word that reads badly on a
 * TV — and a floor set just under today's total would turn the next such
 * deletion into a failing build. It is a floor, not a target.
 */
test("the list is long enough that creation does not run out of codes", () => {
  expect(CODE_WORDS.length).toBeGreaterThanOrEqual(600);
});

test("the list has no duplicates", () => {
  expect(new Set(CODE_WORDS).size).toBe(CODE_WORDS.length);
});

/** Landing's join control is four boxes of one `[A-Z]` character each, so a
 * code of any other shape is a code nobody can type. */
test("every word is exactly four lowercase letters", () => {
  const wrong = CODE_WORDS.filter((w) => !/^[a-z]{4}$/.test(w));
  expect(wrong).toEqual([]);
});

/** Not cosmetic at this length — alphabetical order is the only thing that
 * makes a duplicate or a bad addition visible in a diff. */
test("the list is in alphabetical order", () => {
  expect([...CODE_WORDS]).toEqual([...CODE_WORDS].sort());
});

/**
 * A spot check, not a filter. The list is curated by hand and this guards the
 * one failure that would actually reach a family's TV screen — someone adding
 * a word in bulk without reading it. Words are matched whole: `bass` and
 * `grass` are not near misses of anything, and a substring rule would reject
 * them.
 */
test("no profanity reaches the TV", () => {
  const blocked = [
    "arse", "bang", "boob", "butt", "clit", "cock", "coon", "crap", "cunt",
    "damn", "dick", "dyke", "fart", "fuck", "gook", "hell", "homo", "jerk",
    "jism", "jizz", "kike", "knob", "milf", "mick", "paki", "piss", "poop",
    "porn", "pube", "puke", "shag", "shit", "slag", "slut", "smut", "spic",
    "suck", "tits", "turd", "twat", "wang", "wank", "whore",
  ];
  expect(CODE_WORDS.filter((w) => blocked.includes(w))).toEqual([]);
});
