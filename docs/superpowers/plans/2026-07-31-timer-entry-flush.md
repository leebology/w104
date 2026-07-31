# Timer Entry Flush Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the round timer expires with text still in a player's input box, submit it for them if it is 5 or more characters.

**Architecture:** The half-typed text exists only in the browser, so the phone fires the flush when it learns the round ended — which is a round trip after the alarm that ended it. The server therefore accepts a flush through the `timesup` window (3s) and refuses it once `scoring` computes results. A new `flushEntry` in `shared/reduce.ts` owns both gates; the phone checks only that the box is non-empty.

**Tech Stack:** TypeScript, React 19, Vitest, Cloudflare Durable Objects (PartyServer).

**Spec:** `docs/superpowers/specs/2026-07-31-timer-entry-flush-design.md`

## Global Constraints

- **Node 22** (`.nvmrc`).
- **`npm run typecheck` runs two tsc projects** — `tsconfig.json` (src + shared, DOM libs) and `tsconfig.worker.json` (party + shared, workers-types). Everything in `shared/` must typecheck under **both**.
- **Tests live in `shared/**/*.test.ts` only.** That is the whole Vitest glob. Logic that needs a test belongs in `shared/`.
- **All game rules live in `shared/`.** `party/server.ts` is plumbing. A rule written inside the Durable Object is a defect.
- **Word lists never enter `RoomState`.** `toRoomState()` strips `entries`. Nothing in this plan may broadcast an entry or an entry count.
- **Commits stage explicit paths — never `git add -A`.** The untracked working notes `Project W-104.md` and `W104 Party Game Wireframes.zip` must stay untracked.
- **Every PR bumps the version in three places**, kept in sync: `package.json`, `package-lock.json` top-level `version`, and the one under `packages: { "": ... }`. Current: `0.8.1` → `0.8.2`.
- **`MIN_FLUSH_LEN` is 5, measured on the trimmed text as typed** — never on the `normalize()` form.
- Existing constants you will use, all in `shared/reduce.ts`: `TIMESUP_MS = 3_000`, `MAX_ENTRY_LEN = 64`, `MAX_ENTRIES = 200`.

---

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| `shared/reduce.ts` | Modify | `MIN_FLUSH_LEN`, `too-short` on `RejectReason`, new `flushEntry`, and `addEntry` extracted from `submitEntry` so both paths share one copy of the entry rules. |
| `shared/reduce.test.ts` | Modify | `describe("flushEntry")` — the phase window, the length floor, and proof the shared tail still runs. |
| `shared/protocol.ts` | Modify | One new `ClientMessage` member. |
| `party/server.ts` | Modify | One `onMessage` branch. No ack, no broadcast. |
| `src/net/room.ts` | Modify | `flush(text)` — fire-and-forget, no `seq`, no optimistic copy. |
| `src/screens/player/PlayerView.tsx` | Modify | Fire the flush in the existing leave-`playing` effect, reading the buffer from a ref. |
| `CLAUDE.md` | Modify | Record the `timesup` grace window as an invariant. |
| `package.json`, `package-lock.json` | Modify | Version bump. |

Task order matters: Task 1 is pure and testable alone, Task 2 exposes it over the wire, Task 3 fires it. Tasks 2 and 3 have no unit-test precedent in this repo (no transport or DOM tests exist) and are verified by typecheck, build, and the manual smoke test in Task 4.

---

### Task 1: `flushEntry` and the shared entry tail

**Files:**
- Modify: `shared/reduce.ts` (constants block ~line 30; `RejectReason` ~line 1251; `submitEntry` ~lines 1264–1304)
- Test: `shared/reduce.test.ts`

**Interfaces:**
- Consumes: existing `normalize` from `./scoring`, `rosterOf` from `./teams`, types `Room`, `PlayerId`, `Entry`, `SubmitResult`, `RejectReason`.
- Produces:
  - `export const MIN_FLUSH_LEN = 5`
  - `export function flushEntry(room: Room, playerId: PlayerId, text: string, now: number): SubmitResult`
  - `RejectReason` gains `"too-short"`
  - private `addEntry(room, playerId, trimmed: string, now): SubmitResult` — **not exported**, callers are `submitEntry` and `flushEntry` only.
  - `submitEntry`'s signature and behaviour are **unchanged**.

- [ ] **Step 1: Write the failing tests**

Add to `shared/reduce.test.ts`. Put this block immediately after the existing `describe("submitEntry", ...)` block.

First extend the import on line 4 to add `MIN_FLUSH_LEN` and `flushEntry`:

```ts
import { COUNTDOWN_MS, HOST_GRACE_MS, IDLE_REAP_MS, MAX_DURATION_SEC, MAX_ENTRIES, MAX_ENTRY_LEN, MAX_PLAYERS, MAX_ROUND_COUNT, MIN_DURATION_SEC, MIN_FLUSH_LEN, TIMESUP_MS, VOTING_MS, alarmOutcome, canEndGame, flushEntry, nextAlarmAt, reduce, submitEntry } from "./reduce";
```

Then the tests. `playing()` (line 168) yields a round at `now = 2000` ending at `42_000`; ticking it there lands `timesup`, which ends at `45_000`.

```ts
/** A room one tick past the whistle — the window a flush is written for. */
function timesUp(): Room {
  const room = playing();
  const endsAt = (room.phase as { endsAt: number }).endsAt;
  const next = reduce(room, { t: "tick", now: endsAt, roll: 0 });
  expect(next.phase.name).toBe("timesup");
  return next;
}

describe("flushEntry", () => {
  test("accepts the pending buffer during the round", () => {
    const result = flushEntry(playing(), "p0", "Adele", 10_000);
    expect(result.accepted).toBe(true);
    expect(result.room.entries.p0).toEqual([{ text: "Adele", at: 10_000, by: "p0" }]);
  });

  test("accepts a flush that lands during time's up", () => {
    const result = flushEntry(timesUp(), "p0", "Adele", 42_200);
    expect(result.accepted).toBe(true);
    expect(result.room.entries.p0).toEqual([{ text: "Adele", at: 42_200, by: "p0" }]);
  });

  test("refuses a flush once scoring has started", () => {
    const room = reduce(timesUp(), { t: "tick", now: 45_000, roll: 0 });
    expect(room.phase.name).toBe("scoring");
    expect(flushEntry(room, "p0", "Adele", 45_100)).toMatchObject({
      accepted: false, reason: "not-playing",
    });
  });

  test("refuses a flush outside a round entirely", () => {
    expect(flushEntry(seed(2), "p0", "Adele", 10_000)).toMatchObject({
      accepted: false, reason: "not-playing",
    });
  });

  test("refuses four characters and accepts five", () => {
    expect(flushEntry(playing(), "p0", "Adel", 10_000)).toMatchObject({
      accepted: false, reason: "too-short",
    });
    expect(flushEntry(playing(), "p0", "Adele", 10_000).accepted).toBe(true);
    expect(MIN_FLUSH_LEN).toBe(5);
  });

  test("the floor counts the trimmed text, not the normalized form", () => {
    // Five characters as typed. normalize() would leave "mr t" — four — so a
    // floor measured after normalizing would wrongly refuse this.
    expect(flushEntry(playing(), "p0", "Mr. T", 10_000).accepted).toBe(true);
    // Four either way.
    expect(flushEntry(playing(), "p0", "J.Lo", 10_000)).toMatchObject({
      accepted: false, reason: "too-short",
    });
  });

  test("counts the buffer after trimming, not before", () => {
    expect(flushEntry(playing(), "p0", "  Ada  ", 10_000)).toMatchObject({
      accepted: false, reason: "too-short",
    });
  });

  test("refuses a whitespace-only buffer", () => {
    expect(flushEntry(playing(), "p0", "        ", 10_000)).toMatchObject({
      accepted: false, reason: "too-short",
    });
  });

  test("refuses punctuation that clears the floor but normalizes to nothing", () => {
    // Five characters, so it passes MIN_FLUSH_LEN and is caught by the shared
    // tail instead. This is the test that proves the tail still runs.
    expect(flushEntry(playing(), "p0", "!!!!!", 10_000)).toMatchObject({
      accepted: false, reason: "empty",
    });
  });

  test("refuses a duplicate of the player's own word", () => {
    const room = submitEntry(playing(), "p0", "Adele", 10_000).room;
    expect(flushEntry(room, "p0", "adele", 10_100)).toMatchObject({
      accepted: false, reason: "duplicate",
    });
  });

  test("refuses a word over MAX_ENTRY_LEN", () => {
    const long = "a".repeat(MAX_ENTRY_LEN + 1);
    expect(flushEntry(playing(), "p0", long, 10_000)).toMatchObject({
      accepted: false, reason: "too-long",
    });
  });

  test("refuses once the scorer is at MAX_ENTRIES", () => {
    let room = playing();
    for (let i = 0; i < MAX_ENTRIES; i++) {
      room = submitEntry(room, "p0", `word${i}`, 10_000 + i).room;
    }
    expect(flushEntry(room, "p0", "Adele", 20_000)).toMatchObject({
      accepted: false, reason: "limit",
    });
  });

  test("every refusal returns the room it was given", () => {
    const room = playing();
    const refused = ["Adel", "        ", "!!!!!", "a".repeat(MAX_ENTRY_LEN + 1)];
    for (const text of refused) {
      expect(flushEntry(room, "p0", text, 10_000).room).toBe(room);
    }
  });

  test("refuses a duplicate of a teammate's word", () => {
    const room = submitEntry(playingInTeams(), "p0", "Adele", 10_000).room;
    expect(flushEntry(room, "p1", "adele", 10_100)).toMatchObject({
      accepted: false, reason: "duplicate",
    });
  });
});
```

**Note on the last test:** `playingInTeams()` is defined at line ~1569, *below* the `submitEntry` describe block. Function declarations hoist, so calling it from a block placed higher in the file works. If you would rather not rely on that, move this one test into the existing `describe("submitEntry with a shared team list", ...)` block at line ~1582 instead.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run shared/reduce.test.ts -t "flushEntry"`

Expected: FAIL. The import of `flushEntry` and `MIN_FLUSH_LEN` does not resolve, so the file fails to load — every test in it errors, not just the new ones. That is the expected shape of this failure.

- [ ] **Step 3: Add the constant and the reason**

In `shared/reduce.ts`, beside `MAX_ENTRY_LEN` (~line 30):

```ts
export const MAX_ENTRY_LEN = 64;
export const MAX_ENTRIES = 200;
/**
 * The floor for a word submitted *for* a player when the round timer catches
 * them mid-type. Five is where `allowedEdits` already stops offering typo
 * tolerance — below it an entry is too short to guess at — so the flush uses
 * the line the scoring already draws. Counted on the trimmed text as typed,
 * never on the `normalize()` form: "Mr. T" is five characters and flushes.
 */
export const MIN_FLUSH_LEN = 5;
```

Then extend `RejectReason` (~line 1251):

```ts
export type RejectReason =
  | "not-playing" | "empty" | "too-long" | "duplicate" | "limit" | "too-short";
```

- [ ] **Step 4: Extract the shared tail out of `submitEntry`**

Replace the body of `submitEntry` (~lines 1264–1304) with the following. The rules are byte-for-byte the ones that were there — only their *home* changes.

```ts
/**
 * Everything an entry must satisfy once a phase gate has let it through.
 * Shared by `submitEntry` and `flushEntry` so the two paths cannot drift: a
 * duplicate check that applied on one and not the other is exactly the gap two
 * copies of these rules would open.
 */
function addEntry(
  room: Room,
  playerId: PlayerId,
  trimmed: string,
  now: number,
): SubmitResult {
  if (trimmed.length > MAX_ENTRY_LEN) {
    return { room, accepted: false, reason: "too-long" };
  }

  const norm = normalize(trimmed);
  // Punctuation-only survives trim() but normalizes to nothing.
  if (norm === "") return { room, accepted: false, reason: "empty" };

  // The list this entry competes against is the *scorer's*, not the player's:
  // with teams on that is the whole team's merged list, so a word a teammate
  // already wrote is a duplicate and MAX_ENTRIES is a per-team cap. Storage is
  // unchanged — the entry still goes under its own author's key.
  const scorer = rosterOf(room).find((s) => s.members.includes(playerId));
  const own = (scorer?.members ?? [playerId]).flatMap((id) => room.entries[id] ?? []);
  if (own.length >= MAX_ENTRIES) return { room, accepted: false, reason: "limit" };
  if (own.some((e) => normalize(e.text) === norm)) {
    return { room, accepted: false, reason: "duplicate" };
  }

  const mine = room.entries[playerId] ?? [];
  const entry: Entry = { text: trimmed, at: now, by: playerId };
  return {
    room: {
      ...room,
      entries: { ...room.entries, [playerId]: [...mine, entry] },
      lastActivityAt: now,
    },
    accepted: true,
  };
}

/**
 * Kept out of `reduce` because it is the only mutation that touches the
 * server-only entries map, and it is the only one that answers back.
 */
export function submitEntry(
  room: Room,
  playerId: PlayerId,
  text: string,
  now: number,
): SubmitResult {
  if (room.phase.name !== "playing") {
    return { room, accepted: false, reason: "not-playing" };
  }
  const trimmed = text.trim();
  if (trimmed === "") return { room, accepted: false, reason: "empty" };
  return addEntry(room, playerId, trimmed, now);
}

/**
 * The buffer a player still had in the box when the round ended, submitted for
 * them. Separate from `submitEntry` rather than a flag on it, so that being
 * accepted late never becomes something an ordinary submit can ask for.
 *
 * **The window is `timesup`.** The phone cannot fire this until it learns the
 * round is over, which is a round trip after the alarm that ended it — gated on
 * `playing` alone it would refuse every flush it exists for. `timesup` closes
 * at the tick that computes `Results`, so that boundary is the honest one:
 * past it the scores exist and the word is genuinely too late.
 *
 * `at` is `now` and is deliberately not clamped back to the deadline. A flushed
 * word sorts last in the team merge and last in the reveal because it was.
 */
export function flushEntry(
  room: Room,
  playerId: PlayerId,
  text: string,
  now: number,
): SubmitResult {
  if (room.phase.name !== "playing" && room.phase.name !== "timesup") {
    return { room, accepted: false, reason: "not-playing" };
  }
  const trimmed = text.trim();
  if (trimmed.length < MIN_FLUSH_LEN) {
    return { room, accepted: false, reason: "too-short" };
  }
  return addEntry(room, playerId, trimmed, now);
}
```

- [ ] **Step 5: Run the new tests**

Run: `npx vitest run shared/reduce.test.ts -t "flushEntry"`
Expected: PASS, 14 tests.

- [ ] **Step 6: Run the whole suite — this is the regression gate for the extraction**

Run: `npm test`
Expected: PASS. The pre-existing count is **590**; you are adding 14, so expect **604**. Every `submitEntry` test must still pass untouched — they are what proves the tail moved without changing.

- [ ] **Step 7: Typecheck both projects**

Run: `npm run typecheck`
Expected: clean. `shared/reduce.ts` compiles under `tsconfig.json` *and* `tsconfig.worker.json`; `RejectReason` is re-exported through `shared/protocol.ts`, so a mistake here surfaces on the worker side too.

- [ ] **Step 8: Commit**

```bash
git add shared/reduce.ts shared/reduce.test.ts
git commit -m "feat: flushEntry — accept a half-typed word through time's up

The phone cannot fire a flush until it learns the round ended, which is a
round trip after the alarm that ended it. Gate it on playing *or* timesup:
that window closes at the tick computing Results, so past it the scores
exist and the word is genuinely too late.

MIN_FLUSH_LEN is 5, counted on the trimmed text as typed — the line
allowedEdits already draws, below which an entry is too short to guess at.

The entry rules submitEntry and flushEntry share are extracted into
addEntry rather than copied, so a duplicate check cannot come to apply on
one path and not the other."
```

---

### Task 2: Carry it over the wire

**Files:**
- Modify: `shared/protocol.ts` (`ClientMessage` union, ~line 19)
- Modify: `party/server.ts` (import ~line 4; `onMessage`, after the `submitEntry` block that ends ~line 423)

**Interfaces:**
- Consumes: `flushEntry` from Task 1.
- Produces: `ClientMessage` member `{ type: "flushEntry"; text: string }`, which Task 3 sends.

- [ ] **Step 1: Add the message**

In `shared/protocol.ts`, directly under the `submitEntry` member (~line 19):

```ts
  | { type: "submitEntry"; text: string; seq: number }
  /**
   * The buffer left in the box when the round ended. No `seq`, and answered by
   * no `entryAck`: the optimistic path exists because a 30-second round cannot
   * wait on a round trip, and a flush has nothing left to wait for.
   */
  | { type: "flushEntry"; text: string }
```

- [ ] **Step 2: Handle it on the server**

In `party/server.ts`, extend the import on line 4:

```ts
  alarmOutcome, canEndGame, flushEntry, nextAlarmAt, reduce, submitEntry, MAX_PLAYERS,
```

Then add this branch in `onMessage`, immediately after the `submitEntry` block's closing brace (~line 423):

```ts
    if (msg.type === "flushEntry") {
      const result = flushEntry(this.room, playerId, msg.text, now);
      this.room = result.room;
      // Silent on refusal — no ack to send it in, and no banner to render it.
      // The reject banner only draws while `playing`, and scolding somebody
      // over a word they did not choose to submit is worse than dropping it.
      if (!result.accepted) return;
      // Same ordering rule as an accepted submit: teammates share one list and
      // must see the word land. `sendTo`, never `broadcast`.
      this.sendEntriesToTeam(playerId);
      await this.persist();
      return; // Still no broadcast: entry counts are not published.
    }
```

- [ ] **Step 3: Typecheck both projects**

Run: `npm run typecheck`
Expected: clean. This is the real gate for this task — `party/server.ts` only compiles under `tsconfig.worker.json`, so a single-project check would miss a break here entirely.

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS, 604. No test touches `party/`, so this is confirming you broke nothing, not proving the branch works.

- [ ] **Step 5: Commit**

```bash
git add shared/protocol.ts party/server.ts
git commit -m "feat: accept flushEntry over the socket

No entryAck and no broadcast. The accepted path reuses sendEntriesToTeam
so a teammate sees the rescued word land on the shared list; a refusal is
silent, because the reject banner only draws while playing and there is
nothing useful to say about a word the player did not submit by hand."
```

---

### Task 3: Fire it from the phone

**Files:**
- Modify: `src/net/room.ts` (after `submit`, ~lines 193–205)
- Modify: `src/screens/player/PlayerView.tsx` (~lines 19–31)

**Interfaces:**
- Consumes: the `flushEntry` `ClientMessage` from Task 2.
- Produces: `roomStore.flush(text: string): void`.

- [ ] **Step 1: Add `flush` to the store**

In `src/net/room.ts`, directly after the `submit` method (which ends ~line 205):

```ts
  /**
   * The buffer still in the box when the round ended. Fire-and-forget: no
   * `seq` and no optimistic copy, unlike `submit`. Nothing renders `entries`
   * once `playing` is over — `PlayerScoring` reads `room.phase.results` — so
   * an optimistic copy would only sit unacked in client state until the
   * standings transition swept it up.
   *
   * Length, phase and every other entry rule are the server's. This end knows
   * only that the box was not empty.
   */
  flush(text: string): void {
    if (text.trim() === "") return;
    this.send({ type: "flushEntry", text });
  }
```

- [ ] **Step 2: Mirror the pending text into a ref**

In `src/screens/player/PlayerView.tsx`, after the `input` ref (~line 20):

```ts
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  // Mirrors `text` so the effect below can read the pending buffer without
  // listing it as a dependency. With `text` in the deps that effect re-runs on
  // every keystroke — and worse, its own setText("") re-triggers it with an
  // empty box, so the flush would race its own cleanup.
  const pending = useRef("");
  pending.current = text;
```

- [ ] **Step 3: Flush in the existing leave-`playing` effect**

Replace the effect at ~lines 27–31. The existing comment stays; the flush goes in ahead of the clear it explains.

```ts
  // This input outlives the round it was typed in, so anything left over
  // when the round ends (timesup, scoring, back to lobby) must not bleed
  // into the next one. Blurring is part of that cleanup: the input only moves
  // offstage with CSS, so without this it keeps focus — and the keyboard stays
  // up over the results the player is trying to read.
  //
  // Anything still in the box is submitted on the way out, before the clear.
  // Firing on the phase push rather than on a local deadline is deliberate:
  // the phone never has to guess when the round ended, it is told, so a skewed
  // device clock cannot fire this early. Everything about whether it counts is
  // the server's call — including the phase it lands in, which is why a host
  // `debugSkip` needs no special case here and a `backToLobby` needs no guard.
  useEffect(() => {
    if (playing) return;
    roomStore.flush(pending.current);
    setText("");
    input.current?.blur();
  }, [playing]);
```

This effect also runs once on mount with `playing` false. `pending.current` is `""` there, and `flush` drops an empty buffer, so the mount pass is a no-op.

- [ ] **Step 4: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both clean.

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS, 604. `src/` has no test coverage in this repo — the glob is `shared/**` only — so this confirms nothing regressed rather than proving the effect fires. Task 4's manual pass is what proves that.

- [ ] **Step 6: Commit**

```bash
git add src/net/room.ts src/screens/player/PlayerView.tsx
git commit -m "feat: submit the pending buffer when the round ends

Fires in the effect that already clears the box on leaving playing, so
the phone reacts to being told the round is over rather than counting
down to it — a skewed device clock cannot fire it early.

Reads the buffer from a ref, not the dep array: with text as a dependency
the effect re-runs per keystroke and its own setText('') re-triggers it
with an empty box."
```

---

### Task 4: Document the invariant, bump the version, smoke test

**Files:**
- Modify: `CLAUDE.md` (the "Invariants" list under "State flow", and the Docs list)
- Modify: `package.json`, `package-lock.json`

**Interfaces:**
- Consumes: everything above. Produces nothing code-facing.

- [ ] **Step 1: Add the invariant**

In `CLAUDE.md`, add to the "Invariants — breaking these is a defect, not a style choice" list:

```markdown
- **A half-typed word is flushed at the whistle, and its window is `timesup`.**
  The text exists only in the browser, so the phone fires `flushEntry` on
  learning the round ended — a round trip after the alarm that ended it, which
  is why `flushEntry` accepts in `playing` *or* `timesup` where `submitEntry`
  accepts only `playing`. The window closes at the tick that computes
  `Results`; past it the scores exist. `MIN_FLUSH_LEN` is counted on the
  trimmed text as typed, never on the `normalize()` form. Both functions share
  `addEntry` for every other rule, so the duplicate, `MAX_ENTRIES` and
  team-merge checks cannot come to apply on one path and not the other.
  A flushed fragment that outscores the finished word is a known, accepted
  consequence — see §1 of the design.
```

Then add to the Docs list:

```markdown
- `docs/superpowers/specs/2026-07-31-timer-entry-flush-design.md` — flushing a
  half-typed entry when the round timer expires: the 5-character floor, the
  `timesup` grace window, and why the buffer is not staged on the server.
  Implemented.
```

- [ ] **Step 2: Update the test count in CLAUDE.md**

Under "Commands", `npm test` is annotated with a test count. It currently reads 564 and is already stale against staging's 590. Set it to the real number:

```bash
npm test 2>&1 | grep "Tests "
```

Use exactly what that prints. Do not guess — a recent commit on another branch exists solely to fix this number drifting.

- [ ] **Step 3: Bump the version in all three places**

`package.json`:

```json
  "version": "0.8.2",
```

`package-lock.json` — **both** the top-level `version` (line 3) and the one nested under `packages: { "": ... }` (line 9):

```json
  "version": "0.8.2",
```

**Do not search-and-replace `0.8.1` across the lockfile.** There is a fourth occurrence around line 63 — `node_modules/@cspotcode/source-map-support` is itself at version `0.8.1`. It is an unrelated dependency and must stay where it is. Edit lines 3 and 9 by hand.

Verify:

```bash
grep -n '"version": "0.8.2"' package.json package-lock.json
```

Expected: exactly three lines — `package.json:3`, `package-lock.json:3`, `package-lock.json:9`. If you see a fourth, you bumped the dependency; revert that one.

- [ ] **Step 4: Full verification**

```bash
npm test && npm run typecheck && npm run build
```

Expected: all three clean.

- [ ] **Step 5: Manual smoke test**

Two terminals:

```bash
npm run dev:party
```

```bash
npm run dev
```

Open `?p=1` (creates the lobby, is the TV), `?p=2` and `?p=3` (join with the code). Set a short round from the Game settings drawer. Then:

1. On `?p=2`, type `Adele` and **do not press Enter**. Let the timer expire. The word appears in that player's list on the results screen.
2. Repeat with `Adel` (four characters). It does not appear.
3. Repeat with `Mr. T`. It appears — this is the trimmed-not-normalized floor.
4. With Team Count on and `?p=2` and `?p=3` on the same team: have `?p=3` submit `Adele` by hand, then have `?p=2` hold `adele` in the box at the whistle. It is dropped as a duplicate, silently, with no banner over the results.
5. Start a round, type five characters, and have the host press the debug menu's **skip**. The word lands — skip moves the deadline, so the round ends down the ordinary path.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md package.json package-lock.json
git commit -m "docs: record the flush window invariant, bump to 0.8.2

Also corrects the npm test count, which was stale against staging before
this branch added to it."
```

- [ ] **Step 7: Open the PR**

```bash
git push -u origin timer-improvements
```

Base the PR on `staging`, not `main` — `party/server.ts` changed, and merging to `staging` is what deploys the Worker phones are tested against. CI runs typecheck, tests and build on PRs into either long-lived branch.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| §1 floor is 5, trimmed not normalized | Task 1 (`MIN_FLUSH_LEN`, two dedicated tests) |
| §1 fragments accepted, no scoring change | Covered by omission — no task touches `shared/scoring.ts` |
| §2 grace window is `timesup` | Task 1 (phase gate + three phase tests) |
| §2 buffer not staged server-side | Covered by omission — no task adds transient state |
| §3 the wire, no seq/ack/optimistic | Tasks 2 and 3 |
| §4 `flushEntry` + shared tail + `at` unclamped | Task 1 |
| §5 client seam, ref not dep array | Task 3 |
| §6 failure table | Task 1 tests cover the length, duplicate, limit, too-long and phase rows; the pause/skip/jump/disconnect rows fall out of the phase gate and are checked manually in Task 4 step 5 |
| §7 tests | Task 1 |
| Verification | Task 4 steps 4–5 |
| Branch & PR, version bump | Task 4 steps 3, 7 |

**Placeholder scan:** none — every code step carries the actual code, and the two "covered by omission" rows are deliberate non-goals from the spec rather than gaps.

**Type consistency:** `flushEntry(room, playerId, text, now)` matches across Tasks 1, 2 and the test block. `addEntry(room, playerId, trimmed, now)` takes an already-trimmed string in every call site. `roomStore.flush(text)` matches `pending.current` usage in Task 3. `{ type: "flushEntry"; text: string }` has no `seq` in the protocol, the store, or the server handler.

**One thing the implementer should not fix:** Task 1 Step 2 expects the *whole test file* to fail, not just the new tests. That is correct — an unresolved import fails the module load.
