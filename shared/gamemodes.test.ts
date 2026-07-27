import { describe, expect, test } from "vitest";
import {
  DEFAULT_MODE, GAME_MODES, GAME_MODE_IDS, defaultSettings, isGameModeId, modeSpec,
} from "./gamemodes";
import { MAX_DURATION_SEC, MAX_ROUND_COUNT, MIN_DURATION_SEC, MIN_ROUND_COUNT } from "./reduce";
import { createRoom } from "./state";

const ALL_MODES = Object.values(GAME_MODES);

describe("the catalog", () => {
  test("DEFAULT_MODE is a real mode", () => {
    expect(GAME_MODE_IDS).toContain(DEFAULT_MODE);
    expect(GAME_MODES[DEFAULT_MODE]).toBeDefined();
  });

  test("every mode is keyed by its own id", () => {
    for (const id of GAME_MODE_IDS) expect(GAME_MODES[id].id).toBe(id);
  });

  test("every spec's default sits inside its own bounds", () => {
    for (const mode of ALL_MODES) {
      for (const spec of mode.settings) {
        expect(spec.min).toBeLessThan(spec.max);
        expect(spec.default).toBeGreaterThanOrEqual(spec.min);
        expect(spec.default).toBeLessThanOrEqual(spec.max);
      }
    }
  });

  test("no mode declares the same key twice", () => {
    for (const mode of ALL_MODES) {
      const keys = mode.settings.map((s) => s.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  // Guards the hand-written NumericSettingKey union against drift: a key that
  // stops naming a numeric MatchSettings field fails here rather than silently
  // becoming a setting nothing reads.
  test("every spec key names a numeric field of MatchSettings", () => {
    const sample = createRoom("PLUM", 0).settings;
    for (const mode of ALL_MODES) {
      for (const spec of mode.settings) {
        expect(typeof sample[spec.key]).toBe("number");
      }
    }
  });

  test("FFA's descriptors quote the exported bounds", () => {
    const rounds = GAME_MODES.ffa.settings.find((s) => s.key === "roundCount");
    const timer = GAME_MODES.ffa.settings.find((s) => s.key === "durationSec");
    expect(rounds).toMatchObject({ min: MIN_ROUND_COUNT, max: MAX_ROUND_COUNT, kind: "count" });
    expect(timer).toMatchObject({ min: MIN_DURATION_SEC, max: MAX_DURATION_SEC, kind: "duration" });
  });
});

describe("lookups", () => {
  test("isGameModeId rejects anything not in the pool", () => {
    expect(isGameModeId("ffa")).toBe(true);
    expect(isGameModeId("teams")).toBe(false);
    expect(isGameModeId(7)).toBe(false);
    expect(isGameModeId(undefined)).toBe(false);
  });

  test("modeSpec falls back to the default mode for an unknown id", () => {
    expect(modeSpec("ffa").id).toBe("ffa");
    expect(modeSpec("nonsense").id).toBe(DEFAULT_MODE);
  });

  test("defaultSettings puts every exposed key at its default", () => {
    const settings = defaultSettings("ffa");
    expect(settings.mode).toBe("ffa");
    for (const spec of GAME_MODES.ffa.settings) {
      expect(settings[spec.key]).toBe(spec.default);
    }
  });
});

describe("a new room", () => {
  test("starts on the default mode", () => {
    expect(createRoom("PLUM", 0).settings.mode).toBe(DEFAULT_MODE);
  });
});
