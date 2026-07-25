import { getPlayerId } from "../../net/identity";
import type { ClientState } from "../../net/room";
import { PlayerLobby } from "./PlayerLobby";

export function PlayerView({ state }: { state: ClientState; onLeave: () => void }) {
  const room = state.room!;
  switch (room.phase.name) {
    case "lobby":
      return <PlayerLobby room={room} playerId={getPlayerId()} />;
    default:
      return <main><h1>{room.phase.name}</h1></main>;
  }
}
