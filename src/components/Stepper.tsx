import { useEffect, useState } from "react";
import type { SettingKind } from "../../shared/gamemodes";
import { MIN_TEAM_COUNT, snapTeamCount } from "../../shared/gamemodes";

type Props = {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  /** Formats the value for display. Stepping and typing both use raw numbers. */
  format?: (value: number) => string;
  /** Next value in the given direction. Defaults to ±1. */
  step?: (value: number, direction: 1 | -1) => number;
  /** Normalizes a typed value before it commits. */
  normalize?: (value: number) => number;
  onChange: (value: number) => void;
};

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function Stepper({
  label, value, min, max, disabled, format, step, normalize, onChange,
}: Props) {
  // Mirrors `value` while the field is not being edited. Typing needs local
  // state — committing on every keystroke would fight the server echo, and
  // "3" on the way to "30" would be clamped to a different number entirely.
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const parsed = Number.parseInt(draft, 10);
    if (Number.isNaN(parsed)) {
      setDraft(String(value));
      return;
    }
    const next = normalize
      ? normalize(clamp(parsed, min, max))
      : clamp(parsed, min, max);
    setDraft(String(next));
    if (next !== value) onChange(next);
  };

  const nudge = (direction: 1 | -1) => {
    const next = clamp(step ? step(value, direction) : value + direction, min, max);
    if (next !== value) onChange(next);
  };

  return (
    <div className={disabled ? "stepper stepper--disabled" : "stepper"}>
      <span className="stepper__label">{label}</span>
      <div className="stepper__row">
        <button
          type="button"
          className="stepper__btn"
          disabled={disabled || value <= min}
          aria-label={`Decrease ${label}`}
          onClick={() => nudge(-1)}
        >
          −
        </button>
        <input
          className="stepper__value"
          inputMode="numeric"
          value={draft}
          disabled={disabled}
          aria-label={label}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            commit();
            e.currentTarget.blur();
          }}
          size={4}
        />
        <button
          type="button"
          className="stepper__btn"
          disabled={disabled || value >= max}
          aria-label={`Increase ${label}`}
          onClick={() => nudge(1)}
        >
          +
        </button>
      </div>
      {format && <span className="stepper__hint">{format(value)}</span>}
    </div>
  );
}

/**
 * 15-second steps up to a minute, then 30-second steps to ten minutes. From an
 * off-grid typed value, moves to the next grid value in that direction rather
 * than staying off-grid.
 */
export function stepDuration(value: number, direction: 1 | -1): number {
  const grid = value < 60 || (value === 60 && direction === -1) ? 15 : 30;
  return direction === 1
    ? (Math.floor(value / grid) + 1) * grid
    : (Math.ceil(value / grid) - 1) * grid;
}

/** "90" -> "1:30". Seconds under a minute render bare: "45s". */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${mins}:00` : `${mins}:${String(rest).padStart(2, "0")}`;
}

/**
 * 0 means off and 1 is not a match, so the value below two is zero in both
 * directions. Everything from two up steps by one.
 */
export function stepTeams(value: number, direction: 1 | -1): number {
  if (direction === 1) return value < MIN_TEAM_COUNT ? MIN_TEAM_COUNT : value + 1;
  return value <= MIN_TEAM_COUNT ? 0 : value - 1;
}

/** "0" -> "OFF", "4" -> "4 teams". */
export function formatTeams(value: number): string {
  return value < MIN_TEAM_COUNT ? "OFF" : `${value} teams`;
}

/**
 * Maps a setting descriptor's kind to the Stepper behaviour it needs. One
 * place, so a new kind is a change here rather than at every drawer call site.
 */
export function stepperPropsForKind(kind: SettingKind): {
  step?: (value: number, direction: 1 | -1) => number;
  format?: (value: number) => string;
  normalize?: (value: number) => number;
} {
  if (kind === "duration") return { step: stepDuration, format: formatDuration };
  // `normalize` matters only for the typed field: the server snaps a typed 1
  // to 0, which is a no-op against a current value of 0, so no state push
  // comes back to correct the input. Applying the same rule locally is what
  // stops "1" sitting in the box forever.
  if (kind === "teams") {
    return { step: stepTeams, format: formatTeams, normalize: snapTeamCount };
  }
  return {};
}
