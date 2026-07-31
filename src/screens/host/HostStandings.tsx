import { useRemaining } from "../../net/clock";
import { computeStandings } from "../../../shared/standings";
import { currentRound, matchComplete } from "../../../shared/state";
import { GetReady } from "../../components/GetReady";
import { Podium } from "../../components/Podium";
import { RoomChip } from "../../components/RoomChip";
import { StandingsList } from "../../components/StandingsList";
import { roomStore } from "../../net/room";
import type { RoomState } from "../../../shared/state";
import { rosterOf } from "../../../shared/teams";
import { HostExit, HostHeader, HostHeaderRight } from "./HostHeader";

type Props = {
  room: RoomState;
  /** Present during an inter-round countdown; un-readying still cancels it. */
  countdown?: { endsAt: number; offset: number };
};

export function HostStandings({ room, countdown }: Props) {
  const standings = computeStandings(rosterOf(room), room.history);
  const remaining = useRemaining(countdown?.endsAt ?? 0, countdown?.offset ?? 0);
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
        <HostHeader
          left={
            done ? (
              <span className="plaque plaque--over">MATCH OVER</span>
            ) : (
              <div className="host-standings__title">
                <h1>Standings</h1>
                {/* The list states the scoring direction in its own explainer
                    row, so the subtitle counts rounds instead of saying it
                    twice. */}
                <p>
                  AFTER ROUND {played} OF {room.settings.roundCount} ·{" "}
                  {room.settings.roundCount - played} TO GO
                </p>
              </div>
            )
          }
          right={
            <HostHeaderRight>
              {done ? (
                <span className="host-standings__meta">
                  {room.settings.roundCount}{" "}
                  {room.settings.roundCount === 1 ? "ROUND" : "ROUNDS"} · {standings.length}{" "}
                  {standings.length === 1 ? "PLAYER" : "PLAYERS"} · ROOM {room.code}
                </span>
              ) : (
                <>
                  <RoomChip code={room.code} />
                  {/* The match has no other exit between rounds — see the
                      standings brief. Absent on the final screen, where the
                      gold button already does exactly this. */}
                  <HostExit
                    label="Back to room"
                    onClick={() => roomStore.send({ type: "backToLobby" })}
                  />
                </>
              )}
            </HostHeaderRight>
          }
        />

        {/* Each shape does the job it is best at, and which one is up is fixed
            by the state rather than chosen: between rounds the room wants
            detail it can argue over, so the list; at the end it wants a result
            somebody won, so the staircase. Both read the same `standings`
            array in the same order, so nothing about placement or ties depends
            on which is showing. */}
        {done ? (
          <Podium room={room} standings={standings} final />
        ) : (
          <StandingsList room={room} standings={standings} />
        )}

        <div className="host-standings__rule" />

        <footer className="host-standings__footer">
          {done ? (
            <>
              <button
                type="button"
                className="btn"
                onClick={() => roomStore.send({ type: "backToLobby" })}
              >
                Back to room
              </button>
            </>
          ) : (
            <>
              {/* No tally. Readiness is marked on the rows themselves now — a
                  count says how many are left, and what a host actually wants
                  off this screen is *which* ones. The scoring direction is
                  stated once, by the list's own explainer, so this says the
                  other thing a host needs: they do not have to press anything. */}
              <div className="host-standings__count">
                <p className="host-standings__hint">
                  Everyone ready starts the next round on its own.
                </p>
              </div>
              <button
                type="button"
                className="btn"
                onClick={() => roomStore.send({ type: "startGame" })}
              >
                Next round
              </button>
            </>
          )}
        </footer>
      </div>

      {/* Names the round but never the category: it is drawn at the whistle, so
          there is nothing here to name yet — see reduce.ts. */}
      {countdown && (
        <div className="host-standings__countdown">
          <GetReady
            remaining={remaining}
            label={`ROUND ${currentRound(room)}`}
            onStop={() => roomStore.send({ type: "cancelStart" })}
          />
        </div>
      )}
    </main>
  );
}
