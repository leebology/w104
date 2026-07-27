import { DEFAULT_DURATION_SEC, DEFAULT_ROUND_COUNT } from "./categories";
import type { MatchSettings } from "./state";

/**
 * The bounds live here rather than in `reduce.ts` because the descriptors
 * below are the only thing that should be quoting them — `reduce` now
 * validates against a mode's descriptors, not against loose constants.
 * `reduce.ts` re-exports all four so every existing import site keeps working.
 */
export const MIN_ROUND_COUNT = 1;
export const MAX_ROUND_COUNT = 10;
/** 15 seconds to 10 minutes. */
export const MIN_DURATION_SEC = 15;
export const MAX_DURATION_SEC = 600;

/** 0 is "off"; a real team match is 2..10. See shared/teams.ts. */
export const MIN_TEAM_COUNT = 2;
export const MAX_TEAM_COUNT = 10;

/**
 * A one-team match is not a thing, so the value 1 means "off" rather than
 * "one team". Lives here rather than in `teams.ts` because `teams.ts` imports
 * *this* file at runtime for `modeSpec`, and the reverse edge would close a
 * cycle. The Stepper and `normalizeSetting` both call it, so the rule has
 * exactly one definition.
 */
export function snapTeamCount(value: number): number {
  return value === 1 ? 0 : value;
}

export const GAME_MODE_IDS = ["ffa"] as const;
export type GameModeId = (typeof GAME_MODE_IDS)[number];
export const DEFAULT_MODE: GameModeId = "ffa";

/**
 * Which Stepper behaviour a numeric setting gets. This union is the seam a
 * future toggle or select setting extends; today every setting is a number.
 */
export type SettingKind = "count" | "duration";

/**
 * The numeric fields of `MatchSettings` a descriptor is allowed to drive.
 * Hand-written rather than `keyof MatchSettings` so that `gamemodes.ts` needs
 * only a *type* import from `state.ts` — `state.ts` imports values from here,
 * and a runtime cycle would be a real problem. `gamemodes.test.ts` asserts the
 * two stay in agreement.
 */
export type NumericSettingKey = "roundCount" | "durationSec";

export type SettingSpec = {
  key: NumericSettingKey;
  /** Rendered on the Stepper. Uppercase, matching the rest of the UI. */
  label: string;
  kind: SettingKind;
  min: number;
  max: number;
  default: number;
};

export type GameMode = {
  id: GameModeId;
  name: string;
  /** One line under the name in the modes drawer. */
  blurb: string;
  /** Exactly the settings this mode exposes. Order is render order. */
  settings: readonly SettingSpec[];
};

export const GAME_MODES: Record<GameModeId, GameMode> = {
  ffa: {
    id: "ffa",
    name: "Free-for-All",
    blurb: "Race to list items in a category. A word scores only if nobody else wrote it.",
    settings: [
      {
        key: "roundCount",
        label: "ROUNDS",
        kind: "count",
        min: MIN_ROUND_COUNT,
        max: MAX_ROUND_COUNT,
        default: DEFAULT_ROUND_COUNT,
      },
      {
        key: "durationSec",
        label: "TIMER",
        kind: "duration",
        min: MIN_DURATION_SEC,
        max: MAX_DURATION_SEC,
        default: DEFAULT_DURATION_SEC,
      },
    ],
  },
};

export function isGameModeId(value: unknown): value is GameModeId {
  return (
    typeof value === "string" && (GAME_MODE_IDS as readonly string[]).includes(value)
  );
}

/**
 * Never throws and never returns undefined: an unknown id comes off disk (a
 * room stored before a mode was renamed) or off the wire (a hand-rolled
 * message), and every caller would otherwise have to null-check.
 */
export function modeSpec(id: string): GameMode {
  return isGameModeId(id) ? GAME_MODES[id] : GAME_MODES[DEFAULT_MODE];
}

/** A fresh settings bag for the given mode, every exposed key at its default. */
export function defaultSettings(id: GameModeId): MatchSettings {
  const settings: MatchSettings = {
    mode: id,
    roundCount: DEFAULT_ROUND_COUNT,
    durationSec: DEFAULT_DURATION_SEC,
  };
  for (const spec of GAME_MODES[id].settings) settings[spec.key] = spec.default;
  return settings;
}
