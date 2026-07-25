import type { ClientState } from "../../net/room";
import { HostLobby } from "./HostLobby";

export function HostView({ state }: { state: ClientState; onLeave: () => void }) {
  const room = state.room!;
  switch (room.phase.name) {
    case "lobby":
      return <HostLobby room={room} />;
    default:
      return <main><h1>{room.phase.name}</h1></main>;
  }
}
