import { formatClock, useRemaining } from "../../net/clock";
import { RoomChip } from "../../components/RoomChip";
import { PlayerPill } from "../../components/Roster";
import { TimeWarning } from "../../components/TimeWarning";
import { useRoundWarning } from "../../roundwarnings";
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
  const warning = useRoundWarning(remaining, room.settings.durationSec);

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
        {/* Keyed on the mark alone: `.reject-banner`'s reject-fade plays once
            on insertion and then holds at opacity 0, so a static key across
            a round would flash only the first warning and silently update
            the text under an already-invisible node for the rest. Marks are
            distinct within a round by construction, and the screen remounts
            at the next round's boundary regardless. */}
        {warning !== null && (
          <TimeWarning key={warning} mark={warning} variant="host" />
        )}
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
