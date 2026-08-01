import { Fragment, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { useMusic } from "../../audio/music";
import { prefersReducedMotion } from "../../reveal";
import { LEAVE_MS } from "../../scoringleave";
import { roomStore } from "../../net/room";
import type { ClientState } from "../../net/room";
import { countdownScreen } from "../../../shared/state";
import type { RoomState } from "../../../shared/state";
import { TimesUp } from "../shared/TimesUp";
import { HostCreating } from "./HostCreating";
import { HostLobby } from "./HostLobby";
import { HostPlaying } from "./HostPlaying";
import { HostScoring } from "./HostScoring";
import { HostStandings } from "./HostStandings";
import { HostTeams } from "./HostTeams";
import { HostVoting } from "./HostVoting";

export function HostView({ state, onLeave }: { state: ClientState; onLeave: () => void }): ReactElement {
  const room = state.room!;

  // Music is host-only, and this call is the whole of that rule: a phone never
  // mounts this component. It sits above the screen switch rather than inside
  // any screen so a track survives the phase change that follows it — and above
  // the `viewNonce` remount below, so the debug menu's refresh restarts the
  // animations without restarting the music.
  useMusic(room);

  // The host leaving is the end of the game, not just of their own session:
  // without a host nobody can start the next round, so the room goes with
  // them. Sent before `onLeave` closes the socket — after it there is nothing
  // left to send it down. Wrapped here rather than in each screen so every
  // host exit, present and future, ends the room.
  const leave = () => {
    roomStore.send({ type: "endGame" });
    onLeave();
  };

  // The last `creating`-phase `RoomState` this client saw, mutated during
  // render rather than reconstructed later — `closeCreating` moves straight
  // to `voting` with no countdown between them (see its comment in
  // shared/reduce.ts: "the transition ... is an animation, not a phase"), so
  // there is no phase left to read the writing board's final layout off of
  // once voting opens. This ref is that layout's only home: `HostVotingCustom`
  // hands it to `CreatingLeaveBoard` for the transition's leave overlay
  // (§1c). A client that mounts straight into `voting` — a reconnect, a
  // refresh past the beat — never populates it, and the transition degrades
  // to skipping the leave overlay rather than fabricating one.
  //
  // A plain mutation, not `useEffect`: by the time this component re-renders
  // for the `voting` phase, the *previous* commit's `creating` render has
  // already happened, and this line runs again on every render regardless of
  // phase — cheap, and it means the ref is never one render stale.
  const lastCreatingRoom = useRef<RoomState | null>(null);
  if (room.phase.name === "creating") lastCreatingRoom.current = room;

  /**
   * The scoring -> standings wipe (`src/scoringleave.ts`).
   *
   * Armed **during render**, not from an effect, and that is the whole of why
   * this works: an effect runs a frame after the phase push, so the results
   * screen would unmount for that frame and come back as a *new* element —
   * replaying its deal-in on the way out. Deciding here keeps `HostScoring` at
   * the same position in the child list across the change, so React holds on to
   * the DOM and the cards that are on screen are the ones that leave.
   *
   * `leaveUntil` is a deadline rather than a boolean for the same reason
   * `Room.paused` banks milliseconds: it survives any number of re-renders in
   * between and answers "is the beat still running?" without a second copy of
   * the truth.
   */
  const [reduced] = useState(prefersReducedMotion);
  const prevPhase = useRef<string | null>(null);
  const leaveUntil = useRef(0);
  const now = Date.now();
  if (!reduced && prevPhase.current === "scoring" && room.phase.name === "standings") {
    leaveUntil.current = now + LEAVE_MS;
  }
  prevPhase.current = room.phase.name;
  const leaving = now < leaveUntil.current;

  // The one re-render that takes the outgoing screen back off again. Nothing
  // else would: the room is settled on `standings` and may push no state at all
  // between the bank and whatever happens next.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!leaving) return;
    const id = setTimeout(() => setTick((n) => n + 1), leaveUntil.current - Date.now());
    return () => clearTimeout(id);
  }, [leaving]);

  // The last `scoring` props this client rendered, kept for exactly the reason
  // `lastCreatingRoom` above is kept: by the time the wipe plays, the phase
  // carrying the round's results is gone from the room.
  const lastScoring = useRef<ScoringProps | null>(null);
  const scoring =
    room.phase.name === "scoring"
      ? {
          room,
          results: room.phase.results,
          startedAt: room.phase.startedAt,
          skipped: room.phase.skipped,
          marks: room.phase.selfMarks,
        }
      : null;
  if (scoring) lastScoring.current = scoring;
  const onStage = scoring ?? (leaving ? lastScoring.current : null);

  // Keyed on `viewNonce` so the debug menu's refresh remounts the screen — the
  // only way to restart animations and screen-local state that a re-render
  // cannot touch. A Fragment rather than an element, because it must add no DOM
  // of its own: every screen below is a `.screen` root the layout depends on.
  //
  // Two child *positions*, always, even when one of them is null — that is what
  // keeps the results screen mounted across the change into standings. The
  // second slot is every other screen, including the standings board arriving
  // underneath the cards on their way out.
  return (
    <Fragment key={room.viewNonce}>
      {onStage && <HostScoring {...onStage} leaving={scoring === null} />}
      {room.phase.name !== "scoring" &&
        screenFor(room, state, leave, lastCreatingRoom.current, leaving)}
    </Fragment>
  );
}

/** Everything the results screen needs, minus the flag that says it is going. */
type ScoringProps = Omit<Parameters<typeof HostScoring>[0], "leaving">;

// The explicit ReactElement return type is what makes tsc flag an unhandled
// phase — there is no noImplicitReturns in this repo, so dropping it would
// make a missing case compile silently.
function screenFor(
  room: RoomState,
  state: ClientState,
  leave: () => void,
  creatingSnapshot: RoomState | null,
  /** The standings board is arriving under a round that is still leaving. */
  fromScoring: boolean,
): ReactElement {
  switch (room.phase.name) {
    case "lobby":
      return <HostLobby room={room} onLeave={leave} />;
    case "voting":
      return (
        <HostVoting room={room} offset={state.clockOffset} creatingSnapshot={creatingSnapshot} />
      );
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
      // Unreachable: the caller renders the results screen from its own slot,
      // above, so that it can stay mounted while it wipes off into standings.
      // The case stays because the explicit `ReactElement` return type is what
      // makes tsc flag an unhandled phase, and dropping it would take that
      // check with it.
      return <Fragment />;
    case "standings":
      return <HostStandings room={room} fromScoring={fromScoring} />;
    case "teams":
      return <HostTeams room={room} />;
    case "creating":
      return <HostCreating room={room} offset={state.clockOffset} />;
  }
}
