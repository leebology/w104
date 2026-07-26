import { describe, expect, test } from "vitest";
import { createRoom } from "./state";
import type { Room } from "./state";
import { COUNTDOWN_MS, HOST_GRACE_MS, IDLE_REAP_MS, MAX_ENTRIES, MAX_ENTRY_LEN, MAX_PLAYERS, TIMESUP_MS, alarmOutcome, canEndGame, nextAlarmAt, reduce, submitEntry } from "./reduce";

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

  test("the host can start with just one player", () => {
    let room = seed(1);
    room = reduce(room, { t: "startGame", playerId: "host", now: 2000 });
    expect(room.phase).toEqual({ name: "countdown", endsAt: 2000 + COUNTDOWN_MS });
  });

  test("the host cannot start with zero players", () => {
    let room = seed(0);
    room = reduce(room, { t: "startGame", playerId: "host", now: 2000 });
    expect(room.phase.name).toBe("lobby");
  });

  test("the host can cancel a countdown they started solo", () => {
    let room = seed(1);
    room = reduce(room, { t: "startGame", playerId: "host", now: 2000 });
    room = reduce(room, { t: "cancelStart", playerId: "host", now: 2100 });
    expect(room.phase.name).toBe("lobby");
    expect(room.players.every((p) => !p.ready)).toBe(true);
  });

  test("a player cannot cancel a countdown", () => {
    let room = readyAll(seed(2), 2000);
    room = reduce(room, { t: "cancelStart", playerId: "p0", now: 2100 });
    expect(room.phase.name).toBe("countdown");
  });

  test("cancelling outside a countdown does nothing", () => {
    const room = seed(2);
    expect(reduce(room, { t: "cancelStart", playerId: "host", now: 2000 })).toBe(room);
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

  test("a kick records the target so they cannot rejoin", () => {
    let room = seed(2);
    room = reduce(room, { t: "kick", playerId: "host", targetId: "p1", now: 2100 });
    expect(room.kicked).toEqual(["p1"]);
  });

  test("a player cannot kick", () => {
    let room = seed(2);
    room = reduce(room, { t: "kick", playerId: "p0", targetId: "p1", now: 2100 });
    expect(room.players).toHaveLength(2);
    expect(room.kicked).toEqual([]);
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

  test("a full room turns away newcomers", () => {
    let room = seed(MAX_PLAYERS);
    room = reduce(room, {
      t: "join", playerId: "late", name: "Late", emoji: "🐙", now: 2000,
    });
    expect(room.players).toHaveLength(MAX_PLAYERS);
    expect(room.players.some((p) => p.id === "late")).toBe(false);
  });

  test("a full room still lets a seated player reconnect", () => {
    const last = `p${MAX_PLAYERS - 1}`;
    let room = seed(MAX_PLAYERS);
    room = reduce(room, { t: "disconnect", playerId: last, now: 2000 });
    room = reduce(room, {
      t: "join", playerId: last, name: "Back", emoji: "🦊", now: 2100,
    });
    expect(room.players).toHaveLength(MAX_PLAYERS);
    expect(room.players.find((p) => p.id === last)!.connected).toBe(true);
  });
});

/** Drive a seeded room all the way to a live round. */
function playing(now = 2000): Room {
  const room = readyAll(seed(2, now), now);
  return reduce(room, { t: "tick", now: now + COUNTDOWN_MS });
}

describe("round progression", () => {
  test("the countdown expiring starts the round", () => {
    const room = playing();
    expect(room.phase).toEqual({
      name: "playing", endsAt: 2000 + COUNTDOWN_MS + 30_000,
    });
  });

  test("an early tick changes nothing", () => {
    const room = reduce(readyAll(seed(2), 2000), { t: "tick", now: 3000 });
    expect(room.phase.name).toBe("countdown");
  });

  test("the round expiring shows time's up", () => {
    const room = playing();
    const endsAt = (room.phase as { endsAt: number }).endsAt;
    const next = reduce(room, { t: "tick", now: endsAt });
    expect(next.phase).toEqual({ name: "timesup", endsAt: endsAt + TIMESUP_MS });
  });

  test("time's up expiring scores the round", () => {
    let room = playing();
    room = submitEntry(room, "p0", "Adele", 10_000).room;
    room = submitEntry(room, "p1", "adele", 10_001).room;
    room = submitEntry(room, "p0", "Zendaya", 10_002).room;

    const playEnd = (room.phase as { endsAt: number }).endsAt;
    room = reduce(room, { t: "tick", now: playEnd });
    const upEnd = (room.phase as { endsAt: number }).endsAt;
    room = reduce(room, { t: "tick", now: upEnd });

    expect(room.phase.name).toBe("scoring");
    const results = (room.phase as { results: { players: { id: string; total: number; unique: number }[] } }).results;
    const p0 = results.players.find((p) => p.id === "p0")!;
    expect(p0.total).toBe(2);
    expect(p0.unique).toBe(1);
  });

  test("a new game returns to the lobby and clears entries", () => {
    let room = playing();
    room = submitEntry(room, "p0", "Adele", 10_000).room;
    const playEnd = (room.phase as { endsAt: number }).endsAt;
    room = reduce(room, { t: "tick", now: playEnd });
    const upEnd = (room.phase as { endsAt: number }).endsAt;
    room = reduce(room, { t: "tick", now: upEnd });

    room = reduce(room, { t: "newGame", playerId: "host", now: upEnd + 100 });
    expect(room.phase.name).toBe("lobby");
    expect(room.entries).toEqual({});
    expect(room.players.every((p) => !p.ready)).toBe(true);
  });

  test("a new game advances the round counter", () => {
    let room = playing();
    expect(room.round).toBe(1);
    const playEnd = (room.phase as { endsAt: number }).endsAt;
    room = reduce(room, { t: "tick", now: playEnd });
    const upEnd = (room.phase as { endsAt: number }).endsAt;
    room = reduce(room, { t: "tick", now: upEnd });

    room = reduce(room, { t: "newGame", playerId: "host", now: upEnd + 100 });
    expect(room.round).toBe(2);
  });

  test("a new game does not un-kick anyone", () => {
    let room = playing();
    const playEnd = (room.phase as { endsAt: number }).endsAt;
    room = reduce(room, { t: "tick", now: playEnd });
    const upEnd = (room.phase as { endsAt: number }).endsAt;
    room = reduce(room, { t: "tick", now: upEnd });

    room = reduce(room, { t: "kick", playerId: "host", targetId: "p1", now: upEnd + 50 });
    room = reduce(room, { t: "newGame", playerId: "host", now: upEnd + 100 });
    expect(room.kicked).toEqual(["p1"]);
    expect(room.players.map((p) => p.id)).toEqual(["p0"]);
  });
});

describe("submitEntry", () => {
  test("accepts a word during the round", () => {
    const result = submitEntry(playing(), "p0", "Adele", 10_000);
    expect(result.accepted).toBe(true);
    expect(result.room.entries.p0).toEqual([{ text: "Adele", at: 10_000 }]);
  });

  test("trims surrounding whitespace", () => {
    const result = submitEntry(playing(), "p0", "  Adele  ", 10_000);
    expect(result.room.entries.p0[0].text).toBe("Adele");
  });

  test("rejects outside a live round", () => {
    const result = submitEntry(seed(2), "p0", "Adele", 10_000);
    expect(result).toMatchObject({ accepted: false, reason: "not-playing" });
  });

  test("rejects blanks", () => {
    expect(submitEntry(playing(), "p0", "   ", 10_000).reason).toBe("empty");
  });

  test("rejects punctuation-only entries", () => {
    expect(submitEntry(playing(), "p0", "!!!", 10_000).reason).toBe("empty");
  });

  test("rejects over-length entries", () => {
    const long = "a".repeat(MAX_ENTRY_LEN + 1);
    expect(submitEntry(playing(), "p0", long, 10_000).reason).toBe("too-long");
  });

  test("rejects a word the player already wrote, ignoring case", () => {
    const room = submitEntry(playing(), "p0", "Adele", 10_000).room;
    expect(submitEntry(room, "p0", "adele", 10_001).reason).toBe("duplicate");
  });

  test("allows the same word from a different player", () => {
    const room = submitEntry(playing(), "p0", "Adele", 10_000).room;
    expect(submitEntry(room, "p1", "Adele", 10_001).accepted).toBe(true);
  });

  test("rejects past the per-player cap", () => {
    let room = playing();
    for (let i = 0; i < MAX_ENTRIES; i++) {
      room = submitEntry(room, "p0", `word${i}`, 10_000 + i).room;
    }
    expect(submitEntry(room, "p0", "extra", 20_000).reason).toBe("limit");
  });

  test("a rejected submission leaves the room untouched", () => {
    const room = playing();
    expect(submitEntry(room, "p0", "", 10_000).room).toBe(room);
  });
});

describe("nextAlarmAt", () => {
  test("targets the phase deadline mid-round", () => {
    const room = playing();
    expect(nextAlarmAt(room)).toBe((room.phase as { endsAt: number }).endsAt);
  });

  test("targets the idle reap in the lobby", () => {
    const room = seed(2, 5_000);
    expect(nextAlarmAt(room)).toBe(room.lastActivityAt + IDLE_REAP_MS);
  });
});

describe("alarmOutcome", () => {
  /**
   * The regression this function exists for. A round is 30s and the idle
   * horizon is 15s, so a room whose players go quiet for the back half of a
   * round is "stale" at the exact moment the round is due to end. Reaping
   * logic must not get to decide that before the phase deadline does, or the
   * round hangs on 0:00 until a second alarm re-fires.
   */
  test("ends a round on the first alarm even when the room looks stale", () => {
    const room = playing();
    const endsAt = (room.phase as { endsAt: number }).endsAt;
    // Nobody has typed since the round began: well past the idle horizon.
    expect(endsAt).toBeGreaterThan(room.lastActivityAt + IDLE_REAP_MS);

    const outcome = alarmOutcome(room, endsAt, true);
    expect(outcome.action).toBe("advance");
    expect((outcome as { room: Room }).room.phase.name).toBe("timesup");
  });

  test("advancing a phase wins over reaping even with nobody connected", () => {
    let room = playing();
    room = { ...room, players: room.players.map((p) => ({ ...p, connected: false })) };
    const endsAt = (room.phase as { endsAt: number }).endsAt;

    expect(alarmOutcome(room, endsAt, false).action).toBe("advance");
  });

  test("a stale lobby with someone still connected is touched, not reaped", () => {
    const room = seed(2, 5_000);
    const outcome = alarmOutcome(room, 5_000 + IDLE_REAP_MS, true);
    expect(outcome.action).toBe("touch");
    expect((outcome as { room: Room }).room.lastActivityAt).toBe(5_000 + IDLE_REAP_MS);
  });

  test("a stale lobby nobody is connected to is reaped", () => {
    const room = seed(2, 5_000);
    expect(alarmOutcome(room, 5_000 + IDLE_REAP_MS, false).action).toBe("reap");
  });

  test("an alarm with nothing to do just re-arms", () => {
    const room = seed(2, 5_000);
    expect(alarmOutcome(room, 6_000, true).action).toBe("rearm");
  });
});

describe("the host leaving", () => {
  test("only the host may end the game", () => {
    const room = seed(2);
    expect(canEndGame(room, "host")).toBe(true);
    expect(canEndGame(room, "p0")).toBe(false);
  });

  test("a player disconnecting leaves no host mark", () => {
    const room = reduce(seed(2), { t: "disconnect", playerId: "p0", now: 2_000 });
    expect(room.hostGoneAt).toBeNull();
    expect(room.players.find((p) => p.id === "p0")?.connected).toBe(false);
  });

  test("the host disconnecting stamps the moment they went", () => {
    const room = reduce(seed(2), { t: "disconnect", playerId: "host", now: 2_000 });
    expect(room.hostGoneAt).toBe(2_000);
  });

  test("the room dies once the host has been gone for the grace window", () => {
    const room = reduce(seed(2), { t: "disconnect", playerId: "host", now: 2_000 });
    const outcome = alarmOutcome(room, 2_000 + HOST_GRACE_MS, true);
    expect(outcome.action).toBe("reap");
    expect((outcome as { reason: string }).reason).toBe("host-left");
  });

  test("players still connected do not keep a hostless room alive", () => {
    // The distinction from the idle reaper, which `touch`es a stale room when
    // anyone is still connected. A host who left takes the room regardless.
    const room = reduce(seed(2), { t: "disconnect", playerId: "host", now: 2_000 });
    expect(alarmOutcome(room, 2_000 + HOST_GRACE_MS, true).action).toBe("reap");
  });

  test("a host back inside the window keeps the room", () => {
    let room = reduce(seed(2), { t: "disconnect", playerId: "host", now: 2_000 });
    room = reduce(room, { t: "claimHost", playerId: "host", now: 5_000 });
    expect(room.hostGoneAt).toBeNull();
    expect(alarmOutcome(room, 2_000 + HOST_GRACE_MS, true).action).not.toBe("reap");
  });

  test("the grace window is not up yet, so nothing is reaped", () => {
    const room = reduce(seed(2), { t: "disconnect", playerId: "host", now: 2_000 });
    expect(alarmOutcome(room, 2_000 + HOST_GRACE_MS - 1, true).action).not.toBe("reap");
  });

  test("the host deadline pulls the alarm in ahead of a phase deadline", () => {
    // A host who drops mid-round: the round has 30s to run but the room only
    // has HOST_GRACE_MS left, so the alarm has to fire at the earlier of the
    // two or the reap would wait for the round to finish first.
    const room = reduce(playing(), { t: "disconnect", playerId: "host", now: 4_000 });
    expect(nextAlarmAt(room)).toBe(4_000 + HOST_GRACE_MS);
  });

  test("a hostless room ends rather than advancing its round", () => {
    const room = reduce(playing(), { t: "disconnect", playerId: "host", now: 4_000 });
    const endsAt = (room.phase as { endsAt: number }).endsAt;
    // Well past both the grace window and the round's own deadline.
    expect(endsAt).toBeGreaterThan(4_000 + HOST_GRACE_MS);
    expect(alarmOutcome(room, endsAt, true).action).toBe("reap");
  });
});
