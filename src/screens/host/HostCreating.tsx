import type { CSSProperties } from "react";
import { formatClock, useRemaining } from "../../net/clock";
import { quotaFor } from "../../../shared/customCategories";
import { teamsEnabled } from "../../../shared/teams";
import type { RoomState } from "../../../shared/state";
import { WRITE_MS } from "../../../shared/customCategories";
import { RoomChip } from "../../components/RoomChip";
import { PlayerPill } from "../../components/Roster";
import { roomStore } from "../../net/room";
import { HostExit, HostHeader, HostHeaderRight } from "./HostHeader";

type Props = {
  room: RoomState;
  /** `state.clockOffset` — needed so the timer counts down against the same
      clock as everything else. */
  offset: number;
};

/**
 * The host's view of the writing phase. Progress only, never content —
 * the creation TV shows `slotStates`, never draft text. Three signals per slot:
 * the paper says *reached*, the shadow says *lifted*, the stamp-vs-dots says
 * *finished or in flight*.
 */
export function HostCreating({ room, offset }: Props) {
  const remaining = useRemaining(room.phase.name === "creating" ? room.phase.endsAt : 0, offset, room.paused);
  const quota = quotaFor(room.players.length, room.settings.roundCount);
  const slotCount = room.players.length * quota;

  // Slot count, not player count: the constraint is horizontal, and only column
  // count can break it. Five authors × 3 cards is 15 slots and still fits as
  // columns; 13 authors × 1 does not. The quota arm is the third trip — a column
  // of four 96px slots does not fit a 720p stage.
  const useWall = room.players.length > 12 || slotCount > 15 || quota >= 4;

  // Count how many slots are done (for the plaque subtitle on Layout B)
  let written = 0;
  for (const playerId of room.players.map((p) => p.id)) {
    const states = room.slotStates[playerId] ?? [];
    written += states.filter((s) => s === "done").length;
  }

  const ready = room.players.filter((p) => p.connected && p.ready).length;

  return (
    <main className="screen screen--host host-creating">
      <HostHeader
        left={<RoomChip code={room.code} />}
        right={
          <HostHeaderRight>
            <span className="host-header__count">
              {room.players.length} {room.players.length === 1 ? "PLAYER" : "PLAYERS"} · {ready} READY
            </span>
            <HostExit
              label={teamsEnabled(room.settings) ? "Back to teams" : "Back to room"}
              onClick={() => roomStore.send({ type: "backToLobby" })}
            />
          </HostHeaderRight>
        }
      />

      <div className="host-stage">
        <div className="host-creating__plaque-wrapper">
          <p className="plaque host-creating__plaque">WRITE YOUR CATEGORIES</p>
          {useWall && (
            <span className="host-creating__count">
              {written} / {slotCount} WRITTEN
            </span>
          )}
        </div>

        {useWall ? (
          <div className="host-creating__wall">
            {room.players.map((player, playerIdx) => {
              const states = room.slotStates[player.id] ?? [];
              return states.map((state, slotIdx) => (
                <div key={`${player.id}-${slotIdx}`} className="host-creating__cell">
                  <CreatingSlot state={state} index={playerIdx * quota + slotIdx} />
                  <MiniPill player={player} state={state} />
                </div>
              ));
            })}
          </div>
        ) : (
          <div className="host-creating__columns">
            {room.players.map((player) => {
              const states = room.slotStates[player.id] ?? [];
              return (
                <div key={player.id} className="host-creating__column">
                  <PlayerPill player={player} variant="lobby" />
                  <div className="host-creating__slots">
                    {states.map((state, slotIdx) => (
                      <CreatingSlot key={slotIdx} state={state} index={slotIdx} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="timer-bar" style={{ height: "106px" }}>
        <span className="timer-bar__num">{formatClock(remaining)}</span>
        <span className="timer-track">
          <span
            className="timer-track__fill"
            style={{ width: `${Math.min(100, (remaining / (WRITE_MS / 1000)) * 100)}%` }}
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

/**
 * A single slot rendered on the TV. Three states: empty (no shadow, dimmed),
 * writing (teal dots), done (gold stamp). Never shows the text.
 */
function CreatingSlot({ state, index }: { state: "empty" | "writing" | "done"; index?: number }) {
  if (state === "done") {
    // Alternate between A and B based on index to restart the animation on
    // consecutive stamps. Use modulo to bounce between 0 and 1.
    const landIdx = (index ?? 0) % 2;
    return (
      <div
        className="slot-state slot-state--done"
        style={{ "--card-land-idx": landIdx } as CSSProperties}
      >
        <span className="slot-state__stamp">DONE</span>
      </div>
    );
  }

  if (state === "writing") {
    return (
      <div className="slot-state slot-state--writing">
        <span className="slot-state__dot" />
        <span className="slot-state__dot" />
        <span className="slot-state__dot" />
      </div>
    );
  }

  // state === "empty"
  return <div className="slot-state slot-state--empty" />;
}

/**
 * A mini player pill pinned inside a wall cell. Takes the pill's own ready/waiting
 * fills. Only appears in Layout B (the wall).
 */
function MiniPill({ player, state }: { player: { id: string; emoji: string; name: string; ready: boolean; connected: boolean }; state: "empty" | "writing" | "done" }) {
  const classes = ["mini-pill"];
  if (state === "done") {
    classes.push("mini-pill--ready");
  } else {
    classes.push("mini-pill--waiting");
  }
  if (!player.connected) classes.push("mini-pill--offline");

  return (
    <div className={classes.join(" ")}>
      <span className="mini-pill__avatar">{player.emoji}</span>
      <span className="mini-pill__name">{player.name || "…"}</span>
    </div>
  );
}
