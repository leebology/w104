import { seededRng } from "./rng";

/**
 * The avatars, and the rule that no two people in a room wear the same one.
 *
 * **In `shared/` rather than beside the picker**, because the assignment is a
 * game rule now and the server is what enforces it: a client that asks for a
 * taken emoji is refused, exactly as one that asks for a taken *seat* is. It is
 * pure data and pure functions, so it tests under the existing
 * `shared/**\/*.test.ts` glob and costs the Worker's tsconfig nothing.
 * `src/components/AvatarPicker.tsx` re-exports `AVATARS`, so every import site
 * it already had is unchanged.
 *
 * Order is append-only: a player's choice is stored as the emoji itself, not an
 * index, but the first row a returning player sees should still be the one they
 * remember. New arrivals go on the end.
 */
export const AVATARS = [
  "🐙", "🦊", "🐸", "🐼", "🦉", "🐝", "🦀", "🐬",
  "🌵", "🍄", "🌶️", "🍋", "⚡", "🌙", "🔥", "💎",
  "🎩", "👾", "🤖", "👻", "🦖", "🐌", "🦩", "🧊",
  "🦄", "🐢", "🦔", "🐧", "🦇", "🐳", "🦥", "🐊",
  "🌻", "🍉", "🥑", "🍕", "🌈", "⭐", "❄️", "🍀",
  "👑", "🎸", "🚀", "🛸", "🎲", "🧃", "🪩", "🥁",
] as const;

/**
 * Structural rather than `Player`, the arrangement `shared/waiting.ts` has: it
 * keeps this module free to be imported from anywhere in `shared/` without
 * closing a cycle through `state.ts`.
 */
type Wearer = { id: string; emoji: string };

/**
 * Every emoji currently spoken for, optionally ignoring one wearer.
 *
 * `except` is whoever is asking — a player re-picking must not be told their
 * own current avatar is taken, and re-sending the emoji they already wear (the
 * lobby does exactly that on every keystroke of the name field) must not be
 * refused.
 *
 * Bots count. They are `Player`s that appear on every screen a human does, and
 * two identical faces in one roster is precisely the confusion this exists to
 * remove — a bot is meant to be indistinguishable from a player who picked
 * well, which cuts both ways.
 */
export function takenAvatars(
  players: readonly Wearer[],
  except?: string,
): Set<string> {
  const taken = new Set<string>();
  for (const p of players) {
    if (p.id === except) continue;
    if (p.emoji) taken.add(p.emoji);
  }
  return taken;
}

/** Whether this wearer may have this emoji. */
export function avatarAvailable(
  players: readonly Wearer[],
  except: string | undefined,
  emoji: string,
): boolean {
  return !takenAvatars(players, except).has(emoji);
}

/**
 * An unused avatar, chosen at random, for somebody who has just walked in.
 *
 * `roll` is 0..1 and comes from the caller, the arrangement the category draw
 * and `balanceTeams` have: the randomness is the caller's to supply so `reduce`
 * stays pure. `avatarFor` below is the convenience that derives one.
 *
 * **Falls back to a used avatar rather than to none.** The list holds 48 and a
 * room holds up to `MAX_PLAYERS` humans plus `MAX_BOTS` placeholders, which is
 * 50 — so a fully dressed room really can run out. A duplicate face is a
 * cosmetic problem; a player seated with no avatar at all is a blank where
 * every screen expects a face, and the debug bench is the only way to reach it.
 */
export function freeAvatar(
  players: readonly Wearer[],
  except: string | undefined,
  roll: number,
): string {
  const taken = takenAvatars(players, except);
  const free = AVATARS.filter((a) => !taken.has(a));
  const pool: readonly string[] = free.length > 0 ? free : AVATARS;
  const i = Math.min(pool.length - 1, Math.max(0, Math.floor(roll * pool.length)));
  return pool[i]!;
}

/**
 * The avatar a new arrival is given, seeded from things the caller already has.
 *
 * Pure — the room code, the player's own id and the moment they arrived are all
 * inputs — so `reduce` keeps its "no randomness of its own" property without
 * `join` having to grow a `roll` on the wire. Same reasoning as `seedRoll` in
 * `shared/customCategories.ts`, and the player id is in the seed so that two
 * people joining on the same millisecond are not handed the same face.
 */
export function avatarFor(
  players: readonly Wearer[],
  playerId: string,
  code: string,
  now: number,
): string {
  return freeAvatar(players, playerId, seededRng(`avatar:${code}:${playerId}:${now}`)());
}
