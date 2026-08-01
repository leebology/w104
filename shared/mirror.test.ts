import { describe, expect, test } from "vitest";
import { driverOf, scrollFraction } from "./mirror";
import { makeTeams } from "./teams";
import { defaultSettings } from "./gamemodes";
import { createRoom } from "./state";
import type { Player, Room } from "./state";

/**
 * A room of seats. `team: null` with `count: 0` is teams-off, where every
 * player is their own scorer.
 */
type Seat = { team: string | null; connected?: boolean; bot?: boolean; waiting?: boolean };

function room(count: number, seats: Seat[]): Room {
  const base = createRoom("PLUM", 1000);
  return {
    ...base,
    settings: { ...defaultSettings("ffa"), teamCount: count },
    teams: makeTeams(count),
    players: seats.map((seat, i): Player => ({
      id: `p${i}`,
      name: `P${i}`,
      emoji: "🐙",
      ready: false,
      connected: seat.connected ?? true,
      teamId: seat.team,
      ...(seat.bot === true ? { isBot: true as const } : {}),
      ...(seat.waiting === true ? { waiting: true } : {}),
    })),
  };
}

describe("driverOf and the waiting room", () => {
  test("a waiting teammate does not lead the roster", () => {
    // They are not in `scorer.members` at all — `rosterOf` filters them — so
    // the column is driven by the first member who is actually in the round.
    const r = room(2, [{ team: "t0", waiting: true }, { team: "t0" }]);
    expect(driverOf(r, "t0")).toBe("p1");
  });

  test("a scorer made only of waiting players does not exist to drive", () => {
    const r = room(2, [{ team: "t0", waiting: true }, { team: "t1" }]);
    expect(driverOf(r, "t0")).toBeNull();
  });
});

describe("driverOf, teams off", () => {
  test("a player drives their own column", () => {
    expect(driverOf(room(0, [{ team: null }, { team: null }]), "p1")).toBe("p1");
  });

  test("a disconnected player drives nothing", () => {
    expect(driverOf(room(0, [{ team: null, connected: false }]), "p0")).toBeNull();
  });

  test("a bot drives nothing, even though bots are connected", () => {
    expect(driverOf(room(0, [{ team: null, bot: true }]), "p0")).toBeNull();
  });

  test("an unknown scorer id drives nothing", () => {
    expect(driverOf(room(0, [{ team: null }]), "nobody")).toBeNull();
  });
});

describe("driverOf, teams on", () => {
  test("the first member in roster order drives the team's column", () => {
    const r = room(2, [{ team: "t0" }, { team: "t1" }, { team: "t0" }]);
    expect(driverOf(r, "t0")).toBe("p0");
    expect(driverOf(r, "t1")).toBe("p1");
  });

  test("skips a disconnected first member", () => {
    const r = room(2, [
      { team: "t0", connected: false },
      { team: "t1" },
      { team: "t0" },
    ]);
    expect(driverOf(r, "t0")).toBe("p2");
  });

  test("skips a bot in first position", () => {
    const r = room(2, [{ team: "t0", bot: true }, { team: "t1" }, { team: "t0" }]);
    expect(driverOf(r, "t0")).toBe("p2");
  });

  test("an all-disconnected team drives nothing", () => {
    const r = room(2, [
      { team: "t0", connected: false },
      { team: "t0", connected: false },
      { team: "t1" },
    ]);
    expect(driverOf(r, "t0")).toBeNull();
  });

  test("an all-bot team drives nothing", () => {
    const r = room(2, [{ team: "t0", bot: true }, { team: "t1" }]);
    expect(driverOf(r, "t0")).toBeNull();
  });
});

describe("scrollFraction", () => {
  test("a list shorter than its box has no position to mirror", () => {
    expect(scrollFraction(0, 80, 100)).toBeNull();
    expect(scrollFraction(0, 100, 100)).toBeNull();
  });

  test("the top is 0 and the bottom is 1", () => {
    expect(scrollFraction(0, 200, 100)).toBe(0);
    expect(scrollFraction(100, 200, 100)).toBe(1);
  });

  test("clamps past either end rather than reporting out of range", () => {
    expect(scrollFraction(150, 200, 100)).toBe(1);
    expect(scrollFraction(-20, 200, 100)).toBe(0);
  });

  test("rounds to three decimals, which is the free dedupe", () => {
    expect(scrollFraction(12.3456, 200, 100)).toBe(0.123);
    expect(scrollFraction(12.3494, 200, 100)).toBe(0.123);
  });

  test("a NaN measurement is no position at all, not a zero", () => {
    expect(scrollFraction(0, NaN, 100)).toBeNull();
    expect(scrollFraction(NaN, 200, 100)).toBeNull();
  });
});
