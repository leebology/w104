import { useEffect, useState } from "react";
import { prefersReducedMotion } from "./reveal";
import { roomStore } from "./net/room";

/**
 * The creating -> voting beat, both surfaces, one clock. See
 * docs/design/2026-07-30-custom-categories-brief.md §1c.
 *
 * `closeCreating` opens `voting` with no countdown phase in between — its own
 * comment in shared/reduce.ts says why: "the transition between the two
 * screens is an animation, not a phase." So there is no dedicated timestamp
 * marking when the beat started; every client reconstructs it as
 * `phase.endsAt - VOTING_MS` (the one thing the room already broadcasts) and
 * hands the same reconstructed instant in here — `HostVotingCustom` and
 * `PlayerVotingCustom` each do this once, from their own `room.phase.endsAt`,
 * so the two surfaces never quote a different zero.
 */

/**
 * Nominal length quoted in the brief's title. Gates the handoff from the
 * outgoing "creating" furniture to the incoming board/hand — the board's own
 * wipe-in stagger and the hand's own deal-in can run a little past it for a
 * big pool, the same way the scoring reveal's schedule can run past
 * `dealMs`.
 */
export const TRANSITION_MS = 1120;

/** Every timing constant off §1c's table, one place so the host and the
    phone never quote a different number for the same beat. */
export const TIMING = {
  pillLeaveStart: 80,
  pillLeaveDur: 240,
  pillLeaveStagger: 24,
  flipStart: 80,
  flipDur: 540,
  flipStagger: 26,
  deckShrinkStart: 880,
  deckShrinkDur: 160,
  crossfadeAt: 880,
  crossfadeDur: 180,
  boardWipeStart: 1060,
  boardWipeDur: 180,
  boardWipeStagger: 60,
  timerRefillStart: 1060,
  timerRefillDur: 260,
  phoneLeaveStart: 80,
  phoneLeaveDur: 240,
  handDealStart: 1060,
  handDealStagger: 80,
  handDealDur: 320,
} as const;

/** Deck gone (880 + 160), board can take over — the host and phone handoff
    point from the outgoing "creating" furniture to the incoming screen. */
export const HANDOFF_MS = TIMING.deckShrinkStart + TIMING.deckShrinkDur;

export type CreatingTransition = {
  /** True while the outgoing "creating" furniture should still be on
      screen. False from mount when there is nothing to show it from (no
      cached snapshot — see `HostView`/`PlayerView`), when reduced motion is
      on, or when this client is joining after the handoff has already
      passed. Never true again once it goes false. */
  showLeaving: boolean;
  /** `prefers-reduced-motion: reduce`, read once at mount — the same
      precedent `HostScoring`/`HostVotingCustomClosed` set for a one-shot
      reveal: a host who changes the OS setting mid-beat is not a case worth
      a live subscription. */
  reduced: boolean;
  /** Milliseconds since `voting` opened, at the moment this component tree
      mounted. Captured once, not ticked. Every CSS delay in this feature is
      computed from it once, including a delay that comes out negative for a
      client that mounted partway through (or entirely past) the beat — the
      animation then starts already resolved into the browser's own
      timeline, which is "land where the clock says", not a replay. */
  elapsedAtMount: number;
  /** `targetMs - elapsedAtMount`, as a CSS time. Negative once `targetMs`
      has already passed at mount — valid CSS, and exactly what a late-
      joining or reloaded client needs: the animation resolves to its end
      state immediately instead of playing from the start. */
  delay: (targetMs: number) => string;
};

/**
 * `votingOpenedAt` is `phase.endsAt - VOTING_MS`, reconstructed by the
 * caller (there is no separate field for it — see the module comment).
 * `hasSnapshot` is whether this client actually has the outgoing furniture
 * to show (a cached last-`creating` `RoomState` on the host, `state.drafts`
 * on the phone); without one there is nothing correct to leave *from*, so
 * `showLeaving` is false from the first frame rather than showing an empty
 * board or fabricated cards.
 */
export function useCreatingTransition(
  votingOpenedAt: number,
  hasSnapshot: boolean,
): CreatingTransition {
  const [reduced] = useState(prefersReducedMotion);
  const [elapsedAtMount] = useState(() =>
    Math.max(0, roomStore.now() - votingOpenedAt),
  );
  const eligible = !reduced && hasSnapshot && elapsedAtMount < HANDOFF_MS;
  const [showLeaving, setShowLeaving] = useState(eligible);

  useEffect(() => {
    if (!eligible) return;
    const id = setTimeout(() => setShowLeaving(false), HANDOFF_MS - elapsedAtMount);
    return () => clearTimeout(id);
    // `eligible`/`elapsedAtMount` are captured once at mount (see the
    // `useState` initializers above) and never change for this component's
    // life, so there is exactly one timer to arm.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    showLeaving: eligible && showLeaving,
    reduced,
    elapsedAtMount,
    delay: (targetMs: number) => `${targetMs - elapsedAtMount}ms`,
  };
}
