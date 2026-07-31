import { describe, expect, test } from "vitest";
import {
  gameId,
  gameResultRows,
  gameStartRows,
  playedCategories,
  roundId,
  roundRows,
  voteRows,
} from "./archive";
import { BALLOT, RANDOM_CATEGORY } from "./categories";
import { scoreRound } from "./scoring";
import { placeRound } from "./standings";
import { rosterOf } from "./teams";
import { createRoom } from "./state";
import type { Entry, Player, Room } from "./state";

const player = (id: string, over: Partial<Player> = {}): Player => ({
  id,
  name: id.toUpperCase(),
  emoji: "🐸",
  ready: true,
  connected: true,
  teamId: null,
  ...over,
});

const entry = (text: string, by: string, at: number): Entry => ({ text, by, at });

function room(over: Partial<Room> = {}): Room {
  return { ...createRoom("ABCD", 1000), hostId: "host", ...over };
}

/** Runs the real scoring pipeline so the tests exercise what the server will. */
function bank(r: Room, ctx: { gameId: string; roundIndex: number; startedAt: number; endedAt: number }) {
  const results = scoreRound({ scorers: rosterOf(r), entries: r.entries });
  return roundRows(r, results, placeRound(results), ctx);
}

describe("ids", () => {
  test("are deterministic so a retried write collides instead of duplicating", () => {
    expect(gameId("ABCD", 5000)).toBe("ABCD:5000");
    expect(gameId("ABCD", 5000)).toBe(gameId("ABCD", 5000));
    expect(roundId("ABCD:5000", 0)).toBe("ABCD:5000:0");
  });
});

describe("gameStartRows", () => {
  test("archives the host as a participant despite holding no seat", () => {
    const r = room({ players: [player("a"), player("b")] });
    const { players, participation, game } = gameStartRows(r, {
      gameId: "ABCD:5000",
      lobbyCreatedAt: 1000,
      startedAt: 5000,
      scoringVersion: 1,
    });

    expect(players).toHaveLength(3);
    expect(participation.find((p) => p.player_id === "host")!.role).toBe("host");
    expect(participation.filter((p) => p.role === "player")).toHaveLength(2);
    expect(game.host_player_id).toBe("host");
    expect(game.lobby_code).toBe("ABCD");
  });

  test("records display identity as it stood that night, not on the player row", () => {
    const r = room({ players: [player("a", { name: "Liam", emoji: "🐸" })] });
    const { participation, players } = gameStartRows(r, {
      gameId: "g",
      lobbyCreatedAt: 1,
      startedAt: 2,
      scoringVersion: 1,
    });
    expect(participation.find((p) => p.player_id === "a")).toMatchObject({
      name: "Liam",
      emoji: "🐸",
    });
    // The stable identity carries no display fields at all, so a later rename
    // cannot overwrite what this game recorded.
    expect(players.find((p) => p.player_id === "a")).not.toHaveProperty("name");
  });

  test("carries team membership when teams are on", () => {
    const r = room({
      players: [player("a", { teamId: "t0" })],
      teams: [{ id: "t0", colorIndex: 0, name: "Red" }],
    });
    const { participation } = gameStartRows(r, {
      gameId: "g",
      lobbyCreatedAt: 1,
      startedAt: 2,
      scoringVersion: 1,
    });
    expect(participation.find((p) => p.player_id === "a")).toMatchObject({
      team_id: "t0",
      team_name: "Red",
    });
  });

  test("settings ride as JSON, so a catalog change needs no migration", () => {
    const r = room({ players: [player("a")] });
    const { game } = gameStartRows(r, {
      gameId: "g",
      lobbyCreatedAt: 1,
      startedAt: 2,
      scoringVersion: 7,
    });
    expect(JSON.parse(game.settings)).toMatchObject({ roundCount: expect.any(Number) });
    expect(game.scoring_version).toBe(7);
  });
});

describe("voteRows", () => {
  test("snapshots the whole ballot, including options nobody voted for", () => {
    const r = room({ votes: { a: { movie: 2 }, b: { movie: 1, song: 1 } } });
    const { categories } = voteRows(r, "g");
    expect(categories).toHaveLength(BALLOT.length);
    expect(categories.find((c) => c.category === "movie")!.vote_total).toBe(3);
    expect(categories.find((c) => c.category === "car")!.vote_total).toBe(0);
  });

  test("the random option gets a row like everything else on the ballot", () => {
    // Without it the vote counts would not add up to the votes cast: it is
    // votable, so it is part of the snapshot. It simply never plays.
    const r = room({ votes: { a: { [RANDOM_CATEGORY]: 2 } } });
    const { categories, votes } = voteRows(r, "g");
    expect(categories.find((c) => c.category === RANDOM_CATEGORY)!.vote_total).toBe(2);
    expect(votes).toEqual([
      { game_id: "g", player_id: "a", category: RANDOM_CATEGORY, count: 2 },
    ]);
  });

  test("keeps votes as per-player counts, not a set", () => {
    const r = room({ votes: { a: { movie: 3 }, b: {} } });
    const { votes } = voteRows(r, "g");
    expect(votes).toEqual([{ game_id: "g", player_id: "a", category: "movie", count: 3 }]);
  });

  test("drops zero-count rows rather than storing them", () => {
    const r = room({ votes: { a: { movie: 0, song: 2 } } });
    expect(voteRows(r, "g").votes.map((v) => v.category)).toEqual(["song"]);
  });
});

describe("roundRows", () => {
  const ctx = { gameId: "g", roundIndex: 0, startedAt: 10_000, endedAt: 40_000 };

  test("stores raw and normalized text, and time into the round", () => {
    const r = room({
      players: [player("a"), player("b")],
      category: "woman",
      entries: { a: [entry("Beyoncé!", "a", 12_500)], b: [entry("Adele", "b", 11_000)] },
    });
    const { round, words } = bank(r, ctx);

    expect(round).toMatchObject({ round_id: "g:0", category: "woman", round_index: 0 });
    const beyonce = words.find((w) => w.player_id === "a")!;
    expect(beyonce.raw).toBe("Beyoncé!");
    expect(beyonce.normalized).toBe("beyonce");
    expect(beyonce.ms_into_round).toBe(2500);
    expect(beyonce.ordinal).toBe(1);
  });

  test("a shared word is not unique and both sides carry the same collision group", () => {
    const r = room({
      players: [player("a"), player("b")],
      entries: { a: [entry("Adele", "a", 11_000)], b: [entry("adele", "b", 12_000)] },
    });
    const { words } = bank(r, ctx);
    const [wa, wb] = ["a", "b"].map((id) => words.find((w) => w.player_id === id)!);

    expect(wa.is_unique).toBe(0);
    expect(wb.is_unique).toBe(0);
    expect(wa.collision_group).not.toBeNull();
    expect(wa.collision_group).toBe(wb.collision_group);
  });

  test("a unique word has a null collision group", () => {
    const r = room({
      players: [player("a"), player("b")],
      entries: { a: [entry("Zendaya", "a", 11_000)], b: [entry("Adele", "b", 12_000)] },
    });
    const { words } = bank(r, ctx);
    const wa = words.find((w) => w.player_id === "a")!;
    expect(wa.is_unique).toBe(1);
    expect(wa.collision_group).toBeNull();
  });

  test("two words cancelled by the same rival land in different groups", () => {
    // The case scoreRound's `group` exists for — `alsoBy` is identical here.
    const r = room({
      players: [player("a"), player("b")],
      entries: {
        a: [entry("Adele", "a", 11_000), entry("Cher", "a", 12_000)],
        b: [entry("Adele", "b", 13_000), entry("Cher", "b", 14_000)],
      },
    });
    const mine = bank(r, ctx).words.filter((w) => w.player_id === "a");
    expect(mine[0].collision_group).not.toBe(mine[1].collision_group);
  });

  test("blanks and a player's own repeat are archived but not counted", () => {
    const r = room({
      players: [player("a"), player("b")],
      entries: {
        a: [entry("Adele", "a", 11_000), entry("   ", "a", 12_000), entry("adele", "a", 13_000)],
        b: [],
      },
    });
    const mine = bank(r, ctx).words.filter((w) => w.player_id === "a");

    expect(mine).toHaveLength(3); // every submission survives
    expect(mine.map((w) => w.counted)).toEqual([1, 0, 0]);
    expect(mine.map((w) => w.ordinal)).toEqual([1, 2, 3]);
    // Uncounted submissions never reached scoring, so they have no verdict.
    expect(mine[1].is_unique).toBeNull();
    expect(mine[2].is_unique).toBeNull();
  });

  test("scores are keyed by scorer and carry the round place", () => {
    const r = room({
      players: [player("a"), player("b")],
      entries: {
        a: [entry("Zendaya", "a", 11_000), entry("Cher", "a", 12_000)],
        b: [entry("Adele", "b", 13_000)],
      },
    });
    const { scores } = bank(r, ctx);
    const sa = scores.find((s) => s.scorer_id === "a")!;
    expect(sa).toMatchObject({ scorer_type: "player", unique_count: 2, total_count: 2, place: 1 });
    expect(scores.find((s) => s.scorer_id === "b")!.place).toBe(2);
  });

  describe("in team play", () => {
    const teamRoom = () =>
      room({
        settings: {
          mode: "ffa", roundCount: 3, durationSec: 30, teamCount: 2, categorySource: "stock",
        },
        players: [
          player("a", { teamId: "t0" }),
          player("b", { teamId: "t0" }),
          player("c", { teamId: "t1" }),
        ],
        teams: [
          { id: "t0", colorIndex: 0, name: "Red" },
          { id: "t1", colorIndex: 1, name: "Blue" },
        ],
        entries: {
          a: [entry("Adele", "a", 11_000)],
          b: [entry("Cher", "b", 12_000)],
          c: [entry("Zendaya", "c", 13_000)],
        },
      });

    test("words stay keyed by player but score for the team", () => {
      const { words } = bank(teamRoom(), ctx);
      const wa = words.find((w) => w.player_id === "a")!;
      expect(wa.player_id).toBe("a");
      expect(wa.scorer_id).toBe("t0");
    });

    test("scores are per team, typed as such", () => {
      const { scores } = bank(teamRoom(), ctx);
      expect(scores.map((s) => s.scorer_id).sort()).toEqual(["t0", "t1"]);
      expect(scores.every((s) => s.scorer_type === "team")).toBe(true);
      expect(scores.find((s) => s.scorer_id === "t0")!.unique_count).toBe(2);
    });

    test("a teammate's duplicate of an existing team word is archived uncounted", () => {
      const r = teamRoom();
      r.entries.b = [entry("adele", "b", 12_000)]; // same answer as a's
      const mine = bank(r, ctx).words.filter((w) => w.scorer_id === "t0");
      expect(mine).toHaveLength(2);
      expect(mine.map((w) => w.counted)).toEqual([1, 0]);
      // Ordinal is per player, so the second teammate's first word is theirs.
      expect(mine[1]).toMatchObject({ player_id: "b", ordinal: 1 });
    });

    test("an empty team does not score, per rosterOf", () => {
      const r = teamRoom();
      r.players = r.players.map((p) => (p.teamId === "t1" ? { ...p, teamId: "t0" } : p));
      expect(bank(r, ctx).scores.map((s) => s.scorer_id)).toEqual(["t0"]);
    });
  });
});

describe("gameResultRows", () => {
  test("projects the match standings, ties sharing a place", () => {
    const r = room({
      players: [player("a"), player("b"), player("c")],
      history: [
        {
          category: "woman",
          places: {
            a: { unique: 3, total: 3, place: 1 },
            b: { unique: 1, total: 2, place: 2 },
            c: { unique: 1, total: 2, place: 2 },
          },
        },
      ],
    });
    const rows = gameResultRows(r, "g");
    // Three scorers, so 1st pays 3; b and c share 2nd and take 2 each.
    expect(rows.find((x) => x.scorer_id === "a")).toMatchObject({ place: 1, total_score: 3 });
    expect(rows.find((x) => x.scorer_id === "b")!.place).toBe(2);
    expect(rows.find((x) => x.scorer_id === "c")!.place).toBe(2);
  });
});

describe("playedCategories", () => {
  test("dedupes, so the match-end update is idempotent", () => {
    const r = room({
      history: [
        { category: "woman", places: {} },
        { category: "song", places: {} },
      ],
    });
    expect(playedCategories(r).sort()).toEqual(["song", "woman"]);
  });
});

describe("the waiting room and the archive", () => {
  test("a waiting player scores no row in the round they sat out", () => {
    // Falls out of `rosterOf`, which is where the rule lives — nothing in the
    // row builders has to know the waiting room exists.
    const r = room({
      players: [player("a"), player("b"), player("late", { waiting: true })],
      phase: { name: "playing", endsAt: 9000 },
      entries: {
        a: [entry("Adele", "a", 6000)],
        b: [entry("Beyonce", "b", 6100)],
      },
    });
    const { scores, words } = bank(r, {
      gameId: "ABCD:5000", roundIndex: 0, startedAt: 5000, endedAt: 9000,
    });
    expect(scores.map((s) => s.scorer_id).sort()).toEqual(["a", "b"]);
    expect(words.every((w) => w.player_id !== "late")).toBe(true);
  });

  test("they are not on the standings either, until they have played one", () => {
    const r = room({
      players: [player("a"), player("late", { waiting: true })],
      history: [{ category: "woman", places: { a: { unique: 1, total: 1, place: 1 } } }],
    });
    expect(gameResultRows(r, "ABCD:5000").map((g) => g.scorer_id)).toEqual(["a"]);
  });

  test("the game-start rows carry whoever they are given", () => {
    // The server hands this the *seated* players at each bank — re-emitting is
    // what gives a latecomer's words a parent row before they land, and D1
    // enforces the foreign key. Nothing here filters; the caller decides.
    const r = room({ players: [player("a"), player("late")] });
    const { players, participation } = gameStartRows(r, {
      gameId: "ABCD:5000", lobbyCreatedAt: 1000, startedAt: 9000, scoringVersion: 1,
    });
    expect(players.map((p) => p.player_id).sort()).toEqual(["a", "host", "late"]);
    expect(participation.some((p) => p.player_id === "late")).toBe(true);
  });
});
