/** The blank in "NAME A: ____". Singular, lowercase. */
export const DEFAULT_CATEGORY = "woman";
export const DEFAULT_DURATION_SEC = 30;
export const DEFAULT_ROUND_COUNT = 1;

/**
 * The votable pool. Order is the render order in every grid — nothing sorts
 * this. 16 entries exceeds MAX_ROUND_COUNT (10), so a match can never exhaust
 * the pool and the draw's last-resort guard is unreachable.
 */
export const CATEGORIES = [
  "woman",
  "man",
  "animal",
  "plant",
  "song",
  "movie",
  "brand",
  "country",
  "city",
  "colour",
  "sport",
  "car",
  "food",
  "drink",
  "job",
  "body part",
] as const;
