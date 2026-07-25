import { describe, expect, test } from "vitest";
import { createRoom } from "./state";
import type { Room } from "./state";
import { COUNTDOWN_MS, MAX_ENTRIES, MAX_ENTRY_LEN, TIMESUP_MS, nextAlarmAt, reduce, submitEntry } from "./reduce";

/** A room with `n` joined players, none ready, plus a host. */
function seed(n: number, now = 1000): Room {
  let room = createRoom("PLUM", now);
  room = reduce(room, { t: "claimHost", playerId: "host", now });
  for (let i = 0; i < n; i++) {
    room = reduce(room, {
      t: "join", playerId: `p${i}`, name: `P${i}`, emoji: "🐙", now,
    });
  }
  return room;
}

function readyAll(room: Room, now: number): Room {
  return room.players.reduce(
    (r, p) => reduce(r, { t: "ready", playerId: p.id, ready: true, now }),
    room,
  );
}

describe("lobby", () => {
  test("the host is not a player", () => {
    const room = seed(2);
    expect(room.hostId).toBe("host");
    expect(room.players.map((p) => p.id)).toEqual(["p0", "p1"]);
  });

  test("one ready player is not enough to start", () => {
    let room = seed(1);
    room = reduce(room, { t: "ready", playerId: "p0", ready: true, now: 2000 });
    expect(room.phase.name).toBe("lobby");
  });

  test("two ready players start the countdown", () => {
    const room = readyAll(seed(2), 2000);
    expect(room.phase).toEqual({ name: "countdown", endsAt: 2000 + COUNTDOWN_MS });
  });

  test("un-readying during the countdown cancels it", () => {
    let room = readyAll(seed(2), 2000);
    room = reduce(room, { t: "ready", playerId: "p0", ready: false, now: 3000 });
    expect(room.phase.name).toBe("lobby");
  });

  test("the host's start button readies everyone", () => {
    let room = seed(3);
    room = reduce(room, { t: "startGame", playerId: "host", now: 2000 });
    expect(room.players.every((p) => p.ready)).toBe(true);
    expect(room.phase.name).toBe("countdown");
  });

  test("a player cannot press the host's start button", () => {
    let room = seed(3);
    room = reduce(room, { t: "startGame", playerId: "p0", now: 2000 });
    expect(room.phase.name).toBe("lobby");
  });

  test("a disconnected player does not block the start", () => {
    let room = readyAll(seed(3), 2000);
    room = reduce(room, { t: "ready", playerId: "p2", ready: false, now: 2100 });
    expect(room.phase.name).toBe("lobby");
    room = reduce(room, { t: "disconnect", playerId: "p2", now: 2200 });
    expect(room.phase.name).toBe("countdown");
  });

  test("the host can kick a player, taking their entries", () => {
    let room = readyAll(seed(2), 2000);
    room = reduce(room, { t: "kick", playerId: "host", targetId: "p1", now: 2100 });
    expect(room.players.map((p) => p.id)).toEqual(["p0"]);
    expect(room.entries.p1).toBeUndefined();
  });

  test("a player cannot kick", () => {
    let room = seed(2);
    room = reduce(room, { t: "kick", playerId: "p0", targetId: "p1", now: 2100 });
    expect(room.players).toHaveLength(2);
  });

  test("rejoining reclaims the existing seat rather than adding one", () => {
    let room = seed(2);
    room = reduce(room, { t: "disconnect", playerId: "p0", now: 2000 });
    room = reduce(room, {
      t: "join", playerId: "p0", name: "P0", emoji: "🦊", now: 2100,
    });
    expect(room.players).toHaveLength(2);
    expect(room.players[0].connected).toBe(true);
    expect(room.players[0].emoji).toBe("🦊");
  });
});
