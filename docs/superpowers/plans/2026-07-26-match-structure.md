# Match Structure and Host Lobby Controls — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn w104 from a one-round game into a host-configurable match of 1–10 rounds with golf-style placement points that accumulate across rounds and a standings screen between them.

**Architecture:** All ranking rules go in `shared/` as pure functions under unit test. The Durable Object stores per-round aggregates (`Room.history`) and match settings (`Room.settings`); the client derives standings from them. The round number stops being stored and becomes `history.length + 1`. Readiness governs *every* round start, not just the first, so the inter-round countdown reuses the existing `settle()` path.

**Tech Stack:** TypeScript, React 18, Vite, PartyServer on Cloudflare Durable Objects, Vitest, plain CSS in `src/style.css`.

**Spec:** `docs/superpowers/specs/2026-07-26-match-structure-design.md` — read it before starting. This plan implements it exactly.

## Global Constraints

- **Node 22** (`.nvmrc`). Two terminals for manual testing: `npm run dev:party` and `npm run dev`.
- **All game rules live in `shared/`.** `party/server.ts` is plumbing only. If you are writing a rule inside the Durable Object, it belongs in `shared/reduce.ts` instead.
- **`reduce` must return the *identical object* for a no-op.** Both `party/server.ts` and `reduce` itself rely on that identity check. Never return a fresh object for a no-op.
- **Word lists never enter `RoomState`** except inside `phase.results` during `scoring`. `toRoomState()` in `shared/state.ts` is the privacy boundary.
- **No per-player entry counts in broadcasts.** Players must not see how many words rivals have.
- **Timers broadcast an absolute `endsAt`, never per-second ticks.**
- **Anything persisted must survive JSON.** Use `Record` and array, never `Map` or `Set`. Add a defaulting fallback in `load()` for every new field.
- **Durable Objects must stay on `new_sqlite_classes`** in `wrangler.jsonc`. Do not touch this.
- **`npm run typecheck` runs TWO tsc projects** — `tsconfig.json` (src + shared, DOM libs) and `tsconfig.worker.json` (party + shared, workers-types). A change to `shared/` must typecheck under both. Always run the full `npm run typecheck`, never a single project.
- **`npm test`, `npm run typecheck` and `npm run build` must all be green at every commit.** `npm test` runs `shared/**/*.test.ts` only (70 tests before this plan starts). Some tasks are deliberately red *between* steps — Task 3 Step 7 expects a typecheck failure that Step 11 resolves — but nothing is committed red.
- **Commits stage explicit paths — never `git add -A`.** The untracked working notes `Project W-104.md` and `W104 Party Game Wireframes.zip` must stay untracked.
- **No loose hex values in `src/style.css`.** Every colour and shape constant is already a token in `:root`. Use the tokens.
- **The host screen must never scroll.** `.screen--host` is `height: 100dvh; overflow: hidden`. Overflow scrolls inside its own box.
- **Player screens must never scroll.** `.screen--locked` is sized from the visual viewport for the same reason.
- Work on the current branch (`v1`). Do not create branches or PRs unless asked.

---

### Task 1: Standings scoring module

Pure logic, purely additive. Nothing else in the codebase changes, so `npm test` and `npm run typecheck` stay green from the first commit.

**Files:**
- Modify: `shared/state.ts` — add `MatchSettings`, `RoundPlace`, `RoundSummary` types only (do NOT change `Room` yet, that is Task 2)
- Modify: `shared/categories.ts` — add `DEFAULT_ROUND_COUNT`
- Create: `shared/standings.ts`
- Test: `shared/standings.test.ts`

**Interfaces:**
- Consumes: `Results`, `PlayerResult` from `shared/scoring.ts`; `Player`, `PlayerId` from `shared/state.ts`
- Produces: `MatchSettings`, `RoundPlace`, `RoundSummary` (in `state.ts`); `Standing`, `placeRound`, `computeStandings` (in `standings.ts`). Task 2 uses the types, Task 3 uses `placeRound`, Task 4 uses `computeStandings` and `Standing`.

`RoundPlace` lives in `state.ts`, not `standings.ts`, so that `standings.ts` can import from `state.ts` without `state.ts` importing back — a type-only cycle would work but is needless.

- [ ] **Step 1: Add the new types to `shared/state.ts`**

Add these near the top of the file, after the `Entry` type. Do not modify `Room`, `RoomState`, `createRoom` or `toRoomState` in this task.

```ts
export type MatchSettings = {
  /** 1..MAX_ROUND_COUNT. How many rounds this match runs. */
  roundCount: number;
  /** MIN_DURATION_SEC..MAX_DURATION_SEC. Seconds of typing per round. */
  durationSec: number;
};

/** One player's outcome in one round. */
export type RoundPlace = {
  unique: number;
  total: number;
  /** 1-based finishing position. Ties share a place; see shared/standings.ts. */
  place: number;
};

/**
 * One completed round. Aggregates only — never words — so this is safe to
 * carry in RoomState and cheap to rebroadcast on every state push.
 *
 * Deliberately carries no round number: its index in `Room.history` is its
 * round number, and a stored copy could disagree with the index.
 */
export type RoundSummary = {
  category: string;
  places: Record<PlayerId, RoundPlace>;
};
```

- [ ] **Step 2: Add `DEFAULT_ROUND_COUNT` to `shared/categories.ts`**

Add beneath the existing `DEFAULT_DURATION_SEC` line:

```ts
export const DEFAULT_ROUND_COUNT = 1;
```

- [ ] **Step 3: Write the failing tests**

Create `shared/standings.test.ts` with this exact content:

```ts
import { describe, expect, test } from "vitest";
import { computeStandings, placeRound } from "./standings";
import type { Results } from "./scoring";
import type { Player, RoundSummary } from "./state";

function player(id: string): Player {
  return { id, name: id.toUpperCase(), emoji: "🐙", ready: false, connected: true };
}

/** Results carrying only the fields placeRound reads. */
function results(...rows: [string, number, number][]): Results {
  return {
    players: rows.map(([id, unique, total]) => ({
      id,
      name: id.toUpperCase(),
      emoji: "🐙",
      unique,
      total,
      entries: [],
    })),
  };
}

/** A round summary from unique/total pairs, placed by placeRound. */
function round(...rows: [string, number, number][]): RoundSummary {
  return { category: "woman", places: placeRound(results(...rows)) };
}

describe("placeRound", () => {
  test("ranks by unique words, highest first", () => {
    const places = placeRound(results(["a", 2, 9], ["b", 7, 7], ["c", 5, 5]));
    expect(places.a.place).toBe(3);
    expect(places.b.place).toBe(1);
    expect(places.c.place).toBe(2);
  });

  test("carries unique and total through unchanged", () => {
    const places = placeRound(results(["a", 3, 8]));
    expect(places.a).toEqual({ unique: 3, total: 8, place: 1 });
  });

  test("tied players share a place and the next place is skipped", () => {
    // Standard competition ranking: 7,5,5,2 -> 1,2,2,4. Nobody takes 3rd.
    const places = placeRound(results(["a", 7, 7], ["b", 5, 5], ["c", 5, 6], ["d", 2, 2]));
    expect(places.a.place).toBe(1);
    expect(places.b.place).toBe(2);
    expect(places.c.place).toBe(2);
    expect(places.d.place).toBe(4);
  });

  test("everyone tied shares first place", () => {
    const places = placeRound(results(["a", 4, 4], ["b", 4, 9], ["c", 4, 1]));
    expect([places.a.place, places.b.place, places.c.place]).toEqual([1, 1, 1]);
  });

  test("total words never breaks a tie on unique", () => {
    const places = placeRound(results(["a", 3, 30], ["b", 3, 3]));
    expect(places.a.place).toBe(1);
    expect(places.b.place).toBe(1);
  });

  test("a player with no unique words is still ranked", () => {
    const places = placeRound(results(["a", 1, 4], ["b", 0, 6]));
    expect(places.b.place).toBe(2);
  });

  test("no players yields no places", () => {
    expect(placeRound(results())).toEqual({});
  });
});

describe("computeStandings", () => {
  const roster = [player("a"), player("b"), player("c")];

  test("empty history puts everyone on zero points, all tied first", () => {
    const standings = computeStandings(roster, []);
    expect(standings.map((s) => s.points)).toEqual([0, 0, 0]);
    expect(standings.map((s) => s.place)).toEqual([1, 1, 1]);
    expect(standings.map((s) => s.badges)).toEqual([[], [], []]);
  });

  test("one round: points are that round's places", () => {
    const standings = computeStandings(roster, [round(["a", 7, 7], ["b", 5, 5], ["c", 2, 2])]);
    expect(standings.map((s) => [s.id, s.points])).toEqual([["a", 1], ["b", 2], ["c", 3]]);
  });

  test("points accumulate and the lowest total ranks first", () => {
    const history = [
      round(["a", 7, 7], ["b", 5, 5], ["c", 2, 2]), // a=1 b=2 c=3
      round(["a", 1, 1], ["b", 9, 9], ["c", 4, 4]), // a=3 b=1 c=2
      round(["a", 8, 8], ["b", 1, 1], ["c", 4, 4]), // a=1 b=3 c=2
    ];
    const standings = computeStandings(roster, history);
    // a=1+3+1=5, b=2+1+3=6, c=3+2+2=7
    expect(standings.map((s) => [s.id, s.points])).toEqual([["a", 5], ["b", 6], ["c", 7]]);
  });

  test("badges record the place from each round in play order", () => {
    const history = [
      round(["a", 7, 7], ["b", 5, 5], ["c", 2, 2]),
      round(["a", 1, 1], ["b", 9, 9], ["c", 4, 4]),
    ];
    const a = computeStandings(roster, history).find((s) => s.id === "a")!;
    expect(a.badges).toEqual([1, 3]);
  });

  test("players level on points are co-winners sharing first place", () => {
    const history = [
      round(["a", 7, 7], ["b", 5, 5], ["c", 2, 2]), // a=1 b=2 c=3
      round(["a", 2, 2], ["b", 5, 5], ["c", 7, 7]), // a=3 b=2 c=1
    ];
    const standings = computeStandings(roster, history);
    // Every player totals 4.
    expect(standings.map((s) => s.points)).toEqual([4, 4, 4]);
    expect(standings.map((s) => s.place)).toEqual([1, 1, 1]);
  });

  test("returns players already sorted by place", () => {
    const standings = computeStandings(roster, [round(["a", 1, 1], ["b", 9, 9], ["c", 4, 4])]);
    expect(standings.map((s) => s.id)).toEqual(["b", "c", "a"]);
    expect(standings.map((s) => s.place)).toEqual([1, 2, 3]);
  });

  test("a kicked player drops out entirely despite appearing in history", () => {
    const history = [round(["a", 7, 7], ["b", 5, 5], ["c", 2, 2])];
    const standings = computeStandings([player("a"), player("c")], history);
    expect(standings.map((s) => s.id)).toEqual(["a", "c"]);
    expect(standings.find((s) => s.id === "c")!.points).toBe(3);
  });

  test("carries name and emoji from the live roster, not from history", () => {
    const renamed = [{ ...player("a"), name: "Renamed", emoji: "🦊" }];
    const standings = computeStandings(renamed, [round(["a", 1, 1])]);
    expect(standings[0].name).toBe("Renamed");
    expect(standings[0].emoji).toBe("🦊");
  });

  test("a player missing from a round contributes nothing rather than throwing", () => {
    const history: RoundSummary[] = [
      round(["a", 5, 5], ["b", 1, 1]),
      { category: "woman", places: placeRound(results(["a", 3, 3])) },
    ];
    const b = computeStandings(roster, history).find((s) => s.id === "b")!;
    expect(b.badges).toEqual([2]);
    expect(b.points).toBe(2);
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

```bash
npx vitest run shared/standings.test.ts
```

Expected: FAIL — `Failed to resolve import "./standings"`.

- [ ] **Step 5: Write the implementation**

Create `shared/standings.ts`:

```ts
import type { Results } from "./scoring";
import type { Player, PlayerId, RoundPlace, RoundSummary } from "./state";

export type Standing = {
  id: PlayerId;
  name: string;
  emoji: string;
  /** Sum of places across every round this player was scored in. */
  points: number;
  /** Place per round, in play order. The badge strip renders this directly. */
  badges: number[];
  /** 1-based standing position. Ties share a place. */
  place: number;
};

/**
 * Standard competition ranking on an ascending score: equal scores share a
 * place and the places after a tie are skipped, so 1,2,2,4 rather than
 * 1,2,2,3. Under golf points a shared place must cost what it costs — dense
 * ranking would make tying *cheaper* than losing outright.
 *
 * Callers wanting a descending rank pass a negated score.
 */
function rankAscending<T>(items: T[], scoreOf: (item: T) => number): Map<T, number> {
  const sorted = [...items].sort((a, b) => scoreOf(a) - scoreOf(b));
  const places = new Map<T, number>();
  sorted.forEach((item, i) => {
    const prev = i > 0 ? sorted[i - 1] : undefined;
    const place =
      prev !== undefined && scoreOf(prev) === scoreOf(item) ? places.get(prev)! : i + 1;
    places.set(item, place);
  });
  return places;
}

/** Ranks one round's results by unique words, highest first. */
export function placeRound(results: Results): Record<PlayerId, RoundPlace> {
  const ranked = rankAscending(results.players, (p) => -p.unique);
  const places: Record<PlayerId, RoundPlace> = {};
  for (const p of results.players) {
    places[p.id] = { unique: p.unique, total: p.total, place: ranked.get(p)! };
  }
  return places;
}

/**
 * Match standings: lowest points first, ties sharing a place.
 *
 * Iterates the live roster and looks history up by id, never the reverse.
 * That direction is what makes a kicked player vanish from the standings with
 * no special-casing, while a merely disconnected player keeps their seat,
 * points and badges.
 */
export function computeStandings(
  players: Player[],
  history: RoundSummary[],
): Standing[] {
  const rows = players.map((p) => {
    const badges = history
      .map((summary) => summary.places[p.id]?.place)
      .filter((place): place is number => place !== undefined);
    return {
      id: p.id,
      name: p.name,
      emoji: p.emoji,
      badges,
      points: badges.reduce((sum, place) => sum + place, 0),
      place: 0,
    };
  });

  const ranked = rankAscending(rows, (row) => row.points);
  return rows
    .map((row) => ({ ...row, place: ranked.get(row)! }))
    .sort((a, b) => a.place - b.place);
}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npx vitest run shared/standings.test.ts
```

Expected: PASS, 16 tests.

- [ ] **Step 7: Run the full suite and both typecheck projects**

```bash
npm test && npm run typecheck
```

Expected: all tests pass (70 existing + 16 new = 86), typecheck clean under both projects.

- [ ] **Step 8: Commit**

```bash
git add shared/standings.ts shared/standings.test.ts shared/state.ts shared/categories.ts
git commit -m "feat: add match standings scoring

Golf placement points: each round ranks by unique words and a player's
finishing position is their score, accumulated across rounds with the lowest
total winning. Standard competition ranking throughout, so ties share a place
and skip the next one -- under golf points a tie must not be cheaper than
losing outright."
```

---

### Task 2: Migrate the Room model to settings and history

Replaces `Room.durationSec` and `Room.round` with `Room.settings` and `Room.history`. Behaviour is unchanged — this is a data-model migration with mechanical call-site updates so that `npm run typecheck` stays green.

**Files:**
- Modify: `shared/state.ts` — `Room`, `createRoom`, derived helpers
- Modify: `shared/reduce.ts` — bounds constants, `tick`, the `newGame` case
- Modify: `party/server.ts:53-63` — `load()` defaults
- Modify: `src/screens/host/HostHeader.tsx` — optional `of` prop for `ROUND 2 / 3`
- Modify: `src/screens/host/HostPlaying.tsx:18,24,50`
- Modify: `src/screens/host/HostLobby.tsx:31`
- Modify: `src/screens/host/HostScoring.tsx:29`
- Modify: `src/screens/player/PlayerScoring.tsx:29`
- Test: `shared/state.test.ts`, `shared/reduce.test.ts`

**Interfaces:**
- Consumes: `MatchSettings`, `RoundSummary` from Task 1; `DEFAULT_ROUND_COUNT` from `shared/categories.ts`
- Produces: `Room.settings: MatchSettings`, `Room.history: RoundSummary[]`; `currentRound(view)`, `matchComplete(view)`, `preRoundPhase(view)` in `shared/state.ts`; `MIN_ROUND_COUNT`, `MAX_ROUND_COUNT`, `MIN_DURATION_SEC`, `MAX_DURATION_SEC` in `shared/reduce.ts`. Task 3 uses all of these.

- [ ] **Step 1: Write the failing tests**

In `shared/state.test.ts`, replace the `fullRoom()` helper's `durationSec: 45,` and `round: 3,` lines with:

```ts
    settings: { roundCount: 3, durationSec: 45 },
    history: [],
```

Update the exact-key-set assertion in `"publishes exactly the public keys"` to:

```ts
    expect(Object.keys(state).sort()).toEqual([
      "category",
      "code",
      "history",
      "hostId",
      "phase",
      "players",
      "serverTime",
      "settings",
    ]);
```

Update `"preserves the public fields and stamps the server clock"` to:

```ts
    expect(state).toEqual({
      code: "PLUM",
      hostId: "host",
      players: room.players,
      phase: { name: "playing", endsAt: 31_000 },
      category: "Bands",
      settings: { roundCount: 3, durationSec: 45 },
      history: [],
      serverTime: 9000,
    });
```

Append a new describe block to `shared/state.test.ts`:

```ts
describe("derived match helpers", () => {
  const view = (rounds: number, played: number) => ({
    settings: { roundCount: rounds, durationSec: 30 },
    history: Array.from({ length: played }, () => ({ category: "woman", places: {} })),
  });

  test("the current round is one past the rounds already banked", () => {
    expect(currentRound(view(3, 0))).toBe(1);
    expect(currentRound(view(3, 2))).toBe(3);
  });

  test("a match completes once history holds every round", () => {
    expect(matchComplete(view(3, 2))).toBe(false);
    expect(matchComplete(view(3, 3))).toBe(true);
    expect(matchComplete(view(1, 1))).toBe(true);
  });

  test("the pre-round phase is the lobby only before the first round", () => {
    expect(preRoundPhase(view(3, 0))).toBe("lobby");
    expect(preRoundPhase(view(3, 1))).toBe("standings");
  });
});
```

Add `currentRound, matchComplete, preRoundPhase` to the existing import from `./state` at the top of the file, and add `createRoom` settings coverage to the `createRoom` describe block:

```ts
  test("starts on the default settings with no rounds played", () => {
    const room = createRoom("PLUM", 1000);
    expect(room.settings).toEqual({ roundCount: 1, durationSec: 30 });
    expect(room.history).toEqual([]);
  });
```

In `shared/reduce.test.ts`, the three `newGame` tests reference `room.round`. Replace the whole test named `"a new game advances the round counter"` with:

```ts
  test("a new game leaves the round derived from history", () => {
    let room = playing();
    expect(currentRound(room)).toBe(1);
    const playEnd = (room.phase as { endsAt: number }).endsAt;
    room = reduce(room, { t: "tick", now: playEnd });
    const upEnd = (room.phase as { endsAt: number }).endsAt;
    room = reduce(room, { t: "tick", now: upEnd });

    room = reduce(room, { t: "newGame", playerId: "host", now: upEnd + 100 });
    // newGame does not bank a round; history is what moves the counter, and
    // Task 3 replaces newGame with showStandings + backToLobby.
    expect(currentRound(room)).toBe(1);
  });
```

Add `currentRound` to the `./state` import in `shared/reduce.test.ts`.

Add a test that the round duration now comes from settings:

```ts
  test("the round runs for the configured duration", () => {
    let room = seed(2);
    room = { ...room, settings: { roundCount: 1, durationSec: 90 } };
    room = readyAll(room, 1000);
    const cdEnd = (room.phase as { endsAt: number }).endsAt;
    room = reduce(room, { t: "tick", now: cdEnd });
    expect(room.phase.name).toBe("playing");
    expect((room.phase as { endsAt: number }).endsAt).toBe(cdEnd + 90_000);
  });
```

Put it inside the existing `describe("round"...)` block, or whichever describe already holds the `playing()` helper.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test
```

Expected: FAIL — `currentRound is not exported`, plus type errors on `settings`/`history`.

- [ ] **Step 3: Change the `Room` type and `createRoom` in `shared/state.ts`**

Update the import at the top:

```ts
import { DEFAULT_CATEGORY, DEFAULT_DURATION_SEC, DEFAULT_ROUND_COUNT } from "./categories";
```

In `Room`, **delete** the `durationSec: number;` field and the whole `round: number;` field with its comment block. **Add** in their place:

```ts
  settings: MatchSettings;
  /**
   * Every round already played, oldest first. Aggregates only — no words —
   * so it rides in RoomState safely and cheaply.
   *
   * This is also the round counter: there is no stored `round`, because a
   * stored one would have to increment when the inter-round countdown opens
   * and decrement when it is cancelled. History only ever grows, and only at
   * `showStandings`, so deriving from it makes cancelling a genuine no-op.
   */
  history: RoundSummary[];
```

Update `createRoom` — replace `durationSec: DEFAULT_DURATION_SEC,` and `round: 1,` with:

```ts
    settings: {
      roundCount: DEFAULT_ROUND_COUNT,
      durationSec: DEFAULT_DURATION_SEC,
    },
    history: [],
```

Append the derived helpers to the end of `shared/state.ts`:

```ts
/**
 * The fields the derived match helpers read. Typed as a subset so they work
 * on a server-side `Room` and a client-side `RoomState` alike.
 */
type MatchView = Pick<Room, "history" | "settings">;

/** 1-based. Derived, never stored — see `Room.history`. */
export function currentRound(view: MatchView): number {
  return view.history.length + 1;
}

/** Whether every round of the match has been played and banked. */
export function matchComplete(view: MatchView): boolean {
  return view.history.length >= view.settings.roundCount;
}

/**
 * Which phase a cancelled countdown returns to. Derived rather than recorded
 * on the countdown phase, so there is no second copy of the truth to drift.
 */
export function preRoundPhase(view: MatchView): "lobby" | "standings" {
  return view.history.length === 0 ? "lobby" : "standings";
}
```

- [ ] **Step 4: Add the bounds constants and fix `tick` in `shared/reduce.ts`**

Add beside the existing `MIN_PLAYERS` / `MAX_PLAYERS` / `MAX_ENTRIES` constants:

```ts
export const MIN_ROUND_COUNT = 1;
export const MAX_ROUND_COUNT = 10;
/** 15 seconds to 10 minutes. */
export const MIN_DURATION_SEC = 15;
export const MAX_DURATION_SEC = 600;
```

In `tick`, change the `countdown` branch from `room.durationSec` to:

```ts
    return {
      ...room,
      phase: { name: "playing", endsAt: now + room.settings.durationSec * 1_000 },
    };
```

In the `newGame` case, **delete** the `round: room.round + 1,` line. Leave the rest of `newGame` alone — Task 3 removes it.

- [ ] **Step 5: Fix `load()` in `party/server.ts`**

Replace the body of `load()` (around lines 53–63) with:

```ts
  private async load(): Promise<Room | null> {
    const stored = await this.ctx.storage.get<Room>("room");
    if (!stored) return null;
    // Rooms written before this change carry `round` and a top-level
    // `durationSec` instead of `settings`/`history`. Destructure the dead
    // fields off rather than spreading them, so they cannot ride along into
    // every broadcast.
    const { round: _round, durationSec: legacyDuration, ...rest } = stored as Room & {
      round?: number;
      durationSec?: number;
    };
    return {
      ...rest,
      kicked: rest.kicked ?? [],
      hostGoneAt: rest.hostGoneAt ?? null,
      history: rest.history ?? [],
      settings: rest.settings ?? {
        roundCount: DEFAULT_ROUND_COUNT,
        durationSec: legacyDuration ?? DEFAULT_DURATION_SEC,
      },
    };
  }
```

Update the doc comment above `load()` so it names `settings` and `history` rather than `round`. Add the import:

```ts
import { DEFAULT_DURATION_SEC, DEFAULT_ROUND_COUNT } from "../shared/categories";
```

(Check whether `party/server.ts` already imports from `../shared/categories`; if so, extend that import rather than adding a second one.)

- [ ] **Step 6: Teach `HostHeader` the round-of-total marker**

`src/screens/host/HostHeader.tsx` — the marker must read `ROUND 2 / 3` in a
multi-round match and stay `ROUND 2` in a single-round one. Replace the `Props`
type and the component:

```tsx
type Props = {
  left: ReactNode;
  round: number;
  /** Total rounds in the match. Omitted or 1 renders a bare round number. */
  of?: number;
  right: ReactNode;
};

export function HostHeader({ left, round, of, right }: Props) {
  return (
    <header className="host-header">
      {left}
      <span className="host-header__round">
        ROUND {round}
        {of !== undefined && of > 1 ? ` / ${of}` : ""}
      </span>
      {right}
    </header>
  );
}
```

- [ ] **Step 7: Fix the four client call sites**

`src/screens/host/HostPlaying.tsx` — line 18 `room.durationSec` → `room.settings.durationSec`; line 50 `{room.durationSec}` → `{room.settings.durationSec}`; line 24 `round={room.round}` → `round={currentRound(room)} of={room.settings.roundCount}`. Add `import { currentRound } from "../../../shared/state";` (extend the existing `shared/state` import if there is one).

`src/screens/host/HostLobby.tsx:31` — `round={room.round}` → `round={currentRound(room)} of={room.settings.roundCount}`, same import.

`src/screens/host/HostScoring.tsx:29` — `round={room.round}` → `round={currentRound(room)} of={room.settings.roundCount}`, same import.

`src/screens/player/PlayerScoring.tsx:29` — `ROUND {room.round}` → `ROUND {currentRound(room)}`, same import. No `/ total` here; the phone line is already tight.

- [ ] **Step 8: Run the tests and both typecheck projects**

```bash
npm test && npm run typecheck
```

Expected: all green. If typecheck complains about an unused `_round` binding, that is expected style in this repo — the existing `toRoomState` uses the same `_entries` convention.

- [ ] **Step 9: Commit**

```bash
git add shared/state.ts shared/state.test.ts shared/reduce.ts shared/reduce.test.ts party/server.ts src/screens/host/HostHeader.tsx src/screens/host/HostPlaying.tsx src/screens/host/HostLobby.tsx src/screens/host/HostScoring.tsx src/screens/player/PlayerScoring.tsx
git commit -m "refactor: replace Room.round and Room.durationSec with settings and history

The round number becomes derived from history length. A stored counter would
have to increment when the inter-round countdown opens and decrement when it
is cancelled; history only grows, so deriving makes a cancel a real no-op."
```

---

### Task 3: The match phase machine

Adds the `standings` phase and the three host events that drive it, widens `startGame`/`cancelStart`/`ready`, and removes `newGame`. After this task the game is fully playable end to end as a multi-round match — the screens are plain but correct.

**Files:**
- Modify: `shared/state.ts` — `Phase` gains `standings`
- Modify: `shared/reduce.ts` — events, `settle`, `apply`
- Modify: `shared/protocol.ts` — `ClientMessage`
- Modify: `party/server.ts` — message routing
- Modify: `src/screens/host/HostScoring.tsx` — footer button
- Modify: `src/screens/host/HostView.tsx` — `standings` case
- Modify: `src/screens/player/PlayerView.tsx` — `standings` case
- Create: `src/components/BadgeStrip.tsx`
- Create: `src/screens/host/HostStandings.tsx`
- Create: `src/screens/player/PlayerStandings.tsx`
- Test: `shared/reduce.test.ts`

**Interfaces:**
- Consumes: `placeRound` (Task 1), `currentRound` / `matchComplete` / `preRoundPhase` / `MIN_ROUND_COUNT` / `MAX_ROUND_COUNT` / `MIN_DURATION_SEC` / `MAX_DURATION_SEC` (Task 2), `computeStandings` / `Standing` (Task 1)
- Produces: `{ name: "standings" }` phase; client messages `setSettings`, `showStandings`, `backToLobby`; components `HostStandings` and `PlayerStandings`. Task 4 restyles both screens; Task 5 sends `setSettings`.

- [ ] **Step 1: Write the failing tests**

Append to `shared/reduce.test.ts`. Add `matchComplete, preRoundPhase` to the `./state` import and `MAX_DURATION_SEC, MAX_ROUND_COUNT, MIN_DURATION_SEC` to the `./reduce` import.

```ts
/** A room parked on the scoring screen with one round's results in hand. */
function scored(roundCount = 3): Room {
  let room = playing();
  room = { ...room, settings: { ...room.settings, roundCount } };
  room = submitEntry(room, "p0", "Adele", 10_000).room;
  room = submitEntry(room, "p0", "Beyonce", 10_100).room;
  room = submitEntry(room, "p1", "Adele", 10_200).room;
  const playEnd = (room.phase as { endsAt: number }).endsAt;
  room = reduce(room, { t: "tick", now: playEnd });
  const upEnd = (room.phase as { endsAt: number }).endsAt;
  return reduce(room, { t: "tick", now: upEnd });
}

describe("setSettings", () => {
  test("the host sets rounds and duration", () => {
    const room = reduce(seed(2), {
      t: "setSettings", playerId: "host", roundCount: 3, durationSec: 90, now: 2000,
    });
    expect(room.settings).toEqual({ roundCount: 3, durationSec: 90 });
  });

  test("a player cannot set settings", () => {
    const before = seed(2);
    const after = reduce(before, {
      t: "setSettings", playerId: "p0", roundCount: 5, durationSec: 60, now: 2000,
    });
    expect(after).toBe(before);
  });

  test("settings cannot change once the match is under way", () => {
    const before = playing();
    const after = reduce(before, {
      t: "setSettings", playerId: "host", roundCount: 5, durationSec: 60, now: 2000,
    });
    expect(after).toBe(before);
  });

  test("out-of-range values are clamped", () => {
    const room = reduce(seed(2), {
      t: "setSettings", playerId: "host", roundCount: 99, durationSec: 99_999, now: 2000,
    });
    expect(room.settings).toEqual({
      roundCount: MAX_ROUND_COUNT, durationSec: MAX_DURATION_SEC,
    });
    const low = reduce(seed(2), {
      t: "setSettings", playerId: "host", roundCount: 0, durationSec: 1, now: 2000,
    });
    expect(low.settings).toEqual({ roundCount: 1, durationSec: MIN_DURATION_SEC });
  });

  test("fractional values round and non-finite ones keep the current setting", () => {
    const room = reduce(seed(2), {
      t: "setSettings", playerId: "host", roundCount: 2.6, durationSec: Number.NaN, now: 2000,
    });
    expect(room.settings).toEqual({ roundCount: 3, durationSec: 30 });
  });

  test("setting the values they already hold is a no-op", () => {
    const before = seed(2);
    const after = reduce(before, {
      t: "setSettings", playerId: "host", roundCount: 1, durationSec: 30, now: 2000,
    });
    expect(after).toBe(before);
  });

  test("an omitted field leaves that setting alone", () => {
    let room = reduce(seed(2), {
      t: "setSettings", playerId: "host", roundCount: 4, durationSec: 60, now: 2000,
    });
    room = reduce(room, { t: "setSettings", playerId: "host", durationSec: 45, now: 2100 });
    expect(room.settings).toEqual({ roundCount: 4, durationSec: 45 });
  });
});

describe("showStandings", () => {
  test("banks the round, clears entries and un-readies everyone", () => {
    const room = reduce(scored(), { t: "showStandings", playerId: "host", now: 50_000 });
    expect(room.phase.name).toBe("standings");
    expect(room.history).toHaveLength(1);
    expect(room.history[0].category).toBe(room.category);
    expect(room.history[0].places.p0.place).toBe(1);
    expect(room.history[0].places.p1.place).toBe(2);
    expect(room.entries).toEqual({});
    expect(room.players.every((p) => !p.ready)).toBe(true);
  });

  test("banking a round advances the derived round number", () => {
    const room = reduce(scored(), { t: "showStandings", playerId: "host", now: 50_000 });
    expect(currentRound(room)).toBe(2);
  });

  test("a player cannot show standings", () => {
    const before = scored();
    expect(reduce(before, { t: "showStandings", playerId: "p0", now: 50_000 })).toBe(before);
  });

  test("standings can only be shown from the scoring screen", () => {
    const before = playing();
    expect(reduce(before, { t: "showStandings", playerId: "host", now: 50_000 })).toBe(before);
  });
});

describe("between rounds", () => {
  const toStandings = (roundCount = 3) =>
    reduce(scored(roundCount), { t: "showStandings", playerId: "host", now: 50_000 });

  test("everyone readying up opens the next countdown", () => {
    const room = readyAll(toStandings(), 51_000);
    expect(room.phase.name).toBe("countdown");
    expect((room.phase as { endsAt: number }).endsAt).toBe(51_000 + COUNTDOWN_MS);
  });

  test("un-readying returns to standings, not the lobby", () => {
    let room = readyAll(toStandings(), 51_000);
    room = reduce(room, { t: "ready", playerId: "p0", ready: false, now: 51_500 });
    expect(room.phase.name).toBe("standings");
  });

  test("the host cancelling returns to standings and un-readies everyone", () => {
    let room = readyAll(toStandings(), 51_000);
    room = reduce(room, { t: "cancelStart", playerId: "host", now: 51_500 });
    expect(room.phase.name).toBe("standings");
    expect(room.players.every((p) => !p.ready)).toBe(true);
  });

  test("the host can force-start the next round solo", () => {
    let room = toStandings();
    room = reduce(room, { t: "disconnect", playerId: "p1", now: 51_000 });
    room = reduce(room, { t: "startGame", playerId: "host", now: 51_100 });
    expect(room.phase.name).toBe("countdown");
    expect(room.players.every((p) => p.ready)).toBe(true);
  });

  test("cancelling a countdown leaves the round number untouched", () => {
    const standings = toStandings();
    expect(currentRound(standings)).toBe(2);
    let room = readyAll(standings, 51_000);
    room = reduce(room, { t: "cancelStart", playerId: "host", now: 51_500 });
    expect(currentRound(room)).toBe(2);
  });

  test("readying up on the final standings starts nothing", () => {
    const room = readyAll(toStandings(1), 51_000);
    expect(matchComplete(room)).toBe(true);
    expect(room.phase.name).toBe("standings");
  });

  test("the host cannot force-start past the final round", () => {
    const before = toStandings(1);
    expect(reduce(before, { t: "startGame", playerId: "host", now: 51_000 })).toBe(before);
  });

  test("the next round runs on the configured duration", () => {
    let room = toStandings();
    room = { ...room, settings: { ...room.settings, durationSec: 60 } };
    room = readyAll(room, 51_000);
    const cdEnd = (room.phase as { endsAt: number }).endsAt;
    room = reduce(room, { t: "tick", now: cdEnd });
    expect((room.phase as { endsAt: number }).endsAt).toBe(cdEnd + 60_000);
  });
});

describe("backToLobby", () => {
  const finished = () =>
    reduce(scored(1), { t: "showStandings", playerId: "host", now: 50_000 });

  test("resets the match but keeps settings and kicks", () => {
    let room = finished();
    room = reduce(room, { t: "kick", playerId: "host", targetId: "p1", now: 50_100 });
    room = reduce(room, { t: "backToLobby", playerId: "host", now: 50_200 });
    expect(room.phase.name).toBe("lobby");
    expect(room.history).toEqual([]);
    expect(room.entries).toEqual({});
    expect(room.players.every((p) => !p.ready)).toBe(true);
    expect(room.settings.roundCount).toBe(1);
    expect(room.kicked).toEqual(["p1"]);
    expect(currentRound(room)).toBe(1);
    expect(preRoundPhase(room)).toBe("lobby");
  });

  test("a player cannot end the match", () => {
    const before = finished();
    expect(reduce(before, { t: "backToLobby", playerId: "p0", now: 50_200 })).toBe(before);
  });

  test("only reachable from standings", () => {
    const before = scored();
    expect(reduce(before, { t: "backToLobby", playerId: "host", now: 50_200 })).toBe(before);
  });
});
```

Delete the three existing `newGame` tests (`"a new game returns to the lobby and clears entries"`, `"a new game leaves the round derived from history"`, `"a new game does not un-kick anyone"`) — `backToLobby` above covers all three behaviours.

A 10-minute round makes `MAX_ENTRIES` reachable for the first time, so add a scale guard to the same file. Add `MAX_PLAYERS` to the `./reduce` import if it is not already there:

```ts
describe("long rounds", () => {
  test("the entry cap still holds at the ten-minute duration", () => {
    let room = seed(2);
    room = reduce(room, {
      t: "setSettings", playerId: "host", durationSec: MAX_DURATION_SEC, now: 1000,
    });
    room = readyAll(room, 1000);
    const cdEnd = (room.phase as { endsAt: number }).endsAt;
    room = reduce(room, { t: "tick", now: cdEnd });

    for (let i = 0; i < MAX_ENTRIES; i++) {
      room = submitEntry(room, "p0", `word-${i}`, cdEnd + i).room;
    }
    const overflow = submitEntry(room, "p0", "one too many", cdEnd + MAX_ENTRIES);
    expect(overflow.accepted).toBe(false);
    expect(overflow.reason).toBe("limit");
    expect(room.entries.p0).toHaveLength(MAX_ENTRIES);
  });

  test("scoring a full ten-player room stays fast", () => {
    let room = seed(MAX_PLAYERS);
    room = readyAll(room, 1000);
    const cdEnd = (room.phase as { endsAt: number }).endsAt;
    room = reduce(room, { t: "tick", now: cdEnd });
    for (const p of room.players) {
      for (let i = 0; i < MAX_ENTRIES; i++) {
        room = submitEntry(room, p.id, `${p.id}-word-${i}`, cdEnd + i).room;
      }
    }
    const playEnd = (room.phase as { endsAt: number }).endsAt;
    const started = Date.now();
    room = reduce(room, { t: "tick", now: playEnd });
    room = reduce(room, { t: "tick", now: (room.phase as { endsAt: number }).endsAt });
    expect(room.phase.name).toBe("scoring");
    // 10 x 200 entries is ~2M union-find comparisons. Generous ceiling: this
    // is a regression guard against an accidental O(n^3), not a benchmark.
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test
```

Expected: FAIL — the new event types do not exist on `RoomEvent`.

- [ ] **Step 3: Add the `standings` phase to `shared/state.ts`**

```ts
export type Phase =
  | { name: "lobby" }
  | { name: "countdown"; endsAt: number }
  | { name: "playing"; endsAt: number }
  | { name: "timesup"; endsAt: number }
  | { name: "scoring"; results: Results }
  /** Match standings between rounds and at the end. Untimed; the host advances it. */
  | { name: "standings" };
```

- [ ] **Step 4: Implement the events in `shared/reduce.ts`**

Add the imports:

```ts
import { placeRound } from "./standings";
import { matchComplete, preRoundPhase } from "./state";
import type { Entry, Player, PlayerId, Room, RoundSummary } from "./state";
```

Add to `RoomEvent`, and **remove** the `newGame` member:

```ts
  | { t: "setSettings"; playerId: PlayerId; roundCount?: number; durationSec?: number; now: number }
  | { t: "showStandings"; playerId: PlayerId; now: number }
  | { t: "backToLobby"; playerId: PlayerId; now: number }
```

Add this helper above `settle`:

```ts
/**
 * Settings arrive over a socket, so the stepper's restrictions are not a
 * guarantee — a hand-rolled message must not be able to set a nine-hour
 * round. Non-finite values fall back to what is already set rather than
 * poisoning the room with NaN.
 */
function clampSetting(value: number | undefined, min: number, max: number, current: number): number {
  if (value === undefined || !Number.isFinite(value)) return current;
  return Math.min(max, Math.max(min, Math.round(value)));
}
```

Replace `settle` with:

```ts
/**
 * The pre-round <-> countdown edge is derived, not commanded: any event that
 * changes readiness re-evaluates it, so un-readying mid-countdown backs out
 * without needing its own case.
 *
 * "Pre-round" is the lobby before round one and the standings screen between
 * rounds — readiness governs every round start, not just the first. The
 * `matchComplete` guard is what stops readying up on the final standings from
 * opening a countdown for a round that does not exist.
 */
function settle(room: Room, now: number): Room {
  const phase = room.phase;
  if (phase.name === "lobby" || phase.name === "standings") {
    if (phase.name === "standings" && matchComplete(room)) return room;
    if (!everyoneReady(room)) return room;
    return { ...room, phase: { name: "countdown", endsAt: now + COUNTDOWN_MS } };
  }
  if (phase.name === "countdown" && !everyoneReady(room)) {
    return { ...room, phase: backPhase(room) };
  }
  return room;
}

/**
 * Written as an explicit ternary rather than `{ name: preRoundPhase(room) }`
 * because TypeScript will not assign `{ name: "lobby" | "standings" }` to the
 * `Phase` union.
 */
function backPhase(room: Room): Room["phase"] {
  return preRoundPhase(room) === "lobby" ? { name: "lobby" } : { name: "standings" };
}
```

In `apply`, widen the `ready` guard:

```ts
    case "ready":
      if (
        room.phase.name !== "lobby" &&
        room.phase.name !== "countdown" &&
        room.phase.name !== "standings"
      ) {
        return room;
      }
```

Replace the `startGame` case:

```ts
    case "startGame":
      if (ev.playerId !== room.hostId) return room;
      // Legal from the lobby and from standings between rounds — both are
      // pre-round phases, and both open the same countdown.
      if (room.phase.name !== "lobby" && room.phase.name !== "standings") return room;
      if (room.phase.name === "standings" && matchComplete(room)) return room;
      // A deliberate host override: unlike the natural everyoneReady path,
      // this can start the countdown with just one connected player.
      if (room.players.filter((p) => p.connected).length < 1) return room;
      return {
        ...room,
        players: room.players.map((p) => ({ ...p, ready: true })),
        phase: { name: "countdown", endsAt: ev.now + COUNTDOWN_MS },
      };
```

Replace the `cancelStart` case's return with:

```ts
      return {
        ...room,
        phase: backPhase(room),
        players: room.players.map((p) => ({ ...p, ready: false })),
      };
```

Replace the whole `newGame` case with these three:

```ts
    case "setSettings": {
      if (ev.playerId !== room.hostId) return room;
      // Locked once the match starts: changing the round count mid-match
      // would move the finish line under the players.
      if (room.phase.name !== "lobby") return room;
      const roundCount = clampSetting(
        ev.roundCount, MIN_ROUND_COUNT, MAX_ROUND_COUNT, room.settings.roundCount,
      );
      const durationSec = clampSetting(
        ev.durationSec, MIN_DURATION_SEC, MAX_DURATION_SEC, room.settings.durationSec,
      );
      if (
        roundCount === room.settings.roundCount &&
        durationSec === room.settings.durationSec
      ) {
        return room;
      }
      return { ...room, settings: { roundCount, durationSec } };
    }

    case "showStandings": {
      if (ev.playerId !== room.hostId) return room;
      if (room.phase.name !== "scoring") return room;
      const summary: RoundSummary = {
        category: room.category,
        places: placeRound(room.phase.results),
      };
      // Clearing `ready` is not optional: everyone is still flagged ready from
      // the round that just ended, and `settle` would fire the next countdown
      // instantly, skipping the standings screen entirely.
      //
      // Clearing `entries` here is the single place the raw word store is
      // emptied — the round is banked into history and the words have already
      // been shown, so nothing reads it again.
      return {
        ...room,
        phase: { name: "standings" },
        history: [...room.history, summary],
        entries: {},
        players: room.players.map((p) => ({ ...p, ready: false })),
      };
    }

    case "backToLobby":
      if (ev.playerId !== room.hostId) return room;
      if (room.phase.name !== "standings") return room;
      // Settings survive — the host usually wants the same match again — and
      // so does `kicked`, which is durable for the room's lifetime.
      return {
        ...room,
        phase: { name: "lobby" },
        players: room.players.map((p) => ({ ...p, ready: false })),
        entries: {},
        history: [],
      };
```

Leave the `startGame` bypass in `reduce` exactly as it is. It is still the only bypass: `showStandings` clears readiness so `settle` is a no-op after it, and `backToLobby` lands in the lobby with nobody ready.

Update the stale comment in the `kick` case that says "`newGame` deliberately does not clear it" to name `backToLobby` instead.

- [ ] **Step 5: Update `shared/protocol.ts`**

Replace `| { type: "newGame" }` with:

```ts
  | { type: "setSettings"; roundCount?: number; durationSec?: number }
  | { type: "showStandings" }
  | { type: "backToLobby" }
```

- [ ] **Step 6: Update routing in `party/server.ts`**

In the `switch (msg.type)` block, replace the `case "newGame":` block with:

```ts
      case "setSettings":
        this.room = reduce(this.room, {
          t: "setSettings",
          playerId,
          roundCount: msg.roundCount,
          durationSec: msg.durationSec,
          now,
        });
        break;
      case "showStandings":
        this.room = reduce(this.room, { t: "showStandings", playerId, now });
        break;
      case "backToLobby":
        this.room = reduce(this.room, { t: "backToLobby", playerId, now });
        break;
```

- [ ] **Step 7: Run tests and typecheck — expect the client to fail**

```bash
npm test && npm run typecheck
```

Expected: tests PASS. Typecheck FAILS on `HostView`/`PlayerView` not handling `standings` and on `HostScoring` sending `newGame`. That failure is the safety net working — those views have explicit `ReactElement` return types precisely so an unhandled phase cannot compile.

- [ ] **Step 8: Point `HostScoring` at the new event**

In `src/screens/host/HostScoring.tsx`, change the footer button:

```tsx
        <button
          type="button"
          className="btn"
          onClick={() => roomStore.send({ type: "showStandings" })}
        >
          Standings
        </button>
```

- [ ] **Step 9: Create the badge strip and `src/screens/host/HostStandings.tsx`**

Structure and behaviour only — Task 4 adds the CSS.

First `src/components/BadgeStrip.tsx`, shared by both standings screens so the
markup is written once:

```tsx
/**
 * One chip per round played, showing that round's finishing place. Gold for a
 * win, cream otherwise — the strip is the score, not decoration, so a run of
 * wins should read across a room at a glance.
 */
export function BadgeStrip({ places }: { places: number[] }) {
  if (places.length === 0) return null;
  return (
    <ol className="badge-strip">
      {places.map((place, i) => (
        <li
          className={place === 1 ? "badge badge--first" : "badge"}
          key={i}
          title={`Round ${i + 1}: ${place}`}
        >
          {place}
        </li>
      ))}
    </ol>
  );
}
```

Then the host screen. It renders during `standings` **and** during an inter-round
`countdown`, so it takes the same optional `countdown` prop `HostLobby` does —
un-readying during that countdown still cancels it, and the room needs to see
the number ticking down.

```tsx
import { useRemaining } from "../../net/clock";
import { computeStandings } from "../../../shared/standings";
import { currentRound, matchComplete } from "../../../shared/state";
import { BadgeStrip } from "../../components/BadgeStrip";
import { RoomChip } from "../../components/RoomChip";
import { roomStore } from "../../net/room";
import type { RoomState } from "../../../shared/state";
import { HostHeader } from "./HostHeader";

type Props = {
  room: RoomState;
  /** Present during an inter-round countdown; un-readying still cancels it. */
  countdown?: { endsAt: number; offset: number };
};

export function HostStandings({ room, countdown }: Props) {
  const standings = computeStandings(room.players, room.history);
  const remaining = useRemaining(countdown?.endsAt ?? 0, countdown?.offset ?? 0);
  const done = matchComplete(room);
  // On the final screen the round marker would otherwise read one past the
  // last round played, because `currentRound` names the round about to start.
  const marker = done ? room.settings.roundCount : currentRound(room) - 1;

  return (
    <main className="screen screen--host host-standings">
      <HostHeader
        left={<h1 className="host-standings__title">{done ? "Final standings" : "Standings"}</h1>}
        round={marker}
        of={room.settings.roundCount}
        right={<RoomChip code={room.code} />}
      />

      <ol className="standings-list">
        {standings.map((s) => (
          <li className="card standing-card" key={s.id}>
            <span className="standing-card__place">{s.place}</span>
            <span className="standing-card__avatar">{s.emoji}</span>
            <span className="standing-card__name">{s.name}</span>
            <BadgeStrip places={s.badges} />
            <span className="standing-card__points">{s.points}</span>
          </li>
        ))}
      </ol>

      <div className="host-standings__footer">
        {countdown ? (
          <>
            <p className="get-ready">Get ready… {remaining}</p>
            <button
              type="button"
              className="btn btn--secondary btn--small"
              onClick={() => roomStore.send({ type: "cancelStart" })}
            >
              Stop
            </button>
          </>
        ) : done ? (
          <button
            type="button"
            className="btn"
            onClick={() => roomStore.send({ type: "backToLobby" })}
          >
            Back to lobby
          </button>
        ) : (
          <>
            <p className="host-standings__hint">Starting early readies everyone up.</p>
            <button
              type="button"
              className="btn"
              onClick={() => roomStore.send({ type: "startGame" })}
            >
              Next round
            </button>
          </>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 10: Create `src/screens/player/PlayerStandings.tsx`**

Renders during `standings` and during an inter-round `countdown`, same as
`HostStandings`. The Ready button stays live through the countdown — tapping
"Not ready" is how a player cancels it.

```tsx
import { useRemaining } from "../../net/clock";
import { computeStandings } from "../../../shared/standings";
import { matchComplete } from "../../../shared/state";
import { BadgeStrip } from "../../components/BadgeStrip";
import { roomStore } from "../../net/room";
import type { PlayerId, RoomState } from "../../../shared/state";

type Props = {
  room: RoomState;
  playerId: PlayerId;
  /** Present during an inter-round countdown; un-readying still cancels it. */
  countdown?: { endsAt: number; offset: number };
};

export function PlayerStandings({ room, playerId, countdown }: Props) {
  const standings = computeStandings(room.players, room.history);
  const remaining = useRemaining(countdown?.endsAt ?? 0, countdown?.offset ?? 0);
  const me = standings.find((s) => s.id === playerId);
  const ready = room.players.find((p) => p.id === playerId)?.ready ?? false;
  const done = matchComplete(room);

  return (
    <main className="screen screen--mobile screen--locked player-standings">
      <p className="player-standings__room">
        ROOM {room.code} · {done ? "FINAL" : `AFTER ${room.history.length}`}
      </p>

      {me && (
        <section className="card player-standings__me">
          <span className="player-standings__place">{me.place}</span>
          <span className="player-standings__name">{me.emoji} {me.name}</span>
          <BadgeStrip places={me.badges} />
          <span className="player-standings__points">{me.points} pts</span>
        </section>
      )}

      <ol className="card player-standings__all">
        {standings.map((s) => (
          <li key={s.id}>
            <span>{s.place}</span>
            <span>{s.emoji} {s.name}</span>
            <span>{s.points}</span>
          </li>
        ))}
      </ol>

      <div className="player-standings__footer">
        {countdown && <p className="get-ready get-ready--small">Get ready… {remaining}</p>}
        {done ? (
          <p className="player-standings__hint">That's the match. Waiting for the host…</p>
        ) : (
          // Readying up here is the last real user gesture before a round that
          // starts off a server timer — the only chance iOS gives us to have a
          // keyboard up when `playing` begins. See PlayerView.
          <button
            type="button"
            className={ready ? "btn btn--secondary btn--block" : "btn btn--block"}
            onClick={() => roomStore.send({ type: "ready", ready: !ready })}
          >
            {ready ? "Not ready" : "Ready up"}
          </button>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 11: Wire both views**

`src/screens/host/HostView.tsx` — import `HostStandings` and add before the closing brace of the switch:

```tsx
    case "standings":
      return <HostStandings room={room} />;
```

`src/screens/player/PlayerView.tsx` — import `PlayerStandings` and add to `renderPhase`'s switch:

```tsx
    case "standings":
      return <PlayerStandings room={room} playerId={getPlayerId()} />;
```

Also fix both `countdown` cases. Today they render the lobby, which between rounds would show the join code on the TV and the name/avatar editor on the phones. `preRoundPhase(room)` already answers which screen the countdown belongs to — use it rather than re-deriving from `history.length`.

`src/screens/player/PlayerView.tsx`, in `renderPhase` (add `preRoundPhase` to the `shared/state` import):

```tsx
    case "countdown": {
      const countdown = { endsAt: room.phase.endsAt, offset: state.clockOffset };
      return preRoundPhase(room) === "lobby" ? (
        <PlayerLobby
          room={room}
          playerId={getPlayerId()}
          countdown={countdown}
          onLeave={onLeave}
        />
      ) : (
        <PlayerStandings room={room} playerId={getPlayerId()} countdown={countdown} />
      );
    }
```

`src/screens/host/HostView.tsx`:

```tsx
    case "countdown": {
      const countdown = { endsAt: room.phase.endsAt, offset: state.clockOffset };
      return preRoundPhase(room) === "lobby" ? (
        <HostLobby room={room} countdown={countdown} onLeave={leave} />
      ) : (
        <HostStandings room={room} countdown={countdown} />
      );
    }
```

- [ ] **Step 12: Run tests, typecheck and build**

```bash
npm test && npm run typecheck && npm run build
```

Expected: all green.

- [ ] **Step 13: Manual smoke test**

Two terminals: `npm run dev:party`, then `npm run dev`. Open `?p=1` (creates the lobby / is the TV), `?p=2` and `?p=3` (join with the code).

Verify: three players ready up → round plays → results → "Standings" → standings shows places and points → players ready up again → countdown → round 2. With `roundCount` still defaulting to 1 you will hit the final standings immediately; to exercise multiple rounds, temporarily change `DEFAULT_ROUND_COUNT` to 3 in `shared/categories.ts` and **change it back before committing** — Task 5 adds the real control.

- [ ] **Step 14: Commit**

```bash
git add shared/state.ts shared/reduce.ts shared/reduce.test.ts shared/protocol.ts party/server.ts src/components/BadgeStrip.tsx src/screens/host/HostScoring.tsx src/screens/host/HostStandings.tsx src/screens/host/HostView.tsx src/screens/player/PlayerStandings.tsx src/screens/player/PlayerView.tsx
git commit -m "feat: add the standings phase and multi-round match flow

Readiness now governs every round start, not just the first: the standings
screen between rounds readies up exactly like the lobby and opens the same
countdown. That keeps the user gesture iOS needs to open the keyboard for
rounds 2+, which a host-taps-and-play design would have lost.

Replaces newGame with showStandings and backToLobby."
```

---

### Task 4: Style the standings screens

Every new CSS rule for the screens Task 3 built. Purely presentational — this task touches exactly one file and changes no logic.

**Files:**
- Modify: `src/style.css` — append the new rules

**Interfaces:**
- Consumes: the class names already used by `HostStandings`, `PlayerStandings` and `BadgeStrip` from Task 3
- Produces: CSS classes `.host-standings`, `.standings-list`, `.standing-card`, `.badge-strip`, `.badge`, `.badge--first`, `.player-standings`

**Design constraints — read before writing any CSS:**
- Every colour and shape value must come from an existing `:root` token in `src/style.css`. No loose hex values, no new tokens.
- `.screen--host` never scrolls. The standings list must fit `100dvh` at `MAX_PLAYERS` (10) — if it cannot, the list scrolls inside its own `overflow-y: auto` box, never the page.
- `.screen--locked` never scrolls, same rule.
- Match the existing card idiom: `--border` (3px solid ink), `--radius` (14px), `--shadow-card` (6px 6px 0 ink), `--display` font for numerals.
- Never cream on cream. Gold carries `--ink-gold` text, cream carries `--ink`.

- [ ] **Step 1: Append the CSS to `src/style.css`**

Add at the end of the file, following the existing section-comment style:

```css
/* ------------------------------------------------------- host standings */

.host-standings {
  padding: 0;
}

.host-standings__title {
  font-family: var(--display);
  font-size: clamp(18px, 2.2vw, 28px);
  letter-spacing: 0.02em;
  margin: 0;
}

/* The list is the only thing allowed to scroll — the footer button has to
   stay on screen at ten players. */
.standings-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px 28px;
}

.standing-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 18px;
}

.standing-card__place {
  font-family: var(--display);
  font-size: clamp(22px, 2.6vw, 34px);
  color: var(--ink);
  min-width: 1.6em;
}

.standing-card__avatar {
  font-size: clamp(22px, 2.6vw, 34px);
}

.standing-card__name {
  flex: 1;
  font-weight: 700;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.standing-card__points {
  font-family: var(--display);
  font-size: clamp(20px, 2.4vw, 30px);
  color: var(--ink);
}

.host-standings__footer {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 0 28px 26px;
}

.host-standings__hint {
  color: var(--cream-dim);
  font-size: 14px;
}

/* ------------------------------------------------------------- badges */

.badge-strip {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.badge {
  display: grid;
  place-items: center;
  min-width: 28px;
  height: 28px;
  padding: 0 6px;
  border: var(--border);
  border-radius: 8px;
  background: var(--cream);
  color: var(--ink);
  font-family: var(--display);
  font-size: 14px;
}

.badge--first {
  background: var(--gold);
  color: var(--ink-gold);
}

/* ----------------------------------------------------- player standings */

.player-standings {
  gap: 16px;
}

.player-standings__room {
  color: var(--cream-dim);
  font-size: 13px;
  letter-spacing: 0.08em;
}

.player-standings__me {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 18px;
}

.player-standings__place {
  font-family: var(--display);
  font-size: 54px;
  color: var(--ink);
  line-height: 1;
}

.player-standings__name {
  font-weight: 700;
  color: var(--ink);
}

.player-standings__points {
  font-family: var(--display);
  color: var(--ink-dim);
}

/* Scrolls inside its own box; the Ready button below must never be pushed
   off a phone screen. */
.player-standings__all {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.player-standings__all li {
  display: grid;
  grid-template-columns: 2em 1fr auto;
  gap: 10px;
  align-items: center;
  color: var(--ink);
  padding-bottom: 8px;
  border-bottom: 1px solid var(--card-rule);
}

.player-standings__all li:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.player-standings__footer {
  margin-top: auto;
}

.player-standings__hint {
  color: var(--cream-dim);
  text-align: center;
  font-size: 14px;
}
```

- [ ] **Step 2: Verify no loose hex values were introduced**

```bash
grep -nE '#[0-9a-fA-F]{3,8}\b' src/style.css | grep -v '^\s*[0-9]*:\s*--'
```

Expected: only the token definitions in the `:root` block at the top of the file. Any hit inside a rule you just wrote is a defect — replace it with the matching token.

- [ ] **Step 3: Typecheck and build**

```bash
npm run typecheck && npm run build
```

Expected: green.

- [ ] **Step 4: Commit**

```bash
git add src/style.css
git commit -m "style: dress the standings screens in the Ok, Name One system

The badge strip is the score, not decoration, so a win reads gold and a run of
them reads across a room. Both lists scroll inside their own box -- neither the
TV nor a phone screen may scroll the page."
```

---

### Task 5: Host lobby settings

The host's round-count and duration controls. Sends `setSettings`, which Task 3 already handles.

**Files:**
- Create: `src/components/Stepper.tsx`
- Modify: `src/screens/host/HostLobby.tsx` — settings row
- Modify: `src/screens/player/PlayerLobby.tsx` — read-only settings context
- Modify: `src/style.css` — stepper and settings-row rules

**Interfaces:**
- Consumes: `MIN_ROUND_COUNT`, `MAX_ROUND_COUNT`, `MIN_DURATION_SEC`, `MAX_DURATION_SEC` from `shared/reduce.ts` (Task 2); the `setSettings` client message (Task 3)
- Produces: `Stepper` component and `stepDuration(seconds, direction)` helper

**Behaviour:**
- Rounds step by 1 across 1–10.
- Duration steps by **15s from 15 to 60, then by 30s from 60 to 600**.
- The value is a numeric input that can be typed. It commits on blur or Enter; an unparseable entry reverts to the current value. `reduce` clamps regardless — the UI is convenience, not the guarantee.
- Stepping up from a typed off-grid value goes to the next grid value above it; stepping down goes to the next below.
- Both steppers are disabled during `countdown` and absent once a match is under way (`HostLobby` only ever renders in `lobby` and `countdown`, so "absent during a match" needs no extra guard).

- [ ] **Step 1: Create `src/components/Stepper.tsx`**

```tsx
import { useEffect, useState } from "react";

type Props = {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  /** Formats the value for display. Stepping and typing both use raw numbers. */
  format?: (value: number) => string;
  /** Next value in the given direction. Defaults to ±1. */
  step?: (value: number, direction: 1 | -1) => number;
  onChange: (value: number) => void;
};

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function Stepper({
  label, value, min, max, disabled, format, step, onChange,
}: Props) {
  // Mirrors `value` while the field is not being edited. Typing needs local
  // state — committing on every keystroke would fight the server echo, and
  // "3" on the way to "30" would be clamped to a different number entirely.
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const parsed = Number.parseInt(draft, 10);
    if (Number.isNaN(parsed)) {
      setDraft(String(value));
      return;
    }
    const next = clamp(parsed, min, max);
    setDraft(String(next));
    if (next !== value) onChange(next);
  };

  const nudge = (direction: 1 | -1) => {
    const next = clamp(step ? step(value, direction) : value + direction, min, max);
    if (next !== value) onChange(next);
  };

  return (
    <div className={disabled ? "stepper stepper--disabled" : "stepper"}>
      <span className="stepper__label">{label}</span>
      <div className="stepper__row">
        <button
          type="button"
          className="stepper__btn"
          disabled={disabled || value <= min}
          aria-label={`Decrease ${label}`}
          onClick={() => nudge(-1)}
        >
          −
        </button>
        <input
          className="stepper__value"
          inputMode="numeric"
          value={draft}
          disabled={disabled}
          aria-label={label}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            commit();
            e.currentTarget.blur();
          }}
          size={4}
        />
        <button
          type="button"
          className="stepper__btn"
          disabled={disabled || value >= max}
          aria-label={`Increase ${label}`}
          onClick={() => nudge(1)}
        >
          +
        </button>
      </div>
      {format && <span className="stepper__hint">{format(value)}</span>}
    </div>
  );
}

/**
 * 15-second steps up to a minute, then 30-second steps to ten minutes. From an
 * off-grid typed value, moves to the next grid value in that direction rather
 * than staying off-grid.
 */
export function stepDuration(value: number, direction: 1 | -1): number {
  const grid = value < 60 || (value === 60 && direction === -1) ? 15 : 30;
  return direction === 1
    ? (Math.floor(value / grid) + 1) * grid
    : (Math.ceil(value / grid) - 1) * grid;
}

/** "90" -> "1:30". Seconds under a minute render bare: "45s". */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${mins}:00` : `${mins}:${String(rest).padStart(2, "0")}`;
}
```

- [ ] **Step 2: Add the settings row to `src/screens/host/HostLobby.tsx`**

Add imports:

```tsx
import { Stepper, formatDuration, stepDuration } from "../../components/Stepper";
import {
  MAX_DURATION_SEC, MAX_ROUND_COUNT, MIN_DURATION_SEC, MIN_ROUND_COUNT,
} from "../../../shared/reduce";
```

Insert between the closing `</div>` of `.host-lobby__stage` and the opening of `.host-lobby__footer`:

```tsx
      <div className="host-lobby__settings">
        <Stepper
          label="ROUNDS"
          value={room.settings.roundCount}
          min={MIN_ROUND_COUNT}
          max={MAX_ROUND_COUNT}
          disabled={Boolean(countdown)}
          onChange={(roundCount) => roomStore.send({ type: "setSettings", roundCount })}
        />
        <Stepper
          label="TIMER"
          value={room.settings.durationSec}
          min={MIN_DURATION_SEC}
          max={MAX_DURATION_SEC}
          disabled={Boolean(countdown)}
          step={stepDuration}
          format={formatDuration}
          onChange={(durationSec) => roomStore.send({ type: "setSettings", durationSec })}
        />
      </div>
```

- [ ] **Step 3: Show the settings on `src/screens/player/PlayerLobby.tsx`**

Add the import for `formatDuration` from `../../components/Stepper`, and insert directly beneath the existing `.player-lobby__room` paragraph:

```tsx
      <p className="player-lobby__settings">
        {room.settings.roundCount} {room.settings.roundCount === 1 ? "ROUND" : "ROUNDS"}
        {" · "}
        {formatDuration(room.settings.durationSec)}
      </p>
```

- [ ] **Step 4: Append the CSS to `src/style.css`**

Same token rules as Task 4 — no loose hex values.

```css
/* ------------------------------------------------------------ steppers */

.host-lobby__settings {
  display: flex;
  justify-content: center;
  gap: 18px;
  padding: 0 28px 14px;
  /* Capped so the room code, roster and Start button all still fit a 16:9
     TV at MAX_PLAYERS — the host screen must never scroll. */
  max-height: 96px;
}

.stepper {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  background: var(--cream);
  border: var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-card);
  padding: 8px 14px;
}

.stepper--disabled {
  opacity: 0.55;
}

.stepper__label {
  font-family: var(--display);
  font-size: 11px;
  letter-spacing: 0.1em;
  color: var(--ink-dim);
}

.stepper__row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.stepper__btn {
  width: 32px;
  height: 32px;
  border: var(--border);
  border-radius: 8px;
  background: var(--gold);
  color: var(--ink-gold);
  font-family: var(--display);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.stepper__btn:disabled {
  background: var(--code-empty);
  color: var(--struck);
  cursor: default;
}

.stepper__value {
  width: 3.2em;
  border: none;
  background: transparent;
  text-align: center;
  font-family: var(--display);
  font-size: 26px;
  color: var(--ink);
  padding: 0;
}

.stepper__value:focus {
  outline: 2px solid var(--teal);
  outline-offset: 2px;
  border-radius: 4px;
}

.stepper__hint {
  font-family: var(--display);
  font-size: 12px;
  color: var(--ink-dim);
}

.player-lobby__settings {
  color: var(--cream-dim);
  font-size: 12px;
  letter-spacing: 0.08em;
}
```

- [ ] **Step 5: Verify no loose hex values**

```bash
grep -nE '#[0-9a-fA-F]{3,8}\b' src/style.css | grep -v '^\s*[0-9]*:\s*--'
```

Expected: only the `:root` token definitions.

- [ ] **Step 6: Typecheck and build**

```bash
npm run typecheck && npm run build
```

- [ ] **Step 7: Manual smoke test — the whole feature**

Two terminals (`npm run dev:party`, `npm run dev`), then `?p=1`, `?p=2`, `?p=3`.

Verify each of these:
1. Host sets rounds to 3 and timer to 60 with the `+` buttons. Both echo to the players' lobby line.
2. Host types `45` into the timer field and presses Enter. It commits. Typing `9999` clamps to `600` on commit.
3. Timer `+` from 45 goes to 60, then to 90 (30s steps above a minute). `−` from 60 goes to 45.
4. Players ready up → countdown → round 1 runs for 45 seconds.
5. Results → "Standings" → standings shows 3 players with round-1 badges and points.
6. Players ready up on standings → countdown → round 2 starts. **The round number in the host header reads 2.**
7. During an inter-round countdown, the TV and the phones both show "Get ready… 5" **on the standings screen** — not the lobby, and not the join code.
8. During an inter-round countdown, one player taps "Not ready" → everyone returns to the standings screen, not the lobby.
9. The host's "Stop" button during an inter-round countdown also returns everyone to standings.
10. After round 3's standings, the button reads "Back to lobby". Tapping it returns everyone to the lobby with badges cleared and the 3-round / 45s settings still set.
11. Steppers are visibly disabled during the lobby countdown.
12. At 10 players the host lobby and the host standings both fit without the page scrolling.
13. The host header reads `ROUND 2 / 3` mid-match, and `ROUND 1` when the round count is 1.

- [ ] **Step 8: Commit**

```bash
git add src/components/Stepper.tsx src/screens/host/HostLobby.tsx src/screens/player/PlayerLobby.tsx src/style.css
git commit -m "feat: let the host set round count and round length

Rounds 1-10, timer 15s-10min stepping 15s below a minute and 30s above. Both
fields are typeable; reduce clamps whatever arrives, because the stepper's
restrictions are a convenience and not a guarantee."
```

---

### Task 6: Update the docs

`CLAUDE.md` documents the phase list, `newGame`, and the invariants — all three are now wrong. The MVP spec's scope statement is superseded.

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-07-25-w104-mvp-design.md` — supersession note only

- [ ] **Step 1: Update `CLAUDE.md`**

Make these edits:

1. **"What this is"** — replace the v1-scope paragraph. It currently says v1 is one 30-second round with category "woman". It is now a 1–10 round match with a host-set 15s–10min timer, still on the fixed category "woman". Keep the pointer to `Project W-104.md` being deliberately unbuilt, but note that the match structure has landed and point at `docs/superpowers/specs/2026-07-26-match-structure-design.md`.

2. **"State flow"** — the bullet describing the lobby↔countdown edge now reads pre-round↔countdown, covering both lobby and standings, and mentions the `matchComplete` guard. Note that `startGame` is legal from both and is still the one `settle` bypass.

3. **Invariants** — add these two bullets verbatim to the "Invariants — breaking these is a defect, not a style choice" list:

```markdown
- **The round number is derived, never stored.** `currentRound(room)` is
  `history.length + 1`. A stored counter would have to increment when an
  inter-round countdown opens and decrement when it is cancelled; history only
  grows, and only at `showStandings`, so deriving makes a cancel a real no-op.
- **`Room.history` holds aggregates only, never words.** It rides in
  `RoomState`, so an `entries` field on `RoundSummary` would leak every past
  round to every socket — the same boundary `toRoomState` exists to hold.
```

4. **Test count** — `npm test` no longer runs 70 tests. Run `npm test` and put the real number in.

5. Anywhere `newGame` is named, replace with `showStandings` / `backToLobby`.

- [ ] **Step 2: Add a supersession note to the MVP spec**

At the top of `docs/superpowers/specs/2026-07-25-w104-mvp-design.md`, directly under the title:

```markdown
> **Partly superseded.** The single-round scope below was replaced on
> 2026-07-26 by `2026-07-26-match-structure-design.md`, which adds host-set
> round count and duration, a standings phase, and golf placement points.
> Everything else here — the identity model, the privacy boundary, the alarm
> design, the failure-handling table — still holds.
```

In its "Out of scope for MVP" section, mark score history as delivered: `Room.history` now carries per-round aggregates for the life of the room. The rest of that list stands.

- [ ] **Step 3: Verify the whole suite one last time**

```bash
npm test && npm run typecheck && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-07-25-w104-mvp-design.md
git commit -m "docs: bring CLAUDE.md and the MVP spec in line with match structure"
```

---

## Verification checklist

Before declaring the plan complete, all of these must hold:

- [ ] `npm test` passes
- [ ] `npm run typecheck` passes **both** projects
- [ ] `npm run build` passes
- [ ] `git status` still shows `Project W-104.md` and `W104 Party Game Wireframes.zip` as untracked
- [ ] `grep -rn "newGame" src party shared` returns nothing
- [ ] `grep -rn "room.round\|\.durationSec" src party` returns only `room.settings.durationSec`
- [ ] `DEFAULT_ROUND_COUNT` is back to `1` in `shared/categories.ts` (Task 3 Step 13 temporarily raises it)
- [ ] The 13-point manual smoke test in Task 5 Step 7 passes on three browser tabs
