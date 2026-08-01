import type { MatchSettings, Player, PlayerId } from "./state";
import { seatedPlayers } from "./waiting";
import { seededRng } from "./rng";
import type { Rng } from "./rng";
import { tallyVotes } from "./voting";
import type { VoteMap } from "./voting";
import { voteShares } from "./voting";
import { weightedPick } from "./voting";

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
 * Who writes this match's pool: everyone seated, never the waiting room.
 *
 * A latecomer is not writing — `writeSlot` refuses them — and they are not in
 * the deal, so they are not one of the `P` the arithmetic above is about. It is
 * a function rather than a filter repeated at five call sites because **the
 * server and every screen must agree on it exactly**: the quota decides how
 * many slots a phone draws and how many the server will accept, and a phone
 * counting one more person than the server does draws a slot that cannot be
 * written. See `quotaOfRoom`.
 */
export function writersOf(players: readonly Player[]): Player[] {
  return seatedPlayers([...players]);
}

/**
 * This room's quota. **The only way to ask** — the server's `quotaOf` and the
 * three screens that size themselves to it all come through here, so there is
 * one answer rather than four that agree until somebody walks in mid-phase.
 *
 * A subset type, so it works on a server-side `Room` and a client-side
 * `RoomState` alike.
 */
export function quotaOfRoom(view: {
  players: Player[];
  settings: Pick<MatchSettings, "roundCount">;
}): number {
  return quotaFor(writersOf(view.players).length, view.settings.roundCount);
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

/**
 * A roll for a close that has no `tick` behind it.
 *
 * `settle` runs off ordinary events, none of which carry the `roll` the tick
 * path supplies — but the pool and the deal must not fall back to a fixed
 * seed, because both shuffles exist to keep authorship unreadable and a
 * constant seed makes them computable offline. The room code and the close
 * timestamp are both already to hand, neither is client-controlled, and
 * together they differ for every close.
 *
 * Pure: both inputs are passed in, so `reduce` stays a pure function.
 */
export function seedRoll(code: string, now: number): number {
  const rng = seededRng(`close:${code}:${now}`);
  return rng();
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

/**
 * Splits one player's dealt cards into hands.
 *
 * Greedy on remaining count, so a card that has to appear twice is placed
 * while there are still hands left to place it in, with ties broken by the rng
 * — that tie-break is what stops two hands coming out as the same three cards
 * in a small room, which the obvious round-robin does constantly.
 *
 * The `!hand.includes` filter is the no-duplicate-within-a-hand rule and is
 * the only filter in this file. It cannot break exposure: it rearranges a
 * multiset that `buildDeal` has already fixed.
 */
function toHands(cardIds: readonly string[], rng: Rng): Hand[] {
  const remaining = new Map<string, number>();
  for (const id of cardIds) remaining.set(id, (remaining.get(id) ?? 0) + 1);

  const hands: Hand[] = [];
  for (let h = 0; h < VOTE_BUDGET; h++) {
    const hand: string[] = [];
    for (let i = 0; i < HAND_SIZE; i++) {
      const candidates = [...remaining.entries()].filter(
        ([id, n]) => n > 0 && !hand.includes(id),
      );
      if (candidates.length === 0) break;
      const most = Math.max(...candidates.map(([, n]) => n));
      const top = candidates.filter(([, n]) => n === most);
      const [id] = top[Math.floor(rng() * top.length)];
      hand.push(id);
      remaining.set(id, (remaining.get(id) ?? 0) - 1);
    }
    hands.push({ cardIds: hand });
  }
  return hands;
}

/**
 * Who sees what. Solved in one shot at the close, never sampled per hand.
 *
 * The construction is a walk around a ring of seats, one slot at a time. Seat
 * `k` takes, from every slot, the cards sitting at ring offsets `1, 2, …`
 * cycled — never offset 0, which is what "never your own card" is, and cycling
 * is what lets a room with fewer non-own cards than dealt slots still fill
 * them. Because every seat walks the *same* multiset of offsets, every card is
 * taken exactly as many times as every other: exposure is exact by
 * construction rather than by correction.
 *
 * **The ring is a shuffled seat order, and that matters.** The walk is
 * deterministic, so an unshuffled ring would make every hand "one card from
 * each of the next three seats" and hand authorship to anyone who noticed.
 *
 * One- and two-player rooms cannot satisfy any of this — there is nobody
 * else's card to deal — so they fall back to a cyclic walk of the whole pool
 * with own cards included. They are exempt from exact exposure by design; see
 * the spec's §3.4.
 */
export function buildDeal(
  pool: readonly PoolCard[],
  playerIds: readonly PlayerId[],
  quota: number,
  roll: number,
): Record<PlayerId, Hand[]> {
  const out: Record<PlayerId, Hand[]> = {};
  const players = playerIds.length;
  if (players === 0 || pool.length === 0) return out;

  const rng = seededRng(`deal:${roll}`);
  const slots = VOTE_BUDGET * HAND_SIZE;

  if (players <= TINY_ROOM) {
    playerIds.forEach((id, k) => {
      const start = Math.floor(rng() * pool.length) + k;
      const picks = Array.from(
        { length: slots },
        (_, i) => pool[(start + i) % pool.length].id,
      );
      out[id] = toHands(picks, rng);
    });
    return out;
  }

  // `ring[r]` is the seat standing at ring position r; `posOf[k]` is where
  // seat k stands. Two arrays rather than repeated `indexOf`, so the walk is
  // linear and the permutation is used in both directions.
  const ring = shuffled(
    playerIds.map((_, i) => i),
    rng,
  );
  const posOf = new Array<number>(players);
  ring.forEach((seat, position) => {
    posOf[seat] = position;
  });

  const exposure = exposureFor(quota);
  playerIds.forEach((id, seat) => {
    const picks: string[] = [];
    for (let slot = 0; slot < quota; slot++) {
      for (let t = 0; t < exposure; t++) {
        // Offsets run 1..players-1 and cycle. Never 0.
        const offset = 1 + (t % (players - 1));
        const owner = ring[(posOf[seat] + offset) % players];
        picks.push(pool[owner * quota + slot].id);
      }
    }
    out[id] = toHands(picks, rng);
  });
  return out;
}

/**
 * What each of one player's slots is showing on the TV.
 *
 * **"Writing" means the phone's cursor is on that slot**, not that keys are
 * moving. Driving it from anything finer would leave a lying animation on a
 * slot somebody half-wrote and then skipped past.
 *
 * Derived rather than stored, so there is no second copy of the truth to
 * drift, and — the point of the whole arrangement — the drafts themselves
 * never have to leave the server for the TV to be right.
 */
export function slotStatesFor(
  draft: readonly string[] | undefined,
  cursor: number,
  quota: number,
): SlotState[] {
  return Array.from({ length: quota }, (_, i) => {
    if ((draft?.[i] ?? "").trim() !== "") return "done";
    return i === cursor ? "writing" : "empty";
  });
}

/**
 * The most cards the TV board can carry. A measured ceiling, not a taste call:
 * a name is `max(24px, min(cap, 17cqw))` and 24px is the hard TV floor. At
 * eight cards per row the smallest card is ~104px wide, `17cqw` lands near
 * 12.7px, and the `max()` then clamps a 24px name into a box that cannot hold
 * it. Five per row puts the smallest card at ~146px, where the floor fits.
 */
export const BOARD_CAP = 10;

/**
 * What the board shows, strongest first, and how many cards it could not fit.
 *
 * Unvoted cards stay on the board while voting is open — they hold its shape,
 * so a quiet board reads as quiet rather than as broken. They leave at the
 * close, which is `customShares`' business, not this one's.
 *
 * Ties break by id so the same votes always produce the same board.
 */
export function boardCards(
  pool: readonly PoolCard[],
  tally: Record<string, number>,
): { shown: PoolCard[]; packCount: number } {
  const ranked = [...pool].sort((a, b) => {
    const diff = (tally[b.id] ?? 0) - (tally[a.id] ?? 0);
    return diff !== 0 ? diff : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return {
    shown: ranked.slice(0, BOARD_CAP),
    packCount: Math.max(0, ranked.length - BOARD_CAP),
  };
}

/**
 * Closing percentages, over voted cards only. Zero-vote cards leave the board
 * at the close, so including them in the denominator would understate every
 * share that is left.
 */
export function customShares(
  pool: readonly PoolCard[],
  votes: VoteMap,
): Record<string, number> {
  return voteShares(votes, pool.map((c) => c.id));
}

/**
 * The round's category, weighted by vote share over what is left.
 *
 * **Identical texts merge here and only here.** Two cards reading "smells" are
 * two cards on the board with two tallies — merging them earlier would tell
 * the room that two people matched, which is an authorship leak — and one
 * entry in the draw carrying the summed weight, so the room's appetite for
 * "smells" is counted once rather than split in half against itself.
 *
 * A zero-vote card is not dead, it is last in line: the draw takes voted cards
 * first and falls back to a uniform draw over the unvoted ones only when it has
 * run out. Same shape as `pickCategory` for the built-in pool.
 */
export function pickCustomCategory(
  pool: readonly PoolCard[],
  votes: VoteMap,
  spent: readonly string[],
  roll: number,
): string {
  const isSpent = new Set(spent);
  const tally = tallyVotes(votes);

  const weights = new Map<string, number>();
  const unvoted: string[] = [];
  for (const card of pool) {
    if (isSpent.has(card.text)) continue;
    const n = tally[card.id] ?? 0;
    if (n > 0) weights.set(card.text, (weights.get(card.text) ?? 0) + n);
    else if (!unvoted.includes(card.text)) unvoted.push(card.text);
  }

  if (weights.size > 0) return weightedPick([...weights.entries()], roll).pick;
  if (unvoted.length > 0) {
    return weightedPick(unvoted.map((t) => [t, 1] as [string, number]), roll).pick;
  }
  // Every text has been played. Unreachable while the pool covers the round
  // count, which `quotaFor` guarantees — a guard, not a case.
  return pool.length > 0 ? pool[0].text : "";
}
