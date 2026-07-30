import { isMatch, normalize } from "./scoring";
import type { Results, ScorerResult } from "./scoring";
import type { ScorerId } from "./teams";

/**
 * The scoring reveal, as pure arithmetic.
 *
 * The host screen plays one round's results as three frames: cards deal in, then
 * every list fills a line at a time, then the cards swap into final order. Only
 * the middle frame has any state, and it is a **single integer** — `step`, the
 * number of lines revealed so far.
 *
 * Everything visible derives from that integer against a schedule computed once:
 * which word is on screen, which words are struck through, whose emoji trails
 * them, what each UNIQUE count reads, and what rank each card ends on. Nothing
 * is stored per row and nothing is diffed against a previous render. That is what
 * makes FAST FORWARD and a dev step-through the same operation — an assignment to
 * `step` — and it is why this file has no DOM in it and tests in milliseconds.
 */

/** Which scorer's list reveals next. */
export type PlayerOrderMode = "random" | "shortest" | "longest";

/**
 * Line order *within* every list. `entry` is as typed; `duplicates` puts every
 * shared word first so a column ends on its own points. Unrelated to the order
 * the columns themselves reveal in.
 */
export type RevealOrderMode = "entry" | "duplicates";

/** `${scorerId}:${entryIndex}`. The flat key the schedule is addressed by. */
export type RowKey = string;

export function rowKey(scorerId: ScorerId, index: number): RowKey {
  return `${scorerId}:${index}`;
}

export type RowRef = { scorerId: ScorerId; index: number };

export type Rng = () => number;

/**
 * mulberry32 over an FNV-1a hash of the seed string. Seeded rather than
 * `Math.random` so a replay of the same round deals and reveals in the same
 * order — the reveal is watched by a room, and "run it again" has to show them
 * the same thing.
 */
export function seededRng(seed: string): Rng {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  let state = hash | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export type RevealSchedule = {
  /** Reveal order of the columns that have anything to reveal. */
  order: ScorerId[];
  /** The step each column's first line lands on. Absent for an empty list. */
  colStart: Record<ScorerId, number>;
  /** The step each row lands on, 1-based. Step 0 is "nothing revealed yet". */
  stepOf: Record<RowKey, number>;
  /**
   * The other scorers' rows holding the same answer — the rows that strike this
   * one. Derived from the same normalize/isMatch clustering `scoreRound` used
   * for `alsoBy`, so the two can never disagree.
   */
  partners: Record<RowKey, RowRef[]>;
  /** The last step in the schedule; 0 when nobody wrote anything. */
  lastStep: number;
};

/**
 * Groups every row in the round into clusters of the same answer, and hands
 * each row the other scorers' rows in its cluster.
 *
 * `scoreRound` already did this work to derive `alsoBy`, but it kept only the
 * scorer ids — and the reveal needs the *rows*, because a word strikes at the
 * moment the matching line appears in another column, which is a step, not a
 * scorer. Re-deriving here rather than widening `ScoredEntry` keeps the wire
 * format and the stored `Room` untouched.
 */
function clusterRows(scorers: ScorerResult[]): Record<RowKey, RowRef[]> {
  const cells: { ref: RowRef; norm: string }[] = [];
  for (const scorer of scorers) {
    scorer.entries.forEach((entry, index) => {
      cells.push({ ref: { scorerId: scorer.id, index }, norm: normalize(entry.text) });
    });
  }

  const parent = cells.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]; // path halving
      i = parent[i];
    }
    return i;
  };
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      if (!isMatch(cells[i].norm, cells[j].norm)) continue;
      const ri = find(i);
      const rj = find(j);
      if (ri !== rj) parent[rj] = ri;
    }
  }

  const groups = new Map<number, number[]>();
  cells.forEach((_, i) => {
    const root = find(i);
    const group = groups.get(root);
    if (group) group.push(i);
    else groups.set(root, [i]);
  });

  const partners: Record<RowKey, RowRef[]> = {};
  for (const group of groups.values()) {
    for (const i of group) {
      const self = cells[i].ref;
      partners[rowKey(self.scorerId, self.index)] = group
        .filter((j) => cells[j].ref.scorerId !== self.scorerId)
        .map((j) => cells[j].ref);
    }
  }
  return partners;
}

function columnOrder(
  scorers: ScorerResult[],
  mode: PlayerOrderMode,
  rng: Rng,
): ScorerResult[] {
  if (mode === "random") return shuffled(scorers, rng);
  const sign = mode === "shortest" ? 1 : -1;
  // Stable, so equal-length lists keep their scoring order rather than
  // shuffling on every render.
  return [...scorers].sort((a, b) => sign * (a.entries.length - b.entries.length));
}

function lineOrder(scorer: ScorerResult, mode: RevealOrderMode): number[] {
  const indices = scorer.entries.map((_, i) => i);
  if (mode === "entry") return indices;
  // Uniques held back, so a column ends on the words that actually scored.
  return [
    ...indices.filter((i) => scorer.entries[i].alsoBy.length > 0),
    ...indices.filter((i) => scorer.entries[i].alsoBy.length === 0),
  ];
}

export function buildSchedule(
  results: Results,
  opts: { playerOrder: PlayerOrderMode; lineOrder: RevealOrderMode; rng: Rng },
): RevealSchedule {
  const partners = clusterRows(results.scorers);
  const order: ScorerId[] = [];
  const colStart: Record<ScorerId, number> = {};
  const stepOf: Record<RowKey, number> = {};

  let step = 0;
  for (const scorer of columnOrder(results.scorers, opts.playerOrder, opts.rng)) {
    // An empty list has no lines, so it takes no steps and no beat of its own.
    // Its card still shows its empty state from the moment the reveal opens.
    if (scorer.entries.length === 0) continue;
    order.push(scorer.id);
    colStart[scorer.id] = step + 1;
    for (const index of lineOrder(scorer, opts.lineOrder)) {
      stepOf[rowKey(scorer.id, index)] = ++step;
    }
  }

  return { order, colStart, stepOf, partners, lastStep: step };
}

/**
 * The column currently revealing — the one that takes the teal offset shadow
 * and the only one whose list is allowed to scroll. Null before the first line
 * and once every line is out.
 */
export function activeColumn(schedule: RevealSchedule, step: number): ScorerId | null {
  if (step < 1 || step > schedule.lastStep) return null;
  let active: ScorerId | null = null;
  for (const id of schedule.order) {
    if (schedule.colStart[id] <= step) active = id;
    else break;
  }
  return active;
}

/** The step a column is cued on: its predecessor's last line. */
export function cueStep(schedule: RevealSchedule, scorerId: ScorerId): number | null {
  const start = schedule.colStart[scorerId];
  return start === undefined ? null : start - 1;
}

export type RowView = {
  /** On screen. Rows past the reveal are not rendered at all. */
  revealed: boolean;
  struck: boolean;
  /**
   * The strike arrived after this row was already on screen — a later column
   * landing the same word. This is the strike the card flinches at; a word that
   * lands already-duplicated is the *active* column's own business and gets no
   * ring and no dip.
   */
  backCheck: boolean;
  /** The step the strike landed on; null while the row still scores. */
  struckAt: number | null;
  /** Scorers whose matching word is already on screen, earliest first. */
  alsoShown: ScorerId[];
  /** The step the trail last grew on; null when there is no trail. */
  poppedAt: number | null;
};

const HIDDEN: RowView = {
  revealed: false,
  struck: false,
  backCheck: false,
  struckAt: null,
  alsoShown: [],
  poppedAt: null,
};

/**
 * One row at one step.
 *
 * A row renders struck once **any** partner is already on screen, which is what
 * makes back-checking automatic: a column revealed five beats ago flips the
 * instant a later column lands its word, with nothing watching for it. The trail
 * shows only the partners revealed so far and grows as more columns arrive.
 *
 * A word never appears pre-struck. `struckAt` is never earlier than the row's own
 * step, so a line that lands already-duplicated still lands in plain ink and is
 * struck through after.
 */
export function rowView(
  schedule: RevealSchedule,
  scorerId: ScorerId,
  index: number,
  step: number,
): RowView {
  const own = schedule.stepOf[rowKey(scorerId, index)];
  if (own === undefined || own > step) return HIDDEN;

  // Earliest step per partner *scorer*: a scorer with two near-spellings of the
  // same answer must appear once in the trail, at its first.
  const firstBy = new Map<ScorerId, number>();
  let earliest = Infinity;
  for (const partner of schedule.partners[rowKey(scorerId, index)] ?? []) {
    const at = schedule.stepOf[rowKey(partner.scorerId, partner.index)];
    if (at === undefined) continue;
    if (at < earliest) earliest = at;
    const seen = firstBy.get(partner.scorerId);
    if (seen === undefined || at < seen) firstBy.set(partner.scorerId, at);
  }

  const shown = [...firstBy.entries()]
    .filter(([, at]) => at <= step)
    .sort((a, b) => a[1] - b[1]);

  const struckAt = earliest === Infinity ? null : Math.max(own, earliest);
  const struck = struckAt !== null && struckAt <= step;

  return {
    revealed: true,
    struck,
    backCheck: struck && struckAt! > own,
    struckAt: struck ? struckAt : null,
    alsoShown: shown.map(([id]) => id),
    // The trail appears with the row when the partners got there first, and
    // grows at each later partner — so it pops once per arrival, not once ever.
    poppedAt: shown.length === 0 ? null : Math.max(own, shown[shown.length - 1][1]),
  };
}

export type CardView = {
  /** Rows on screen. */
  shown: number;
  /**
   * Words still scoring. Opens at the scorer's TOTAL and only ever counts down:
   * a row that has not been revealed has not been caught yet, so it is still
   * counted, and once struck a row stays struck.
   */
  unique: number;
  /** The latest step any of this card's rows struck on. Drives the stat blink. */
  struckAt: number | null;
  /**
   * The latest *back-check* strike. Drives the penalty ring and the dip — the
   * active card does not flinch at its own words.
   */
  flinchAt: number | null;
};

export function cardView(
  schedule: RevealSchedule,
  scorer: ScorerResult,
  step: number,
): CardView {
  let shown = 0;
  let struck = 0;
  let struckAt: number | null = null;
  let flinchAt: number | null = null;

  scorer.entries.forEach((_, index) => {
    const row = rowView(schedule, scorer.id, index, step);
    if (!row.revealed) return;
    shown++;
    if (!row.struck) return;
    struck++;
    if (struckAt === null || row.struckAt! > struckAt) struckAt = row.struckAt;
    if (row.backCheck && (flinchAt === null || row.struckAt! > flinchAt)) {
      flinchAt = row.struckAt;
    }
  });

  return { shown, unique: scorer.entries.length - struck, struckAt, flinchAt };
}

/** Final order: unique descending, then total descending. Stable beyond that. */
export function finalOrder(scorers: ScorerResult[]): ScorerResult[] {
  return [...scorers].sort((a, b) => b.unique - a.unique || b.total - a.total);
}

/**
 * Standard competition ranking: equal `unique` **and** equal `total` share a
 * place and the next place skips, so `1, 2, 2, 4`. A tie for first therefore
 * means two gold plaques and no silver, which falls out of the numbers rather
 * than needing a case of its own.
 */
export function finalRanks(scorers: ScorerResult[]): Record<ScorerId, number> {
  const sorted = finalOrder(scorers);
  const ranks: Record<ScorerId, number> = {};
  sorted.forEach((scorer, i) => {
    const prev = i > 0 ? sorted[i - 1] : undefined;
    ranks[scorer.id] =
      prev && prev.unique === scorer.unique && prev.total === scorer.total
        ? ranks[prev.id]
        : i + 1;
  });
  return ranks;
}

/**
 * The order the cards deal in.
 *
 * Round one has nothing to sort by, so it is a seeded scatter. Every round after
 * deals in current match standings, best first — which also means the swap into
 * final order at the end is a visible statement about who moved.
 */
export function entryOrder(
  scorers: ScorerResult[],
  /** Match place per scorer, or null in round one. */
  placeOf: Record<ScorerId, number> | null,
  rng: Rng,
): ScorerId[] {
  if (placeOf === null) return shuffled(scorers, rng).map((s) => s.id);
  return [...scorers]
    .sort((a, b) => (placeOf[a.id] ?? Infinity) - (placeOf[b.id] ?? Infinity))
    .map((s) => s.id);
}
