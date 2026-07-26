import { describe, expect, test } from "vitest";
import { createRoom, currentRound, matchComplete, preRoundPhase } from "./state";
import type { Room } from "./state";
import { COUNTDOWN_MS, HOST_GRACE_MS, IDLE_REAP_MS, MAX_DURATION_SEC, MAX_ENTRIES, MAX_ENTRY_LEN, MAX_PLAYERS, MAX_ROUND_COUNT, MIN_DURATION_SEC, TIMESUP_MS, alarmOutcome, canEndGame, nextAlarmAt, reduce, submitEntry } from "./reduce";

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

  test("the round runs for the configured duration", () => {
    let room = seed(2);
    room = { ...room, settings: { roundCount: 1, durationSec: 90 } };
    room = readyAll(room, 1000);
    const cdEnd = (room.phase as { endsAt: number }).endsAt;
    room = reduce(room, { t: "tick", now: cdEnd });
    expect(room.phase.name).toBe("playing");
    expect((room.phase as { endsAt: number }).endsAt).toBe(cdEnd + 90_000);
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

/** A room parked on the scoring screen with one round's results in hand. */
function scored(roundCount = 3): Room {
  let room = playing();
  room = { ...room, settings: { ...room.settings, roundCount } };
  room = submitEntry(room, "p0", "Adele", 10_000).room;
  room = submitEntry(room, "p0", "Beyonce", 10_100).room;
  room = submitEntry(room, "p1", "Adele", 10_200).room;
  const playEnd = (room.phase as { endsAt: number }).endsAt;
  room = reduce(room, { t: "tick", now: playEnd });
  const upEnd = (room.phase as { endsAt: number }).endsAt;
  return reduce(room, { t: "tick", now: upEnd });
}

describe("setSettings", () => {
  test("the host sets rounds and duration", () => {
    const room = reduce(seed(2), {
      t: "setSettings", playerId: "host", roundCount: 3, durationSec: 90, now: 2000,
    });
    expect(room.settings).toEqual({ roundCount: 3, durationSec: 90 });
  });

  test("a player cannot set settings", () => {
    const before = seed(2);
    const after = reduce(before, {
      t: "setSettings", playerId: "p0", roundCount: 5, durationSec: 60, now: 2000,
    });
    expect(after).toBe(before);
  });

  test("settings cannot change once the match is under way", () => {
    const before = playing();
    const after = reduce(before, {
      t: "setSettings", playerId: "host", roundCount: 5, durationSec: 60, now: 2000,
    });
    expect(after).toBe(before);
  });

  test("out-of-range values are clamped", () => {
    const room = reduce(seed(2), {
      t: "setSettings", playerId: "host", roundCount: 99, durationSec: 99_999, now: 2000,
    });
    expect(room.settings).toEqual({
      roundCount: MAX_ROUND_COUNT, durationSec: MAX_DURATION_SEC,
    });
    const low = reduce(seed(2), {
      t: "setSettings", playerId: "host", roundCount: 0, durationSec: 1, now: 2000,
    });
    expect(low.settings).toEqual({ roundCount: 1, durationSec: MIN_DURATION_SEC });
  });

  test("fractional values round and non-finite ones keep the current setting", () => {
    const room = reduce(seed(2), {
      t: "setSettings", playerId: "host", roundCount: 2.6, durationSec: Number.NaN, now: 2000,
    });
    expect(room.settings).toEqual({ roundCount: 3, durationSec: 30 });
  });

  test("setting the values they already hold is a no-op", () => {
    const before = seed(2);
    const after = reduce(before, {
      t: "setSettings", playerId: "host", roundCount: 1, durationSec: 30, now: 2000,
    });
    expect(after).toBe(before);
  });

  test("an omitted field leaves that setting alone", () => {
    let room = reduce(seed(2), {
      t: "setSettings", playerId: "host", roundCount: 4, durationSec: 60, now: 2000,
    });
    room = reduce(room, { t: "setSettings", playerId: "host", durationSec: 45, now: 2100 });
    expect(room.settings).toEqual({ roundCount: 4, durationSec: 45 });
  });
});

describe("showStandings", () => {
  test("banks the round, clears entries and un-readies everyone", () => {
    const room = reduce(scored(), { t: "showStandings", playerId: "host", now: 50_000 });
    expect(room.phase.name).toBe("standings");
    expect(room.history).toHaveLength(1);
    expect(room.history[0].category).toBe(room.category);
    expect(room.history[0].places.p0.place).toBe(1);
    expect(room.history[0].places.p1.place).toBe(2);
    expect(room.entries).toEqual({});
    expect(room.players.every((p) => !p.ready)).toBe(true);
  });

  test("banking a round advances the derived round number", () => {
    const room = reduce(scored(), { t: "showStandings", playerId: "host", now: 50_000 });
    expect(currentRound(room)).toBe(2);
  });

  test("a player cannot show standings", () => {
    const before = scored();
    expect(reduce(before, { t: "showStandings", playerId: "p0", now: 50_000 })).toBe(before);
  });

  test("standings can only be shown from the scoring screen", () => {
    const before = playing();
    expect(reduce(before, { t: "showStandings", playerId: "host", now: 50_000 })).toBe(before);
  });
});

describe("between rounds", () => {
  const toStandings = (roundCount = 3) =>
    reduce(scored(roundCount), { t: "showStandings", playerId: "host", now: 50_000 });

  test("everyone readying up opens the next countdown", () => {
    const room = readyAll(toStandings(), 51_000);
    expect(room.phase.name).toBe("countdown");
    expect((room.phase as { endsAt: number }).endsAt).toBe(51_000 + COUNTDOWN_MS);
  });

  test("un-readying returns to standings, not the lobby", () => {
    let room = readyAll(toStandings(), 51_000);
    room = reduce(room, { t: "ready", playerId: "p0", ready: false, now: 51_500 });
    expect(room.phase.name).toBe("standings");
  });

  test("the host cancelling returns to standings and un-readies everyone", () => {
    let room = readyAll(toStandings(), 51_000);
    room = reduce(room, { t: "cancelStart", playerId: "host", now: 51_500 });
    expect(room.phase.name).toBe("standings");
    expect(room.players.every((p) => !p.ready)).toBe(true);
  });

  test("the host can force-start the next round solo", () => {
    let room = toStandings();
    room = reduce(room, { t: "disconnect", playerId: "p1", now: 51_000 });
    room = reduce(room, { t: "startGame", playerId: "host", now: 51_100 });
    expect(room.phase.name).toBe("countdown");
    expect(room.players.every((p) => p.ready)).toBe(true);
  });

  test("cancelling a countdown leaves the round number untouched", () => {
    const standings = toStandings();
    expect(currentRound(standings)).toBe(2);
    let room = readyAll(standings, 51_000);
    room = reduce(room, { t: "cancelStart", playerId: "host", now: 51_500 });
    expect(currentRound(room)).toBe(2);
  });

  test("readying up on the final standings starts nothing", () => {
    const room = readyAll(toStandings(1), 51_000);
    expect(matchComplete(room)).toBe(true);
    expect(room.phase.name).toBe("standings");
  });

  test("the host cannot force-start past the final round", () => {
    const before = toStandings(1);
    expect(reduce(before, { t: "startGame", playerId: "host", now: 51_000 })).toBe(before);
  });

  test("the next round runs on the configured duration", () => {
    let room = toStandings();
    room = { ...room, settings: { ...room.settings, durationSec: 60 } };
    room = readyAll(room, 51_000);
    const cdEnd = (room.phase as { endsAt: number }).endsAt;
    room = reduce(room, { t: "tick", now: cdEnd });
    expect((room.phase as { endsAt: number }).endsAt).toBe(cdEnd + 60_000);
  });
});

describe("backToLobby", () => {
  const finished = () =>
    reduce(scored(1), { t: "showStandings", playerId: "host", now: 50_000 });

  test("resets the match but keeps settings and kicks", () => {
    let room = finished();
    room = reduce(room, { t: "kick", playerId: "host", targetId: "p1", now: 50_100 });
    room = reduce(room, { t: "backToLobby", playerId: "host", now: 50_200 });
    expect(room.phase.name).toBe("lobby");
    expect(room.history).toEqual([]);
    expect(room.entries).toEqual({});
    expect(room.players.every((p) => !p.ready)).toBe(true);
    expect(room.settings.roundCount).toBe(1);
    expect(room.kicked).toEqual(["p1"]);
    expect(currentRound(room)).toBe(1);
    expect(preRoundPhase(room)).toBe("lobby");
  });

  test("a player cannot end the match", () => {
    const before = finished();
    expect(reduce(before, { t: "backToLobby", playerId: "p0", now: 50_200 })).toBe(before);
  });

  test("only reachable from standings", () => {
    const before = scored();
    expect(reduce(before, { t: "backToLobby", playerId: "host", now: 50_200 })).toBe(before);
  });
});

describe("long rounds", () => {
  test("the entry cap still holds at the ten-minute duration", () => {
    let room = seed(2);
    room = reduce(room, {
      t: "setSettings", playerId: "host", durationSec: MAX_DURATION_SEC, now: 1000,
    });
    room = readyAll(room, 1000);
    const cdEnd = (room.phase as { endsAt: number }).endsAt;
    room = reduce(room, { t: "tick", now: cdEnd });

    for (let i = 0; i < MAX_ENTRIES; i++) {
      room = submitEntry(room, "p0", `word-${i}`, cdEnd + i).room;
    }
    const overflow = submitEntry(room, "p0", "one too many", cdEnd + MAX_ENTRIES);
    expect(overflow.accepted).toBe(false);
    expect(overflow.reason).toBe("limit");
    expect(room.entries.p0).toHaveLength(MAX_ENTRIES);
  });

  test("scoring a full ten-player room stays fast", () => {
    let room = seed(MAX_PLAYERS);
    room = readyAll(room, 1000);
    const cdEnd = (room.phase as { endsAt: number }).endsAt;
    room = reduce(room, { t: "tick", now: cdEnd });
    for (const p of room.players) {
      for (let i = 0; i < MAX_ENTRIES; i++) {
        room = submitEntry(room, p.id, `${p.id}-word-${i}`, cdEnd + i).room;
      }
    }
    const playEnd = (room.phase as { endsAt: number }).endsAt;
    const started = Date.now();
    room = reduce(room, { t: "tick", now: playEnd });
    room = reduce(room, { t: "tick", now: (room.phase as { endsAt: number }).endsAt });
    expect(room.phase.name).toBe("scoring");
    // 10 x 200 entries is ~2M union-find comparisons. Generous ceiling: this
    // is a regression guard against an accidental O(n^3), not a benchmark.
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
