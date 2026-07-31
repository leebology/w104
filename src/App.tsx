import { useEffect, useRef, useState } from "react";
import type { ErrorCode } from "../shared/protocol";
import { makeRoomCode } from "../shared/words";
import { AVATARS } from "./components/AvatarPicker";
import { clearSession, getPlayerId, getProfile, getSession, saveSession } from "./net/identity";
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
 * Errors that mean "this attempt to get into a room failed" rather than "the
 * app is stuck". They all resolve the same way — back to Landing, with either
 * an inline message beside the code boxes or the ended banner, depending on
 * whether a person typed the code or the app resumed it — and are listed once
 * because both the effect that performs that trip and the terminal-error check
 * below have to agree.
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
  // Seeded from storage, so a page that was discarded while backgrounded — or
  // simply refreshed — comes back into the room it was in rather than at the
  // front door. The connect itself happens in the effect below; this only says
  // which screen we are heading for.
  const [session, setSession] = useState<Session | null>(() => getSession());
  /**
   * Whether the connection in flight is a resumed one rather than a fresh
   * create or join. A failed resume is not a failed *join*: nobody typed
   * anything to get it wrong, so it says the game has ended rather than
   * putting an error next to the code boxes.
   *
   * A ref rather than state because the effects below read it in the same tick
   * they clear it, and it must never drive a render on its own.
   */
  const resuming = useRef(session !== null);
  /**
   * Why this device is back at the front door.
   *
   * All three say something about the room this device has just *left* — it
   * removed you, the host closed it, it was not there any more — so all three
   * are cleared by `newSession` below. A notice about the last room has nothing
   * to say once you are in the next one, and "The host ended the game" sitting
   * over a lobby that is plainly running reads as a fault. A page refresh
   * clears them too, by remounting this component.
   */
  const [endedNotice, setEndedNotice] =
    useState<"kicked" | "host-left" | "expired" | null>(null);

  /** Bookkeeping every deliberate create or join does. */
  const newSession = (next: Session) => {
    resuming.current = false;
    setEndedNotice(null);
    setSession(next);
    saveSession(next);
  };
  // A bad code or a mid-round join attempt shown inline on the Join screen
  // itself, not as a separate terminal ErrorScreen the player has to back out
  // of — see the effect below.
  const [joinError, setJoinError] = useState<string | null>(null);
  const attempts = useRef(0);
  const triedCodes = useRef<Set<string>>(new Set());
  const client = useRoom();

  /**
   * The resume itself, once, on a cold start.
   *
   * Deliberately an effect and not part of the initializer above: `connect`
   * opens a socket, which is not something a render is allowed to do. The
   * server is the only gate on whether the room is still there — if it is not,
   * the failure effect below turns this into a trip back to Landing with the
   * game reported ended.
   */
  useEffect(() => {
    const saved = getSession();
    if (!saved) return;
    if (saved.role === "host") {
      // No `intent: "create"`: this is a reclaim of a room that already exists,
      // and creating would be how a host who slept through the reap silently
      // opens an empty second room on the same code.
      roomStore.connect({ code: saved.code, playerId: getPlayerId(), role: "host" });
      return;
    }
    const profile = getProfile();
    roomStore.connect({
      code: saved.code,
      playerId: getPlayerId(),
      role: "player",
      name: profile.name,
      emoji: profile.emoji || AVATARS[0],
    });
    // Mount only. `session` is already seeded from the same storage read, and
    // re-running this on any later change would re-open the socket underneath
    // a game in progress.
  }, []);

  // Connected and seated: from here on this is an ordinary session, and a
  // failure is an ordinary failure. Keyed on the boolean rather than on
  // `client.room`, which is replaced wholesale on every state push.
  const seated = client.room !== null;
  useEffect(() => {
    if (seated) resuming.current = false;
  }, [seated]);

  function createLobby() {
    attempts.current = 1;
    const code = makeRoomCode();
    triedCodes.current = new Set([code]);
    newSession({ code, role: "host" });
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
    newSession({ code, role: "player" });
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
    saveSession({ code, role: "host" });
    roomStore.connect({ code, playerId: getPlayerId(), role: "host", intent: "create" });
  }, [client.error]);

  function leave() {
    roomStore.disconnect();
    // Walking out on purpose is the one thing that must not be resumed: this
    // device is done with that room, and a saved code would put it straight
    // back in on the next load.
    clearSession();
    resuming.current = false;
    setSession(null);
  }

  // A bad room code, a game already in progress, and a full room are all just
  // "that didn't work" — routine, not terminal — so they send the player
  // straight back to the first screen instead of a full-screen ErrorScreen
  // requiring a Back tap.
  //
  // Which message they get depends on how they arrived. A code somebody typed
  // is answered inline beside the boxes they typed it into, because that is
  // what they might want to correct. Anything else — a resumed session, or a
  // host's own room going out from under them — is answered by the banner:
  // nobody typed anything to get it wrong, and the only honest thing to say
  // about a room that is not there is that the game is over. The host path
  // used to land on a dead-end ErrorScreen instead.
  useEffect(() => {
    // Already handled: `setSession(null)` below re-runs this effect with the
    // same error still in the store, and without this the second pass would
    // overwrite a typed join's inline message with the ended banner.
    if (!session) return;
    if (!isFailedJoin(client.error?.code)) return;
    const typed = !resuming.current && session.role === "player";
    resuming.current = false;
    roomStore.disconnect();
    clearSession();
    setSession(null);
    if (typed) setJoinError(client.error!.message);
    else setEndedNotice("expired");
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
    clearSession();
    resuming.current = false;
    setSession(null);
    setEndedNotice(errorCode);
  }, [errorCode]);

  // Distinct wording for the three: "removed" is about this player, "ended" is
  // about everyone and somebody decided it, and "no longer running" is what a
  // device that came back to a room that had gone can honestly say — it does
  // not know whether the host closed it or everyone simply left. A player who
  // gets the wrong one draws the wrong conclusion about whether they can
  // rejoin.
  const banner = endedNotice && (
    <button
      type="button"
      className="kicked-banner"
      onClick={() => setEndedNotice(null)}
    >
      {endedNotice === "kicked"
        ? "The host removed you from the game."
        : endedNotice === "expired"
          ? "That game is no longer running."
          : "The host ended the game."}
      <span className="kicked-banner__close" aria-hidden="true">✕</span>
    </button>
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

  // `room-exists` is routine (the retry effect above handles it), and `kicked`,
  // `host-left` and every failure to get into a room are each on their way back
  // to Landing via their own effect; every other code is terminal.
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
        {/* `leave` clears the saved session as well as the socket, so a phone
            that cannot reach the Worker at all is not sent straight back to
            this screen by the resume on its next load. */}
        <Connecting onBack={leave} />
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
