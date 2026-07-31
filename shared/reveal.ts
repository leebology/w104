import { isMatch, normalize } from "./scoring";
import type { Results, ScorerResult } from "./scoring";
import { NO_SELF_MARKS, isSelfStruck, markCount } from "./selfstrike";
import type { SelfMarks } from "./selfstrike";
import type { ScorerId } from "./teams";
import type { Rng } from "./rng";

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

/**
 * The pacing of frames 1 and 2, in milliseconds.
 *
 * Here rather than in the host screen because the reveal is no longer only the
 * host's: every phone derives the same `step` from the same schedule and the
 * same `scoring.startedAt`, so a second copy of these numbers would put the TV
 * and the phones on visibly different lines.
 */
export const REVEAL_TIMING = {
  /** Frame 1: per-card deal delay, and how long one card's swing lasts. */
  DEAL_STAGGER: 150,
  DEAL_DURATION: 920,
  /**
   * Frame 2: one line, every time, whatever the list length. No accelerating
   * stagger, no length-scaled timing, no batching past a threshold — the single
   * cadence is what pulls the whole room to the same word at the same moment.
   */
  LINE_INTERVAL: 260,
  /**
   * The extra beat before a column's first line. Not dead time: the next card
   * shakes through it, so the room's eye is already on the list about to fill.
   */
  COLUMN_PAUSE: 1_000,
  /** How long a word holds in plain ink before its own strike draws through. */
  STRIKE_HOLD: 180,
} as const;

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

/**
 * Re-exported, not redeclared: the generator moved to `shared/rng.ts` once
 * `balanceTeams` needed one too, and every existing import site here — both
 * scoring screens and this module's own tests — keeps working. Seeding is what
 * makes a replayed round deal and reveal in the same order, which matters
 * because the reveal is watched by a room and "run it again" has to show them
 * the same thing.
 */
export { seededRng } from "./rng";
export type { Rng } from "./rng";

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
  /** How long frame 1 runs for, from `scoring.startedAt`. */
  dealMs: number;
  /**
   * Milliseconds after `scoring.startedAt` at which each step lands. Index 0 is
   * `dealMs` — the moment step 0 (nothing revealed, cards dealt) is reached.
   *
   * Precomputed so the whole reveal is a function of *elapsed time* rather than
   * of a chain of `setTimeout`s. That is what keeps the TV and every phone on
   * the same line: a chain accumulates each timer's lateness, and after sixty
   * lines the two have visibly drifted.
   */
  timeOf: number[];
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

  // Frame 1 runs entirely on CSS delays; this is only how long the last card's
  // swing takes to finish.
  const dealMs =
    Math.max(0, results.scorers.length - 1) * REVEAL_TIMING.DEAL_STAGGER +
    REVEAL_TIMING.DEAL_DURATION;
  const timeOf = [dealMs];
  for (let s = 1; s <= step; s++) {
    const opensColumn = order.some((id) => colStart[id] === s);
    timeOf[s] =
      timeOf[s - 1] +
      REVEAL_TIMING.LINE_INTERVAL +
      (opensColumn ? REVEAL_TIMING.COLUMN_PAUSE : 0);
  }

  return { order, colStart, stepOf, partners, lastStep: step, dealMs, timeOf };
}

/** How many lines are out `elapsed` ms after `scoring.startedAt`. */
export function stepAt(schedule: RevealSchedule, elapsed: number): number {
  let step = 0;
  while (step < schedule.lastStep && schedule.timeOf[step + 1] <= elapsed) step++;
  return step;
}

/**
 * When the next visible change is due, in ms after `scoring.startedAt`, or null
 * once the reveal is over. The one thing a client has to set a timer for.
 */
export function nextChangeAt(
  schedule: RevealSchedule,
  elapsed: number,
): number | null {
  if (elapsed < schedule.dealMs) return schedule.dealMs;
  const next = stepAt(schedule, elapsed) + 1;
  return next <= schedule.lastStep ? schedule.timeOf[next] : null;
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
  /**
   * Struck out by its own scorer, by hand. Kept apart from `struck` rather than
   * folded into it: the two are drawn the same but they are not the same fact,
   * and only one of them can be taken back. Render sites compose the pair.
   */
  selfStruck: boolean;
  /**
   * How many times this row has been marked by hand. The strike and the restore
   * alternate their parity off this — see `SelfMarks.counts`.
   */
  selfMarks: number;
  /** The step the trail last grew on; null when there is no trail. */
  poppedAt: number | null;
  /**
   * How many times the trail has grown — which is `alsoShown.length`, named for
   * what it is used for. The pop animation's alternating parity is taken from
   * this rather than from `poppedAt`, because two arrivals two steps apart share
   * a step parity, and an identical animation string does not restart.
   */
  popCount: number;
};

const HIDDEN: RowView = {
  revealed: false,
  struck: false,
  backCheck: false,
  struckAt: null,
  alsoShown: [],
  selfStruck: false,
  selfMarks: 0,
  poppedAt: null,
  popCount: 0,
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
 * struck through after. A *self*-strike is the exception and deliberately so: a
 * scorer can disown a word on their phone before the TV has reached it, and the
 * TV then reveals it already crossed out, because that is what happened.
 */
export function rowView(
  schedule: RevealSchedule,
  scorerId: ScorerId,
  index: number,
  step: number,
  marks: SelfMarks = NO_SELF_MARKS,
): RowView {
  const key = rowKey(scorerId, index);
  const own = schedule.stepOf[key];
  if (own === undefined || own > step) return HIDDEN;

  // Earliest step per partner *scorer*: a scorer with two near-spellings of the
  // same answer must appear once in the trail, at its first.
  const firstBy = new Map<ScorerId, number>();
  let earliest = Infinity;
  for (const partner of schedule.partners[key] ?? []) {
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
    selfStruck: isSelfStruck(marks, key),
    selfMarks: markCount(marks, key),
    // The trail appears with the row when the partners got there first, and
    // grows at each later partner — so it pops once per arrival, not once ever.
    poppedAt: shown.length === 0 ? null : Math.max(own, shown[shown.length - 1][1]),
    popCount: shown.length,
  };
}

export type CardView = {
  /** Rows on screen. */
  shown: number;
  /**
   * Words still scoring. Opens at the scorer's TOTAL and counts down as the
   * reveal catches words out: a row not yet revealed has not been caught yet, so
   * it is still counted, and once struck by the round's own rule a row stays
   * struck.
   *
   * Self-validation is the one thing that moves this number *up* — a scorer
   * taking back a word they had disowned. Manual marks are counted whether or
   * not their row is on screen yet, so this reads the same on the TV as on the
   * phone that made them.
   */
  unique: number;
  /** The latest step any of this card's rows struck on. */
  struckAt: number | null;
  /**
   * The latest *back-check* strike. Drives the penalty ring and the dip — the
   * active card does not flinch at its own words.
   */
  flinchAt: number | null;
  /**
   * Rows struck so far, and of those, how many were back-checks. These are the
   * *ordinals* the stat blink and the card's dip key their restart off, not
   * `struckAt`/`flinchAt`: those are step numbers, and two strikes two steps
   * apart share a parity, so an animation keyed on the step silently fails to
   * re-fire and the flash is simply missed.
   */
  strikeCount: number;
  flinchCount: number;
  /**
   * Manual marks on this card's rows, in total — the ordinal the UNIQUE blink
   * restarts off, alongside `strikeCount`.
   */
  selfMarkCount: number;
  /**
   * Where the *most recent* manual mark in the room left this card: "struck" or
   * "restored", or null when the last mark was on somebody else's card (or there
   * has been none). Paired with `selfMarkAt` by `uniqueDirection`.
   */
  selfDirection: "struck" | "restored" | null;
  /** Server time of that mark, or null. */
  selfMarkAt: number | null;
};

export function cardView(
  schedule: RevealSchedule,
  scorer: ScorerResult,
  step: number,
  marks: SelfMarks = NO_SELF_MARKS,
): CardView {
  let shown = 0;
  let struck = 0;
  let flinched = 0;
  let struckAt: number | null = null;
  let flinchAt: number | null = null;
  let selfStruck = 0;
  let selfMarkCount = 0;
  let selfDirection: "struck" | "restored" | null = null;
  let selfMarkAt: number | null = null;

  scorer.entries.forEach((entry, index) => {
    const row = rowView(schedule, scorer.id, index, step, marks);
    const key = rowKey(scorer.id, index);
    // Counted off the reveal, unlike everything else here: a scorer can disown a
    // word before the TV reaches it, and the number has to agree on both.
    // Guarded on `alsoBy` so a mark that somehow landed on a duplicate cannot
    // subtract the same word twice — the same rule the server enforces.
    if (entry.alsoBy.length === 0) {
      selfMarkCount += markCount(marks, key);
      if (row.selfStruck || (!row.revealed && isSelfStruck(marks, key))) selfStruck++;
      if (marks.last?.row === key) {
        selfDirection = isSelfStruck(marks, key) ? "struck" : "restored";
        selfMarkAt = marks.last.at;
      }
    }
    if (!row.revealed) return;
    shown++;
    if (!row.struck) return;
    struck++;
    if (struckAt === null || row.struckAt! > struckAt) struckAt = row.struckAt;
    if (row.backCheck) {
      flinched++;
      if (flinchAt === null || row.struckAt! > flinchAt) flinchAt = row.struckAt;
    }
  });

  return {
    shown,
    unique: scorer.entries.length - struck - selfStruck,
    struckAt,
    flinchAt,
    strikeCount: struck,
    flinchCount: flinched,
    selfMarkCount,
    selfDirection,
    selfMarkAt,
  };
}

/**
 * Which way the UNIQUE number last moved on this card — "down" for a strike the
 * reveal landed or a word its scorer disowned, "up" for one they took back, null
 * before anything has moved it.
 *
 * The two sources are ordered against each other in *time*, because they arrive
 * differently: a revealed strike lands at `startedAt + timeOf[step]`, while a
 * manual mark carries the server time it was made. Without that comparison a
 * restore would leave the stat green for the next revealed strike to land on.
 */
export function uniqueDirection(
  schedule: RevealSchedule,
  card: CardView,
  startedAt: number,
): "up" | "down" | null {
  const strikeAt =
    card.struckAt === null ? null : startedAt + schedule.timeOf[card.struckAt];
  if (card.selfMarkAt === null) return strikeAt === null ? null : "down";
  if (strikeAt !== null && strikeAt > card.selfMarkAt) return "down";
  return card.selfDirection === "restored" ? "up" : "down";
}

/**
 * `results` as the round is actually placed and archived: every self-struck row
 * loses its `unique` and each scorer's count is recomputed from what is left.
 *
 * A disowned word keeps its `group`, which leaves it as the only member of its
 * cluster — not-unique and alone — and that is precisely the signature of a
 * self-strike in the archive, so nothing extra has to be recorded to spot one.
 *
 * Returns the identical object when nothing was marked, so the ordinary path
 * costs nothing and `reduce`'s no-op identity check still holds.
 */
export function withSelfStrikes(results: Results, marks: SelfMarks): Results {
  if (marks.last === null) return results;
  let touched = false;
  const scorers = results.scorers.map((scorer) => {
    let changed = false;
    const entries = scorer.entries.map((entry, index) => {
      if (!entry.unique) return entry;
      if (!isSelfStruck(marks, rowKey(scorer.id, index))) return entry;
      changed = true;
      return { ...entry, unique: false };
    });
    if (!changed) return scorer;
    touched = true;
    return { ...scorer, entries, unique: entries.filter((e) => e.unique).length };
  });
  return touched ? { scorers } : results;
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
