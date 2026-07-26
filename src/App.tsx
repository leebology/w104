import { useEffect, useRef, useState } from "react";
import type { ErrorCode } from "../shared/protocol";
import { makeRoomCode } from "../shared/words";
import { AVATARS } from "./components/AvatarPicker";
import { getPlayerId, getProfile } from "./net/identity";
import { roomStore, useRoom } from "./net/room";
import { Connecting } from "./screens/Connecting";
import { ErrorScreen } from "./screens/ErrorScreen";
import { Landing } from "./screens/Landing";
import { HostView } from "./screens/host/HostView";
import { PlayerView } from "./screens/player/PlayerView";

export type Session = { code: string; role: "player" | "host" };

const MAX_CODE_ATTEMPTS = 6;

/**
 * Client-side only condition — no server ErrorCode fits "gave up allocating
 * a code after MAX_CODE_ATTEMPTS collisions", so this is a local terminal
 * state rendered through the same ErrorScreen, not a protocol error.
 */
const NO_CODE_MESSAGE = "Couldn't find a free room code. Try again.";

/**
 * Errors that mean "this join attempt failed" rather than "the app is stuck".
 * They all resolve the same way — back to Landing with the message inline
 * next to the code boxes — and are listed once because both the effect that
 * performs that trip and the terminal-error check below have to agree.
 */
function isFailedJoin(code: ErrorCode | undefined): boolean {
  return code === "no-such-room" || code === "game-in-progress" || code === "room-full";
}

/**
 * makeRoomCode() draws uniformly with no memory of prior draws, so without
 * this a retry could redraw a code it already knows is taken and burn an
 * attempt for nothing. Bounded so a pathological run can't spin forever;
 * falling back to a plain draw is harmless — the server is the real gate,
 * and attempts.current still caps the total number of tries regardless.
 */
function pickUntriedCode(tried: ReadonlySet<string>): string {
  for (let i = 0; i < 20; i++) {
    const code = makeRoomCode();
    if (!tried.has(code)) return code;
  }
  return makeRoomCode();
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  // Set once and never cleared by app code — only a real page refresh (which
  // remounts this component) resets it, per the requirement that the notice
  // survives navigating back through Landing and even rejoining.
  const [endedNotice, setEndedNotice] = useState<"kicked" | "host-left" | null>(null);
  // A bad code or a mid-round join attempt shown inline on the Join screen
  // itself, not as a separate terminal ErrorScreen the player has to back out
  // of — see the effect below.
  const [joinError, setJoinError] = useState<string | null>(null);
  const attempts = useRef(0);
  const triedCodes = useRef<Set<string>>(new Set());
  const client = useRoom();

  function createLobby() {
    attempts.current = 1;
    const code = makeRoomCode();
    triedCodes.current = new Set([code]);
    setSession({ code, role: "host" });
    roomStore.connect({
      code, playerId: getPlayerId(), role: "host", intent: "create",
    });
  }

  // Name and emoji are no longer chosen before joining — the player picks a
  // profile once they're already in the lobby, live, via `setProfile`. This
  // just seeds the room with whatever they used last time (or a first-time
  // default) so they show up in the roster right away.
  function joinLobby(code: string) {
    setJoinError(null);
    setSession({ code, role: "player" });
    const saved = getProfile();
    roomStore.connect({
      code,
      playerId: getPlayerId(),
      role: "player",
      name: saved.name,
      emoji: saved.emoji || AVATARS[0],
    });
  }

  // A taken code is expected, not exceptional — roll another and try again,
  // until MAX_CODE_ATTEMPTS is spent. At that point we stop retrying and let
  // the render below surface a terminal ErrorScreen instead of leaving the
  // user on an unrecoverable "Connecting…" screen.
  useEffect(() => {
    if (client.error?.code !== "room-exists") return;
    if (attempts.current >= MAX_CODE_ATTEMPTS) return;
    attempts.current += 1;
    const code = pickUntriedCode(triedCodes.current);
    triedCodes.current.add(code);
    setSession({ code, role: "host" });
    roomStore.connect({ code, playerId: getPlayerId(), role: "host", intent: "create" });
  }, [client.error]);

  function leave() {
    roomStore.disconnect();
    setSession(null);
  }

  // A bad room code, a game already in progress, and a full room are all just
  // "that join didn't work" — routine, not terminal — so they send the player
  // straight back to the Join screen with an inline message instead of a
  // full-screen ErrorScreen requiring a Back tap.
  useEffect(() => {
    if (session?.role !== "player") return;
    if (!isFailedJoin(client.error?.code)) return;
    roomStore.disconnect();
    setSession(null);
    setJoinError(client.error!.message);
  }, [client.error, session]);

  // Being kicked and the host ending the game both land on the first screen
  // rather than an ErrorScreen with a Back button: the room is gone for this
  // device either way, so both do the same teardown `leave()` does. In an
  // effect, not in render — the render body must not close the socket or set
  // state. Closing here is UX, not enforcement: the server has already deleted
  // the room (or banned this player), so it does not matter that partysocket
  // may have reconnected first.
  const errorCode = client.error?.code ?? null;
  useEffect(() => {
    if (errorCode !== "kicked" && errorCode !== "host-left") return;
    roomStore.disconnect();
    setSession(null);
    setEndedNotice(errorCode);
  }, [errorCode]);

  // Distinct wording for the two: "removed" is about this player, "ended" is
  // about everyone, and a player who gets the wrong one draws the wrong
  // conclusion about whether they can rejoin.
  const banner = endedNotice && (
    <p className="kicked-banner">
      {endedNotice === "kicked"
        ? "The host removed you from the game."
        : "The host ended the game."}
    </p>
  );

  if (!session) {
    return (
      <>
        {banner}
        <Landing onCreate={createLobby} onJoin={joinLobby} joinError={joinError} />
      </>
    );
  }

  const outOfCodeAttempts =
    client.error?.code === "room-exists" && attempts.current >= MAX_CODE_ATTEMPTS;

  if (outOfCodeAttempts) {
    return (
      <>
        {banner}
        <ErrorScreen message={NO_CODE_MESSAGE} onBack={leave} />
      </>
    );
  }

  // `room-exists` is routine (the retry effect above handles it), `kicked`,
  // `host-left` and the player-join failures are each on their way back to
  // Landing via their own effect; every other code is terminal.
  if (
    client.error &&
    client.error.code !== "room-exists" &&
    client.error.code !== "kicked" &&
    client.error.code !== "host-left" &&
    !isFailedJoin(client.error.code)
  ) {
    return (
      <>
        {banner}
        <ErrorScreen message={client.error.message} onBack={leave} />
      </>
    );
  }
  if (!client.room) {
    return (
      <>
        {banner}
        <Connecting />
      </>
    );
  }

  return (
    <>
      {banner}
      {session.role === "host"
        ? <HostView state={client} onLeave={leave} />
        : <PlayerView state={client} onLeave={leave} />}
    </>
  );
}
