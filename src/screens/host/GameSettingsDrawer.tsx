import { Drawer } from "../../components/Drawer";
import { SettingChoice } from "../../components/SettingChoice";
import { Stepper, stepperPropsForKind } from "../../components/Stepper";
import { roomStore } from "../../net/room";
import { isNumericSpec, modeSpec } from "../../../shared/gamemodes";
import type { RoomState } from "../../../shared/state";

type Props = {
  room: RoomState;
  open: boolean;
  onClose: () => void;
  /** Mirrors the old inline steppers: locked while a countdown runs. */
  disabled?: boolean;
};

/**
 * Renders one Stepper per descriptor the active mode exposes. Adding a setting
 * to a mode is a catalog change; nothing here knows what `roundCount` is.
 */
export function GameSettingsDrawer({ room, open, onClose, disabled }: Props) {
  const mode = modeSpec(room.settings.mode);

  return (
    <Drawer side="right" open={open} title="Game settings" onClose={onClose}>
      <p className="drawer__note">Current game mode: {mode.name}</p>
      <div className="drawer__settings">
        {mode.settings.map((spec) =>
          isNumericSpec(spec) ? (
            <Stepper
              key={spec.key}
              label={spec.label}
              value={room.settings[spec.key]}
              min={spec.min}
              max={spec.max}
              disabled={disabled}
              {...stepperPropsForKind(spec.kind)}
              onChange={(value) =>
                roomStore.send({ type: "setSettings", values: { [spec.key]: value } })
              }
            />
          ) : (
            <SettingChoice
              key={spec.key}
              spec={spec}
              value={room.settings[spec.key]}
              disabled={disabled}
              onChange={(value) =>
                roomStore.send({
                  type: "setSettings",
                  values: {},
                  choices: { [spec.key]: value },
                })
              }
            />
          ),
        )}
      </div>
    </Drawer>
  );
}
