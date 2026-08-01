# Round Time Warnings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flash a band on the phones and the TV as a round runs down — at the halfway mark on a long round, then at a minute, thirty seconds and ten.

**Architecture:** The milestone set is a pure function of the round length in `shared/`. Every client derives its own from `phase.endsAt` and `clockOffset`, exactly as the round timer and reveal schedule already do — nothing new goes on the wire. A hook holds which milestones have already fired, keyed on the deadline so a new round resets it. One component renders the band, anchored differently on phone and TV.

**Tech Stack:** TypeScript, React 19, Vitest, plain CSS.

**Spec:** `docs/superpowers/specs/2026-07-31-round-time-warnings-design.md`

## Global Constraints

- **Node 22** (`.nvmrc`). Run commands from the repo root.
- **`npm run typecheck` runs two tsc projects** — `tsconfig.json` (src + shared, DOM libs) and `tsconfig.worker.json` (party + shared, workers-types). Anything in `shared/` must typecheck under **both**. The single command runs both.
- **Tests live in `shared/**/*.test.ts` only.** That is the entire Vitest glob — there is no React/DOM test infrastructure in this repo. Do not add tests for `src/`.
- **Nothing in this feature touches `shared/reduce.ts`, `party/server.ts`, or `shared/protocol.ts`.** No new `RoomState` field, no new message, no server change at all. If you find yourself editing any of those three, stop — you have misread the plan.
- **Timers broadcast an absolute `endsAt`, never per-second ticks.** Clients count down locally against `clockOffset`.
- **No sound and no haptics.** No `Audio`, no `AudioContext`, no `navigator.vibrate` — there is none in this app today and this feature does not introduce it.
- **Commits stage explicit paths — never `git add -A`.** The untracked working notes `Project W-104.md` and `W104 Party Game Wireframes.zip` must stay untracked.
- **Round duration runs `MIN_DURATION_SEC = 15` to `MAX_DURATION_SEC = 600`**, both exported from `shared/gamemodes.ts`. Default is `DEFAULT_DURATION_SEC = 30` from `shared/categories.ts`.
- **The branch is `timer-improvements`**, already checked out, already carrying the entry-flush feature. Do not switch branches. Version bump happens once, in Task 4.

---

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| `shared/roundwarnings.ts` | Create | `warningsFor(durationSec)` — the milestone set. Pure. |
| `shared/roundwarnings.test.ts` | Create | The set at every interesting duration, plus properties over the whole legal range. |
| `src/roundwarnings.ts` | Create | `useRoundWarning` — which milestone to show now. Mirrors the `shared/reveal.ts` ÷ `src/reveal.ts` split already in the repo. |
| `src/components/TimeWarning.tsx` | Create | The band. One component, two anchors. |
| `src/style.css` | Modify | `.time-warning` and its two variants, beside `.reject-banner` (~line 2332). |
| `src/screens/player/PlayerPlaying.tsx` | Modify | Lift `useRemaining` out of `TimerWheel`, render the band. |
| `src/screens/host/HostPlaying.tsx` | Modify | Render the band. |
| `CLAUDE.md`, `package.json`, `package-lock.json` | Modify | Invariant, docs entry, test count, version. |

Only Task 1 can carry unit tests — the glob is `shared/**`. Tasks 2 and 3 are gated on typecheck and build, and on the manual pass in Task 4.

---

### Task 1: `warningsFor` — the milestone set

**Files:**
- Create: `shared/roundwarnings.ts`
- Create: `shared/roundwarnings.test.ts`

**Interfaces:**
- Consumes: `MIN_DURATION_SEC`, `MAX_DURATION_SEC` from `./gamemodes` (tests only).
- Produces:
  - `export const TAIL_SEC: number[]` — `[60, 30, 10]`
  - `export const WARNING_GAP_SEC: number` — `20`
  - `export function warningsFor(durationSec: number): number[]` — descending

- [ ] **Step 1: Write the failing test**

Create `shared/roundwarnings.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { WARNING_GAP_SEC, warningsFor } from "./roundwarnings";
import { MAX_DURATION_SEC, MIN_DURATION_SEC } from "./gamemodes";

describe("warningsFor", () => {
  test("a short round gets the ten-second warning alone", () => {
    expect(warningsFor(15)).toEqual([10]);
    expect(warningsFor(20)).toEqual([10]);
    expect(warningsFor(30)).toEqual([10]);
  });

  test("half is dropped where it would land on a tail member", () => {
    // Exact collisions: 20 -> half 10, 60 -> half 30, 120 -> half 60.
    expect(warningsFor(20)).toEqual([10]);
    expect(warningsFor(60)).toEqual([30, 10]);
    expect(warningsFor(120)).toEqual([60, 30, 10]);
  });

  test("half appears once it clears the tail by the gap", () => {
    expect(warningsFor(159)).toEqual([60, 30, 10]);
    expect(warningsFor(160)).toEqual([80, 60, 30, 10]);
  });

  test("a long round gets all four", () => {
    expect(warningsFor(180)).toEqual([90, 60, 30, 10]);
    expect(warningsFor(600)).toEqual([300, 60, 30, 10]);
  });

  test("the 15-second round keeps 10 rather than half", () => {
    // The ordering trap: half is 7, which is *more* urgent than 10. Merged
    // into the tail and sorted by urgency it would win and then suppress 10,
    // warning later than the set is supposed to.
    expect(warningsFor(15)).toEqual([10]);
    expect(warningsFor(15)).not.toContain(7);
  });

  test("a warning never fires at the moment the round starts", () => {
    // "1:00 left" at 1:00 is not news.
    expect(warningsFor(60)).not.toContain(60);
    expect(warningsFor(30)).not.toContain(30);
  });

  test("a round too short for any warning yields none", () => {
    // Below MIN_DURATION_SEC, so unreachable in play — asserted so the
    // function is total rather than throwing on Math.max of an empty tail.
    expect(warningsFor(10)).toEqual([]);
  });

  test("every legal round length yields a strictly descending list", () => {
    for (let d = MIN_DURATION_SEC; d <= MAX_DURATION_SEC; d++) {
      const out = warningsFor(d);
      for (let i = 1; i < out.length; i++) {
        expect(out[i]).toBeLessThan(out[i - 1]);
      }
    }
  });

  test("every legal round length keeps its warnings a gap apart", () => {
    for (let d = MIN_DURATION_SEC; d <= MAX_DURATION_SEC; d++) {
      const out = warningsFor(d);
      for (let i = 1; i < out.length; i++) {
        expect(out[i - 1] - out[i]).toBeGreaterThanOrEqual(WARNING_GAP_SEC);
      }
    }
  });

  test("no warning is ever at or beyond the round's own length", () => {
    for (let d = MIN_DURATION_SEC; d <= MAX_DURATION_SEC; d++) {
      for (const w of warningsFor(d)) expect(w).toBeLessThan(d);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run shared/roundwarnings.test.ts`

Expected: FAIL — `shared/roundwarnings.ts` does not exist, so the import cannot resolve and the file fails to load. Every test in it errors. That is the expected shape; do not stub anything to soften it.

- [ ] **Step 3: Write the implementation**

Create `shared/roundwarnings.ts`:

```ts
/**
 * Which points in a round get a warning band, and in what order they fire.
 *
 * Pure and duration-derived: every client computes the same set from the same
 * round length, so the TV and the phones warn together without anything
 * riding on the wire. See
 * docs/superpowers/specs/2026-07-31-round-time-warnings-design.md.
 */

/**
 * The urgency warnings, in seconds remaining. Already at least
 * WARNING_GAP_SEC apart from one another, which is why the tail needs no
 * separation check among its own members — only the halfway candidate does.
 */
export const TAIL_SEC = [60, 30, 10];

/**
 * The closest two warnings may sit. Twenty seconds is the gap between the
 * tightest pair the tail already ships — 30 and 10 — so it is the spacing the
 * screen is known to survive.
 */
export const WARNING_GAP_SEC = 20;

/**
 * Seconds-remaining marks for a round of `durationSec`, descending.
 *
 * The halfway mark is a *candidate*, never a member: it survives only when it
 * clears the top of the tail by WARNING_GAP_SEC. That single comparison
 * removes every collision the naive set has — half lands exactly on a tail
 * member at 20s, 60s and 120s — with no per-duration special case.
 *
 * **The order of the two operations is load-bearing.** Merged into the tail
 * and sorted by urgency, half on a 15-second round is 7, which is *more*
 * urgent than the tail's 10: it would be kept first, and 10 would then be
 * dropped for sitting inside its gap. The round would warn at 7 seconds
 * having discarded the more urgent warning to keep the less urgent one.
 */
export function warningsFor(durationSec: number): number[] {
  const tail = TAIL_SEC.filter((s) => s < durationSec);
  const half = Math.floor(durationSec / 2);
  const top = tail.length ? Math.max(...tail) : 0;
  return half >= top + WARNING_GAP_SEC ? [half, ...tail] : tail;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run shared/roundwarnings.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Run the whole suite and typecheck**

Run: `npm test && npm run typecheck`

Expected: PASS. The pre-existing count is **606**; you are adding 10, so expect **616**. Typecheck clean on both projects — `shared/roundwarnings.ts` compiles under `tsconfig.json` and `tsconfig.worker.json` both, even though only the client imports it.

- [ ] **Step 6: Commit**

```bash
git add shared/roundwarnings.ts shared/roundwarnings.test.ts
git commit -m "feat: warningsFor — the round's warning marks, derived from its length

The tail 60/30/10 filtered by duration, plus the halfway mark only when it
clears the top of the tail by 20s. That one comparison removes all three
exact collisions (20s, 60s, 120s) with no per-duration special case.

Half is checked against the tail rather than merged into it, and the
15-second round is why: merged and sorted by urgency, half is 7, which
would be kept ahead of 10 and would then suppress it — warning later than
the set is meant to."
```

---

### Task 2: `useRoundWarning` — which mark to show now

**Files:**
- Create: `src/roundwarnings.ts`

**Interfaces:**
- Consumes: `warningsFor` from `../shared/roundwarnings` (Task 1).
- Produces: `export function useRoundWarning(remaining: number, durationSec: number, endsAt: number): number | null` — the mark most recently fired, or null. Task 3 renders it.

This mirrors the split the repo already has: `shared/reveal.ts` holds the pure schedule, `src/reveal.ts` holds the `useRevealStep` hook that reads it.

- [ ] **Step 1: Write the implementation**

There is no test step for this task — the Vitest glob is `shared/**` and this is a React hook. Create `src/roundwarnings.ts`:

```ts
import { useEffect, useMemo, useRef, useState } from "react";
import { warningsFor } from "../shared/roundwarnings";

/**
 * The warning mark to show right now, or null.
 *
 * Fed `remaining` from `useRemaining`, so the pause behaviour comes for free:
 * a held round's clock stops moving and nothing crosses. Marks are keyed to
 * *values* of remaining, never to elapsed time, which is what makes that true
 * with no code.
 */
export function useRoundWarning(
  remaining: number,
  durationSec: number,
  /**
   * The round's deadline, used purely as the round's identity — a new one
   * means a new round, and the fired set resets with nothing watching for it.
   */
  endsAt: number,
): number | null {
  const marks = useMemo(() => warningsFor(durationSec), [durationSec]);
  const fired = useRef<Set<number>>(new Set());
  const seeded = useRef(0);
  const [mark, setMark] = useState<number | null>(null);

  useEffect(() => {
    if (seeded.current !== endsAt) {
      // New round. Bank everything already behind us without showing it: a
      // phone joining at 45 seconds left on a three-minute round must not
      // flash "1:30 LEFT" on arrival, which is both startling and false.
      //
      // `>=` rather than `>` so arriving exactly on a mark banks it rather
      // than warning about a moment this client did not witness. It cannot
      // suppress a warning on a round joined at the whistle: every mark is
      // strictly less than durationSec, so nothing is banked at full time.
      fired.current = new Set(marks.filter((m) => m >= remaining));
      seeded.current = endsAt;
      setMark(null);
      return;
    }
    // The round is over. debugSkip moves the deadline to now, so `remaining`
    // reaches 0 while the phase is still `playing` for one round trip — with
    // no guard the room would flash "0:10 LEFT" as the round ended.
    if (remaining <= 0) return;

    const crossed = marks.filter((m) => remaining <= m && !fired.current.has(m));
    if (crossed.length === 0) return;
    for (const m of crossed) fired.current.add(m);
    // A locked phone's tab can jump from 60 straight to 5. Firing every mark
    // it skipped would burst three bands at once; the smallest is the one
    // still closest to true.
    setMark(Math.min(...crossed));
  }, [remaining, marks, endsAt]);

  return mark;
}
```

- [ ] **Step 2: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both clean. This is the whole gate for this task — the hook has no consumer yet, so it compiles and does nothing.

- [ ] **Step 3: Run the suite**

Run: `npm test`
Expected: PASS, 616. Confirming you broke nothing; no test reaches `src/`.

- [ ] **Step 4: Commit**

```bash
git add src/roundwarnings.ts
git commit -m "feat: useRoundWarning — the mark to show, once per round

Keyed on endsAt as the round's identity, so a new round resets the fired
set with nothing watching for it. Three rules earn their place: marks
already passed when a client first looks are banked silently so a
mid-round joiner is not flashed a stale warning; a tab that was
backgrounded across several marks shows only the most urgent rather than
bursting; and nothing shows at zero, because debugSkip drives remaining to
0 while the phase is still playing."
```

---

### Task 3: The band, and both screens

**Files:**
- Create: `src/components/TimeWarning.tsx`
- Modify: `src/style.css` (add after the `reject-fade` keyframes, ~line 2356)
- Modify: `src/screens/player/PlayerPlaying.tsx`
- Modify: `src/screens/host/HostPlaying.tsx`

**Interfaces:**
- Consumes: `useRoundWarning` from Task 2; `formatClock` from `../net/clock`.
- Produces: `TimeWarning` — props `{ mark: number; variant: "player" | "host" }`.

- [ ] **Step 1: Create the component**

Create `src/components/TimeWarning.tsx`:

```tsx
import { formatClock } from "../net/clock";

/**
 * The band that flashes as a round runs down.
 *
 * Same language as `.reject-banner`, deliberately: full opacity on the first
 * frame then fading, because a message that fades *in* is a message
 * half-missed — and `pointer-events: none`, because it sits over a list
 * somebody is typing into.
 *
 * `variant` is the anchor, not the look. On the phone the band sits high
 * rather than centre: the reject banner owns the centre, and a duplicate
 * submitted at ten seconds left would otherwise put two bands on one strip of
 * pixels.
 */
export function TimeWarning({ mark, variant }: {
  mark: number;
  variant: "player" | "host";
}) {
  return (
    <p className={`time-warning time-warning--${variant}`} role="status">
      {formatClock(mark)} LEFT
    </p>
  );
}
```

- [ ] **Step 2: Add the CSS**

In `src/style.css`, insert between the `@keyframes reject-fade` block (which closes at line 2356) and the `/* ----- player: scoring */` section comment that follows it at line 2358:

```css
/* The round's time warnings. Shares .reject-banner's shape and reuses its
   `reject-fade` timing on purpose: the two are the same kind of object — a
   message that has to be read mid-round without being tappable. */
.time-warning {
  position: fixed;
  left: -20px;
  right: -20px;
  transform: rotate(-2.5deg);
  padding: 9px 20px 11px;
  background: var(--ink);
  color: var(--cream);
  font-family: var(--display);
  letter-spacing: 0.06em;
  text-align: center;
  z-index: 15;
  /* It sits over the list mid-round; it must never eat a tap. */
  pointer-events: none;
  animation: reject-fade 2s linear forwards;
}

/* High on the phone, never centre — .reject-banner owns the centre, and both
   can be on screen at the same moment. */
.time-warning--player {
  top: calc(var(--vv-top, 0px) + 96px);
  font-size: 15px;
}

/* The TV is read across a room, so this is the one that gets big. Absolute
   within .host-stage, which is already position: relative. */
.time-warning--host {
  position: absolute;
  top: 8%;
  left: -40px;
  right: -40px;
  font-size: clamp(28px, 3.4vw, 52px);
}
```

- [ ] **Step 3: Wire the phone**

In `src/screens/player/PlayerPlaying.tsx`, three edits.

First, extend the imports at the top:

```tsx
import { TimeWarning } from "../../components/TimeWarning";
import { useRoundWarning } from "../../roundwarnings";
```

Second, `TimerWheel` currently calls `useRemaining` itself. Lift that out so the screen has one clock rather than two intervals that can disagree by a tick. Replace the whole `TimerWheel` component (lines ~23-39) with:

```tsx
/**
 * A small pie in the corner, not the host's full timer bar with its numeral:
 * the round screen's job is getting words down, so the countdown is a glance,
 * not a second thing to read. A conic-gradient slice draws itself with no
 * SVG geometry to keep in sync with a ring's radius. Teal rather than a new
 * colour — the same fill the "OK," plaque and the host timer bar use.
 *
 * Takes `remaining` rather than reading the clock itself: the screen also
 * needs it for the time warnings, and two `useRemaining` calls would mean two
 * intervals that can land a tick apart.
 */
function TimerWheel({ remaining, durationSec, paused }: {
  remaining: number;
  durationSec: number;
  /** `RoomState.paused` — the wheel holds its slice rather than draining. */
  paused: number | null;
}) {
  const frac = durationSec > 0 ? Math.max(0, Math.min(1, remaining / durationSec)) : 0;
  return (
    <div
      className={`playing__timer${paused !== null ? " playing__timer--paused" : ""}`}
      style={{ "--frac": frac } as CSSProperties}
      aria-hidden="true"
    />
  );
}
```

Third, in `PlayerPlaying` itself, add these three lines directly after the existing `const emojiOf = ...` declaration:

```tsx
  // Narrowed once here rather than at each use: hooks cannot be called
  // conditionally, and the round screen renders under other phases briefly.
  const round = room.phase.name === "playing" ? room.phase : null;
  const remaining = useRemaining(round?.endsAt ?? 0, offset, room.paused);
  const warning = useRoundWarning(remaining, room.settings.durationSec, round?.endsAt ?? 0);
```

Then replace the `{room.phase.name === "playing" && (<TimerWheel ... />)}` block (lines ~68-75) with:

```tsx
      {round && (
        <TimerWheel
          remaining={remaining}
          durationSec={room.settings.durationSec}
          paused={room.paused}
        />
      )}
      {/* Keyed on the round and the mark together so each warning replays the
          fade from its first frame. A bare `mark` key would not remount
          across rounds, and the second round's warnings would never animate. */}
      {round && warning !== null && (
        <TimeWarning key={`${round.endsAt}-${warning}`} mark={warning} variant="player" />
      )}
```

- [ ] **Step 4: Wire the TV**

In `src/screens/host/HostPlaying.tsx`, extend the imports:

```tsx
import { TimeWarning } from "../../components/TimeWarning";
import { useRoundWarning } from "../../roundwarnings";
```

Add one line after the existing `const fill = ...` (line ~19):

```tsx
  const warning = useRoundWarning(remaining, room.settings.durationSec, endsAt);
```

Then render it inside the `<div className="host-stage">` — as the **last** child, after the `</ul>` closing the roster row, so it stacks above the stage content:

```tsx
        {warning !== null && (
          <TimeWarning key={`${endsAt}-${warning}`} mark={warning} variant="host" />
        )}
```

- [ ] **Step 5: Typecheck, build, and test**

Run: `npm run typecheck && npm run build && npm test`
Expected: all three clean; 616 tests.

Do **not** start a dev server or open a browser — the repo owner verifies UI personally.

- [ ] **Step 6: Commit**

```bash
git add src/components/TimeWarning.tsx src/style.css src/screens/player/PlayerPlaying.tsx src/screens/host/HostPlaying.tsx
git commit -m "feat: show the round's time warnings on the phone and the TV

One band, two anchors. It reuses .reject-banner's shape and its fade
timing because the two are the same kind of object, and sits high on the
phone rather than centre so a rejected entry and a warning can share the
screen without sharing pixels.

PlayerPlaying now owns the clock and passes `remaining` down to TimerWheel
— the screen needs it twice, and two useRemaining calls would be two
intervals landing a tick apart."
```

---

### Task 4: Invariant, version bump, verification

**Files:**
- Modify: `CLAUDE.md`
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Add the invariant**

In `CLAUDE.md`, add to the "Invariants — breaking these is a defect, not a style choice" list under "State flow":

```markdown
- **The round's time warnings are derived on every client, never broadcast.**
  `warningsFor` in `shared/roundwarnings.ts` turns the round length into its
  marks; each client counts to them off `phase.endsAt` and its own
  `clockOffset`, the same arrangement the round timer and the reveal schedule
  use. The TV and the phones warn together because they read one deadline off
  one clock, not because anything was sent. **The halfway mark is a candidate,
  not a member of the set** — it survives only when it clears the top of the
  tail by `WARNING_GAP_SEC`, and it must be checked *against* the tail rather
  than merged into it, or a 15-second round keeps half at 7 and discards the
  more urgent 10. Pause needs no code: marks are keyed to values of
  `remaining`, never to elapsed time, so a held clock crosses nothing.
```

Then add to the "## Docs" list, keeping its chronological ordering:

```markdown
- `docs/superpowers/specs/2026-07-31-round-time-warnings-design.md` — the round
  time warnings: how the mark set is derived from the round length, why nothing
  rides on the wire, and the three rules that make each mark fire exactly once.
  Implemented.
```

- [ ] **Step 2: Correct the test count**

`CLAUDE.md`'s "Commands" section annotates `npm test` with a count. It currently reads 604 and is wrong by two before you start — the entry-flush branch's own fix wave added tests after it was last set. Get the real number:

```bash
npm test 2>&1 | grep "Tests "
```

Use exactly what that prints. Do not guess and do not compute it — this number has now drifted three times on this branch, and this is the last commit that can change it.

- [ ] **Step 3: Bump the version**

`package.json`: `"version": "0.8.3",`

`package-lock.json` — **both** the top-level `version` (line 3) and the one nested under `packages: { "": ... }` (line 9).

Edit those two lines by hand rather than search-and-replacing. Checked at time of writing: `0.8.2` appears **exactly three times** across both files and no dependency happens to share it, so a blind replace would in fact be safe *this time*. It was not last time — the `0.8.1` bump had a fourth occurrence, `@cspotcode/source-map-support`, whose own version collided with the project's. Do it by hand and verify; the safety of the shortcut is a property of today's lockfile, not of the operation.

Verify:

```bash
grep -n '"version": "0.8.3"' package.json package-lock.json
```

Expected: exactly three lines — `package.json:3`, `package-lock.json:3`, `package-lock.json:9`.

- [ ] **Step 4: Full verification**

```bash
npm test && npm run typecheck && npm run build
```

Expected: all three clean.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md package.json package-lock.json
git commit -m "docs: record the time-warning invariant, bump to 0.8.3

Also lands the npm test count correctly for the first time this branch —
it has drifted three times, and this is the last commit that moves it."
```

- [ ] **Step 6: Hand back for the manual pass**

Do **not** push, open a PR, or start a dev server. Report that the branch is ready and that the manual smoke test belongs to the repo owner:

- `?p=1` as the TV, `?p=2` as a phone.
- A 30-second round: exactly one band, at ten seconds, on both screens.
- A 180-second round: four bands — `1:30`, `1:00`, `0:30`, `0:10`.
- Pause from the debug menu across a mark and confirm nothing fires while held.
- Submit a duplicate at ten seconds left on the phone and confirm the reject banner and the warning are both readable rather than overlapping.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| §1 the milestone set, the gap rule, the ordering trap | Task 1 |
| §2 derived, never broadcast | Task 2 (no wire code exists anywhere in the plan) |
| §3 rule 1, catch-up seeding with `>=` | Task 2 |
| §3 rule 2, most-urgent-crossed on a skip | Task 2 |
| §3 rule 3, nothing at `remaining <= 0` | Task 2 |
| §3 pause needs no code | Task 2 — `remaining` comes from `useRemaining`, which already freezes |
| §4 one component, two anchors | Task 3 |
| §4 phone anchored high, away from the reject banner | Task 3, `.time-warning--player` |
| §5 `formatClock` throughout | Task 3, the component |
| §6 failure table | Task 1 covers the duration rows; Task 2's three rules cover joiner, backgrounded tab, skip and pause; the reject-banner row is Task 3's anchor and Task 4's manual step |
| §7 tests | Task 1 |
| Verification | Task 4 steps 4 and 6 |
| Branch, version bump, test count | Task 4 |

**Placeholder scan:** none. Every code step carries its code. Task 2 has no test step, which is the `shared/**` glob constraint stated in Global Constraints, not an omission.

**Type consistency:** `warningsFor(durationSec: number): number[]` matches across Tasks 1 and 2. `useRoundWarning(remaining, durationSec, endsAt)` returns `number | null`, and both call sites in Task 3 guard on `!== null` before rendering. `TimeWarning`'s props are `{ mark: number; variant: "player" | "host" }`; both call sites pass `variant` from that union and `mark` from the hook's non-null branch. `TimerWheel`'s prop rename from `pausedMs` to `paused` is confined to Task 3 and its single call site is updated in the same step.

**One thing the implementer should not "fix":** a 61-second round warns at 60, one second in. That falls out of `s < durationSec` and is deliberate — adding a lead-in rule would cost a second threshold to reason about for a case nobody will notice.
