import type { ChoiceSettingSpec } from "../../shared/gamemodes";

type Props = {
  spec: ChoiceSettingSpec;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
};

/**
 * A Stepper card whose control row holds two words instead of `− 3 +`. Same
 * card, same 11px label, same 38px row — the four drawer cards have to stack
 * as one rhythm, so this is a `.stepper` with a different row, not a new
 * object.
 *
 * The lit option is a fill inside a sunken track, with no border and no
 * shadow: at drawer distance a fill reads where a tick does not, and a
 * bordered segment inside a bordered track draws a double rule.
 */
export function SettingChoice({ spec, value, disabled, onChange }: Props) {
  return (
    <div className={disabled ? "stepper stepper--disabled" : "stepper"}>
      <span className="stepper__label">{spec.label}</span>
      <div className="setting-choice" role="group" aria-label={spec.label}>
        {spec.options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={
              option.value === value
                ? "setting-choice__opt setting-choice__opt--on"
                : "setting-choice__opt"
            }
            aria-pressed={option.value === value}
            disabled={disabled}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
