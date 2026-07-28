import { formatClock, useRemaining } from "../../net/clock";
import { CATEGORIES } from "../../../shared/categories";
import { tallyVotes, voteBudget, voteShares } from "../../../shared/voting";
import { teamsEnabled } from "../../../shared/teams";
import { currentRound } from "../../../shared/state";
import type { Player, RoomState } from "../../../shared/state";
import { VOTING_MS } from "../../../shared/reduce";
import { RoomChip } from "../../components/RoomChip";
import { roomStore } from "../../net/room";
import { HostHeader, VotingCount } from "./HostHeader";

type Props = {
  room: RoomState;
  /** `state.clockOffset` — needed even outside `countdown` so the open voting
      deadline counts down against the same clock as everything else. */
  offset: number;
  /** Present once voting has closed and the round countdown is running. */
  countdown?: { endsAt: number; offset: number };
};

/** Who voted for this category, and how many times each. */
function votersFor(room: RoomState, category: string): Array<[Player, number]> {
  const out: Array<[Player, number]> = [];
  for (const p of room.players) {
    const n = room.votes[p.id]?.[category] ?? 0;
    if (n > 0) out.push([p, n]);
  }
  return out;
}

/**
 * The avatar strip and its total. Shared by the open grid and both rows of the
 * closed reveal — three renderings of the same thing, so it is one component.
 * `overflow: hidden` on the row means the avatars clip under pressure and the
 * total never does.
 */
function VoteFoot({
  room, category, total, totalStyle,
}: {
  room: RoomState;
  category: string;
  /** Vote count while voting is open; the share percentage once it has closed. */
  total: string;
  totalStyle?: { fontSize: string };
}) {
  return (
    <span className="vote-card__foot">
      <span className="vote-card__voters">
        {votersFor(room, category).map(([p, n]) => (
          <span className="vote-card__voter" key={p.id}>
            {p.emoji}
            {n > 1 && <span className="vote-card__times">×{n}</span>}
          </span>
        ))}
      </span>
      <span className="vote-card__total" style={totalStyle}>{total}</span>
    </span>
  );
}

/**
 * Name size steps with share so the leader reads from the sofa. A step
 * function rather than per-card magic numbers, so adding a category cannot
 * quietly change the type scale. This governs the open grid only, where any
 * of 16 categories can land at any vote count — see `rankNameSize` below for
 * why the closed reveal's fixed 3-slot podium is different.
 */
function nameSize(votes: number): string {
  if (votes >= 8) return "38px";
  if (votes >= 3) return "26px";
  if (votes === 2) return "24px";
  return "21px";
}

export function HostVoting({ room, offset, countdown }: Props) {
  const totals = tallyVotes(room.votes);
  // One hook, one deadline: the voting window while it runs, the round
  // countdown once it has closed. `useRemaining` returns whole seconds.
  const remaining = useRemaining(
    countdown?.endsAt ?? (room.phase.name === "voting" ? room.phase.endsAt : 0),
    countdown?.offset ?? offset,
  );
  const budget = voteBudget(room.settings);
  const cast = Object.values(totals).reduce((a, b) => a + b, 0);
  // Matches `everyoneReady` in shared/reduce.ts, which is what actually closes
  // voting: a disconnected player must not read as "ready" on the TV, or the
  // count can say "not everyone's ready" right before voting closes anyway.
  const ready = room.players.filter((p) => p.connected && p.ready).length;

  if (countdown) {
    return <HostVotingClosed room={room} totals={totals} remaining={remaining} cast={cast} />;
  }

  // Four rows of four, in fixed pool order — nothing sorts this.
  const rows = [0, 4, 8, 12].map((i) => CATEGORIES.slice(i, i + 4));

  return (
    <main className="screen screen--host host-voting">
      <HostHeader
        left={<RoomChip code={room.code} />}
        round={currentRound(room)}
        of={room.settings.roundCount}
        right={<VotingCount n={room.players.length} ready={ready} />}
      />

      <p className="host-voting__prompt">
        PICK YOUR CATEGORIES — {budget} {budget === 1 ? "VOTE" : "VOTES"} EACH
      </p>

      <div className="host-voting__grid">
        {rows.map((row, i) => (
          <div className="host-voting__row" key={i}>
            {row.map((category) => {
              const votes = totals[category] ?? 0;
              return (
                <div
                  key={category}
                  className={votes > 0 ? "vote-card" : "vote-card vote-card--zero"}
                  // The whole mechanic: card width IS the odds. No measurement,
                  // no JS layout pass — flex-grow carries it.
                  style={{ flexGrow: votes + 1 }}
                >
                  <span
                    className="vote-card__name"
                    style={votes > 0 ? { fontSize: nameSize(votes) } : undefined}
                  >
                    {category}
                  </span>
                  {votes > 0 && (
                    <VoteFoot room={room} category={category} total={String(votes)} />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="host-voting__footer">
        {/* `formatClock` gives the m:ss the host timer is drawn in, and the
            fill comes off the same seconds — no second clock. */}
        <span className="host-voting__clock">{formatClock(remaining)}</span>
        <span className="timer-track">
          <span
            className="timer-track__fill"
            style={{ width: `${Math.min(100, (remaining / (VOTING_MS / 1000)) * 100)}%` }}
          />
        </span>
        {/* One event, two destinations. With teams on, Back steps to team
            select rather than all the way to the room — the server derives
            that; this only has to name it correctly. */}
        <button
          type="button"
          className="btn btn--ghost btn--small"
          onClick={() => roomStore.send({ type: "backToLobby" })}
        >
          {teamsEnabled(room.settings) ? "Back to teams" : "Back to room"}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => roomStore.send({ type: "startGame" })}
        >
          Continue
        </button>
      </div>
    </main>
  );
}

function HostVotingClosed({
  room, totals, remaining, cast,
}: {
  room: RoomState;
  totals: Record<string, number>;
  /** Whole seconds — `useRemaining` returns a number, not a formatted string. */
  remaining: number;
  cast: number;
}) {
  const shares = voteShares(room.votes);
  // Survivors only, strongest first. Zero-vote categories are gone.
  const survivors = CATEGORIES
    .filter((c) => (totals[c] ?? 0) > 0)
    .sort((a, b) => (totals[b] ?? 0) - (totals[a] ?? 0));
  const top = survivors.slice(0, 3);
  const rest = survivors.slice(3);
  // Rank-indexed, not a step function like `nameSize` above. That's a
  // deliberate difference, not the same mechanism done twice: `top` is
  // always exactly 3 slots by construction, so "2nd place" is a fixed thing
  // to hand-tune rather than an open-ended scale that a 17th category could
  // quietly perturb.
  const rankNameSize = ["52px", "34px", "30px"];
  const rankShareSize = ["46px", "34px", "30px"];

  return (
    <main className="screen screen--host host-voting host-voting--closed">
      <HostHeader
        left={<RoomChip code={room.code} />}
        round={currentRound(room)}
        of={room.settings.roundCount}
        right={
          <span className="host-header__count">
            VOTING CLOSED · {cast} {cast === 1 ? "VOTE" : "VOTES"} IN
          </span>
        }
      />

      <div className="host-voting__result">
        {survivors.length === 0 ? (
          // The deadline force-closes voting regardless of readiness, so this
          // is reachable with nobody having voted at all. Say nothing about
          // which category — the draw itself hasn't happened yet.
          <p className="host-voting__no-votes">
            No one voted — the room gets a random category.
          </p>
        ) : (
          <>
            <div className="host-voting__row host-voting__row--top">
              {top.map((category, i) => (
                <div className="vote-card" key={category} style={{ flexGrow: shares[category] }}>
                  <span className="vote-card__name" style={{ fontSize: rankNameSize[i] }}>{category}</span>
                  <VoteFoot
                    room={room}
                    category={category}
                    total={`${shares[category]}%`}
                    totalStyle={{ fontSize: rankShareSize[i] }}
                  />
                </div>
              ))}
            </div>

            {rest.length > 0 && (
              <div className="host-voting__row host-voting__row--rest">
                {rest.map((category) => (
                  // Equal width below the top three: under ~10% the differences
                  // are not worth a size difference.
                  <div className="vote-card vote-card--small" key={category}>
                    <span className="vote-card__name">{category}</span>
                    <VoteFoot room={room} category={category} total={`${shares[category]}%`} />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Nothing here names the drawn category. It has not been drawn yet — the
          draw happens at the whistle. */}
      <div className="host-voting__closed-footer">
        <p className="get-ready get-ready--tv">Get ready… {remaining}</p>
        <button
          type="button"
          className="btn btn--secondary btn--small"
          onClick={() => roomStore.send({ type: "cancelStart" })}
        >
          Stop
        </button>
      </div>
    </main>
  );
}
