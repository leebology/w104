/**
 * The word pool the debug panel's auto-fill draws from.
 *
 * Deliberately **not** category-specific. The point of auto-fill is to get a
 * round to the scoring screen with realistic-looking lists in it — enough
 * words, of plausible length, with enough overlap between players that the
 * Boggle rule has something to do. Whether "kettle" is a good answer for the
 * category on the wall is beside the point, and generating on-category words
 * would mean either a per-category list to maintain or an LLM call from a
 * Durable Object.
 *
 * Pure, so the draw is testable against a fixed sequence rather than a stubbed
 * global — the same arrangement `pickCategory` uses for the category draw.
 */

/**
 * Plain concrete nouns, deliberately overlapping in theme so that a draw for
 * two players collides often enough to exercise scoring. Kept distinct from
 * `CODE_WORDS` in `shared/words.ts`: those are room codes, read aloud across a
 * room and chosen to be unmistakable over noise, and coupling the two would
 * mean a change made for legibility silently changing test data.
 */
export const DEBUG_WORDS = [
  "anchor", "apple", "arrow", "badge", "basket", "beacon", "bicycle", "blanket",
  "bottle", "bridge", "bucket", "button", "candle", "canvas", "carpet", "castle",
  "cavern", "chimney", "clover", "compass", "cottage", "crayon", "cricket",
  "crystal", "curtain", "dagger", "diamond", "dolphin", "dragon", "drawer",
  "eagle", "engine", "envelope", "falcon", "feather", "ferry", "fiddle",
  "flannel", "forest", "fountain", "garden", "glacier", "granite", "guitar",
  "hammer", "harbour", "hedge", "helmet", "hollow", "hunter", "island", "jacket",
  "jigsaw", "journal", "kettle", "kitten", "ladder", "lantern", "laurel",
  "lemon", "lighthouse", "lizard", "locket", "lumber", "magnet", "mantle",
  "marble", "meadow", "mirror", "mitten", "monsoon", "mosaic", "mountain",
  "muffin", "needle", "orchard", "otter", "paddle", "pantry", "parcel",
  "pebble", "pelican", "pencil", "pepper", "picket", "pillow", "planet",
  "pocket", "pottery", "prairie", "pumpkin", "puzzle", "quarry", "rabbit",
  "rafter", "ribbon", "river", "rocket", "saddle", "sailor", "satchel",
  "scarlet", "shelter", "shovel", "signal", "silver", "socket", "spindle",
  "sprout", "squirrel", "stable", "station", "sticker", "stone", "summit",
  "sunset", "sweater", "table", "teapot", "temple", "thicket", "thimble",
  "thunder", "ticket", "timber", "tinder", "toffee", "tractor", "trellis",
  "trumpet", "tunnel", "turtle", "valley", "velvet", "village", "walnut",
  "wagon", "whistle", "willow", "window", "winter", "wonder", "yellow",
] as const;

/** How many words auto-fill gives each scorer, unless told otherwise. */
export const DEFAULT_FILL_COUNT = 8;

/**
 * `count` distinct words, drawn without replacement.
 *
 * Distinct because `submitEntry` rejects a repeat as a duplicate, so a draw
 * with replacement would quietly deliver fewer words than asked for and make
 * the fill count a lie. Capped at the pool size for the same reason.
 *
 * Partial Fisher–Yates over a copy: it touches only the first `count` slots,
 * and drawing for ten players is then ten cheap passes rather than ten full
 * shuffles of a 140-element array.
 *
 * `rand` is injected rather than calling `Math.random` so this stays pure and
 * a test can pin the draw.
 */
export function pickDebugWords(count: number, rand: () => number): string[] {
  return drawFrom([...DEBUG_WORDS] as string[], count, rand);
}

/** Partial Fisher–Yates over `pool`, which it mutates. See `pickDebugWords`. */
function drawFrom(pool: string[], count: number, rand: () => number): string[] {
  const wanted = Math.max(0, Math.min(Math.floor(count), pool.length));
  for (let i = 0; i < wanted; i++) {
    // `i + floor(r * (len - i))` keeps the index inside the untouched tail.
    // Clamped because a `rand` returning exactly 1 would land one past the end.
    const j = Math.min(i + Math.floor(rand() * (pool.length - i)), pool.length - 1);
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, wanted);
}

/**
 * One list of words per scorer, drawn so that the lists **deliberately
 * overlap**.
 *
 * This is the whole point, and it is why the scorers cannot just each call
 * `pickDebugWords` independently. Scoring here is Boggle rules — a word counts
 * only if nobody else wrote it — so independent draws from a 140-word pool
 * would collide about half a word per pair and every player would score nearly
 * full marks. A scoring screen where nothing is ever struck through does not
 * exercise the thing auto-fill exists to exercise.
 *
 * So: draw one shared sub-pool first, then deal each scorer a subset of it.
 * The sub-pool is `perScorer * (scorerCount + 1)` — big enough that everyone
 * still keeps some words of their own, small enough that collisions are
 * common. Two players get a 24-word pool and heavy overlap; ten get 88 and a
 * long tail of uniques, which is roughly how a real round of ten plays out.
 */
export function fillWordsFor(
  scorerCount: number,
  perScorer: number,
  rand: () => number,
): string[][] {
  const each = Math.max(0, Math.floor(perScorer));
  const count = Math.max(0, Math.floor(scorerCount));
  if (each === 0 || count === 0) return [];
  const shared = pickDebugWords(each * (count + 1), rand);
  // Each deal shuffles its own copy, so one scorer's draw cannot consume words
  // out of another's — every scorer sees the whole sub-pool.
  return Array.from({ length: count }, () => drawFrom([...shared], each, rand));
}

/**
 * A plausible category for a placeholder slot. Deterministic, so the same
 * bench always dresses the same way, and deliberately varied so the reveal has
 * something to show.
 */
export function fillCategoryFor(seat: number, slot: number): string {
  const stems = [
    "smells", "noises", "bad gifts", "excuses", "chores", "snacks",
    "villains", "phobias", "hobbies", "regrets", "textures", "sidekicks",
  ];
  return stems[(seat * 3 + slot) % stems.length];
}
