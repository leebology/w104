/**
 * The one seeded random number generator, in a module of its own.
 *
 * It lives here rather than in `shared/reveal.ts`, where it started, because it
 * has two callers now and they sit on opposite sides of the codebase: the
 * results reveal, which needs the same deal every time a round is replayed, and
 * `balanceTeams`, which needs a *different* deal every time the host presses
 * Auto sort. A core model file importing the reveal's scheduler to borrow six
 * lines of arithmetic would be a dependency pointing the wrong way.
 */
export type Rng = () => number;

/**
 * mulberry32 over an FNV-1a hash of the seed string. Seeded rather than
 * `Math.random` so callers stay pure: randomness enters at the edge as a seed,
 * and the same seed always deals the same sequence — which is what makes both
 * callers testable against a fixed input rather than a stubbed global.
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
