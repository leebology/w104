import { useState } from "react";
import { AVATARS, AvatarPicker } from "../../components/AvatarPicker";
import { GetReady } from "../../components/GetReady";
import { saveProfile } from "../../net/identity";
import { roomStore } from "../../net/room";
import type { PlayerId, RoomState } from "../../../shared/state";

type Props = {
  room: RoomState;
  playerId: PlayerId;
  /** Present during the countdown phase; un-readying here still cancels it. */
  countdown?: { endsAt: number; offset: number };
  onLeave: () => void;
};

export function PlayerLobby({ room, playerId, countdown, onLeave }: Props) {
  const me = room.players.find((p) => p.id === playerId);
  const [name, setName] = useState(me?.name ?? "");
  const [emoji, setEmoji] = useState(me?.emoji ?? AVATARS[0]);

  // No name/emoji were chosen before joining — a player picks their profile
  // here instead, and every edit is sent immediately rather than staged
  // behind a save button, so the host and roster see it update live.
  const updateProfile = (nextName: string, nextEmoji: string) => {
    roomStore.send({ type: "setProfile", name: nextName, emoji: nextEmoji });
    saveProfile(nextName, nextEmoji);
  };

  // Everything above the footer steps back under the count; the footer does
  // not. Un-readying is the room's brake on the countdown, so that button has
  // to stay lit and tappable while it runs.
  const dim = countdown ? " countdown-dim" : "";

  return (
    <main className="screen screen--mobile screen--locked player-lobby">
      {/* Gives the seat up rather than just closing the socket. A dropped
          connection deliberately leaves the player in the room, greyed out, so
          a locked phone can reclaim its seat and its words — which is the
          right answer for a phone that died and the wrong one for somebody who
          meant to leave. The message goes first: `onLeave` closes the socket,
          and anything sent after it is sent to nothing. */}
      <button
        type="button"
        className={`back-pill${dim}`}
        onClick={() => {
          roomStore.send({ type: "leaveRoom" });
          onLeave();
        }}
      >
        Leave room
      </button>

      {/* Same pill the host wears in team select, just labelled for a player
          who already knows they're in the room — no join address needed. */}
      <div className={`pill room-chip player-lobby__code-chip${dim}`}>
        <span className="room-chip__label">ROOM CODE:</span>
        <span className="room-chip__code">{room.code}</span>
      </div>

      <section className={`card${dim}`}>
        <label className="field__label" htmlFor="player-name">Your name</label>
        <input
          id="player-name"
          className="field__input"
          value={name}
          placeholder="Type a name"
          onChange={(e) => {
            const next = e.target.value;
            setName(next);
            updateProfile(next, emoji);
          }}
          maxLength={20}
        />
      </section>

      <section className={`card${dim}`}>
        <span className="field__label">Pick an avatar</span>
        <AvatarPicker
          value={emoji}
          onChange={(next) => {
            setEmoji(next);
            updateProfile(name, next);
          }}
        />
      </section>

      {/* The same card the TV is showing, over the same dimmed screen. */}
      {countdown && (
        <div className="countdown-pose">
          <GetReady endsAt={countdown.endsAt} offset={countdown.offset} label="CATEGORY VOTE" />
        </div>
      )}

      <div className="player-lobby__footer">
        {/* Readying up is also the last real user gesture before the round
            starts off a server timer — see PlayerView on why that matters to
            the iOS keyboard. */}
        <button
          type="button"
          className={me?.ready ? "btn btn--secondary btn--block" : "btn btn--block"}
          onClick={() => roomStore.send({ type: "ready", ready: !me?.ready })}
        >
          {me?.ready ? "Not ready" : "Ready up"}
        </button>
      </div>
    </main>
  );
}
