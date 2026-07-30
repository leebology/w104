import { describe, expect, test } from "vitest";
import { MAX_BOTS, botCount, botId, isBot, isWaiting, seatBots, setBotCount } from "./bots";
import { MAX_PLAYERS, MIN_PLAYERS, reduce } from "./reduce";
import { createRoom } from "./state";
import type { Player, Room } from "./state";
import { makeTeams, rosterOf } from "./teams";

/** A room with `n` joined humans, none ready, plus a host. */
function seed(n: number, now = 1000): Room {
  let room = createRoom("PLUM", now);
  room = reduce(room, { t: "claimHost", playerId: "host", now });
  for (let i = 0; i < n; i++) {
    room = reduce(room, { t: "join", playerId: `p${i}`, name: `P${i}`, emoji: "🐙", now });
  }
  return room;
}

const withBots = (room: Room, count: number, playerId = "host", now = 2000): Room =>
  reduce(room, { t: "debugBots", playerId, count, now });

const readyAll = (room: Room): Room => ({
  ...room,
  players: room.players.map((p) => ({ ...p, ready: true })),
});

describe("setBotCount", () => {
  test("grows to the asked-for count and keeps the humans in front", () => {
    const players = setBotCount(seed(2).players, 3);
    expect(players.map((p) => p.id)).toEqual(["p0", "p1", botId(0), botId(1), botId(2)]);
    expect(players.filter(isBot).map((p) => p.name)).toEqual(["Frodo", "Sam", "Gandalf"]);
  });

  test("shrinks from the end, leaving the earlier bots untouched", () => {
    const three = setBotCount(seed(1).players, 3);
    const one = setBotCount(three, 1);
    expect(one.filter(isBot)).toEqual([three.find(isBot)]);
  });

  /** Raising the count must not re-deal the seats already on a team. */
  test("keeps existing bots as they are when growing", () => {
    const two = seatBots(setBotCount(seed(0).players, 2), makeTeams(2));
    const four = setBotCount(two, 4);
    expect(four.slice(0, 2)).toEqual(two);
  });

  test("clamps to 0..MAX_BOTS and survives nonsense", () => {
    const base = seed(1).players;
    expect(botCount(setBotCount(base, 999))).toBe(MAX_BOTS);
    expect(botCount(setBotCount(base, -4))).toBe(0);
    expect(botCount(setBotCount(base, Number.NaN))).toBe(0);
    expect(botCount(setBotCount(base, 2.7))).toBe(2);
  });

  test("returns the identical array when the count is already right", () => {
    const players = setBotCount(seed(1).players, 2);
    expect(setBotCount(players, 2)).toBe(players);
  });

  test("every roster entry is distinct, so no two bots look alike", () => {
    const bots = setBotCount([], MAX_BOTS).filter(isBot);
    expect(new Set(bots.map((b) => b.name)).size).toBe(MAX_BOTS);
    expect(new Set(bots.map((b) => b.emoji)).size).toBe(MAX_BOTS);
    expect(new Set(bots.map((b) => b.id)).size).toBe(MAX_BOTS);
  });
});

describe("isWaiting", () => {
  const human = (ready: boolean): Player => ({
    id: "p0", name: "P0", emoji: "🐙", ready, connected: true, teamId: null,
  });

  test("a bot is always waiting, a human only when they say so", () => {
    expect(isWaiting(human(false))).toBe(false);
    expect(isWaiting(human(true))).toBe(true);
    expect(isWaiting(setBotCount([], 1)[0])).toBe(true);
  });
});

describe("seatBots", () => {
  test("spreads the bots across the teams and leaves the humans picking", () => {
    const players = setBotCount(seed(2).players, 4);
    const seated = seatBots(players, makeTeams(2));
    expect(seated.filter(isBot).map((b) => b.teamId)).toEqual(["t0", "t1", "t0", "t1"]);
    // Team select is *for* the humans choosing; nothing here may choose for them.
    expect(seated.filter((p) => !isBot(p)).every((p) => p.teamId === null)).toBe(true);
  });

  test("does nothing without teams, or without bots", () => {
    const humans = seed(2).players;
    const players = setBotCount(humans, 2);
    expect(seatBots(players, [])).toBe(players);
    expect(seatBots(humans, makeTeams(2))).toBe(humans);
  });

  test("leaves a bot already on a team where it is", () => {
    const seated = seatBots(setBotCount(seed(0).players, 2), makeTeams(2));
    expect(seatBots(seated, makeTeams(2))).toBe(seated);
  });
});

describe("debugBots", () => {
  test("is host-only", () => {
    const room = seed(2);
    expect(withBots(room, 3, "p0")).toBe(room);
  });

  test("is a no-op when the room already holds that many", () => {
    const room = withBots(seed(2), 3);
    expect(withBots(room, 3, "host", 3000)).toBe(room);
  });

  test("sets the population absolutely, both ways", () => {
    let room = withBots(seed(2), 5);
    expect(botCount(room.players)).toBe(5);
    room = withBots(room, 2, "host", 3000);
    expect(botCount(room.players)).toBe(2);
    room = withBots(room, 0, "host", 4000);
    expect(botCount(room.players)).toBe(0);
    expect(room.players.map((p) => p.id)).toEqual(["p0", "p1"]);
  });

  test("works from every phase, not just the lobby", () => {
    const room = reduce(seed(2), { t: "debugJump", playerId: "host", to: "playing", roll: 0.5, now: 2000 });
    expect(botCount(withBots(room, 4, "host", 2500).players)).toBe(4);
  });

  /**
   * The same rule a kick follows: a departed list must not go on striking
   * through words that are still on screen.
   */
  test("trimmed bots take their words with them", () => {
    let room = withBots(seed(1), 2);
    room = reduce(room, { t: "debugJump", playerId: "host", to: "playing", roll: 0.5, now: 2500 });
    // Written straight in: `entries` is the server's to fill (auto-fill loops
    // `submitEntry` in `party/server.ts`), and `reduce` never touches it.
    room = {
      ...room,
      entries: {
        p0: [{ text: "otter", at: 2600, by: "p0" }],
        [botId(1)]: [{ text: "kettle", at: 2600, by: botId(1) }],
      },
    };
    const trimmed = withBots(room, 1, "host", 2700);
    expect(trimmed.entries[botId(1)]).toBeUndefined();
    expect(trimmed.entries.p0).toHaveLength(1);
  });

  test("bots seat themselves when team select opens", () => {
    const room = withBots({ ...seed(2), settings: { ...seed(2).settings, teamCount: 2 } }, 4);
    const teams = reduce(room, { t: "startGame", playerId: "host", now: 3000 });
    expect(teams.phase.name).toBe("teams");
    expect(teams.players.filter(isBot).every((b) => b.teamId !== null)).toBe(true);
    expect(teams.players.filter((p) => !isBot(p)).every((p) => p.teamId === null)).toBe(true);
  });
});

describe("bots are inert", () => {
  /**
   * The whole safety story: scenery may not start a match. A lone player with a
   * room full of bots is still a lone player, so readying up must not open a
   * countdown — only the host's own Start button can.
   */
  test("a bot cannot make a room startable", () => {
    const room = withBots(seed(1), 6);
    expect(room.players.length).toBeGreaterThan(MIN_PLAYERS);
    const readied = reduce(room, { t: "ready", playerId: "p0", ready: true, now: 3000 });
    expect(readied.phase.name).toBe("lobby");
    // The host override still works, which is how a dressed room gets moving.
    expect(reduce(readied, { t: "startGame", playerId: "host", now: 3100 }).phase.name)
      .toBe("countdown");
  });

  test("a bot cannot hold a countdown down either", () => {
    const room = withBots(readyAll(seed(2)), 6);
    // `settle` ran on the bot event and was not fooled by six unready seats.
    expect(room.phase.name).toBe("countdown");
  });

  test("a bot does not consume a seat at the player cap", () => {
    let room = withBots(seed(MAX_PLAYERS - 1), MAX_BOTS);
    room = reduce(room, { t: "join", playerId: "late", name: "Late", emoji: "🦊", now: 3000 });
    expect(room.players.some((p) => p.id === "late")).toBe(true);
  });
});

describe("bots score as seats", () => {
  /**
   * A bot is a scorer like anyone else — that is what puts a card in the reveal
   * grid and a row on the podium, which is the entire reason to add one.
   */
  test("a bot is a scorer, with an empty list when nobody filled it", () => {
    const room = withBots(seed(1), 2);
    expect(rosterOf(room).map((s) => s.id)).toEqual(["p0", botId(0), botId(1)]);
  });

  test("in team play the bots' teams score, not the bots", () => {
    const base = seed(2);
    const room = withBots({ ...base, settings: { ...base.settings, teamCount: 2 } }, 4);
    const teams = reduce(room, { t: "startGame", playerId: "host", now: 3000 });
    expect(rosterOf(teams)).toHaveLength(2);
  });
});
