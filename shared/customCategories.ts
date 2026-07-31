import type { PlayerId } from "./state";
import { seededRng } from "./rng";
import type { Rng } from "./rng";

/**
 * A player-written category pool. Every rule lives here so it tests in
 * milliseconds; `party/server.ts` only sequences these calls.
 *
 * See docs/superpowers/specs/2026-07-30-custom-categories-design.md.
 */

/** Cards dealt per hand. Fixed by the phone layout. */
export const HAND_SIZE = 3;

/**
 * Votes each player gets, at every room size. **Not a preference.**
 *
 * Equal exposure (see `buildDeal`) requires the quota to divide
 * `HAND_SIZE * VOTE_BUDGET`. The quota ranges over 1..MAX_QUOTA, and 12 is the
 * smallest number all four divide — so 4 is the only fixed vote count that is
 * exact at every pool shape. Six breaks at a quota of 4; five works at 1 and 3
 * and nowhere else.
 */
export const VOTE_BUDGET = 4;

/**
 * The writing ceiling. Five was considered and rejected: 5 does not divide 12,
 * so it is the one quota that cannot deliver exact exposure. The cost is
 * confined to a 3-player 10-round match, which builds a 12-card pool for 10
 * rounds instead of 15.
 */
export const MAX_QUOTA = 4;

/**
 * The pool is half again the round count. Smaller and every category plays,
 * which makes the vote decide nothing but running order; larger and the
 * writing load stops being worth a phone keyboard.
 */
export const POOL_EXCESS = 1.5;

/** At or below this many players the rules bend — see `quotaFor`. */
export const TINY_ROOM = 2;

/** The writing window. A constant, not a setting: `durationSec` is the round. */
export const WRITE_MS = 60_000;

/** Characters a player may type into one category. */
export const MAX_CATEGORY_LEN = 20;

/** What a creation slot is showing on the TV. Never the text. */
export type SlotState = "empty" | "writing" | "done";

export type PoolCard = {
  /**
   * Opaque and shuffled at construction, deliberately: a positional id would
   * name the seat it came from, and the pool ships to every client during
   * voting. Stable through voting, the draw and the reveal.
   */
  id: string;
  text: string;
  /** `null` for a house card. Withheld from clients until the phase closes. */
  authorId: PlayerId | null;
  /** Which of the author's slots this came from. */
  slot: number;
};

export type Hand = { cardIds: string[] };

/**
 * Cards each player writes: enough to make a pool worth voting on, and enough
 * to cover the match, capped so the writing stays short.
 *
 * The band is the floor that keeps a 3-player one-round match from voting on a
 * pool of three. Round coverage is the other half, and it is what makes a long
 * match ask for more writing rather than shortening itself.
 *
 * One- and two-player rooms bend both rules: exact coverage, no excess and no
 * ceiling, with a floor of three cards because a hand is three distinct cards
 * and a solo host on a one-round match would otherwise build a pool of one.
 */
export function quotaFor(playerCount: number, roundCount: number): number {
  const players = Math.max(1, Math.floor(playerCount));
  const rounds = Math.max(1, Math.floor(roundCount));
  if (players <= TINY_ROOM) {
    return Math.max(Math.ceil(rounds / players), Math.ceil(HAND_SIZE / players));
  }
  const band = players <= 4 ? 3 : players <= 7 ? 2 : 1;
  const covering = Math.ceil((POOL_EXCESS * rounds) / players);
  return Math.min(MAX_QUOTA, Math.max(band, covering));
}

/**
 * A function rather than the bare constant so both counters read the same
 * thing — the TV prompt and the phone's pips. Do not inline `VOTE_BUDGET` at
 * either call site.
 */
export function voteBudgetFor(): number {
  return VOTE_BUDGET;
}

/**
 * How many hands every card appears in, room-wide. Exact, not ±1.
 *
 * Total dealt slots are `players * VOTE_BUDGET * HAND_SIZE` over a pool of
 * `players * quota`, so the player count cancels and this is `12 / quota`.
 */
export function exposureFor(quota: number): number {
  return (HAND_SIZE * VOTE_BUDGET) / quota;
}

/** Fisher-Yates on a copy. The one shuffle helper this module uses. */
function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * One card per slot, in seat-major order — `pool[seat * quota + slot]`.
 * `buildDeal` relies on that layout to know which seat a card came from
 * without the card having to carry it.
 *
 * **House cards do not exist before this call.** A blank slot becomes one
 * here and nowhere earlier: the creation TV must never render one, because a
 * house card appearing while people are still writing says "nobody wrote
 * this" about a slot somebody may still be filling.
 *
 * House texts are dealt from a shuffled copy of the stock list and cycle if
 * there are more blanks than categories. A repeat is legal — identical texts
 * are separate cards through voting by design.
 *
 * Ids are assigned through a shuffle so they carry no seat information: the
 * pool ships to every client during voting, and a positional id would hand
 * them authorship for free.
 */
export function buildPool(
  playerIds: readonly PlayerId[],
  drafts: Record<PlayerId, string[]>,
  quota: number,
  houseTexts: readonly string[],
  roll: number,
): PoolCard[] {
  const rng = seededRng(`pool:${roll}`);
  const size = playerIds.length * quota;
  const house = houseTexts.length > 0 ? shuffled(houseTexts, rng) : ["category"];
  const ids = shuffled(
    Array.from({ length: size }, (_, i) => `c${i}`),
    rng,
  );

  const out: PoolCard[] = [];
  let houseNext = 0;
  playerIds.forEach((playerId, seat) => {
    const mine = drafts[playerId] ?? [];
    for (let slot = 0; slot < quota; slot++) {
      const typed = (mine[slot] ?? "").trim().slice(0, MAX_CATEGORY_LEN);
      const blank = typed === "";
      out.push({
        id: ids[seat * quota + slot],
        text: blank ? house[houseNext++ % house.length] : typed,
        authorId: blank ? null : playerId,
        slot,
      });
    }
  });
  return out;
}

/**
 * The client's copy. Sorted by id — which is random with respect to seats —
 * so the wire order leaks nothing, and stripped of authorship until the phase
 * closes.
 *
 * Authorship is withheld from *everyone*, not just from non-authors: it is the
 * one reveal this feature exists for, and a client that had it early could
 * render it early.
 */
export function publicPool(
  pool: readonly PoolCard[],
  revealAuthors: boolean,
): PoolCard[] {
  return [...pool]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((c) => (revealAuthors ? { ...c } : { ...c, authorId: null }));
}
