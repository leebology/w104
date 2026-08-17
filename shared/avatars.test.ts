import { describe, expect, test } from "vitest";
import { AVATARS, avatarAvailable, avatarFor, freeAvatar, takenAvatars } from "./avatars";

const wearing = (...emoji: string[]) =>
  emoji.map((e, i) => ({ id: `p${i}`, emoji: e }));

describe("takenAvatars", () => {
  test("collects what everyone is wearing", () => {
    expect(takenAvatars(wearing("🐙", "🦊"))).toEqual(new Set(["🐙", "🦊"]));
  });

  /** Whoever is asking is not competing with themselves. */
  test("ignores the asker", () => {
    const taken = takenAvatars(wearing("🐙", "🦊"), "p0");
    expect(taken.has("🐙")).toBe(false);
    expect(taken.has("🦊")).toBe(true);
  });

  test("an empty emoji is not a claim", () => {
    expect(takenAvatars(wearing(""))).toEqual(new Set());
  });
});

describe("avatarAvailable", () => {
  test("free when nobody has it, taken when somebody does", () => {
    const players = wearing("🐙");
    expect(avatarAvailable(players, "new", "🦊")).toBe(true);
    expect(avatarAvailable(players, "new", "🐙")).toBe(false);
  });

  /**
   * The lobby re-sends the pair on every keystroke of the name field, so a
   * player must always be allowed to keep the avatar they are already wearing.
   */
  test("your own is always available to you", () => {
    expect(avatarAvailable(wearing("🐙"), "p0", "🐙")).toBe(true);
  });
});

describe("freeAvatar", () => {
  test("never lands on one already worn", () => {
    const players = wearing(...AVATARS.slice(0, 40));
    // Every roll in the unit interval, not one sample: the pick indexes into
    // the *free* list, so an off-by-one at either end is the failure worth
    // catching.
    for (let i = 0; i <= 100; i++) {
      const picked = freeAvatar(players, "new", i / 100);
      expect(AVATARS.slice(0, 40)).not.toContain(picked);
      expect(AVATARS).toContain(picked);
    }
  });

  test("a roll of exactly 1 stays in range", () => {
    expect(AVATARS).toContain(freeAvatar([], "new", 1));
  });

  /**
   * 48 avatars against 30 humans plus 20 bots. A duplicate face is cosmetic; a
   * player with no face at all is a blank on every screen that draws one.
   */
  test("falls back to a used one rather than to nothing", () => {
    const everyone = wearing(...AVATARS);
    expect(AVATARS).toContain(freeAvatar(everyone, "new", 0.5));
  });
});

describe("avatarFor", () => {
  test("is free of what the room is wearing", () => {
    const players = wearing("🐙", "🦊");
    const picked = avatarFor(players, "late", "PLUM", 1000);
    expect(picked).not.toBe("🐙");
    expect(picked).not.toBe("🦊");
  });

  test("is pure — same inputs, same answer", () => {
    expect(avatarFor([], "late", "PLUM", 1000)).toBe(avatarFor([], "late", "PLUM", 1000));
  });

  /** Two phones joining on the same millisecond must not be handed one face. */
  test("differs by player at the same instant", () => {
    const a = avatarFor([], "one", "PLUM", 1000);
    const b = avatarFor([], "two", "PLUM", 1000);
    expect(a).not.toBe(b);
  });
});
