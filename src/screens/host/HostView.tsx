import type { ReactElement } from "react";
import { roomStore } from "../../net/room";
import type { ClientState } from "../../net/room";
import { countdownScreen } from "../../../shared/state";
import { TimesUp } from "../shared/TimesUp";
import { HostLobby } from "./HostLobby";
import { HostPlaying } from "./HostPlaying";
import { HostScoring } from "./HostScoring";
import { HostStandings } from "./HostStandings";
import { HostVoting } from "./HostVoting";

// The explicit ReactElement return type is what makes tsc flag an unhandled
// phase — there is no noImplicitReturns in this repo, so dropping it would
// make a missing case compile silently.
export function HostView({ state, onLeave }: { state: ClientState; onLeave: () => void }): ReactElement {
  const room = state.room!;

  // The host leaving is the end of the game, not just of their own session:
  // without a host nobody can start the next round, so the room goes with
  // them. Sent before `onLeave` closes the socket — after it there is nothing
  // left to send it down. Wrapped here rather than in each screen so every
  // host exit, present and future, ends the room.
  const leave = () => {
    roomStore.send({ type: "endGame" });
    onLeave();
  };

  switch (room.phase.name) {
    case "lobby":
      return <HostLobby room={room} onLeave={leave} />;
    case "voting":
      return <HostVoting room={room} offset={state.clockOffset} />;
    case "countdown": {
      const countdown = { endsAt: room.phase.endsAt, offset: state.clockOffset };
      const screen = countdownScreen(room);
      if (screen === "lobby") {
        return <HostLobby room={room} countdown={countdown} onLeave={leave} />;
      }
      if (screen === "voting") {
        return <HostVoting room={room} offset={state.clockOffset} countdown={countdown} />;
      }
      return <HostStandings room={room} countdown={countdown} />;
    }
    case "playing":
      return (
        <HostPlaying
          room={room}
          endsAt={room.phase.endsAt}
          offset={state.clockOffset}
        />
      );
    case "timesup":
      return <TimesUp />;
    case "scoring":
      return <HostScoring room={room} results={room.phase.results} />;
    case "standings":
      return <HostStandings room={room} />;
  }
}
