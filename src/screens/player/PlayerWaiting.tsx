import { useState } from "react";
import { roomStore } from "../../net/room";
import { AVATARS, AvatarPicker } from "../../components/AvatarPicker";
import { GetReady } from "../../components/GetReady";
import { TeamBadge } from "../../components/TeamBadge";
import { TeamGrid } from "../../components/TeamGrid";
import { saveProfile } from "../../net/identity";
import { takenAvatars } from "../../../shared/avatars";
import { currentRound, matchComplete } from "../../../shared/state";
import type { PlayerId, RoomState } from "../../../shared/state";
import { teamOf, teamsEnabled } from "../../../shared/teams";

type Props = {
  room: RoomState;
  playerId: PlayerId;
  /**
   * Present only during a countdown that will actually admit this player —
   * `to: "playing"`. A countdown into the category vote admits nobody, so it
   * gets no card. See `PlayerView`.
   */
  countdown?: { endsAt: number; offset: number };
};

/**
 * Where the room is right now, in one line.
 *
 * The only thing on this screen that changes on its own, and without it the
 * screen is a spinner: somebody who has just walked in wants to know whether
 * they are waiting on a round, a vote, or a results screen, and roughly how
 * long that is.
 */
function statusOf(room: RoomState): string {
  const round = currentRound(room);
  const of = room.settings.roundCount;
  switch (room.phase.name) {
    case "teams":
      return "The room is picking teams";
    case "creating":
      return "The room is writing categories";
    case "voting":
      return "The room is voting on categories";
    case "countdown":
      // Only `to: "playing"` is a countdown this player is in — see the card
      // in `PlayerWaiting` and `admitWaiting` behind it.
      if (room.phase.to === "creating") return "The room is about to write categories";
      return room.phase.to === "voting"
        ? "The room is about to vote on categories"
        : `Round ${round} is about to start`;
    case "playing":
      return `Round ${round} of ${of} is being played`;
    case "timesup":
      return `Round ${room.history.length + 1} just ended`;
    case "scoring":
      return "The room is reading the results";
    case "standings":
      return matchComplete(room)
        ? "This match has finished"
        : `Standings after round ${room.history.length} of ${of}`;
    // A waiting player cannot be in a lobby: both edges that land the room
    // there — `backToLobby` and the view jumper — seat everybody on the way.
    case "lobby":
      return "Waiting for the host";
  }
}

/**
 * The waiting room, on the phone.
 *
 * Somebody who joined after the match started sits here until the next whistle,
 * which is the one edge that admits them (`admitWaiting` in shared/reduce.ts).
 * `PlayerView` renders this ahead of its phase switch, because a waiting player
 * is not on the room's screen at all — they are beside it.
 *
 * **There is no Ready button on this screen, and that is the design rather than
 * an omission.** The countdown that admits them was opened by the seated
 * players' readiness, on their own account; a latecomer who could un-ready out
 * of it could hold the match open indefinitely. The server rejects the event
 * too — a screen with no button on it is not a boundary.
 *
 * With teams on the picker is the whole of what they can do, and doing it is
 * what makes them eligible: no team, no admission, because a shared word list
 * needs somebody to share it with. Nothing places them — see `assignStragglers`
 * — so the tap is theirs to make right up to the whistle.
 */
export function PlayerWaiting({ room, playerId, countdown }: Props) {
  const teams = teamsEnabled(room.settings);
  const mine = teamOf(room, playerId);
  const eligible = !teams || mine !== undefined;
  const done = room.phase.name === "standings" && matchComplete(room);

  // The same split the lobby makes, for the same reason: the name is typed and
  // stays local, the avatar is the server's to refuse and is read back from the
  // room. See `PlayerLobby`.
  const me = room.players.find((p) => p.id === playerId);
  const [name, setName] = useState(me?.name ?? "");
  const emoji = me?.emoji ?? AVATARS[0];
  const taken = takenAvatars(room.players, playerId);

  const updateProfile = (nextName: string, nextEmoji: string) => {
    roomStore.send({ type: "setProfile", name: nextName, emoji: nextEmoji });
    saveProfile(nextName, nextEmoji);
  };

  // The card only goes up for somebody it is actually about. An ineligible
  // player gets the picker, undimmed and still live: admission is read at the
  // whistle and nowhere earlier, so a tap that lands during the count still
  // gets them in. The card is not the deadline.
  const counting = countdown !== undefined && eligible;

  return (
    <main className="screen screen--mobile screen--locked player-waiting">
      <div className={counting ? "player-waiting__stage countdown-dim" : "player-waiting__stage"}>
        <div className="player-waiting__head">
          <span className="plaque plaque--over plaque--over-sm">WAITING ROOM</span>
          <h1>
            {done
              ? "You're in the next match"
              : eligible
                ? "You're in next round"
                : "Pick a team to get in"}
          </h1>
          <p className="player-waiting__status">{statusOf(room)}</p>
        </div>

        {teams && (
          <>
            {/* The same fixed-height swap team select makes: the instruction
                and the badge that replaces it take one slot, so picking a team
                does not move the tiles below it. */}
            <div className="player-waiting__title-slot">
              {mine ? (
                <TeamBadge
                  name={mine.name}
                  colorIndex={mine.colorIndex}
                  className="team-badge--sm"
                />
              ) : (
                <p className="plaque player-teams__plaque">Pick a team</p>
              )}
            </div>
            <TeamGrid room={room} playerId={playerId} dim={counting} />
          </>
        )}

        {!teams && (
          <p className="player-waiting__note">
            {done
              ? "Sit tight — you'll be in as soon as the host starts another match."
              : "Sit tight. You'll be dealt in when the next round starts."}
          </p>
        )}

        {/* Last on the screen, and deliberately below the team picker: with
            teams on, picking one is what gets you into the round and this is
            optional tinkering while you wait. It is here at all because the
            waiting room is the *only* screen a latecomer ever sees before they
            are dealt in — they never pass through the lobby, so without this
            they would play their first round as whatever name and random face
            they arrived with. */}
        <section className="card player-waiting__profile">
          <label className="field__label" htmlFor="waiting-name">Your name</label>
          <input
            id="waiting-name"
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
          <span className="field__label">Pick an avatar</span>
          <AvatarPicker
            value={emoji}
            taken={taken}
            onChange={(next) => updateProfile(name, next)}
          />
        </section>
      </div>

      {/* Literally the same card the TV and every other screen wear, with no
          Stop: that prop is the host's cancel and never appears on a phone. */}
      {counting && countdown && (
        <div className="player-waiting__countdown">
          <GetReady
            endsAt={countdown.endsAt}
            offset={countdown.offset}
            label={`ROUND ${currentRound(room)}`}
          />
        </div>
      )}

      {/* Outside the dimmed stage, like team select's: changing your mind is
          the one thing that stays legal through the count. Leaving does make
          you ineligible, and the card comes down to say so — which is honest
          rather than a glitch. */}
      <div className="player-waiting__footer">
        {mine && (
          <button
            type="button"
            className="btn btn--secondary btn--block"
            onClick={() => roomStore.send({ type: "leaveTeam" })}
          >
            Leave team
          </button>
        )}
      </div>
    </main>
  );
}
