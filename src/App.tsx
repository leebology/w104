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

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const attempts = useRef(0);
  const client = useRoom();

  function createLobby() {
    attempts.current = 1;
    const code = makeRoomCode();
    setSession({ code, role: "host" });
    roomStore.connect({
      code, playerId: getPlayerId(), role: "host", intent: "create",
    });
  }

  function joinLobby(code: string, name: string, emoji: string) {
    setSession({ code, role: "player" });
    roomStore.connect({ code, playerId: getPlayerId(), role: "player", name, emoji });
  }

  // A taken code is expected, not exceptional — roll another and try again.
  useEffect(() => {
    if (client.error?.code !== "room-exists") return;
    if (attempts.current >= MAX_CODE_ATTEMPTS) return;
    attempts.current += 1;
    const code = makeRoomCode();
    setSession({ code, role: "host" });
    roomStore.connect({ code, playerId: getPlayerId(), role: "host", intent: "create" });
  }, [client.error]);

  function leave() {
    roomStore.disconnect();
    setSession(null);
  }

  if (!session) return <Landing onCreate={createLobby} onJoin={joinLobby} />;

  if (client.error && client.error.code !== "room-exists") {
    return <ErrorScreen message={client.error.message} onBack={leave} />;
  }
  if (!client.room) return <Connecting />;

  return session.role === "host"
    ? <HostView state={client} onLeave={leave} />
    : <PlayerView state={client} onLeave={leave} />;
}
