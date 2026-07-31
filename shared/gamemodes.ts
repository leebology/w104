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
 * Which Stepper behaviour a numeric setting gets. `"teams"` is the first kind
 * whose values are not contiguous — it steps 0 ↔ 2 ↔ 3 … and renders 0 as OFF.
 */
export type SettingKind = "count" | "duration" | "teams";

/**
 * The numeric fields of `MatchSettings` a descriptor is allowed to drive.
 * Hand-written rather than `keyof MatchSettings` so that `gamemodes.ts` needs
 * only a *type* import from `state.ts` — `state.ts` imports values from here,
 * and a runtime cycle would be a real problem. `gamemodes.test.ts` asserts the
 * two stay in agreement.
 */
export type NumericSettingKey = "roundCount" | "durationSec" | "teamCount";

/** The two-option settings a descriptor is allowed to drive. */
export type ChoiceSettingKey = "categorySource";

export type CategorySource = "stock" | "custom";

export const CATEGORY_SOURCES: readonly CategorySource[] = ["stock", "custom"];

export type NumericSettingSpec = {
  key: NumericSettingKey;
  /** Rendered on the Stepper. Uppercase, matching the rest of the UI. */
  label: string;
  kind: SettingKind;
  min: number;
  max: number;
  default: number;
};

/**
 * A setting whose value is a word rather than a number. Kept a separate shape
 * rather than a numeric one with two values, because the drawer renders the
 * option's own label and a 0/1 stepper would have to invent one.
 */
export type ChoiceSettingSpec = {
  key: ChoiceSettingKey;
  label: string;
  kind: "choice";
  options: ReadonlyArray<{ value: string; label: string }>;
  default: string;
};

export type SettingSpec = NumericSettingSpec | ChoiceSettingSpec;

export function isNumericSpec(spec: SettingSpec): spec is NumericSettingSpec {
  return spec.kind !== "choice";
}

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
      {
        key: "teamCount",
        label: "TEAMS",
        kind: "teams",
        // `min` is 0 rather than MIN_TEAM_COUNT because 0 is a real, reachable
        // value — the default one. The gap at 1 is the kind's business, not
        // the bounds': see `snapTeamCount`.
        min: 0,
        max: MAX_TEAM_COUNT,
        default: 0,
      },
      {
        key: "categorySource",
        label: "CATEGORIES",
        kind: "choice",
        options: [
          { value: "stock", label: "DEFAULT" },
          { value: "custom", label: "CUSTOM" },
        ],
        default: "stock",
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
    teamCount: 0,
    categorySource: "stock",
  };
  for (const spec of GAME_MODES[id].settings) {
    if (isNumericSpec(spec)) settings[spec.key] = spec.default;
    else settings[spec.key] = spec.default as CategorySource;
  }
  return settings;
}

/**
 * Clamps a host-supplied value into a descriptor's bounds, then applies the
 * kind's own rule. Settings arrive over a socket, so the Stepper's refusal to
 * stop at an illegal value is not a guarantee.
 *
 * Non-finite values fall back to what is already set rather than poisoning the
 * room with NaN.
 */
export function normalizeSetting(
  spec: NumericSettingSpec,
  value: number | undefined,
  current: number,
): number {
  if (value === undefined || !Number.isFinite(value)) return current;
  const clamped = Math.min(spec.max, Math.max(spec.min, Math.round(value)));
  return spec.kind === "teams" ? snapTeamCount(clamped) : clamped;
}

/**
 * Clamps a host-supplied choice to one the descriptor actually offers. Falls
 * back to what is already set for anything unrecognised, exactly as
 * `normalizeSetting` falls back on a non-finite number — settings arrive over
 * a socket, and the drawer's refusal to render a third option is not a
 * guarantee.
 */
export function normalizeChoice(
  spec: ChoiceSettingSpec,
  value: string | undefined,
  current: string,
): string {
  if (value === undefined) return current;
  return spec.options.some((o) => o.value === value) ? value : current;
}

/** Whether this match writes its own categories. One place, many readers. */
export function customEnabled(settings: Pick<MatchSettings, "categorySource">): boolean {
  return settings.categorySource === "custom";
}
