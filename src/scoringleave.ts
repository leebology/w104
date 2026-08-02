/**
 * The scoring -> standings beat: the round's cards wipe off the left edge, the
 * standings rise from the bottom.
 *
 * Like the creating -> voting transition (`src/transition.ts`), this is an
 * animation and not a phase — `bankRound` moves the room straight from
 * `scoring` to `standings`. Unlike that one it has **no timestamp to hang
 * off**: `standings` is untimed, so there is no broadcast instant every client
 * could reconstruct the beat's zero from. It is therefore local to the host
 * that watched the change happen, driven from the render in which the phase
 * flipped (`HostView`), and a client that arrives on `standings` some other way
 * — a refresh, a view jump, a reconnect — simply gets the settled board. There
 * is nothing to be out of step with: no phone plays this, and the beat is over
 * before anything else can happen in the room.
 *
 * The two halves overlap by design. The board starts rising while the last
 * couple of cards are still travelling, which is what keeps this reading as one
 * movement rather than as two animations queued back to back.
 */

/** One card's journey off the edge. */
export const LEAVE_CARD_MS = 620;
/** Per column, in *rank* order — see `--leave-rank` in `HostScoring`. */
export const LEAVE_STAGGER = 46;

/**
 * How long the outgoing scoring screen stays mounted, worst case.
 *
 * Ten columns, which is the results grid's design limit rather than
 * `MAX_PLAYERS` — the cap is 30 now and the grid balances a room that size
 * into fifteen columns. Deliberately not raised with the cap: this figure only
 * holds an empty transparent layer over the arriving standings, so being short
 * on a crowded board costs the last few cards their tail and being long costs
 * every board an extra second of dead overlay. Ten is where the stagger was
 * tuned and where all but the biggest rooms sit.
 *
 * A smaller room finishes early and simply holds that layer for the remainder —
 * cheaper than measuring, and invisible either way.
 */
export const LEAVE_MS = LEAVE_CARD_MS + 9 * LEAVE_STAGGER;

/**
 * When the board starts arriving.
 *
 * Late enough that the room has watched the round actually go — the first
 * version started it at 380ms, with the wipe still most of the way through, and
 * the two halves read as one crowded shuffle rather than as a hand-off. The
 * last card is still travelling when the first row starts up, which is the
 * overlap worth keeping; what is gone is the standings appearing before the
 * results have.
 */
export const ENTER_START_MS = 760;
export const ENTER_ROW_MS = 640;
export const ENTER_STAGGER = 60;

/**
 * The entrance timings as CSS custom properties, for the board that is
 * arriving.
 *
 * Handed to the stylesheet rather than written into it twice: the keyframes and
 * the curve are CSS's business, but *when* is this module's, and a duration
 * living in both places is one that drifts. Both boards — the between-rounds
 * list and the final podium — set the same pair, so they cannot fall out of
 * step with each other either.
 */
export const enterVars = {
  "--enter-start": `${ENTER_START_MS}ms`,
  "--enter-stagger": `${ENTER_STAGGER}ms`,
  "--enter-dur": `${ENTER_ROW_MS}ms`,
} as const;
