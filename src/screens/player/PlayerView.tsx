import { Fragment, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { getPlayerId } from "../../net/identity";
import { roomStore } from "../../net/room";
import type { ClientState } from "../../net/room";
import { countdownScreen } from "../../../shared/state";
import type { RoomState } from "../../../shared/state";
import { TimesUp } from "../shared/TimesUp";
import { PlayerLobby } from "./PlayerLobby";
import { PlayerPlaying } from "./PlayerPlaying";
import { PlayerScoring } from "./PlayerScoring";
import { PlayerStandings } from "./PlayerStandings";
import { PlayerTeams } from "./PlayerTeams";
import { PlayerVoting } from "./PlayerVoting";
import { PlayerCreating } from "./PlayerCreating";
import { PlayerWaiting } from "./PlayerWaiting";
import { inWaitingRoom } from "../../../shared/waiting";
import { useExperiment } from "../../components/DebugPanel";

export function PlayerView({ state, onLeave }: { state: ClientState; onLeave: () => void }): ReactElement {
  const room = state.room!;
  const me = room.players.find((p) => p.id === getPlayerId());
  const waiting = me !== undefined && inWaitingRoom(me);
  /**
   * Whether **this player** is in the round, not merely whether a round is on.
   *
   * Everything below hangs off this one boolean — the input's onstage class,
   * the focus effects, the tap-to-reclaim listener and the reject banner — so a
   * waiting player must not be caught by any of it. `offstage` is only
   * `opacity: 0`, so a phase-only test left a latecomer with a live, focused
   * field over their waiting screen: the keyboard up, and the reclaim handler
   * stealing focus back on every tap, which is every tap they need to pick a
   * team with.
   */
  const playing = room.phase.name === "playing" && !waiting;
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  // Mirrors `text` so the effect below can read the pending buffer without
  // listing it as a dependency. With `text` in the deps that effect re-runs on
  // every keystroke — and worse, its own setText("") re-triggers it with an
  // empty box, so the flush would race its own cleanup.
  const pending = useRef("");
  pending.current = text;

  // This input outlives the round it was typed in, so anything left over
  // when the round ends (timesup, scoring, back to lobby) must not bleed
  // into the next one. Blurring is part of that cleanup: the input only moves
  // offstage with CSS, so without this it keeps focus — and the keyboard stays
  // up over the results the player is trying to read.
  //
  // Anything still in the box *can* be submitted on the way out, before the
  // clear — but that is off by default now, behind the `flush-on-timeout`
  // debug switch. A word the timer caught you halfway through is a word you
  // did not finish, and scoring it anyway surprised people more often than it
  // saved them. The whole path is still here and still tested, server side
  // included (`flushEntry`, `MIN_FLUSH_LEN`); only the client's decision to
  // walk down it has moved behind a flag.
  //
  // Firing on the phase push rather than on a local deadline is deliberate:
  // the phone never has to guess when the round ended, it is told, so a skewed
  // device clock cannot fire this early. Everything about whether it counts is
  // the server's call — including the phase it lands in, which is why a host
  // `debugSkip` needs no special case here and a `backToLobby` needs no guard.
  //
  // Read into a ref for the same reason `text` is: with the flag in the deps,
  // toggling it mid-round would re-run the effect and flush a box the round
  // has not finished with.
  const flushOnTimeout = useExperiment("flush-on-timeout");
  const flushEnabled = useRef(flushOnTimeout);
  flushEnabled.current = flushOnTimeout;

  useEffect(() => {
    if (playing) return;
    if (flushEnabled.current) roomStore.flush(pending.current);
    setText("");
    input.current?.blur();
  }, [playing]);

  // Focused only once the round actually starts, not when the player readies
  // up — the keyboard should stay closed through the lobby and countdown.
  // This transition has no user gesture behind it (it fires off a server
  // timer), so iOS may decline to open the keyboard from it; that's the
  // accepted trade-off for not popping it early.
  useEffect(() => {
    if (playing) input.current?.focus();
  }, [playing]);

  // Once the round is live, any tap anywhere is itself a gesture — use it to
  // reclaim focus if the keyboard was dismissed some other way (e.g. the
  // player closed it manually to see the full list).
  useEffect(() => {
    if (!playing) return;
    const reclaim = () => {
      if (document.activeElement !== input.current) input.current?.focus();
    };
    document.addEventListener("pointerdown", reclaim);
    return () => document.removeEventListener("pointerdown", reclaim);
  }, [playing]);

  return (
    <>
      {/* Keyed on `viewNonce` so the debug menu's refresh remounts the screen.
          Deliberately around `renderPhase` alone and not around this whole
          component: the entry input below must survive it, or a refresh would
          drop the field iOS only opens a keyboard for on a real gesture. */}
      <Fragment key={room.viewNonce}>
        {renderPhase(room, state, onLeave, waiting)}
      </Fragment>
      {/* Keyed on the sequence, not the text, so the same rejection twice in
          a row replays the fade instead of leaving the first one to finish
          expiring. Lives out here beside the input rather than inside the
          round screen: it is an overlay across the whole viewport, and it
          must not displace a single word of the list underneath it. */}
      {playing && state.rejected && (
        <p className="reject-banner" key={state.rejectedSeq} role="status">
          {state.rejected}
        </p>
      )}
      <div className={playing ? "entry-overlay" : "entry-overlay offstage"}>
        <input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Not a <form>: a bare input avoids one known trigger for
            // Safari's Passwords/Payment/Address AutoFill bar above the
            // keyboard. Enter is handled here directly instead.
            if (e.key !== "Enter") return;
            e.preventDefault();
            roomStore.submit(text);
            setText("");
          }}
          // No `name`/`id`: giving the field one would let the browser's own
          // autofill start remembering and re-suggesting past values for it
          // (observed in testing — a stale value got resubmitted on Enter),
          // which is worse than the problem this is meant to avoid.
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="done"
          placeholder={playing ? `Name a ${room.category}…` : undefined}
          maxLength={64}
          tabIndex={playing ? 0 : -1}
          aria-hidden={!playing}
          aria-label={playing ? `Enter a ${room.category}` : undefined}
        />
      </div>
    </>
  );
}

function renderPhase(
  room: RoomState,
  state: ClientState,
  onLeave: () => void,
  /** Decided once by the caller, which also gates the entry input on it. */
  waiting: boolean,
): ReactElement {
  // Ahead of the phase switch, because a player in the waiting room is not on
  // the room's screen at all — they joined past the lobby and are sitting out
  // whatever is running until the next whistle deals them in. The one screen
  // they get carries its own countdown, so the switch below never sees them.
  const me = room.players.find((p) => p.id === getPlayerId());
  if (me && waiting) {
    // Only a countdown that will actually admit them gets a card. `to:
    // "voting"` admits nobody — see `admitWaiting` — so it is not one.
    const admitting =
      room.phase.name === "countdown" && room.phase.to === "playing"
        ? { endsAt: room.phase.endsAt, offset: state.clockOffset }
        : undefined;
    return <PlayerWaiting room={room} playerId={me.id} countdown={admitting} />;
  }

  switch (room.phase.name) {
    case "lobby":
      return <PlayerLobby room={room} playerId={getPlayerId()} onLeave={onLeave} />;
    case "voting":
      return (
        <PlayerVoting
          room={room}
          playerId={getPlayerId()}
          hands={state.hands}
          offset={state.clockOffset}
          drafts={state.drafts}
        />
      );
    case "countdown": {
      const countdown = { endsAt: room.phase.endsAt, offset: state.clockOffset };
      const screen = countdownScreen(room);
      if (screen === "lobby") {
        return (
          <PlayerLobby
            room={room}
            playerId={getPlayerId()}
            countdown={countdown}
            onLeave={onLeave}
          />
        );
      }
      if (screen === "teams") {
        return (
          <PlayerTeams room={room} playerId={getPlayerId()} countdown={countdown} />
        );
      }
      if (screen === "voting") {
        return (
          <PlayerVoting
            room={room}
            playerId={getPlayerId()}
            hands={state.hands}
            offset={state.clockOffset}
            countdown={countdown}
          />
        );
      }
      return <PlayerStandings room={room} playerId={getPlayerId()} countdown={countdown} />;
    }
    case "playing":
      return (
        <PlayerPlaying
          room={room}
          playerId={getPlayerId()}
          entries={state.entries}
          offset={state.clockOffset}
        />
      );
    case "timesup":
      return <TimesUp />;
    case "scoring":
      return (
        <PlayerScoring
          room={room}
          results={room.phase.results}
          playerId={getPlayerId()}
          startedAt={room.phase.startedAt}
          skipped={room.phase.skipped}
          marks={room.phase.selfMarks}
        />
      );
    case "standings":
      return <PlayerStandings room={room} playerId={getPlayerId()} />;
    case "teams":
      return <PlayerTeams room={room} playerId={getPlayerId()} />;
    case "creating":
      return (
        <PlayerCreating
          room={room}
          playerId={getPlayerId()}
          drafts={state.drafts}
          offset={state.clockOffset}
        />
      );
  }
}
