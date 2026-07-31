import { describe, expect, test } from "vitest";
import { DEFAULT_MODE } from "./gamemodes";
import { countdownScreen, createRoom, currentRound, matchComplete, preRoundPhase, toRoomState } from "./state";
import type { Room } from "./state";

/** A room with every server-only field non-empty, so stripping is observable. */
function fullRoom(): Room {
  return {
    ...createRoom("PLUM", 1000),
    hostId: "host",
    players: [{
      id: "p0", name: "P0", emoji: "🐙",
      ready: true, connected: true, teamId: null,
    }],
    phase: { name: "playing", endsAt: 31_000 },
    category: "Bands",
    settings: {
      mode: DEFAULT_MODE, roundCount: 3, durationSec: 45, teamCount: 0, categorySource: "stock",
    },
    history: [],
    lastActivityAt: 2000,
    entries: { p0: [{ text: "Adele", at: 1500, by: "p0" }] },
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
      "configuring",
      "history",
      "hostId",
      // Public on purpose: every screen showing the round timer has to know it
      // is held, or it counts down to a deadline the server stopped
      // maintaining and sits on 0:00. It leaks nothing — the pause is already
      // visible as a timer that is not moving.
      "paused",
      "phase",
      "players",
      "serverTime",
      "settings",
      "teams",
      // Public on purpose too, and for the same shape of reason: a debug view
      // refresh has to remount the screen on every phone, not only on the TV.
      "viewNonce",
      "votes",
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
      settings: {
        mode: DEFAULT_MODE, roundCount: 3, durationSec: 45, teamCount: 0, categorySource: "stock",
      },
      history: [],
      votes: {},
      teams: [],
      configuring: false,
      paused: null,
      viewNonce: 0,
      serverTime: 9000,
    });
  });

  test("leaves the room it was given untouched", () => {
    const room = fullRoom();
    toRoomState(room, 9000);
    expect(room.entries.p0).toHaveLength(1);
    expect(room.kicked).toEqual(["p1"]);
  });

  test("votes are broadcast — the TV renders the tally for the whole room", () => {
    const room = { ...createRoom("PLUM", 1000), votes: { p0: { song: 2 } } };
    expect(toRoomState(room, 1000).votes).toEqual({ p0: { song: 2 } });
  });
});

describe("createRoom", () => {
  test("starts with nobody kicked", () => {
    expect(createRoom("PLUM", 1000).kicked).toEqual([]);
  });

  test("starts on the default settings with no rounds played", () => {
    const room = createRoom("PLUM", 1000);
    expect(room.settings).toEqual({
      mode: DEFAULT_MODE, roundCount: 1, durationSec: 30, teamCount: 0, categorySource: "stock",
    });
    expect(room.history).toEqual([]);
  });
});

describe("derived match helpers", () => {
  const view = (rounds: number, played: number) => ({
    settings: {
      mode: DEFAULT_MODE, roundCount: rounds, durationSec: 30, teamCount: 0,
      categorySource: "stock" as const,
    },
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

  test("countdownScreen tells the two round-one countdowns apart", () => {
    const base = createRoom("PLUM", 1000);
    expect(countdownScreen({
      ...base, phase: { name: "countdown", endsAt: 2000, to: "voting" },
    })).toBe("lobby");
    expect(countdownScreen({
      ...base, phase: { name: "countdown", endsAt: 2000, to: "playing" },
    })).toBe("voting");
    expect(countdownScreen({
      ...base,
      phase: { name: "countdown", endsAt: 2000, to: "playing" },
      history: [{ category: "song", places: {} }],
    })).toBe("standings");
  });
});
