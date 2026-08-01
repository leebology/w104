# Scroll Mirror Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** During the results reveal, a player's scroll on their own word list drives their scorer's column on the host TV.

**Architecture:** A new pure module `shared/mirror.ts` derives who may drive a column and converts a scroll box's position into a wire value. A new `scrollTo` client message is handled on a fast path in `party/server.ts` — above the reduce/persist/broadcast tail, like `submitEntry` — and forwarded to the host socket alone as `columnScroll`. Nothing enters `Room`, nothing is persisted, nothing is broadcast. On the TV the value never enters React state: `roomStore` exposes a plain listener and `HostScoring` writes `scrollTop` directly onto nodes it already holds, eased by one rAF loop.

**Tech Stack:** TypeScript, React 19, Vitest, PartyServer on Cloudflare Durable Objects.

**Spec:** `docs/superpowers/specs/2026-07-30-scroll-mirror-design.md`. Read it before Task 1 — it carries the rationale this plan only summarizes.

## Global Constraints

- **Node 22** (`.nvmrc`).
- **`npm run typecheck` runs two tsc projects.** `shared/mirror.ts` is imported by both `party/` and `src/`, so it must typecheck under `tsconfig.json` *and* `tsconfig.worker.json`. Run the full `npm run typecheck`, never one project.
- **Anything persisted must survive JSON.** Nothing in this feature is persisted — that is a design decision, not an oversight. If a task tempts you to put scroll state on `Room`, stop and re-read §4 of the spec.
- **Word lists never enter `RoomState`.** Untouched here: by `scoring` the full `Results` are already public.
- **`reduce` returning the identical object means "no change".** Untouched here: nothing in this feature goes through `reduce`.
- **Commits stage explicit paths — never `git add -A`.** The untracked working notes `Project W-104.md` and `W104 Party Game Wireframes.zip` must stay untracked.
- **Every PR bumps the version in three places:** `package.json`, `package-lock.json`'s top-level `version`, and the one under `packages: { "": ... }`. Current version is `0.7.1`; this feature goes to `0.8.0`. Done once, in Task 6.
- **Branch:** `player-host-screen-mirror`, already cut. Do not create another.
- **Comment density:** this codebase comments the *why*, heavily, in prose. Match it. Code blocks below include the comments they should ship with — keep them.

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `shared/mirror.ts` | create | `driverOf` and `scrollFraction`. Pure, no DOM, no Cloudflare runtime. |
| `shared/mirror.test.ts` | create | Unit tests for both, under the existing `shared/**/*.test.ts` glob. |
| `shared/protocol.ts` | modify | `scrollTo` on `ClientMessage`, `columnScroll` on `ServerMessage`. |
| `party/server.ts` | modify | The fast-path handler and a `sendToHost` helper. |
| `src/net/room.ts` | modify | `onColumnScroll` listener set, outside the store snapshot. |
| `src/screens/player/PlayerScoring.tsx` | modify | Throttled sends from the phone's scroll box. |
| `src/screens/host/HostScoring.tsx` | modify | Buffer, rAF easing, and the driven-column class. |
| `src/style.css` | modify | `.word-list--driven`. |
| `CLAUDE.md` | modify | Record the subsystem and its invariants. |

---

### Task 1: `shared/mirror.ts` — the pure core

**Files:**
- Create: `shared/mirror.ts`
- Test: `shared/mirror.test.ts`

**Interfaces:**
- Consumes: `rosterOf`, `TeamView`, `ScorerId` from `shared/teams.ts`; `isHuman` from `shared/bots.ts`; `Room`, `PlayerId`, `Player` from `shared/state.ts`.
- Produces:
  - `driverOf(view: TeamView & Pick<Room, "settings">, scorerId: ScorerId): PlayerId | null`
  - `scrollFraction(scrollTop: number, scrollHeight: number, clientHeight: number): number | null`

Both are used by Task 2 (server) and Task 4 (phone).

- [ ] **Step 1: Write the failing tests**

Create `shared/mirror.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { driverOf, scrollFraction } from "./mirror";
import { makeTeams } from "./teams";
import { defaultSettings } from "./gamemodes";
import { createRoom } from "./state";
import type { Player, Room } from "./state";

/**
 * A room of seats. `team: null` with `count: 0` is teams-off, where every
 * player is their own scorer.
 */
type Seat = { team: string | null; connected?: boolean; bot?: boolean };

function room(count: number, seats: Seat[]): Room {
  const base = createRoom("PLUM", 1000);
  return {
    ...base,
    settings: { ...defaultSettings("ffa"), teamCount: count },
    teams: makeTeams(count),
    players: seats.map((seat, i): Player => ({
      id: `p${i}`,
      name: `P${i}`,
      emoji: "🐙",
      ready: false,
      connected: seat.connected ?? true,
      teamId: seat.team,
      ...(seat.bot === true ? { isBot: true as const } : {}),
    })),
  };
}

describe("driverOf, teams off", () => {
  test("a player drives their own column", () => {
    expect(driverOf(room(0, [{ team: null }, { team: null }]), "p1")).toBe("p1");
  });

  test("a disconnected player drives nothing", () => {
    expect(driverOf(room(0, [{ team: null, connected: false }]), "p0")).toBeNull();
  });

  test("a bot drives nothing, even though bots are connected", () => {
    expect(driverOf(room(0, [{ team: null, bot: true }]), "p0")).toBeNull();
  });

  test("an unknown scorer id drives nothing", () => {
    expect(driverOf(room(0, [{ team: null }]), "nobody")).toBeNull();
  });
});

describe("driverOf, teams on", () => {
  test("the first member in roster order drives the team's column", () => {
    const r = room(2, [{ team: "t0" }, { team: "t1" }, { team: "t0" }]);
    expect(driverOf(r, "t0")).toBe("p0");
    expect(driverOf(r, "t1")).toBe("p1");
  });

  test("skips a disconnected first member", () => {
    const r = room(2, [
      { team: "t0", connected: false },
      { team: "t1" },
      { team: "t0" },
    ]);
    expect(driverOf(r, "t0")).toBe("p2");
  });

  test("skips a bot in first position", () => {
    const r = room(2, [{ team: "t0", bot: true }, { team: "t1" }, { team: "t0" }]);
    expect(driverOf(r, "t0")).toBe("p2");
  });

  test("an all-disconnected team drives nothing", () => {
    const r = room(2, [
      { team: "t0", connected: false },
      { team: "t0", connected: false },
      { team: "t1" },
    ]);
    expect(driverOf(r, "t0")).toBeNull();
  });

  test("an all-bot team drives nothing", () => {
    const r = room(2, [{ team: "t0", bot: true }, { team: "t1" }]);
    expect(driverOf(r, "t0")).toBeNull();
  });
});

describe("scrollFraction", () => {
  test("a list shorter than its box has no position to mirror", () => {
    expect(scrollFraction(0, 80, 100)).toBeNull();
    expect(scrollFraction(0, 100, 100)).toBeNull();
  });

  test("the top is 0 and the bottom is 1", () => {
    expect(scrollFraction(0, 200, 100)).toBe(0);
    expect(scrollFraction(100, 200, 100)).toBe(1);
  });

  test("clamps past either end rather than reporting out of range", () => {
    expect(scrollFraction(150, 200, 100)).toBe(1);
    expect(scrollFraction(-20, 200, 100)).toBe(0);
  });

  test("rounds to three decimals, which is the free dedupe", () => {
    expect(scrollFraction(12.3456, 200, 100)).toBe(0.123);
    expect(scrollFraction(12.3494, 200, 100)).toBe(0.123);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run shared/mirror.test.ts
```

Expected: FAIL — `Failed to resolve import "./mirror"`.

- [ ] **Step 3: Write the implementation**

Create `shared/mirror.ts`:

```ts
/**
 * The scroll mirror: a player's scroll on their own results list, driving their
 * scorer's column on the host TV.
 *
 * Two pure derivations, kept in `shared/` rather than in the screens so the
 * existing `shared/**\/*.test.ts` glob covers them. The transport in
 * `party/server.ts` and the DOM driving in `HostScoring` are not unit-testable
 * in this repo, so everything that *can* be a derivation is one.
 *
 * Its own module rather than a corner of `shared/teams.ts` because it needs
 * `isHuman` from `shared/bots.ts`, and `bots.ts` already imports `teams.ts` —
 * putting this there would close a cycle. Nothing imports this module back.
 */
import { isHuman } from "./bots";
import type { PlayerId, Room } from "./state";
import { rosterOf } from "./teams";
import type { ScorerId, TeamView } from "./teams";

/** Everything `driverOf` needs: the roster, and whether teams are on at all. */
type DriverView = TeamView & Pick<Room, "settings">;

/**
 * The one member whose scroll drives this scorer's column — the first member
 * that is **connected and human**, in roster order — or null when nobody can.
 *
 * - **Roster order, not team-join order.** `membersOf` derives a team's roster
 *   by filtering `players`, so this is who joined the *room* first. That is
 *   already the order the emoji row is drawn in on both the phone and the TV,
 *   so the driver is the face on the left of the card: visible without being
 *   labelled. Recording real team-join order would mean a new persisted field
 *   on `Player`, a `load()` fallback for older stored rooms and a migration
 *   consideration, to reorder a row nobody can see.
 * - **Connected, because `membersOf` does not filter on it.** Without this a
 *   member whose phone locked would own a column nobody could drive.
 * - **Human, because bots are `connected: true`** (`shared/bots.ts`). A bot
 *   seated on a team by `seatBots` could otherwise lead its roster and own a
 *   column it can never drive, and the mirror would go silently missing for
 *   that team.
 *
 * Derived on every message and never stored, so there is no claim to take,
 * release or clear: a disconnect hands the column over with nothing watching
 * for it, and a reconnect takes it straight back.
 *
 * With teams off a scorer's `members` is the one player, so this collapses to
 * "the player" with no special case — the same unification `rosterOf` does.
 */
export function driverOf(view: DriverView, scorerId: ScorerId): PlayerId | null {
  const scorer = rosterOf(view).find((s) => s.id === scorerId);
  if (!scorer) return null;
  for (const id of scorer.members) {
    const player = view.players.find((p) => p.id === id);
    if (player && player.connected && isHuman(player)) return id;
  }
  return null;
}

/**
 * A scroll box's position as the wire value: its fraction of scrollable range,
 * clamped to [0,1] and rounded to three decimals.
 *
 * **Null when there is nothing to scroll.** A list shorter than its box has no
 * position to mirror and the caller sends nothing at all.
 *
 * A fraction rather than pixels because the two lists are different sizes — the
 * phone renders at 19px and the host column at 15px, in boxes of different
 * heights, so the same `scrollTop` means two different words. A fraction rather
 * than a top row index because both ends land their window at
 * `f * (rows - visible)`, which keeps the TV's visible window nested inside the
 * phone's *by construction*: the word being read is on the TV's screen with no
 * clamping rule needed at the ends of the list.
 *
 * Three decimals is 0.19 rows on a 200-entry list (`MAX_ENTRIES`), so the
 * rounding is invisible — and it dedupes for free, since a scroll that does not
 * move the rounded value sends nothing.
 */
export function scrollFraction(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): number | null {
  const range = scrollHeight - clientHeight;
  // `!(range > 0)` rather than `range <= 0` so a NaN range returns null too.
  if (!(range > 0)) return null;
  const f = scrollTop / range;
  if (!Number.isFinite(f)) return null;
  return Math.round(Math.min(1, Math.max(0, f)) * 1000) / 1000;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run shared/mirror.test.ts
```

Expected: PASS, 13 tests.

- [ ] **Step 5: Run the full suite and typecheck**

```bash
npm test && npm run typecheck
```

Expected: all existing tests still pass (378 + 13), both tsc projects clean.

- [ ] **Step 6: Commit**

```bash
git add shared/mirror.ts shared/mirror.test.ts
git commit -m "feat(mirror): derive who drives a column, and the wire value

driverOf is the first connected, human member in roster order — human
because bots are connected: true and would otherwise lead a roster and own
a column they can never drive.

scrollFraction sends a fraction of scrollable range rather than pixels: the
phone renders its list at 19px and the host column at 15px, so the same
scrollTop means two different words. It also keeps the TV's visible window
nested inside the phone's by construction.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The wire — protocol, server hop, store listener

**Files:**
- Modify: `shared/protocol.ts` (add to `ClientMessage` and `ServerMessage`)
- Modify: `party/server.ts` (handler in `onMessage`, plus a `sendToHost` helper)
- Modify: `src/net/room.ts` (listener set, `receive` case)

**Interfaces:**
- Consumes: `driverOf` from Task 1; `rosterOf` and `isHuman`, both **already imported** in `party/server.ts:11,13`.
- Produces:
  - `ClientMessage | { type: "scrollTo"; at: number }`
  - `ServerMessage | { type: "columnScroll"; scorer: ScorerId; at: number }`
  - `roomStore.onColumnScroll(fn: (scorer: ScorerId, at: number) => void): () => void` — used by Task 5.

There is no unit-test precedent for `party/server.ts` or `src/net/room.ts` in this repo, so this task's gate is typecheck plus the manual check in Step 6.

- [ ] **Step 1: Add both message variants**

In `shared/protocol.ts`, extend the existing `import type { TeamId } from "./teams";` on line 4 to:

```ts
import type { ScorerId, TeamId } from "./teams";
```

Add to `ClientMessage`, immediately after the `selfStrike` variant:

```ts
  /**
   * The scroll mirror, `scoring` only: put my scorer's column on the host TV at
   * this fraction of its scrollable range. Accepted only from that column's
   * driver — see `driverOf` in `shared/mirror.ts`.
   */
  | { type: "scrollTo"; at: number }
```

Add to `ServerMessage`, after `yourEntries`:

```ts
  /**
   * One column's mirrored scroll position. Sent to the host socket alone, and
   * never persisted or broadcast — a scroll is not game state.
   *
   * Addressed by *scorer* rather than by sender: with teams on the sender is
   * one member of a shared column, and the TV addresses columns by scorer.
   */
  | { type: "columnScroll"; scorer: ScorerId; at: number }
```

- [ ] **Step 2: Add the server handler**

In `party/server.ts`, add to the imports after line 13 (`import { isHuman } from "../shared/bots";`):

```ts
import { driverOf } from "../shared/mirror";
```

In `onMessage`, insert this **after** the `debugFill` block and **before** the `endGame` block — it belongs with the fast paths that never reach the reduce/persist/broadcast tail:

```ts
    /**
     * The scroll mirror: one player's position in their own results list,
     * forwarded to the TV so their column follows.
     *
     * Handled here rather than as a `reduce` event on purpose. A scroll
     * position is not game state — it has no bearing on scoring, it must not
     * survive a refresh, and exactly one socket in the room wants it. Going
     * through `reduce` would make every send a Durable Object storage write
     * *and* a full `RoomState` re-encode to every socket: an eight-player room
     * paying eight encodes to move one column.
     *
     * This is the one place the app deliberately ticks over the wire. Every
     * other continuous thing — the round timer, the reveal — broadcasts an
     * absolute moment once and is counted locally against `clockOffset`. A
     * scroll is live human input with no schedule to derive it from, so there
     * is no derivation that avoids the traffic; the rate is capped on the
     * client instead. See the request-budget arithmetic in
     * docs/superpowers/specs/2026-07-30-scroll-mirror-design.md.
     */
    if (msg.type === "scrollTo") {
      if (this.room.phase.name !== "scoring") return;
      const scorer = rosterOf(this.room).find((s) => s.members.includes(playerId));
      if (!scorer) return;
      // Enforced here and not on the TV: this is the only place that knows the
      // roster and the connection states, and the panel-style "the client
      // wouldn't send it" argument is not a boundary.
      if (driverOf(this.room, scorer.id) !== playerId) return;
      // A hand-rolled message never went through `scrollFraction`, so the
      // clamp is repeated rather than assumed — the same reason the selfStrike
      // case runs `Number` over `msg.index`.
      const at = Number(msg.at);
      if (!Number.isFinite(at)) return;
      this.sendToHost({
        type: "columnScroll",
        scorer: scorer.id,
        at: Math.min(1, Math.max(0, at)),
      });
      return; // Nothing to persist, nothing to broadcast.
    }
```

Add this helper in the `---- plumbing ----` section, directly after `sendEntriesToTeam`:

```ts
  /**
   * Sends to the host's socket alone, dropping the message when no host is
   * connected. Silent by design: a mirrored scroll that did not land breaks
   * nothing and is not worth a round trip to complain about.
   */
  private sendToHost(msg: ServerMessage): void {
    if (!this.room) return;
    const hostId = this.room.hostId;
    if (hostId === null) return;
    for (const conn of this.getConnections<ConnState>()) {
      if (conn.state?.playerId === hostId) {
        this.sendTo(conn, msg);
        return;
      }
    }
  }
```

- [ ] **Step 3: Add the client listener**

In `src/net/room.ts`, add to the imports after line 5:

```ts
import type { ScorerId } from "../../shared/teams";
```

Add the listener set inside `RoomStore`, directly after `private listeners = new Set<() => void>();`:

```ts
  /**
   * Mirrored column scrolls, as a plain listener set rather than part of the
   * `useSyncExternalStore` snapshot.
   *
   * Deliberately outside React state. `HostScoring` renders up to ten columns
   * of up to 200 rows; routing a 4Hz value through `set()` would re-render that
   * whole tree four times a second per scrolling player. The host writes
   * `scrollTop` straight onto the DOM nodes it already holds instead — the same
   * imperative-where-React-would-be-wrong call the measured swap makes.
   */
  private scrollListeners = new Set<(scorer: ScorerId, at: number) => void>();
```

Add the subscribe method directly after `subscribe`:

```ts
  onColumnScroll = (fn: (scorer: ScorerId, at: number) => void): (() => void) => {
    this.scrollListeners.add(fn);
    return () => { this.scrollListeners.delete(fn); };
  };
```

Add the case to `receive`, after the `yourEntries` case:

```ts
      case "columnScroll":
        // Straight to the listeners — never through `set()`, which would
        // re-render every subscriber four times a second.
        for (const listener of this.scrollListeners) listener(msg.scorer, msg.at);
        break;
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: both projects clean. If `tsconfig.worker.json` complains about `shared/mirror.ts`, that is a real failure — the module must compile for the Worker too.

- [ ] **Step 5: Run the full suite**

```bash
npm test
```

Expected: PASS. Nothing here changes game logic, so no existing test should move.

- [ ] **Step 6: Confirm nothing is sent or broadcast yet**

There is no UI on either end until Task 3, so this task's gate is the two checks above plus one reading. Re-read your `scrollTo` block and confirm all four of these, which are the things a later task cannot catch for you:

1. It sits **above** the `// Captured BEFORE the reduce` comment, so it never reaches `maybeArchiveBank`, `persist` or `broadcastState`.
2. It ends in a bare `return`, not a `break` or a fall-through.
3. It calls neither `this.persist()` nor `this.broadcastState()`.
4. `sendToHost` returns after the first matching connection rather than sending to every socket.

The wire is exercised end to end by the manual checks in Task 3 Step 5 and Task 4 Step 5, including the non-driver rejection.

- [ ] **Step 7: Commit**

```bash
git add shared/protocol.ts party/server.ts src/net/room.ts
git commit -m "feat(mirror): carry a column's scroll position to the host alone

scrollTo is handled on the fast path above the reduce/persist/broadcast
tail, like submitEntry: a scroll position is not game state, must not
survive a refresh, and exactly one socket wants it. The server enforces the
driver, clamps the value again because a hand-rolled message never went
through scrollFraction, and sends to the host socket alone.

On the client it lands on a plain listener set rather than the store
snapshot — routing 4Hz through set() would re-render ten columns of two
hundred rows four times a second.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The phone sends

**Files:**
- Modify: `src/screens/player/PlayerScoring.tsx`

**Interfaces:**
- Consumes: `scrollFraction` from Task 1; `roomStore.send` with the `scrollTo` variant from Task 2; `schedule.lastStep` and `step`, both already in scope in this file.
- Produces: nothing consumed by later tasks.

Note the existing `useMarquee` ref (`const list = ...`) is on the `.card.list-card` **wrapper**, not the scroll box. The scroll box is the `.word-list` div inside `WordList`, reached via its `listRef` prop. Do not reuse the marquee ref.

- [ ] **Step 1: Add the imports and constants**

Change the React import on line 1 to:

```ts
import { useEffect, useMemo, useRef, useState } from "react";
```

Add to the `shared/reveal` import block:

```ts
import { scrollFraction } from "../../../shared/mirror";
```

Add these constants above the `Props` type:

```ts
/**
 * The mirror's send rate: a trailing send every `MIRROR_INTERVAL` while the
 * finger moves, plus one `MIRROR_SETTLE` after it stops.
 *
 * The settle send is what guarantees the TV ends up exactly where the finger
 * did rather than up to one interval short of it.
 *
 * The interval is chosen rather than assumed. Every message wakes the
 * hibernating Durable Object and counts against `doRequestsPerDay`, which is
 * 100,000/day *account-wide* and shared between staging and production
 * (`shared/usage.ts`). At 100ms the mirror alone would cap the account near
 * fifty matches a day; at 250ms it is about a third of that, and the host's
 * easing (see `HostScoring`) closes the visual gap.
 */
const MIRROR_INTERVAL = 250;
const MIRROR_SETTLE = 150;
```

- [ ] **Step 2: Add the refs and the effect**

Immediately after `const { step } = useRevealStep(schedule, startedAt, skipped, reduced);`, add:

```ts
  /** The scroll box itself, not the card around it. */
  const listBox = useRef<HTMLDivElement | null>(null);
  const sentAt = useRef(0);
  const lastSent = useRef<number | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * The mirror drives this phone's own column on the TV — but only once the
   * reveal has run out.
   *
   * Until then the TV is still following its own newest revealed line, and its
   * column holds *only revealed rows* while this screen has shown the whole
   * list since the first frame: the row under a finger here may not exist there
   * yet. `step >= lastStep` is the same instant on every device, because both
   * screens count it off the same `scoring.startedAt` against the same
   * schedule, and a FAST FORWARD lands it on all of them together.
   *
   * The TV holds what arrives and starts applying at its own later gate — see
   * `HostScoring`. That gap is deliberate and is why this side does not wait
   * for it.
   */
  const mirroring = step >= schedule.lastStep;

  useEffect(() => {
    const box = listBox.current;
    if (!box || !mirroring) return;

    const push = () => {
      const at = scrollFraction(box.scrollTop, box.scrollHeight, box.clientHeight);
      // Null is a list shorter than its box: no position to mirror, so nothing
      // is sent at all. An unchanged rounded value is the free dedupe the
      // three-decimal quantization buys.
      if (at === null || at === lastSent.current) return;
      lastSent.current = at;
      sentAt.current = Date.now();
      roomStore.send({ type: "scrollTo", at });
    };

    const onScroll = () => {
      if (Date.now() - sentAt.current >= MIRROR_INTERVAL) push();
      if (settleTimer.current !== null) clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(push, MIRROR_SETTLE);
    };

    box.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      box.removeEventListener("scroll", onScroll);
      if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    };
  }, [mirroring]);
```

- [ ] **Step 3: Wire the ref to the scroll box**

In the `WordList` call inside the `.card.list-card` div, add the `listRef` prop:

```tsx
        <WordList
          entries={me.entries}
          size={19}
          labelFor={labelFor}
          authorFor={me.colorIndex !== null ? emojiOf : undefined}
          reveal={reveal}
          listRef={listBox}
```

Leave the rest of that call — `onSelfStrike` and its comment — exactly as it is.

- [ ] **Step 4: Typecheck and test**

```bash
npm run typecheck && npm test
```

Expected: both clean.

- [ ] **Step 5: Manual check**

With both dev servers running, open `?p=1` and `?p=2`, reach the results screen with enough words to overflow the phone's list (the debug panel's auto-fill under Debug, then the view jumper to Results). Scroll on `?p=2` and watch its Network → WS frames.

Expected: outbound `{"type":"scrollTo","at":…}` roughly every 250ms while scrolling, one final frame ~150ms after stopping, and **nothing at all** while the reveal is still running lines.

- [ ] **Step 6: Commit**

```bash
git add src/screens/player/PlayerScoring.tsx
git commit -m "feat(mirror): send this phone's scroll position once the reveal ends

Gated on step >= lastStep: until then the TV's column holds only revealed
rows while this screen has shown the whole list from the first frame, so
the row under a finger here may not exist there yet.

Trailing send every 250ms plus one 150ms after the finger stops — the
settle send is what puts the TV exactly where the finger ended rather than
up to one interval short.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The TV applies it

**Files:**
- Modify: `src/screens/host/HostScoring.tsx`

**Interfaces:**
- Consumes: `roomStore.onColumnScroll` from Task 2; the existing `lists` ref map (`HostScoring.tsx:217`), `rankStage`, and `reduced`.
- Produces: nothing consumed by later tasks. Task 5 adds the class toggle into the listener written here.

- [ ] **Step 1: Add the easing constant**

Add below the `SWAP_DURATION` / `SWAP_X_DELAY` block:

```ts
/**
 * The mirror eases toward each target rather than snapping to it. At 60fps a
 * 0.25 factor closes ~99% in about 280ms — near enough one send interval, so a
 * 4Hz stream reads as continuous motion without stacking noticeable lag on top
 * of the interval itself.
 */
const MIRROR_EASE = 0.25;
```

- [ ] **Step 2: Add the refs**

After the existing `const lists = useRef(new Map<ScorerId, HTMLDivElement | null>());`, add:

```ts
  /**
   * The mirror's targets, as fractions of each column's scrollable range.
   *
   * Refs, not state, and that is the whole point: this screen renders up to ten
   * columns of up to 200 rows, and a 4Hz value in the render tree would
   * re-render all of it four times a second per scrolling player. The values
   * are written straight onto the DOM nodes above instead — the same
   * imperative call the measured swap makes, and for the same reason.
   */
  const mirrorTargets = useRef(new Map<ScorerId, number>());
  /** Kicks the rAF loop when a new target lands. Set by the effect below. */
  const mirrorPump = useRef<() => void>(() => {});
```

- [ ] **Step 3: Buffer arrivals, and drive the grid**

Add both effects after the existing auto-scroll effect (the one ending `}, [active, step, reduced]);`):

```ts
  // Buffered from the moment they arrive, whether or not the cards have settled
  // yet — see the gate below.
  useEffect(
    () =>
      roomStore.onColumnScroll((scorer, at) => {
        mirrorTargets.current.set(scorer, at);
        mirrorPump.current();
      }),
    [],
  );

  /**
   * The mirror engages only once the cards are settled in final order.
   *
   * Between the reveal running out and `rankStage === 2` the TV is finishing
   * the last column's own auto-scroll and then flying the measured swap, and a
   * mirror fighting either would read as a bug. The phones start sending
   * earlier on purpose: **buffering rather than dropping** is what makes the
   * gap invisible, so a player who scrolls during the swap and then stops still
   * sees the TV arrive where they left it with no second gesture.
   *
   * One rAF loop for the whole grid, started on demand and stopping the moment
   * every column has arrived — not one loop per column, and not a loop left
   * spinning on an idle results screen.
   */
  useEffect(() => {
    if (rankStage !== 2) return;
    let frame = 0;

    const advance = () => {
      frame = 0;
      let busy = false;
      for (const [id, at] of mirrorTargets.current) {
        const box = lists.current.get(id);
        if (!box) continue;
        const range = box.scrollHeight - box.clientHeight;
        // Nothing to scroll: the phone would not have sent, but a column can
        // also be shorter here than there.
        if (range <= 0) continue;
        const delta = at * range - box.scrollTop;
        if (Math.abs(delta) < 0.5) {
          box.scrollTop = at * range;
          continue;
        }
        // Reduced motion has no easing to do and lands on the first frame.
        box.scrollTop += reduced ? delta : delta * MIRROR_EASE;
        busy = true;
      }
      if (busy) frame = requestAnimationFrame(advance);
    };

    const kick = () => {
      if (frame === 0) frame = requestAnimationFrame(advance);
    };
    mirrorPump.current = kick;
    // Whatever arrived while the swap was still flying.
    kick();

    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      mirrorPump.current = () => {};
    };
  }, [rankStage, reduced]);
```

- [ ] **Step 4: Typecheck and test**

```bash
npm run typecheck && npm test
```

Expected: both clean.

- [ ] **Step 5: Manual check — the whole feature, end to end**

With both dev servers running: `?p=1` as the TV, `?p=2` and `?p=3` as phones. Auto-fill a round from the debug panel, let it reach Results, and **wait for the swap to finish**.

Verify:
1. Scrolling on `?p=2` moves that player's column on `?p=1`, smoothly, trailing by about a quarter second.
2. Scrolling during the reveal moves nothing on the TV; scrolling during the swap lands after it settles.
3. `?p=3` scrolling moves `?p=3`'s column and not `?p=2`'s.
4. With Team Count set to 2, the first member of a team drives its column and the second does not.
5. Closing the first member's tab hands the column to the next connected member, with no jump at the handover.

- [ ] **Step 6: Commit**

```bash
git add src/screens/host/HostScoring.tsx
git commit -m "feat(mirror): ease each column to its mirrored position

Buffered on arrival, applied from rankStage === 2 — between the reveal
running out and the swap finishing, the TV is still doing its own
auto-scroll and then flying the measured swap, and a mirror fighting either
would read as a bug. Buffering rather than dropping is what makes that gap
invisible.

One rAF loop for the whole grid, started on demand and stopping when every
column has arrived. The targets are refs and the writes go straight to the
DOM: a 4Hz value in the render tree would re-render ten columns of two
hundred rows four times a second.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The indicator

**Files:**
- Modify: `src/screens/host/HostScoring.tsx` (extend the Task 4 listener)
- Modify: `src/style.css`

**Interfaces:**
- Consumes: the `roomStore.onColumnScroll` listener and the `lists` ref map from Task 4.
- Produces: the `.word-list--driven` class.

- [ ] **Step 1: Add the idle constant and ref**

In `HostScoring.tsx`, add below `MIRROR_EASE`:

```ts
/** How long a column keeps its driven marker after the last message. */
const MIRROR_IDLE = 2000;
```

Add beside `mirrorPump`:

```ts
  /** Per-column timers that clear the driven marker. */
  const mirrorIdle = useRef(new Map<ScorerId, ReturnType<typeof setTimeout>>());
```

- [ ] **Step 2: Toggle the class from the listener**

Replace the listener effect from Task 4 with:

```ts
  useEffect(
    () =>
      roomStore.onColumnScroll((scorer, at) => {
        mirrorTargets.current.set(scorer, at);
        mirrorPump.current();

        /**
         * The driven marker, toggled straight on the node rather than through
         * a class in the render tree — same reason as the scroll itself, and it
         * keeps the whole mirror out of React.
         *
         * Safe against a re-render: `WordList` renders a constant
         * `className="word-list"`, so React's diff finds no change and never
         * rewrites the attribute. A `viewNonce` remount does drop it, which is
         * correct — that is a fresh screen.
         */
        const box = lists.current.get(scorer);
        if (!box) return;
        box.classList.add("word-list--driven");
        const prev = mirrorIdle.current.get(scorer);
        if (prev !== undefined) clearTimeout(prev);
        mirrorIdle.current.set(
          scorer,
          setTimeout(() => box.classList.remove("word-list--driven"), MIRROR_IDLE),
        );
      }),
    [],
  );
```

Add the timer cleanup to the rAF effect's existing return, so it becomes:

```ts
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      mirrorPump.current = () => {};
      for (const timer of mirrorIdle.current.values()) clearTimeout(timer);
      mirrorIdle.current.clear();
    };
```

- [ ] **Step 3: Add the CSS**

In `src/style.css`, directly after the `.word-list::-webkit-scrollbar-thumb` rule:

```css
/* The mirror: this column is being scrolled from its owner's phone.
   The scrollbar thumb is the whole signal. It costs no layout on a card that
   has none to spare, and it sits exactly where the eye already is when
   something moves — without it, one column of ten scrolling on its own moments
   after the reveal stopped scrolling them all reads as a glitch rather than as
   a person. */
.word-list--driven { scrollbar-color: var(--cream) transparent; }
.word-list--driven::-webkit-scrollbar-thumb { background: var(--cream); }
```

- [ ] **Step 4: Typecheck and test**

```bash
npm run typecheck && npm test
```

Expected: both clean.

- [ ] **Step 5: Manual check**

On `?p=1` with `?p=2` scrolling: the driven column's scrollbar thumb turns cream while it moves and returns to `--scroll-thumb` about two seconds after the phone stops. No other column's thumb changes.

- [ ] **Step 6: Commit**

```bash
git add src/screens/host/HostScoring.tsx src/style.css
git commit -m "feat(mirror): mark the column a phone is driving

The scrollbar thumb takes the cream accent while a column is being driven,
and returns two seconds after the last message. It costs no layout on a
card with none to spare and sits where the eye already is when something
moves — one column of ten scrolling on its own, moments after the reveal
stopped scrolling them all, otherwise reads as a glitch.

Toggled on the node rather than through the render tree, like the scroll
itself.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Version bump, docs, and final verification

**Files:**
- Modify: `package.json`, `package-lock.json`
- Modify: `CLAUDE.md`

**Interfaces:** none.

- [ ] **Step 1: Bump the version in all three places**

`0.7.1` → `0.8.0`, in `package.json`'s `version`, `package-lock.json`'s top-level `version`, and `package-lock.json`'s `packages: { "": { "version": ... } }`. Confirm:

```bash
grep -n '"version": "0.8.0"' package.json package-lock.json
```

Expected: three matching lines.

- [ ] **Step 2: Record the subsystem in CLAUDE.md**

Add to the "The scoring reveal" section, after the FAST FORWARD bullet:

```markdown
- **The scroll mirror is the one thing in the app that deliberately ticks over
  the wire.** Once the reveal is over, a player's scroll on their own list
  drives their column on the TV. There is no schedule to derive live human
  input from, so the traffic is real and the rate is capped instead — 250ms
  plus a settle send, against a 100,000/day *account-wide* DO ceiling. It rides
  a host-directed fast path in `party/server.ts`, above the
  reduce/persist/broadcast tail: a scroll position is not game state, must not
  survive a refresh, and exactly one socket wants it. **Nothing about it enters
  `Room` or React state** — `roomStore.onColumnScroll` is a plain listener and
  `HostScoring` writes `scrollTop` onto the nodes directly, because a 4Hz value
  in that render tree is ten columns of two hundred rows re-rendering four
  times a second.
- **A column's driver is derived per message, never claimed.** `driverOf`
  (`shared/mirror.ts`) is the first **connected, human** member in roster
  order. Human is load-bearing: bots are `connected: true`, so a bot seated by
  `seatBots` would otherwise lead a roster and own a column it can never drive.
  Deriving rather than storing is what makes a disconnect hand the column over
  with nothing watching for it.
- **The two ends of the mirror are gated at different instants, on purpose.**
  The phone sends from `step >= lastStep`; the TV buffers and applies from
  `rankStage === 2`. In between it is finishing its own auto-scroll and flying
  the measured swap. Buffering rather than dropping is what makes the gap
  invisible.
```

Add to the Docs list, after the host-scoring-reveal entry:

```markdown
- `docs/superpowers/specs/2026-07-30-scroll-mirror-design.md` — the scroll
  mirror: the fraction unit and why not a row index, `driverOf`, the
  host-directed fast path and its request budget, the two gates. Implemented.
```

- [ ] **Step 3: Full verification**

```bash
npm test && npm run typecheck && npm run build
```

Expected: all three clean. `npm run build` runs typecheck then `vite build`.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json CLAUDE.md
git commit -m "chore: bump to 0.8.0 and record the scroll mirror

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Push and open the PR**

```bash
git push -u origin player-host-screen-mirror
```

The Worker changes are real, so **merge to `staging` first** if you want three phones on a URL — PRs no longer deploy the Worker, and Vercel previews point at the staging Worker.

---

## Verification

Everything above is green when:

- `npm test` — 378 existing plus 13 new in `shared/mirror.test.ts`.
- `npm run typecheck` — both `tsconfig.json` and `tsconfig.worker.json`.
- `npm run build`.
- The five manual checks in Task 4 Step 5 and the one in Task 5 Step 5.

## Out of scope — do not build

Named here because each is a plausible thing to reach for mid-task:

- No indication on the **phone** that it is driving the TV.
- No way to turn the mirror off, per player or per room.
- No persistence of any kind: not across a refresh, a reconnect, or a round.
- No host-side scrolling of a column. The TV has no pointer; that is why this exists.
- No mirroring during the reveal itself. That was decided against, not forgotten.
