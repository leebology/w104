import { useEffect, useState } from "react";
import { formatClock, useRemaining } from "../../net/clock";
import { prefersReducedMotion } from "../../reveal";
import { BALLOT, RANDOM_CATEGORY } from "../../../shared/categories";
import { tallyVotes, voteBudget, voteShares } from "../../../shared/voting";
import { teamsEnabled } from "../../../shared/teams";
import { customEnabled } from "../../../shared/gamemodes";
import { isWaiting } from "../../../shared/bots";
import { seatedPlayers } from "../../../shared/waiting";
import { currentRound } from "../../../shared/state";
import type { Player, RoomState } from "../../../shared/state";
import { VOTING_MS } from "../../../shared/reduce";
import { GetReady } from "../../components/GetReady";
import { RoomChip } from "../../components/RoomChip";
import { roomStore } from "../../net/room";
import {
  HostBackToRoom,
  HostExit,
  HostHeader,
  HostHeaderRight,
  VotingCount,
} from "./HostHeader";
import { HostVotingCustom } from "./HostVotingCustom";

type Props = {
  room: RoomState;
  /** `state.clockOffset` — needed even outside `countdown` so the open voting
      deadline counts down against the same clock as everything else. */
  offset: number;
  /** Present once voting has closed and the round countdown is running. */
  countdown?: { endsAt: number; offset: number };
  /** The last `creating`-phase `RoomState` this client saw — `null` for a
      stock match (there is no writing phase to have seen) and for a custom
      match this client joined after it closed. Only the custom fork's open
      board does anything with it; see `HostVotingCustom`'s transition. */
  creatingSnapshot?: RoomState | null;
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
 * The avatar strip and its total. Shared by the open grid and the closed
 * reveal — two renderings of the same thing, so it is one component.
 * `overflow: hidden` on the row means the avatars clip under pressure and the
 * total never does.
 *
 * No size override: the closed reveal's cards are one size, and `--total-size`
 * on `.host-voting__row--all` sets it in CSS where the `30cqw` ceiling can
 * still shrink a narrow card's figure.
 */
function VoteFoot({
  room, category, total,
}: {
  room: RoomState;
  category: string;
  /** Vote count while voting is open; the share percentage once it has closed. */
  total: string;
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
      <span className="vote-card__total">{total}</span>
    </span>
  );
}

/**
 * The back-out. One event, two destinations: with teams on it steps to team
 * select rather than all the way to the room — the server derives that, so
 * this only has to name it correctly.
 *
 * **Only one of the two asks first.** Going home ends the game and takes the
 * confirmation every other "Back to room" takes; stepping back to team select
 * ends nothing — no round has been played, the teams survive the trip, and the
 * only casualty is a tally nobody has acted on yet. A dialog warning that the
 * game will end would be warning about something that does not happen.
 *
 * Exported: the custom fork's closed reveal wants the identical behaviour
 * rather than a second copy of it.
 */
export function VotingExit({ room }: { room: RoomState }) {
  if (!teamsEnabled(room.settings)) return <HostBackToRoom />;
  return (
    <HostExit
      label="Back to teams"
      onClick={() => roomStore.send({ type: "backToLobby" })}
    />
  );
}

/**
 * What a card is called on the TV. Only the random option differs from its
 * ballot id, and it differs on every screen that renders it — see PlayerVoting.
 */
function cardLabel(category: string): string {
  return category === RANDOM_CATEGORY ? "🎲 random" : category;
}

export function HostVoting({ room, offset, countdown, creatingSnapshot }: Props) {
  // A different pool, a different fork — everything past this point (both
  // rows, the closed reveal) is the stock ballot's only.
  if (customEnabled(room.settings) && room.pool) {
    return (
      <HostVotingCustom
        room={room}
        offset={offset}
        countdown={countdown}
        creatingSnapshot={creatingSnapshot ?? null}
      />
    );
  }

  const totals = tallyVotes(room.votes);
  // The voting window only. The countdown that follows it is not a second
  // clock this screen has to keep — `GetReady` counts itself off the deadline,
  // because its numerals are not seconds (see shared/countdown.ts).
  const remaining = useRemaining(
    room.phase.name === "voting" ? room.phase.endsAt : 0,
    offset,
    // The debug menu can hold the voting window like it holds a round, and a
    // held phase's `endsAt` is stale by design — without the banked figure this
    // clock would run to 0:00 under a vote that is merely stopped.
    room.paused,
  );
  const budget = voteBudget(room.settings);
  const cast = Object.values(totals).reduce((a, b) => a + b, 0);
  // Matches `everyoneReady` in shared/reduce.ts, which is what actually closes
  // voting: a disconnected player must not read as "ready" on the TV, or the
  // count can say "not everyone's ready" right before voting closes anyway.
  // Seated players only, on both halves — a latecomer has no vote to spend
  // (voting is one window at the top of the match) and `everyoneReady` does not
  // count them, so including them would leave this readout permanently one
  // short of the count that actually closes the vote.
  const voters = seatedPlayers(room.players);
  const ready = voters.filter((p) => p.connected && isWaiting(p)).length;

  if (countdown) {
    return <HostVotingClosed room={room} totals={totals} countdown={countdown} cast={cast} />;
  }

  return (
    <main className="screen screen--host host-voting">
      {/* No round marker: voting only ever happens before round one. */}
      <HostHeader
        left={<RoomChip room={room} />}
        right={
          <HostHeaderRight>
            <VotingCount n={voters.length} ready={ready} />
            <VotingExit room={room} />
          </HostHeaderRight>
        }
      />

      <p className="host-voting__prompt">
        PICK YOUR CATEGORIES — {budget} {budget === 1 ? "VOTE" : "VOTES"} EACH
      </p>

      {/* The board itself stays hidden while voting is open — showing it
          live would let the room watch categories reorder and resize as
          votes land, mid-vote. It appears once for everyone, all at once,
          in the closed reveal below. */}
      <div className="host-voting__grid host-voting__grid--waiting">
        <p className="host-voting__no-votes">Categories reveal once voting closes.</p>
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
  room, totals, countdown, cast,
}: {
  room: RoomState;
  totals: Record<string, number>;
  /** The round countdown's deadline; the card counts itself against it. */
  countdown: { endsAt: number; offset: number };
  cast: number;
}) {
  const shares = voteShares(room.votes);
  // Survivors only, strongest first. Zero-vote options are gone. Off the
  // ballot, so a room that backed `random` sees its odds like any other.
  // One row, no rank split. A card's share
  // is carried by its width and by nothing else, so two categories on the same
  // percentage are drawn identically however far down the order they sit. Type
  // size comes from the CSS (see `--name-size` on `.host-voting__row--all`) so
  // the container-query ceiling still governs a narrow card.
  const survivors = BALLOT
    .filter((c) => (totals[c] ?? 0) > 0)
    .sort((a, b) => (totals[b] ?? 0) - (totals[a] ?? 0));

  // Computed once at mount, matching the custom fork's own closed reveal —
  // this component is a fresh mount every time voting closes, so there is
  // never a stale reading to worry about.
  const [reduced] = useState(prefersReducedMotion);

  // The board sits still for a beat before the top three grow into their
  // share — the same 3s look-up beat `HostVotingCustomClosed` gives the
  // custom board, so both closed reveals settle on the same unhurried pace.
  // This board never shows a zero-vote card (they are filtered out of
  // `survivors` before render), so there is no leaving row to stagger —
  // growing the top three is the only thing this delay has to cover.
  const LOOK_UP_MS = 3000;
  const [grown, setGrown] = useState(reduced);
  useEffect(() => {
    if (reduced) return;
    const t = setTimeout(() => setGrown(true), LOOK_UP_MS);
    return () => clearTimeout(t);
  }, [reduced]);

  return (
    <main className="screen screen--host host-voting host-voting--closed">
      <HostHeader
        left={<RoomChip room={room} />}
        right={
          <HostHeaderRight>
            <span className="host-header__count">
              VOTING CLOSED · {cast} {cast === 1 ? "VOTE" : "VOTES"} IN
            </span>
            <VotingExit room={room} />
          </HostHeaderRight>
        }
      />

      {/* The reveal and the countdown card are two blocks sharing one stage,
          which is what this wrapper is for: it takes the height under the
          header and spaces the pair inside it, rather than letting the reveal
          absorb the slack and pin the card to the bottom edge. Neither is
          dimmed and neither is posed over the other — this is the one screen
          whose countdown interrupts nothing, because the result *is* what the
          room is reading and the five seconds exist to let them read it. */}
      <div className="host-voting__stage">
        <div className="host-voting__result">
          {survivors.length === 0 ? (
            // The deadline force-closes voting regardless of readiness, so this
            // is reachable with nobody having voted at all. Say nothing about
            // which category — the draw itself hasn't happened yet.
            <p className="host-voting__no-votes">
              No one voted — the room gets a random category.
            </p>
          ) : (
            <div className="host-voting__row host-voting__row--all">
              {survivors.map((category) => (
                <div
                  className="vote-card"
                  key={category}
                  // Equal share before the reflow, never 0: `.vote-card` is
                  // `flex: 1 1 0`, so a grow of 0 leaves the card no width at
                  // all and it collapses onto `min-width`. 1 is the same "all
                  // equal" board the reflow reads as growing out of.
                  style={{ flexGrow: grown ? shares[category] : 1 }}
                >
                  <span className="vote-card__name">{cardLabel(category)}</span>
                  <VoteFoot room={room} category={category} total={`${shares[category]}%`} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* The same countdown card the lobby and the standings pose — but a
            block on the stage rather than a card over the screen. Centred over
            the reveal it covered the winning categories, and covered the "no
            one voted" line outright, which is the one thing on this screen a
            room has to read. Nothing on it names the drawn category: it has not
            been drawn yet — that happens at the whistle.

            No Stop button: `cancelStart` from here lands back in `voting`, which
            is a hair's breadth from where "Back to teams" goes and reads as the
            same escape to anyone watching. One way out per screen, in the corner
            every other host screen keeps it in. */}
        <div className="host-voting__countdown">
          <GetReady
            endsAt={countdown.endsAt}
            offset={countdown.offset}
            label={`ROUND ${currentRound(room)}`}
          />
        </div>
      </div>
    </main>
  );
}
