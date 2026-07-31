/**
 * The scroll mirror: a player's scroll on their own results list, driving their
 * scorer's column on the host TV.
 *
 * Two pure derivations, kept in `shared/` rather than in the screens so the
 * existing `shared/**\/*.test.ts` glob covers them. The transport in
 * `party/server.ts` and the DOM driving in `HostScoring` are not unit-testable
 * in this repo, so everything that *can* be a derivation is one.
 *
 * Its own module rather than a corner of `shared/teams.ts` because it needs
 * `isHuman` from `shared/bots.ts`, and `bots.ts` already imports `teams.ts` —
 * putting this there would close a cycle. Nothing imports this module back.
 */
import { isHuman } from "./bots";
import type { PlayerId, Room } from "./state";
import { rosterOf } from "./teams";
import type { ScorerId, TeamView } from "./teams";

/** Everything `driverOf` needs: the roster, and whether teams are on at all. */
type DriverView = TeamView & Pick<Room, "settings">;

/**
 * The one member whose scroll drives this scorer's column — the first member
 * that is **connected and human**, in roster order — or null when nobody can.
 *
 * - **Roster order, not team-join order.** `membersOf` derives a team's roster
 *   by filtering `players`, so this is who joined the *room* first. That is
 *   already the order the emoji row is drawn in on both the phone and the TV,
 *   so the driver is the face on the left of the card: visible without being
 *   labelled. Recording real team-join order would mean a new persisted field
 *   on `Player`, a `load()` fallback for older stored rooms and a migration
 *   consideration, to reorder a row nobody can see.
 * - **Connected, because `membersOf` does not filter on it.** Without this a
 *   member whose phone locked would own a column nobody could drive.
 * - **Human, because bots are `connected: true`** (`shared/bots.ts`). A bot
 *   seated on a team by `seatBots` could otherwise lead its roster and own a
 *   column it can never drive, and the mirror would go silently missing for
 *   that team.
 *
 * Derived on every message and never stored, so there is no claim to take,
 * release or clear: a disconnect hands the column over with nothing watching
 * for it, and a reconnect takes it straight back.
 *
 * With teams off a scorer's `members` is the one player, so this collapses to
 * "the player" with no special case — the same unification `rosterOf` does.
 */
export function driverOf(view: DriverView, scorerId: ScorerId): PlayerId | null {
  const scorer = rosterOf(view).find((s) => s.id === scorerId);
  if (!scorer) return null;
  for (const id of scorer.members) {
    const player = view.players.find((p) => p.id === id);
    if (player && player.connected && isHuman(player)) return id;
  }
  return null;
}

/**
 * A scroll box's position as the wire value: its fraction of scrollable range,
 * clamped to [0,1] and rounded to three decimals.
 *
 * **Null when there is nothing to scroll.** A list shorter than its box has no
 * position to mirror and the caller sends nothing at all.
 *
 * A fraction rather than pixels because the two lists are different sizes — the
 * phone renders at 19px and the host column at 15px, in boxes of different
 * heights, so the same `scrollTop` means two different words. A fraction rather
 * than a top row index because both ends land their window at
 * `f * (rows - visible)`, which keeps the TV's visible window nested inside the
 * phone's *by construction*: the word being read is on the TV's screen with no
 * clamping rule needed at the ends of the list.
 *
 * Three decimals is 0.19 rows on a 200-entry list (`MAX_ENTRIES`), so the
 * rounding is invisible — and it dedupes for free, since a scroll that does not
 * move the rounded value sends nothing.
 */
export function scrollFraction(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): number | null {
  const range = scrollHeight - clientHeight;
  // `!(range > 0)` rather than `range <= 0` so a NaN range returns null too.
  if (!(range > 0)) return null;
  const f = scrollTop / range;
  if (!Number.isFinite(f)) return null;
  return Math.round(Math.min(1, Math.max(0, f)) * 1000) / 1000;
}
