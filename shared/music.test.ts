import { describe, expect, test } from "vitest";
import { LEAD_CLIP_MS, MUSIC_FADE_MS, MUSIC_RESUME_DELAY_MS, levelOf, loops, sceneFor } from "./music";
import type { SceneId } from "./music";
import { COUNTDOWN_MS } from "./reduce";
import { NO_SELF_MARKS } from "./selfstrike";
import { createRoom } from "./state";
import type { Phase, Room } from "./state";

/** A room `played` rounds into a match of `roundCount`, sitting on `phase`. */
function at(phase: Phase, played = 0, roundCount = 3): Room {
  const room = createRoom("PLUM", 1000);
  return {
    ...room,
    phase,
    settings: { ...room.settings, roundCount },
    history: Array.from({ length: played }, () => ({
      category: "woman",
      places: {},
    })),
  };
}

const SCORING: Phase = {
  name: "scoring",
  results: { scorers: [] },
  startedAt: 0,
  skipped: false,
  selfMarks: NO_SELF_MARKS,
};

describe("sceneFor", () => {
  test("the lobby and team select share a track", () => {
    expect(sceneFor(at({ name: "lobby" }))).toBe("lobby");
    expect(sceneFor(at({ name: "teams" }))).toBe("lobby");
  });

  /**
   * The headline of this file. Three consecutive phases naming one scene is
   * the *only* thing making the round's music continuous across them — the
   * player restarts on a change of name and on nothing else.
   */
  test("the round's music runs unbroken from the vote into round one", () => {
    expect(sceneFor(at({ name: "voting", endsAt: 0 }))).toBe("gameplay");
    expect(
      sceneFor(at({ name: "countdown", endsAt: 0, to: "playing" })),
    ).toBe("gameplay");
    expect(sceneFor(at({ name: "playing", endsAt: 0 }))).toBe("gameplay");
  });

  test("every other countdown gets the lead-in", () => {
    // Out of the lobby, leading into the category vote.
    expect(
      sceneFor(at({ name: "countdown", endsAt: 0, to: "voting" })),
    ).toBe("countdown");
    // Off the standings, leading into round two and every round after it.
    expect(
      sceneFor(at({ name: "countdown", endsAt: 0, to: "playing" }, 1)),
    ).toBe("countdown");
    expect(
      sceneFor(at({ name: "countdown", endsAt: 0, to: "playing" }, 4)),
    ).toBe("countdown");
  });

  test("the whistle and the reveal", () => {
    expect(sceneFor(at({ name: "timesup", endsAt: 0 }))).toBe("times_up");
    expect(sceneFor(at(SCORING, 2))).toBe("round_results");
  });

  test("the two standings screens are named apart", () => {
    expect(sceneFor(at({ name: "standings" }, 1))).toBe("midgame_standings");
    expect(sceneFor(at({ name: "standings" }, 2))).toBe("midgame_standings");
    expect(sceneFor(at({ name: "standings" }, 3))).toBe("endgame_standings");
  });

  /**
   * A match cut short by the host lands on standings with more rounds banked
   * than were configured. That is still the end of the match, so it is still
   * the podium — `matchComplete` is `>=` for the same reason.
   */
  test("an over-full history is still the end of the match", () => {
    expect(sceneFor(at({ name: "standings" }, 5, 3))).toBe("endgame_standings");
  });
});

const ALL: SceneId[] = [
  "lobby", "countdown", "gameplay", "times_up",
  "round_results", "midgame_standings", "endgame_standings",
];

describe("loops", () => {
  test("the beds loop; the cues do not", () => {
    expect(loops("lobby")).toBe(true);
    expect(loops("gameplay")).toBe(true);
    expect(loops("round_results")).toBe(true);
    expect(loops("countdown")).toBe(false);
    expect(loops("times_up")).toBe(false);
    expect(loops("midgame_standings")).toBe(false);
    expect(loops("endgame_standings")).toBe(false);
  });

  test("answers for every scene a phase can name", () => {
    for (const scene of ALL) expect(typeof loops(scene)).toBe("boolean");
  });

  /**
   * Both standings screens are cues specifically so an empty folder means
   * "carry on with the results music" rather than "cut to silence" — see the
   * bed/cue note in `shared/music.ts`. Marking either as a bed would turn the
   * empty folder they ship with into a hole in the soundtrack.
   */
  test("the standings screens are cues, so an empty folder is a no-op", () => {
    expect(loops("midgame_standings")).toBe(false);
    expect(loops("endgame_standings")).toBe(false);
  });
});

describe("levelOf", () => {
  test("the results track is trimmed; everything else plays as mastered", () => {
    expect(levelOf("round_results")).toBe(0.8);
    for (const scene of ALL.filter((s) => s !== "round_results")) {
      expect(levelOf(scene)).toBe(1);
    }
  });

  /** It is fed straight to `HTMLMediaElement.volume`, which throws outside 0..1. */
  test("every level is a legal volume", () => {
    for (const scene of ALL) {
      expect(levelOf(scene)).toBeGreaterThan(0);
      expect(levelOf(scene)).toBeLessThanOrEqual(1);
    }
  });
});

describe("timings", () => {
  /**
   * The fade has to be short enough to sit inside the countdown's first
   * second, since the lead-in starts on the same frame the music is told to go.
   */
  test("the fade fits inside the resume beat", () => {
    expect(MUSIC_FADE_MS).toBeGreaterThan(0);
    expect(MUSIC_FADE_MS).toBeLessThan(MUSIC_RESUME_DELAY_MS);
  });

  /**
   * The card has to stay up for at least as long as the lead-in it is playing
   * over, or the clip is cut off mid-bar. See the note on `COUNTDOWN_MS`.
   */
  test("the countdown outlasts its lead-in clip", () => {
    expect(COUNTDOWN_MS).toBeGreaterThanOrEqual(LEAD_CLIP_MS);
  });
});
