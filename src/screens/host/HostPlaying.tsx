import { formatClock, useRemaining } from "../../net/clock";
import { RoomChip } from "../../components/RoomChip";
import { PlayerPill } from "../../components/Roster";
import { currentRound } from "../../../shared/state";
import type { RoomState } from "../../../shared/state";
import { seatedPlayers } from "../../../shared/waiting";
import { HostBackToRoom, HostHeader, HostHeaderRight, PlayerCount } from "./HostHeader";

type Props = { room: RoomState; endsAt: number; offset: number };

/**
 * The shared screen during a live round.
 *
 * Hidden invariant: this screen shows *that* people are writing, never *how
 * much*. No per-player counts, no progress bars, no leader hints until the
 * results. The pulsing dot on each pill is the entire activity signal.
 */
export function HostPlaying({ room, endsAt, offset }: Props) {
  const remaining = useRemaining(endsAt, offset, room.paused);
  const fill = Math.max(0, Math.min(1, remaining / room.settings.durationSec));
  // The room as this round has it. Anyone who walked in after the whistle is in
  // the waiting room, is not typing, and is already named in the header strip —
  // a pill for them here would be a player in a round they are not in, and the
  // count beside it would be a lie about who is racing.
  const playing = seatedPlayers(room.players);

  return (
    <main className="screen screen--host">
      <HostHeader
        left={<RoomChip room={room} />}
        round={currentRound(room)}
        of={room.settings.roundCount}
        right={
          <HostHeaderRight>
            <PlayerCount n={playing.length} />
            {/* A live round is abandonable too — `backToLobby` allows this
                phase for it. Closed to a ✕ like every other one, which matters
                more here than anywhere: this screen is the category, and the
                corner must not compete with it. */}
            <HostBackToRoom />
          </HostHeaderRight>
        }
      />

      <div className="host-stage">
        {/* Sits above the gold rather than on it — the banner is the category
            alone, and this label must not compete with it. */}
        <span className="name-a">NAME A:</span>
        <div className="banner">
          <span className="banner__text">{room.category}</span>
        </div>
        <ul className="roster-row">
          {playing.map((p) => (
            <PlayerPill key={p.id} player={p} variant="playing" />
          ))}
        </ul>
        {/* **No time warning here — the phones carry it alone.** The TV already
            says what a warning says, permanently and without covering anything:
            the clock and the draining bar are on screen for the whole round, so
            a band across the middle of it is the one screen in the game telling
            somebody a thing they can already see. It costs more than it says,
            too — this screen *is* the category, and the band lands over the
            banner people look up to re-read. The phone is where it earns its
            place: head-down, typing, with no clock in view. */}
      </div>

      {/* Counted down locally against the server's absolute deadline; the
          server never broadcasts per-second ticks. */}
      <div className="timer-bar">
        <span className="timer-bar__num">{formatClock(remaining)}</span>
        <div className="timer-track">
          <div className="timer-track__fill" style={{ width: `${fill * 100}%` }} />
        </div>
        <span className="timer-bar__label">
          {room.paused !== null
            ? `paused · ${remaining} of ${room.settings.durationSec} sec left`
            : `${remaining} of ${room.settings.durationSec} sec left`}
        </span>
      </div>
    </main>
  );
}
