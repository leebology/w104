import { describe, expect, test } from "vitest";
import { COUNTDOWN_MS, MIN_PLAYERS, TIMESUP_MS, VOTING_MS, reduce } from "./reduce";
import { createRoom } from "./state";
import type { Room } from "./state";
import { VIEWS, currentView, isViewId } from "./views";
import type { ViewId } from "./views";
import { MIN_TEAM_COUNT } from "./gamemodes";
import { rosterOf } from "./teams";
import { NO_SELF_MARKS, totalMarks } from "./selfstrike";

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

function jump(room: Room, to: ViewId, now = 5000, roll = 0.5): Room {
  return reduce(room, { t: "debugJump", playerId: "host", to, roll, now });
}

describe("currentView", () => {
  test("names every phase, and the two countdowns apart", () => {
    expect(currentView({ phase: { name: "lobby" } })).toBe("lobby");
    expect(currentView({ phase: { name: "teams" } })).toBe("teams");
    expect(currentView({ phase: { name: "standings" } })).toBe("standings");
    expect(
      currentView({ phase: { name: "countdown", endsAt: 0, to: "voting" } }),
    ).toBe("countdownToVoting");
    expect(
      currentView({ phase: { name: "countdown", endsAt: 0, to: "playing" } }),
    ).toBe("countdownToPlaying");
  });

  /**
   * The refresh button is a jump to `currentView`, so a view the catalog does
   * not list is a view that cannot be refreshed — silently, with no type error
   * to catch it.
   */
  test("only ever names a view in the catalog", () => {
    const room = seed(2);
    for (const view of VIEWS) {
      expect(isViewId(currentView(jump(room, view.id)))).toBe(true);
    }
  });
});

describe("isViewId", () => {
  test("accepts the catalog and rejects everything else", () => {
    expect(isViewId("scoring")).toBe(true);
    expect(isViewId("countdown")).toBe(false);
    expect(isViewId("")).toBe(false);
    expect(isViewId(undefined)).toBe(false);
    expect(isViewId(3)).toBe(false);
  });
});

describe("debugJump", () => {
  test("is host-only", () => {
    const room = seed(2);
    expect(
      reduce(room, { t: "debugJump", playerId: "p0", to: "playing", roll: 0.5, now: 5000 }),
    ).toBe(room);
  });

  /**
   * The whole promise of the jumper: every screen it lists is reachable from
   * every screen it lists. A target that only worked from the phase before it
   * would be a jumper you had to walk to.
   */
  test("reaches every view from every view", () => {
    for (const from of VIEWS) {
      for (const to of VIEWS) {
        const room = jump(jump(seed(3), from.id), to.id, 9000);
        expect(currentView(room)).toBe(to.id);
      }
    }
  });

  test("bumps viewNonce on every jump, including one to the same view", () => {
    const room = seed(2);
    expect(room.viewNonce).toBe(0);
    const once = jump(room, "voting");
    expect(once.viewNonce).toBe(1);
    // The refresh. Not a no-op, despite landing on the phase it started on.
    const again = jump(once, "voting", 6000);
    expect(again.viewNonce).toBe(2);
    expect(again).not.toBe(once);
  });

  test("re-stamps the phase clock on a refresh", () => {
    const room = jump(seed(2), "playing", 5000);
    const full = room.settings.durationSec * 1_000;
    expect(room.phase.name === "playing" && room.phase.endsAt).toBe(5000 + full);
    // A round refreshed 15 seconds in gets its whole timer back, not the
    // remainder — this is a restart, not a resume.
    const refreshed = jump(room, "playing", 20_000);
    expect(refreshed.phase.name === "playing" && refreshed.phase.endsAt).toBe(20_000 + full);
  });

  describe("timed phases", () => {
    test("voting opens a full window with an empty tally", () => {
      let room = jump(seed(2), "voting");
      room = reduce(room, { t: "castVote", playerId: "p0", category: room.category, now: 5500 });
      const again = jump(room, "voting", 6000);
      expect(again.phase).toEqual({ name: "voting", endsAt: 6000 + VOTING_MS });
      // `ready` means "votes spent" here, so the flags and the tally have to
      // agree — a cleared flag over a spent vote closes voting on the next event.
      expect(again.votes).toEqual({});
      expect(again.players.some((p) => p.ready)).toBe(false);
    });

    test("both countdowns land on their own destination", () => {
      expect(jump(seed(2), "countdownToVoting").phase).toEqual({
        name: "countdown", endsAt: 5000 + COUNTDOWN_MS, to: "voting",
      });
      expect(jump(seed(2), "countdownToPlaying").phase).toEqual({
        name: "countdown", endsAt: 5000 + COUNTDOWN_MS, to: "playing",
      });
    });

    test("timesup runs its own short window", () => {
      expect(jump(seed(2), "timesup").phase).toEqual({
        name: "timesup", endsAt: 5000 + TIMESUP_MS,
      });
    });

    test("playing draws a category and empties the lists", () => {
      let room = jump(seed(2), "playing");
      room = { ...room, entries: { p0: [{ text: "kettle", at: 5100, by: "p0" }] } };
      const again = jump(room, "playing", 6000);
      expect(again.category).not.toBe("");
      expect(again.entries).toEqual({});
    });
  });

  describe("readiness", () => {
    /**
     * A countdown below MIN_PLAYERS is torn down by `settle`, so the jump both
     * forces readiness and is exempted from `settle` — this asserts the pair
     * holds by jumping on a room too small to sustain one naturally.
     */
    test("a countdown survives on a room below MIN_PLAYERS", () => {
      const room = jump(seed(1), "countdownToPlaying");
      expect(room.players.length).toBeLessThan(MIN_PLAYERS);
      expect(room.phase.name).toBe("countdown");
      expect(room.players.every((p) => p.ready)).toBe(true);
      // And it is not undone by the next unrelated event either.
      const later = reduce(room, {
        t: "setProfile", playerId: "p0", name: "Ann", emoji: "🐛", now: 5500,
      });
      expect(later.phase.name).toBe("countdown");
    });

    /**
     * The mirror image: every untimed target clears readiness, because a room
     * arriving fully ready would `settle` straight back out of the screen the
     * jump just asked for.
     */
    test("untimed views clear readiness so settle leaves them alone", () => {
      const ready = reduce(
        reduce(seed(2), { t: "startGame", playerId: "host", now: 2000 }),
        { t: "cancelStart", playerId: "host", now: 2100 },
      );
      for (const to of ["lobby", "teams", "voting", "scoring", "standings"] as const) {
        const room = jump({ ...ready, players: ready.players.map((p) => ({ ...p, ready: true })) }, to);
        expect(room.players.some((p) => p.ready)).toBe(false);
        // The screen is still the one asked for after an unrelated event.
        const later = reduce(room, {
          t: "setProfile", playerId: "p0", name: "Ann", emoji: "🐛", now: 5500,
        });
        expect(currentView(later)).toBe(to);
      }
    });
  });

  describe("teams", () => {
    test("jumping to team select turns teams on", () => {
      const room = jump(seed(2), "teams");
      expect(room.settings.teamCount).toBe(MIN_TEAM_COUNT);
      expect(room.teams).toHaveLength(MIN_TEAM_COUNT);
      // Nobody is on one yet, which is what keeps `settle` from closing it.
      expect(room.players.every((p) => p.teamId === null)).toBe(true);
    });

    test("jumping past team select stands the teams up", () => {
      // Teams on, but the room has never been through team select — the state a
      // jump straight from the lobby arrives in.
      const off = seed(4);
      const on: Room = { ...off, settings: { ...off.settings, teamCount: 2 } };
      for (const to of ["voting", "playing", "timesup", "scoring"] as const) {
        const room = jump(on, to);
        expect(room.teams).toHaveLength(2);
        expect(room.players.every((p) => p.teamId !== null)).toBe(true);
        // The point of standing them up: `rosterOf` drops empty teams, so
        // without this the round would have no scorers at all.
        expect(rosterOf(room)).toHaveLength(2);
      }
    });

    test("a team match keeps its teams across a refresh past team select", () => {
      const staged = jump({ ...seed(4), settings: { ...seed(4).settings, teamCount: 2 } }, "playing");
      const again = jump(staged, "playing", 6000);
      expect(again.teams).toEqual(staged.teams);
    });
  });

  describe("scoring and standings", () => {
    test("scoring scores whatever words are down", () => {
      let room = jump(seed(2), "playing");
      room = {
        ...room,
        entries: {
          p0: [{ text: "kettle", at: 5100, by: "p0" }, { text: "otter", at: 5200, by: "p0" }],
          p1: [{ text: "kettle", at: 5150, by: "p1" }],
        },
      };
      const scored = jump(room, "scoring", 6000);
      expect(scored.phase.name).toBe("scoring");
      if (scored.phase.name !== "scoring") return;
      expect(scored.phase.startedAt).toBe(6000);
      expect(scored.phase.skipped).toBe(false);
      // Boggle rules: "kettle" is on both lists, "otter" on one.
      const p0 = scored.phase.results.scorers.find((s) => s.id === "p0");
      expect(p0?.unique).toBe(1);
      expect(p0?.total).toBe(2);
    });

    test("a refresh of scoring rebuilds the reveal and drops the marks", () => {
      let room = jump(seed(2), "playing");
      room = { ...room, entries: { p0: [{ text: "kettle", at: 5100, by: "p0" }] } };
      room = jump(room, "scoring", 6000);
      room = reduce(room, { t: "selfStrike", playerId: "p0", index: 0, struck: true, now: 6500 });
      expect(room.phase.name === "scoring" && totalMarks(room.phase.selfMarks)).toBe(1);
      const again = jump(room, "scoring", 7000);
      expect(again.phase.name === "scoring" && again.phase.startedAt).toBe(7000);
      expect(again.phase.name === "scoring" && again.phase.selfMarks).toEqual(NO_SELF_MARKS);
    });

    /**
     * Arriving at standings from a results screen banks the round on it, exactly
     * as the host's Standings button does — so the round the room was just shown
     * earns its badge rather than being dropped on the way to the screen that
     * would have displayed it.
     */
    test("standings banks the round when jumped to from scoring", () => {
      let room = jump(seed(2), "playing");
      room = { ...room, entries: { p0: [{ text: "kettle", at: 5100, by: "p0" }] } };
      room = jump(room, "scoring", 6000);
      const banked = jump(room, "standings", 7000);
      expect(banked.phase).toEqual({ name: "standings" });
      expect(banked.history).toHaveLength(1);
      expect(banked.history[0].places.p0.unique).toBe(1);
      // Banking is the one place the word store is emptied.
      expect(banked.entries).toEqual({});
    });

    test("standings from anywhere else banks nothing", () => {
      const room = jump(seed(2), "standings");
      expect(room.phase).toEqual({ name: "standings" });
      expect(room.history).toEqual([]);
    });
  });

  /**
   * A jump is not `backToLobby`: the point is to look at one screen without
   * losing the state that makes it worth looking at.
   */
  test("does not reset the match", () => {
    let room = jump(seed(2), "playing");
    room = { ...room, entries: { p0: [{ text: "kettle", at: 5100, by: "p0" }] } };
    room = jump(jump(room, "scoring", 6000), "standings", 7000);
    const settings = room.settings;
    const history = room.history;

    const lobby = jump(room, "lobby", 8000);
    expect(lobby.history).toBe(history);
    expect(lobby.settings).toBe(settings);
  });

  test("clears a held round on the way out", () => {
    let room = jump(seed(2), "playing");
    room = reduce(room, { t: "debugPause", playerId: "host", paused: true, now: 5500 });
    expect(room.paused).not.toBeNull();
    expect(jump(room, "standings", 6000).paused).toBeNull();
  });
});

test("carries the writing phase and its countdown", () => {
  expect(VIEWS.map((v) => v.id)).toContain("creating");
  expect(VIEWS.map((v) => v.id)).toContain("countdownToCreating");
  expect(isViewId("creating")).toBe(true);
  expect(currentView({ phase: { name: "creating", endsAt: 0 } })).toBe("creating");
  expect(
    currentView({ phase: { name: "countdown", endsAt: 0, to: "creating" } }),
  ).toBe("countdownToCreating");
});
