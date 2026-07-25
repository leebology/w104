import { describe, expect, test } from "vitest";
import { createRoom, toRoomState } from "./state";
import type { Room } from "./state";

/** A room with every server-only field non-empty, so stripping is observable. */
function fullRoom(): Room {
  return {
    ...createRoom("PLUM", 1000),
    hostId: "host",
    players: [{ id: "p0", name: "P0", emoji: "🐙", ready: true, connected: true }],
    phase: { name: "playing", endsAt: 31_000 },
    category: "Bands",
    durationSec: 45,
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
      "durationSec",
      "hostId",
      "phase",
      "players",
      "serverTime",
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
      durationSec: 45,
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
});
