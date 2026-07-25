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
