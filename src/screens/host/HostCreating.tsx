import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { formatClock, useRemaining } from "../../net/clock";
import { quotaOfRoom, writersOf } from "../../../shared/customCategories";
import type { SlotState } from "../../../shared/customCategories";
import { teamsEnabled } from "../../../shared/teams";
import { isWaiting } from "../../../shared/bots";
import type { Player, RoomState } from "../../../shared/state";
import { WRITE_MS } from "../../../shared/customCategories";
import { RoomChip } from "../../components/RoomChip";
import { PlayerPill } from "../../components/Roster";
import { roomStore } from "../../net/room";
import { parity } from "../../reveal";
import { TIMING } from "../../transition";
import { HostExit, HostHeader, HostHeaderRight } from "./HostHeader";

type Props = {
  room: RoomState;
  /** `state.clockOffset` — needed so the timer counts down against the same
      clock as everything else. */
  offset: number;
};

/**
 * The layout decision every render of the creation board (live or a cached
 * leave-overlay snapshot, see `CreatingLeaveBoard`) needs: columns vs. the
 * wall, and — only for the wall — how many columns and whether its cells are
 * cramped enough to drop the mini pill's name. Pulled out of the component
 * body so both callers compute it identically from the same `RoomState`
 * shape rather than keeping two copies of the same arithmetic in sync.
 */
export function creatingLayout(room: RoomState) {
  const writers = writersOf(room.players);
  const quota = quotaOfRoom(room);
  const slotCount = writers.length * quota;

  // Slot count, not player count: the constraint is horizontal, and only column
  // count can break it. Five authors × 3 cards is 15 slots and still fits as
  // columns; 13 authors × 1 does not. The quota arm is the third trip — a column
  // of four 96px slots does not fit a 720p stage.
  const useWall = writers.length > 12 || slotCount > 15 || quota >= 4;

  // Wall columns escalate with slot count (§1b): 6 up to 24 slots, 7 to 35, 8
  // to 48. The plan's flat `repeat(6, 1fr)` was superseded by the brief.
  const wallCols = slotCount <= 24 ? 6 : slotCount <= 35 ? 7 : 8;

  // Whether the wall's cells are cramped enough that the mini pill should drop
  // to the avatar alone (§1b: "Below ~64px of cell height…"). Arithmetic
  // against the design's reference 1280×720 stage, not a live measurement —
  // the same footing `useWall` and `quotaFor` already stand on. The chrome
  // budget is the header (~84px) and the timer bar (106px); the plaque band
  // is no longer flow space (it is pinned over the wall, see
  // `.host-creating__plaque-wrapper`), so its clearance is spent as the
  // wall's own 96px top / 24px bottom padding instead, and 12px row gaps come
  // off what is left.
  const wallRows = Math.ceil(slotCount / wallCols);
  const wallAvailableHeight = 720 - 84 - 106 - 120;
  const wallCellHeight = (wallAvailableHeight - (wallRows - 1) * 12) / wallRows;
  const smallWallCells = wallCellHeight < 64;

  return { quota, slotCount, useWall, wallCols, smallWallCells };
}

/**
 * The host's view of the writing phase. Progress only, never content —
 * the creation TV shows `slotStates`, never draft text. Three signals per slot:
 * the paper says *reached*, the shadow says *lifted*, the stamp-vs-dots says
 * *finished or in flight*.
 */
export function HostCreating({ room, offset }: Props) {
  const remaining = useRemaining(room.phase.name === "creating" ? room.phase.endsAt : 0, offset, room.paused);
  const { slotCount, useWall, wallCols, smallWallCells } = creatingLayout(room);
  // The people actually writing. Somebody who walked in after the match started
  // owns no slots — the quota is computed without them — so a column of theirs
  // would be a column that can never fill, and the "n PLAYERS · r READY" beside
  // it would never reach its own total. They are named in the header strip
  // instead, which is where the waiting room belongs.
  const writers = writersOf(room.players);

  // Count how many slots are done (for the plaque subtitle on Layout B)
  let written = 0;
  for (const playerId of writers.map((p) => p.id)) {
    const states = room.slotStates[playerId] ?? [];
    written += states.filter((s) => s === "done").length;
  }

  const ready = writers.filter((p) => p.connected && p.ready).length;

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
        left={<RoomChip room={room} />}
        right={
          <HostHeaderRight>
            <span className="host-header__count">
              {writers.length} {writers.length === 1 ? "PLAYER" : "PLAYERS"} · {ready} READY
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
            {writers.map((player) => {
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
            {writers.map((player) => {
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
 *
 * Exported for `CreatingLeaveBoard`, the transition's leave overlay — it
 * renders the same three states from a cached snapshot rather than the live
 * room.
 */
export function CreatingSlot({
  state,
  land,
  frozen,
}: {
  state: SlotState;
  /** Which of the `cardLandA`/`cardLandB` pair to play — see `landClassFor`. */
  land?: "a" | "b";
  /** The leave overlay's done slots: already landed before this component
      ever mounted (they are a cached snapshot, not a live arrival), so the
      bounce-in `cardLandA`/`cardLandB` must not replay. `--static` skips it
      and holds the stamp at its resting frame instead. */
  frozen?: boolean;
}) {
  if (state === "done") {
    return (
      <div className="slot-state slot-state--done">
        <span
          className={
            frozen
              ? "slot-state__stamp slot-state__stamp--static"
              : `slot-state__stamp slot-state__stamp--${land ?? "a"}`
          }
        >
          DONE
        </span>
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
export function MiniPill({ player, avatarOnly }: { player: Player; avatarOnly: boolean }) {
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

/**
 * The first four rotations off §1c's own table; past them nothing in the
 * brief is numeric, so the pattern is extended algorithmically rather than
 * guessed per card: alternate sign, and halve the amplitude every second
 * card at the same ~0.6 ratio the given four already step down by (4.5/7 ≈
 * 0.64, 2.5/4.5 ≈ 0.56, 1.5/2.5 = 0.6) — a card stack that keeps fanning out
 * rather than snapping flat. Named for what it is; not claimed to be the
 * design's own numbers past index 3.
 */
function deckRotation(i: number): number {
  const given = [-7, 4.5, -2.5, 1.5];
  if (i < given.length) return given[i];
  const pair = Math.floor(i / 2);
  const sign = i % 2 === 0 ? -1 : 1;
  return sign * 7 * Math.pow(0.6, pair);
}

/**
 * The transition's leave overlay (§1c, host rows 1-2): the room's pills fade
 * first, then every finished slot FLIPs into a deck at stage centre. Renders
 * from a *cached* `creating`-phase snapshot — the real `HostCreating` has
 * already unmounted by the time this exists (`closeCreating` moves straight
 * to `voting`, no countdown in between), so nothing here reads off the live
 * room. See `HostView`'s `lastCreatingRoom` ref for where the snapshot comes
 * from, and `docs/design/2026-07-30-custom-categories-brief.md` §1c for the
 * table this follows.
 *
 * The plaque and header are not this component's business — they crossfade
 * into the voting screen's own prompt/count on the same clock, but from
 * `HostVotingCustom`, which owns both the outgoing and incoming copy.
 *
 * The FLIP is measured, not calculated — the scoring reveal's frame-3 swap is
 * this repo's precedent for exactly that: `getBoundingClientRect` is read
 * once, at mount, for every done slot and for the stage itself, and the
 * delta becomes a CSS custom property the keyframe reads. That is what lets
 * the same markup serve a three-player room and a 24-player wall without
 * duplicating either's geometry here.
 */
export function CreatingLeaveBoard({
  room,
  delay,
}: {
  /** A cached `creating`-phase snapshot — see `HostView.lastCreatingRoom`. */
  room: RoomState;
  delay: (targetMs: number) => string;
}) {
  const { useWall, wallCols, smallWallCells } = creatingLayout(room);
  // The same set the board was drawn from, so the leave animation takes away
  // exactly the columns that were there — see `HostCreating`.
  const writers = writersOf(room.players);

  const stageRef = useRef<HTMLDivElement>(null);
  const doneEls = useRef<(HTMLDivElement | null)[]>([]);
  const [flips, setFlips] = useState<Array<{ dx: number; dy: number } | null>>([]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const stageRect = stage.getBoundingClientRect();
    const cx = stageRect.left + stageRect.width / 2;
    const cy = stageRect.top + stageRect.height / 2;
    setFlips(
      doneEls.current.map((el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { dx: cx - (r.left + r.width / 2), dy: cy - (r.top + r.height / 2) };
      }),
    );
    // Measured once: `room` is a frozen snapshot that never re-renders with
    // new data, so there is nothing to re-measure on a later pass.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Assigns every *done* slot a ref slot and a FLIP delay, in DOM order —
  // the same order the room's columns/wall already render them, so the
  // stagger reads left-to-right, top-to-bottom the way the room watched them
  // land. A plain closure variable, not a ref: this component's `room` prop
  // is frozen, so there is exactly one render pass that matters and nothing
  // to preserve across re-renders.
  let doneIndex = -1;
  function doneSlot(key: string) {
    doneIndex += 1;
    const i = doneIndex;
    const flip = flips[i];
    // Slots past the top six fade out during their own travel rather than
    // joining the visible deck (§1c) — `creating-leave__flip--fade` swaps in
    // the fading keyframe for them.
    const fading = i >= 6;
    const style: CSSProperties = flip
      ? ({
          "--flip-dx": `${flip.dx}px`,
          "--flip-dy": `${flip.dy}px`,
          "--flip-rot": `${deckRotation(i)}deg`,
          animationDelay: delay(TIMING.flipStart + i * TIMING.flipStagger),
        } as CSSProperties)
      : // No measurement yet (the very first paint, before the layout effect
        // runs) — hidden rather than flashing at its pre-FLIP position.
        { visibility: "hidden" };
    return (
      <div
        key={key}
        className={fading ? "creating-leave__flip creating-leave__flip--fade" : "creating-leave__flip"}
        style={style}
        ref={(el) => {
          doneEls.current[i] = el;
        }}
      >
        <CreatingSlot state="done" frozen />
      </div>
    );
  }

  // The people leave first (§1c row 1): every pill, and every slot that
  // never finished, fades on the same beat as its author's pill — a column
  // or a wall cell leaves together, staggered by *player*, not by slot.
  const leaveStyle = (playerIndex: number): CSSProperties => ({
    animationDelay: delay(TIMING.pillLeaveStart + playerIndex * TIMING.pillLeaveStagger),
  });

  return (
    <div className="host-stage" ref={stageRef}>
      {useWall ? (
        <div className="host-creating__wall" style={{ "--wall-cols": wallCols } as CSSProperties}>
          {writers.map((player, playerIndex) => {
            const states = room.slotStates[player.id] ?? [];
            return states.map((state, slotIdx) => (
              <div key={`${player.id}-${slotIdx}`} className="host-creating__cell">
                {state === "done" ? (
                  doneSlot(`${player.id}-${slotIdx}`)
                ) : (
                  <div className="creating-leave__fade" style={leaveStyle(playerIndex)}>
                    <CreatingSlot state={state} />
                  </div>
                )}
                <div className="creating-leave__fade" style={leaveStyle(playerIndex)}>
                  <MiniPill player={player} avatarOnly={smallWallCells} />
                </div>
              </div>
            ));
          })}
        </div>
      ) : (
        <div className="host-creating__columns">
          {writers.map((player, playerIndex) => {
            const states = room.slotStates[player.id] ?? [];
            return (
              <div key={player.id} className="host-creating__column">
                <div className="creating-leave__fade" style={leaveStyle(playerIndex)}>
                  <PlayerPill player={player} variant="creating" />
                </div>
                <div className="host-creating__slots">
                  {states.map((state, slotIdx) =>
                    state === "done" ? (
                      doneSlot(`${player.id}-${slotIdx}`)
                    ) : (
                      <div key={slotIdx} className="creating-leave__fade" style={leaveStyle(playerIndex)}>
                        <CreatingSlot state={state} />
                      </div>
                    ),
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
