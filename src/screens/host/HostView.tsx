import { Fragment } from "react";
import type { ReactElement } from "react";
import { roomStore } from "../../net/room";
import type { ClientState } from "../../net/room";
import { countdownScreen } from "../../../shared/state";
import type { RoomState } from "../../../shared/state";
import { TimesUp } from "../shared/TimesUp";
import { Writing } from "../shared/Writing";
import { HostLobby } from "./HostLobby";
import { HostPlaying } from "./HostPlaying";
import { HostScoring } from "./HostScoring";
import { HostStandings } from "./HostStandings";
import { HostTeams } from "./HostTeams";
import { HostVoting } from "./HostVoting";

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

  // Keyed on `viewNonce` so the debug menu's refresh remounts the screen — the
  // only way to restart animations and screen-local state that a re-render
  // cannot touch. A Fragment rather than an element, because it must add no DOM
  // of its own: every screen below is a `.screen` root the layout depends on.
  return <Fragment key={room.viewNonce}>{screenFor(room, state, leave)}</Fragment>;
}

// The explicit ReactElement return type is what makes tsc flag an unhandled
// phase — there is no noImplicitReturns in this repo, so dropping it would
// make a missing case compile silently.
function screenFor(room: RoomState, state: ClientState, leave: () => void): ReactElement {
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
      if (screen === "teams") {
        return <HostTeams room={room} countdown={countdown} />;
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
      return (
        <HostScoring
          room={room}
          results={room.phase.results}
          startedAt={room.phase.startedAt}
          skipped={room.phase.skipped}
          marks={room.phase.selfMarks}
        />
      );
    case "standings":
      return <HostStandings room={room} />;
    case "teams":
      return <HostTeams room={room} />;
    case "creating":
      return <Writing />;
  }
}
