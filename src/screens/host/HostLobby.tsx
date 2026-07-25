import { Roster } from "../../components/Roster";
import { roomStore } from "../../net/room";
import type { RoomState } from "../../../shared/state";
import { MIN_PLAYERS } from "../../../shared/reduce";

export function HostLobby({ room }: { room: RoomState }) {
  const connected = room.players.filter((p) => p.connected).length;
  return (
    <main className="host">
      <p className="hint">Join at this code</p>
      <h1 className="code">{room.code}</h1>
      <Roster
        players={room.players}
        onKick={(id) => roomStore.send({ type: "kick", targetId: id })}
      />
      <button
        type="button"
        disabled={connected < MIN_PLAYERS}
        onClick={() => roomStore.send({ type: "startGame" })}
      >
        Start game
      </button>
      {connected < MIN_PLAYERS && (
        <p className="hint">Need {MIN_PLAYERS} players to start.</p>
      )}
    </main>
  );
}
