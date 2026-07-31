import { useRef } from "react";
import type { CSSProperties } from "react";
import { formatClock, useRemaining } from "../../net/clock";
import { quotaFor } from "../../../shared/customCategories";
import { teamsEnabled } from "../../../shared/teams";
import { isWaiting } from "../../../shared/bots";
import type { Player, RoomState } from "../../../shared/state";
import { WRITE_MS } from "../../../shared/customCategories";
import { RoomChip } from "../../components/RoomChip";
import { PlayerPill } from "../../components/Roster";
import { roomStore } from "../../net/room";
import { parity } from "../../reveal";
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

  // Wall columns escalate with slot count (§1b): 6 up to 24 slots, 7 to 35, 8
  // to 48. The plan's flat `repeat(6, 1fr)` was superseded by the brief.
  const wallCols = slotCount <= 24 ? 6 : slotCount <= 35 ? 7 : 8;

  // Whether the wall's cells are cramped enough that the mini pill should drop
  // to the avatar alone (§1b: "Below ~64px of cell height…"). Arithmetic
  // against the design's reference 1280×720 stage, not a live measurement —
  // the same footing `useWall` and `quotaFor` already stand on. The chrome
  // budget is the header (~84px), the plaque + counter band (~70px) and the
  // timer bar (106px); the wall's own 24px top/bottom padding and 12px row
  // gaps come off what is left.
  const wallRows = Math.ceil(slotCount / wallCols);
  const wallAvailableHeight = 720 - 84 - 70 - 106 - 48;
  const wallCellHeight = (wallAvailableHeight - (wallRows - 1) * 12) / wallRows;
  const smallWallCells = wallCellHeight < 64;

  // Count how many slots are done (for the plaque subtitle on Layout B)
  let written = 0;
  for (const playerId of room.players.map((p) => p.id)) {
    const states = room.slotStates[playerId] ?? [];
    written += states.filter((s) => s === "done").length;
  }

  const ready = room.players.filter((p) => p.connected && p.ready).length;

  // The cardLandA/cardLandB alternation, frozen the moment a slot is first
  // seen as "done" and never recomputed after — an already-stamped slot must
  // not replay just because a later slot finishes elsewhere. Mirrors the
  // reveal's `parity(ordinal)`: what has to vary is an ordinal that increments
  // on each occurrence, never a fixed per-slot index, or the class string
  // never changes and the animation never restarts. Keyed by player id + slot
  // index, which is stable for a slot's whole life in this phase.
  const landOrdinals = useRef(new Map<string, number>());
  const nextLandOrdinal = useRef(0);
  function landClassFor(slotKey: string, state: "empty" | "writing" | "done"): "a" | "b" | undefined {
    if (state !== "done") return undefined;
    let ordinal = landOrdinals.current.get(slotKey);
    if (ordinal === undefined) {
      ordinal = nextLandOrdinal.current++;
      landOrdinals.current.set(slotKey, ordinal);
    }
    return parity(ordinal);
  }

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
          <div className="host-creating__wall" style={{ "--wall-cols": wallCols } as CSSProperties}>
            {room.players.map((player) => {
              const states = room.slotStates[player.id] ?? [];
              return states.map((state, slotIdx) => (
                <div key={`${player.id}-${slotIdx}`} className="host-creating__cell">
                  <CreatingSlot state={state} land={landClassFor(`${player.id}:${slotIdx}`, state)} />
                  <MiniPill player={player} avatarOnly={smallWallCells} />
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
                  <PlayerPill player={player} variant="creating" />
                  <div className="host-creating__slots">
                    {states.map((state, slotIdx) => (
                      <CreatingSlot
                        key={slotIdx}
                        state={state}
                        land={landClassFor(`${player.id}:${slotIdx}`, state)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="timer-bar host-creating__timer">
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
function CreatingSlot({
  state,
  land,
}: {
  state: "empty" | "writing" | "done";
  /** Which of the `cardLandA`/`cardLandB` pair to play — see `landClassFor`. */
  land?: "a" | "b";
}) {
  if (state === "done") {
    return (
      <div className="slot-state slot-state--done">
        <span className={`slot-state__stamp slot-state__stamp--${land ?? "a"}`}>DONE</span>
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
 * A mini player pill pinned inside a wall cell. Takes the pill's own two
 * states — gold when the *author* has finished every one of their slots,
 * `--code-empty` while any remain — not the state of the one cell it sits in,
 * or an author with one of three slots done would read as gold on that cell
 * and grey on the rest. `isWaiting` is the same predicate `PlayerPill` and
 * `everyoneReady` use, so a debug bot reads as done here too. Only appears in
 * Layout B (the wall).
 */
function MiniPill({ player, avatarOnly }: { player: Player; avatarOnly: boolean }) {
  const classes = ["mini-pill"];
  const done = isWaiting(player);
  classes.push(done ? "mini-pill--ready" : "mini-pill--waiting");
  if (!player.connected) classes.push("mini-pill--offline");

  return (
    <div className={classes.join(" ")}>
      <span className="mini-pill__avatar">{player.emoji}</span>
      {!avatarOnly && <span className="mini-pill__name">{player.name || "…"}</span>}
    </div>
  );
}
