/**
 * The waiting room: players who joined past the lobby and are sitting out the
 * round in progress.
 *
 * A waiting player holds a real seat — they count against `MAX_PLAYERS`, they
 * show on the host TV, they can pick a team — and is inert in every derivation
 * the match is made of. They are dealt in at the next whistle; see
 * `admitWaiting` in `shared/reduce.ts`, which is the only place the flag is
 * ever cleared on a running match.
 *
 * **Types only.** `shared/teams.ts` needs `isSeated` inside `rosterOf`, so
 * anything this module imported back at runtime would close a cycle — the same
 * arrangement `shared/rng.ts` and `shared/revealtiming.ts` have. The admission
 * rule itself needs `teamsEnabled` and therefore lives in `reduce.ts`, beside
 * the other phase-edge helpers.
 *
 * **Not to be confused with `isWaiting` in `shared/bots.ts`**, which means
 * something else entirely: "not the one everybody is waiting on" — ready, or a
 * bot. That predicate is about readiness and has nothing to do with this one,
 * which is why nothing here is called `isWaiting`.
 */
import type { Player } from "./state";

/**
 * Read through this rather than as a bare truthiness test, exactly as `isBot`
 * is. A room stored before this landed has no `waiting` key at all, which reads
 * as seated — the correct answer, since such a room has no waiting players by
 * construction, and the reason there is no `load()` fallback for the field.
 */
export const inWaitingRoom = (p: Player): boolean => p.waiting === true;

/** In the match now: playing, scoring, standing in the standings. */
export const isSeated = (p: Player): boolean => !inWaitingRoom(p);

export const seatedPlayers = (players: Player[]): Player[] => players.filter(isSeated);

export const waitingPlayers = (players: Player[]): Player[] =>
  players.filter(inWaitingRoom);
