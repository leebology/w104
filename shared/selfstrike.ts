/**
 * Self-validation: a scorer striking one of their own words out by hand.
 *
 * The room's own rule — a word scores unless somebody else had it — cannot tell
 * a real answer from a wrong one, so the results screen lets a scorer disown a
 * word they should not have been given. Tapping it again takes the point back.
 * Only words that *scored* are tappable: a duplicate is already struck, and
 * restoring one would award a point nobody ever had.
 *
 * Its own module rather than a corner of `shared/reveal.ts` because the state
 * lives on the scoring phase, and `shared/state.ts` cannot import from
 * `reveal.ts` without closing a cycle through `scoring.ts`. Nothing is imported
 * here, deliberately — rows are addressed by the reveal's own key
 * (`rowKey(scorerId, index)`), typed as a bare string for exactly that reason.
 */
export type SelfMarks = {
  /**
   * How many times each row has been tapped. **Odd means struck.**
   *
   * A count rather than a boolean because the two animations are opposites —
   * the red strike and the green restore — and an ordinal is the only thing
   * that both tells them apart and re-fires the same one twice running. Every
   * other flash in the reveal keys off an ordinal for the second half of that
   * reason; this one needs the first half too.
   *
   * A `Record` because Durable Object storage is JSON and a `Map` comes back
   * empty. Bounded by MAX_ENTRIES per scorer: a key appears only for a row that
   * has actually been tapped, and re-tapping bumps the count rather than
   * appending.
   */
  counts: Record<string, number>;
  /**
   * The most recent mark: which row, and the server time it landed. Null before
   * the first one.
   *
   * The row gives the *direction* — `counts[row]`'s parity — which is what lets
   * one UNIQUE stat blink red on the way down and green on the way up. The time
   * is what orders a manual mark against the reveal's own strikes, which arrive
   * on a schedule rather than on an event: without it a restore would leave the
   * stat green for the next revealed strike to land on.
   */
  last: { row: string; at: number } | null;
};

export const NO_SELF_MARKS: SelfMarks = { counts: {}, last: null };

export function markCount(marks: SelfMarks, row: string): number {
  return marks.counts[row] ?? 0;
}

/** Struck out by its own scorer. Odd taps on, even taps off. */
export function isSelfStruck(marks: SelfMarks, row: string): boolean {
  return markCount(marks, row) % 2 === 1;
}

/**
 * Every manual mark made in this phase, across every row. Doubles as the
 * ordinal a blink restarts off: an accepted tap adds exactly one, so the sum
 * only ever grows.
 */
export function totalMarks(marks: SelfMarks): number {
  let total = 0;
  for (const row in marks.counts) total += marks.counts[row];
  return total;
}

/**
 * Toggles one row, or returns the **identical object** when the row is already
 * the way the caller asked for — the no-op contract `reduce` relies on.
 */
export function toggleMark(
  marks: SelfMarks,
  row: string,
  struck: boolean,
  now: number,
): SelfMarks {
  if (isSelfStruck(marks, row) === struck) return marks;
  return {
    counts: { ...marks.counts, [row]: markCount(marks, row) + 1 },
    last: { row, at: now },
  };
}
