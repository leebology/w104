# Category Voting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the room vote once, up front, on which of 16 categories to play, then draw each round's category weighted by vote share with played categories spent for the rest of the match.

**Architecture:** All rules land in `shared/` as pure functions so they test in milliseconds — a new `shared/voting.ts` holds the budget, tally, shares and weighted draw; `shared/reduce.ts` gains a `voting` phase and two vote events. Randomness is injected at the edge (`tick` carries a `roll`) so `reduce` stays pure. The Durable Object stays plumbing. The client gets two new screens that are pure functions of `RoomState`.

**Tech Stack:** TypeScript, React 18, Vite, Vitest, PartyServer on Cloudflare Durable Objects, plain CSS in `src/style.css`.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-26-category-voting-design.md`. Read it before Task 1. It is the authority on every rule below.
- **Visual source:** `design_handoff_ok_name_one/README.md` (token table — every value in it is final) plus canvas frames `Voting — Host (open) B`, `Voting — Host (closed)`, `Voting — Player (voting) A`, `Voting — Player (spent)` in `Ok Name One MVP.dc.html`.
- **Node 22** (`.nvmrc`).
- **No new dependencies.** No CSS-in-JS, no utility framework.
- **Two tsc projects must both pass:** `npm run typecheck` runs `tsconfig.json` (src + shared, DOM libs) *and* `tsconfig.worker.json` (party + shared, workers-types). Any change to `shared/` must typecheck under both.
- **Never cream text on cream.** Inside a cream card, body text is `#1A0710`, secondary `#7A6A5C`.
- **Every shadow is a hard ink offset**, never blurred.
- **No third typeface.** Bungee (`var(--display)`) for display, Archivo (`var(--body)`) 400/600 for body.
- **No loose hex values in `src/style.css`.** Every colour is a token from `:root`. If a handoff value has no token, add one.
- **Copy says "room", never "lobby"**, in all user-facing strings. Class names and code identifiers keep `lobby`.
- **The page never scrolls** — not on any screen. Overflow scrolls inside its own box.
- **Commits stage explicit paths.** Never `git add -A` — the untracked working note `Project W-104.md` must stay untracked.
- **`reduce` returning the identical object means "no change".** Both `party/server.ts` and `settle` rely on that identity check. Never return a fresh object for a no-op.
- Run `npm test` and `npm run typecheck` before every commit.

---

### Task 1: Category pool and vote arithmetic

Pure data and pure functions. Nothing else in the app changes, so the build stays green throughout.

**Files:**
- Modify: `shared/categories.ts`
- Create: `shared/voting.ts`
- Test: `shared/voting.test.ts`

**Interfaces:**
- Consumes: `MatchSettings` from `shared/state.ts`, `PlayerId` from `shared/state.ts`.
- Produces:
  - `CATEGORIES: readonly string[]` (16 entries, order is render order)
  - `type VoteMap = Record<PlayerId, Record<string, number>>`
  - `voteBudget(settings: Pick<MatchSettings, "roundCount">): number`
  - `votesSpent(row: Record<string, number> | undefined): number`
  - `tallyVotes(votes: VoteMap): Record<string, number>`
  - `voteShares(votes: VoteMap): Record<string, number>`

- [ ] **Step 1: Expand the category pool**

Replace the `CATEGORIES` array in `shared/categories.ts`. Keep `DEFAULT_CATEGORY`, `DEFAULT_DURATION_SEC` and `DEFAULT_ROUND_COUNT` exactly as they are.

```ts
/**
 * The votable pool. Order is the render order in every grid — nothing sorts
 * this. 16 entries exceeds MAX_ROUND_COUNT (10), so a match can never exhaust
 * the pool and the draw's last-resort guard is unreachable.
 */
export const CATEGORIES = [
  "woman",
  "man",
  "animal",
  "plant",
  "song",
  "movie",
  "brand",
  "country",
  "city",
  "colour",
  "sport",
  "car",
  "food",
  "drink",
  "job",
  "body part",
] as const;
```

- [ ] **Step 2: Write the failing tests**

Create `shared/voting.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { CATEGORIES } from "./categories";
import { tallyVotes, voteBudget, voteShares, votesSpent } from "./voting";
import type { VoteMap } from "./voting";

describe("voteBudget", () => {
  test("one round and two rounds both give a single vote", () => {
    expect(voteBudget({ roundCount: 1 })).toBe(1);
    expect(voteBudget({ roundCount: 2 })).toBe(1);
  });

  test("beyond two rounds it is one less than the round count", () => {
    expect(voteBudget({ roundCount: 3 })).toBe(2);
    expect(voteBudget({ roundCount: 4 })).toBe(3);
    expect(voteBudget({ roundCount: 10 })).toBe(9);
  });

  test("the floor holds against a nonsense round count", () => {
    expect(voteBudget({ roundCount: 0 })).toBe(1);
    expect(voteBudget({ roundCount: -5 })).toBe(1);
  });
});

describe("votesSpent", () => {
  test("sums a row", () => {
    expect(votesSpent({ song: 2, movie: 1 })).toBe(3);
  });

  test("a player who has not voted has spent nothing", () => {
    expect(votesSpent(undefined)).toBe(0);
    expect(votesSpent({})).toBe(0);
  });
});

describe("tallyVotes", () => {
  test("adds every player's row together", () => {
    const votes: VoteMap = {
      p0: { song: 2, movie: 1 },
      p1: { song: 1, car: 3 },
    };
    expect(tallyVotes(votes)).toEqual({ song: 3, movie: 1, car: 3 });
  });

  test("an empty pool tallies to nothing", () => {
    expect(tallyVotes({})).toEqual({});
  });

  test("zero-count entries are dropped rather than carried as zero", () => {
    expect(tallyVotes({ p0: { song: 0, movie: 2 } })).toEqual({ movie: 2 });
  });
});

describe("voteShares", () => {
  test("clean thirds and halves", () => {
    expect(voteShares({ p0: { song: 1, movie: 1 } })).toEqual({ song: 50, movie: 50 });
  });

  test("shares always sum to exactly 100", () => {
    // 3 categories at 1 vote each is 33.33% apiece — largest remainder has to
    // hand the spare point to somebody.
    const shares = voteShares({ p0: { song: 1, movie: 1, car: 1 } });
    expect(Object.values(shares).reduce((a, b) => a + b, 0)).toBe(100);
  });

  test("a seven-way split still sums to exactly 100", () => {
    const row: Record<string, number> = {};
    for (const c of CATEGORIES.slice(0, 7)) row[c] = 1;
    const shares = voteShares({ p0: row });
    expect(Object.values(shares).reduce((a, b) => a + b, 0)).toBe(100);
  });

  test("the spare point goes to the largest remainder", () => {
    // 2/3 = 66.66 (remainder .66), 1/3 = 33.33 (remainder .33).
    expect(voteShares({ p0: { song: 2, movie: 1 } })).toEqual({ song: 67, movie: 33 });
  });

  test("ties in the remainder break by pool order, deterministically", () => {
    // song is earlier in CATEGORIES than movie, so it takes the spare point.
    const shares = voteShares({ p0: { song: 1, movie: 1, car: 1 } });
    expect(shares.song).toBe(34);
    expect(shares.movie).toBe(33);
    expect(shares.car).toBe(33);
  });

  test("no votes yields no shares rather than a divide by zero", () => {
    expect(voteShares({})).toEqual({});
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run shared/voting.test.ts`
Expected: FAIL — `Failed to resolve import "./voting"`.

- [ ] **Step 4: Implement `shared/voting.ts`**

```ts
import { CATEGORIES } from "./categories";
import type { MatchSettings, PlayerId } from "./state";

/**
 * Every player's votes. Counts, not a set: stacking several votes on one
 * category to push its odds is the whole strategic move. A nested Record
 * rather than a Map because Durable Object storage serializes as JSON and a
 * Map comes back empty.
 */
export type VoteMap = Record<PlayerId, Record<string, number>>;

/**
 * How many votes each player gets. One less than the round count, floored at
 * one — a single-round match still has a category to choose.
 */
export function voteBudget(settings: Pick<MatchSettings, "roundCount">): number {
  return Math.max(1, settings.roundCount - 1);
}

/** How many of their budget this player has spent. */
export function votesSpent(row: Record<string, number> | undefined): number {
  if (!row) return 0;
  let total = 0;
  for (const n of Object.values(row)) total += n;
  return total;
}

/** Total votes per category across every player. Zero-count keys are dropped. */
export function tallyVotes(votes: VoteMap): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of Object.values(votes)) {
    for (const [category, n] of Object.entries(row)) {
      if (n > 0) out[category] = (out[category] ?? 0) + n;
    }
  }
  return out;
}

/**
 * Integer percentages that sum to exactly 100, by largest remainder. Used by
 * the closed host screen, where three numbers that read 33/33/33 would be a
 * visible bug.
 *
 * Remainder ties break by pool order so the same votes always produce the same
 * screen — an unstable sort here would make the reveal flicker between renders.
 */
export function voteShares(votes: VoteMap): Record<string, number> {
  const totals = tallyVotes(votes);
  const entries = Object.entries(totals);
  const sum = entries.reduce((a, [, n]) => a + n, 0);
  if (sum === 0) return {};

  const exact = entries.map(([category, n]) => ({
    category,
    value: (n * 100) / sum,
    order: CATEGORIES.indexOf(category as (typeof CATEGORIES)[number]),
  }));

  const out: Record<string, number> = {};
  let assigned = 0;
  for (const e of exact) {
    out[e.category] = Math.floor(e.value);
    assigned += out[e.category];
  }

  const byRemainder = [...exact].sort((a, b) => {
    const diff = (b.value % 1) - (a.value % 1);
    return diff !== 0 ? diff : a.order - b.order;
  });
  for (let i = 0; assigned < 100; i++, assigned++) {
    out[byRemainder[i % byRemainder.length].category] += 1;
  }
  return out;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run shared/voting.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 6: Verify nothing else broke**

Run: `npm test && npm run typecheck`
Expected: all existing tests still pass; both tsc projects clean.

- [ ] **Step 7: Commit**

```bash
git add shared/categories.ts shared/voting.ts shared/voting.test.ts && git commit -m "feat: expand the category pool to 16 and add vote arithmetic"
```

---

### Task 2: The weighted draw

Still pure, still unwired. This is the rule that decides each round's category.

**Files:**
- Modify: `shared/voting.ts`
- Test: `shared/voting.test.ts`

**Interfaces:**
- Consumes: `VoteMap`, `tallyVotes` from Task 1; `RoundSummary` from `shared/state.ts`.
- Produces:
  - `spentCategories(view: { history: readonly RoundSummary[] }): string[]`
  - `pickCategory(votes: VoteMap, spent: readonly string[], roll: number): string`

- [ ] **Step 1: Write the failing tests**

Append to `shared/voting.test.ts`. Add `pickCategory` and `spentCategories` to the existing import from `./voting`.

```ts
describe("spentCategories", () => {
  test("reads the categories out of history, oldest first", () => {
    const history = [
      { category: "song", places: {} },
      { category: "car", places: {} },
    ];
    expect(spentCategories({ history })).toEqual(["song", "car"]);
  });

  test("a fresh match has spent nothing", () => {
    expect(spentCategories({ history: [] })).toEqual([]);
  });
});

describe("pickCategory", () => {
  const votes: VoteMap = { p0: { song: 3 }, p1: { movie: 1 } };
  // song weighs 3, movie weighs 1, so the cumulative edge is at 0.75.

  test("a low roll lands in the heavy category", () => {
    expect(pickCategory(votes, [], 0)).toBe("song");
    expect(pickCategory(votes, [], 0.74)).toBe("song");
  });

  test("a roll past the edge lands in the light category", () => {
    expect(pickCategory(votes, [], 0.75)).toBe("movie");
    expect(pickCategory(votes, [], 0.99)).toBe("movie");
  });

  test("a roll of exactly 1 does not fall off the end", () => {
    expect(pickCategory(votes, [], 1)).toBe("movie");
  });

  test("proportions hold across the whole roll space", () => {
    let song = 0;
    for (let i = 0; i < 1000; i++) {
      if (pickCategory(votes, [], i / 1000) === "song") song += 1;
    }
    expect(song).toBe(750);
  });

  test("a spent category is never drawn again", () => {
    // song is spent, so every roll must land on movie even though song
    // carries three quarters of the vote.
    for (const roll of [0, 0.25, 0.5, 0.75, 0.99]) {
      expect(pickCategory(votes, ["song"], roll)).toBe("movie");
    }
  });

  test("shares recalculate once a category is spent", () => {
    const three: VoteMap = { p0: { song: 2, movie: 1, car: 1 } };
    // With song spent the pool is movie:1 car:1 — an even split at 0.5.
    expect(pickCategory(three, ["song"], 0.49)).toBe("movie");
    expect(pickCategory(three, ["song"], 0.51)).toBe("car");
  });

  test("once the voted categories are spent it draws from the unvoted ones", () => {
    const drawn = pickCategory(votes, ["song", "movie"], 0);
    expect(drawn).toBe(CATEGORIES.find((c) => c !== "song" && c !== "movie"));
    expect(["song", "movie"]).not.toContain(drawn);
  });

  test("the unvoted fallback is uniform, not weighted", () => {
    // 14 categories remain after song and movie are spent; a roll of 0.5
    // lands on the 8th of them (indices 0-13, edge at 7/14 = 0.5).
    const remaining = CATEGORIES.filter((c) => c !== "song" && c !== "movie");
    expect(pickCategory(votes, ["song", "movie"], 0.5)).toBe(remaining[7]);
  });

  test("no votes at all still yields a category", () => {
    expect(CATEGORIES).toContain(pickCategory({}, [], 0.5));
  });

  test("an all-spent pool falls back rather than throwing", () => {
    expect(CATEGORIES).toContain(pickCategory(votes, [...CATEGORIES], 0.5));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run shared/voting.test.ts`
Expected: FAIL — `pickCategory is not a function` / `spentCategories is not a function`.

- [ ] **Step 3: Implement the draw**

Append to `shared/voting.ts`. Add `RoundSummary` to the type import from `./state`.

```ts
/**
 * Categories already played this match. Derived from history, never stored —
 * same reasoning as `currentRound`: history only grows, and only at
 * `showStandings`, so a stored copy would be a second truth that could drift.
 *
 * Because the draw happens at the whistle and the previous round is banked
 * before then, this list is always complete at the moment it is read.
 */
export function spentCategories(view: { history: readonly RoundSummary[] }): string[] {
  return view.history.map((h) => h.category);
}

/**
 * The round's category, weighted by vote share over what is left.
 *
 * `roll` is a uniform [0,1) supplied by the caller rather than taken from
 * Math.random() here: this has to stay pure so `reduce` does, and so the
 * distribution can be tested against fixed rolls instead of a stubbed global.
 */
export function pickCategory(
  votes: VoteMap,
  spent: readonly string[],
  roll: number,
): string {
  const isSpent = new Set(spent);
  const available = CATEGORIES.filter((c) => !isSpent.has(c));

  // Unreachable at 16 categories and MAX_ROUND_COUNT 10 — a guard, not a case.
  if (available.length === 0) {
    return weightedPick(CATEGORIES.map((c) => [c, 1]), roll);
  }

  const totals = tallyVotes(votes);
  const voted = available.filter((c) => (totals[c] ?? 0) > 0);
  if (voted.length > 0) {
    return weightedPick(voted.map((c) => [c, totals[c]]), roll);
  }

  // Every voted category is spent: the rest of the match draws uniformly from
  // what nobody asked for, rather than repeating a category or ending early.
  return weightedPick(available.map((c) => [c, 1]), roll);
}

/**
 * Walks the cumulative distribution. The clamp matters: a roll of exactly 1 —
 * or a float that lands a hair past the final edge — would otherwise fall off
 * the end of the scan and reach the fallback return.
 */
function weightedPick(weights: Array<[string, number]>, roll: number): string {
  const total = weights.reduce((sum, [, w]) => sum + w, 0);
  let target = Math.min(Math.max(roll, 0), 0.999999999) * total;
  for (const [category, weight] of weights) {
    target -= weight;
    if (target < 0) return category;
  }
  return weights[weights.length - 1][0];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run shared/voting.test.ts`
Expected: PASS, 23 tests.

- [ ] **Step 5: Verify nothing else broke**

Run: `npm test && npm run typecheck`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add shared/voting.ts shared/voting.test.ts && git commit -m "feat: draw each round's category weighted by vote share"
```

---

### Task 3: Give the countdown a destination

A pure refactor with **no behaviour change**: every countdown that exists today becomes `to: "playing"`. This lands on its own so the next task's transitions have somewhere to go, and so a reviewer can confirm nothing moved.

**Files:**
- Modify: `shared/state.ts:46-53` (the `Phase` union)
- Modify: `shared/reduce.ts` (every `{ name: "countdown" }` construction)
- Modify: `party/server.ts:56-77` (`load`)
- Modify: `shared/reduce.test.ts` (countdown assertions)
- Modify: `shared/state.test.ts` (if it constructs a countdown)

**Interfaces:**
- Produces: `Phase` countdown variant is now `{ name: "countdown"; endsAt: number; to: "voting" | "playing" }`.

- [ ] **Step 1: Widen the phase type**

In `shared/state.ts`, replace the countdown line of the `Phase` union:

```ts
export type Phase =
  | { name: "lobby" }
  /**
   * Where this countdown lands. Stored rather than derived because two
   * distinct countdowns now sit at `history.length === 0` — the one before
   * voting and the one before round one — so there is nothing left to derive
   * it from.
   */
  | { name: "countdown"; endsAt: number; to: "voting" | "playing" }
  | { name: "playing"; endsAt: number }
  | { name: "timesup"; endsAt: number }
  | { name: "scoring"; results: Results }
  /** Match standings between rounds and at the end. Untimed; the host advances it. */
  | { name: "standings" };
```

- [ ] **Step 2: Run typecheck to find every construction site**

Run: `npm run typecheck`
Expected: FAIL — errors at each place a countdown phase is built, in `shared/reduce.ts` (`settle`, `startGame`) and in the test files.

- [ ] **Step 3: Add `to: "playing"` at each site**

In `shared/reduce.ts`, `settle`:

```ts
    return { ...room, phase: { name: "countdown", endsAt: now + COUNTDOWN_MS, to: "playing" } };
```

In `shared/reduce.ts`, the `startGame` case:

```ts
        phase: { name: "countdown", endsAt: ev.now + COUNTDOWN_MS, to: "playing" },
```

- [ ] **Step 4: Default `to` when loading an older room**

In `party/server.ts`, inside `load()`, add to the returned object — and extend the existing doc comment on `load` to mention `votes`/`to` alongside `kicked`, `settings`/`history` and `hostGoneAt`:

```ts
      // A room persisted mid-countdown before `to` existed has a countdown
      // phase with no destination at all, and `tick` would route it nowhere and
      // hang the room. "playing" is the only thing that countdown could have
      // meant.
      phase:
        rest.phase?.name === "countdown" && !("to" in rest.phase)
          ? { ...rest.phase, to: "playing" as const }
          : rest.phase,
```

- [ ] **Step 5: Fix the test assertions**

In `shared/reduce.test.ts`, every `toEqual({ name: "countdown", endsAt: ... })` gains `to: "playing"`. For example:

```ts
  test("two ready players start the countdown", () => {
    const room = readyAll(seed(2), 2000);
    expect(room.phase).toEqual({
      name: "countdown", endsAt: 2000 + COUNTDOWN_MS, to: "playing",
    });
  });
```

Assertions written as `expect(room.phase.name).toBe("countdown")` need no change.

- [ ] **Step 6: Verify**

Run: `npm test && npm run typecheck`
Expected: green, with the same test count as before this task.

- [ ] **Step 7: Commit**

```bash
git add shared/state.ts shared/reduce.ts shared/reduce.test.ts shared/state.test.ts party/server.ts && git commit -m "refactor: give the countdown phase an explicit destination"
```

---

### Task 4: The voting phase

The state machine and a working — if plain — pair of screens. At the end of this task the feature is playable end to end; Tasks 6 and 7 make it look like the design.

**Files:**
- Modify: `shared/state.ts`
- Modify: `shared/reduce.ts`
- Modify: `shared/protocol.ts`
- Modify: `party/server.ts`
- Create: `src/screens/host/HostVoting.tsx`
- Create: `src/screens/player/PlayerVoting.tsx`
- Modify: `src/screens/host/HostView.tsx`
- Modify: `src/screens/player/PlayerView.tsx`
- Test: `shared/reduce.test.ts`, `shared/state.test.ts`

**Interfaces:**
- Consumes: `voteBudget`, `votesSpent`, `VoteMap` (Task 1).
- Produces:
  - `Room.votes: VoteMap`, carried through into `RoomState`
  - `Phase` gains `{ name: "voting"; endsAt: number }`
  - `VOTING_MS = 60_000` exported from `shared/reduce.ts`
  - `countdownScreen(view): "lobby" | "voting" | "standings"` from `shared/state.ts`
  - `RoomEvent` gains `{ t: "castVote"; playerId; category; now }` and `{ t: "resetVotes"; playerId; now }`
  - `ClientMessage` gains `{ type: "castVote"; category: string }` and `{ type: "resetVotes" }`

- [ ] **Step 1: Write the failing tests**

Append to `shared/reduce.test.ts`. Extend the existing imports to include `VOTING_MS`, and import `voteBudget` from `./voting`.

```ts
/** A room that has reached the voting phase with `n` players. */
function seedVoting(n: number, roundCount = 5, now = 1000): Room {
  let room = seed(n, now);
  room = reduce(room, { t: "setSettings", playerId: "host", roundCount, now });
  room = reduce(room, { t: "startGame", playerId: "host", now });
  return reduce(room, { t: "tick", now: now + COUNTDOWN_MS });
}

describe("entering voting", () => {
  test("everyone readying up opens a countdown to voting, not to a round", () => {
    const room = readyAll(seed(2), 2000);
    expect(room.phase).toEqual({
      name: "countdown", endsAt: 2000 + COUNTDOWN_MS, to: "voting",
    });
  });

  test("the host's start button opens the same countdown to voting", () => {
    const room = reduce(seed(3), { t: "startGame", playerId: "host", now: 2000 });
    expect(room.phase).toEqual({
      name: "countdown", endsAt: 2000 + COUNTDOWN_MS, to: "voting",
    });
  });

  test("the countdown to voting opens voting on its deadline", () => {
    let room = readyAll(seed(2), 2000);
    room = reduce(room, { t: "tick", now: 2000 + COUNTDOWN_MS });
    expect(room.phase).toEqual({ name: "voting", endsAt: 2000 + COUNTDOWN_MS + VOTING_MS });
  });

  test("opening voting clears the readiness that got us here", () => {
    // Load-bearing: `ready` means "waiting in the room" before this edge and
    // "votes spent" after it. Carried across, the next settle would see
    // everyone ready and close voting before a single vote was cast.
    let room = readyAll(seed(2), 2000);
    expect(room.players.every((p) => p.ready)).toBe(true);
    room = reduce(room, { t: "tick", now: 2000 + COUNTDOWN_MS });
    expect(room.phase.name).toBe("voting");
    expect(room.players.every((p) => !p.ready)).toBe(true);
  });

  test("voting does not close the instant it opens", () => {
    let room = readyAll(seed(2), 2000);
    room = reduce(room, { t: "tick", now: 2000 + COUNTDOWN_MS });
    room = reduce(room, { t: "setProfile", playerId: "p0", name: "P0", emoji: "🐙", now: 2600 });
    expect(room.phase.name).toBe("voting");
  });

  test("un-readying during the countdown to voting still cancels it", () => {
    let room = readyAll(seed(2), 2000);
    room = reduce(room, { t: "ready", playerId: "p0", ready: false, now: 3000 });
    expect(room.phase.name).toBe("lobby");
  });
});

describe("casting votes", () => {
  test("a vote lands and counts against the budget", () => {
    let room = seedVoting(2);
    room = reduce(room, { t: "castVote", playerId: "p0", category: "song", now: 3000 });
    expect(room.votes.p0).toEqual({ song: 1 });
  });

  test("votes stack on one category", () => {
    let room = seedVoting(2);
    for (let i = 0; i < 3; i++) {
      room = reduce(room, { t: "castVote", playerId: "p0", category: "song", now: 3000 });
    }
    expect(room.votes.p0).toEqual({ song: 3 });
  });

  test("spending the last vote marks the player ready", () => {
    let room = seedVoting(2, 3); // budget 2
    room = reduce(room, { t: "castVote", playerId: "p0", category: "song", now: 3000 });
    expect(room.players.find((p) => p.id === "p0")!.ready).toBe(false);
    room = reduce(room, { t: "castVote", playerId: "p0", category: "car", now: 3100 });
    expect(room.players.find((p) => p.id === "p0")!.ready).toBe(true);
  });

  test("a vote past the budget is a no-op", () => {
    let room = seedVoting(2, 2); // budget 1
    room = reduce(room, { t: "castVote", playerId: "p0", category: "song", now: 3000 });
    const before = room;
    room = reduce(room, { t: "castVote", playerId: "p0", category: "car", now: 3100 });
    expect(room).toBe(before);
  });

  test("an unknown category is a no-op", () => {
    const room = seedVoting(2);
    const after = reduce(room, { t: "castVote", playerId: "p0", category: "haircut", now: 3000 });
    expect(after).toBe(room);
  });

  test("a vote outside the voting phase is a no-op", () => {
    const room = seed(2);
    const after = reduce(room, { t: "castVote", playerId: "p0", category: "song", now: 3000 });
    expect(after).toBe(room);
  });

  test("resetting clears the row and un-readies", () => {
    let room = seedVoting(2, 2);
    room = reduce(room, { t: "castVote", playerId: "p0", category: "song", now: 3000 });
    room = reduce(room, { t: "resetVotes", playerId: "p0", now: 3100 });
    expect(room.votes.p0).toBeUndefined();
    expect(room.players.find((p) => p.id === "p0")!.ready).toBe(false);
  });

  test("resetting with nothing to reset is a no-op", () => {
    const room = seedVoting(2);
    const after = reduce(room, { t: "resetVotes", playerId: "p0", now: 3000 });
    expect(after).toBe(room);
  });
});

describe("leaving voting", () => {
  test("every player spending their budget opens the countdown to the round", () => {
    let room = seedVoting(2, 2); // budget 1
    room = reduce(room, { t: "castVote", playerId: "p0", category: "song", now: 3000 });
    expect(room.phase.name).toBe("voting");
    room = reduce(room, { t: "castVote", playerId: "p1", category: "car", now: 3100 });
    expect(room.phase).toEqual({
      name: "countdown", endsAt: 3100 + COUNTDOWN_MS, to: "playing",
    });
  });

  test("the 60 second timer closes voting even with nobody ready", () => {
    let room = seedVoting(3);
    const endsAt = (room.phase as { endsAt: number }).endsAt;
    room = reduce(room, { t: "tick", now: endsAt });
    expect(room.phase).toEqual({
      name: "countdown", endsAt: endsAt + COUNTDOWN_MS, to: "playing",
    });
  });

  test("the host can continue mid-vote, force-readying everyone", () => {
    let room = seedVoting(3);
    room = reduce(room, { t: "startGame", playerId: "host", now: 3000 });
    expect(room.phase).toEqual({
      name: "countdown", endsAt: 3000 + COUNTDOWN_MS, to: "playing",
    });
    expect(room.players.every((p) => p.ready)).toBe(true);
  });

  test("a player cannot continue", () => {
    const room = seedVoting(3);
    const after = reduce(room, { t: "startGame", playerId: "p0", now: 3000 });
    expect(after).toBe(room);
  });

  test("a solo host start survives the next event", () => {
    // everyoneReady needs MIN_PLAYERS, so an un-guarded settle would tear this
    // countdown down the moment anything else happened.
    let room = seedVoting(1, 2);
    room = reduce(room, { t: "castVote", playerId: "p0", category: "song", now: 3000 });
    expect(room.phase.name).toBe("countdown");
    room = reduce(room, { t: "setProfile", playerId: "p0", name: "Solo", emoji: "🦊", now: 3100 });
    expect(room.phase.name).toBe("countdown");
  });

  test("a disconnected player does not hold voting open", () => {
    let room = seedVoting(2, 2);
    room = reduce(room, { t: "disconnect", playerId: "p1", now: 3000 });
    room = reduce(room, { t: "castVote", playerId: "p0", category: "song", now: 3100 });
    expect(room.phase.name).toBe("countdown");
  });

  test("voting is what the alarm is waiting on while it runs", () => {
    const room = seedVoting(2);
    expect(nextAlarmAt(room)).toBe((room.phase as { endsAt: number }).endsAt);
  });
});

describe("abandoning a vote", () => {
  test("back to room from voting discards the votes", () => {
    let room = seedVoting(2);
    room = reduce(room, { t: "castVote", playerId: "p0", category: "song", now: 3000 });
    room = reduce(room, { t: "backToLobby", playerId: "host", now: 3100 });
    expect(room.phase.name).toBe("lobby");
    expect(room.votes).toEqual({});
    expect(room.players.every((p) => !p.ready)).toBe(true);
  });

  test("stopping the countdown out of voting discards the votes too", () => {
    let room = seedVoting(2, 2);
    room = reduce(room, { t: "castVote", playerId: "p0", category: "song", now: 3000 });
    room = reduce(room, { t: "castVote", playerId: "p1", category: "car", now: 3100 });
    room = reduce(room, { t: "cancelStart", playerId: "host", now: 3200 });
    expect(room.phase.name).toBe("lobby");
    expect(room.votes).toEqual({});
  });
});
```

Append to `shared/state.test.ts`:

```ts
  test("votes are broadcast — the TV renders the tally for the whole room", () => {
    const room = { ...createRoom("PLUM", 1000), votes: { p0: { song: 2 } } };
    expect(toRoomState(room, 1000).votes).toEqual({ p0: { song: 2 } });
  });

  test("countdownScreen tells the two round-one countdowns apart", () => {
    const base = createRoom("PLUM", 1000);
    expect(countdownScreen({
      ...base, phase: { name: "countdown", endsAt: 2000, to: "voting" },
    })).toBe("lobby");
    expect(countdownScreen({
      ...base, phase: { name: "countdown", endsAt: 2000, to: "playing" },
    })).toBe("voting");
    expect(countdownScreen({
      ...base,
      phase: { name: "countdown", endsAt: 2000, to: "playing" },
      history: [{ category: "song", places: {} }],
    })).toBe("standings");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run shared/reduce.test.ts shared/state.test.ts`
Expected: FAIL — unknown event types `castVote`/`resetVotes`, no `votes` on `Room`, `countdownScreen` not exported.

- [ ] **Step 3: Add `votes` and the voting phase to state**

In `shared/state.ts`: import `VoteMap` from `./voting`, add the phase variant, the `Room` field, and `countdownScreen`.

```ts
import type { VoteMap } from "./voting";
```

Add to the `Phase` union, above `countdown`:

```ts
  /** The room picking this match's categories. One 60-second window per match. */
  | { name: "voting"; endsAt: number }
```

Add to `Room`, after `settings`:

```ts
  /**
   * Everyone's category votes for this match. Unlike `entries`, this is *not*
   * server-only: the host TV renders the full tally to the whole room by
   * design, so a player reading it in RoomState learns nothing they could not
   * learn by looking up. Guarding it would cost per-connection encoding on
   * every vote in exchange for nothing.
   */
  votes: VoteMap;
```

`RoomState` needs no change — it is `Omit<Room, "entries" | "lastActivityAt" | "kicked" | "hostGoneAt">`, so `votes` rides along automatically. `toRoomState` needs no change either.

In `createRoom`, add `votes: {},` after `settings`.

Add at the bottom of the file:

```ts
/**
 * Which screen renders *under* a countdown. Distinct from `preRoundPhase`,
 * which answers where a *cancelled* countdown returns to — at round one those
 * answers differ, so overloading one function would be wrong.
 */
export function countdownScreen(
  view: MatchView & { phase: Phase },
): "lobby" | "voting" | "standings" {
  if (view.phase.name === "countdown" && view.phase.to === "voting") return "lobby";
  return view.history.length === 0 ? "voting" : "standings";
}
```

- [ ] **Step 4: Wire the state machine**

In `shared/reduce.ts`, import the vote helpers and the pool:

```ts
import { CATEGORIES } from "./categories";
import { voteBudget, votesSpent } from "./voting";
```

Add the constant beside `COUNTDOWN_MS`:

```ts
/** One voting window per match, whatever the round count. */
export const VOTING_MS = 60_000;
```

Add the two events to `RoomEvent`:

```ts
  | { t: "castVote"; playerId: PlayerId; category: string; now: number }
  | { t: "resetVotes"; playerId: PlayerId; now: number }
```

Replace `everyoneReady` and `settle`:

```ts
/**
 * Readiness counts only connected players. Otherwise one person whose phone
 * died in the lobby would block the game for everyone until they came back.
 *
 * `min` is the floor on how many connected players it takes to be a room at
 * all: MIN_PLAYERS in the lobby and at standings, but 1 during voting — the
 * match has already begun by then, and a host solo-start has to be able to
 * close its own vote.
 */
function everyoneReady(room: Room, min: number): boolean {
  const active = room.players.filter((p) => p.connected);
  return active.length >= min && active.every((p) => p.ready);
}

function openCountdown(room: Room, now: number, to: "voting" | "playing"): Room {
  return { ...room, phase: { name: "countdown", endsAt: now + COUNTDOWN_MS, to } };
}

/**
 * The pre-round <-> countdown edge is derived, not commanded: any event that
 * changes readiness re-evaluates it, so un-readying mid-countdown backs out
 * without needing its own case.
 *
 * Three phases can open a countdown now. The lobby opens one *to voting*;
 * voting and standings open one *to a round*.
 */
function settle(room: Room, now: number): Room {
  const phase = room.phase;

  if (phase.name === "lobby") {
    return everyoneReady(room, MIN_PLAYERS) ? openCountdown(room, now, "voting") : room;
  }

  if (phase.name === "voting") {
    return everyoneReady(room, 1) ? openCountdown(room, now, "playing") : room;
  }

  if (phase.name === "standings") {
    if (matchComplete(room)) return room;
    return everyoneReady(room, MIN_PLAYERS) ? openCountdown(room, now, "playing") : room;
  }

  if (phase.name === "countdown") {
    // The post-voting countdown is deliberately not readiness-cancellable.
    // everyoneReady needs MIN_PLAYERS, so after a host solo-start this branch
    // would tear the countdown down on the very next event. Readiness has
    // already done its job by the time voting closes.
    if (phase.to === "playing" && room.history.length === 0) return room;
    if (!everyoneReady(room, MIN_PLAYERS)) return { ...room, phase: backPhase(room) };
  }

  return room;
}
```

Replace the `startGame` case:

```ts
    case "startGame": {
      if (ev.playerId !== room.hostId) return room;
      // Legal from the room, from voting, and from standings between rounds.
      // It always means the same thing: force-ready everyone and open a
      // countdown. Only the destination differs.
      const from = room.phase.name;
      if (from !== "lobby" && from !== "voting" && from !== "standings") return room;
      if (from === "standings" && matchComplete(room)) return room;
      // A deliberate host override: unlike the natural everyoneReady path,
      // this can start the countdown with just one connected player.
      if (room.players.filter((p) => p.connected).length < 1) return room;
      return {
        ...room,
        players: room.players.map((p) => ({ ...p, ready: true })),
        phase: {
          name: "countdown",
          endsAt: ev.now + COUNTDOWN_MS,
          to: from === "lobby" ? "voting" : "playing",
        },
      };
    }
```

Replace the `cancelStart` case:

```ts
    case "cancelStart": {
      if (ev.playerId !== room.hostId) return room;
      if (room.phase.name !== "countdown") return room;
      const back = backPhase(room);
      // Resets everyone's readiness rather than leaving it as-is: it was
      // solo-start's `startGame` that force-readied everyone, and leaving
      // that in place would have `settle` immediately re-open the countdown
      // this cancel is meant to stop.
      return {
        ...room,
        phase: back,
        players: room.players.map((p) => ({ ...p, ready: false })),
        // Abandoning back to the room abandons the match, and the votes
        // belonged to a match that no longer exists.
        votes: back.name === "lobby" ? {} : room.votes,
      };
    }
```

Add the two new cases, after `setSettings`:

```ts
    case "castVote": {
      if (room.phase.name !== "voting") return room;
      // A hand-rolled socket message is not bound by the UI, so the pool and
      // the budget are both checked here rather than trusted.
      if (!(CATEGORIES as readonly string[]).includes(ev.category)) return room;
      if (!room.players.some((p) => p.id === ev.playerId)) return room;
      const budget = voteBudget(room.settings);
      const row = room.votes[ev.playerId] ?? {};
      const spent = votesSpent(row);
      if (spent >= budget) return room;
      return {
        ...room,
        votes: {
          ...room.votes,
          [ev.playerId]: { ...row, [ev.category]: (row[ev.category] ?? 0) + 1 },
        },
        // Ready is derived from the budget, never a button — spending the last
        // vote is what readies you, and that is what `settle` closes voting on.
        players: mapPlayer(room.players, ev.playerId, (p) => ({
          ...p, ready: spent + 1 >= budget,
        })),
      };
    }

    case "resetVotes": {
      if (room.phase.name !== "voting") return room;
      if (!room.votes[ev.playerId]) return room;
      const { [ev.playerId]: _cleared, ...votes } = room.votes;
      return {
        ...room,
        votes,
        players: mapPlayer(room.players, ev.playerId, (p) => ({ ...p, ready: false })),
      };
    }
```

Extend `backToLobby` to allow voting, and clear the votes:

```ts
    case "backToLobby":
      if (ev.playerId !== room.hostId) return room;
      if (room.phase.name !== "standings" && room.phase.name !== "voting") return room;
      // Settings survive — the host usually wants the same match again — and
      // so does `kicked`, which is durable for the room's lifetime. The votes
      // do not: they belonged to the match being abandoned.
      return {
        ...room,
        phase: { name: "lobby" },
        players: room.players.map((p) => ({ ...p, ready: false })),
        entries: {},
        history: [],
        votes: {},
      };
```

Replace the countdown branch of `tick` and add the voting branch:

```ts
  if (phase.name === "countdown" && now >= phase.endsAt) {
    if (phase.to === "voting") {
      return {
        ...room,
        phase: { name: "voting", endsAt: now + VOTING_MS },
        // Load-bearing, not housekeeping: `ready` means "waiting in the room"
        // on this side of the edge and "votes spent" on the other. Carried
        // across, the next settle would see everyone ready and close voting
        // before a single vote was cast.
        players: room.players.map((p) => ({ ...p, ready: false })),
        votes: {},
      };
    }
    return {
      ...room,
      phase: { name: "playing", endsAt: now + room.settings.durationSec * 1_000 },
    };
  }
  if (phase.name === "voting" && now >= phase.endsAt) {
    // The global deadline closes voting into the same countdown the other two
    // triggers open, so a round always starts the same way.
    return { ...room, phase: { name: "countdown", endsAt: now + COUNTDOWN_MS, to: "playing" } };
  }
```

In `nextAlarmAt`, add `voting` to the timed phases:

```ts
  const base =
    phase.name === "countdown" ||
    phase.name === "voting" ||
    phase.name === "playing" ||
    phase.name === "timesup"
      ? phase.endsAt
      : room.lastActivityAt + IDLE_REAP_MS;
```

- [ ] **Step 5: Reconcile the existing tests with the new phase machine**

Inserting a phase ahead of round one invalidates tests written when the lobby countdown led straight to a round. Appending the new tests is not enough — these must be reworked too, and the work is not optional:

- **`playing()`** (`shared/reduce.test.ts`, around line 154) is `readyAll(seed(2, now), now)` plus one tick, which used to land in `playing`. That tick now only reaches `voting`. Route it through: ready → tick (voting opens) → host `startGame` (closes voting) → tick (round starts). Use the host force-start rather than having every player spend their budget: it does not depend on the vote budget, and it leaves `votes` empty, which keeps Task 5's draw uniform rather than pinned to whatever the helper happened to vote for. Comment the detour so it does not read as accidental.
- **`scored()`** is built on `playing()` and inherits the fix.
- **Hardcoded timing literals** that assumed one countdown — e.g. `2000 + COUNTDOWN_MS + 30_000` — now span two. Derive them from the constants (`2000 + COUNTDOWN_MS * 2 + 30_000`) rather than hardcoding a new number.
- **Two tests now assert the wrong destination**: `"two ready players start the countdown"` and `"the host can start with just one player"` must expect `to: "voting"`. Rename them if the old name no longer describes what they check.

**Reroute, never weaken.** The only legitimate change to a pre-existing test is the route it takes to the phase under test, plus the timing literals that shift with it. No `toEqual` downgraded to a `.name` check, no exact `endsAt` replaced by a range, no test deleted. If a test cannot be preserved without weakening it, stop and escalate.

Run: `npx vitest run shared/`
Expected: PASS. If `seedVoting` fails, check that `setSettings` is applied while still in the lobby — it is locked once the match starts.

- [ ] **Step 6: Wire the protocol and the server**

In `shared/protocol.ts`, add to `ClientMessage`:

```ts
  | { type: "castVote"; category: string }
  | { type: "resetVotes" }
```

In `party/server.ts`, add to the `switch (msg.type)` block in `onMessage`:

```ts
      case "castVote":
        this.room = reduce(this.room, {
          t: "castVote", playerId, category: msg.category, now,
        });
        break;
      case "resetVotes":
        this.room = reduce(this.room, { t: "resetVotes", playerId, now });
        break;
```

In `load()`, add the votes fallback beside the others:

```ts
      votes: rest.votes ?? {},
```

- [ ] **Step 7: Add plain screens so both views compile**

`HostView` and `PlayerView` have explicit `ReactElement` return types — that annotation is what makes tsc flag an unhandled phase, so both need a `voting` case. These are deliberately plain; Tasks 6 and 7 build them to the design.

Create `src/screens/host/HostVoting.tsx`:

```tsx
import { CATEGORIES } from "../../../shared/categories";
import { tallyVotes } from "../../../shared/voting";
import { currentRound } from "../../../shared/state";
import type { RoomState } from "../../../shared/state";
import { RoomChip } from "../../components/RoomChip";
import { roomStore } from "../../net/room";
import { HostHeader, PlayerCount } from "./HostHeader";

type Props = {
  room: RoomState;
  /** Present once voting has closed and the round countdown is running. */
  countdown?: { endsAt: number; offset: number };
};

export function HostVoting({ room }: Props) {
  const totals = tallyVotes(room.votes);

  return (
    <main className="screen screen--host host-voting">
      <HostHeader
        left={<RoomChip code={room.code} />}
        round={currentRound(room)}
        of={room.settings.roundCount}
        right={<PlayerCount n={room.players.length} />}
      />
      <ul className="host-voting__grid">
        {CATEGORIES.map((c) => (
          <li key={c} className="card">
            {c} — {totals[c] ?? 0}
          </li>
        ))}
      </ul>
      <div className="host-voting__footer">
        <button
          type="button"
          className="btn btn--secondary btn--small"
          onClick={() => roomStore.send({ type: "backToLobby" })}
        >
          Back to room
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => roomStore.send({ type: "startGame" })}
        >
          Continue
        </button>
      </div>
    </main>
  );
}
```

Create `src/screens/player/PlayerVoting.tsx`:

```tsx
import { CATEGORIES } from "../../../shared/categories";
import { voteBudget, votesSpent } from "../../../shared/voting";
import type { PlayerId, RoomState } from "../../../shared/state";
import { roomStore } from "../../net/room";

type Props = {
  room: RoomState;
  playerId: PlayerId;
  /** Present once voting has closed and the round countdown is running. */
  countdown?: { endsAt: number; offset: number };
};

export function PlayerVoting({ room, playerId, countdown }: Props) {
  const mine = room.votes[playerId] ?? {};
  const left = voteBudget(room.settings) - votesSpent(mine);
  const locked = left === 0 || countdown !== undefined;

  return (
    <main className="screen screen--mobile screen--locked player-voting">
      <p className="player-voting__left">{left} votes left</p>
      <ul className="player-voting__grid">
        {CATEGORIES.map((c) => (
          <li key={c}>
            <button
              type="button"
              className="card vote-tile"
              disabled={locked}
              onClick={() => roomStore.send({ type: "castVote", category: c })}
            >
              {c}
              {mine[c] ? ` ×${mine[c]}` : ""}
            </button>
          </li>
        ))}
      </ul>
      {!countdown && (
        <button
          type="button"
          className="btn btn--secondary btn--block"
          onClick={() => roomStore.send({ type: "resetVotes" })}
        >
          Reset votes
        </button>
      )}
    </main>
  );
}
```

- [ ] **Step 8: Route both views**

In `src/screens/player/PlayerView.tsx`, import `countdownScreen` alongside `preRoundPhase`, import `PlayerVoting`, and replace the `countdown` case plus add a `voting` case:

```tsx
    case "voting":
      return <PlayerVoting room={room} playerId={getPlayerId()} />;
    case "countdown": {
      const countdown = { endsAt: room.phase.endsAt, offset: state.clockOffset };
      const screen = countdownScreen(room);
      if (screen === "lobby") {
        return (
          <PlayerLobby
            room={room}
            playerId={getPlayerId()}
            countdown={countdown}
            onLeave={onLeave}
          />
        );
      }
      if (screen === "voting") {
        return <PlayerVoting room={room} playerId={getPlayerId()} countdown={countdown} />;
      }
      return <PlayerStandings room={room} playerId={getPlayerId()} countdown={countdown} />;
    }
```

Apply the equivalent change in `src/screens/host/HostView.tsx`, rendering `HostVoting` for the `voting` phase and for `countdownScreen(room) === "voting"`.

- [ ] **Step 9: Verify**

Run: `npm test && npm run typecheck`
Expected: green, both tsc projects.

- [ ] **Step 10: Smoke test in the browser**

Start both servers, open `?p=1` (create), `?p=2`, `?p=3` (join with the code). Set 3 rounds. Ready everyone up. Confirm: 5s countdown → voting screen → each phone shows "2 votes left" → tapping tiles decrements → when the last player spends their last vote, a 5s countdown runs and the round starts. Confirm the round's category is still `woman` (the draw lands in Task 5).

- [ ] **Step 11: Commit**

```bash
git add shared/state.ts shared/reduce.ts shared/protocol.ts shared/reduce.test.ts shared/state.test.ts party/server.ts src/screens/host/HostVoting.tsx src/screens/host/HostView.tsx src/screens/player/PlayerVoting.tsx src/screens/player/PlayerView.tsx && git commit -m "feat: add the category voting phase"
```

---

### Task 5: Draw the category at the whistle

Wires Task 2's draw into the tick that opens `playing`, threading a roll from the Durable Object so `reduce` stays pure.

**Files:**
- Modify: `shared/reduce.ts`
- Modify: `party/server.ts`
- Test: `shared/reduce.test.ts`

**Interfaces:**
- Consumes: `pickCategory`, `spentCategories` (Task 2).
- Produces: `RoomEvent` tick is now `{ t: "tick"; now: number; roll: number }`; `alarmOutcome(room, now, hasConnections, roll)`.

- [ ] **Step 1: Write the failing tests**

Append to `shared/reduce.test.ts`:

```ts
describe("drawing the round's category", () => {
  /** Voting closed with p0 having stacked everything on one category. */
  function votedRoom(category: string, roundCount = 2): Room {
    let room = seedVoting(1, roundCount);
    const budget = voteBudget(room.settings);
    for (let i = 0; i < budget; i++) {
      room = reduce(room, { t: "castVote", playerId: "p0", category, now: 3000 });
    }
    return room;
  }

  test("the whistle draws from the votes", () => {
    let room = votedRoom("car");
    const endsAt = (room.phase as { endsAt: number }).endsAt;
    room = reduce(room, { t: "tick", now: endsAt, roll: 0.5 });
    expect(room.phase.name).toBe("playing");
    expect(room.category).toBe("car");
  });

  test("the countdown does not draw — the category is secret until the whistle", () => {
    const room = votedRoom("car");
    expect(room.phase.name).toBe("countdown");
    expect(room.category).toBe("woman"); // still the seeded default
  });

  test("a category already played is never drawn again", () => {
    let room = votedRoom("car", 3);
    room = { ...room, history: [{ category: "car", places: {} }] };
    const endsAt = (room.phase as { endsAt: number }).endsAt;
    room = reduce(room, { t: "tick", now: endsAt, roll: 0.5 });
    expect(room.category).not.toBe("car");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run shared/reduce.test.ts`
Expected: FAIL — `roll` is not a property of the tick event.

- [ ] **Step 3: Thread the roll**

In `shared/reduce.ts`, import the draw:

```ts
import { pickCategory, spentCategories, voteBudget, votesSpent } from "./voting";
```

Change the tick event:

```ts
  /**
   * `roll` is a uniform [0,1) supplied by the caller. Randomness is injected
   * at the edge so `reduce` stays a pure function and the draw is testable
   * against fixed rolls rather than a stubbed global.
   */
  | { t: "tick"; now: number; roll: number }
```

Update the `tick` dispatch in `apply`:

```ts
    case "tick":
      return tick(room, ev.now, ev.roll);
```

Change the signature and the playing branch:

```ts
function tick(room: Room, now: number, roll: number): Room {
```

```ts
    return {
      ...room,
      // Drawn here and nowhere else. Doing it at the whistle rather than when
      // the countdown opens means there is no window in which a cancelled
      // countdown could re-roll it, and nothing on the countdown screen can
      // leak it.
      category: pickCategory(room.votes, spentCategories(room), roll),
      phase: { name: "playing", endsAt: now + room.settings.durationSec * 1_000 },
    };
```

Update `alarmOutcome`:

```ts
export function alarmOutcome(
  room: Room,
  now: number,
  /** Whether any socket is still open for this room. */
  hasConnections: boolean,
  /** Uniform [0,1) for the category draw — see the tick event. */
  roll: number,
): AlarmOutcome {
```

and its internal call:

```ts
  const next = reduce(room, { t: "tick", now, roll });
```

- [ ] **Step 4: Supply the roll from the Durable Object**

In `party/server.ts`, `onAlarm`:

```ts
    // The only randomness in the game, and it enters here — shared/ stays pure.
    const outcome = alarmOutcome(this.room, Date.now(), this.hasAnyConnection(), Math.random());
```

- [ ] **Step 5: Fix the existing tick call sites**

Every other `{ t: "tick", now }` in `shared/reduce.test.ts` — including the `seedVoting` helper from Task 4 — needs a `roll`. Use `roll: 0` unless the test is about the draw.

Run: `npm run typecheck`
Expected: the errors list every remaining site.

- [ ] **Step 6: Verify**

Run: `npm test && npm run typecheck`
Expected: green.

- [ ] **Step 7: Smoke test**

Run a 3-round match with three tabs. Confirm each round's category differs, matches something that was voted for, and never repeats within the match.

- [ ] **Step 8: Commit**

```bash
git add shared/reduce.ts shared/reduce.test.ts party/server.ts && git commit -m "feat: draw the round's category at the whistle"
```

---

### Task 6: Build the host voting screen

Replaces Task 4's placeholder with the design. Two states of one component: voting open, and voting closed under the round countdown.

**Files:**
- Modify: `src/screens/host/HostVoting.tsx`
- Modify: `src/screens/host/HostHeader.tsx`
- Modify: `src/style.css`

**Interfaces:**
- Consumes: `tallyVotes`, `voteShares`, `voteBudget` (Tasks 1–2); `useRemaining` from `src/net/clock.ts`; `HostHeader`, `RoomChip`.
- Produces: `HostVoting` renders both states from `room` + optional `countdown`.

**Reference:** frames `Voting — Host (open) B` and `Voting — Host (closed)`. Every number below comes from them; open `design_handoff_ok_name_one/Ok Name One MVP (standalone).html` in a browser to see them.

- [ ] **Step 1: Add the ready-count slot to the header**

In `src/screens/host/HostHeader.tsx`, add beside `PlayerCount`:

```tsx
export function VotingCount({ n, ready }: { n: number; ready: number }) {
  return (
    <span className="host-header__count">
      {n} {n === 1 ? "PLAYER" : "PLAYERS"} · {ready} READY
    </span>
  );
}
```

- [ ] **Step 2: Write the component**

Replace `src/screens/host/HostVoting.tsx`:

```tsx
import { useRemaining } from "../../net/clock";
import { CATEGORIES } from "../../../shared/categories";
import { tallyVotes, voteBudget, voteShares } from "../../../shared/voting";
import { currentRound } from "../../../shared/state";
import type { Player, RoomState } from "../../../shared/state";
import { RoomChip } from "../../components/RoomChip";
import { roomStore } from "../../net/room";
import { HostHeader, VotingCount } from "./HostHeader";

type Props = {
  room: RoomState;
  /** Present once voting has closed and the round countdown is running. */
  countdown?: { endsAt: number; offset: number };
};

/** Who voted for this category, and how many times each. */
function votersFor(room: RoomState, category: string): Array<[Player, number]> {
  const out: Array<[Player, number]> = [];
  for (const p of room.players) {
    const n = room.votes[p.id]?.[category] ?? 0;
    if (n > 0) out.push([p, n]);
  }
  return out;
}

/**
 * The avatar strip and its total. Shared by the open grid and both rows of the
 * closed reveal — three renderings of the same thing, so it is one component.
 * `overflow: hidden` on the row means the avatars clip under pressure and the
 * total never does.
 */
function VoteFoot({
  room, category, total, totalStyle,
}: {
  room: RoomState;
  category: string;
  /** Vote count while voting is open; the share percentage once it has closed. */
  total: string;
  totalStyle?: { fontSize: string };
}) {
  return (
    <span className="vote-card__foot">
      <span className="vote-card__voters">
        {votersFor(room, category).map(([p, n]) => (
          <span className="vote-card__voter" key={p.id}>
            {p.emoji}
            {n > 1 && <span className="vote-card__times">×{n}</span>}
          </span>
        ))}
      </span>
      <span className="vote-card__total" style={totalStyle}>{total}</span>
    </span>
  );
}

/**
 * Name size steps with share so the leader reads from the sofa. A step
 * function rather than per-card magic numbers, so adding a category cannot
 * quietly change the type scale.
 */
function nameSize(votes: number): string {
  if (votes >= 8) return "38px";
  if (votes >= 3) return "26px";
  if (votes === 2) return "24px";
  return "21px";
}

export function HostVoting({ room, countdown }: Props) {
  const totals = tallyVotes(room.votes);
  // One hook, one deadline: the voting window while it runs, the round
  // countdown once it has closed. `useRemaining` returns whole seconds.
  const remaining = useRemaining(
    countdown?.endsAt ?? (room.phase.name === "voting" ? room.phase.endsAt : 0),
    countdown?.offset ?? 0,
  );
  const budget = voteBudget(room.settings);
  const cast = Object.values(totals).reduce((a, b) => a + b, 0);
  const ready = room.players.filter((p) => p.ready).length;

  if (countdown) {
    return <HostVotingClosed room={room} totals={totals} remaining={remaining} cast={cast} />;
  }

  // Four rows of four, in fixed pool order — nothing sorts this.
  const rows = [0, 4, 8, 12].map((i) => CATEGORIES.slice(i, i + 4));

  return (
    <main className="screen screen--host host-voting">
      <HostHeader
        left={<RoomChip code={room.code} />}
        round={currentRound(room)}
        of={room.settings.roundCount}
        right={<VotingCount n={room.players.length} ready={ready} />}
      />

      <p className="host-voting__prompt">
        PICK YOUR CATEGORIES — {budget} {budget === 1 ? "VOTE" : "VOTES"} EACH
      </p>

      <div className="host-voting__grid">
        {rows.map((row, i) => (
          <div className="host-voting__row" key={i}>
            {row.map((category) => {
              const votes = totals[category] ?? 0;
              return (
                <div
                  key={category}
                  className={votes > 0 ? "vote-card" : "vote-card vote-card--zero"}
                  // The whole mechanic: card width IS the odds. No measurement,
                  // no JS layout pass — flex-grow carries it.
                  style={{ flexGrow: votes + 1 }}
                >
                  <span
                    className="vote-card__name"
                    style={votes > 0 ? { fontSize: nameSize(votes) } : undefined}
                  >
                    {category}
                  </span>
                  {votes > 0 && (
                    <VoteFoot room={room} category={category} total={String(votes)} />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="host-voting__footer">
        {/* `formatClock` gives the m:ss the host timer is drawn in, and the
            fill comes off the same seconds — no second clock. */}
        <span className="host-voting__clock">{formatClock(remaining)}</span>
        <span className="timer-track">
          <span
            className="timer-track__fill"
            style={{ width: `${Math.min(100, (remaining / (VOTING_MS / 1000)) * 100)}%` }}
          />
        </span>
        <button
          type="button"
          className="btn btn--ghost btn--small"
          onClick={() => roomStore.send({ type: "backToLobby" })}
        >
          Back to room
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => roomStore.send({ type: "startGame" })}
        >
          Continue
        </button>
      </div>
    </main>
  );
}
```

The imports this needs, beyond those already listed: `formatClock` from `../../net/clock` and `VOTING_MS` from `../../../shared/reduce`.

- [ ] **Step 3: Write the closed state**

Append to `src/screens/host/HostVoting.tsx`:

```tsx
function HostVotingClosed({
  room, totals, remaining, cast,
}: {
  room: RoomState;
  totals: Record<string, number>;
  /** Whole seconds — `useRemaining` returns a number, not a formatted string. */
  remaining: number;
  cast: number;
}) {
  const shares = voteShares(room.votes);
  // Survivors only, strongest first. Zero-vote categories are gone.
  const survivors = CATEGORIES
    .filter((c) => (totals[c] ?? 0) > 0)
    .sort((a, b) => (totals[b] ?? 0) - (totals[a] ?? 0));
  const top = survivors.slice(0, 3);
  const rest = survivors.slice(3);
  const topSize = ["52px", "34px", "30px"];
  const topShare = ["46px", "34px", "30px"];

  return (
    <main className="screen screen--host host-voting host-voting--closed">
      <HostHeader
        left={<RoomChip code={room.code} />}
        round={currentRound(room)}
        of={room.settings.roundCount}
        right={
          <span className="host-header__count">
            VOTING CLOSED · {cast} {cast === 1 ? "VOTE" : "VOTES"} IN
          </span>
        }
      />

      <div className="host-voting__result">
        <div className="host-voting__row host-voting__row--top">
          {top.map((category, i) => (
            <div className="vote-card" key={category} style={{ flexGrow: shares[category] }}>
              <span className="vote-card__name" style={{ fontSize: topSize[i] }}>{category}</span>
              <VoteFoot
                room={room}
                category={category}
                total={`${shares[category]}%`}
                totalStyle={{ fontSize: topShare[i] }}
              />
            </div>
          ))}
        </div>

        {rest.length > 0 && (
          <div className="host-voting__row host-voting__row--rest">
            {rest.map((category) => (
              // Equal width below the top three: under ~10% the differences
              // are not worth a size difference.
              <div className="vote-card vote-card--small" key={category}>
                <span className="vote-card__name">{category}</span>
                <VoteFoot room={room} category={category} total={`${shares[category]}%`} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Nothing here names the drawn category. It has not been drawn yet — the
          draw happens at the whistle. */}
      <div className="host-voting__closed-footer">
        <p className="get-ready get-ready--tv">Get ready… {remaining}</p>
        <button
          type="button"
          className="btn btn--secondary btn--small"
          onClick={() => roomStore.send({ type: "cancelStart" })}
        >
          Stop
        </button>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Add the styles**

Append to `src/style.css`, after the host-lobby block. Add any missing token to `:root` rather than writing a loose hex.

```css
/* ----------------------------------------------------------- host voting */

.host-voting { padding: 0; }

.host-voting__prompt {
  font-family: var(--display);
  font-size: 15px;
  letter-spacing: 0.16em;
  color: var(--cream);
  text-align: center;
  padding: 0 34px 12px;
}

.host-voting__grid,
.host-voting__result {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 0 30px 16px;
}

.host-voting__row { display: flex; gap: 12px; flex: 1; min-height: 0; }
.host-voting__result { justify-content: center; }
.host-voting__row--top { flex: 0 0 206px; }
.host-voting__row--rest { flex: 0 0 118px; justify-content: center; }

/* Width is the odds: flex-grow carries the vote count, so a vote visibly
   grows its card with no measurement and no JS layout pass. */
.vote-card {
  flex: 1 1 0;
  min-width: 104px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  background: var(--cream);
  color: var(--ink);
  border: var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-btn);
  padding: 9px 12px;
  overflow: hidden;
  transition: flex-grow 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.vote-card--small { flex: 0 0 210px; }

/* A category nobody wanted: sunken, flat, name only. */
.vote-card--zero {
  background: var(--code-empty);
  box-shadow: none;
  justify-content: center;
}

.vote-card--zero .vote-card__name { font-size: 17px; text-align: center; }

.vote-card__name {
  font-family: var(--display);
  line-height: 1.06;
  overflow-wrap: anywhere;
}

.vote-card__foot {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 8px;
  /* The pink total is the graceful degradation: at ten players the avatars
     clip against this, and the number never does. */
  overflow: hidden;
}

.vote-card__voters { display: flex; align-items: center; gap: 4px; overflow: hidden; }
.vote-card__voter { display: inline-flex; align-items: baseline; font-size: 21px; }

.vote-card__times {
  font-family: var(--display);
  font-size: 12px;
  color: var(--ink-dim);
  margin-left: 1px;
}

.vote-card__total {
  font-family: var(--display);
  font-size: 20px;
  color: var(--pink);
  flex: 0 0 auto;
}

.host-voting__footer {
  flex: 0 0 106px;
  display: flex;
  align-items: center;
  gap: 22px;
  padding: 0 28px;
  background: var(--cream);
  border-top: var(--border);
}

.host-voting__clock {
  font-family: var(--display);
  font-size: 52px;
  color: var(--ink);
  flex: 0 0 auto;
}

.host-voting__footer .timer-track { flex: 1; height: 28px; }

/* Cream on a cream footer would vanish, so the secondary action is a ghost. */
.btn--ghost {
  background: transparent;
  color: var(--ink);
  box-shadow: none;
  border: var(--border);
}

.host-voting__closed-footer {
  flex: 0 0 126px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
}

/* The countdown plaque, scaled for a TV. A separate class rather than an
   override, so the phone-sized one keeps its numbers. */
.get-ready--tv { font-size: 40px; padding: 14px 36px; }

@media (prefers-reduced-motion: reduce) {
  .vote-card { transition: none; }
}
```

- [ ] **Step 5: Verify**

Run: `npm test && npm run typecheck`
Expected: green.

- [ ] **Step 6: Check it in the browser at TV size**

Open the host tab, resize to 1200×675, and drive a vote from two phone tabs. Confirm:
- All 16 cards visible, no scrolling, no page scroll.
- A vote visibly widens its card.
- Ten players stacked on one category clips the avatars and keeps the pink numeral.
- The closed state drops the zero cards and centres the survivors with shares summing to 100.
- No cream text on cream anywhere; no blurred shadow.

- [ ] **Step 7: Commit**

```bash
git add src/screens/host/HostVoting.tsx src/screens/host/HostHeader.tsx src/style.css && git commit -m "style: build the host voting screen"
```

---

### Task 7: Build the player voting screen

Three states of one component: voting, spent, and locked under the round countdown.

**Files:**
- Modify: `src/screens/player/PlayerVoting.tsx`
- Modify: `src/style.css`

**Interfaces:**
- Consumes: `voteBudget`, `votesSpent` (Task 1); `useRemaining`.

**Reference:** frames `Voting — Player (voting) A` and `Voting — Player (spent)`.

- [ ] **Step 1: Write the component**

Replace `src/screens/player/PlayerVoting.tsx`:

```tsx
import { useEffect, useState } from "react";
import { formatClock, useRemaining } from "../../net/clock";
import { CATEGORIES } from "../../../shared/categories";
import { VOTING_MS } from "../../../shared/reduce";
import { voteBudget, votesSpent } from "../../../shared/voting";
import { currentRound } from "../../../shared/state";
import type { PlayerId, RoomState } from "../../../shared/state";
import { roomStore } from "../../net/room";

type Props = {
  room: RoomState;
  playerId: PlayerId;
  /** Present once voting has closed and the round countdown is running. */
  countdown?: { endsAt: number; offset: number };
};

export function PlayerVoting({ room, playerId, countdown }: Props) {
  const me = room.players.find((p) => p.id === playerId);
  const mine = room.votes[playerId] ?? {};
  const budget = voteBudget(room.settings);
  const spent = votesSpent(mine);
  const left = budget - spent;
  const closed = countdown !== undefined;
  // Locked either because this player is done, or because voting is over —
  // a player who never spent their votes before the 60s expired locks too,
  // rather than being handed a live grid during the countdown.
  const locked = left === 0 || closed;
  const waitingOn = room.players.filter((p) => p.connected && !p.ready).length;

  const votingEndsAt = room.phase.name === "voting" ? room.phase.endsAt : 0;
  const remaining = useRemaining(
    closed ? countdown.endsAt : votingEndsAt,
    closed ? countdown.offset : 0,
  );

  // The numeral is the loudest thing on the screen and it changes on every
  // tap, so it gets the feedback — not the card around it.
  const [bump, setBump] = useState(0);
  useEffect(() => { setBump((n) => n + 1); }, [spent]);

  return (
    <main className="screen screen--mobile screen--locked player-voting">
      <p className="player-voting__meta">
        ROOM {room.code} · ROUND {currentRound(room)} OF {room.settings.roundCount} ·{" "}
        {budget} {budget === 1 ? "VOTE" : "VOTES"} EACH
      </p>

      <section className="card player-voting__head">
        {left > 0 ? (
          <span className="player-voting__count" key={bump}>{left}</span>
        ) : (
          <span className="player-voting__avatar">{me?.emoji}</span>
        )}
        <span className="player-voting__head-text">
          <span className="player-voting__head-title">
            {left > 0 ? "votes left" : "you're in"}
          </span>
          {left === 0 && (
            <span className="player-voting__head-sub">
              all {budget} {budget === 1 ? "vote" : "votes"} spent
              {waitingOn > 0 && ` — waiting on ${waitingOn}`}
            </span>
          )}
          <span className="player-voting__pips">
            {Array.from({ length: budget }, (_, i) => (
              <span
                key={i}
                className={i < spent ? "pip pip--spent" : "pip"}
              />
            ))}
          </span>
        </span>
      </section>

      <ul className={locked ? "player-voting__grid player-voting__grid--locked" : "player-voting__grid"}>
        {CATEGORIES.map((category) => {
          const n = mine[category] ?? 0;
          const cls = [
            "vote-tile",
            n > 0 ? "vote-tile--voted" : "",
            locked ? "vote-tile--locked" : "",
          ].filter(Boolean).join(" ");
          return (
            <li key={category}>
              <button
                type="button"
                className={cls}
                aria-disabled={locked}
                disabled={locked}
                onClick={() => roomStore.send({ type: "castVote", category })}
              >
                <span className="vote-tile__name">{category}</span>
                {n > 0 && (
                  <span className="vote-tile__badge">
                    {me?.emoji}
                    {n > 1 && <span className="vote-tile__times">×{n}</span>}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="player-voting__foot">
        {closed ? (
          <p className="get-ready get-ready--small">Get ready… {remaining}</p>
        ) : (
          <>
            <span className="player-voting__timer">
              <span
                className="player-voting__timer-fill"
                style={{ width: `${Math.min(100, (remaining / (VOTING_MS / 1000)) * 100)}%` }}
              />
            </span>
            <span className="player-voting__clock">{formatClock(remaining)}</span>
            {/* Reset is the only way to change a vote — tiles add, they never
                toggle, which keeps a stacked tile unambiguous. It goes away
                once voting is over, since the server rejects it there. */}
            <button
              type="button"
              className="btn btn--secondary btn--block"
              onClick={() => roomStore.send({ type: "resetVotes" })}
            >
              Reset votes
            </button>
          </>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Add the styles**

First add the one missing token to `:root` in `src/style.css`, beside `--card-rule`. The timer track on the player screen sits on pink, not inside a cream card, so `--card-rule` is the wrong value and a loose `rgba()` would break the no-loose-hex rule:

```css
  --cream-track: rgba(255, 247, 232, 0.3); /* timer track on a pink field */
```

Then append:

```css
/* --------------------------------------------------------- player voting */

/* Three bands: pinned head, scrolling grid, pinned foot. The page never
   scrolls — only the grid does. */
.player-voting {
  padding: 44px 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.player-voting__meta {
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--cream-dim);
  text-align: center;
}

.player-voting__head {
  flex: 0 0 auto;
  flex-direction: row;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
}

.player-voting__count {
  font-family: var(--display);
  font-size: 48px;
  line-height: 1;
  color: var(--pink);
  animation: votePop 120ms ease-out;
}

.player-voting__avatar { font-size: 34px; line-height: 1; }

.player-voting__head-text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.player-voting__head-title { font-family: var(--display); font-size: 15px; color: var(--ink); }
.player-voting__head-sub { font-size: 13px; color: var(--ink-dim); }

.player-voting__pips { display: flex; gap: 7px; margin-top: 2px; }

.pip {
  width: 15px;
  height: 15px;
  border-radius: 50%;
  border: var(--border);
  background: var(--code-empty);
}

.pip--spent { background: var(--gold); }

@keyframes votePop {
  0% { transform: scale(1); }
  50% { transform: scale(1.12); }
  100% { transform: scale(1); }
}

/* Scrolls in its own box. The padding is clearance for the corner badges and
   the offset shadows, not decoration — remove it and both clip. */
.player-voting__grid {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--scroll-thumb) transparent;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px 14px;
  align-content: start;
  padding: 12px 8px;
}

.player-voting__grid--locked { pointer-events: none; }

.vote-tile {
  position: relative;
  width: 100%;
  min-height: 56px;
  font: inherit;
  font-family: var(--display);
  font-size: 16px;
  text-align: left;
  background: var(--cream);
  color: var(--ink);
  border: var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-btn);
  padding: 12px;
  cursor: pointer;
  overflow-wrap: anywhere;
}

/* The same press physics as .btn, so the gesture feels like the rest of the app. */
.vote-tile:active:not(:disabled) {
  transform: translate(3px, 3px);
  box-shadow: 2px 2px 0 var(--ink);
}

/* Locked reuses that press: the card sits down into where its own shadow was,
   so "you can't tap this" needs no new colour and no icon. */
.vote-tile--locked {
  transform: translate(4px, 4px);
  box-shadow: none;
  cursor: default;
}

/* Your own stake stays cream and badged even when locked; everything you
   didn't back goes sunken. */
.vote-tile--locked:not(.vote-tile--voted) {
  background: var(--code-empty);
  color: var(--ink-dim);
}

.vote-tile__badge {
  position: absolute;
  top: -11px;
  left: -9px;
  display: inline-flex;
  align-items: center;
  gap: 1px;
  font-size: 15px;
  line-height: 1;
  padding: 4px 7px;
  border-radius: 99px;
  border: var(--border);
  background: var(--gold);
  color: var(--ink-gold);
}

.vote-tile__times { font-family: var(--display); font-size: 10px; }

.player-voting__foot {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.player-voting__timer {
  width: 100%;
  height: 10px;
  border-radius: 99px;
  background: var(--cream-track);
  overflow: hidden;
}

.player-voting__timer-fill { height: 100%; background: var(--teal); }
.player-voting__clock { font-family: var(--display); font-size: 14px; color: var(--cream); }

@media (prefers-reduced-motion: reduce) {
  .player-voting__count { animation: none; }
}
```

- [ ] **Step 3: Verify**

Run: `npm test && npm run typecheck`
Expected: green.

- [ ] **Step 4: Check it on a phone-sized viewport**

At 390×844, with `roundCount` 10 (9 votes) and then 1 (1 vote):
- The head card is the same height in both — the pip row must not reflow it.
- The grid scrolls; the page does not. Head and foot stay pinned.
- Tiles clear 44px. "body part" wraps without clipping.
- A voted tile's badge is fully visible, not clipped by the grid box.
- Spending the last vote locks every tile and swaps the head to "you're in".
- The countdown state hides Reset votes and shows the plaque.

- [ ] **Step 5: Commit**

```bash
git add src/screens/player/PlayerVoting.tsx src/style.css && git commit -m "style: build the player voting screen"
```

---

### Task 8: Copy, and the docs that describe the old behaviour

**Files:**
- Modify: `src/screens/host/HostLobby.tsx:106`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Rename the lobby button**

In `src/screens/host/HostLobby.tsx`, change the button text from `Start round` to `Start game` — it now starts a match, and the first thing it opens is the vote. `HostStandings` keeps `Next round`: that one does start a round.

- [ ] **Step 2: Update CLAUDE.md**

In the "What this is" section, replace the fixed-category sentence with the voting scope, and reference the new spec beside the match-structure one.

In "State flow", add to the bullet list:

```markdown
- Voting is bookended by a countdown on both sides, so `countdown` carries a
  `to: "voting" | "playing"`. It is the one phase field that is stored rather
  than derived: two distinct countdowns now sit at `history.length === 0`, so
  there is nothing left to derive the destination from.
- **Opening `voting` clears every ready flag.** `ready` means "waiting in the
  room" before that edge and "votes spent" after it; carried across, the next
  `settle` closes voting before anyone has voted. It happens in exactly one
  place — the tick that opens `voting`.
- The post-voting countdown is not readiness-cancellable. `everyoneReady` needs
  `MIN_PLAYERS`, so after a host solo-start that branch would tear it down on
  the next event.
```

In "Invariants", add:

```markdown
- **`votes` is the deliberate exception to the broadcast boundary.** Unlike
  `entries`, it rides in `RoomState`: the host TV renders the full tally to the
  room by design, so guarding it would cost per-connection encoding for a
  secret that is already on the wall.
- **The round's category is drawn at the whistle, never earlier.** Drawing when
  the countdown opens would let a cancelled countdown re-roll it and would let
  the countdown screen leak it. Randomness enters via the tick's `roll` so
  `reduce` stays pure.
```

- [ ] **Step 3: Verify and commit**

Run: `npm test && npm run typecheck && npm run build`
Expected: green.

```bash
git add src/screens/host/HostLobby.tsx CLAUDE.md && git commit -m "docs: describe the voting phase in CLAUDE.md"
```

---

## Notes for the implementer

**A pre-existing defect you will trip over.** `settle`'s countdown branch cancels on `!everyoneReady(room, MIN_PLAYERS)`, which is false whenever fewer than two players are connected. That means a host solo-start's countdown is already fragile today: any event landing during those five seconds cancels it. Task 4 guards the post-voting countdown against this explicitly, but the lobby→voting countdown still has it. If you see a solo start bounce straight back to the room, that is this — flag it rather than widening the Task 4 guard without discussion, because the fix changes existing behaviour.

**The clock has two exports and they are easy to swap.** `useRemaining(endsAt, offset)` returns whole seconds as a **number**; `formatClock(seconds)` turns that into `m:ss`. Both voting screens render `formatClock(remaining)` and derive their bar width from the same `remaining`. Never add a second `setInterval` — timers broadcast an absolute `endsAt` and every client counts down locally against `clockOffset`.

**The timer fill class is `.timer-track__fill`**, inside `.timer-track` — see `HostPlaying.tsx:48`. Not `.timer-fill`.

**Deferred:** the FLIP transition for the host open→closed reveal, specified in the handoff's §3. v1 ships the reduced-motion path for everyone. It is a self-contained follow-up and is listed under "Out of scope" in the spec.
