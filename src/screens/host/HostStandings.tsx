import { useState } from "react";
import { computeStandings } from "../../../shared/standings";
import { currentRound, matchComplete } from "../../../shared/state";
import { GetReady } from "../../components/GetReady";
import { Podium } from "../../components/Podium";
import { RoomChip } from "../../components/RoomChip";
import { StandingsList } from "../../components/StandingsList";
import { roomStore } from "../../net/room";
import type { RoomState } from "../../../shared/state";
import { rosterOf } from "../../../shared/teams";
import { HostBackToRoom, HostHeader, HostHeaderRight } from "./HostHeader";

type Props = {
  room: RoomState;
  /** Present during an inter-round countdown; un-readying still cancels it. */
  countdown?: { endsAt: number; offset: number };
  /**
   * This board is arriving out of the round's results, with the cards still
   * wiping off the left edge above it — so the rows rise from the bottom on the
   * beat that leaves. False for every other way onto this screen (a refresh, a
   * view jump, a reconnect), which get the settled board. See
   * `src/scoringleave.ts`.
   */
  fromScoring?: boolean;
};

export function HostStandings({ room, countdown, fromScoring }: Props) {
  // Captured at mount: the wipe finishes and `HostView` stops passing this
  // while the board's own stagger is still running, and a class that vanished
  // mid-animation would snap the remaining rows into place.
  const [entering] = useState(fromScoring === true);
  const standings = computeStandings(rosterOf(room), room.history);
  const done = matchComplete(room);
  // On the final screen the round marker would otherwise read one past the
  // last round played, because `currentRound` names the round about to start.
  const played = done ? room.settings.roundCount : currentRound(room) - 1;

  return (
    <main className={done ? "screen screen--host host-standings host-standings--final" : "screen screen--host host-standings"}>
      {/* The stage dims *behind* the countdown rather than being replaced by
          it: the standings are what the room is still talking about, and the
          count is an interruption laid over them. */}
      <div className={countdown ? "host-standings__stage host-standings__stage--dimmed" : "host-standings__stage"}>
        {/* The chip leads and the screen's own title takes the far end, on
            every host screen without exception now — the final board used to
            be the one that broke it, leading with a plaque and pushing the
            room code into a line of small caps on the far side. The join
            instruction is the one thing on a TV that has to be in the same
            corner every time, and "the match is over" is not a reason for it
            to move. */}
        <HostHeader
          left={<RoomChip room={room} />}
          right={
            done ? null : (
              <HostHeaderRight>
                <div className="host-standings__title">
                  <h1>Standings</h1>
                  {/* The list states the scoring direction in its own
                      explainer row, so the subtitle counts rounds instead of
                      saying it twice. */}
                  <p>
                    ROUND {played} OF {room.settings.roundCount}
                  </p>
                </div>
                {/* The match has no other exit between rounds — see the
                    standings brief. Absent on the final screen, where the
                    gold button already does exactly this and ends nothing
                    that is still running. */}
                <HostBackToRoom />
              </HostHeaderRight>
            )
          }
        />

        {/* Below the header rather than inside it, which is where the lobby
            puts the room code: the title of the last screen of a match is the
            first thing on the stage, not a label riding the bar. */}
        {done && (
          <div className="host-standings__over">
            <h1>Match over</h1>
          </div>
        )}

        {/* Each shape does the job it is best at, and which one is up is fixed
            by the state rather than chosen: between rounds the room wants
            detail it can argue over, so the list; at the end it wants a result
            somebody won, so the staircase. Both read the same `standings`
            array in the same order, so nothing about placement or ties depends
            on which is showing. */}
        {done ? (
          <Podium room={room} standings={standings} final entering={entering} />
        ) : (
          <StandingsList room={room} standings={standings} entering={entering} />
        )}

        {/* Centred on the final board and right-aligned between rounds. The
            difference is what the button is for: mid-match it is the forward
            action in the corner every other host screen keeps one in, and at
            the end it is the only thing left on the screen to press. */}
        <footer
          className={
            done
              ? "host-standings__footer host-standings__footer--final"
              : "host-standings__footer"
          }
        >
          {done ? (
            <button
              type="button"
              className="btn"
              onClick={() => roomStore.send({ type: "backToLobby" })}
            >
              Back to room
            </button>
          ) : (
            /* Readiness is marked on the rows themselves — a tally says how
               many are left when what a host wants is *which*. Nothing else
               is said down here: the board above is the screen. */
            <button
              type="button"
              className="btn"
              onClick={() => roomStore.send({ type: "startGame" })}
            >
              Next round
            </button>
          )}
        </footer>
      </div>

      {/* Names the round but never the category: it is drawn at the whistle, so
          there is nothing here to name yet — see reduce.ts. */}
      {countdown && (
        <div className="host-standings__countdown">
          <GetReady
            endsAt={countdown.endsAt}
            offset={countdown.offset}
            label={`ROUND ${currentRound(room)}`}
            onStop={() => roomStore.send({ type: "cancelStart" })}
          />
        </div>
      )}
    </main>
  );
}
