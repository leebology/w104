/**
 * The writing phase before its own screens exist. Deliberately the same shape
 * as `TimesUp` — a phase that renders one line — so it is a working screen and
 * not a placeholder that throws. Tasks 10 and 11 replace both call sites.
 */
export function Writing() {
  return (
    <main className="screen screen--center">
      <p className="big-word">Writing categories…</p>
    </main>
  );
}
