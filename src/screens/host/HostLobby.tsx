import { useRemaining } from "../../net/clock";
import { PlayerPill } from "../../components/Roster";
import { Wordmark } from "../../components/Wordmark";
import { roomStore } from "../../net/room";
import type { RoomState } from "../../../shared/state";
import { HostHeader, PlayerCount } from "./HostHeader";

type Props = {
  room: RoomState;
  /** Present during the countdown phase; un-readying still cancels it. */
  countdown?: { endsAt: number; offset: number };
  onLeave: () => void;
};

export function HostLobby({ room, countdown, onLeave }: Props) {
  const remaining = useRemaining(countdown?.endsAt ?? 0, countdown?.offset ?? 0);
  const host = typeof location === "undefined" ? "" : location.host.toUpperCase();
  const waiting = room.players.length === 0;

  return (
    <main className="screen screen--host">
      <button type="button" className="back-pill" onClick={onLeave}>
        Back
      </button>

      {/* The room chip other host screens carry would only repeat the code
          that is already the hero here, so the lobby leads with the wordmark
          instead — the join instruction below is louder than any chip. */}
      <HostHeader
        left={<Wordmark small />}
        round={room.round}
        right={<PlayerCount n={room.players.length} />}
      />

      <div className="host-lobby__stage">
        <p className="host-lobby__join">
          {host ? `JOIN AT ${host} · ROOM CODE` : "ROOM CODE"}
        </p>
        <div className="banner host-lobby__code">
          <span className="banner__text">{room.code}</span>
        </div>
        <ul className="roster-row roster-row--inline">
          {room.players.map((p) => (
            <PlayerPill
              key={p.id}
              player={p}
              variant="lobby"
              onKick={(id) => roomStore.send({ type: "kick", targetId: id })}
            />
          ))}
        </ul>
      </div>

      <div className="host-lobby__footer">
        {countdown ? (
          <>
            <p className="get-ready">Get ready… {remaining}</p>
            <button
              type="button"
              className="btn btn--secondary btn--small"
              onClick={() => roomStore.send({ type: "cancelStart" })}
            >
              Stop
            </button>
          </>
        ) : (
          <>
            <p className="host-lobby__hint">
              {waiting
                ? "Waiting for players to join…"
                : "Starting early readies everyone up."}
            </p>
            <button
              type="button"
              className="btn"
              disabled={waiting}
              onClick={() => roomStore.send({ type: "startGame" })}
            >
              Start round
            </button>
          </>
        )}
      </div>
    </main>
  );
}
