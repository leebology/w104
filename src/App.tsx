import { useEffect, useRef, useState } from "react";
import { makeRoomCode } from "../shared/words";
import { getPlayerId } from "./net/identity";
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

  function joinLobby(code: string, name: string, emoji: string) {
    setSession({ code, role: "player" });
    roomStore.connect({ code, playerId: getPlayerId(), role: "player", name, emoji });
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

  // A kick is the one error whose destination is the first screen rather than
  // an ErrorScreen with a Back button: the room is gone for this device, so it
  // does the same teardown `leave()` does. In an effect, not in render — the
  // render body must not close the socket or set state. Closing here is UX,
  // not enforcement: the server's kicked list already refuses the reconnect,
  // so it does not matter that partysocket may have reconnected first.
  const errorCode = client.error?.code ?? null;
  useEffect(() => {
    if (errorCode !== "kicked") return;
    roomStore.disconnect();
    setSession(null);
  }, [errorCode]);

  if (!session) return <Landing onCreate={createLobby} onJoin={joinLobby} />;

  const outOfCodeAttempts =
    client.error?.code === "room-exists" && attempts.current >= MAX_CODE_ATTEMPTS;

  if (outOfCodeAttempts) {
    return <ErrorScreen message={NO_CODE_MESSAGE} onBack={leave} />;
  }

  // `room-exists` is routine (the retry effect above handles it) and `kicked`
  // is on its way to Landing via its own effect; every other code is terminal.
  if (
    client.error &&
    client.error.code !== "room-exists" &&
    client.error.code !== "kicked"
  ) {
    return <ErrorScreen message={client.error.message} onBack={leave} />;
  }
  if (!client.room) return <Connecting />;

  return session.role === "host"
    ? <HostView state={client} onLeave={leave} />
    : <PlayerView state={client} onLeave={leave} />;
}
