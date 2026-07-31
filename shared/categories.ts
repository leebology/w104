/** The blank in "NAME A: ____". Singular, lowercase. */
export const DEFAULT_CATEGORY = "woman";
export const DEFAULT_DURATION_SEC = 30;
export const DEFAULT_ROUND_COUNT = 1;

/**
 * The votable pool. Order is the render order in every grid — nothing sorts
 * this.
 *
 * Ten entries against MAX_ROUND_COUNT 10. The draw runs at round N with N-1
 * categories spent, so a full match reaches round ten with exactly one left:
 * the pool is consumed to the last card but never runs dry, and the draw's
 * last-resort guard stays unreachable. It does mean a ten-round match plays
 * every category, so at that length the vote decides the *order* rather than
 * the set. Shorter matches — the common case — still choose.
 *
 * Cut from the original sixteen: `man`, `city` and `drink` each sat too close
 * to a neighbour here (`woman`, `country`, `food`) to feel like a different
 * round; `plant`, `brand` and `body part` have answer spaces too thin to
 * reward a full timer.
 */
export const CATEGORIES = [
  "woman",
  "animal",
  "song",
  "movie",
  "country",
  "colour",
  "sport",
  "car",
  "food",
  "job",
] as const;

/**
 * The "surprise us" option on the ballot, and deliberately **not** a member of
 * `CATEGORIES`.
 *
 * A vote for it is a vote for the draw itself rather than for a subject: if it
 * wins, `pickCategory` spends its win on a uniform draw over whatever is left.
 * It is never drawn, never spent and never named on a round — which is exactly
 * why it is kept out of the pool. Everything that reads `CATEGORIES` as "the
 * things a round can be about" — the draw's pool, `spentCategories`, the
 * archive's played set, the round header — stays correct with no extra guard.
 */
export const RANDOM_CATEGORY = "random";

/**
 * What a player may actually vote for: the pool, with the random option last.
 * The ballot is the render order in both voting grids and the tie-break order
 * in `voteShares`, the same job `CATEGORIES` does for the draw.
 */
export const BALLOT = [...CATEGORIES, RANDOM_CATEGORY] as const;
