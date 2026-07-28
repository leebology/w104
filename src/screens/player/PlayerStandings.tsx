import { useRemaining } from "../../net/clock";
import { computeStandings } from "../../../shared/standings";
import { matchComplete } from "../../../shared/state";
import { BadgeStrip } from "../../components/BadgeStrip";
import { roomStore } from "../../net/room";
import type { PlayerId, RoomState } from "../../../shared/state";
import { rosterOf } from "../../../shared/teams";

type Props = {
  room: RoomState;
  playerId: PlayerId;
  /** Present during an inter-round countdown; un-readying still cancels it. */
  countdown?: { endsAt: number; offset: number };
};

export function PlayerStandings({ room, playerId, countdown }: Props) {
  const standings = computeStandings(rosterOf(room), room.history);
  const remaining = useRemaining(countdown?.endsAt ?? 0, countdown?.offset ?? 0);
  const me = standings.find((s) => s.members.includes(playerId));
  const ready = room.players.find((p) => p.id === playerId)?.ready ?? false;
  const done = matchComplete(room);

  return (
    <main className="screen screen--mobile screen--locked player-standings">
      <p className="player-standings__room">
        ROOM {room.code} · {done ? "FINAL" : `AFTER ${room.history.length}`}
      </p>

      {me && (
        <section className="card player-standings__me">
          <span className="player-standings__place">{me.place}</span>
          <span className="player-standings__name">{me.emoji} {me.name}</span>
          <BadgeStrip places={me.badges} />
          <span className="player-standings__points">{me.points} pts</span>
        </section>
      )}

      <ol className="card player-standings__all">
        {standings.map((s) => (
          <li key={s.id}>
            <span>{s.place}</span>
            <span>{s.emoji} {s.name}</span>
            <span>{s.points}</span>
          </li>
        ))}
      </ol>

      <div className="player-standings__footer">
        {countdown && <p className="get-ready get-ready--small">Get ready… {remaining}</p>}
        {done ? (
          <p className="player-standings__hint">That's the match. Waiting for the host…</p>
        ) : (
          // Readying up here is the last real user gesture before a round that
          // starts off a server timer — the only chance iOS gives us to have a
          // keyboard up when `playing` begins. See PlayerView.
          <button
            type="button"
            className={ready ? "btn btn--secondary btn--block" : "btn btn--block"}
            onClick={() => roomStore.send({ type: "ready", ready: !ready })}
          >
            {ready ? "Not ready" : "Ready up"}
          </button>
        )}
      </div>
    </main>
  );
}
