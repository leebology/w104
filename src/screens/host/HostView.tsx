import type { ClientState } from "../../net/room";
import { Countdown } from "../shared/Countdown";
import { TimesUp } from "../shared/TimesUp";
import { HostLobby } from "./HostLobby";
import { HostPlaying } from "./HostPlaying";

export function HostView({ state }: { state: ClientState; onLeave: () => void }) {
  const room = state.room!;
  switch (room.phase.name) {
    case "lobby":
      return <HostLobby room={room} />;
    case "countdown":
      return <Countdown endsAt={room.phase.endsAt} offset={state.clockOffset} />;
    case "playing":
      return (
        <HostPlaying
          category={room.category}
          endsAt={room.phase.endsAt}
          offset={state.clockOffset}
        />
      );
    case "timesup":
      return <TimesUp />;
    default:
      return <main><h1>{room.phase.name}</h1></main>;
  }
}
