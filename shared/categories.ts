import { seededRng } from "./rng";
import type { Rng } from "./rng";

/** The blank in "NAME A: ____". Singular, lowercase except for proper nouns. */
export const DEFAULT_CATEGORY = "famous woman";
/**
 * What a room plays if the host changes nothing: three rounds of three
 * minutes, teams off, the built-in categories. The last two are defaults in
 * `shared/gamemodes.ts` (`teamCount: 0`, `categorySource: "stock"`); these two
 * are here because the descriptors quote them.
 *
 * Three minutes rather than thirty seconds because the stock categories are
 * broad enough to keep a room writing for one, and a host who wants a sprint
 * is one drawer away. Three rounds rather than one because a single round has
 * no standings worth the name — placement scoring only starts meaning
 * something once there is a second round to change it.
 */
export const DEFAULT_DURATION_SEC = 180;
export const DEFAULT_ROUND_COUNT = 3;

/**
 * The letters a "word starting with ___" round can name.
 *
 * Z, X, Q, V, N and R are absent by request, and the shape of the complaint is
 * the same in every case: a letter whose answer space is either tiny (Z, X, Q)
 * or nearly all one prefix, which makes the round a memory test rather than a
 * race. The set is a plain string because every use of it is "pick one".
 */
const LETTERS = "ABCDEFGHIJKLMOPSTUWY";

/** Colours plain enough that nobody argues about whether a thing is one. */
const COLORS = [
  "red", "orange", "yellow", "green", "blue",
  "purple", "pink", "brown", "black", "white",
] as const;

/**
 * One entry in the master pool: either a fixed category, or a template that is
 * resolved when the ballot is built.
 *
 * The templates are the reason this file owns an `Rng` at all. "A word starting
 * with B" and "a red thing" are one category each in the sense that matters
 * here — they occupy one slot on the ballot and are drawn once — but the round
 * they produce is different every match, which is most of what makes a pool
 * this size feel larger than it is.
 */
type PoolEntry = string | ((rng: Rng) => string);

/**
 * Everything a stock match can be about. **Not what a room votes on** — that is
 * eight of these, drawn per match by `buildBallot`.
 *
 * Singular and lowercase, because every one of these lands in "NAME A: ____"
 * on the round banner. Proper nouns keep their capitals.
 *
 * Order is the order they were written in and means nothing: the draw shuffles,
 * and `buildBallot` is the only thing that reads this list.
 */
export const CATEGORY_POOL: readonly PoolEntry[] = [
  "famous woman",
  "country",
  "color",
  "cereal brand",
  "job",
  "US president",
  "town in Massachusetts",
  "thing bigger than a car",
  "thing smaller than a mug",
  "body part",
  "bird",
  "mammal",
  "famous Asian person",
  (rng) => `word starting with ${LETTERS[Math.floor(rng() * LETTERS.length)]}`,
  "chemical element",
  "spherical object",
  "plant",
  "musical instrument",
  "board game",
  (rng) => `${COLORS[Math.floor(rng() * COLORS.length)]} thing`,
  "Disney character",
  "island",
  "pasta shape",
  "capital city",
  "Olympic event",
  "candy brand",
  "Disney villain",
  "Minecraft block",
  "Pokémon",
  "insect",
  "3-digit number",
  "alcohol brand",
  "Boston T stop",
  "university",
  "person born before 1900",
  "square on a Monopoly board",
  "sports team",
  "shoe brand",
  "kids' TV show",
];

/**
 * How many categories a room votes between.
 *
 * Eight rather than the whole pool, and that is the point of having a pool this
 * size: a ballot the room can actually read, and a different one next match.
 * The old arrangement put all ten of ten on screen every time, so the vote
 * chose the order and never the set.
 */
export const BALLOT_SIZE = 8;

/**
 * The fixed entries, for callers that need stock category text without drawing
 * a ballot.
 *
 * The custom-category house cards are the only one: `buildPool` fills the slots
 * nobody wrote with these, and it needs plain strings rather than a match's
 * ballot — a custom match never builds one.
 */
export const CATEGORIES: readonly string[] = CATEGORY_POOL.filter(
  (entry): entry is string => typeof entry === "string",
);

/**
 * The "surprise us" option on the ballot, and deliberately **not** a member of
 * the pool.
 *
 * A vote for it is a vote for the draw itself rather than for a subject: if it
 * wins, `pickCategory` spends its win on a uniform draw over whatever is left.
 * It is never drawn, never spent and never named on a round — which is exactly
 * why it is kept out of the pool. Everything that reads a ballot as "the things
 * a round can be about" — the draw's pool, `spentCategories`, the archive's
 * played set, the round header — stays correct with no extra guard.
 */
export const RANDOM_CATEGORY = "random";

/**
 * This match's ballot: `size` categories drawn from the pool, templates
 * resolved.
 *
 * Seeded rather than `Math.random()`, so `reduce` stays pure and a ballot is
 * reproducible from the room and the moment it was built. The caller supplies
 * the seed for the same reason it supplies a `roll` to the category draw.
 *
 * **`size` is `max(BALLOT_SIZE, roundCount)`, not `BALLOT_SIZE`.** The draw
 * spends one category per round and never repeats, so a ten-round match on an
 * eight-card ballot would run out and fall through `pickCategory`'s last-resort
 * guard into a repeat. Growing the ballot for the long matches keeps that guard
 * unreachable, which is the property the old ten-against-`MAX_ROUND_COUNT`-ten
 * arrangement had. Every ordinary match is eight.
 */
export function buildBallot(seed: string, size: number = BALLOT_SIZE): string[] {
  const rng = seededRng(`ballot:${seed}`);
  const wanted = Math.min(Math.max(1, Math.floor(size)), CATEGORY_POOL.length);

  // Fisher-Yates over the indices, so a template is drawn as one entry and
  // resolved once. Partial: only as far as `wanted`, which is all that is read.
  const order = CATEGORY_POOL.map((_, i) => i);
  for (let i = 0; i < wanted; i++) {
    const j = i + Math.floor(rng() * (order.length - i));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }

  return order.slice(0, wanted).map((i) => {
    const entry = CATEGORY_POOL[i]!;
    return typeof entry === "string" ? entry : entry(rng);
  });
}

/**
 * The match's ballot, from a room or a room state.
 *
 * Structural rather than typed against `Room`, because `state.ts` imports this
 * module and the reverse edge would close a cycle.
 *
 * **The fallback is deterministic in the room code, and both sides compute the
 * same one.** `ballot` is empty on a room stored before this field existed, on
 * a room the view jumper dropped straight onto a voting screen, and in the
 * lobby before a match has opened one — and every reader (the two voting grids,
 * the draw, `castVote`, the archive) has to answer *something*. A pure function
 * of the code is an answer the server and every phone reach independently
 * without it having to be broadcast first.
 */
export function ballotOf(view: {
  code: string;
  ballot: readonly string[];
}): readonly string[] {
  return view.ballot.length > 0 ? view.ballot : buildBallot(view.code);
}

/** What a player may actually vote for: the ballot, with the random option last. */
export function votableBallot(view: {
  code: string;
  ballot: readonly string[];
}): readonly string[] {
  return [...ballotOf(view), RANDOM_CATEGORY];
}
