import { describe, expect, test } from "vitest";
import { createRoom, currentRound, matchComplete, preRoundPhase, toRoomState } from "./state";
import type { Room } from "./state";

/** A room with every server-only field non-empty, so stripping is observable. */
function fullRoom(): Room {
  return {
    ...createRoom("PLUM", 1000),
    hostId: "host",
    players: [{ id: "p0", name: "P0", emoji: "🐙", ready: true, connected: true }],
    phase: { name: "playing", endsAt: 31_000 },
    category: "Bands",
    settings: { roundCount: 3, durationSec: 45 },
    history: [],
    lastActivityAt: 2000,
    entries: { p0: [{ text: "Adele", at: 1500 }] },
    kicked: ["p1"],
  };
}

describe("toRoomState", () => {
  /**
   * The exact key set, not a spot check: this is the privacy boundary, and a
   * field added to Room later must fail here rather than quietly ride along in
   * every broadcast.
   */
  test("publishes exactly the public keys", () => {
    const state = toRoomState(fullRoom(), 9000);
    expect(Object.keys(state).sort()).toEqual([
      "category",
      "code",
      "history",
      "hostId",
      "phase",
      "players",
      "serverTime",
      "settings",
    ]);
  });

  test("strips the server-only fields", () => {
    const state = toRoomState(fullRoom(), 9000);
    expect(state).not.toHaveProperty("entries");
    expect(state).not.toHaveProperty("lastActivityAt");
    expect(state).not.toHaveProperty("kicked");
  });

  test("preserves the public fields and stamps the server clock", () => {
    const room = fullRoom();
    const state = toRoomState(room, 9000);
    expect(state).toEqual({
      code: "PLUM",
      hostId: "host",
      players: room.players,
      phase: { name: "playing", endsAt: 31_000 },
      category: "Bands",
      settings: { roundCount: 3, durationSec: 45 },
      history: [],
      serverTime: 9000,
    });
  });

  test("leaves the room it was given untouched", () => {
    const room = fullRoom();
    toRoomState(room, 9000);
    expect(room.entries.p0).toHaveLength(1);
    expect(room.kicked).toEqual(["p1"]);
  });
});

describe("createRoom", () => {
  test("starts with nobody kicked", () => {
    expect(createRoom("PLUM", 1000).kicked).toEqual([]);
  });

  test("starts on the default settings with no rounds played", () => {
    const room = createRoom("PLUM", 1000);
    expect(room.settings).toEqual({ roundCount: 1, durationSec: 30 });
    expect(room.history).toEqual([]);
  });
});

describe("derived match helpers", () => {
  const view = (rounds: number, played: number) => ({
    settings: { roundCount: rounds, durationSec: 30 },
    history: Array.from({ length: played }, () => ({ category: "woman", places: {} })),
  });

  test("the current round is one past the rounds already banked", () => {
    expect(currentRound(view(3, 0))).toBe(1);
    expect(currentRound(view(3, 2))).toBe(3);
  });

  test("a match completes once history holds every round", () => {
    expect(matchComplete(view(3, 2))).toBe(false);
    expect(matchComplete(view(3, 3))).toBe(true);
    expect(matchComplete(view(1, 1))).toBe(true);
  });

  test("the pre-round phase is the lobby only before the first round", () => {
    expect(preRoundPhase(view(3, 0))).toBe("lobby");
    expect(preRoundPhase(view(3, 1))).toBe("standings");
  });
});
