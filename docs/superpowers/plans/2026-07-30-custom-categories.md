# Custom Categories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a player-written category pool — one setting, one new `creating` phase, a forked pair of voting screens, and the animated transition between them — behind a `categorySource` setting that defaults to the existing built-in pool.

**Architecture:** All rules go in `shared/` as pure functions (`shared/customCategories.ts`), tested under the existing `shared/**/*.test.ts` vitest glob. `party/server.ts` stays plumbing. The Durable Object gains three server-only fields (`drafts`, `pool`, `deal`) stripped by `toRoomState`, plus per-socket pushes modelled exactly on `yourEntries`. Screens reuse the existing `.vote-card` / `.player-voting__*` objects; the fork is the pool source and the close sequence, never a new layout language.

**Tech Stack:** TypeScript, React 18, Vitest, PartyServer on Cloudflare Durable Objects, Vite.

**Spec:** `docs/superpowers/specs/2026-07-30-custom-categories-design.md`
**Numbers (sizes/timings/colours):** `docs/design/2026-07-30-custom-categories-brief.md`
**Traps:** `docs/design/2026-07-30-custom-categories-traps.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **Node 22.** Two tsc projects: `tsconfig.json` (src + shared, DOM) and `tsconfig.worker.json` (party + shared, workers-types). **Anything added to `shared/` must typecheck under both.** `npm run typecheck` runs both.
- **Tests live at `shared/**/*.test.ts` only.** Nothing outside `shared/` is unit-tested in this repo. Verification for UI tasks is `npm run typecheck` plus `npm run build`.
- **`reduce` is pure.** No `Date.now()`, no `Math.random()`. Randomness enters as a `roll: number` on the event, exactly as `balanceTeams` and the category draw already do.
- **Returning the identical object means "no change".** `party/server.ts` and `reduce` both rely on that identity check. Never return a fresh object for a no-op.
- **Everything persisted must survive JSON.** No `Map`, no `Set`. Every new `Room` field needs a defaulting fallback in `load()` in `party/server.ts` — `storage.get<Room>` is an unchecked cast over older stored rooms.
- **`toRoomState` is the privacy boundary.** `drafts` and `deal` are stripped there. Draft text never reaches the host TV in any form.
- **No new CSS tokens, no loose hex, no `color-mix()`, no `oklch()`.** Existing `:root` tokens only.
- **`--border` and `--radius` never animate.** Translate, rotate, scale, opacity only. No soft shadows — every shadow is a hard ink offset.
- **Every keyframe needs an A/B pair** alternated by index parity. An identical `animation` string does not restart. `popInA/B` and `dipA/B` are the precedent.
- **Every animation degrades under `prefers-reduced-motion: reduce` to the settled end state**, not to "no animation".
- **Commits stage explicit paths.** Never `git add -A` — the untracked working note `Project W-104.md` must stay untracked.
- **Bump the version in every PR**, in three places kept in sync: `package.json`, `package-lock.json` top-level `version`, and the one under `packages: { "": ... }`. Do this once, in Task 16.

## File Structure

| File | Responsibility |
| --- | --- |
| `shared/customCategories.ts` (new) | Every rule: quota, vote budget, pool construction, the deal, board shaping, the draw. Pure. |
| `shared/customCategories.test.ts` (new) | Property tests for all of the above. |
| `shared/gamemodes.ts` | Gains a `choice` descriptor kind and the `categorySource` spec. |
| `shared/state.ts` | `creating` phase, `drafts`/`pool`/`deal` fields, `toRoomState` derivation, `categorySource` on `MatchSettings`. |
| `shared/reduce.ts` | Phase entry/exit, the three draft events, custom `castVote`, `settle`, `isHoldable`. |
| `shared/views.ts` | Two new view ids. |
| `shared/protocol.ts` | Four new client messages, two new server messages. |
| `party/server.ts` | Message dispatch, per-socket pushes, `load()` fallbacks, close hook. |
| `src/components/SettingChoice.tsx` (new) | The two-option track inside a Stepper card. |
| `src/screens/host/HostCreating.tsx` (new) | The creation TV — both layouts. |
| `src/screens/player/PlayerCreating.tsx` (new) | The creation phone. |
| `src/screens/host/HostVotingCustom.tsx` (new) | The custom board and its authorship close. |
| `src/screens/player/PlayerVotingCustom.tsx` (new) | The hand UI. |
| `src/screens/host/HostVoting.tsx` | Dispatches to the custom board; exports `balancedRows` generically. |
| `src/screens/player/PlayerVoting.tsx` | Dispatches to the hand UI. |
| `src/screens/{host,player}/{HostView,PlayerView}.tsx` | The `creating` case. |
| `src/viewport.ts` | Sets `.creating--compact` below 620px. |
| `src/style.css` | The new classes and keyframes. |

---

## Task 1: The numbers — `quotaFor`, `voteBudgetFor`, `exposureFor`

**Files:**
- Create: `shared/customCategories.ts`
- Create: `shared/customCategories.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `HAND_SIZE = 3`, `VOTE_BUDGET = 4`, `MAX_QUOTA = 4`, `POOL_EXCESS = 1.5`, `TINY_ROOM = 2`, `WRITE_MS = 60_000`, `MAX_CATEGORY_LEN = 20`; `quotaFor(playerCount: number, roundCount: number): number`, `voteBudgetFor(): number`, `exposureFor(quota: number): number`.

- [ ] **Step 1: Write the failing test**

Create `shared/customCategories.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  HAND_SIZE, MAX_QUOTA, VOTE_BUDGET,
  exposureFor, quotaFor, voteBudgetFor,
} from "./customCategories";

describe("quotaFor", () => {
  it("keeps a small room's pool worth voting on", () => {
    expect(quotaFor(3, 1)).toBe(3);
    expect(quotaFor(4, 1)).toBe(3);
    expect(quotaFor(5, 1)).toBe(2);
    expect(quotaFor(8, 1)).toBe(1);
    expect(quotaFor(20, 1)).toBe(1);
  });

  it("grows the pool to half again the round count", () => {
    expect(quotaFor(3, 10)).toBe(4);
    expect(quotaFor(4, 10)).toBe(4);
    expect(quotaFor(5, 10)).toBe(3);
    expect(quotaFor(8, 10)).toBe(2);
    expect(quotaFor(10, 10)).toBe(2);
    expect(quotaFor(20, 10)).toBe(1);
  });

  it("never exceeds the writing ceiling for a real room", () => {
    for (let p = 3; p <= 30; p++) {
      for (let r = 1; r <= 10; r++) {
        expect(quotaFor(p, r)).toBeLessThanOrEqual(MAX_QUOTA);
        expect(quotaFor(p, r)).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("covers the round count at every real room size", () => {
    for (let p = 3; p <= 30; p++) {
      for (let r = 1; r <= 10; r++) {
        expect(p * quotaFor(p, r)).toBeGreaterThanOrEqual(r);
      }
    }
  });

  it("bends the rules for one- and two-player rooms", () => {
    // Exact coverage, no excess, no ceiling — with a floor of three so a hand
    // of three distinct cards exists at all.
    expect(quotaFor(1, 1)).toBe(3);
    expect(quotaFor(1, 10)).toBe(10);
    expect(quotaFor(2, 1)).toBe(2);
    expect(quotaFor(2, 10)).toBe(5);
  });
});

describe("voteBudgetFor", () => {
  it("is four, and four is what makes exposure exact", () => {
    expect(voteBudgetFor()).toBe(VOTE_BUDGET);
    // 12 is the only product of HAND_SIZE and a workable budget that every
    // quota from 1 to MAX_QUOTA divides. This test is the reason the number
    // is 4 — if it fails, the vote count has been changed without the maths.
    for (let q = 1; q <= MAX_QUOTA; q++) {
      expect((HAND_SIZE * VOTE_BUDGET) % q).toBe(0);
    }
  });
});

describe("exposureFor", () => {
  it("is a whole number for every real quota", () => {
    expect(exposureFor(1)).toBe(12);
    expect(exposureFor(2)).toBe(6);
    expect(exposureFor(3)).toBe(4);
    expect(exposureFor(4)).toBe(3);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
npx vitest run shared/customCategories.test.ts
```

Expected: FAIL — `Failed to resolve import "./customCategories"`.

- [ ] **Step 3: Write the implementation**

Create `shared/customCategories.ts`:

```ts
import type { PlayerId } from "./state";

/**
 * A player-written category pool. Every rule lives here so it tests in
 * milliseconds; `party/server.ts` only sequences these calls.
 *
 * See docs/superpowers/specs/2026-07-30-custom-categories-design.md.
 */

/** Cards dealt per hand. Fixed by the phone layout. */
export const HAND_SIZE = 3;

/**
 * Votes each player gets, at every room size. **Not a preference.**
 *
 * Equal exposure (see `buildDeal`) requires the quota to divide
 * `HAND_SIZE * VOTE_BUDGET`. The quota ranges over 1..MAX_QUOTA, and 12 is the
 * smallest number all four divide — so 4 is the only fixed vote count that is
 * exact at every pool shape. Six breaks at a quota of 4; five works at 1 and 3
 * and nowhere else.
 */
export const VOTE_BUDGET = 4;

/**
 * The writing ceiling. Five was considered and rejected: 5 does not divide 12,
 * so it is the one quota that cannot deliver exact exposure. The cost is
 * confined to a 3-player 10-round match, which builds a 12-card pool for 10
 * rounds instead of 15.
 */
export const MAX_QUOTA = 4;

/**
 * The pool is half again the round count. Smaller and every category plays,
 * which makes the vote decide nothing but running order; larger and the
 * writing load stops being worth a phone keyboard.
 */
export const POOL_EXCESS = 1.5;

/** At or below this many players the rules bend — see `quotaFor`. */
export const TINY_ROOM = 2;

/** The writing window. A constant, not a setting: `durationSec` is the round. */
export const WRITE_MS = 60_000;

/** Characters a player may type into one category. */
export const MAX_CATEGORY_LEN = 20;

/** What a creation slot is showing on the TV. Never the text. */
export type SlotState = "empty" | "writing" | "done";

export type PoolCard = {
  /**
   * Opaque and shuffled at construction, deliberately: a positional id would
   * name the seat it came from, and the pool ships to every client during
   * voting. Stable through voting, the draw and the reveal.
   */
  id: string;
  text: string;
  /** `null` for a house card. Withheld from clients until the phase closes. */
  authorId: PlayerId | null;
  /** Which of the author's slots this came from. */
  slot: number;
};

export type Hand = { cardIds: string[] };

/**
 * Cards each player writes: enough to make a pool worth voting on, and enough
 * to cover the match, capped so the writing stays short.
 *
 * The band is the floor that keeps a 3-player one-round match from voting on a
 * pool of three. Round coverage is the other half, and it is what makes a long
 * match ask for more writing rather than shortening itself.
 *
 * One- and two-player rooms bend both rules: exact coverage, no excess and no
 * ceiling, with a floor of three cards because a hand is three distinct cards
 * and a solo host on a one-round match would otherwise build a pool of one.
 */
export function quotaFor(playerCount: number, roundCount: number): number {
  const players = Math.max(1, Math.floor(playerCount));
  const rounds = Math.max(1, Math.floor(roundCount));
  if (players <= TINY_ROOM) {
    return Math.max(Math.ceil(rounds / players), Math.ceil(HAND_SIZE / players));
  }
  const band = players <= 4 ? 3 : players <= 7 ? 2 : 1;
  const covering = Math.ceil((POOL_EXCESS * rounds) / players);
  return Math.min(MAX_QUOTA, Math.max(band, covering));
}

/**
 * A function rather than the bare constant so both counters read the same
 * thing — the TV prompt and the phone's pips. Do not inline `VOTE_BUDGET` at
 * either call site.
 */
export function voteBudgetFor(): number {
  return VOTE_BUDGET;
}

/**
 * How many hands every card appears in, room-wide. Exact, not ±1.
 *
 * Total dealt slots are `players * VOTE_BUDGET * HAND_SIZE` over a pool of
 * `players * quota`, so the player count cancels and this is `12 / quota`.
 */
export function exposureFor(quota: number): number {
  return (HAND_SIZE * VOTE_BUDGET) / quota;
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
npx vitest run shared/customCategories.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
```

```bash
git add shared/customCategories.ts shared/customCategories.test.ts
git commit -m "feat(custom): the pool and vote-budget arithmetic"
```

---

## Task 2: `buildPool` — writing turns into cards

**Files:**
- Modify: `shared/customCategories.ts`
- Modify: `shared/customCategories.test.ts`

**Interfaces:**
- Consumes: `PoolCard`, `MAX_CATEGORY_LEN` from Task 1.
- Produces: `buildPool(playerIds: readonly PlayerId[], drafts: Record<PlayerId, string[]>, quota: number, houseTexts: readonly string[], roll: number): PoolCard[]` — returns exactly `playerIds.length * quota` cards **in seat-major order**, index `seat * quota + slot`. Also `publicPool(pool: readonly PoolCard[], revealAuthors: boolean): PoolCard[]`.

- [ ] **Step 1: Write the failing test**

Append to `shared/customCategories.test.ts`:

```ts
import { buildPool, publicPool } from "./customCategories";

const seats = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);
const HOUSE = ["woman", "animal", "song", "movie", "country"];

describe("buildPool", () => {
  it("puts one card in every slot, in seat-major order", () => {
    const pool = buildPool(
      seats(3),
      { p0: ["a", "b"], p1: ["c", "d"], p2: ["e", "f"] },
      2,
      HOUSE,
      0.5,
    );
    expect(pool).toHaveLength(6);
    expect(pool.map((c) => c.text)).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(pool.map((c) => c.authorId)).toEqual(["p0", "p0", "p1", "p1", "p2", "p2"]);
    expect(pool.map((c) => c.slot)).toEqual([0, 1, 0, 1, 0, 1]);
  });

  it("backfills a blank slot with a house card", () => {
    const pool = buildPool(seats(2), { p0: ["a", ""], p1: ["", "d"] }, 2, HOUSE, 0.5);
    expect(pool.map((c) => c.authorId)).toEqual(["p0", null, null, "p1"]);
    expect(pool[1].text).not.toBe("");
    expect(HOUSE).toContain(pool[1].text);
  });

  it("makes every card a house card when nobody writes anything", () => {
    const pool = buildPool(seats(3), {}, 1, HOUSE, 0.2);
    expect(pool).toHaveLength(3);
    expect(pool.every((c) => c.authorId === null)).toBe(true);
  });

  it("trims and caps what a player typed", () => {
    const long = "x".repeat(40);
    const pool = buildPool(seats(1), { p0: [`  spaced  `, long] }, 2, HOUSE, 0.1);
    expect(pool[0].text).toBe("spaced");
    expect(pool[1].text).toHaveLength(MAX_CATEGORY_LEN);
  });

  it("gives every card a unique id that does not name its seat", () => {
    const pool = buildPool(
      seats(4),
      { p0: ["a"], p1: ["b"], p2: ["c"], p3: ["d"] },
      1,
      HOUSE,
      0.7,
    );
    const ids = pool.map((c) => c.id);
    expect(new Set(ids).size).toBe(4);
    // Seat-major order must not be recoverable from the ids, or a client
    // holding the public pool could read authorship straight off them.
    expect(ids).not.toEqual([...ids].sort());
  });
});

describe("publicPool", () => {
  it("hides authors and re-orders by id while voting is open", () => {
    const pool = buildPool(
      seats(3),
      { p0: ["a"], p1: ["b"], p2: ["c"] },
      1,
      HOUSE,
      0.33,
    );
    const shown = publicPool(pool, false);
    expect(shown.every((c) => c.authorId === null)).toBe(true);
    expect(shown.map((c) => c.id)).toEqual([...shown.map((c) => c.id)].sort());
  });

  it("restores authors at the close", () => {
    const pool = buildPool(seats(2), { p0: ["a"], p1: ["b"] }, 1, HOUSE, 0.33);
    const shown = publicPool(pool, true);
    expect(shown.map((c) => c.authorId).sort()).toEqual(["p0", "p1"]);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
npx vitest run shared/customCategories.test.ts
```

Expected: FAIL — `buildPool is not a function`.

- [ ] **Step 3: Write the implementation**

Add to `shared/customCategories.ts` (import `seededRng` and `Rng` at the top):

```ts
import { seededRng } from "./rng";
import type { Rng } from "./rng";
```

```ts
/** Fisher-Yates on a copy. The one shuffle helper this module uses. */
function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * One card per slot, in seat-major order — `pool[seat * quota + slot]`.
 * `buildDeal` relies on that layout to know which seat a card came from
 * without the card having to carry it.
 *
 * **House cards do not exist before this call.** A blank slot becomes one
 * here and nowhere earlier: the creation TV must never render one, because a
 * house card appearing while people are still writing says "nobody wrote
 * this" about a slot somebody may still be filling.
 *
 * House texts are dealt from a shuffled copy of the stock list and cycle if
 * there are more blanks than categories. A repeat is legal — identical texts
 * are separate cards through voting by design.
 *
 * Ids are assigned through a shuffle so they carry no seat information: the
 * pool ships to every client during voting, and a positional id would hand
 * them authorship for free.
 */
export function buildPool(
  playerIds: readonly PlayerId[],
  drafts: Record<PlayerId, string[]>,
  quota: number,
  houseTexts: readonly string[],
  roll: number,
): PoolCard[] {
  const rng = seededRng(`pool:${roll}`);
  const size = playerIds.length * quota;
  const house = houseTexts.length > 0 ? shuffled(houseTexts, rng) : ["category"];
  const ids = shuffled(
    Array.from({ length: size }, (_, i) => `c${i}`),
    rng,
  );

  const out: PoolCard[] = [];
  let houseNext = 0;
  playerIds.forEach((playerId, seat) => {
    const mine = drafts[playerId] ?? [];
    for (let slot = 0; slot < quota; slot++) {
      const typed = (mine[slot] ?? "").trim().slice(0, MAX_CATEGORY_LEN);
      const blank = typed === "";
      out.push({
        id: ids[seat * quota + slot],
        text: blank ? house[houseNext++ % house.length] : typed,
        authorId: blank ? null : playerId,
        slot,
      });
    }
  });
  return out;
}

/**
 * The client's copy. Sorted by id — which is random with respect to seats —
 * so the wire order leaks nothing, and stripped of authorship until the phase
 * closes.
 *
 * Authorship is withheld from *everyone*, not just from non-authors: it is the
 * one reveal this feature exists for, and a client that had it early could
 * render it early.
 */
export function publicPool(
  pool: readonly PoolCard[],
  revealAuthors: boolean,
): PoolCard[] {
  return [...pool]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((c) => (revealAuthors ? { ...c } : { ...c, authorId: null }));
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
npx vitest run shared/customCategories.test.ts
```

Expected: PASS. If the "does not name its seat" assertion is flaky at `roll: 0.7`, that is a real failure — the ids must be shuffled, not merely relabelled.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
```

```bash
git add shared/customCategories.ts shared/customCategories.test.ts
git commit -m "feat(custom): build the pool, house-backfilled and author-blind"
```

---

## Task 3: `buildDeal` — the exact-exposure deal

This is the load-bearing task. Write the properties as tests **before** the implementation; they are the contract, and a rare collision must never be "fixed" with a filter, because a filter breaks exposure and exposure is what makes the vote fair.

**Files:**
- Modify: `shared/customCategories.ts`
- Modify: `shared/customCategories.test.ts`

**Interfaces:**
- Consumes: `PoolCard`, `Hand`, `HAND_SIZE`, `VOTE_BUDGET`, `TINY_ROOM`, `exposureFor`, `shuffled` from Tasks 1–2.
- Produces: `buildDeal(pool: readonly PoolCard[], playerIds: readonly PlayerId[], quota: number, roll: number): Record<PlayerId, Hand[]>`.

- [ ] **Step 1: Write the failing property tests**

Append to `shared/customCategories.test.ts`:

```ts
import { buildDeal, exposureFor as expo } from "./customCategories";

/** A room where everybody wrote every slot. */
function room(players: number, quota: number, roll = 0.42) {
  const ids = seats(players);
  const drafts: Record<string, string[]> = {};
  ids.forEach((id, i) => {
    drafts[id] = Array.from({ length: quota }, (_, s) => `${id}-cat-${s}`);
  });
  const pool = buildPool(ids, drafts, quota, HOUSE, roll);
  return { ids, pool, deal: buildDeal(pool, ids, quota, roll) };
}

describe("buildDeal", () => {
  const shapes: Array<[number, number]> = [
    [3, 3], [3, 4], [4, 3], [4, 4], [5, 2], [5, 3],
    [6, 2], [7, 2], [8, 1], [8, 2], [10, 1], [10, 2],
    [13, 1], [20, 1], [30, 1],
  ];

  it("gives every player exactly VOTE_BUDGET hands of HAND_SIZE", () => {
    for (const [players, quota] of shapes) {
      const { ids, deal } = room(players, quota);
      for (const id of ids) {
        expect(deal[id]).toHaveLength(VOTE_BUDGET);
        for (const hand of deal[id]) {
          expect(hand.cardIds).toHaveLength(HAND_SIZE);
        }
      }
    }
  });

  it("never repeats a card inside one hand", () => {
    for (const [players, quota] of shapes) {
      const { ids, deal } = room(players, quota);
      for (const id of ids) {
        for (const hand of deal[id]) {
          expect(new Set(hand.cardIds).size).toBe(HAND_SIZE);
        }
      }
    }
  });

  it("never deals a player their own card", () => {
    for (const [players, quota] of shapes) {
      const { ids, pool, deal } = room(players, quota);
      const authorOf = new Map(pool.map((c) => [c.id, c.authorId]));
      for (const id of ids) {
        for (const hand of deal[id]) {
          for (const cardId of hand.cardIds) {
            expect(authorOf.get(cardId)).not.toBe(id);
          }
        }
      }
    }
  });

  it("shows every card exactly the same number of times", () => {
    for (const [players, quota] of shapes) {
      const { ids, pool, deal } = room(players, quota);
      const seen = new Map<string, number>(pool.map((c) => [c.id, 0]));
      for (const id of ids) {
        for (const hand of deal[id]) {
          for (const cardId of hand.cardIds) {
            seen.set(cardId, (seen.get(cardId) ?? 0) + 1);
          }
        }
      }
      const counts = [...seen.values()];
      // Exact, not ±1. This is the property that makes the vote fair.
      expect(new Set(counts).size).toBe(1);
      expect(counts[0]).toBe(expo(quota));
    }
  });

  it("spreads a player's repeats evenly", () => {
    for (const [players, quota] of shapes) {
      const { ids, deal } = room(players, quota);
      for (const id of ids) {
        const mine = new Map<string, number>();
        for (const hand of deal[id]) {
          for (const cardId of hand.cardIds) {
            mine.set(cardId, (mine.get(cardId) ?? 0) + 1);
          }
        }
        const counts = [...mine.values()];
        expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("does not filter teammates out — there is no team filter at all", () => {
    // A team filter would break equal exposure, which is why the deal knows
    // nothing about teams. Asserted as a shape property: with 4 players and a
    // quota of 3, every one of the 9 non-own cards must be reachable.
    const { ids, pool, deal } = room(4, 3);
    const authorOf = new Map(pool.map((c) => [c.id, c.authorId]));
    const mine = new Set(deal[ids[0]].flatMap((h) => h.cardIds));
    const others = pool.filter((c) => authorOf.get(c.id) !== ids[0]);
    expect(mine.size).toBe(others.length);
  });

  it("deals a player their own cards only when there is nobody else", () => {
    for (const players of [1, 2]) {
      const quota = quotaFor(players, 3);
      const { ids, deal } = room(players, quota);
      for (const id of ids) {
        expect(deal[id]).toHaveLength(VOTE_BUDGET);
        for (const hand of deal[id]) {
          expect(hand.cardIds).toHaveLength(HAND_SIZE);
          expect(new Set(hand.cardIds).size).toBe(HAND_SIZE);
        }
      }
    }
  });

  it("gives two rolls two different deals", () => {
    const a = room(8, 2, 0.11);
    const b = room(8, 2, 0.88);
    const flat = (d: Record<string, Hand[]>) =>
      JSON.stringify(Object.values(d).map((hs) => hs.map((h) => h.cardIds)));
    expect(flat(a.deal)).not.toBe(flat(b.deal));
  });

  it("returns an empty deal for an empty room", () => {
    expect(buildDeal([], [], 1, 0.5)).toEqual({});
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
npx vitest run shared/customCategories.test.ts
```

Expected: FAIL — `buildDeal is not a function`.

- [ ] **Step 3: Write the implementation**

Add to `shared/customCategories.ts`:

```ts
/**
 * Splits one player's dealt cards into hands.
 *
 * Greedy on remaining count, so a card that has to appear twice is placed
 * while there are still hands left to place it in, with ties broken by the rng
 * — that tie-break is what stops two hands coming out as the same three cards
 * in a small room, which the obvious round-robin does constantly.
 *
 * The `!hand.includes` filter is the no-duplicate-within-a-hand rule and is
 * the only filter in this file. It cannot break exposure: it rearranges a
 * multiset that `buildDeal` has already fixed.
 */
function toHands(cardIds: readonly string[], rng: Rng): Hand[] {
  const remaining = new Map<string, number>();
  for (const id of cardIds) remaining.set(id, (remaining.get(id) ?? 0) + 1);

  const hands: Hand[] = [];
  for (let h = 0; h < VOTE_BUDGET; h++) {
    const hand: string[] = [];
    for (let i = 0; i < HAND_SIZE; i++) {
      const candidates = [...remaining.entries()].filter(
        ([id, n]) => n > 0 && !hand.includes(id),
      );
      if (candidates.length === 0) break;
      const most = Math.max(...candidates.map(([, n]) => n));
      const top = candidates.filter(([, n]) => n === most);
      const [id] = top[Math.floor(rng() * top.length)];
      hand.push(id);
      remaining.set(id, (remaining.get(id) ?? 0) - 1);
    }
    hands.push({ cardIds: hand });
  }
  return hands;
}

/**
 * Who sees what. Solved in one shot at the close, never sampled per hand.
 *
 * The construction is a walk around a ring of seats, one slot at a time. Seat
 * `k` takes, from every slot, the cards sitting at ring offsets `1, 2, …`
 * cycled — never offset 0, which is what "never your own card" is, and cycling
 * is what lets a room with fewer non-own cards than dealt slots still fill
 * them. Because every seat walks the *same* multiset of offsets, every card is
 * taken exactly as many times as every other: exposure is exact by
 * construction rather than by correction.
 *
 * **The ring is a shuffled seat order, and that matters.** The walk is
 * deterministic, so an unshuffled ring would make every hand "one card from
 * each of the next three seats" and hand authorship to anyone who noticed.
 *
 * One- and two-player rooms cannot satisfy any of this — there is nobody
 * else's card to deal — so they fall back to a cyclic walk of the whole pool
 * with own cards included. They are exempt from exact exposure by design; see
 * the spec's §3.4.
 */
export function buildDeal(
  pool: readonly PoolCard[],
  playerIds: readonly PlayerId[],
  quota: number,
  roll: number,
): Record<PlayerId, Hand[]> {
  const out: Record<PlayerId, Hand[]> = {};
  const players = playerIds.length;
  if (players === 0 || pool.length === 0) return out;

  const rng = seededRng(`deal:${roll}`);
  const slots = VOTE_BUDGET * HAND_SIZE;

  if (players <= TINY_ROOM) {
    playerIds.forEach((id, k) => {
      const start = Math.floor(rng() * pool.length) + k;
      const picks = Array.from(
        { length: slots },
        (_, i) => pool[(start + i) % pool.length].id,
      );
      out[id] = toHands(picks, rng);
    });
    return out;
  }

  // `ring[r]` is the seat standing at ring position r; `posOf[k]` is where
  // seat k stands. Two arrays rather than repeated `indexOf`, so the walk is
  // linear and the permutation is used in both directions.
  const ring = shuffled(
    playerIds.map((_, i) => i),
    rng,
  );
  const posOf = new Array<number>(players);
  ring.forEach((seat, position) => {
    posOf[seat] = position;
  });

  const exposure = exposureFor(quota);
  playerIds.forEach((id, seat) => {
    const picks: string[] = [];
    for (let slot = 0; slot < quota; slot++) {
      for (let t = 0; t < exposure; t++) {
        // Offsets run 1..players-1 and cycle. Never 0.
        const offset = 1 + (t % (players - 1));
        const owner = ring[(posOf[seat] + offset) % players];
        picks.push(pool[owner * quota + slot].id);
      }
    }
    out[id] = toHands(picks, rng);
  });
  return out;
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
npx vitest run shared/customCategories.test.ts
```

Expected: PASS, all shapes. If "shows every card exactly the same number of times" fails, **do not add a filter or a repair pass** — the offset walk is wrong and must be fixed instead.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
```

```bash
git add shared/customCategories.ts shared/customCategories.test.ts
git commit -m "feat(custom): the deal, with exposure exact by construction"
```

---

## Task 4: Board shaping and the draw

**Files:**
- Modify: `shared/customCategories.ts`
- Modify: `shared/customCategories.test.ts`
- Modify: `shared/voting.ts`
- Modify: `shared/voting.test.ts`

**Interfaces:**
- Consumes: `PoolCard` from Task 2; `VoteMap`, `tallyVotes` from `shared/voting.ts`.
- Produces: `BOARD_CAP = 10`; `boardCards(pool, tally): { shown: PoolCard[]; packCount: number }`; `customShares(pool, votes): Record<string, number>`; `pickCustomCategory(pool, votes, spent, roll): string`. In `shared/voting.ts`, `voteShares` gains an optional order argument: `voteShares(votes: VoteMap, order?: readonly string[]): Record<string, number>`.

- [ ] **Step 1: Write the failing tests**

Append to `shared/customCategories.test.ts`:

```ts
import { BOARD_CAP, boardCards, customShares, pickCustomCategory } from "./customCategories";

const card = (id: string, text: string, authorId: string | null = "p0") =>
  ({ id, text, authorId, slot: 0 });

describe("boardCards", () => {
  it("keeps every card on the board while votes are landing", () => {
    const pool = [card("c0", "a"), card("c1", "b"), card("c2", "c")];
    const { shown, packCount } = boardCards(pool, { c1: 2 });
    expect(shown).toHaveLength(3);
    expect(packCount).toBe(0);
    expect(shown[0].id).toBe("c1");
  });

  it("caps the board at ten and counts the rest", () => {
    const pool = Array.from({ length: 30 }, (_, i) => card(`c${i}`, `t${i}`));
    const { shown, packCount } = boardCards(pool, { c5: 4, c9: 2 });
    expect(shown).toHaveLength(BOARD_CAP);
    expect(packCount).toBe(20);
    expect(shown[0].id).toBe("c5");
    expect(shown[1].id).toBe("c9");
  });

  it("orders identically for identical votes, by id", () => {
    const pool = [card("c2", "b"), card("c0", "a"), card("c1", "c")];
    expect(boardCards(pool, {}).shown.map((c) => c.id)).toEqual(["c0", "c1", "c2"]);
  });
});

describe("customShares", () => {
  it("is computed over voted cards only and sums to 100", () => {
    const pool = [card("c0", "a"), card("c1", "b"), card("c2", "c")];
    const shares = customShares(pool, { p0: { c0: 1 }, p1: { c1: 2 } });
    expect(shares.c2).toBeUndefined();
    expect(shares.c0 + shares.c1).toBe(100);
  });
});

describe("pickCustomCategory", () => {
  it("draws a voted card before an unvoted one", () => {
    const pool = [card("c0", "alpha"), card("c1", "beta")];
    const votes = { p0: { c1: 3 } };
    for (const roll of [0, 0.25, 0.5, 0.75, 0.999]) {
      expect(pickCustomCategory(pool, votes, [], roll)).toBe("beta");
    }
  });

  it("falls back to the unvoted cards once the voted ones are spent", () => {
    const pool = [card("c0", "alpha"), card("c1", "beta")];
    const votes = { p0: { c1: 3 } };
    expect(pickCustomCategory(pool, votes, ["beta"], 0.5)).toBe("alpha");
  });

  it("merges identical texts into one entry with the summed weight", () => {
    // Two people wrote "smells". Two cards and two tallies through voting;
    // one entry in the draw, weighted 1 + 1 against "other"'s 2 — so the two
    // outcomes are equally likely rather than "smells" being half as likely.
    const pool = [
      card("c0", "smells", "p0"),
      card("c1", "smells", "p1"),
      card("c2", "other", "p2"),
    ];
    const votes = { p0: { c1: 1 }, p1: { c0: 1 }, p2: { c2: 2 } };
    expect(pickCustomCategory(pool, votes, [], 0.1)).toBe("smells");
    expect(pickCustomCategory(pool, votes, [], 0.9)).toBe("other");
  });

  it("never redraws a category already played", () => {
    const pool = [card("c0", "alpha"), card("c1", "beta")];
    expect(pickCustomCategory(pool, {}, ["alpha"], 0.9)).toBe("beta");
  });
});
```

Append to `shared/voting.test.ts`:

```ts
describe("voteShares with an explicit order", () => {
  it("breaks remainder ties by the given order rather than the ballot", () => {
    const votes = { a: { x: 1 }, b: { y: 1 }, c: { z: 1 } };
    const shares = voteShares(votes, ["z", "y", "x"]);
    expect(shares.x + shares.y + shares.z).toBe(100);
    // 33.33 each: the extra point goes to whichever sorts first in `order`.
    expect(shares.z).toBe(34);
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
npx vitest run shared/customCategories.test.ts shared/voting.test.ts
```

Expected: FAIL — `boardCards is not a function`, and the `voteShares` order test fails on the third argument being ignored.

- [ ] **Step 3: Generalise `voteShares`**

In `shared/voting.ts`, change the signature and the `order` computation. Replace the `export function voteShares(votes: VoteMap): Record<string, number> {` line and the `order:` field inside `exact`:

```ts
export function voteShares(
  votes: VoteMap,
  /**
   * Remainder tie-break order. Defaults to the built-in ballot; the custom
   * pool passes its own card ids, because `BALLOT.indexOf` would hand every
   * one of them -1 and float them all to the front of every tie.
   */
  order: readonly string[] = BALLOT,
): Record<string, number> {
```

and inside the `exact` map:

```ts
    order: order.indexOf(category),
```

- [ ] **Step 4: Write the board and draw functions**

Add to `shared/customCategories.ts` (extend the imports):

```ts
import { tallyVotes } from "./voting";
import type { VoteMap } from "./voting";
import { voteShares } from "./voting";
```

```ts
/**
 * The most cards the TV board can carry. A measured ceiling, not a taste call:
 * a name is `max(24px, min(cap, 17cqw))` and 24px is the hard TV floor. At
 * eight cards per row the smallest card is ~104px wide, `17cqw` lands near
 * 12.7px, and the `max()` then clamps a 24px name into a box that cannot hold
 * it. Five per row puts the smallest card at ~146px, where the floor fits.
 */
export const BOARD_CAP = 10;

/**
 * What the board shows, strongest first, and how many cards it could not fit.
 *
 * Unvoted cards stay on the board while voting is open — they hold its shape,
 * so a quiet board reads as quiet rather than as broken. They leave at the
 * close, which is `customShares`' business, not this one's.
 *
 * Ties break by id so the same votes always produce the same board.
 */
export function boardCards(
  pool: readonly PoolCard[],
  tally: Record<string, number>,
): { shown: PoolCard[]; packCount: number } {
  const ranked = [...pool].sort((a, b) => {
    const diff = (tally[b.id] ?? 0) - (tally[a.id] ?? 0);
    return diff !== 0 ? diff : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return {
    shown: ranked.slice(0, BOARD_CAP),
    packCount: Math.max(0, ranked.length - BOARD_CAP),
  };
}

/**
 * Closing percentages, over voted cards only. Zero-vote cards leave the board
 * at the close, so including them in the denominator would understate every
 * share that is left.
 */
export function customShares(
  pool: readonly PoolCard[],
  votes: VoteMap,
): Record<string, number> {
  return voteShares(votes, pool.map((c) => c.id));
}

/**
 * The round's category, weighted by vote share over what is left.
 *
 * **Identical texts merge here and only here.** Two cards reading "smells" are
 * two cards on the board with two tallies — merging them earlier would tell
 * the room that two people matched, which is an authorship leak — and one
 * entry in the draw carrying the summed weight, so the room's appetite for
 * "smells" is counted once rather than split in half against itself.
 *
 * A zero-vote card is not dead, it is last in line: the draw takes voted cards
 * first and falls back to a uniform draw over the unvoted ones only when it has
 * run out. Same shape as `pickCategory` for the built-in pool.
 */
export function pickCustomCategory(
  pool: readonly PoolCard[],
  votes: VoteMap,
  spent: readonly string[],
  roll: number,
): string {
  const isSpent = new Set(spent);
  const tally = tallyVotes(votes);

  const weights = new Map<string, number>();
  const unvoted: string[] = [];
  for (const card of pool) {
    if (isSpent.has(card.text)) continue;
    const n = tally[card.id] ?? 0;
    if (n > 0) weights.set(card.text, (weights.get(card.text) ?? 0) + n);
    else if (!unvoted.includes(card.text)) unvoted.push(card.text);
  }

  if (weights.size > 0) return weightedPick([...weights.entries()], roll).pick;
  if (unvoted.length > 0) {
    return weightedPick(unvoted.map((t) => [t, 1] as [string, number]), roll).pick;
  }
  // Every text has been played. Unreachable while the pool covers the round
  // count, which `quotaFor` guarantees — a guard, not a case.
  return pool.length > 0 ? pool[0].text : "";
}
```

**Reuse `weightedPick`, do not copy it.** `shared/voting.ts` already has the
cumulative-distribution walk, complete with the roll clamp and the
`fraction` return the built-in draw needs. Export it from there:

```ts
export function weightedPick(
```

and import it here. A second copy would be the same arithmetic in two files,
free to drift, and the clamp is the kind of detail that drifts first.

- [ ] **Step 5: Run the tests and watch them pass**

```bash
npx vitest run
```

Expected: PASS. The full suite runs because `voteShares` changed — every existing caller must still pass.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
```

```bash
git add shared/customCategories.ts shared/customCategories.test.ts shared/voting.ts shared/voting.test.ts
git commit -m "feat(custom): shape the board, and draw with identical texts merged"
```

---

## Task 5: The setting

**Files:**
- Modify: `shared/gamemodes.ts`
- Modify: `shared/gamemodes.test.ts`
- Modify: `shared/state.ts`
- Modify: `shared/reduce.ts`
- Modify: `shared/protocol.ts`
- Modify: `party/server.ts`
- Create: `src/components/SettingChoice.tsx`
- Modify: `src/screens/host/GameSettingsDrawer.tsx`
- Modify: `src/style.css`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `MatchSettings.categorySource: CategorySource` where `type CategorySource = "stock" | "custom"`; `CHOICE_SETTING_KEYS`, `type ChoiceSettingKey = "categorySource"`; `SettingSpec` becomes `NumericSettingSpec | ChoiceSettingSpec`; `isNumericSpec(spec): spec is NumericSettingSpec`; `normalizeChoice(spec, value, current): string`; `customEnabled(settings): boolean`. Client message gains `{ type: "setSettings"; values: Partial<Record<NumericSettingKey, number>>; choices?: Partial<Record<ChoiceSettingKey, string>> }`.

- [ ] **Step 1: Write the failing test**

Append to `shared/gamemodes.test.ts`:

```ts
import {
  GAME_MODES, customEnabled, defaultSettings, isNumericSpec, normalizeChoice,
} from "./gamemodes";

describe("the categories setting", () => {
  it("is the fourth card, after teams", () => {
    const keys = GAME_MODES.ffa.settings.map((s) => s.key);
    expect(keys).toEqual(["roundCount", "durationSec", "teamCount", "categorySource"]);
  });

  it("defaults to the built-in pool", () => {
    expect(defaultSettings("ffa").categorySource).toBe("stock");
    expect(customEnabled(defaultSettings("ffa"))).toBe(false);
  });

  it("separates the two descriptor kinds", () => {
    const specs = GAME_MODES.ffa.settings;
    expect(specs.filter(isNumericSpec)).toHaveLength(3);
    expect(specs.filter((s) => !isNumericSpec(s))).toHaveLength(1);
  });

  it("falls back to the current value for an option it does not know", () => {
    const spec = GAME_MODES.ffa.settings.find((s) => s.key === "categorySource")!;
    expect(isNumericSpec(spec)).toBe(false);
    if (isNumericSpec(spec)) return;
    expect(normalizeChoice(spec, "custom", "stock")).toBe("custom");
    expect(normalizeChoice(spec, "nonsense", "stock")).toBe("stock");
    expect(normalizeChoice(spec, undefined, "custom")).toBe("custom");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run shared/gamemodes.test.ts
```

Expected: FAIL — `customEnabled is not a function`.

- [ ] **Step 3: Extend the descriptor system**

In `shared/gamemodes.ts`, replace the `SettingSpec` / `GameMode` block and add the new pieces:

```ts
/** The two-option settings a descriptor is allowed to drive. */
export type ChoiceSettingKey = "categorySource";

export type CategorySource = "stock" | "custom";

export const CATEGORY_SOURCES: readonly CategorySource[] = ["stock", "custom"];

export type NumericSettingSpec = {
  key: NumericSettingKey;
  label: string;
  kind: SettingKind;
  min: number;
  max: number;
  default: number;
};

/**
 * A setting whose value is a word rather than a number. Kept a separate shape
 * rather than a numeric one with two values, because the drawer renders the
 * option's own label and a 0/1 stepper would have to invent one.
 */
export type ChoiceSettingSpec = {
  key: ChoiceSettingKey;
  label: string;
  kind: "choice";
  options: ReadonlyArray<{ value: string; label: string }>;
  default: string;
};

export type SettingSpec = NumericSettingSpec | ChoiceSettingSpec;

export function isNumericSpec(spec: SettingSpec): spec is NumericSettingSpec {
  return spec.kind !== "choice";
}
```

Add the fourth descriptor to `GAME_MODES.ffa.settings`, after `teamCount`:

```ts
      {
        key: "categorySource",
        label: "CATEGORIES",
        kind: "choice",
        options: [
          { value: "stock", label: "DEFAULT" },
          { value: "custom", label: "CUSTOM" },
        ],
        default: "stock",
      },
```

Update `defaultSettings` — it currently assigns `settings[spec.key] = spec.default`, which no longer typechecks across the union:

```ts
export function defaultSettings(id: GameModeId): MatchSettings {
  const settings: MatchSettings = {
    mode: id,
    roundCount: DEFAULT_ROUND_COUNT,
    durationSec: DEFAULT_DURATION_SEC,
    teamCount: 0,
    categorySource: "stock",
  };
  for (const spec of GAME_MODES[id].settings) {
    if (isNumericSpec(spec)) settings[spec.key] = spec.default;
    else settings[spec.key] = spec.default as CategorySource;
  }
  return settings;
}
```

Add the choice normalizer beside `normalizeSetting`:

```ts
/**
 * Clamps a host-supplied choice to one the descriptor actually offers. Falls
 * back to what is already set for anything unrecognised, exactly as
 * `normalizeSetting` falls back on a non-finite number — settings arrive over
 * a socket, and the drawer's refusal to render a third option is not a
 * guarantee.
 */
export function normalizeChoice(
  spec: ChoiceSettingSpec,
  value: string | undefined,
  current: string,
): string {
  if (value === undefined) return current;
  return spec.options.some((o) => o.value === value) ? value : current;
}

/** Whether this match writes its own categories. One place, many readers. */
export function customEnabled(settings: Pick<MatchSettings, "categorySource">): boolean {
  return settings.categorySource === "custom";
}
```

- [ ] **Step 4: Add the field to `MatchSettings`**

In `shared/state.ts`, add to `MatchSettings` (and import `CategorySource`):

```ts
  /**
   * Where this match's categories come from. `"stock"` is the built-in ten;
   * `"custom"` inserts the writing phase. See shared/customCategories.ts.
   */
  categorySource: CategorySource;
```

and in `createRoom`, nothing changes — `defaultSettings` already supplies it.

- [ ] **Step 5: Accept the choice in `reduce`**

In `shared/reduce.ts`, change the `setSettings` event shape and `applySettings`:

```ts
  | {
      t: "setSettings";
      playerId: PlayerId;
      /** Only keys the *active mode* exposes are honoured. */
      values: Partial<Record<NumericSettingKey, number>>;
      choices: Partial<Record<ChoiceSettingKey, string>>;
      now: number;
    }
```

```ts
function applySettings(
  settings: MatchSettings,
  values: Partial<Record<NumericSettingKey, number>>,
  choices: Partial<Record<ChoiceSettingKey, string>>,
): MatchSettings {
  let next = settings;
  for (const spec of modeSpec(settings.mode).settings) {
    if (isNumericSpec(spec)) {
      const value = normalizeSetting(spec, values[spec.key], settings[spec.key]);
      if (value !== next[spec.key]) next = { ...next, [spec.key]: value };
    } else {
      const value = normalizeChoice(spec, choices[spec.key], settings[spec.key]);
      if (value !== next[spec.key]) {
        next = { ...next, [spec.key]: value as CategorySource };
      }
    }
  }
  return next;
}
```

`clampToMode` needs the same union guard — wrap its body in `if (isNumericSpec(spec))`.

Update the `setSettings` case to pass `ev.choices`. Update the imports at the top of `reduce.ts` to pull in `isNumericSpec`, `normalizeChoice`, and the two new types.

- [ ] **Step 6: Carry it over the wire**

In `shared/protocol.ts`:

```ts
  | {
      type: "setSettings";
      values: Partial<Record<NumericSettingKey, number>>;
      choices?: Partial<Record<ChoiceSettingKey, string>>;
    }
```

with `ChoiceSettingKey` added to the existing type import from `./gamemodes`.

In `party/server.ts`, the `setSettings` case:

```ts
          values: msg.values ?? {},
          choices: msg.choices ?? {},
```

and in `load()`, inside the `settings` IIFE, add the backfill beside the others:

```ts
          categorySource: stored?.categorySource === "custom" ? "custom" : "stock",
```

- [ ] **Step 7: Build the control**

Create `src/components/SettingChoice.tsx`:

```tsx
import type { ChoiceSettingSpec } from "../../shared/gamemodes";

type Props = {
  spec: ChoiceSettingSpec;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
};

/**
 * A Stepper card whose control row holds two words instead of `− 3 +`. Same
 * card, same 11px label, same 38px row — the four drawer cards have to stack
 * as one rhythm, so this is a `.stepper` with a different row, not a new
 * object.
 *
 * The lit option is a fill inside a sunken track, with no border and no
 * shadow: at drawer distance a fill reads where a tick does not, and a
 * bordered segment inside a bordered track draws a double rule.
 */
export function SettingChoice({ spec, value, disabled, onChange }: Props) {
  return (
    <div className={disabled ? "stepper stepper--disabled" : "stepper"}>
      <span className="stepper__label">{spec.label}</span>
      <div className="setting-choice" role="group" aria-label={spec.label}>
        {spec.options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={
              option.value === value
                ? "setting-choice__opt setting-choice__opt--on"
                : "setting-choice__opt"
            }
            aria-pressed={option.value === value}
            disabled={disabled}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
```

Rewrite the map in `src/screens/host/GameSettingsDrawer.tsx`:

```tsx
        {mode.settings.map((spec) =>
          isNumericSpec(spec) ? (
            <Stepper
              key={spec.key}
              label={spec.label}
              value={room.settings[spec.key]}
              min={spec.min}
              max={spec.max}
              disabled={disabled}
              {...stepperPropsForKind(spec.kind)}
              onChange={(value) =>
                roomStore.send({ type: "setSettings", values: { [spec.key]: value } })
              }
            />
          ) : (
            <SettingChoice
              key={spec.key}
              spec={spec}
              value={room.settings[spec.key]}
              disabled={disabled}
              onChange={(value) =>
                roomStore.send({
                  type: "setSettings",
                  values: {},
                  choices: { [spec.key]: value },
                })
              }
            />
          ),
        )}
```

with `isNumericSpec` imported from `../../../shared/gamemodes` and `SettingChoice` from `../../components/SettingChoice`.

- [ ] **Step 8: Add the CSS**

Append to `src/style.css`, next to the `.stepper` rules:

```css
/* A Stepper's control row, holding two words instead of a number. The 38px
   height is what keeps the four drawer cards stacking as one rhythm. */
.setting-choice {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  height: 38px;
  width: 200px;
  background: var(--code-empty);
  /* `--border` is the whole shorthand (`3px solid var(--ink)`), not a width.
     Adding `solid var(--ink)` after it makes the declaration invalid and the
     border vanishes. */
  border: var(--border);
  border-radius: 10px;
  padding: 4px;
}

.setting-choice__opt {
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  border-radius: 7px;
  font-family: "Bungee", sans-serif;
  font-size: 14px;
  line-height: 1;
  color: var(--ink-dim);
  cursor: pointer;
}

/* A fill, not a border: a bordered segment inside a bordered track draws a
   double rule, and at drawer distance a fill reads where a tick does not. */
.setting-choice__opt--on {
  background: var(--gold);
  color: var(--ink-gold);
}

.stepper--disabled .setting-choice__opt {
  cursor: default;
}
```

- [ ] **Step 9: Verify and commit**

```bash
npm run typecheck && npm test && npm run build
```

Expected: typecheck clean under both projects, all tests pass, build succeeds. Toggling the setting changes nothing else yet.

```bash
git add shared/gamemodes.ts shared/gamemodes.test.ts shared/state.ts shared/reduce.ts shared/protocol.ts party/server.ts src/components/SettingChoice.tsx src/screens/host/GameSettingsDrawer.tsx src/style.css
git commit -m "feat(custom): the categories setting, and a choice descriptor kind"
```

---

## Task 6: Room state for the writing phase

**Files:**
- Modify: `shared/state.ts`
- Modify: `shared/state.test.ts`
- Modify: `party/server.ts`

**Interfaces:**
- Consumes: `SlotState`, `PoolCard`, `Hand` from Tasks 1–3.
- Produces: `Phase` gains `{ name: "creating"; endsAt: number }` and `countdown.to` gains `"creating"`; `Room` gains `drafts: Record<PlayerId, string[]>`, `cursors: Record<PlayerId, number>`, `pool: PoolCard[] | null`, `deal: Record<PlayerId, Hand[]>`, `authorsRevealed: boolean`; `RoomState` strips `drafts` and `deal` and gains `slotStates: Record<PlayerId, SlotState[]>`; `countdownScreen` gains `"creating"`; `slotStatesFor(draft, cursor, quota): SlotState[]` in `customCategories.ts`.

- [ ] **Step 1: Write the failing test**

Append to `shared/state.test.ts`:

```ts
import { createRoom, toRoomState } from "./state";

describe("the creating phase's privacy boundary", () => {
  it("strips drafts and the deal, and derives slot states in their place", () => {
    const room = createRoom("JADE", 0);
    room.players = [
      { id: "p0", name: "A", emoji: "🐝", ready: false, connected: true, teamId: null },
      { id: "p1", name: "B", emoji: "🦊", ready: false, connected: true, teamId: null },
    ];
    room.settings = { ...room.settings, categorySource: "custom" };
    room.phase = { name: "creating", endsAt: 1000 };
    room.drafts = { p0: ["smells", ""], p1: ["", ""] };
    room.cursors = { p0: 1, p1: 0 };
    room.deal = { p0: [{ cardIds: ["c1", "c2", "c3"] }] };

    const state = toRoomState(room, 0);
    expect("drafts" in state).toBe(false);
    expect("deal" in state).toBe(false);
    // Nothing anywhere in the payload may contain what somebody typed.
    expect(JSON.stringify(state)).not.toContain("smells");
    expect(state.slotStates.p0).toEqual(["done", "writing"]);
    expect(state.slotStates.p1).toEqual(["writing", "empty"]);
  });

  it("carries no slot states outside the creating phase", () => {
    const room = createRoom("JADE", 0);
    room.drafts = { p0: ["secret"] };
    expect(toRoomState(room, 0).slotStates).toEqual({});
  });
});
```

Append to `shared/customCategories.test.ts`:

```ts
import { slotStatesFor } from "./customCategories";

describe("slotStatesFor", () => {
  it("reads done from the text and writing from the cursor", () => {
    expect(slotStatesFor(["a", "", ""], 1, 3)).toEqual(["done", "writing", "empty"]);
  });

  it("does not call a slot writing once it is committed", () => {
    expect(slotStatesFor(["a", "b"], 0, 2)).toEqual(["done", "done"]);
  });

  it("treats whitespace as blank", () => {
    expect(slotStatesFor(["   "], 0, 1)).toEqual(["writing"]);
  });

  it("pads a short or missing draft array to the quota", () => {
    expect(slotStatesFor(undefined, 0, 2)).toEqual(["writing", "empty"]);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run shared/state.test.ts shared/customCategories.test.ts
```

Expected: FAIL — `slotStatesFor is not a function`, and `state.slotStates` is undefined.

- [ ] **Step 3: Add `slotStatesFor`**

Add to `shared/customCategories.ts`:

```ts
/**
 * What each of one player's slots is showing on the TV.
 *
 * **"Writing" means the phone's cursor is on that slot**, not that keys are
 * moving. Driving it from anything finer would leave a lying animation on a
 * slot somebody half-wrote and then skipped past.
 *
 * Derived rather than stored, so there is no second copy of the truth to
 * drift, and — the point of the whole arrangement — the drafts themselves
 * never have to leave the server for the TV to be right.
 */
export function slotStatesFor(
  draft: readonly string[] | undefined,
  cursor: number,
  quota: number,
): SlotState[] {
  return Array.from({ length: quota }, (_, i) => {
    if ((draft?.[i] ?? "").trim() !== "") return "done";
    return i === cursor ? "writing" : "empty";
  });
}
```

- [ ] **Step 4: Extend `Room`, `Phase` and `toRoomState`**

In `shared/state.ts`:

Add the phase, between `teams` and `voting`:

```ts
  /**
   * Players writing this match's categories. One window per match, and only
   * reachable when `categorySource` is `"custom"`.
   */
  | { name: "creating"; endsAt: number }
```

Widen the countdown: `to: "creating" | "voting" | "playing"`.

Add to `Room`:

```ts
  /**
   * What each player has committed, per slot. `""` is uncommitted.
   *
   * **Server-only, and the reason `toRoomState` derives `slotStates`.** The
   * creation TV shows progress, never content: printing the drafts would let
   * the room read and judge before the vote and spoil the reveal this feature
   * exists for. A top-level field rather than a member of the phase, because
   * `toRoomState` strips whole fields and a nested one would ride out.
   */
  drafts: Record<PlayerId, string[]>;
  /**
   * Which slot each phone is sitting on. Public — it is the only thing that
   * drives the writing state on the TV, and it says nothing about the text.
   */
  cursors: Record<PlayerId, number>;
  /**
   * This match's written categories, built at the close of `creating` and
   * never before. `null` outside a custom match.
   *
   * Rides in `RoomState`, with `authorId` nulled until `authorsRevealed`.
   */
  pool: PoolCard[] | null;
  /**
   * Who sees which cards. **Server-only:** a leaked hand plus a public tally
   * lets the room deduce who voted for what. Each player gets their own hands
   * down their own socket, the way `entries` reaches a team.
   */
  deal: Record<PlayerId, Hand[]>;
  /**
   * Whether the pool's authorship has been handed to the clients. Flipped when
   * voting closes and nowhere else — it is the reveal.
   */
  authorsRevealed: boolean;
```

Add to `createRoom`'s return: `drafts: {}, cursors: {}, pool: null, deal: {}, authorsRevealed: false,`.

Rewrite `RoomState` and `toRoomState`:

```ts
export type RoomState = Omit<
  Room,
  "entries" | "lastActivityAt" | "kicked" | "hostGoneAt" | "drafts" | "deal"
> & {
  serverTime: number;
  /**
   * Derived from `drafts` and `cursors` at the boundary, so the TV can render
   * three states per slot without the text ever crossing it. Empty outside the
   * `creating` phase.
   */
  slotStates: Record<PlayerId, SlotState[]>;
};

export function toRoomState(room: Room, now: number): RoomState {
  const {
    entries: _entries,
    lastActivityAt: _lastActivityAt,
    kicked: _kicked,
    hostGoneAt: _hostGoneAt,
    drafts,
    deal: _deal,
    ...rest
  } = room;

  const slotStates: Record<PlayerId, SlotState[]> = {};
  if (room.phase.name === "creating") {
    const quota = quotaFor(room.players.length, room.settings.roundCount);
    for (const player of room.players) {
      slotStates[player.id] = slotStatesFor(
        drafts[player.id],
        room.cursors[player.id] ?? 0,
        quota,
      );
    }
  }

  return {
    ...rest,
    pool: room.pool ? publicPool(room.pool, room.authorsRevealed) : null,
    slotStates,
    serverTime: now,
  };
}
```

with `import { publicPool, quotaFor, slotStatesFor } from "./customCategories";` and `import type { Hand, PoolCard, SlotState } from "./customCategories";` at the top.

> **Import-cycle note:** `customCategories.ts` imports only the *type* `PlayerId` from `state.ts`, so this edge is type-only in one direction and safe. Do not add a runtime import from `customCategories.ts` back to `state.ts`.

Add the `creating` branch to `countdownScreen`:

```ts
  if (view.phase.name === "countdown" && view.phase.to === "creating") {
    return teamsEnabled(view.settings) ? "teams" : "lobby";
  }
```

and widen its return type to include `"creating"`, adding to the final line nothing — `creating` is only ever a countdown *destination*, never the screen under one.

- [ ] **Step 5: Add the `load()` fallbacks**

In `party/server.ts`'s `load()`, beside the existing ones:

```ts
      drafts: rest.drafts ?? {},
      cursors: rest.cursors ?? {},
      pool: rest.pool ?? null,
      deal: rest.deal ?? {},
      authorsRevealed: rest.authorsRevealed ?? false,
```

- [ ] **Step 6: Run and commit**

```bash
npx vitest run && npm run typecheck
```

Expected: PASS. `HostView`/`PlayerView` will now fail typecheck on the unhandled `creating` phase — **that is the annotation doing its job**, and it is the repo's only guard against a missing phase, so it must not be silenced with a `default:` branch.

Close it properly, with a real interim screen rather than a throw. Create `src/screens/shared/Writing.tsx`:

```tsx
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
```

and wire `case "creating": return <Writing />;` in both views.

```bash
git add shared/state.ts shared/state.test.ts shared/customCategories.ts shared/customCategories.test.ts party/server.ts src/screens/host/HostView.tsx src/screens/player/PlayerView.tsx
git commit -m "feat(custom): room state for the writing phase, drafts server-side"
```

---

## Task 7: The phase in `reduce`

**Files:**
- Modify: `shared/reduce.ts`
- Modify: `shared/reduce.test.ts`
- Modify: `shared/protocol.ts`
- Modify: `shared/views.ts`
- Modify: `shared/views.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces: `RoomEvent` gains `{ t: "moveCursor"; playerId; slot; now }`, `{ t: "commitDraft"; playerId; slot; text; now }`, `{ t: "clearDraft"; playerId; slot; now }`; `ClientMessage` gains the matching three; `VIEWS` gains `{ id: "countdownToCreating" }` and `{ id: "creating" }`.

- [ ] **Step 1: Write the failing tests**

Append to `shared/reduce.test.ts` (follow the file's existing room-builder helpers):

```ts
describe("the creating phase", () => {
  const custom = (players: number, roundCount = 3) => {
    let room = roomWith(players); // existing helper: N connected, unready players
    room = { ...room, settings: { ...room.settings, categorySource: "custom", roundCount } };
    return room;
  };

  it("opens a countdown to creating rather than to voting", () => {
    let room = custom(3);
    room = reduce(room, { t: "startGame", playerId: room.hostId!, now: 0 });
    expect(room.phase).toEqual({ name: "countdown", endsAt: COUNTDOWN_MS, to: "creating" });
  });

  it("opens the writing window at the whistle, and clears readiness", () => {
    let room = custom(3);
    room = reduce(room, { t: "startGame", playerId: room.hostId!, now: 0 });
    room = reduce(room, { t: "tick", now: COUNTDOWN_MS, roll: 0.5 });
    expect(room.phase).toEqual({ name: "creating", endsAt: COUNTDOWN_MS + WRITE_MS });
    expect(room.players.every((p) => !p.ready)).toBe(true);
    expect(room.pool).toBeNull();
  });

  it("readies a player only when every slot they own is committed", () => {
    let room = creatingRoom(3, 3); // helper: 3 players, quota 3, phase creating
    const me = room.players[0].id;
    room = reduce(room, { t: "commitDraft", playerId: me, slot: 0, text: "smells", now: 1 });
    expect(room.players[0].ready).toBe(false);
    room = reduce(room, { t: "commitDraft", playerId: me, slot: 1, text: "noises", now: 2 });
    room = reduce(room, { t: "commitDraft", playerId: me, slot: 2, text: "places", now: 3 });
    expect(room.players[0].ready).toBe(true);
  });

  it("trims, caps and rejects an out-of-range slot", () => {
    let room = creatingRoom(3, 3);
    const me = room.players[0].id;
    room = reduce(room, { t: "commitDraft", playerId: me, slot: 0, text: "  a  ", now: 1 });
    expect(room.drafts[me][0]).toBe("a");
    room = reduce(room, { t: "commitDraft", playerId: me, slot: 1, text: "x".repeat(40), now: 2 });
    expect(room.drafts[me][1]).toHaveLength(MAX_CATEGORY_LEN);
    const before = room;
    room = reduce(room, { t: "commitDraft", playerId: me, slot: 9, text: "no", now: 3 });
    expect(room).toBe(before);
  });

  it("un-readies on a clear, and that tears the close down", () => {
    let room = allWritten(3, 3); // helper: everyone committed, so everyone ready
    const me = room.players[0].id;
    room = reduce(room, { t: "clearDraft", playerId: me, slot: 0, now: 5 });
    expect(room.players[0].ready).toBe(false);
    expect(room.phase.name).toBe("creating");
  });

  it("closes when everyone is ready, building the pool and the deal once", () => {
    const room = allWritten(4, 3);
    // `settle` runs on the event that completed the last player, so the room
    // has already left `creating`.
    expect(room.phase.name).toBe("voting");
    expect(room.pool).toHaveLength(12);
    expect(Object.keys(room.deal)).toHaveLength(4);
  });

  it("closes on the deadline with blanks backfilled", () => {
    let room = creatingRoom(4, 3);
    room = reduce(room, { t: "tick", now: 10 ** 9, roll: 0.5 });
    expect(room.phase.name).toBe("voting");
    expect(room.pool!.every((c) => c.authorId === null)).toBe(true);
  });

  it("moves the cursor without touching readiness", () => {
    let room = creatingRoom(3, 3);
    const me = room.players[0].id;
    room = reduce(room, { t: "moveCursor", playerId: me, slot: 2, now: 1 });
    expect(room.cursors[me]).toBe(2);
    expect(room.players[0].ready).toBe(false);
  });

  it("steps back one phase, not all the way home", () => {
    let room = creatingRoom(3, 3);
    room = reduce(room, { t: "backToLobby", playerId: room.hostId!, now: 1 });
    expect(room.phase.name).toBe("lobby");
    expect(room.drafts).toEqual({});
  });

  it("never opens for a stock match", () => {
    let room = roomWith(3);
    room = reduce(room, { t: "startGame", playerId: room.hostId!, now: 0 });
    expect(room.phase).toEqual({ name: "countdown", endsAt: COUNTDOWN_MS, to: "voting" });
  });
});
```

Append to `shared/views.test.ts`:

```ts
it("carries the writing phase and its countdown", () => {
  expect(VIEWS.map((v) => v.id)).toContain("creating");
  expect(VIEWS.map((v) => v.id)).toContain("countdownToCreating");
  expect(isViewId("creating")).toBe(true);
  expect(currentView({ phase: { name: "creating", endsAt: 0 } })).toBe("creating");
  expect(
    currentView({ phase: { name: "countdown", endsAt: 0, to: "creating" } }),
  ).toBe("countdownToCreating");
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
npx vitest run shared/reduce.test.ts shared/views.test.ts
```

Expected: FAIL on every new case.

- [ ] **Step 3: Extend the view catalog**

In `shared/views.ts`, insert into `VIEWS` after `teams` (play order is the render order):

```ts
  { id: "countdownToCreating", label: "Countdown → write" },
  { id: "creating", label: "Write categories" },
```

and in `currentView`:

```ts
  if (phase.name === "countdown") {
    if (phase.to === "creating") return "countdownToCreating";
    return phase.to === "voting" ? "countdownToVoting" : "countdownToPlaying";
  }
```

Add both to `jumpTo` in `reduce.ts`: `countdownToCreating` joins the existing countdown case (mapping to `to: "creating"`), and `creating` gets its own:

```ts
    case "creating": {
      const staged = standUpTeams(base);
      return {
        ...staged,
        phase: { name: "creating", endsAt: now + WRITE_MS },
        players: unready(staged.players),
        drafts: {},
        cursors: {},
        pool: null,
        deal: {},
        authorsRevealed: false,
      };
    }
```

- [ ] **Step 4: Add the three events**

In `shared/reduce.ts`'s `RoomEvent` union:

```ts
  /**
   * The phone publishing which slot it is on. Cheap and frequent; the only
   * thing that drives the writing state on the TV, and it carries no text.
   */
  | { t: "moveCursor"; playerId: PlayerId; slot: number; now: number }
  /**
   * Committing a category. **Committing is readying** — never on keystroke,
   * or the phase could close under a player mid-word.
   */
  | { t: "commitDraft"; playerId: PlayerId; slot: number; text: string; now: number }
  /** Taking one back. Un-readies, which tears down an in-flight close. */
  | { t: "clearDraft"; playerId: PlayerId; slot: number; now: number }
```

Add the helper and the three cases to `reduce`:

```ts
/** This room's quota, derived from the live room. Never stored. */
function quotaOf(room: Room): number {
  return quotaFor(room.players.length, room.settings.roundCount);
}

/** Whether every slot this player owns holds something. */
function hasWrittenAll(room: Room, playerId: PlayerId): boolean {
  const quota = quotaOf(room);
  const mine = room.drafts[playerId] ?? [];
  for (let i = 0; i < quota; i++) {
    if ((mine[i] ?? "").trim() === "") return false;
  }
  return true;
}

function writeSlot(room: Room, playerId: PlayerId, slot: number, text: string): Room {
  const quota = quotaOf(room);
  if (!Number.isInteger(slot) || slot < 0 || slot >= quota) return room;
  if (!room.players.some((p) => p.id === playerId)) return room;

  const mine = [...(room.drafts[playerId] ?? [])];
  while (mine.length < quota) mine.push("");
  const next = text.trim().slice(0, MAX_CATEGORY_LEN);
  if (mine[slot] === next) return room;
  mine[slot] = next;

  const drafts = { ...room.drafts, [playerId]: mine };
  const staged: Room = { ...room, drafts };
  return {
    ...staged,
    players: mapPlayer(staged.players, playerId, (p) => ({
      ...p,
      ready: hasWrittenAll(staged, playerId),
    })),
  };
}
```

```ts
    case "moveCursor": {
      if (room.phase.name !== "creating") return room;
      const quota = quotaOf(room);
      if (!Number.isInteger(ev.slot) || ev.slot < 0 || ev.slot >= quota) return room;
      if (room.cursors[ev.playerId] === ev.slot) return room;
      return { ...room, cursors: { ...room.cursors, [ev.playerId]: ev.slot } };
    }

    case "commitDraft": {
      if (room.phase.name !== "creating") return room;
      return writeSlot(room, ev.playerId, ev.slot, ev.text);
    }

    case "clearDraft": {
      if (room.phase.name !== "creating") return room;
      // Goes through the same path a commit does, so un-readying is the same
      // one rule rather than a second copy of it — and `settle` then tears
      // down any close this player's readiness was holding open.
      return writeSlot(room, ev.playerId, ev.slot, "");
    }
```

- [ ] **Step 5: Route the phase**

`openCountdown`'s `to` parameter widens to `"creating" | "voting" | "playing"`.

Add a helper naming the edge, and use it in the three places that open a countdown out of the lobby or team select:

```ts
/** Where a match heads once the room is settled: writing first, if custom. */
function afterLobby(room: Room): "creating" | "voting" {
  return customEnabled(room.settings) ? "creating" : "voting";
}
```

- In `settle`'s `lobby` branch: `openCountdown(room, now, afterLobby(room))`.
- In `settle`'s `teams` branch: `openCountdown(room, now, afterLobby(room))`.
- In `startGame`'s `from === "teams"` branch: `to: afterLobby(room)`.
- In `startGame`'s final return: `to: from === "lobby" ? afterLobby(room) : "playing"`.

Add a `settle` branch for the phase itself, before the `voting` branch:

```ts
  if (phase.name === "creating") {
    // `ready` means "every slot committed" here — `commitDraft` and
    // `clearDraft` own the flag, the way `castVote` owns it during voting.
    // Which is why clearing a card tears the close down for free.
    return everyoneReady(room, MIN_PLAYERS) ? closeCreating(room, now) : room;
  }
```

Add the close, beside `bankRound`:

```ts
/**
 * Turns the writing window into a pool and a deal, and opens voting.
 *
 * **Both happen exactly once, here.** House cards do not exist before this
 * call, and the deal is solved in one shot rather than sampled per hand —
 * every card has to be shown to the same number of people or the vote is not
 * fair.
 *
 * No countdown on this edge: the transition between the two screens is an
 * animation, not a phase. See the design brief's §1c.
 */
// `roll` has NO default. `settle` — the everyone-finished path, which is the
// common one — has no tick behind it, and a defaulted seed would make both
// shuffles computable offline and hand authorship to anyone who bothered.
// `tick` passes its own roll; `settle` passes `seedRoll(room.code, now)`.
function closeCreating(room: Room, now: number, roll: number): Room {
  const quota = quotaOf(room);
  const playerIds = room.players.map((p) => p.id);
  const pool = buildPool(playerIds, room.drafts, quota, CATEGORIES, roll);
  return {
    ...room,
    phase: { name: "voting", endsAt: now + VOTING_MS },
    pool,
    deal: buildDeal(pool, playerIds, quota, roll),
    authorsRevealed: false,
    // `ready` means "votes spent" on the far side of this edge, so the flags
    // and the empty tally have to agree.
    players: unready(room.players),
    votes: {},
  };
}
```

Add the deadline to `tick`, before the `voting` branch:

```ts
  if (phase.name === "creating" && now >= phase.endsAt) {
    return closeCreating(room, now, roll);
  }
```

and in `tick`'s countdown branch, handle the third destination — the existing `to === "voting"` block already clears readiness and assigns stragglers, so make it cover both:

```ts
    if (phase.to === "voting" || phase.to === "creating") {
      return {
        ...room,
        phase:
          phase.to === "creating"
            ? { name: "creating", endsAt: now + WRITE_MS }
            : { name: "voting", endsAt: now + VOTING_MS },
        players: assignStragglers(room.players, room.teams).map((p) => ({
          ...p, ready: false,
        })),
        votes: {},
        drafts: phase.to === "creating" ? {} : room.drafts,
        cursors: phase.to === "creating" ? {} : room.cursors,
      };
    }
```

- [ ] **Step 6: Wire `backToLobby` and `isHoldable`**

`backToLobby` steps back one phase. Find its case and add `creating` to the list that steps to `teams` when teams are on, `lobby` otherwise — mirroring what `voting` already does — and clear `drafts`, `cursors`, `pool`, `deal` on the way out.

Widen `isHoldable`:

```ts
function isHoldable(
  phase: Room["phase"],
): phase is Extract<Room["phase"], { name: "playing" | "voting" | "creating" }> {
  return phase.name === "playing" || phase.name === "voting" || phase.name === "creating";
}
```

- [ ] **Step 7: Add the client messages**

In `shared/protocol.ts`:

```ts
  | { type: "moveCursor"; slot: number }
  | { type: "commitDraft"; slot: number; text: string }
  | { type: "clearDraft"; slot: number }
```

- [ ] **Step 8: Run and commit**

```bash
npx vitest run && npm run typecheck
```

Expected: PASS.

```bash
git add shared/reduce.ts shared/reduce.test.ts shared/protocol.ts shared/views.ts shared/views.test.ts
git commit -m "feat(custom): the writing phase, its close, and the pool it builds"
```

---

## Task 8: Voting on hands

**Files:**
- Modify: `shared/reduce.ts`
- Modify: `shared/reduce.test.ts`

**Interfaces:**
- Consumes: Tasks 3, 4, 7.
- Produces: `castVote` accepts a card id in a custom match; `handsSpent(room, playerId): number`; the `voting` close flips `authorsRevealed`.

- [ ] **Step 1: Write the failing tests**

```ts
describe("voting on hands", () => {
  it("accepts a card in one of my hands and refuses one that is not", () => {
    let room = votingRoom(4, 3); // helper: custom room already in `voting`
    const me = room.players[0].id;
    const mine = room.deal[me][0].cardIds[0];
    const theirs = room.deal[room.players[1].id][0].cardIds
      .find((id) => !room.deal[me].some((h) => h.cardIds.includes(id)))!;
    const after = reduce(room, { t: "castVote", playerId: me, category: mine, now: 1 });
    expect(after.votes[me][mine]).toBe(1);
    const refused = reduce(room, { t: "castVote", playerId: me, category: theirs, now: 1 });
    expect(refused).toBe(room);
  });

  it("stops at the budget and readies on the last vote", () => {
    let room = votingRoom(4, 3);
    const me = room.players[0].id;
    for (const hand of room.deal[me]) {
      room = reduce(room, { t: "castVote", playerId: me, category: hand.cardIds[0], now: 1 });
    }
    expect(votesSpent(room.votes[me])).toBe(VOTE_BUDGET);
    expect(room.players[0].ready).toBe(true);
    const extra = reduce(room, {
      t: "castVote", playerId: me, category: room.deal[me][0].cardIds[1], now: 2,
    });
    expect(extra).toBe(room);
  });

  it("counts a card dealt twice as two separate votes", () => {
    // A player dealt the same card in two hands may back it twice. Nothing
    // downstream may treat the tally as a 0/1 flag.
    let room = votingRoom(3, 3);
    const me = room.players[0].id;
    const repeated = room.deal[me]
      .flatMap((h) => h.cardIds)
      .find((id, i, all) => all.indexOf(id) !== i);
    if (!repeated) return; // three-player rooms always repeat, but guard anyway
    room = reduce(room, { t: "castVote", playerId: me, category: repeated, now: 1 });
    room = reduce(room, { t: "castVote", playerId: me, category: repeated, now: 2 });
    expect(room.votes[me][repeated]).toBe(2);
  });

  it("reveals authorship when voting closes, and not before", () => {
    let room = votingRoom(4, 3);
    expect(room.authorsRevealed).toBe(false);
    room = reduce(room, { t: "tick", now: 10 ** 9, roll: 0.5 });
    expect(room.phase.name).toBe("countdown");
    expect(room.authorsRevealed).toBe(true);
  });

  it("draws the round's category from the written pool", () => {
    let room = votingRoom(4, 3);
    const me = room.players[0].id;
    const picked = room.deal[me][0].cardIds[0];
    room = reduce(room, { t: "castVote", playerId: me, category: picked, now: 1 });
    room = reduce(room, { t: "tick", now: 10 ** 9, roll: 0.5 });
    room = reduce(room, { t: "tick", now: 10 ** 9 + COUNTDOWN_MS, roll: 0.5 });
    expect(room.phase.name).toBe("playing");
    expect(room.pool!.map((c) => c.text)).toContain(room.category);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
npx vitest run shared/reduce.test.ts
```

- [ ] **Step 3: Fork `castVote`**

Replace the ballot check in `castVote` with a source-aware one:

```ts
    case "castVote": {
      if (room.phase.name !== "voting") return room;
      if (!room.players.some((p) => p.id === ev.playerId)) return room;

      if (customEnabled(room.settings)) {
        // The hand is the ballot. A hand-rolled socket message is not bound by
        // the UI, so what a player was actually dealt is checked here rather
        // than trusted — otherwise anyone could vote for a card they were
        // never shown, which is exactly what equal exposure exists to prevent.
        const hands = room.deal[ev.playerId] ?? [];
        if (!hands.some((h) => h.cardIds.includes(ev.category))) return room;
      } else if (!(BALLOT as readonly string[]).includes(ev.category)) {
        return room;
      }

      const budget = customEnabled(room.settings)
        ? voteBudgetFor()
        : voteBudget(room.settings);
      const row = room.votes[ev.playerId] ?? {};
      const spent = votesSpent(row);
      if (spent >= budget) return room;
      return {
        ...room,
        votes: {
          ...room.votes,
          [ev.playerId]: { ...row, [ev.category]: (row[ev.category] ?? 0) + 1 },
        },
        players: mapPlayer(room.players, ev.playerId, (p) => ({
          ...p, ready: spent + 1 >= budget,
        })),
      };
    }
```

- [ ] **Step 4: Reveal at the close, and draw from the pool**

`voting` leaves through three doors — the deadline in `tick`, `settle`'s countdown, and `startGame`. Add one helper and call it from all three:

```ts
/**
 * Closing voting hands the clients authorship. It is the reveal, so it happens
 * once, on the way out of `voting`, and never on any earlier edge.
 */
function closeVoting(room: Room, now: number): Room {
  return {
    ...room,
    phase: { name: "countdown", endsAt: now + COUNTDOWN_MS, to: "playing" },
    authorsRevealed: customEnabled(room.settings) ? true : room.authorsRevealed,
  };
}
```

Use it in `tick`'s `voting` branch, in `settle`'s `voting` branch (replacing `openCountdown(room, now, "playing")`), and in `startGame` when `from === "voting"`.

Route the draw. Both `tick`'s countdown branch and `jumpTo`'s `playing` case call `pickCategory`; give them a shared chooser:

```ts
/** The round's category, from whichever pool this match is playing. */
function drawCategory(room: Room, roll: number): string {
  if (customEnabled(room.settings) && room.pool) {
    return pickCustomCategory(room.pool, room.votes, spentCategories(room), roll);
  }
  return pickCategory(room.votes, spentCategories(room), roll);
}
```

- [ ] **Step 5: Run and commit**

```bash
npx vitest run && npm run typecheck
```

```bash
git add shared/reduce.ts shared/reduce.test.ts
git commit -m "feat(custom): vote from your hand, and reveal authorship at the close"
```

---

## Task 9: Server wiring

**Files:**
- Modify: `party/server.ts`
- Modify: `shared/protocol.ts`

**Interfaces:**
- Consumes: Tasks 6–8.
- Produces: `ServerMessage` gains `{ type: "yourDrafts"; drafts: string[] }` and `{ type: "yourHands"; hands: Hand[] }`; `W104` gains `private pushPrivate(playerId)`.

- [ ] **Step 1: Add the server messages**

In `shared/protocol.ts`:

```ts
  /** This player's own committed slots. Never broadcast — see toRoomState. */
  | { type: "yourDrafts"; drafts: string[] }
  /** This player's own hands. Never broadcast: a leaked hand plus a public
      tally lets the room deduce who voted for what. */
  | { type: "yourHands"; hands: Hand[] }
```

with `import type { Hand } from "./customCategories";`.

- [ ] **Step 2: Route the three client messages**

In `party/server.ts`'s `onMessage` switch:

```ts
      case "moveCursor":
        this.room = reduce(this.room, {
          t: "moveCursor", playerId, slot: Number(msg.slot), now,
        });
        break;
      case "commitDraft":
        this.room = reduce(this.room, {
          t: "commitDraft",
          playerId,
          slot: Number(msg.slot),
          // Bounded again in `reduce`; bounded here so a hostile message
          // cannot make the room object enormous before it gets there.
          text: String(msg.text ?? "").slice(0, MAX_CATEGORY_LEN * 4),
          now,
        });
        break;
      case "clearDraft":
        this.room = reduce(this.room, {
          t: "clearDraft", playerId, slot: Number(msg.slot), now,
        });
        break;
```

- [ ] **Step 3: Push the private halves**

Add beside `sendEntriesToTeam`:

```ts
  /**
   * Sends a player the two things `toRoomState` strips: their own committed
   * slots and their own hands. Same arrangement `yourEntries` has, and for the
   * same reason — these are per-socket facts, not room facts.
   *
   * Called after every state change rather than only on the events that alter
   * them: it is two small messages, and a missed push leaves a phone showing
   * an empty hand with no way to recover short of a reconnect.
   */
  private pushPrivate(playerId: PlayerId): void {
    if (!this.room) return;
    // Nothing to push in a built-in-pool match, and the common case is worth
    // not spending two messages per player per state change on.
    if (!customEnabled(this.room.settings)) return;
    const drafts = this.room.drafts[playerId] ?? [];
    const hands = this.room.deal[playerId] ?? [];
    for (const conn of this.getConnections<ConnState>()) {
      if (conn.state?.playerId !== playerId) continue;
      this.sendTo(conn, { type: "yourDrafts", drafts });
      this.sendTo(conn, { type: "yourHands", hands });
    }
  }

  /** Every seated player's private halves. */
  private pushPrivateAll(): void {
    if (!this.room) return;
    for (const player of this.room.players) this.pushPrivate(player.id);
  }
```

Call `this.pushPrivateAll()` immediately after `this.broadcastState()` in `onMessage`'s tail, in the `debugJump` branch, and in `onAlarm` wherever the room is broadcast. Call `this.pushPrivate(playerId)` on the connect path, next to the existing `yourEntries` send.

- [ ] **Step 4: Handle the private messages on the client**

In `src/net/room.ts`, add to `ClientState`:

```ts
  /** This player's own committed categories. Never in `room`. */
  drafts: string[];
  /** This player's own hands. Never in `room`. */
  hands: Hand[];
```

seeded `drafts: []`, `hands: []`, and two cases beside `yourEntries`:

```ts
      case "yourDrafts":
        this.setState({ ...this.state, drafts: msg.drafts });
        break;
      case "yourHands":
        this.setState({ ...this.state, hands: msg.hands });
        break;
```

- [ ] **Step 5: Let auto-fill write drafts**

In `party/server.ts`'s `debugFill` branch, replace the phase guard so it covers both:

```ts
    if (msg.type === "debugFill") {
      if (playerId !== this.room.hostId) return;

      if (this.room.phase.name === "creating") {
        // Loops `commitDraft` rather than writing `drafts` directly, so the
        // cap, the trim and the readiness rule all still apply — the same
        // arrangement the round's auto-fill has with `submitEntry`.
        const quota = quotaFor(this.room.players.length, this.room.settings.roundCount);
        this.room.players.forEach((player, seat) => {
          for (let slot = 0; slot < quota; slot++) {
            this.room = reduce(this.room!, {
              t: "commitDraft",
              playerId: player.id,
              slot,
              text: fillCategoryFor(seat, slot),
              now,
            });
          }
        });
        await this.persist();
        this.broadcastState();
        this.pushPrivateAll();
        return;
      }

      if (this.room.phase.name !== "playing") return;
      const scorers = this.fillEveryList(now);
      await this.persist();
      this.pushEntriesFor(scorers);
      return;
    }
```

Add `fillCategoryFor` to `shared/debug.ts`, beside `fillWordsFor`:

```ts
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
```

with a test in `shared/debug.test.ts` asserting it never returns an empty string and never exceeds `MAX_CATEGORY_LEN`.

- [ ] **Step 6: Verify and commit**

```bash
npx vitest run && npm run typecheck && npm run build
```

```bash
git add party/server.ts shared/protocol.ts shared/debug.ts shared/debug.test.ts src/net/room.ts
git commit -m "feat(custom): server wiring, per-socket drafts and hands"
```

---

## Task 10: The creation phone

**Files:**
- Create: `src/screens/player/PlayerCreating.tsx`
- Modify: `src/screens/player/PlayerView.tsx`
- Modify: `src/viewport.ts`
- Modify: `src/style.css`

**Interfaces:**
- Consumes: `ClientState.drafts`, `quotaFor`, `WRITE_MS`, `MAX_CATEGORY_LEN`.
- Produces: `PlayerCreating({ room, playerId, drafts, offset })`.

Numbers are in the brief's §1e. **Do not restate them from memory — open the brief.**

- [ ] **Step 1: Set the compact class**

In `src/viewport.ts`, inside `sync()`:

```ts
    // A class, not a media query: media queries measure the *layout* viewport,
    // which does not shrink when the keyboard opens. 620px is the threshold
    // below which the creation screen drops its meta line and halves its
    // counter — see the brief's §1e.
    root.classList.toggle("vv-compact", vv.height < 620);
```

- [ ] **Step 2: Build the screen**

Create `src/screens/player/PlayerCreating.tsx`. Structure, per the brief:

1. `.player-creating__meta` — `ROOM {code} · WRITE {quota}`, hidden when compact.
2. `.card.player-voting__head` — the counter. Bungee 48px `--pink` numeral counting cards **still to write**, `to write`, one `.pip` per slot (gold when committed).
3. `.card.player-creating__card` — slot label `CARD n OF m`, a bare `<input>` (Bungee 30px, no inner box), a right-aligned `n / 20`.
4. `.slot-strip` — one `56 × 44px` chip per slot. **Not rendered at quota 1.**
5. `.btn.btn--block` — `NEXT`, or `DONE` on the last slot.
6. `.timer-bar.player-voting__bar`.

Rules that are not negotiable and must be visible in the code:

- **Not inside a `<form>`** — Safari's AutoFill bar. Add the comment saying so.
- **No scrolling, no `scrollIntoView`.** The root is `.screen--locked`.
- Local `useState` for the in-flight text; `commitDraft` on NEXT/DONE and on tapping another chip. `moveCursor` on a chip tap, debounced ~150ms.
- Ready state: the counter takes its "you're in" form and the card area becomes **the committed cards, still cards** — `flex: 1` each, with the pen glyph pinned bottom-right, and a `--cream-dim` 13px line reading *"Tap a card to rewrite it — that un-readies you."*

- [ ] **Step 3: Add the CSS**

Append to `src/style.css`, copying the exact values from the brief's §1e — including the compact table under `.vv-compact .player-creating`, `.slot-strip` / `__chip` / `--current` / `--done`, and the `slotAdvanceA` / `slotAdvanceB` keyframe pair.

The two rules the compact table exists to protect:

```css
/* The two things a thumb aims at keep their size at every viewport. If
   something has to give, it is the timer numeral — the TV in the room is
   showing the same clock at 52px. */
.vv-compact .slot-strip__chip { height: 44px; }
.vv-compact .player-creating__commit { min-height: 52px; }
```

- [ ] **Step 4: Wire the view**

Replace the throwing `creating` case in `PlayerView.tsx`:

```tsx
    case "creating":
      return (
        <PlayerCreating
          room={room}
          playerId={playerId}
          drafts={state.drafts}
          offset={state.clockOffset}
        />
      );
```

The round's entry input stays where it is, outside the phase screens, moved offstage with CSS. **Do not move it into this screen and do not unmount it.**

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck && npm run build
```

```bash
git add src/screens/player/PlayerCreating.tsx src/screens/player/PlayerView.tsx src/viewport.ts src/style.css
git commit -m "feat(custom): the creation phone"
```

---

## Task 11: The creation TV

**Files:**
- Create: `src/screens/host/HostCreating.tsx`
- Modify: `src/screens/host/HostView.tsx`
- Modify: `src/style.css`

**Interfaces:**
- Consumes: `RoomState.slotStates`, `quotaFor`, `WRITE_MS`.
- Produces: `HostCreating({ room, offset })`.

Numbers are in the brief's §1b.

- [ ] **Step 1: Build both layouts**

Create `src/screens/host/HostCreating.tsx`.

Header: `RoomChip` left; right `N PLAYERS · N READY` + `HostExit` (`Back to teams` with teams on, `Back to room` without). **No round marker.** Stage: the gold `.plaque` at `-2.5deg`, `WRITE YOUR CATEGORIES`. Footer: `.timer-bar` at 106px with a gold `CONTINUE` sending `startGame`.

The branch:

```tsx
// Slot count, not player count: the constraint is horizontal, and only column
// count can break it. Five authors × 3 cards is 15 slots and still fits as
// columns; 13 authors × 1 does not. The quota arm is the third trip — a column
// of four 96px slots does not fit a 720p stage.
const useWall =
  room.players.length > 12 || room.players.length * quota > 15 || quota >= 4;
```

Layout A: a centred row of fixed **218px** columns, `gap: 18px`. **Fixed, not `1fr`** — a card that resizes when somebody else finishes is unreadable at sofa distance. Column = `PlayerPill` then the slots at `gap: 12px`.

Layout B: `display: grid`, `repeat(6, 1fr)`, one cell per pool slot in author order, with the author as a mini pill pinned `left: 8px; bottom: 8px` **inside** the cell. The plaque gains `N / M WRITTEN` beside it.

**The slot renders `room.slotStates[playerId][i]` and nothing else.** There is no path from this component to any draft text — assert that by never accepting one as a prop.

- [ ] **Step 2: Add the CSS**

Append the `.slot-state`, `.slot-state--done` (the DONE plaque, `rotate(-8deg)`, gold on `--ink-gold`), `.slot-state--writing` (three 14px `--teal` dots on the existing `pulseDot`), the two layouts and the `cardLandA` / `cardLandB` pair, with the exact values from the brief.

`pulseDot` is exempt from the A/B rule — it is an infinite idle loop and is never retriggered.

- [ ] **Step 3: Wire the view and commit**

```tsx
    case "creating":
      return <HostCreating room={room} offset={state.clockOffset} />;
```

```bash
npm run typecheck && npm run build
```

```bash
git add src/screens/host/HostCreating.tsx src/screens/host/HostView.tsx src/style.css
git commit -m "feat(custom): the creation TV, progress without content"
```

---

## Task 12: The hand UI

**Files:**
- Create: `src/screens/player/PlayerVotingCustom.tsx`
- Modify: `src/screens/player/PlayerVoting.tsx`
- Modify: `src/style.css`

**Interfaces:**
- Consumes: `ClientState.hands`, `RoomState.pool`, `customShares`, `voteBudgetFor`.
- Produces: `PlayerVotingCustom({ room, playerId, hands, offset, countdown })`.

- [ ] **Step 1: Dispatch**

At the top of `PlayerVoting`:

```tsx
  if (customEnabled(room.settings) && room.pool) {
    return (
      <PlayerVotingCustom
        room={room} playerId={playerId} hands={hands}
        offset={offset} countdown={countdown}
      />
    );
  }
```

- [ ] **Step 2: Build the hand screen**

Three `.vote-tile`s in a column, `flex: 1` each, `gap: 14px`, Bungee **28px**. The hand shown is `hands[votesSpent]`. No reset, no skip, no back — one instruction.

Spent/closed: the counter takes its "you're in" form and the grid becomes **your picks only** — you cannot revisit a hand, so showing what you did not pick shows a decision you cannot change. Each pick keeps its `.vote-tile__badge`, stays `flex: 1`, and gains `.vote-tile__chance` plus the author chip on the same beat as the TV.

`.vote-tile`s in their locked `<div>` form need `box-sizing: border-box`, exactly as the stock locked grid does, or the picks measure wider than the cards they replace.

- [ ] **Step 3: The hand swap**

840ms total, per the brief: pick flashes gold (`pickFlashA/B`, 180ms), counter pops (120ms); at 180ms the picked card goes **up** and the other two drop; at 520ms the next hand deals in (`dealInA/B`, ×3, 80ms stagger, 320ms).

- [ ] **Step 4: Verify and commit**

```bash
npm run typecheck && npm run build
```

```bash
git add src/screens/player/PlayerVotingCustom.tsx src/screens/player/PlayerVoting.tsx src/style.css
git commit -m "feat(custom): hands of three on the phone"
```

---

## Task 13: The custom board and the authorship reveal

**Files:**
- Create: `src/screens/host/HostVotingCustom.tsx`
- Modify: `src/screens/host/HostVoting.tsx`
- Modify: `src/style.css`

**Interfaces:**
- Consumes: `boardCards`, `customShares`, `BOARD_CAP`, `voteBudgetFor`, `RoomState.pool`, `RoomState.authorsRevealed`.
- Produces: `HostVotingCustom({ room, offset, countdown })`; `balancedRows` exported generically from `HostVoting.tsx`.

- [ ] **Step 1: Generalise `balancedRows`**

In `HostVoting.tsx`, change it to take accessors and export it:

```tsx
export function balancedRows<T>(
  cards: readonly T[],
  weightOf: (card: T) => number,
  orderOf: (card: T) => number,
): T[][] {
```

replacing `card.votes` with `weightOf(card)` and `poolIndex` with `orderOf`. The stock caller passes `(c) => c.votes` and `(c) => BALLOT.indexOf(...)`.

Rows are balanced **by weight, not by sequence** — slicing the sorted list in half puts every heavy card in row one and collapses row two.

- [ ] **Step 2: Dispatch and build**

`HostVoting` returns `<HostVotingCustom …>` when `customEnabled(room.settings) && room.pool`.

The board is the stock structure verbatim: `.host-voting__board` / `__row` / `.vote-card`, `flex-grow: votes + 1`, `container-type: inline-size`, `max(24px, min(cap, 17cqw))`. Reuse it — **if you find yourself writing a `.race-lane`, stop.** The fork is the pool source and the close sequence, nothing else.

Two differences from the stock board, both load-bearing:

- **No voter avatars anywhere.** No trail, no "N players hold this" hint. Showing which four avatars backed a card in your hand tells the room what was in your hand.
- **At most `BOARD_CAP` cards**, from `boardCards`, with `packCount` in a `+ N MORE ON THE BOARD` pill under the board. A count, never a list — a list would be a second board.

Prompt: `PICK ONE FROM EACH HAND — {voteBudgetFor()} VOTES EACH`.

- [ ] **Step 3: The close sequence**

Per the brief's §1d table: zero-vote cards leave (200ms), counts crossfade to percentages (200ms), survivors re-grow on share into a 206px podium row of three plus runners-up, then author chips pop in from `t+420ms` at `S = min(140ms, 2200 / cards)` apart, winner first.

`.author-chip`: `--paper-lit`, 3px ink, radius 99px, `3px 3px 0`, `rotate(-2.5deg)`, pinned top-left **inside** the card, above the name. **Reserve its box at the close frame** and animate only transform and opacity, or it shoves the name mid-pop.

House cards wear the author slot in **gold** on `--ink-gold`: `HOUSE CARD`.

The chip is **not** a `TeamBadge`, and there is no `TeamBadge` on either screen — creation and voting are individual, so a badge would assert something false.

- [ ] **Step 4: Verify and commit**

```bash
npm run typecheck && npm run build
```

```bash
git add src/screens/host/HostVotingCustom.tsx src/screens/host/HostVoting.tsx src/style.css
git commit -m "feat(custom): the race board, and the authorship reveal it pays out"
```

---

## Task 14: The transition

**Files:**
- Modify: `src/screens/host/HostCreating.tsx`, `src/screens/player/PlayerCreating.tsx`
- Modify: `src/style.css`

The brief's §1c is the spec, and **section 1c of the prototype plays it at real timing** — read the delays off the running frame if they ever disagree with the table.

1120ms, both surfaces on the same clock, no countdown. Driven from `phase.endsAt` crossing, not a chain of timers.

- [ ] **Step 1: Host** — pills leave at `80→320ms` (stagger 24ms); every done slot FLIPs to a centre deck at `80→620ms` (stagger 26ms, slots past the top six fade during travel); the deck shrinks away at `880→1040ms`; the board wipes in from `1060ms` (stagger 60ms). The timer bar never leaves — it **re-fills** from 0:00 to 1:00 at 1060ms over 260ms, the one moment in the app a timer track grows.

- [ ] **Step 2: Phone** — the input blurs at `t0` (iOS owns the keyboard's dismissal; do not fight it); card, pager and button leave at `80→320ms`; **the counter stays**, crossfading `1 to write` → `4 votes left` in place; the first hand deals in from 1060ms.

- [ ] **Step 3: Reduced motion** — both surfaces show the **settled voting screen on frame one**: full board, first hand present, counter at its budget. Not a no-op fade.

- [ ] **Step 4: Verify and commit**

```bash
npm run typecheck && npm run build
```

```bash
git add src/screens/host/HostCreating.tsx src/screens/player/PlayerCreating.tsx src/style.css
git commit -m "feat(custom): the beat between writing and voting"
```

---

## Task 15: Debug panel and the view jumper

**Files:**
- Modify: `src/components/DebugPanel.tsx`
- Modify: `shared/views.test.ts`

- [ ] **Step 1** — The Views section picks up `countdownToCreating` and `creating` for free from `VIEWS`. Confirm the panel renders them in play order and that jumping to `creating` from any phase lands correctly.

- [ ] **Step 2** — Hold and skip now cover `creating`. **Every screen showing a holdable deadline must pass `room.paused` as `useRemaining`'s third argument** — both creation screens do — or the clock runs to 0:00 under a phase that is merely stopped.

- [ ] **Step 3** — Auto-fill's label becomes phase-aware: "Fill categories" during `creating`, "Fill words" during `playing`, disabled elsewhere.

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run && npm run typecheck && npm run build
```

```bash
git add src/components/DebugPanel.tsx shared/views.test.ts
git commit -m "feat(custom): debug controls reach the writing phase"
```

---

## Task 16: Docs, version, and the verify matrix

**Files:**
- Modify: `CLAUDE.md`, `package.json`, `package-lock.json`

- [ ] **Step 1: Bump the version** in all three places — `package.json`, `package-lock.json` top-level `version`, and the one under `packages: { "": ... }`. It renders in Landing's corner and the debug panel footer, and on a deployed URL it is the only way to tell a fresh page from a cached one.

- [ ] **Step 2: Update `CLAUDE.md`** — a "Custom categories" section under Architecture covering: the setting, the `creating` phase, the three server-only fields and why `drafts` is top-level, the exact-exposure rule and why no filter may ever be added, the never-own softening at 1–2 players, and identical texts merging at the draw only. Add the three new docs to the Docs list.

- [ ] **Step 3: Run the verify matrix** from the brief. Use the bot bench to reach the crowded cases — `MAX_PLAYERS` is still 10.

  - Creation TV at 3 players × 3 cards, and 24 × 1.
  - One player mid-phase: DONE, dots and empty all visible in one column.
  - Quota 1 on the phone: no pager, `DONE` on the only card.
  - Keyboard up at 390×844 and 375×667. Pager 44px and commit ≥52px at both.
  - Board at 6 votes / 8 cards and 62 votes / 30 cards — **measure every name; none under 24px.**
  - A 20-character category in a 218px slot, on the board at one vote, and on a phone hand card.
  - Everyone blank at close: all house cards, all gold chips at the reveal.
  - Identical texts: two cards, two tallies on the board, one summed entry in the draw.
  - `prefers-reduced-motion: reduce`: the transition is the settled voting screen on frame one.

- [ ] **Step 4: Full verification**

```bash
npm run typecheck && npm test && npm run build
```

```bash
git add CLAUDE.md package.json package-lock.json
git commit -m "docs: custom categories in the architecture notes, and the version bump"
```

---

## Self-review

**Spec coverage.** §3.1 pool → Task 1. §3.3 votes → Task 1. §3.4 tiny rooms → Tasks 1, 3. §3.5 cap → Tasks 2, 7. §3.6 window → Task 7. §4 deal → Task 3. §5 privacy → Tasks 2, 6, 9. §6 data model → Task 6. §7 setting → Task 5. §8 phase mechanics → Tasks 7, 15. §9 draw → Tasks 4, 8. §10 screens → Tasks 10–14. §11 out of scope — no tasks, correctly.

**Known gaps, deliberate.** The cap raise to 20 and the three crowded screens it needs (reveal grid, standings, podium) are a separate project per the spec's §11. The archive is untouched: `RoundSummary.category` already carries a string.

**Type consistency.** `PoolCard`, `Hand`, `SlotState` are defined once in Task 1–2 and imported everywhere after. `quotaFor(playerCount, roundCount)` keeps that argument order at all seven call sites. `voteBudgetFor()` takes no arguments and is the only source of the number. `buildPool` and `buildDeal` both take `roll` last. `slotStates` is the `RoomState` field; `slotStatesFor` is the function.
