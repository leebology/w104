import { Drawer } from "../../components/Drawer";
import { roomStore } from "../../net/room";
import { GAME_MODES, GAME_MODE_IDS } from "../../../shared/gamemodes";
import type { RoomState } from "../../../shared/state";

type Props = {
  room: RoomState;
  open: boolean;
  onClose: () => void;
};

/**
 * The list is generated from the catalog, not written out, so gamemode #2 is
 * a `shared/gamemodes.ts` change and nothing here moves.
 */
export function GameModesDrawer({ room, open, onClose }: Props) {
  return (
    <Drawer side="left" open={open} title="Game modes" onClose={onClose}>
      {GAME_MODE_IDS.map((id) => {
        const mode = GAME_MODES[id];
        const active = room.settings.mode === id;
        return (
          <button
            key={id}
            type="button"
            className={active ? "mode-row mode-row--active" : "mode-row"}
            aria-pressed={active}
            onClick={() => roomStore.send({ type: "setMode", mode: id })}
          >
            <span className="mode-row__name">{mode.name}</span>
            <span className="mode-row__blurb">{mode.blurb}</span>
          </button>
        );
      })}
    </Drawer>
  );
}
