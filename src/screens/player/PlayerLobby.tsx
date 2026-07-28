import { useState } from "react";
import { useRemaining } from "../../net/clock";
import { AVATARS, AvatarPicker } from "../../components/AvatarPicker";
import { formatDuration } from "../../components/Stepper";
import { saveProfile } from "../../net/identity";
import { roomStore } from "../../net/room";
import { modeSpec } from "../../../shared/gamemodes";
import type { PlayerId, RoomState } from "../../../shared/state";
import { teamsEnabled } from "../../../shared/teams";

type Props = {
  room: RoomState;
  playerId: PlayerId;
  /** Present during the countdown phase; un-readying here still cancels it. */
  countdown?: { endsAt: number; offset: number };
  onLeave: () => void;
};

export function PlayerLobby({ room, playerId, countdown, onLeave }: Props) {
  const me = room.players.find((p) => p.id === playerId);
  const remaining = useRemaining(countdown?.endsAt ?? 0, countdown?.offset ?? 0);
  const [name, setName] = useState(me?.name ?? "");
  const [emoji, setEmoji] = useState(me?.emoji ?? AVATARS[0]);

  // No name/emoji were chosen before joining — a player picks their profile
  // here instead, and every edit is sent immediately rather than staged
  // behind a save button, so the host and roster see it update live.
  const updateProfile = (nextName: string, nextEmoji: string) => {
    roomStore.send({ type: "setProfile", name: nextName, emoji: nextEmoji });
    saveProfile(nextName, nextEmoji);
  };

  return (
    <main className="screen screen--mobile screen--locked player-lobby">
      <button type="button" className="back-pill" onClick={onLeave}>
        Back
      </button>

      <p className="player-lobby__room">ROOM {room.code}</p>
      <p className="player-lobby__settings">
        {modeSpec(room.settings.mode).name}
        {" · "}
        {room.settings.roundCount} {room.settings.roundCount === 1 ? "ROUND" : "ROUNDS"}
        {" · "}
        {formatDuration(room.settings.durationSec)}
        {teamsEnabled(room.settings) && (
          <>
            {" · "}
            {room.settings.teamCount} TEAMS
          </>
        )}
      </p>
      {/* Without this the countdown just vanishes and the room looks broken. */}
      {room.configuring && (
        <p className="player-lobby__settings">Host is adjusting settings…</p>
      )}

      <section className="card">
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

      <section className="card">
        <span className="field__label">Pick an avatar</span>
        <AvatarPicker
          value={emoji}
          onChange={(next) => {
            setEmoji(next);
            updateProfile(name, next);
          }}
        />
      </section>

      <div className="player-lobby__footer">
        {countdown && <p className="get-ready get-ready--small">Get ready… {remaining}</p>}
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
