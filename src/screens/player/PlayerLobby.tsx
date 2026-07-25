import { Roster } from "../../components/Roster";
import { roomStore } from "../../net/room";
import type { PlayerId, RoomState } from "../../../shared/state";

export function PlayerLobby({ room, playerId }: { room: RoomState; playerId: PlayerId }) {
  const me = room.players.find((p) => p.id === playerId);
  return (
    <main>
      <p className="hint">Room {room.code}</p>
      <Roster players={room.players} />
      <button
        type="button"
        onClick={() => roomStore.send({ type: "ready", ready: !me?.ready })}
      >
        {me?.ready ? "Not ready" : "Ready up"}
      </button>
    </main>
  );
}
