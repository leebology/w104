import { getPlayerId } from "../../net/identity";
import type { ClientState } from "../../net/room";
import { Countdown } from "../shared/Countdown";
import { TimesUp } from "../shared/TimesUp";
import { PlayerLobby } from "./PlayerLobby";
import { PlayerPlaying } from "./PlayerPlaying";
import { PlayerScoring } from "./PlayerScoring";

export function PlayerView({ state }: { state: ClientState; onLeave: () => void }) {
  const room = state.room!;
  switch (room.phase.name) {
    case "lobby":
      return <PlayerLobby room={room} playerId={getPlayerId()} />;
    case "countdown":
      return <Countdown endsAt={room.phase.endsAt} offset={state.clockOffset} />;
    case "playing":
      return (
        <PlayerPlaying
          category={room.category}
          endsAt={room.phase.endsAt}
          offset={state.clockOffset}
          entries={state.entries}
          rejected={state.rejected}
        />
      );
    case "timesup":
      return <TimesUp />;
    case "scoring":
      return <PlayerScoring results={room.phase.results} playerId={getPlayerId()} />;
  }
}
