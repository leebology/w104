import type { ClientState } from "../../net/room";

export function HostView({ state }: { state: ClientState; onLeave: () => void }) {
  return <main><h1>{state.room?.code}</h1></main>;
}
