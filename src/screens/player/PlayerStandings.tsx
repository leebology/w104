import { useRemaining } from "../../net/clock";
import { computeStandings } from "../../../shared/standings";
import type { Standing } from "../../../shared/standings";
import { currentRound, matchComplete } from "../../../shared/state";
import { ordinal } from "../../ordinal";
import { GetReady } from "../../components/GetReady";
import { roomStore } from "../../net/room";
import type { PlayerId, RoomState } from "../../../shared/state";
import { rosterOf } from "../../../shared/teams";
import { seatedPlayers } from "../../../shared/waiting";
import { TeamBadge } from "../../components/TeamBadge";
import { useMarquee } from "../../marquee";

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
 * given the room the phone has and the TV does not.
 *
 * These are *places*, not points — what a place was worth depends on how many
 * scorers the round had, and a strip of payouts would not say what you actually
 * did in any of them. The total beside your name is the points.
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

  // The denominator has to be the count that actually opens the countdown, and
  // `everyoneReady` does not count the waiting room.
  const here = seatedPlayers(room.players).filter((p) => p.connected);
  const readyCount = here.filter((p) => p.ready).length;
  const tiedWith = (s: Standing) => standings.filter((o) => o.place === s.place).length > 1;
  /**
   * A player's face, or nothing at all for a team.
   *
   * A team is its name here and only its name. The row of member emoji that
   * used to stand in for one said how many people were on it, never which team
   * it was — and on a phone-width row it pushed the name it was supposed to be
   * identifying into an ellipsis. The TV's board is where a roster is worth the
   * space; this list is for finding your own line.
   */
  const emojiOf = (s: Standing) => (s.colorIndex === null ? s.emoji : null);

  // A name too long for its row clips and travels, same as a team's badge —
  // one clip box per row, measured together under one ref.
  const finalList = useMarquee<HTMLOListElement>([standings]);
  const midList = useMarquee<HTMLOListElement>([standings]);

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
              {me.colorIndex !== null ? (
                <TeamBadge name={me.name} colorIndex={me.colorIndex} className="team-badge--lg" />
              ) : (
                <>
                  {emojiOf(me) && <span className="win-card__avatar">{emojiOf(me)}</span>}
                  <span className="win-card__name">{me.name}</span>
                </>
              )}
            </div>
            <div className="win-card__score">
              <span className="win-card__points">{me.points}</span>
              <span className="win-card__unit">
                {me.place === 1 ? "POINTS · MOST IN THE ROOM" : "POINTS"}
              </span>
            </div>
            <RoundBoxes badges={me.badges} room={room} />
          </section>
        )}

        <ol className="final-table" ref={finalList}>
          <li className="final-table__label">FINAL TABLE</li>
          {standings.map((s) => (
            <li
              key={s.id}
              className={s.members.includes(playerId) ? "is-you" : undefined}
              data-first={s.place === 1 ? "" : undefined}
            >
              <span className="final-table__place">{ordinal(s.place)}</span>
              {emojiOf(s) && <span className="final-table__avatar">{emojiOf(s)}</span>}
              <span
                className="final-table__name"
                data-marquee={s.colorIndex === null ? "" : undefined}
              >
                {s.colorIndex !== null ? (
                  <TeamBadge name={s.name} colorIndex={s.colorIndex} className="team-badge--sm" />
                ) : (
                  <span className="marquee">{s.name}</span>
                )}
              </span>
              {s.colorIndex === null && s.members.includes(playerId) && (
                <em className="final-table__flag"> (you)</em>
              )}
              <span className="final-table__score">
                <span className="final-table__points">{s.points}</span>
                <span className="final-table__unit">PTS</span>
              </span>
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
            AFTER ROUND {room.history.length} OF {room.settings.roundCount} · HIGHEST TOTAL WINS
          </p>
        </div>

        {/* One card, no gold recap above it. Your own row carries the round-by-round
            breakdown inside its own highlight, which is the whole reason the recap
            card could go: it was saying a second time what your row already says,
            and it cost the table the room it needed to show ten people. */}
        <ol className="card standings-table" ref={midList}>
          {standings.map((s) => {
            const members = s.members
              .map((id) => room.players.find((p) => p.id === id))
              .filter((p) => p !== undefined);
            const connected = members.filter((p) => p.connected);
            const dropped = connected.length === 0;
            const isMe = s.members.includes(playerId);
            const team = s.colorIndex !== null;
            return (
              <li
                key={s.id}
                className={isMe ? "is-you" : undefined}
                data-dropped={dropped ? "" : undefined}
                data-first={s.place === 1 ? "" : undefined}
              >
                <div className="standings-table__row">
                  <span className="standings-table__place">{ordinal(s.place)}</span>
                  {emojiOf(s) && (
                    <span className="standings-table__avatar">{emojiOf(s)}</span>
                  )}
                  <span className="standings-table__name" data-marquee={team ? undefined : ""}>
                    {team ? (
                      <TeamBadge name={s.name} colorIndex={s.colorIndex!} className="team-badge--sm" />
                    ) : (
                      <span className="marquee">{s.name}</span>
                    )}
                  </span>
                  {!team && isMe && <em className="standings-table__flag"> (you)</em>}
                  {dropped && <em className="standings-table__flag"> dropped</em>}
                  {/* What the round just played paid this row, immediately left
                      of the running total it went into. */}
                  {s.last !== null && (
                    <span className="standings-table__delta">+{s.last}pts</span>
                  )}
                  <span className="standings-table__score">
                    <span className="standings-table__points">{s.points}</span>
                    <span className="standings-table__unit">PTS</span>
                  </span>
                </div>
                {isMe && <RoundBoxes badges={s.badges} room={room} />}
              </li>
            );
          })}
        </ol>
      </div>

      {/* Literally the same card the TV poses over its board, at the size the
          phone gives it. It names the round but never the category — that is
          drawn at the whistle, so there is nothing to name yet. */}
      {countdown && (
        <div className="player-standings__countdown">
          <GetReady remaining={remaining} label={`ROUND ${currentRound(room)}`} />
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
