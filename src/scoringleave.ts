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
export const LEAVE_CARD_MS = 440;
/** Per column, in *rank* order — see `--leave-rank` in `HostScoring`. */
export const LEAVE_STAGGER = 32;

/**
 * How long the outgoing scoring screen stays mounted, worst case.
 *
 * Ten columns is `MAX_PLAYERS`, so this covers the widest board the game can
 * make. A smaller room finishes early and simply holds an empty transparent
 * layer for the remainder — cheaper than measuring, and invisible either way.
 */
export const LEAVE_MS = LEAVE_CARD_MS + 9 * LEAVE_STAGGER;

/** When the board starts arriving — before the last card is gone, on purpose. */
export const ENTER_START_MS = 380;
export const ENTER_ROW_MS = 560;
export const ENTER_STAGGER = 45;
