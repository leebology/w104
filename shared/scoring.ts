import type { Entry, PlayerId } from "./state";
import type { Scorer, ScorerId } from "./teams";

/**
 * Case, accents and punctuation are noise — "Beyoncé" and "beyonce" are the
 * same answer. Everything downstream compares normalized forms only.
 */
export function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // combining marks left by NFKD
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Optimal string alignment distance — Levenshtein plus adjacent transposition,
 * so "adlee" is one fat-fingered edit from "adele" rather than two.
 */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const d: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

/**
 * Typo tolerance scales with length. Short entries get none: "Anne" and "Anna"
 * are one edit apart and are different people, whereas at 9+ characters a
 * two-edit gap is almost always the same answer misspelled.
 */
export function allowedEdits(a: string, b: string): number {
  const len = Math.min(a.length, b.length);
  if (len < 5) return 0;
  if (len < 9) return 1;
  return 2;
}

export function isMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const allowed = allowedEdits(a, b);
  if (allowed === 0) return false;
  // Cheap reject before the O(mn) table.
  if (Math.abs(a.length - b.length) > allowed) return false;
  return editDistance(a, b) <= allowed;
}

/**
 * Bumped by hand whenever `normalize`, `allowedEdits` or `isMatch` changes.
 * The score archive stamps it on each game so a later replay can tell which
 * games were scored by which algorithm — otherwise retuning the typo
 * thresholds would silently rewrite what happened on past nights.
 */
export const SCORING_VERSION = 1;

export type ScoredEntry = {
  text: string;      // as the player typed it
  /** Which member wrote it. The scorer's own id when teams are off. */
  by: PlayerId;
  unique: boolean;
  /**
   * Which cluster of matching answers this entry landed in. Stable and unique
   * within one round, but not contiguous — treat it as an opaque label, never
   * as an index. Every entry sharing a `group` matched every other, so a
   * self-join on it recovers who cancelled whom, including three-way and
   * larger collisions.
   *
   * Exposed rather than derived downstream because `alsoBy` cannot rebuild it:
   * one scorer can write two different words that were each cancelled by
   * exactly the same rival, which is one `alsoBy` value and two clusters.
   * The archive needs the real thing, and a second union-find pass somewhere
   * else could drift from this one.
   */
  group: number;
  /**
   * The other scorers who also had this word. Ids rather than display
   * strings: a team is identified by a colour, which a pre-baked emoji string
   * cannot carry, and every screen already has the scorer list to resolve
   * against.
   */
  alsoBy: ScorerId[];
};

export type ScorerResult = Scorer & {
  total: number;   // distinct words written
  unique: number;  // words no other scorer had
  entries: ScoredEntry[];
};

export type Results = { scorers: ScorerResult[] };

export type ScoreInput = {
  scorers: Scorer[];
  /** Still keyed by player. A team's list is its members' merged. */
  entries: Record<PlayerId, Entry[]>;
};

type Flat = { scorerId: ScorerId; by: PlayerId; text: string; norm: string; at: number };

export function scoreRound(input: ScoreInput): Results {
  // 1. Flatten each scorer's list — for a team, its members' lists merged in
  //    submission order — dropping blanks and the scorer's own repeats. Two
  //    teammates writing the same word therefore count once for the team,
  //    with no special case for it.
  const flat: Flat[] = [];
  for (const scorer of input.scorers) {
    const seen = new Set<string>();
    const own = scorer.members
      .flatMap((id) => input.entries[id] ?? [])
      .sort((x, y) => x.at - y.at);
    for (const entry of own) {
      const norm = normalize(entry.text);
      if (norm === "" || seen.has(norm)) continue;
      seen.add(norm);
      flat.push({
        scorerId: scorer.id, by: entry.by, text: entry.text, norm, at: entry.at,
      });
    }
  }

  // 2. Union-find groups every spelling of the same answer into one cluster.
  //    Eight scorers at 40 words is ~51k comparisons — microseconds.
  const parent = flat.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]; // path halving
      i = parent[i];
    }
    return i;
  };
  for (let i = 0; i < flat.length; i++) {
    for (let j = i + 1; j < flat.length; j++) {
      if (!isMatch(flat[i].norm, flat[j].norm)) continue;
      const ri = find(i);
      const rj = find(j);
      if (ri !== rj) parent[rj] = ri;
    }
  }

  // 3. Which scorers landed in each cluster.
  const roots = flat.map((_, i) => find(i));
  const clusterScorers = new Map<number, Set<ScorerId>>();
  flat.forEach((f, i) => {
    let set = clusterScorers.get(roots[i]);
    if (!set) {
      set = new Set<ScorerId>();
      clusterScorers.set(roots[i], set);
    }
    set.add(f.scorerId);
  });

  // 4. Project back onto each scorer, preserving submission order.
  const scorers: ScorerResult[] = input.scorers.map((scorer) => {
    const entries: ScoredEntry[] = [];
    flat.forEach((f, i) => {
      if (f.scorerId !== scorer.id) return;
      const others = [...clusterScorers.get(roots[i])!].filter(
        (id) => id !== scorer.id,
      );
      entries.push({
        text: f.text,
        by: f.by,
        unique: others.length === 0,
        // The union-find root itself. Renumbering these 0..n would be tidier
        // to read in a database dump and would cost a second pass over every
        // entry — measurably, on a ten-player room at the entry cap. Nothing
        // needs them contiguous, only equal within a cluster.
        group: roots[i],
        alsoBy: others,
      });
    });
    return {
      ...scorer,
      total: entries.length,
      unique: entries.filter((e) => e.unique).length,
      entries,
    };
  });

  return { scorers };
}
