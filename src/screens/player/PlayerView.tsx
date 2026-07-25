import type { ClientState } from "../../net/room";

export function PlayerView({ state }: { state: ClientState; onLeave: () => void }) {
  return <main><h1>{state.room?.phase.name}</h1></main>;
}
