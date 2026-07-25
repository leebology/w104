import type { ReactElement } from "react";
import type { ClientState } from "../../net/room";
import { Countdown } from "../shared/Countdown";
import { TimesUp } from "../shared/TimesUp";
import { HostLobby } from "./HostLobby";
import { HostPlaying } from "./HostPlaying";
import { HostScoring } from "./HostScoring";

export function HostView({ state }: { state: ClientState; onLeave: () => void }): ReactElement {
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
    case "scoring":
      return <HostScoring results={room.phase.results} />;
  }
}
