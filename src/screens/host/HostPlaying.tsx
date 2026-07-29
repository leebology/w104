import { formatClock, useRemaining } from "../../net/clock";
import { RoomChip } from "../../components/RoomChip";
import { PlayerPill } from "../../components/Roster";
import { currentRound } from "../../../shared/state";
import type { RoomState } from "../../../shared/state";
import { HostHeader, PlayerCount } from "./HostHeader";

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

  return (
    <main className="screen screen--host">
      <HostHeader
        left={<RoomChip code={room.code} />}
        round={currentRound(room)}
        of={room.settings.roundCount}
        right={<PlayerCount n={room.players.length} />}
      />

      <div className="host-stage">
        {/* Sits above the gold rather than on it — the banner is the category
            alone, and this label must not compete with it. */}
        <span className="name-a">NAME A:</span>
        <div className="banner">
          <span className="banner__text">{room.category}</span>
        </div>
        <ul className="roster-row">
          {room.players.map((p) => (
            <PlayerPill key={p.id} player={p} variant="playing" />
          ))}
        </ul>
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
