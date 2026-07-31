import { describe, expect, test, it } from "vitest";
import { createRoom, currentRound, matchComplete, preRoundPhase } from "./state";
import type { Room } from "./state";
import { COUNTDOWN_MS, HOST_GRACE_MS, IDLE_REAP_MS, MAX_DURATION_SEC, MAX_ENTRIES, MAX_ENTRY_LEN, MAX_PLAYERS, MAX_ROUND_COUNT, MIN_DURATION_SEC, TIMESUP_MS, VOTING_MS, alarmOutcome, canEndGame, nextAlarmAt, reduce, submitEntry } from "./reduce";
import { voteBudget, votesSpent } from "./voting";
import { CATEGORIES, RANDOM_CATEGORY } from "./categories";
import { MAX_TEAM_NAME_LEN, TEAM_COLORS } from "./teams";
import { rowKey } from "./reveal";
import { isSelfStruck } from "./selfstrike";
import type { SelfMarks } from "./selfstrike";
import type { Results } from "./scoring";
import { MAX_CATEGORY_LEN, VOTE_BUDGET, WRITE_MS, quotaFor } from "./customCategories";

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

  test("two ready players start the countdown to voting", () => {
    const room = readyAll(seed(2), 2000);
    expect(room.phase).toEqual({ name: "countdown", endsAt: 2000 + COUNTDOWN_MS, to: "voting" });
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

  test("the host can start with just one player, opening the countdown to voting", () => {
    let room = seed(1);
    room = reduce(room, { t: "startGame", playerId: "host", now: 2000 });
    expect(room.phase).toEqual({ name: "countdown", endsAt: 2000 + COUNTDOWN_MS, to: "voting" });
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

/**
 * Drive a seeded room all the way to a live round. Ready-up now opens a
 * countdown to voting rather than to the round, so reaching "playing" means
 * passing through voting first. The host's force-start closes voting here —
 * rather than a player spending their vote budget — because it works
 * regardless of round count and leaves `votes` empty, which is what Task 5's
 * draw needs to fall back to a uniform pick over the whole category list.
 */
function playing(now = 2000): Room {
  let room = readyAll(seed(2, now), now);
  room = reduce(room, { t: "tick", now: now + COUNTDOWN_MS, roll: 0 }); // -> voting
  room = reduce(room, { t: "startGame", playerId: "host", now: now + COUNTDOWN_MS }); // host closes voting -> countdown to playing
  return reduce(room, { t: "tick", now: now + COUNTDOWN_MS * 2, roll: 0 }); // -> playing
}

describe("round progression", () => {
  test("the countdown expiring starts the round", () => {
    const room = playing();
    expect(room.phase).toEqual({
      name: "playing", endsAt: 2000 + COUNTDOWN_MS * 2 + 30_000,
    });
  });

  test("the round runs for the configured duration", () => {
    let room = seed(2);
    room = { ...room, settings: { ...room.settings, roundCount: 1, durationSec: 90 } };
    room = readyAll(room, 1000);
    const votingStart = (room.phase as { endsAt: number }).endsAt;
    room = reduce(room, { t: "tick", now: votingStart, roll: 0 }); // -> voting
    room = reduce(room, { t: "startGame", playerId: "host", now: votingStart }); // -> countdown to playing
    const cdEnd = (room.phase as { endsAt: number }).endsAt;
    room = reduce(room, { t: "tick", now: cdEnd, roll: 0 });
    expect(room.phase.name).toBe("playing");
    expect((room.phase as { endsAt: number }).endsAt).toBe(cdEnd + 90_000);
  });

  test("an early tick changes nothing", () => {
    const room = reduce(readyAll(seed(2), 2000), { t: "tick", now: 3000, roll: 0 });
    expect(room.phase.name).toBe("countdown");
  });

  test("the round expiring shows time's up", () => {
    const room = playing();
    const endsAt = (room.phase as { endsAt: number }).endsAt;
    const next = reduce(room, { t: "tick", now: endsAt, roll: 0 });
    expect(next.phase).toEqual({ name: "timesup", endsAt: endsAt + TIMESUP_MS });
  });

  test("time's up expiring scores the round", () => {
    let room = playing();
    room = submitEntry(room, "p0", "Adele", 10_000).room;
    room = submitEntry(room, "p1", "adele", 10_001).room;
    room = submitEntry(room, "p0", "Zendaya", 10_002).room;

    const playEnd = (room.phase as { endsAt: number }).endsAt;
    room = reduce(room, { t: "tick", now: playEnd, roll: 0 });
    const upEnd = (room.phase as { endsAt: number }).endsAt;
    room = reduce(room, { t: "tick", now: upEnd, roll: 0 });

    expect(room.phase.name).toBe("scoring");
    const results = (room.phase as { results: { scorers: { id: string; total: number; unique: number }[] } }).results;
    const p0 = results.scorers.find((p) => p.id === "p0")!;
    expect(p0.total).toBe(2);
    expect(p0.unique).toBe(1);
  });
});

describe("submitEntry", () => {
  test("accepts a word during the round", () => {
    const result = submitEntry(playing(), "p0", "Adele", 10_000);
    expect(result.accepted).toBe(true);
    expect(result.room.entries.p0).toEqual([{ text: "Adele", at: 10_000, by: "p0" }]);
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

    const outcome = alarmOutcome(room, endsAt, true, 0);
    expect(outcome.action).toBe("advance");
    expect((outcome as { room: Room }).room.phase.name).toBe("timesup");
  });

  test("advancing a phase wins over reaping even with nobody connected", () => {
    let room = playing();
    room = { ...room, players: room.players.map((p) => ({ ...p, connected: false })) };
    const endsAt = (room.phase as { endsAt: number }).endsAt;

    expect(alarmOutcome(room, endsAt, false, 0).action).toBe("advance");
  });

  test("a stale lobby with someone still connected is touched, not reaped", () => {
    const room = seed(2, 5_000);
    const outcome = alarmOutcome(room, 5_000 + IDLE_REAP_MS, true, 0);
    expect(outcome.action).toBe("touch");
    expect((outcome as { room: Room }).room.lastActivityAt).toBe(5_000 + IDLE_REAP_MS);
  });

  test("a stale lobby nobody is connected to is reaped", () => {
    const room = seed(2, 5_000);
    expect(alarmOutcome(room, 5_000 + IDLE_REAP_MS, false, 0).action).toBe("reap");
  });

  test("an alarm with nothing to do just re-arms", () => {
    const room = seed(2, 5_000);
    expect(alarmOutcome(room, 6_000, true, 0).action).toBe("rearm");
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
    const outcome = alarmOutcome(room, 2_000 + HOST_GRACE_MS, true, 0);
    expect(outcome.action).toBe("reap");
    expect((outcome as { reason: string }).reason).toBe("host-left");
  });

  test("players still connected do not keep a hostless room alive", () => {
    // The distinction from the idle reaper, which `touch`es a stale room when
    // anyone is still connected. A host who left takes the room regardless.
    const room = reduce(seed(2), { t: "disconnect", playerId: "host", now: 2_000 });
    expect(alarmOutcome(room, 2_000 + HOST_GRACE_MS, true, 0).action).toBe("reap");
  });

  test("a host back inside the window keeps the room", () => {
    let room = reduce(seed(2), { t: "disconnect", playerId: "host", now: 2_000 });
    room = reduce(room, { t: "claimHost", playerId: "host", now: 5_000 });
    expect(room.hostGoneAt).toBeNull();
    expect(alarmOutcome(room, 2_000 + HOST_GRACE_MS, true, 0).action).not.toBe("reap");
  });

  test("the grace window is not up yet, so nothing is reaped", () => {
    const room = reduce(seed(2), { t: "disconnect", playerId: "host", now: 2_000 });
    expect(alarmOutcome(room, 2_000 + HOST_GRACE_MS - 1, true, 0).action).not.toBe("reap");
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
    expect(alarmOutcome(room, endsAt, true, 0).action).toBe("reap");
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
  room = reduce(room, { t: "tick", now: playEnd, roll: 0 });
  const upEnd = (room.phase as { endsAt: number }).endsAt;
  return reduce(room, { t: "tick", now: upEnd, roll: 0 });
}

describe("setSettings", () => {
  test("the host sets rounds and duration", () => {
    const room = reduce(seed(2), {
      t: "setSettings", playerId: "host", values: { roundCount: 3, durationSec: 90 }, choices: {}, now: 2000,
    });
    expect(room.settings).toMatchObject({ roundCount: 3, durationSec: 90 });
  });

  test("a player cannot set settings", () => {
    const before = seed(2);
    const after = reduce(before, {
      t: "setSettings", playerId: "p0", values: { roundCount: 5, durationSec: 60 }, choices: {}, now: 2000,
    });
    expect(after).toBe(before);
  });

  test("settings cannot change once the match is under way", () => {
    const before = playing();
    const after = reduce(before, {
      t: "setSettings", playerId: "host", values: { roundCount: 5, durationSec: 60 }, choices: {}, now: 2000,
    });
    expect(after).toBe(before);
  });

  test("out-of-range values are clamped", () => {
    const room = reduce(seed(2), {
      t: "setSettings", playerId: "host", values: { roundCount: 99, durationSec: 99_999 }, choices: {}, now: 2000,
    });
    expect(room.settings).toMatchObject({
      roundCount: MAX_ROUND_COUNT, durationSec: MAX_DURATION_SEC,
    });
    const low = reduce(seed(2), {
      t: "setSettings", playerId: "host", values: { roundCount: 0, durationSec: 1 }, choices: {}, now: 2000,
    });
    expect(low.settings).toMatchObject({ roundCount: 1, durationSec: MIN_DURATION_SEC });
  });

  test("fractional values round and non-finite ones keep the current setting", () => {
    const room = reduce(seed(2), {
      t: "setSettings",
      playerId: "host",
      values: { roundCount: 2.6, durationSec: Number.NaN }, choices: {},
      now: 2000,
    });
    expect(room.settings).toMatchObject({ roundCount: 3, durationSec: 30 });
  });

  test("setting the values they already hold is a no-op", () => {
    const before = seed(2);
    const after = reduce(before, {
      t: "setSettings", playerId: "host", values: { roundCount: 1, durationSec: 30 }, choices: {}, now: 2000,
    });
    expect(after).toBe(before);
  });

  test("an omitted field leaves that setting alone", () => {
    let room = reduce(seed(2), {
      t: "setSettings", playerId: "host", values: { roundCount: 4, durationSec: 60 }, choices: {}, now: 2000,
    });
    room = reduce(room, {
      t: "setSettings", playerId: "host", values: { durationSec: 45 }, choices: {}, now: 2100,
    });
    expect(room.settings).toMatchObject({ roundCount: 4, durationSec: 45 });
  });
});

describe("teamCount over the wire", () => {
  test("the host can turn teams on", () => {
    let room = seed(2);
    room = reduce(room, {
      t: "setSettings", playerId: "host", values: { teamCount: 4 }, choices: {}, now: 2000,
    });
    expect(room.settings.teamCount).toBe(4);
  });

  test("a hand-rolled one-team value lands as off", () => {
    let room = seed(2);
    room = reduce(room, {
      t: "setSettings", playerId: "host", values: { teamCount: 1 }, choices: {}, now: 2000,
    });
    expect(room.settings.teamCount).toBe(0);
  });

  test("setting it to what it already is returns the identical object", () => {
    const room = seed(2);
    const next = reduce(room, {
      t: "setSettings", playerId: "host", values: { teamCount: 0 }, choices: {}, now: 2000,
    });
    expect(next).toBe(room);
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
    room = reduce(room, { t: "tick", now: cdEnd, roll: 0 });
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

  test("not reachable from scoring", () => {
    const before = scored();
    expect(reduce(before, { t: "backToLobby", playerId: "host", now: 50_200 })).toBe(before);
  });
});

describe("long rounds", () => {
  test("the entry cap still holds at the ten-minute duration", () => {
    let room = seed(2);
    room = reduce(room, {
      t: "setSettings", playerId: "host", values: { durationSec: MAX_DURATION_SEC }, choices: {}, now: 1000,
    });
    room = readyAll(room, 1000);
    const votingStart = (room.phase as { endsAt: number }).endsAt;
    room = reduce(room, { t: "tick", now: votingStart, roll: 0 }); // -> voting
    room = reduce(room, { t: "startGame", playerId: "host", now: votingStart }); // -> countdown to playing
    const cdEnd = (room.phase as { endsAt: number }).endsAt;
    room = reduce(room, { t: "tick", now: cdEnd, roll: 0 });

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
    const votingStart = (room.phase as { endsAt: number }).endsAt;
    room = reduce(room, { t: "tick", now: votingStart, roll: 0 }); // -> voting
    room = reduce(room, { t: "startGame", playerId: "host", now: votingStart }); // -> countdown to playing
    const cdEnd = (room.phase as { endsAt: number }).endsAt;
    room = reduce(room, { t: "tick", now: cdEnd, roll: 0 });
    for (const p of room.players) {
      for (let i = 0; i < MAX_ENTRIES; i++) {
        room = submitEntry(room, p.id, `${p.id}-word-${i}`, cdEnd + i).room;
      }
    }
    const playEnd = (room.phase as { endsAt: number }).endsAt;
    const started = Date.now();
    room = reduce(room, { t: "tick", now: playEnd, roll: 0 });
    room = reduce(room, { t: "tick", now: (room.phase as { endsAt: number }).endsAt, roll: 0 });
    expect(room.phase.name).toBe("scoring");
    // 10 x 200 entries is the absolute worst case MAX_PLAYERS and MAX_ENTRIES
    // permit, and it is ~2M union-find comparisons, each running editDistance
    // over a short string. That legitimately costs a few seconds.
    //
    // The ceiling was 5s and sat close enough to the real figure to fail on a
    // machine with anything else running — measured at 5.0-5.1s here, failing
    // two runs in three both on this branch and on an unmodified checkout, so
    // it was flaky rather than newly slow. Raised rather than tuned, because
    // what this guards is an accidental O(n^3), which would show up as orders
    // of magnitude and not as 20%.
    //
    // A complexity-based guard would be the right tool and this is not it; a
    // wall-clock assertion in CI can only ever be approximately right.
    expect(Date.now() - started).toBeLessThan(20_000);
    // The third argument is vitest's own testTimeout, and it is load-bearing:
    // it defaults to 5000ms — the same figure the assertion above used to
    // carry — so this test could fail two different ways for one reason, and
    // raising only the assertion just converted the failure into a timeout.
  }, 60_000);
});

/** A room that has reached the voting phase with `n` players. */
function seedVoting(n: number, roundCount = 5, now = 1000): Room {
  let room = seed(n, now);
  room = reduce(room, { t: "setSettings", playerId: "host", values: { roundCount }, choices: {}, now });
  room = reduce(room, { t: "startGame", playerId: "host", now });
  return reduce(room, { t: "tick", now: now + COUNTDOWN_MS, roll: 0 });
}

describe("entering voting", () => {
  test("everyone readying up opens a countdown to voting, not to a round", () => {
    const room = readyAll(seed(2), 2000);
    expect(room.phase).toEqual({
      name: "countdown", endsAt: 2000 + COUNTDOWN_MS, to: "voting",
    });
  });

  test("the host's start button opens the same countdown to voting", () => {
    const room = reduce(seed(3), { t: "startGame", playerId: "host", now: 2000 });
    expect(room.phase).toEqual({
      name: "countdown", endsAt: 2000 + COUNTDOWN_MS, to: "voting",
    });
  });

  test("the countdown to voting opens voting on its deadline", () => {
    let room = readyAll(seed(2), 2000);
    room = reduce(room, { t: "tick", now: 2000 + COUNTDOWN_MS, roll: 0 });
    expect(room.phase).toEqual({ name: "voting", endsAt: 2000 + COUNTDOWN_MS + VOTING_MS });
  });

  test("opening voting clears the readiness that got us here", () => {
    // Load-bearing: `ready` means "waiting in the room" before this edge and
    // "votes spent" after it. Carried across, the next settle would see
    // everyone ready and close voting before a single vote was cast.
    let room = readyAll(seed(2), 2000);
    expect(room.players.every((p) => p.ready)).toBe(true);
    room = reduce(room, { t: "tick", now: 2000 + COUNTDOWN_MS, roll: 0 });
    expect(room.phase.name).toBe("voting");
    expect(room.players.every((p) => !p.ready)).toBe(true);
  });

  test("voting does not close the instant it opens", () => {
    let room = readyAll(seed(2), 2000);
    room = reduce(room, { t: "tick", now: 2000 + COUNTDOWN_MS, roll: 0 });
    room = reduce(room, { t: "setProfile", playerId: "p0", name: "P0", emoji: "🐙", now: 2600 });
    expect(room.phase.name).toBe("voting");
  });

  test("un-readying during the countdown to voting still cancels it", () => {
    let room = readyAll(seed(2), 2000);
    room = reduce(room, { t: "ready", playerId: "p0", ready: false, now: 3000 });
    expect(room.phase.name).toBe("lobby");
  });
});

describe("leaving the room", () => {
  test("gives the seat up, unlike a disconnect", () => {
    // A dropped connection deliberately keeps the seat warm so a locked phone
    // can reclaim it. This is the deliberate version and takes the seat.
    let room = seed(2);
    room = reduce(room, { t: "leaveRoom", playerId: "p0", now: 2000 });
    expect(room.players.map((p) => p.id)).toEqual(["p1"]);
  });

  test("it takes their words and their votes with them", () => {
    let room = seed(2);
    room = { ...room, entries: { p0: [], p1: [] }, votes: { p0: { song: 1 } } };
    room = reduce(room, { t: "leaveRoom", playerId: "p0", now: 2000 });
    expect(room.entries.p0).toBeUndefined();
    expect(room.votes.p0).toBeUndefined();
  });

  test("it is not a ban — they can come straight back", () => {
    let room = seed(2);
    room = reduce(room, { t: "leaveRoom", playerId: "p0", now: 2000 });
    expect(room.kicked).toEqual([]);
    room = reduce(room, {
      t: "join", playerId: "p0", name: "P0", emoji: "🐙", now: 2100,
    });
    expect(room.players.map((p) => p.id)).toEqual(["p1", "p0"]);
  });

  test("the room re-settles around them", () => {
    // p0 was the one holding the room up; with them gone the room is ready.
    let room = seed(3);
    room = reduce(room, { t: "ready", playerId: "p1", ready: true, now: 2000 });
    room = reduce(room, { t: "ready", playerId: "p2", ready: true, now: 2100 });
    expect(room.phase.name).toBe("lobby");
    room = reduce(room, { t: "leaveRoom", playerId: "p0", now: 2200 });
    expect(room.phase.name).toBe("countdown");
  });

  test("leaving during the countdown can drop it below the floor", () => {
    let room = readyAll(seed(2), 2000);
    expect(room.phase.name).toBe("countdown");
    room = reduce(room, { t: "leaveRoom", playerId: "p0", now: 2100 });
    expect(room.phase).toEqual({ name: "lobby" });
  });

  test("it is a lobby action — mid-match it is a no-op", () => {
    const room = seedVoting(2);
    expect(reduce(room, { t: "leaveRoom", playerId: "p0", now: 3000 })).toBe(room);
  });

  test("someone who is not in the room leaving is a no-op", () => {
    const room = seed(2);
    expect(reduce(room, { t: "leaveRoom", playerId: "nobody", now: 2000 })).toBe(room);
  });
});

describe("casting votes", () => {
  test("a vote lands and counts against the budget", () => {
    let room = seedVoting(2);
    room = reduce(room, { t: "castVote", playerId: "p0", category: "song", now: 3000 });
    expect(room.votes.p0).toEqual({ song: 1 });
  });

  test("votes stack on one category", () => {
    let room = seedVoting(2);
    for (let i = 0; i < 3; i++) {
      room = reduce(room, { t: "castVote", playerId: "p0", category: "song", now: 3000 });
    }
    expect(room.votes.p0).toEqual({ song: 3 });
  });

  test("spending the last vote marks the player ready", () => {
    let room = seedVoting(2, 3); // budget 2
    room = reduce(room, { t: "castVote", playerId: "p0", category: "song", now: 3000 });
    expect(room.players.find((p) => p.id === "p0")!.ready).toBe(false);
    room = reduce(room, { t: "castVote", playerId: "p0", category: "car", now: 3100 });
    expect(room.players.find((p) => p.id === "p0")!.ready).toBe(true);
  });

  test("a vote past the budget is a no-op", () => {
    let room = seedVoting(2, 2); // budget 1
    room = reduce(room, { t: "castVote", playerId: "p0", category: "song", now: 3000 });
    const before = room;
    room = reduce(room, { t: "castVote", playerId: "p0", category: "car", now: 3100 });
    expect(room).toBe(before);
  });

  test("an unknown category is a no-op", () => {
    const room = seedVoting(2);
    const after = reduce(room, { t: "castVote", playerId: "p0", category: "haircut", now: 3000 });
    expect(after).toBe(room);
  });

  test("the random option is votable, and readies like any other vote", () => {
    // The gate is the *ballot*, not the pool — `random` is not a category and
    // would be refused by a CATEGORIES check.
    let room = seedVoting(2, 2); // budget 1
    room = reduce(room, {
      t: "castVote", playerId: "p0", category: RANDOM_CATEGORY, now: 3000,
    });
    expect(room.votes.p0).toEqual({ [RANDOM_CATEGORY]: 1 });
    expect(room.players.find((p) => p.id === "p0")!.ready).toBe(true);
  });

  test("the host holds no player slot, so their vote is a no-op", () => {
    const room = seedVoting(2);
    const after = reduce(room, { t: "castVote", playerId: "host", category: "song", now: 3000 });
    expect(after).toBe(room);
  });

  test("a vote outside the voting phase is a no-op", () => {
    const room = seed(2);
    const after = reduce(room, { t: "castVote", playerId: "p0", category: "song", now: 3000 });
    expect(after).toBe(room);
  });

  test("resetting clears the row and un-readies", () => {
    let room = seedVoting(2, 2);
    room = reduce(room, { t: "castVote", playerId: "p0", category: "song", now: 3000 });
    room = reduce(room, { t: "resetVotes", playerId: "p0", now: 3100 });
    expect(room.votes.p0).toBeUndefined();
    expect(room.players.find((p) => p.id === "p0")!.ready).toBe(false);
  });

  test("resetting with nothing to reset is a no-op", () => {
    const room = seedVoting(2);
    const after = reduce(room, { t: "resetVotes", playerId: "p0", now: 3000 });
    expect(after).toBe(room);
  });

  test("the host holds no player slot, so resetting on their behalf is a no-op", () => {
    const room = seedVoting(2);
    const after = reduce(room, { t: "resetVotes", playerId: "host", now: 3000 });
    expect(after).toBe(room);
  });

  test("a kicked player's votes stop counting", () => {
    let room = seedVoting(2);
    room = reduce(room, { t: "castVote", playerId: "p1", category: "song", now: 3000 });
    room = reduce(room, { t: "kick", playerId: "host", targetId: "p1", now: 3100 });
    expect(room.votes.p1).toBeUndefined();
  });
});

describe("leaving voting", () => {
  test("every player spending their budget opens the countdown to the round", () => {
    let room = seedVoting(2, 2); // budget 1
    room = reduce(room, { t: "castVote", playerId: "p0", category: "song", now: 3000 });
    expect(room.phase.name).toBe("voting");
    room = reduce(room, { t: "castVote", playerId: "p1", category: "car", now: 3100 });
    expect(room.phase).toEqual({
      name: "countdown", endsAt: 3100 + COUNTDOWN_MS, to: "playing",
    });
  });

  test("the 60 second timer closes voting even with nobody ready", () => {
    let room = seedVoting(3);
    const endsAt = (room.phase as { endsAt: number }).endsAt;
    room = reduce(room, { t: "tick", now: endsAt, roll: 0 });
    expect(room.phase).toEqual({
      name: "countdown", endsAt: endsAt + COUNTDOWN_MS, to: "playing",
    });
  });

  test("the host can continue mid-vote, force-readying everyone", () => {
    let room = seedVoting(3);
    room = reduce(room, { t: "startGame", playerId: "host", now: 3000 });
    expect(room.phase).toEqual({
      name: "countdown", endsAt: 3000 + COUNTDOWN_MS, to: "playing",
    });
    expect(room.players.every((p) => p.ready)).toBe(true);
  });

  test("a player cannot continue", () => {
    const room = seedVoting(3);
    const after = reduce(room, { t: "startGame", playerId: "p0", now: 3000 });
    expect(after).toBe(room);
  });

  test("a solo host start survives the next event", () => {
    // everyoneReady needs MIN_PLAYERS, so an un-guarded settle would tear this
    // countdown down the moment anything else happened.
    let room = seedVoting(1, 2);
    room = reduce(room, { t: "castVote", playerId: "p0", category: "song", now: 3000 });
    expect(room.phase.name).toBe("countdown");
    room = reduce(room, { t: "setProfile", playerId: "p0", name: "Solo", emoji: "🦊", now: 3100 });
    expect(room.phase.name).toBe("countdown");
  });

  test("a disconnected player does not hold voting open", () => {
    let room = seedVoting(2, 2);
    room = reduce(room, { t: "disconnect", playerId: "p1", now: 3000 });
    room = reduce(room, { t: "castVote", playerId: "p0", category: "song", now: 3100 });
    expect(room.phase.name).toBe("countdown");
  });

  test("voting is what the alarm is waiting on while it runs", () => {
    const room = seedVoting(2);
    expect(nextAlarmAt(room)).toBe((room.phase as { endsAt: number }).endsAt);
  });
});

describe("abandoning a vote", () => {
  test("back to room from voting discards the votes", () => {
    let room = seedVoting(2);
    room = reduce(room, { t: "castVote", playerId: "p0", category: "song", now: 3000 });
    room = reduce(room, { t: "backToLobby", playerId: "host", now: 3100 });
    expect(room.phase.name).toBe("lobby");
    expect(room.votes).toEqual({});
    expect(room.players.every((p) => !p.ready)).toBe(true);
  });

  test("stopping the countdown out of voting discards the votes too", () => {
    let room = seedVoting(2, 2);
    room = reduce(room, { t: "castVote", playerId: "p0", category: "song", now: 3000 });
    room = reduce(room, { t: "castVote", playerId: "p1", category: "car", now: 3100 });
    room = reduce(room, { t: "cancelStart", playerId: "host", now: 3200 });
    expect(room.phase.name).toBe("lobby");
    expect(room.votes).toEqual({});
  });
});

describe("drawing the round's category", () => {
  /** Voting closed with p0 having stacked everything on one category. */
  function votedRoom(category: string, roundCount = 2): Room {
    let room = seedVoting(1, roundCount);
    const budget = voteBudget(room.settings);
    for (let i = 0; i < budget; i++) {
      room = reduce(room, { t: "castVote", playerId: "p0", category, now: 3000 });
    }
    return room;
  }

  test("the whistle draws from the votes", () => {
    let room = votedRoom("car");
    const endsAt = (room.phase as { endsAt: number }).endsAt;
    room = reduce(room, { t: "tick", now: endsAt, roll: 0.5 });
    expect(room.phase.name).toBe("playing");
    expect(room.category).toBe("car");
  });

  test("the countdown does not draw — the category is secret until the whistle", () => {
    const room = votedRoom("car");
    expect(room.phase.name).toBe("countdown");
    expect(room.category).toBe("woman"); // still the seeded default
  });

  test("a category already played is never drawn again", () => {
    let room = votedRoom("car", 3);
    room = { ...room, history: [{ category: "car", places: {} }] };
    const endsAt = (room.phase as { endsAt: number }).endsAt;
    room = reduce(room, { t: "tick", now: endsAt, roll: 0.5 });
    expect(room.category).not.toBe("car");
  });

  test("a room that voted random still gets a real category at the whistle", () => {
    // The round has to be about something. `random` wins the vote and is spent
    // on the draw rather than becoming the round's subject.
    let room = votedRoom(RANDOM_CATEGORY);
    const endsAt = (room.phase as { endsAt: number }).endsAt;
    room = reduce(room, { t: "tick", now: endsAt, roll: 0.5 });
    expect(room.phase.name).toBe("playing");
    expect(room.category).not.toBe(RANDOM_CATEGORY);
    expect(CATEGORIES as readonly string[]).toContain(room.category);
  });
});

describe("settings", () => {
  test("the host sets a value the active mode exposes", () => {
    let room = seed(2);
    room = reduce(room, { t: "setSettings", playerId: "host", values: { roundCount: 5 }, choices: {}, now: 2000 });
    expect(room.settings.roundCount).toBe(5);
  });

  test("a value out of the descriptor's range is clamped", () => {
    let room = seed(2);
    room = reduce(room, {
      t: "setSettings", playerId: "host", values: { durationSec: 99_999 }, choices: {}, now: 2000,
    });
    expect(room.settings.durationSec).toBe(MAX_DURATION_SEC);
  });

  test("a non-finite value leaves the setting alone", () => {
    const before = seed(2);
    const room = reduce(before, {
      t: "setSettings", playerId: "host", values: { durationSec: Number.NaN }, choices: {}, now: 2000,
    });
    expect(room.settings.durationSec).toBe(before.settings.durationSec);
  });

  test("a player cannot change settings", () => {
    const before = seed(2);
    const room = reduce(before, {
      t: "setSettings", playerId: "p0", values: { roundCount: 9 }, choices: {}, now: 2000,
    });
    expect(room).toBe(before);
  });

  test("settings are locked once the match leaves the lobby", () => {
    let room = readyAll(seed(2), 2000);
    room = reduce(room, { t: "tick", now: 2000 + COUNTDOWN_MS, roll: 0 });
    expect(room.phase.name).toBe("voting");
    const before = room;
    room = reduce(room, { t: "setSettings", playerId: "host", values: { roundCount: 9 }, choices: {}, now: 9000 });
    expect(room).toBe(before);
  });

  test("setting a value to what it already is is a no-op", () => {
    const before = seed(2);
    const room = reduce(before, {
      t: "setSettings",
      playerId: "host",
      values: { roundCount: before.settings.roundCount }, choices: {},
      now: 2000,
    });
    expect(room).toBe(before);
  });
});

describe("game modes", () => {
  test("the host selects a mode", () => {
    // Only one mode ships, so selecting it is a no-op; the guards below are
    // what this suite is really pinning down.
    const before = seed(2);
    const room = reduce(before, { t: "setMode", playerId: "host", mode: "ffa", now: 2000 });
    expect(room).toBe(before);
    expect(room.settings.mode).toBe("ffa");
  });

  test("an unknown mode id is rejected", () => {
    const before = seed(2);
    const room = reduce(before, { t: "setMode", playerId: "host", mode: "teams", now: 2000 });
    expect(room).toBe(before);
  });

  test("a player cannot change the mode", () => {
    const before = seed(2);
    const room = reduce(before, { t: "setMode", playerId: "p0", mode: "ffa", now: 2000 });
    expect(room).toBe(before);
  });

  test("the mode is locked once the match leaves the lobby", () => {
    let room = readyAll(seed(2), 2000);
    room = reduce(room, { t: "tick", now: 2000 + COUNTDOWN_MS, roll: 0 });
    const before = room;
    room = reduce(room, { t: "setMode", playerId: "host", mode: "ffa", now: 9000 });
    expect(room).toBe(before);
  });
});

describe("the drawer hold", () => {
  test("opening a drawer during the countdown drops back to the lobby", () => {
    let room = readyAll(seed(2), 2000);
    expect(room.phase.name).toBe("countdown");
    room = reduce(room, { t: "setConfiguring", playerId: "host", open: true, now: 2500 });
    expect(room.phase.name).toBe("lobby");
    expect(room.configuring).toBe(true);
  });

  // This is what makes it a hold rather than a cancel: cancelStart clears
  // readiness precisely so settle cannot re-open the countdown. Here it must.
  test("the hold leaves every player ready", () => {
    let room = readyAll(seed(2), 2000);
    room = reduce(room, { t: "setConfiguring", playerId: "host", open: true, now: 2500 });
    expect(room.players.every((p) => p.ready)).toBe(true);
  });

  test("no countdown opens while a drawer is open", () => {
    let room = seed(2);
    room = reduce(room, { t: "setConfiguring", playerId: "host", open: true, now: 2000 });
    room = readyAll(room, 2500);
    expect(room.phase.name).toBe("lobby");
  });

  test("closing the drawer derives a fresh full-length countdown", () => {
    let room = readyAll(seed(2), 2000);
    room = reduce(room, { t: "setConfiguring", playerId: "host", open: true, now: 2500 });
    room = reduce(room, { t: "setConfiguring", playerId: "host", open: false, now: 9000 });
    expect(room.phase).toEqual({ name: "countdown", endsAt: 9000 + COUNTDOWN_MS, to: "voting" });
  });

  test("the host cannot force a start while a drawer is open", () => {
    let room = reduce(seed(2), { t: "setConfiguring", playerId: "host", open: true, now: 2000 });
    const before = room;
    room = reduce(room, { t: "startGame", playerId: "host", now: 2500 });
    expect(room).toBe(before);
  });

  test("a player cannot set the flag", () => {
    const before = seed(2);
    const room = reduce(before, { t: "setConfiguring", playerId: "p0", open: true, now: 2000 });
    expect(room).toBe(before);
  });

  test("setting the flag to what it already is is a no-op", () => {
    const before = seed(2);
    const room = reduce(before, { t: "setConfiguring", playerId: "host", open: false, now: 2000 });
    expect(room).toBe(before);
  });

  // A host whose phone locks with a drawer open would otherwise hold the whole
  // room down until the grace reap.
  test("the host disconnecting clears the flag", () => {
    let room = reduce(seed(2), { t: "setConfiguring", playerId: "host", open: true, now: 2000 });
    room = reduce(room, { t: "disconnect", playerId: "host", now: 2500 });
    expect(room.configuring).toBe(false);
  });

  test("a player disconnecting does not clear the flag", () => {
    let room = reduce(seed(2), { t: "setConfiguring", playerId: "host", open: true, now: 2000 });
    room = reduce(room, { t: "disconnect", playerId: "p0", now: 2500 });
    expect(room.configuring).toBe(true);
  });
});

/** A room with `n` players and teams switched on. */
function seedTeams(n: number, teamCount = 2, now = 1000): Room {
  const room = seed(n, now);
  return reduce(room, {
    t: "setSettings", playerId: "host", values: { teamCount }, choices: {}, now,
  });
}

describe("the teams phase", () => {
  test("readying up in the lobby opens team select, not a countdown", () => {
    const room = readyAll(seedTeams(2), 2000);
    expect(room.phase).toEqual({ name: "teams" });
    expect(room.teams.map((t) => t.id)).toEqual(["t0", "t1"]);
  });

  test("with teams off it still opens the countdown to voting", () => {
    const room = readyAll(seed(2), 2000);
    expect(room.phase).toEqual({
      name: "countdown", endsAt: 2000 + COUNTDOWN_MS, to: "voting",
    });
  });

  test("entering team select clears every ready flag", () => {
    // Load-bearing: `ready` means "waiting in the room" on the lobby side of
    // this edge and "has a team" on the other. Carried across, the next
    // settle would close team select before anyone picked.
    const room = readyAll(seedTeams(2), 2000);
    expect(room.players.every((p) => !p.ready)).toBe(true);
    expect(room.players.every((p) => p.teamId === null)).toBe(true);
  });

  test("a host drawer still holds the lobby edge shut", () => {
    let room = seedTeams(2);
    room = reduce(room, { t: "setConfiguring", playerId: "host", open: true, now: 2000 });
    room = readyAll(room, 2100);
    expect(room.phase.name).toBe("lobby");
    // Closing it derives the transition with no further host action.
    room = reduce(room, { t: "setConfiguring", playerId: "host", open: false, now: 2200 });
    expect(room.phase.name).toBe("teams");
  });

  test("the ready event is rejected in team select", () => {
    const room = readyAll(seedTeams(2), 2000);
    const next = reduce(room, { t: "ready", playerId: "p0", ready: true, now: 2100 });
    expect(next).toBe(room);
  });

  test("cancelStart cannot wedge the teams countdown", () => {
    // Cancelling clears readiness so settle cannot re-open the countdown.
    // Landing back in `teams` that would strand the room: everyone is still
    // on a team and nothing they can do would set `ready` again.
    let room = readyAll(seedTeams(2), 2000);
    room = reduce(room, { t: "startGame", playerId: "host", now: 2100 });
    expect(room.phase.name).toBe("countdown");
    const next = reduce(room, { t: "cancelStart", playerId: "host", now: 2200 });
    expect(next).toBe(room);
  });
});

/** A room sitting in team select with `n` players and `teamCount` teams. */
function inTeams(n: number, teamCount = 2, now = 2000): Room {
  return readyAll(seedTeams(n, teamCount), now);
}

describe("joinTeam and leaveTeam", () => {
  test("joining a team readies you", () => {
    let room = inTeams(2);
    room = reduce(room, { t: "joinTeam", playerId: "p0", teamId: "t0", now: 2100 });
    const me = room.players.find((p) => p.id === "p0")!;
    expect(me.teamId).toBe("t0");
    expect(me.ready).toBe(true);
    expect(room.phase.name).toBe("teams");
  });

  test("everyone on a team opens the countdown to voting", () => {
    let room = inTeams(2);
    room = reduce(room, { t: "joinTeam", playerId: "p0", teamId: "t0", now: 2100 });
    room = reduce(room, { t: "joinTeam", playerId: "p1", teamId: "t1", now: 2200 });
    expect(room.phase).toEqual({
      name: "countdown", endsAt: 2200 + COUNTDOWN_MS, to: "voting",
    });
  });

  test("leaving during the countdown drops back to team select", () => {
    // Leaving *is* the unready — there is no second button.
    let room = inTeams(2);
    room = reduce(room, { t: "joinTeam", playerId: "p0", teamId: "t0", now: 2100 });
    room = reduce(room, { t: "joinTeam", playerId: "p1", teamId: "t1", now: 2200 });
    room = reduce(room, { t: "leaveTeam", playerId: "p1", now: 2300 });
    expect(room.phase).toEqual({ name: "teams" });
    const p1 = room.players.find((p) => p.id === "p1")!;
    expect(p1.teamId).toBeNull();
    expect(p1.ready).toBe(false);
  });

  test("switching teams during the countdown restarts it rather than cancelling it", () => {
    let room = inTeams(2);
    room = reduce(room, { t: "joinTeam", playerId: "p0", teamId: "t0", now: 2100 });
    room = reduce(room, { t: "joinTeam", playerId: "p1", teamId: "t1", now: 2200 });
    room = reduce(room, { t: "joinTeam", playerId: "p1", teamId: "t0", now: 2300 });
    // Still counting — a switch is not the unready, leaving is — but from the
    // top, so a move made on the last second is one the room gets to see.
    expect(room.phase).toEqual({
      name: "countdown", endsAt: 2300 + COUNTDOWN_MS, to: "voting",
    });
    expect(room.players.find((p) => p.id === "p1")!.teamId).toBe("t0");
  });

  test("a switch after the host's Continue restarts the countdown too", () => {
    // The Continue path force-readies everyone, so this countdown is the one
    // `settle` is not free to re-derive — the restart has to come from the
    // join itself.
    let room = inTeams(2);
    room = reduce(room, { t: "startGame", playerId: "host", now: 2100 });
    const placed = room.players.find((p) => p.id === "p0")!.teamId!;
    const other = room.teams.find((t) => t.id !== placed)!;
    room = reduce(room, { t: "joinTeam", playerId: "p0", teamId: other.id, now: 2400 });
    expect(room.phase).toEqual({
      name: "countdown", endsAt: 2400 + COUNTDOWN_MS, to: "voting",
    });
  });

  test("joining a team outside a countdown leaves the phase alone", () => {
    // The reset is a countdown-only concern: there is no clock in team select
    // itself, and settle owns the edge out of it.
    let room = inTeams(3);
    room = reduce(room, { t: "joinTeam", playerId: "p0", teamId: "t0", now: 2100 });
    expect(room.phase).toEqual({ name: "teams" });
  });

  test("an unknown team id is a no-op", () => {
    const room = inTeams(2);
    expect(reduce(room, { t: "joinTeam", playerId: "p0", teamId: "t9", now: 2100 })).toBe(room);
  });

  test("re-joining the team you are already on is a no-op", () => {
    let room = inTeams(2);
    room = reduce(room, { t: "joinTeam", playerId: "p0", teamId: "t0", now: 2100 });
    expect(reduce(room, { t: "joinTeam", playerId: "p0", teamId: "t0", now: 2200 })).toBe(room);
  });

  test("leaving when you are on no team is a no-op", () => {
    const room = inTeams(2);
    expect(reduce(room, { t: "leaveTeam", playerId: "p0", now: 2100 })).toBe(room);
  });

  test("neither is legal outside team select", () => {
    const room = seed(2);
    expect(reduce(room, { t: "joinTeam", playerId: "p0", teamId: "t0", now: 2100 })).toBe(room);
  });
});

describe("setTeamName", () => {
  test("a member can rename their team without recolouring it", () => {
    let room = inTeams(2);
    room = reduce(room, { t: "joinTeam", playerId: "p0", teamId: "t0", now: 2100 });
    room = reduce(room, {
      t: "setTeamName", playerId: "p0", teamId: "t0", name: "  The Sharks  ", now: 2200,
    });
    const t0 = room.teams.find((t) => t.id === "t0")!;
    expect(t0.name).toBe("The Sharks");
    expect(t0.colorIndex).toBe(0);
  });

  test("a non-member cannot rename it", () => {
    let room = inTeams(2);
    room = reduce(room, { t: "joinTeam", playerId: "p0", teamId: "t0", now: 2100 });
    const next = reduce(room, {
      t: "setTeamName", playerId: "p1", teamId: "t0", name: "Hijacked", now: 2200,
    });
    expect(next).toBe(room);
  });

  test("an empty name falls back to the colour", () => {
    let room = inTeams(2);
    room = reduce(room, { t: "joinTeam", playerId: "p0", teamId: "t0", now: 2100 });
    room = reduce(room, {
      t: "setTeamName", playerId: "p0", teamId: "t0", name: "Zed", now: 2200,
    });
    room = reduce(room, {
      t: "setTeamName", playerId: "p0", teamId: "t0", name: "   ", now: 2300,
    });
    expect(room.teams.find((t) => t.id === "t0")!.name).toBe(TEAM_COLORS[0].name);
  });

  test("a long name is cut to the cap", () => {
    let room = inTeams(2);
    room = reduce(room, { t: "joinTeam", playerId: "p0", teamId: "t0", now: 2100 });
    room = reduce(room, {
      t: "setTeamName", playerId: "p0", teamId: "t0", name: "x".repeat(80), now: 2200,
    });
    expect(room.teams.find((t) => t.id === "t0")!.name).toHaveLength(MAX_TEAM_NAME_LEN);
  });

  test("renaming to the same name is a no-op", () => {
    let room = inTeams(2);
    room = reduce(room, { t: "joinTeam", playerId: "p0", teamId: "t0", now: 2100 });
    const next = reduce(room, {
      t: "setTeamName", playerId: "p0", teamId: "t0", name: TEAM_COLORS[0].name, now: 2200,
    });
    expect(next).toBe(room);
  });
});

describe("the host's Continue in team select", () => {
  test("places the stragglers and opens the countdown to voting", () => {
    let room = inTeams(2);
    room = reduce(room, { t: "startGame", playerId: "host", now: 2100 });
    expect(room.phase).toEqual({
      name: "countdown", endsAt: 2100 + COUNTDOWN_MS, to: "voting",
    });
    expect(room.players.every((p) => p.ready)).toBe(true);
    // `ready` here means "on a team", so it has to be true rather than merely
    // asserted: a force-ready over a teamless player is a flag with nothing
    // behind it, and nothing for them to leave.
    expect(room.players.every((p) => p.teamId !== null)).toBe(true);
  });

  test("a player placed by Continue can still leave and halt the countdown", () => {
    // The whole point of assigning at Continue rather than at the whistle.
    let room = inTeams(2);
    room = reduce(room, { t: "startGame", playerId: "host", now: 2100 });
    const placed = room.players[0].teamId!;
    room = reduce(room, { t: "leaveTeam", playerId: room.players[0].id, now: 2200 });
    expect(placed).not.toBeNull();
    expect(room.phase).toEqual({ name: "teams" });
    expect(room.players[0].ready).toBe(false);
  });

  test("everyone re-joining after a halt re-opens the countdown with no host action", () => {
    let room = inTeams(2);
    room = reduce(room, { t: "startGame", playerId: "host", now: 2100 });
    room = reduce(room, { t: "leaveTeam", playerId: "p0", now: 2200 });
    expect(room.phase.name).toBe("teams");
    room = reduce(room, { t: "joinTeam", playerId: "p0", teamId: "t0", now: 2300 });
    expect(room.phase).toEqual({
      name: "countdown", endsAt: 2300 + COUNTDOWN_MS, to: "voting",
    });
  });

  test("starting from the lobby with teams on lands in team select", () => {
    let room = seedTeams(2);
    room = reduce(room, { t: "startGame", playerId: "host", now: 2000 });
    expect(room.phase).toEqual({ name: "teams" });
    expect(room.players.every((p) => !p.ready)).toBe(true);
  });

  test("a player leaving after Continue still tears the countdown down", () => {
    let room = inTeams(2);
    room = reduce(room, { t: "joinTeam", playerId: "p0", teamId: "t0", now: 2100 });
    room = reduce(room, { t: "startGame", playerId: "host", now: 2200 });
    room = reduce(room, { t: "leaveTeam", playerId: "p0", now: 2300 });
    expect(room.phase).toEqual({ name: "teams" });
  });
});

describe("auto-assignment", () => {
  test("spreads the stragglers rather than stacking them", () => {
    let room = inTeams(3);
    room = reduce(room, { t: "joinTeam", playerId: "p0", teamId: "t0", now: 2100 });
    room = reduce(room, { t: "startGame", playerId: "host", now: 2200 });
    // t0 already has p0, so the two stragglers take t1 and t0 in that order —
    // counts update as each is placed.
    expect(room.players.map((p) => p.teamId)).toEqual(["t0", "t1", "t0"]);
  });

  test("still runs at the tick, for a player whose phone died in team select", () => {
    // Readiness counts only connected players, so this one never blocked the
    // countdown and was never a straggler the host could see.
    let room = inTeams(3);
    room = reduce(room, { t: "disconnect", playerId: "p2", now: 2100 });
    room = reduce(room, { t: "joinTeam", playerId: "p0", teamId: "t0", now: 2200 });
    room = reduce(room, { t: "joinTeam", playerId: "p1", teamId: "t1", now: 2300 });
    expect(room.phase.name).toBe("countdown");
    expect(room.players.find((p) => p.id === "p2")!.teamId).toBeNull();
    room = reduce(room, { t: "tick", now: 2300 + COUNTDOWN_MS, roll: 0.5 });
    expect(room.phase.name).toBe("voting");
    expect(room.players.every((p) => p.teamId !== null)).toBe(true);
    expect(room.players.every((p) => !p.ready)).toBe(true);
  });

  test("leaves teams alone when they are off", () => {
    let room = readyAll(seed(2), 2000);
    room = reduce(room, { t: "tick", now: 2000 + COUNTDOWN_MS, roll: 0.5 });
    expect(room.phase.name).toBe("voting");
    expect(room.players.every((p) => p.teamId === null)).toBe(true);
  });
});

describe("backToLobby from team select", () => {
  test("tears the teams down so the next match rebuilds them", () => {
    let room = inTeams(2);
    room = reduce(room, { t: "joinTeam", playerId: "p0", teamId: "t0", now: 2100 });
    room = reduce(room, { t: "backToLobby", playerId: "host", now: 2200 });
    expect(room.phase).toEqual({ name: "lobby" });
    expect(room.teams).toEqual([]);
    expect(room.players.every((p) => p.teamId === null)).toBe(true);
  });

  test("works during the countdown too", () => {
    // The host's Back button is on screen throughout, so the event has to be
    // legal throughout. This is not `cancelStart`, which stays rejected here.
    let room = inTeams(2);
    room = reduce(room, { t: "startGame", playerId: "host", now: 2100 });
    expect(room.phase.name).toBe("countdown");
    room = reduce(room, { t: "backToLobby", playerId: "host", now: 2200 });
    expect(room.phase).toEqual({ name: "lobby" });
    expect(room.teams).toEqual([]);
  });
});

/** A room with `n` players, teams on, and custom categories on. */
function seedTeamsCustom(n: number, teamCount = 2, now = 1000): Room {
  const room = seed(n, now);
  return reduce(room, {
    t: "setSettings",
    playerId: "host",
    values: { teamCount },
    choices: { categorySource: "custom" },
    now,
  });
}

/** A room sitting in team select with `n` players, teams and custom both on. */
function inTeamsCustom(n: number, teamCount = 2, now = 2000): Room {
  return readyAll(seedTeamsCustom(n, teamCount), now);
}

/**
 * Regression coverage for 07b54ee: with teams **and** custom categories both
 * on, the countdown out of team select is `to: "creating"` rather than
 * `to: "voting"` — `afterLobby` routes a custom match through the writing
 * phase instead. Before that commit, `inTeamSelect`/`backPhase` recognised
 * only a `to: "voting"` countdown as "out of team select", so this exact
 * countdown fell outside every rule that assumes leaving a team can cancel
 * it.
 */
describe("team select with custom categories on", () => {
  test("the host's Continue opens the countdown to creating, not to voting", () => {
    let room = inTeamsCustom(2);
    room = reduce(room, { t: "joinTeam", playerId: "p0", teamId: "t0", now: 2100 });
    room = reduce(room, { t: "joinTeam", playerId: "p1", teamId: "t1", now: 2200 });
    expect(room.phase).toEqual({
      name: "countdown", endsAt: 2200 + COUNTDOWN_MS, to: "creating",
    });
  });

  test("leaving a team during that countdown still cancels it, back to team select", () => {
    // This is the bug 07b54ee fixed: `inTeamSelect` used to return false for
    // a `to: "creating"` countdown, so `leaveTeam` was rejected outright here
    // and the countdown ran to completion under a player no longer on a team.
    let room = inTeamsCustom(2);
    room = reduce(room, { t: "joinTeam", playerId: "p0", teamId: "t0", now: 2100 });
    room = reduce(room, { t: "joinTeam", playerId: "p1", teamId: "t1", now: 2200 });
    expect(room.phase.name).toBe("countdown");
    room = reduce(room, { t: "leaveTeam", playerId: "p1", now: 2300 });
    expect(room.phase).toEqual({ name: "teams" });
    const p1 = room.players.find((p) => p.id === "p1")!;
    expect(p1.teamId).toBeNull();
    expect(p1.ready).toBe(false);
  });

  test("backToLobby out of the creating phase itself steps back to team select", () => {
    // Mirrors "backToLobby from voting" with teams on: `creating` joins
    // `voting` in `backToLobby`'s one-step-back branch (shared/reduce.ts),
    // both being one step out from the lobby rather than the match's start.
    // (The countdown *to* creating is different: like the countdown to
    // voting, `backToLobby` there is not in that branch and goes all the way
    // home — see "works during the countdown too" above.)
    let room = inTeamsCustom(2);
    room = reduce(room, { t: "joinTeam", playerId: "p0", teamId: "t0", now: 2100 });
    room = reduce(room, { t: "joinTeam", playerId: "p1", teamId: "t1", now: 2200 });
    room = reduce(room, { t: "tick", now: 2200 + COUNTDOWN_MS, roll: 0.5 });
    expect(room.phase.name).toBe("creating");
    room = reduce(room, { t: "backToLobby", playerId: "host", now: 3000 });
    expect(room.phase).toEqual({ name: "teams" });
    expect(room.players.every((p) => p.teamId === null)).toBe(true);
  });

  test("cancelStart is still rejected on the to:creating countdown", () => {
    // Same protection as the to:voting teams countdown: cancelling would
    // clear readiness with everyone still on a team and nothing left for them
    // to leave, wedging the room in `teams` with no way to become ready
    // again. `reduce`'s "no change" contract is identity, not mere equality —
    // assert `toBe`, not just an unchanged phase name.
    let room = inTeamsCustom(2);
    room = reduce(room, { t: "startGame", playerId: "host", now: 2100 });
    expect(room.phase.name).toBe("countdown");
    expect((room.phase as { to: string }).to).toBe("creating");
    const next = reduce(room, { t: "cancelStart", playerId: "host", now: 2200 });
    expect(next).toBe(room);
  });
});

/** A room in the voting phase with teams on, p0 on t0 and p1 on t1. */
function votingInTeams(): Room {
  let room = inTeams(2);
  room = reduce(room, { t: "joinTeam", playerId: "p0", teamId: "t0", now: 2100 });
  room = reduce(room, { t: "joinTeam", playerId: "p1", teamId: "t1", now: 2200 });
  room = reduce(room, { t: "tick", now: 2200 + COUNTDOWN_MS, roll: 0.5 });
  expect(room.phase.name).toBe("voting");
  return room;
}

describe("backToLobby from voting", () => {
  test("with teams on it steps back to team select, not the lobby", () => {
    let room = votingInTeams();
    room = reduce(room, { t: "castVote", playerId: "p0", category: "woman", now: 3000 });
    room = reduce(room, { t: "backToLobby", playerId: "host", now: 3100 });
    expect(room.phase).toEqual({ name: "teams" });
    expect(room.votes).toEqual({});
    // Nobody is on a team, which is also what stops `settle` closing team
    // select again on the very next event.
    expect(room.players.every((p) => p.teamId === null)).toBe(true);
    expect(room.players.every((p) => !p.ready)).toBe(true);
  });

  test("the teams survive the trip, names and all", () => {
    let room = votingInTeams();
    // Renaming is a team-select action, so do it before leaving that phase.
    room = reduce(room, { t: "backToLobby", playerId: "host", now: 3000 });
    room = reduce(room, { t: "joinTeam", playerId: "p0", teamId: "t0", now: 3100 });
    room = reduce(room, {
      t: "setTeamName", playerId: "p0", teamId: "t0", name: "The Sharks", now: 3200,
    });
    room = reduce(room, { t: "joinTeam", playerId: "p1", teamId: "t1", now: 3300 });
    room = reduce(room, { t: "tick", now: 3300 + COUNTDOWN_MS, roll: 0.5 });
    expect(room.phase.name).toBe("voting");
    room = reduce(room, { t: "backToLobby", playerId: "host", now: 4000 });
    expect(room.teams.find((t) => t.id === "t0")!.name).toBe("The Sharks");
    expect(room.teams.find((t) => t.id === "t0")!.colorIndex).toBe(0);
  });

  test("with teams off it still goes all the way to the lobby", () => {
    let room = readyAll(seed(2), 2000);
    room = reduce(room, { t: "tick", now: 2000 + COUNTDOWN_MS, roll: 0.5 });
    expect(room.phase.name).toBe("voting");
    room = reduce(room, { t: "backToLobby", playerId: "host", now: 3000 });
    expect(room.phase).toEqual({ name: "lobby" });
  });
});

describe("backToLobby from the round-1 post-voting countdown", () => {
  test("with teams off it works, same as from voting itself", () => {
    let room = readyAll(seed(2), 2000);
    room = reduce(room, { t: "tick", now: 2000 + COUNTDOWN_MS, roll: 0.5 });
    room = reduce(room, { t: "castVote", playerId: "p0", category: "woman", now: 3000 });
    room = reduce(room, { t: "startGame", playerId: "host", now: 3100 });
    expect(room.phase).toEqual({ name: "countdown", to: "playing", endsAt: 3100 + COUNTDOWN_MS });
    room = reduce(room, { t: "backToLobby", playerId: "host", now: 3200 });
    expect(room.phase).toEqual({ name: "lobby" });
    expect(room.votes).toEqual({});
  });

  test("with teams on it steps back to team select", () => {
    let room = votingInTeams();
    room = reduce(room, { t: "castVote", playerId: "p0", category: "woman", now: 3000 });
    room = reduce(room, { t: "startGame", playerId: "host", now: 3100 });
    expect(room.phase.name).toBe("countdown");
    room = reduce(room, { t: "backToLobby", playerId: "host", now: 3200 });
    expect(room.phase).toEqual({ name: "teams" });
    expect(room.votes).toEqual({});
    expect(room.players.every((p) => p.teamId === null)).toBe(true);
  });

  test("round 2+'s post-standings countdown is unaffected — it is not this countdown", () => {
    // `playingInTeams` leaves `roundCount` at its default of 1, under which
    // round 1 is also the last — `matchComplete` would block the very
    // transition this test needs, so this walks the same edges with the
    // round count raised first, while still in the lobby.
    let room = seedTeams(2, 2);
    room = reduce(room, { t: "setSettings", playerId: "host", values: { roundCount: 2 }, choices: {}, now: 1000 });
    room = readyAll(room, 2000);
    room = reduce(room, { t: "joinTeam", playerId: "p0", teamId: "t0", now: 2100 });
    room = reduce(room, { t: "joinTeam", playerId: "p1", teamId: "t0", now: 2200 });
    room = reduce(room, { t: "tick", now: 2200 + COUNTDOWN_MS, roll: 0.5 }); // -> voting
    room = reduce(room, { t: "startGame", playerId: "host", now: 8000 }); // -> countdown to playing
    room = reduce(room, { t: "tick", now: 8000 + COUNTDOWN_MS, roll: 0.5 }); // -> playing
    const playEnd = (room.phase as { endsAt: number }).endsAt;
    room = reduce(room, { t: "tick", now: playEnd, roll: 0.5 }); // -> timesup
    const upEnd = (room.phase as { endsAt: number }).endsAt;
    room = reduce(room, { t: "tick", now: upEnd, roll: 0.5 }); // -> scoring
    expect(room.phase.name).toBe("scoring");
    room = reduce(room, { t: "showStandings", playerId: "host", now: upEnd + 100 });
    expect(room.phase.name).toBe("standings");
    room = readyAll(room, upEnd + 200);
    expect(room.phase.name).toBe("countdown");
    expect((room.phase as { to: "voting" | "playing" }).to).toBe("playing");
    expect(room.history.length).toBeGreaterThan(0);
    const before = room;
    room = reduce(room, { t: "backToLobby", playerId: "host", now: upEnd + 300 });
    // Unchanged: this countdown does not qualify, matching `HostStandings`,
    // which renders Stop instead of an exit button here.
    expect(room).toBe(before);
  });
});

/**
 * A room mid-round with teams on, p0 and p1 both on t0. Walks the real edges
 * rather than hand-building a Room, so the helper cannot drift from the rules.
 * Timestamps ascend past each phase deadline.
 */
function playingInTeams(): Room {
  let room = inTeams(2);                                  // teams, at 2000
  room = reduce(room, { t: "joinTeam", playerId: "p0", teamId: "t0", now: 2100 });
  room = reduce(room, { t: "joinTeam", playerId: "p1", teamId: "t0", now: 2200 });
  // Both on a team -> countdown(to:"voting") ending at 2200 + COUNTDOWN_MS.
  room = reduce(room, { t: "tick", now: 2200 + COUNTDOWN_MS, roll: 0.5 });
  expect(room.phase.name).toBe("voting");
  room = reduce(room, { t: "startGame", playerId: "host", now: 8000 });
  room = reduce(room, { t: "tick", now: 8000 + COUNTDOWN_MS, roll: 0.5 });
  expect(room.phase.name).toBe("playing");
  return room;
}

describe("submitEntry with a shared team list", () => {
  test("a word a teammate already wrote is a duplicate", () => {
    const room = playingInTeams();
    const first = submitEntry(room, "p0", "Zendaya", 13100);
    expect(first.accepted).toBe(true);
    const second = submitEntry(first.room, "p1", "zendaya", 13200);
    expect(second.accepted).toBe(false);
    expect(second.reason).toBe("duplicate");
    expect(second.room).toBe(first.room);
  });

  test("a word another team wrote is still accepted", () => {
    let room = playingInTeams();
    room = {
      ...room,
      players: room.players.map((p) =>
        p.id === "p1" ? { ...p, teamId: "t1" } : p,
      ),
    };
    const first = submitEntry(room, "p0", "Zendaya", 13100);
    const second = submitEntry(first.room, "p1", "Zendaya", 13200);
    expect(second.accepted).toBe(true);
  });

  test("the entry limit is per team, not per player", () => {
    let room = playingInTeams();
    for (let i = 0; i < MAX_ENTRIES; i++) {
      const out = submitEntry(room, "p0", `word ${i}`, 13100 + i);
      expect(out.accepted).toBe(true);
      room = out.room;
    }
    const over = submitEntry(room, "p1", "one more", 20000);
    expect(over.accepted).toBe(false);
    expect(over.reason).toBe("limit");
  });

  test("the entry is still stored under its own author", () => {
    const room = playingInTeams();
    const out = submitEntry(room, "p1", "Adele", 13100);
    expect(out.room.entries.p1).toHaveLength(1);
    expect(out.room.entries.p1[0].by).toBe("p1");
    expect(out.room.entries.p0).toBeUndefined();
  });
});

/**
 * A room mid-round, teams off. Walks the real edges so the helper cannot
 * drift from the rules; the round is 30s and started at 8000 + COUNTDOWN_MS.
 */
function playingRoom(durationSec = 30): Room {
  let room = seed(2);
  room = { ...room, settings: { ...room.settings, roundCount: 2, durationSec } };
  room = readyAll(room, 1000);
  const votingStart = (room.phase as { endsAt: number }).endsAt;
  room = reduce(room, { t: "tick", now: votingStart, roll: 0 });
  room = reduce(room, { t: "startGame", playerId: "host", now: 8000 });
  room = reduce(room, { t: "tick", now: 8000 + COUNTDOWN_MS, roll: 0 });
  expect(room.phase.name).toBe("playing");
  return room;
}

describe("debug pause", () => {
  test("banks the time left rather than the moment it happened", () => {
    const room = playingRoom(30);
    const endsAt = (room.phase as { endsAt: number }).endsAt;
    const paused = reduce(room, {
      t: "debugPause", playerId: "host", paused: true, now: endsAt - 12_000,
    });
    expect(paused.paused).toBe(12_000);
  });

  test("resuming spends the banked time forward from now, however long it sat", () => {
    const room = playingRoom(30);
    const endsAt = (room.phase as { endsAt: number }).endsAt;
    let held = reduce(room, {
      t: "debugPause", playerId: "host", paused: true, now: endsAt - 12_000,
    });
    // An hour later.
    held = reduce(held, {
      t: "debugPause", playerId: "host", paused: false, now: endsAt + 3_600_000,
    });
    expect(held.paused).toBeNull();
    expect((held.phase as { endsAt: number }).endsAt).toBe(endsAt + 3_600_000 + 12_000);
  });

  test("pausing twice does not re-bank a shorter remainder", () => {
    const room = playingRoom(30);
    const endsAt = (room.phase as { endsAt: number }).endsAt;
    const first = reduce(room, {
      t: "debugPause", playerId: "host", paused: true, now: endsAt - 12_000,
    });
    const second = reduce(first, {
      t: "debugPause", playerId: "host", paused: true, now: endsAt - 3_000,
    });
    expect(second).toBe(first);
    expect(second.paused).toBe(12_000);
  });

  test("a held round does not advance when the alarm fires", () => {
    const room = playingRoom(30);
    const endsAt = (room.phase as { endsAt: number }).endsAt;
    const held = reduce(room, {
      t: "debugPause", playerId: "host", paused: true, now: endsAt - 5_000,
    });
    const ticked = reduce(held, { t: "tick", now: endsAt + 60_000, roll: 0 });
    expect(ticked).toBe(held);
    expect(ticked.phase.name).toBe("playing");
  });

  test("the alarm falls back to the idle horizon while held", () => {
    const room = playingRoom(30);
    const endsAt = (room.phase as { endsAt: number }).endsAt;
    const held = reduce(room, {
      t: "debugPause", playerId: "host", paused: true, now: endsAt - 5_000,
    });
    expect(nextAlarmAt(held)).toBe(held.lastActivityAt + IDLE_REAP_MS);
  });

  test("a held room with somebody connected is touched, never reaped", () => {
    const room = playingRoom(30);
    const endsAt = (room.phase as { endsAt: number }).endsAt;
    const held = reduce(room, {
      t: "debugPause", playerId: "host", paused: true, now: endsAt - 5_000,
    });
    const outcome = alarmOutcome(held, held.lastActivityAt + IDLE_REAP_MS, true, 0);
    expect(outcome.action).toBe("touch");
  });

  test("a held room everyone abandoned still reaps", () => {
    const room = playingRoom(30);
    const endsAt = (room.phase as { endsAt: number }).endsAt;
    const held = reduce(room, {
      t: "debugPause", playerId: "host", paused: true, now: endsAt - 5_000,
    });
    const outcome = alarmOutcome(held, held.lastActivityAt + IDLE_REAP_MS, false, 0);
    expect(outcome.action).toBe("reap");
  });

  test("a player cannot pause", () => {
    const room = playingRoom(30);
    const attempt = reduce(room, {
      t: "debugPause", playerId: "p0", paused: true, now: 12_000,
    });
    expect(attempt).toBe(room);
  });

  test("the lobby cannot be held — there is no deadline on it", () => {
    const room = seed(2);
    const attempt = reduce(room, {
      t: "debugPause", playerId: "host", paused: true, now: 2000,
    });
    expect(attempt).toBe(room);
  });

  test("the voting window can be held, and resuming spends the bank forward", () => {
    // The other phase with a deadline a room can still be deciding against.
    const room = seedVoting(2);
    const endsAt = (room.phase as { endsAt: number }).endsAt;
    const held = reduce(room, {
      t: "debugPause", playerId: "host", paused: true, now: endsAt - 20_000,
    });
    expect(held.paused).toBe(20_000);
    // A held phase's own deadline is stale by design, so the tick that would
    // have closed voting has to do nothing at all.
    expect(reduce(held, { t: "tick", now: endsAt + 60_000, roll: 0 })).toBe(held);

    const resumed = reduce(held, {
      t: "debugPause", playerId: "host", paused: false, now: endsAt + 3_600_000,
    });
    expect(resumed.paused).toBeNull();
    expect((resumed.phase as { endsAt: number }).endsAt).toBe(endsAt + 3_600_000 + 20_000);
  });

  test("a countdown cannot be held", () => {
    // Short, fixed-length, and on its way somewhere: nothing to decide.
    let room = readyAll(seed(2), 2000);
    expect(room.phase.name).toBe("countdown");
    const attempt = reduce(room, {
      t: "debugPause", playerId: "host", paused: true, now: 2100,
    });
    expect(attempt).toBe(room);
  });

  test("resuming a round that was never held is a no-op", () => {
    const room = playingRoom(30);
    const attempt = reduce(room, {
      t: "debugPause", playerId: "host", paused: false, now: 12_000,
    });
    expect(attempt).toBe(room);
  });
});

describe("debug skip", () => {
  test("moves the deadline to now so the ordinary tick ends the round", () => {
    const room = playingRoom(30);
    const skipped = reduce(room, { t: "debugSkip", playerId: "host", now: 12_000 });
    expect((skipped.phase as { endsAt: number }).endsAt).toBe(12_000);
    const ticked = reduce(skipped, { t: "tick", now: 12_000, roll: 0 });
    expect(ticked.phase.name).toBe("timesup");
  });

  test("skipping a held round ends it rather than resuming it", () => {
    const room = playingRoom(30);
    const held = reduce(room, {
      t: "debugPause", playerId: "host", paused: true, now: 12_000,
    });
    const skipped = reduce(held, { t: "debugSkip", playerId: "host", now: 20_000 });
    expect(skipped.paused).toBeNull();
    const ticked = reduce(skipped, { t: "tick", now: 20_000, roll: 0 });
    expect(ticked.phase.name).toBe("timesup");
  });

  test("a player cannot skip", () => {
    const room = playingRoom(30);
    const attempt = reduce(room, { t: "debugSkip", playerId: "p0", now: 12_000 });
    expect(attempt).toBe(room);
  });

  test("skipping outside a timed phase is a no-op", () => {
    const room = seed(2);
    expect(reduce(room, { t: "debugSkip", playerId: "host", now: 2000 })).toBe(room);
  });

  test("skipping the vote closes it down the deadline's own path", () => {
    // Not a transition of its own: the tick that follows is the one the 60s
    // deadline would have fired, so a skipped vote and an expired vote open
    // the identical countdown.
    const room = seedVoting(2);
    const skipped = reduce(room, { t: "debugSkip", playerId: "host", now: 5_000 });
    expect((skipped.phase as { endsAt: number }).endsAt).toBe(5_000);
    const ticked = reduce(skipped, { t: "tick", now: 5_000, roll: 0 });
    expect(ticked.phase).toEqual({
      name: "countdown", endsAt: 5_000 + COUNTDOWN_MS, to: "playing",
    });
  });
});

describe("the results screen", () => {
  test("entering it clears readiness, so nothing skips the reveal", () => {
    const room = scored();
    expect(room.phase.name).toBe("scoring");
    expect(room.players.every((p) => !p.ready)).toBe(true);
  });

  test("it records when the reveal began, unskipped", () => {
    const room = scored();
    const phase = room.phase as { name: string; startedAt: number; skipped: boolean };
    // The reveal's zero is the moment the times-up screen ran out, which is
    // what `scored()` ticks it on.
    expect(phase.startedAt).toBe(45_000);
    expect(phase.skipped).toBe(false);
  });

  test("everyone readying up banks the round with no host action", () => {
    const room = readyAll(scored(), 51_000);
    expect(room.phase.name).toBe("standings");
    expect(room.history).toHaveLength(1);
    expect(room.entries).toEqual({});
    // Cleared again on the far side, or the next countdown opens immediately.
    expect(room.players.every((p) => !p.ready)).toBe(true);
  });

  test("one of two players is not enough", () => {
    const room = reduce(scored(), { t: "ready", playerId: "p0", ready: true, now: 51_000 });
    expect(room.phase.name).toBe("scoring");
    expect(room.history).toHaveLength(0);
  });

  test("the host's button still moves a half-ready room on", () => {
    let room = reduce(scored(), { t: "ready", playerId: "p0", ready: true, now: 51_000 });
    room = reduce(room, { t: "showStandings", playerId: "host", now: 51_500 });
    expect(room.phase.name).toBe("standings");
    expect(room.history).toHaveLength(1);
  });

  test("fast forward is host-only, once, and only here", () => {
    const room = scored();
    expect(reduce(room, { t: "fastForward", playerId: "p0", now: 51_000 })).toBe(room);

    const skipped = reduce(room, { t: "fastForward", playerId: "host", now: 51_000 });
    expect((skipped.phase as { skipped: boolean }).skipped).toBe(true);
    // Already skipped is a genuine no-op, per the identity contract.
    expect(reduce(skipped, { t: "fastForward", playerId: "host", now: 52_000 })).toBe(skipped);

    const mid = playing();
    expect(reduce(mid, { t: "fastForward", playerId: "host", now: 51_000 })).toBe(mid);
  });
});

describe("selfStrike", () => {
  /** The row index of a word in that scorer's scored list. */
  const indexOf = (room: Room, scorerId: string, text: string) => {
    const scorer = (room.phase as { results: Results }).results.scorers.find(
      (s) => s.id === scorerId,
    )!;
    return scorer.entries.findIndex((e) => e.text === text);
  };
  const marksOf = (room: Room) =>
    (room.phase as { selfMarks: SelfMarks }).selfMarks;

  test("the scoring phase opens with nothing marked", () => {
    expect(marksOf(scored())).toEqual({ counts: {}, last: null });
  });

  test("a player strikes one of their own words out", () => {
    const before = scored();
    const index = indexOf(before, "p0", "Beyonce");
    const after = reduce(before, {
      t: "selfStrike", playerId: "p0", index, struck: true, now: 50_000,
    });
    expect(isSelfStruck(marksOf(after), rowKey("p0", index))).toBe(true);
    expect(marksOf(after).last).toEqual({ row: rowKey("p0", index), at: 50_000 });
  });

  test("tapping it again takes it back", () => {
    let room = scored();
    const index = indexOf(room, "p0", "Beyonce");
    room = reduce(room, { t: "selfStrike", playerId: "p0", index, struck: true, now: 50_000 });
    room = reduce(room, { t: "selfStrike", playerId: "p0", index, struck: false, now: 51_000 });
    expect(isSelfStruck(marksOf(room), rowKey("p0", index))).toBe(false);
  });

  test("asking for the state it is already in is a no-op", () => {
    const before = scored();
    const index = indexOf(before, "p0", "Beyonce");
    expect(
      reduce(before, { t: "selfStrike", playerId: "p0", index, struck: false, now: 50_000 }),
    ).toBe(before);
    const struck = reduce(before, {
      t: "selfStrike", playerId: "p0", index, struck: true, now: 50_000,
    });
    expect(
      reduce(struck, { t: "selfStrike", playerId: "p0", index, struck: true, now: 51_000 }),
    ).toBe(struck);
  });

  // The whole point of the guard: a duplicate is already struck, so restoring
  // one would award back a point nobody ever had.
  test("a duplicated word cannot be marked", () => {
    const before = scored();
    const index = indexOf(before, "p0", "Adele");
    expect(
      reduce(before, { t: "selfStrike", playerId: "p0", index, struck: true, now: 50_000 }),
    ).toBe(before);
  });

  test("an index outside the scorer's list is ignored", () => {
    const before = scored();
    for (const index of [-1, 99, Number.NaN]) {
      expect(
        reduce(before, { t: "selfStrike", playerId: "p0", index, struck: true, now: 50_000 }),
      ).toBe(before);
    }
  });

  test("somebody who was not in the round cannot mark anything", () => {
    const before = scored();
    expect(
      reduce(before, { t: "selfStrike", playerId: "host", index: 0, struck: true, now: 50_000 }),
    ).toBe(before);
  });

  test("it is refused outside the scoring screen", () => {
    const before = playing();
    expect(
      reduce(before, { t: "selfStrike", playerId: "p0", index: 0, struck: true, now: 50_000 }),
    ).toBe(before);
  });

  test("the banked round places the self-validated scores", () => {
    let room = scored();
    // p0 had Adele (duplicated) and Beyonce (unique); p1 had Adele only. p0
    // wins the round 1-0 until it disowns the only word that scored.
    const index = indexOf(room, "p0", "Beyonce");
    room = reduce(room, { t: "selfStrike", playerId: "p0", index, struck: true, now: 50_000 });
    room = reduce(room, { t: "showStandings", playerId: "host", now: 51_000 });
    expect(room.history[0].places.p0).toMatchObject({ unique: 0, total: 2, place: 1 });
    expect(room.history[0].places.p1).toMatchObject({ unique: 0, total: 1, place: 1 });
  });

  test("a word taken back before the round banks still scores", () => {
    let room = scored();
    const index = indexOf(room, "p0", "Beyonce");
    room = reduce(room, { t: "selfStrike", playerId: "p0", index, struck: true, now: 50_000 });
    room = reduce(room, { t: "selfStrike", playerId: "p0", index, struck: false, now: 51_000 });
    room = reduce(room, { t: "showStandings", playerId: "host", now: 52_000 });
    expect(room.history[0].places.p0.unique).toBe(1);
    expect(room.history[0].places.p0.place).toBe(1);
    expect(room.history[0].places.p1.place).toBe(2);
  });

  test("readying everyone up banks the self-validated round too", () => {
    let room = scored();
    const index = indexOf(room, "p0", "Beyonce");
    room = reduce(room, { t: "selfStrike", playerId: "p0", index, struck: true, now: 50_000 });
    room = readyAll(room, 51_000);
    expect(room.phase.name).toBe("standings");
    expect(room.history[0].places.p0.unique).toBe(0);
  });

  // The marks live on the phase, so the next round starts clean with nothing
  // having to clear them.
  test("the next round's scoring screen opens with no marks", () => {
    let room = scored();
    const index = indexOf(room, "p0", "Beyonce");
    room = reduce(room, { t: "selfStrike", playerId: "p0", index, struck: true, now: 50_000 });
    room = reduce(room, { t: "showStandings", playerId: "host", now: 51_000 });
    room = readyAll(room, 52_000);
    const startAt = (room.phase as { endsAt: number }).endsAt;
    room = reduce(room, { t: "tick", now: startAt, roll: 0 }); // -> playing
    const playEnd = (room.phase as { endsAt: number }).endsAt;
    room = reduce(room, { t: "tick", now: playEnd, roll: 0 }); // -> timesup
    const upEnd = (room.phase as { endsAt: number }).endsAt;
    room = reduce(room, { t: "tick", now: upEnd, roll: 0 }); // -> scoring
    expect(room.phase.name).toBe("scoring");
    expect(marksOf(room)).toEqual({ counts: {}, last: null });
  });
});

describe("selfStrike in team play", () => {
  test("any member may mark the list their team shares", () => {
    let room = playingInTeams();
    room = submitEntry(room, "p0", "Adele", 10_000).room;
    room = submitEntry(room, "p1", "Cher", 10_100).room;
    const playEnd = (room.phase as { endsAt: number }).endsAt;
    room = reduce(room, { t: "tick", now: playEnd, roll: 0 });
    const upEnd = (room.phase as { endsAt: number }).endsAt;
    room = reduce(room, { t: "tick", now: upEnd, roll: 0 });
    expect(room.phase.name).toBe("scoring");

    const teamId = room.players.find((p) => p.id === "p1")!.teamId!;
    const results = (room.phase as { results: Results }).results;
    const team = results.scorers.find((s) => s.id === teamId)!;
    const index = team.entries.findIndex((e) => e.by === "p0");
    expect(index).toBeGreaterThanOrEqual(0);

    // p1 strikes the word p0 wrote: it is the team's list, not p0's.
    const after = reduce(room, {
      t: "selfStrike", playerId: "p1", index, struck: true, now: 50_000,
    });
    expect(isSelfStruck(marksOfPhase(after), rowKey(teamId, index))).toBe(true);
  });
});

function marksOfPhase(room: Room): SelfMarks {
  return (room.phase as { selfMarks: SelfMarks }).selfMarks;
}

/**
 * A room in the `creating` phase: `n` players, quota `quotaFor(n, roundCount)`,
 * nobody has written anything yet. Walks the real edges — a custom-categories
 * lobby, the countdown, the whistle — so the helper cannot drift from the
 * rules, the same reasoning `seedVoting` and `playingRoom` follow.
 */
function creatingRoom(n: number, roundCount: number, now = 1000): Room {
  let room = seed(n, now);
  room = { ...room, settings: { ...room.settings, categorySource: "custom", roundCount } };
  room = reduce(room, { t: "startGame", playerId: room.hostId!, now });
  return reduce(room, { t: "tick", now: now + COUNTDOWN_MS, roll: 0.5 });
}

/**
 * Every player's whole quota committed, via real `commitDraft` events — the
 * very last one is what closes the phase, so this returns a room already on
 * `voting`. See the "closes when everyone is ready" test below.
 */
function allWritten(n: number, roundCount: number, now = 1000): Room {
  let room = creatingRoom(n, roundCount, now);
  const quota = quotaFor(n, roundCount);
  room.players.forEach((p, i) => {
    for (let slot = 0; slot < quota; slot++) {
      room = reduce(room, {
        t: "commitDraft", playerId: p.id, slot, text: `${p.id}-${slot}`, now: now + i * quota + slot + 1,
      });
    }
  });
  return room;
}

/**
 * A custom room already in `voting`: the pool is built, hands are dealt, and
 * nobody has voted yet. `allWritten` already drives the real edge from
 * `creating` into `voting`, so this is just the name the voting tests know it
 * by.
 */
function votingRoom(n: number, roundCount: number, now = 1000): Room {
  return allWritten(n, roundCount, now);
}

describe("the creating phase", () => {
  const custom = (players: number, roundCount = 3) => {
    let room = seed(players); // existing helper: N connected, unready players
    room = { ...room, settings: { ...room.settings, categorySource: "custom", roundCount } };
    return room;
  };

  it("opens a countdown to creating rather than to voting", () => {
    let room = custom(3);
    room = reduce(room, { t: "startGame", playerId: room.hostId!, now: 0 });
    expect(room.phase).toEqual({ name: "countdown", endsAt: COUNTDOWN_MS, to: "creating" });
  });

  it("opens the writing window at the whistle, and clears readiness", () => {
    let room = custom(3);
    room = reduce(room, { t: "startGame", playerId: room.hostId!, now: 0 });
    room = reduce(room, { t: "tick", now: COUNTDOWN_MS, roll: 0.5 });
    expect(room.phase).toEqual({ name: "creating", endsAt: COUNTDOWN_MS + WRITE_MS });
    expect(room.players.every((p) => !p.ready)).toBe(true);
    expect(room.pool).toBeNull();
  });

  it("readies a player only when every slot they own is committed", () => {
    let room = creatingRoom(3, 3); // helper: 3 players, quota 3, phase creating
    const me = room.players[0].id;
    room = reduce(room, { t: "commitDraft", playerId: me, slot: 0, text: "smells", now: 1 });
    expect(room.players[0].ready).toBe(false);
    room = reduce(room, { t: "commitDraft", playerId: me, slot: 1, text: "noises", now: 2 });
    room = reduce(room, { t: "commitDraft", playerId: me, slot: 2, text: "places", now: 3 });
    expect(room.players[0].ready).toBe(true);
  });

  it("trims, caps and rejects an out-of-range slot", () => {
    let room = creatingRoom(3, 3);
    const me = room.players[0].id;
    room = reduce(room, { t: "commitDraft", playerId: me, slot: 0, text: "  a  ", now: 1 });
    expect(room.drafts[me][0]).toBe("a");
    room = reduce(room, { t: "commitDraft", playerId: me, slot: 1, text: "x".repeat(40), now: 2 });
    expect(room.drafts[me][1]).toHaveLength(MAX_CATEGORY_LEN);
    const before = room;
    room = reduce(room, { t: "commitDraft", playerId: me, slot: 9, text: "no", now: 3 });
    expect(room).toBe(before);
  });

  /**
   * Deviation from the brief: its literal test built this scenario from
   * `allWritten(3, 3)` and then asserted the phase was still `"creating"`
   * after a `clearDraft`. That cannot happen — `allWritten` (below) drives
   * real `commitDraft` events, and the moment the *last* player finishes,
   * `settle` closes the phase in that same `reduce` call. There is no later
   * moment at which a `clearDraft` can still catch the room in `creating`
   * with everyone otherwise ready; the close is atomic with the event that
   * completes it, exactly as spending the last vote is atomic with closing
   * voting. So this rebuilds the scenario the description actually asks for:
   * two players ready, a third one slot short (phase still open), and shows
   * that clearing one of the two *already-ready* players' slots is what stops
   * the third's final commit from closing the phase a moment later — the
   * clear pre-empts a close that would otherwise have fired.
   */
  it("un-readies on a clear, and that pre-empts a close it would otherwise let happen", () => {
    let room = creatingRoom(3, 3);
    const [a, b, c] = room.players.map((p) => p.id);
    const finish = (id: string, upTo: number, now: number) => {
      for (let slot = 0; slot < upTo; slot++) {
        room = reduce(room, { t: "commitDraft", playerId: id, slot, text: `${id}${slot}`, now });
      }
    };
    finish(a, 3, 10);
    finish(b, 3, 11);
    finish(c, 2, 12); // one slot short — the phase is still open
    expect(room.phase.name).toBe("creating");

    room = reduce(room, { t: "clearDraft", playerId: a, slot: 0, now: 20 });
    expect(room.players.find((p) => p.id === a)!.ready).toBe(false);
    expect(room.phase.name).toBe("creating");

    // c's final commit would have closed the phase had a's readiness not just
    // been pulled out from under it.
    room = reduce(room, { t: "commitDraft", playerId: c, slot: 2, text: "c2", now: 30 });
    expect(room.phase.name).toBe("creating");
  });

  it("closes when everyone is ready, building the pool and the deal once", () => {
    const room = allWritten(4, 3);
    // `settle` runs on the event that completed the last player, so the room
    // has already left `creating`.
    expect(room.phase.name).toBe("voting");
    expect(room.pool).toHaveLength(12);
    expect(Object.keys(room.deal)).toHaveLength(4);
  });

  it("closes on the deadline with blanks backfilled", () => {
    let room = creatingRoom(4, 3);
    room = reduce(room, { t: "tick", now: 10 ** 9, roll: 0.5 });
    expect(room.phase.name).toBe("voting");
    expect(room.pool!.every((c) => c.authorId === null)).toBe(true);
  });

  it("moves the cursor without touching readiness", () => {
    let room = creatingRoom(3, 3);
    const me = room.players[0].id;
    room = reduce(room, { t: "moveCursor", playerId: me, slot: 2, now: 1 });
    expect(room.cursors[me]).toBe(2);
    expect(room.players[0].ready).toBe(false);
  });

  it("rejects moveCursor from a playerId that is not in the room", () => {
    // Mirrors the membership guard writeSlot already applies for
    // commitDraft/clearDraft — a hand-rolled message naming a nonexistent
    // player must not seat a phantom entry in `room.cursors`.
    const room = creatingRoom(3, 3);
    const after = reduce(room, { t: "moveCursor", playerId: "ghost", slot: 1, now: 1 });
    expect(after).toBe(room);
  });

  it("steps back one phase, not all the way home", () => {
    let room = creatingRoom(3, 3);
    room = reduce(room, { t: "backToLobby", playerId: room.hostId!, now: 1 });
    expect(room.phase.name).toBe("lobby");
    expect(room.drafts).toEqual({});
  });

  it("never opens for a stock match", () => {
    let room = seed(3);
    room = reduce(room, { t: "startGame", playerId: room.hostId!, now: 0 });
    expect(room.phase).toEqual({ name: "countdown", endsAt: COUNTDOWN_MS, to: "voting" });
  });
});

describe("voting on hands", () => {
  it("accepts a card in one of my hands and refuses one that is not", () => {
    let room = votingRoom(4, 3); // helper: custom room already in `voting`
    const me = room.players[0].id;
    const mine = room.deal[me][0].cardIds[0];
    const theirs = room.deal[room.players[1].id][0].cardIds
      .find((id) => !room.deal[me].some((h) => h.cardIds.includes(id)))!;
    const after = reduce(room, { t: "castVote", playerId: me, category: mine, now: 1 });
    expect(after.votes[me][mine]).toBe(1);
    const refused = reduce(room, { t: "castVote", playerId: me, category: theirs, now: 1 });
    expect(refused).toBe(room);
  });

  it("stops at the budget and readies on the last vote", () => {
    let room = votingRoom(4, 3);
    const me = room.players[0].id;
    for (const hand of room.deal[me]) {
      room = reduce(room, { t: "castVote", playerId: me, category: hand.cardIds[0], now: 1 });
    }
    expect(votesSpent(room.votes[me])).toBe(VOTE_BUDGET);
    expect(room.players[0].ready).toBe(true);
    const extra = reduce(room, {
      t: "castVote", playerId: me, category: room.deal[me][0].cardIds[1], now: 2,
    });
    expect(extra).toBe(room);
  });
});

/**
 * The pool and the deal exist to keep authorship unreadable, and both are
 * built from a `roll` seed. Nothing here would catch a `closeCreating` that
 * silently dropped its roll on the floor — every other test in this file
 * either passes a fixed roll through `tick` or never varies it — so these
 * prove entropy actually reaches both close paths: the `tick` deadline, and
 * `settle`'s ready-up edge, which has no `roll` on its event at all and has
 * to derive one (see `seedRoll` in `shared/customCategories.ts`).
 */
describe("close entropy reaches the pool", () => {
  /** The id-to-text mapping a shuffle actually controls, order-independent. */
  const mapOf = (room: Room): Record<string, string> => {
    const m: Record<string, string> = {};
    for (const c of room.pool!) m[c.id] = c.text;
    return m;
  };

  it("two deadline closes with different tick rolls shuffle the pool differently", () => {
    const roomA = creatingRoom(4, 3, 1000);
    const roomB = creatingRoom(4, 3, 1000);
    const now = 10 ** 9;
    const closedA = reduce(roomA, { t: "tick", now, roll: 0.1 });
    const closedB = reduce(roomB, { t: "tick", now, roll: 0.9 });
    expect(closedA.phase.name).toBe("voting");
    expect(closedB.phase.name).toBe("voting");
    // Same players, same (blank) drafts, same quota — the only thing that can
    // differ is the roll-seeded shuffle.
    expect(mapOf(closedA)).not.toEqual(mapOf(closedB));
    expect(closedA.deal).not.toEqual(closedB.deal);
  });

  it("two ready-up closes at different instants shuffle the pool differently", () => {
    // `allWritten` drives the room to the moment its last commitDraft closes
    // `creating` via `settle` — the path with no `roll` on its event at all.
    // A different base `now` puts that close at a different instant, which is
    // the only entropy `seedRoll` has to work with (the room code is fixed by
    // the `seed` helper both calls go through).
    const roomA = allWritten(4, 3, 1000);
    const roomB = allWritten(4, 3, 5_000_000);
    expect(roomA.phase.name).toBe("voting");
    expect(roomB.phase.name).toBe("voting");
    expect(mapOf(roomA)).not.toEqual(mapOf(roomB));
    expect(roomA.deal).not.toEqual(roomB.deal);
  });
});
