import type { Entry, Player, PlayerId } from "./state";

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

export type ScoredEntry = {
  text: string;      // as the player typed it
  unique: boolean;
  alsoBy: string[];  // emoji of every other player who had this word
};

export type PlayerResult = {
  id: PlayerId;
  name: string;
  emoji: string;
  total: number;   // distinct words written
  unique: number;  // words no other player had
  entries: ScoredEntry[];
};

export type Results = { players: PlayerResult[] };

export type ScoreInput = {
  players: Player[];
  entries: Record<PlayerId, Entry[]>;
};

type Flat = { playerId: PlayerId; text: string; norm: string; at: number };

export function scoreRound(input: ScoreInput): Results {
  // 1. Flatten every player's list, dropping blanks and their own repeats.
  const flat: Flat[] = [];
  for (const player of input.players) {
    const seen = new Set<string>();
    const own = [...(input.entries[player.id] ?? [])].sort((x, y) => x.at - y.at);
    for (const entry of own) {
      const norm = normalize(entry.text);
      if (norm === "" || seen.has(norm)) continue;
      seen.add(norm);
      flat.push({ playerId: player.id, text: entry.text, norm, at: entry.at });
    }
  }

  // 2. Union-find groups every spelling of the same answer into one cluster.
  //    Eight players at 40 words is ~51k comparisons — microseconds.
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

  // 3. Which players landed in each cluster.
  const roots = flat.map((_, i) => find(i));
  const clusterPlayers = new Map<number, Set<PlayerId>>();
  flat.forEach((f, i) => {
    let set = clusterPlayers.get(roots[i]);
    if (!set) {
      set = new Set<PlayerId>();
      clusterPlayers.set(roots[i], set);
    }
    set.add(f.playerId);
  });

  // 4. Project back onto each player, preserving their submission order.
  const emojiOf = new Map(input.players.map((p) => [p.id, p.emoji]));
  const players: PlayerResult[] = input.players.map((player) => {
    const entries: ScoredEntry[] = [];
    flat.forEach((f, i) => {
      if (f.playerId !== player.id) return;
      const others = [...clusterPlayers.get(roots[i])!].filter(
        (id) => id !== player.id,
      );
      entries.push({
        text: f.text,
        unique: others.length === 0,
        alsoBy: others.map((id) => emojiOf.get(id) ?? "?"),
      });
    });
    return {
      id: player.id,
      name: player.name,
      emoji: player.emoji,
      total: entries.length,
      unique: entries.filter((e) => e.unique).length,
      entries,
    };
  });

  return { players };
}
