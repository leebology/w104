import { useRemaining } from "../../net/clock";
import { computeStandings } from "../../../shared/standings";
import type { Standing } from "../../../shared/standings";
import { currentRound, matchComplete } from "../../../shared/state";
import { ordinal } from "../../ordinal";
import { roomStore } from "../../net/room";
import type { PlayerId, RoomState } from "../../../shared/state";
import { rosterOf } from "../../../shared/teams";

type Props = {
  room: RoomState;
  playerId: PlayerId;
  /** Present during an inter-round countdown; un-readying still cancels it. */
  countdown?: { endsAt: number; offset: number };
};

/**
 * Your round-by-round card: one box per round of the match, filled in with the
 * place you took and the category it was, empty and dashed for the rounds
 * still to come. It is the same information the podium's badge strip carries,
 * given the room the phone has and the TV does not — and it is where the golf
 * sum stops being a bare number, because the boxes visibly add up to it.
 */
function RoundBoxes({ badges, room }: { badges: number[]; room: RoomState }) {
  const remaining = Math.max(0, room.settings.roundCount - room.history.length);
  return (
    <div className="round-boxes">
      {badges.map((place, i) => (
        <div className="round-box" key={i}>
          <span className="round-box__place">{place}</span>
          <span className="round-box__category">{room.history[i]?.category ?? ""}</span>
        </div>
      ))}
      {/* Two lines, same as a played box: the word over the number, so the
          empties line up with the places beside them instead of reading as a
          different kind of thing. */}
      {Array.from({ length: remaining }, (_, i) => (
        <div className="round-box round-box--todo" key={`todo-${i}`}>
          <span className="round-box__word">Round</span>
          <span className="round-box__n">{room.history.length + i + 1}</span>
        </div>
      ))}
    </div>
  );
}

export function PlayerStandings({ room, playerId, countdown }: Props) {
  const standings = computeStandings(rosterOf(room), room.history);
  const remaining = useRemaining(countdown?.endsAt ?? 0, countdown?.offset ?? 0);
  // Absent for someone who joined mid-match and has no standing yet.
  const me = standings.find((s) => s.members.includes(playerId));
  const ready = room.players.find((p) => p.id === playerId)?.ready ?? false;
  const done = matchComplete(room);

  const here = room.players.filter((p) => p.connected);
  const readyCount = here.filter((p) => p.ready).length;
  const tiedWith = (s: Standing) => standings.filter((o) => o.place === s.place).length > 1;
  const emojiOf = (s: Standing) =>
    s.colorIndex === null
      ? s.emoji
      : s.members.map((id) => room.players.find((p) => p.id === id)?.emoji ?? "").join("");

  if (done) {
    return (
      <main className="screen screen--mobile screen--locked player-standings player-standings--final">
        <span className="plaque plaque--over plaque--over-sm">MATCH OVER</span>

        {me && (
          <section className="card win-card">
            <span className="win-card__label">
              {me.place === 1
                ? tiedWith(me)
                  ? "YOU TIED FOR THE WIN"
                  : "YOU WON"
                : `YOU FINISHED ${ordinal(me.place)}`}
            </span>
            <div className="win-card__who">
              <span className="win-card__avatar">{emojiOf(me)}</span>
              <span className="win-card__name">{me.name}</span>
            </div>
            <div className="win-card__score">
              <span className="win-card__points">{me.points}</span>
              <span className="win-card__unit">
                {me.place === 1 ? "POINTS · LOWEST IN THE ROOM" : "POINTS"}
              </span>
            </div>
            <RoundBoxes badges={me.badges} room={room} />
          </section>
        )}

        <ol className="final-table">
          <li className="final-table__label">FINAL TABLE</li>
          {standings.map((s) => (
            <li
              key={s.id}
              className={s.members.includes(playerId) ? "is-you" : undefined}
              data-first={s.place === 1 ? "" : undefined}
            >
              <span className="final-table__place">{ordinal(s.place)}</span>
              <span className="final-table__avatar">{emojiOf(s)}</span>
              <span className="final-table__name">
                {s.name}
                {s.members.includes(playerId) && <em> (you)</em>}
              </span>
              <span className="final-table__points">{s.points}</span>
            </li>
          ))}
        </ol>

        <p className="player-standings__hint">That's the match. Waiting for the host…</p>
      </main>
    );
  }

  return (
    <main className="screen screen--mobile screen--locked player-standings">
      {/* Dims behind the countdown the same way the host's board does, so the
          two screens read as one moment. The footer stays outside it: the
          Not ready button is the room's brake on the countdown and has to
          stay lit and tappable while the count is running. */}
      <div
        className={
          countdown
            ? "player-standings__stage player-standings__stage--dimmed"
            : "player-standings__stage"
        }
      >
        <div className="player-standings__head">
          <h1>Standings</h1>
          <p>
            AFTER ROUND {room.history.length} OF {room.settings.roundCount} · LOWEST TOTAL WINS
          </p>
        </div>

        {/* One card, no gold recap above it. Your own row carries the round-by-round
            breakdown inside its own highlight, which is the whole reason the recap
            card could go: it was saying a second time what your row already says,
            and it cost the table the room it needed to show ten people. */}
        <ol className="card standings-table">
          {standings.map((s) => {
            const members = s.members
              .map((id) => room.players.find((p) => p.id === id))
              .filter((p) => p !== undefined);
            const connected = members.filter((p) => p.connected);
            const isReady = connected.length > 0 && connected.every((p) => p.ready);
            const dropped = connected.length === 0;
            const isMe = s.members.includes(playerId);
            return (
              <li
                key={s.id}
                className={isMe ? "is-you" : undefined}
                data-dropped={dropped ? "" : undefined}
                data-first={s.place === 1 ? "" : undefined}
              >
                <div className="standings-table__row">
                  <span className="standings-table__place">{ordinal(s.place)}</span>
                  <span className="standings-table__avatar">{emojiOf(s)}</span>
                  <span className="standings-table__name">
                    {s.name}
                    {isMe && <em> (you)</em>}
                    {dropped && <em> dropped</em>}
                  </span>
                  {/* No dot on a dropped row: it is not waiting on them. The
                      points stay right-aligned without it. */}
                  {!dropped && (
                    <i
                      className={
                        isReady
                          ? "standings-table__dot standings-table__dot--ready"
                          : "standings-table__dot"
                      }
                    />
                  )}
                  <span className="standings-table__points">{s.points}</span>
                </div>
                {isMe && <RoundBoxes badges={s.badges} room={room} />}
              </li>
            );
          })}
          <li className="standings-table__key">
            TEAL DOT = READY FOR ROUND {currentRound(room)}
          </li>
        </ol>
      </div>

      {/* The same card the TV poses over its board, at the size the phone
          gives it. It names the round but never the category — that is drawn
          at the whistle, so there is nothing to name yet. */}
      {countdown && (
        <div className="player-standings__countdown">
          <div className="get-ready-card">
            <span className="get-ready-card__label">GET READY</span>
            <span className="get-ready-card__count">{remaining}</span>
          </div>
          <div className="get-ready-note">
            <span className="get-ready-note__round">ROUND {currentRound(room)}</span>
            <i className="get-ready-note__dot" />
            <span>Not ready stops it</span>
          </div>
        </div>
      )}

      <div className="player-standings__footer">
        {/* Readying up here is the last real user gesture before a round that
            starts off a server timer — the only chance iOS gives us to have a
            keyboard up when `playing` begins. See PlayerView. Live through the
            countdown too: un-readying is what cancels it. */}
        <button
          type="button"
          className={ready ? "btn btn--secondary btn--block" : "btn btn--block"}
          onClick={() => roomStore.send({ type: "ready", ready: !ready })}
        >
          {ready ? "Not ready" : `Ready up · ${readyCount}/${here.length}`}
        </button>
      </div>
    </main>
  );
}
