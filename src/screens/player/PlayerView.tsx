import { useEffect, useRef, useState } from "react";
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

export function PlayerView({ state, onLeave }: { state: ClientState; onLeave: () => void }): ReactElement {
  const room = state.room!;
  const playing = room.phase.name === "playing";
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);

  // This input outlives the round it was typed in, so anything left over
  // when the round ends (timesup, scoring, back to lobby) must not bleed
  // into the next one. Blurring is part of that cleanup: the input only moves
  // offstage with CSS, so without this it keeps focus — and the keyboard stays
  // up over the results the player is trying to read.
  useEffect(() => {
    if (playing) return;
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
      {renderPhase(room, state, onLeave)}
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

function renderPhase(room: RoomState, state: ClientState, onLeave: () => void): ReactElement {
  switch (room.phase.name) {
    case "lobby":
      return <PlayerLobby room={room} playerId={getPlayerId()} onLeave={onLeave} />;
    case "voting":
      return <PlayerVoting room={room} playerId={getPlayerId()} offset={state.clockOffset} />;
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
            offset={state.clockOffset}
            countdown={countdown}
          />
        );
      }
      return <PlayerStandings room={room} playerId={getPlayerId()} countdown={countdown} />;
    }
    case "playing":
      return <PlayerPlaying category={room.category} entries={state.entries} />;
    case "timesup":
      return <TimesUp />;
    case "scoring":
      return (
        <PlayerScoring room={room} results={room.phase.results} playerId={getPlayerId()} />
      );
    case "standings":
      return <PlayerStandings room={room} playerId={getPlayerId()} />;
    case "teams":
      return <PlayerTeams room={room} playerId={getPlayerId()} />;
  }
}
