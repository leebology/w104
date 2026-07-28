# Gamemode & Settings Drawers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the host lobby's round-count/timer Steppers into two edge drawers, driven by a declarative gamemode catalog, so adding gamemode #2 is a data change.

**Architecture:** A new `shared/gamemodes.ts` owns the mode list and, per mode, an array of `SettingSpec` descriptors (key/label/kind/min/max/default). `MatchSettings` gains `mode`. `reduce` validates settings against the *active mode's* descriptors instead of hand-written constants. A new `Room.configuring` boolean holds the start countdown while a drawer is open — opening drops the phase back to `lobby` **without touching readiness**, so closing lets the existing `settle` derive a fresh countdown by itself.

**Tech Stack:** TypeScript, React 18, Vitest, PartyServer on Cloudflare Durable Objects.

**Spec:** `docs/superpowers/specs/2026-07-27-gamemode-drawers-design.md`

## Global Constraints

- **All game rules live in `shared/`.** `party/server.ts` is plumbing only — persist, broadcast, schedule alarms. Never put a rule in the Durable Object.
- **`reduce` no-ops must return the identical object.** `party/server.ts` and `settle` both rely on the `next === room` identity check. Never return a fresh object for a no-op.
- **Tests live only in `shared/`.** `npm test` runs `shared/**/*.test.ts` and nothing else. Do not write tests for `src/` or `party/`.
- **Two tsc projects must both pass.** `npm run typecheck` runs `tsconfig.json` (src + shared, DOM libs) *and* `tsconfig.worker.json` (party + shared, workers-types). Any `shared/` change must pass under both.
- **Anything persisted must survive JSON.** New `Room` fields need a defaulting fallback in `party/server.ts`'s `load()`, because `storage.get<Room>` is an unchecked cast over older stored rooms.
- **No loose hex values in `src/style.css`.** Every colour and shape is a `var(--token)`. Verify with the grep in Task 6.
- **Commits stage explicit paths.** Never `git add -A` — the untracked working note `Project W-104.md` must stay untracked.
- **Commit message trailer** on every commit: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- **Do not run the dev server or a browser.** Verification is `npm test`, `npm run typecheck`, `npm run build` only. The author performs live testing.
- Existing test style: `import { describe, expect, test } from "vitest";` — the repo uses `test`, not `it`.

## File Structure

| File | Responsibility |
|---|---|
| `shared/gamemodes.ts` *(new)* | The catalog: mode ids, setting descriptors, numeric bounds, lookup helpers |
| `shared/gamemodes.test.ts` *(new)* | Catalog invariants |
| `shared/state.ts` | `MatchSettings.mode`, `Room.configuring`, `createRoom` |
| `shared/reduce.ts` | `setMode`, reworked `setSettings`, `setConfiguring`, the countdown hold |
| `shared/protocol.ts` | Three wire message changes |
| `party/server.ts` | `load()` fallbacks, message routing |
| `src/components/Drawer.tsx` *(new)* | Generic edge-panel overlay |
| `src/components/Stepper.tsx` | `stepperPropsForKind` |
| `src/screens/host/GameModesDrawer.tsx` *(new)* | Mode list |
| `src/screens/host/GameSettingsDrawer.tsx` *(new)* | Descriptor-driven Steppers |
| `src/screens/host/HostLobby.tsx` | Drawer buttons + open state + `setConfiguring` |
| `src/screens/player/PlayerLobby.tsx` | Mode name, "adjusting settings" hint |
| `src/style.css` | Drawer + button + mode-row rules |

---

### Task 1: The gamemode catalog

**Files:**
- Create: `shared/gamemodes.ts`
- Create: `shared/gamemodes.test.ts`
- Modify: `shared/state.ts` (`MatchSettings`, imports, `createRoom`)
- Modify: `shared/reduce.ts:29-33` (bounds move out, re-export in)

**Interfaces:**
- Consumes: `MatchSettings` from `shared/state.ts`, `DEFAULT_DURATION_SEC` / `DEFAULT_ROUND_COUNT` from `shared/categories.ts`
- Produces: `GAME_MODE_IDS`, `GameModeId`, `DEFAULT_MODE`, `SettingKind`, `NumericSettingKey`, `SettingSpec`, `GameMode`, `GAME_MODES`, `isGameModeId(v): v is GameModeId`, `modeSpec(id: string): GameMode`, `defaultSettings(id: GameModeId): MatchSettings`, and the four bounds `MIN_ROUND_COUNT` / `MAX_ROUND_COUNT` / `MIN_DURATION_SEC` / `MAX_DURATION_SEC` (still re-exported from `shared/reduce.ts`)

- [ ] **Step 1: Create `shared/gamemodes.ts`**

```ts
import { DEFAULT_DURATION_SEC, DEFAULT_ROUND_COUNT } from "./categories";
import type { MatchSettings } from "./state";

/**
 * The bounds live here rather than in `reduce.ts` because the descriptors
 * below are the only thing that should be quoting them — `reduce` now
 * validates against a mode's descriptors, not against loose constants.
 * `reduce.ts` re-exports all four so every existing import site keeps working.
 */
export const MIN_ROUND_COUNT = 1;
export const MAX_ROUND_COUNT = 10;
/** 15 seconds to 10 minutes. */
export const MIN_DURATION_SEC = 15;
export const MAX_DURATION_SEC = 600;

export const GAME_MODE_IDS = ["ffa"] as const;
export type GameModeId = (typeof GAME_MODE_IDS)[number];
export const DEFAULT_MODE: GameModeId = "ffa";

/**
 * Which Stepper behaviour a numeric setting gets. This union is the seam a
 * future toggle or select setting extends; today every setting is a number.
 */
export type SettingKind = "count" | "duration";

/**
 * The numeric fields of `MatchSettings` a descriptor is allowed to drive.
 * Hand-written rather than `keyof MatchSettings` so that `gamemodes.ts` needs
 * only a *type* import from `state.ts` — `state.ts` imports values from here,
 * and a runtime cycle would be a real problem. `gamemodes.test.ts` asserts the
 * two stay in agreement.
 */
export type NumericSettingKey = "roundCount" | "durationSec";

export type SettingSpec = {
  key: NumericSettingKey;
  /** Rendered on the Stepper. Uppercase, matching the rest of the UI. */
  label: string;
  kind: SettingKind;
  min: number;
  max: number;
  default: number;
};

export type GameMode = {
  id: GameModeId;
  name: string;
  /** One line under the name in the modes drawer. */
  blurb: string;
  /** Exactly the settings this mode exposes. Order is render order. */
  settings: readonly SettingSpec[];
};

export const GAME_MODES: Record<GameModeId, GameMode> = {
  ffa: {
    id: "ffa",
    name: "Free-for-All",
    blurb: "Race to list items in a category. A word scores only if nobody else wrote it.",
    settings: [
      {
        key: "roundCount",
        label: "ROUNDS",
        kind: "count",
        min: MIN_ROUND_COUNT,
        max: MAX_ROUND_COUNT,
        default: DEFAULT_ROUND_COUNT,
      },
      {
        key: "durationSec",
        label: "TIMER",
        kind: "duration",
        min: MIN_DURATION_SEC,
        max: MAX_DURATION_SEC,
        default: DEFAULT_DURATION_SEC,
      },
    ],
  },
};

export function isGameModeId(value: unknown): value is GameModeId {
  return (
    typeof value === "string" && (GAME_MODE_IDS as readonly string[]).includes(value)
  );
}

/**
 * Never throws and never returns undefined: an unknown id comes off disk (a
 * room stored before a mode was renamed) or off the wire (a hand-rolled
 * message), and every caller would otherwise have to null-check.
 */
export function modeSpec(id: string): GameMode {
  return isGameModeId(id) ? GAME_MODES[id] : GAME_MODES[DEFAULT_MODE];
}

/** A fresh settings bag for the given mode, every exposed key at its default. */
export function defaultSettings(id: GameModeId): MatchSettings {
  const settings: MatchSettings = {
    mode: id,
    roundCount: DEFAULT_ROUND_COUNT,
    durationSec: DEFAULT_DURATION_SEC,
  };
  for (const spec of GAME_MODES[id].settings) settings[spec.key] = spec.default;
  return settings;
}
```

- [ ] **Step 2: Add `mode` to `MatchSettings` in `shared/state.ts`**

Replace the `MatchSettings` type (currently lines 12-17) with:

```ts
export type MatchSettings = {
  /** Which gamemode this match plays. See shared/gamemodes.ts. */
  mode: GameModeId;
  /** 1..MAX_ROUND_COUNT. How many rounds this match runs. */
  roundCount: number;
  /** MIN_DURATION_SEC..MAX_DURATION_SEC. Seconds of typing per round. */
  durationSec: number;
};
```

Change the imports at the top of `shared/state.ts`. `DEFAULT_DURATION_SEC` and `DEFAULT_ROUND_COUNT` are no longer used here (`defaultSettings` supplies them), so drop them:

```ts
import type { Results } from "./scoring";
import { DEFAULT_CATEGORY } from "./categories";
import { DEFAULT_MODE, defaultSettings } from "./gamemodes";
import type { GameModeId } from "./gamemodes";
import type { VoteMap } from "./voting";
```

In `createRoom`, replace the inline `settings: { roundCount: ..., durationSec: ... }` object with:

```ts
    settings: defaultSettings(DEFAULT_MODE),
```

- [ ] **Step 3: Move the bounds out of `shared/reduce.ts`**

Delete these four declarations (currently lines 29-33):

```ts
export const MIN_ROUND_COUNT = 1;
export const MAX_ROUND_COUNT = 10;
/** 15 seconds to 10 minutes. */
export const MIN_DURATION_SEC = 15;
export const MAX_DURATION_SEC = 600;
```

Replace them with this, in the same spot:

```ts
/**
 * Re-exported, not re-declared: the bounds now live beside the descriptors
 * that quote them in `shared/gamemodes.ts`. Every existing import site and
 * test keeps working, and the dependency runs one way only.
 */
export {
  MAX_DURATION_SEC, MAX_ROUND_COUNT, MIN_DURATION_SEC, MIN_ROUND_COUNT,
} from "./gamemodes";
```

Then add an *import* of the same four at the top of `shared/reduce.ts`, because `setSettings` still references them locally until Task 2 (a re-export does not bring them into scope). Extend the existing `./categories` import line region:

```ts
import {
  MAX_DURATION_SEC, MAX_ROUND_COUNT, MIN_DURATION_SEC, MIN_ROUND_COUNT,
} from "./gamemodes";
```

- [ ] **Step 4: Write `shared/gamemodes.test.ts`**

```ts
import { describe, expect, test } from "vitest";
import {
  DEFAULT_MODE, GAME_MODES, GAME_MODE_IDS, defaultSettings, isGameModeId, modeSpec,
} from "./gamemodes";
import { MAX_DURATION_SEC, MAX_ROUND_COUNT, MIN_DURATION_SEC, MIN_ROUND_COUNT } from "./reduce";
import { createRoom } from "./state";

const ALL_MODES = Object.values(GAME_MODES);

describe("the catalog", () => {
  test("DEFAULT_MODE is a real mode", () => {
    expect(GAME_MODE_IDS).toContain(DEFAULT_MODE);
    expect(GAME_MODES[DEFAULT_MODE]).toBeDefined();
  });

  test("every mode is keyed by its own id", () => {
    for (const id of GAME_MODE_IDS) expect(GAME_MODES[id].id).toBe(id);
  });

  test("every spec's default sits inside its own bounds", () => {
    for (const mode of ALL_MODES) {
      for (const spec of mode.settings) {
        expect(spec.min).toBeLessThan(spec.max);
        expect(spec.default).toBeGreaterThanOrEqual(spec.min);
        expect(spec.default).toBeLessThanOrEqual(spec.max);
      }
    }
  });

  test("no mode declares the same key twice", () => {
    for (const mode of ALL_MODES) {
      const keys = mode.settings.map((s) => s.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  // Guards the hand-written NumericSettingKey union against drift: a key that
  // stops naming a numeric MatchSettings field fails here rather than silently
  // becoming a setting nothing reads.
  test("every spec key names a numeric field of MatchSettings", () => {
    const sample = createRoom("PLUM", 0).settings;
    for (const mode of ALL_MODES) {
      for (const spec of mode.settings) {
        expect(typeof sample[spec.key]).toBe("number");
      }
    }
  });

  test("FFA's descriptors quote the exported bounds", () => {
    const rounds = GAME_MODES.ffa.settings.find((s) => s.key === "roundCount");
    const timer = GAME_MODES.ffa.settings.find((s) => s.key === "durationSec");
    expect(rounds).toMatchObject({ min: MIN_ROUND_COUNT, max: MAX_ROUND_COUNT, kind: "count" });
    expect(timer).toMatchObject({ min: MIN_DURATION_SEC, max: MAX_DURATION_SEC, kind: "duration" });
  });
});

describe("lookups", () => {
  test("isGameModeId rejects anything not in the pool", () => {
    expect(isGameModeId("ffa")).toBe(true);
    expect(isGameModeId("teams")).toBe(false);
    expect(isGameModeId(7)).toBe(false);
    expect(isGameModeId(undefined)).toBe(false);
  });

  test("modeSpec falls back to the default mode for an unknown id", () => {
    expect(modeSpec("ffa").id).toBe("ffa");
    expect(modeSpec("nonsense").id).toBe(DEFAULT_MODE);
  });

  test("defaultSettings puts every exposed key at its default", () => {
    const settings = defaultSettings("ffa");
    expect(settings.mode).toBe("ffa");
    for (const spec of GAME_MODES.ffa.settings) {
      expect(settings[spec.key]).toBe(spec.default);
    }
  });
});

describe("a new room", () => {
  test("starts on the default mode", () => {
    expect(createRoom("PLUM", 0).settings.mode).toBe(DEFAULT_MODE);
  });
});
```

- [ ] **Step 5: Run the tests**

```bash
npm test
```

Expected: PASS, all files. The existing 184 tests plus the new `gamemodes.test.ts` cases.

- [ ] **Step 6: Typecheck both projects**

```bash
npm run typecheck
```

Expected: no output, exit 0. If `tsconfig.worker.json` complains about an unused import in `shared/state.ts`, remove the leftover `DEFAULT_DURATION_SEC` / `DEFAULT_ROUND_COUNT` import.

- [ ] **Step 7: Commit**

```bash
git add shared/gamemodes.ts shared/gamemodes.test.ts shared/state.ts shared/reduce.ts && git commit -m "feat: add the gamemode catalog

Setting bounds move beside the descriptors that quote them; reduce.ts
re-exports them so no import site changes. MatchSettings gains \`mode\`.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `setMode` and descriptor-driven `setSettings`

**Files:**
- Modify: `shared/reduce.ts` (event union, `apply` cases, two new helpers)
- Modify: `shared/protocol.ts:11` (`setSettings` shape, new `setMode`)
- Modify: `party/server.ts:267-275` (routing)
- Modify: `src/screens/host/HostLobby.tsx:67,77` (call sites)
- Test: `shared/reduce.test.ts`

**Interfaces:**
- Consumes: `modeSpec`, `isGameModeId`, `NumericSettingKey` from Task 1
- Produces: `RoomEvent` variants `{ t: "setSettings"; playerId; values: Partial<Record<NumericSettingKey, number>>; now }` and `{ t: "setMode"; playerId; mode: string; now }`; `ClientMessage` variants `{ type: "setSettings"; values: Partial<Record<NumericSettingKey, number>> }` and `{ type: "setMode"; mode: string }`

- [ ] **Step 1: Write the failing tests**

Append to `shared/reduce.test.ts`:

```ts
describe("settings", () => {
  test("the host sets a value the active mode exposes", () => {
    let room = seed(2);
    room = reduce(room, { t: "setSettings", playerId: "host", values: { roundCount: 5 }, now: 2000 });
    expect(room.settings.roundCount).toBe(5);
  });

  test("a value out of the descriptor's range is clamped", () => {
    let room = seed(2);
    room = reduce(room, {
      t: "setSettings", playerId: "host", values: { durationSec: 99_999 }, now: 2000,
    });
    expect(room.settings.durationSec).toBe(MAX_DURATION_SEC);
  });

  test("a non-finite value leaves the setting alone", () => {
    const before = seed(2);
    const room = reduce(before, {
      t: "setSettings", playerId: "host", values: { durationSec: Number.NaN }, now: 2000,
    });
    expect(room.settings.durationSec).toBe(before.settings.durationSec);
  });

  test("a player cannot change settings", () => {
    const before = seed(2);
    const room = reduce(before, {
      t: "setSettings", playerId: "p0", values: { roundCount: 9 }, now: 2000,
    });
    expect(room).toBe(before);
  });

  test("settings are locked once the match leaves the lobby", () => {
    let room = readyAll(seed(2), 2000);
    room = reduce(room, { t: "tick", now: 2000 + COUNTDOWN_MS, roll: 0 });
    expect(room.phase.name).toBe("voting");
    const before = room;
    room = reduce(room, { t: "setSettings", playerId: "host", values: { roundCount: 9 }, now: 9000 });
    expect(room).toBe(before);
  });

  test("setting a value to what it already is is a no-op", () => {
    const before = seed(2);
    const room = reduce(before, {
      t: "setSettings",
      playerId: "host",
      values: { roundCount: before.settings.roundCount },
      now: 2000,
    });
    expect(room).toBe(before);
  });
});

describe("game modes", () => {
  test("the host selects a mode", () => {
    // Only one mode ships, so selecting it is a no-op; the guards below are
    // what this suite is really pinning down.
    const before = seed(2);
    const room = reduce(before, { t: "setMode", playerId: "host", mode: "ffa", now: 2000 });
    expect(room).toBe(before);
    expect(room.settings.mode).toBe("ffa");
  });

  test("an unknown mode id is rejected", () => {
    const before = seed(2);
    const room = reduce(before, { t: "setMode", playerId: "host", mode: "teams", now: 2000 });
    expect(room).toBe(before);
  });

  test("a player cannot change the mode", () => {
    const before = seed(2);
    const room = reduce(before, { t: "setMode", playerId: "p0", mode: "ffa", now: 2000 });
    expect(room).toBe(before);
  });

  test("the mode is locked once the match leaves the lobby", () => {
    let room = readyAll(seed(2), 2000);
    room = reduce(room, { t: "tick", now: 2000 + COUNTDOWN_MS, roll: 0 });
    const before = room;
    room = reduce(room, { t: "setMode", playerId: "host", mode: "ffa", now: 9000 });
    expect(room).toBe(before);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run shared/reduce.test.ts -t "settings"
```

Expected: FAIL — TypeScript/runtime errors about `values` not existing on the `setSettings` event, and `setMode` not being a known event type.

- [ ] **Step 3: Rework `shared/reduce.ts`**

Add the type import for `NumericSettingKey` and the two lookup functions to the imports at the top:

```ts
import { isGameModeId, modeSpec } from "./gamemodes";
import type { NumericSettingKey } from "./gamemodes";
```

Also add `MatchSettings` to the existing type import from `./state`:

```ts
import type { Entry, MatchSettings, Player, PlayerId, Room, RoundSummary } from "./state";
```

Replace the `setSettings` line in the `RoomEvent` union (currently line 44) with:

```ts
  | {
      t: "setSettings";
      playerId: PlayerId;
      /** Only keys the *active mode* exposes are honoured. */
      values: Partial<Record<NumericSettingKey, number>>;
      now: number;
    }
  | { t: "setMode"; playerId: PlayerId; mode: string; now: number }
```

Add these two helpers directly beneath the existing `clampSetting` function:

```ts
/**
 * Applies host-supplied values, honouring only the keys the *active mode*
 * actually exposes — the wire is not trusted, so a message naming a field this
 * mode does not have is ignored even though the field exists on the type.
 * Returns the identical object when nothing changed, per the no-op rule.
 */
function applySettings(
  settings: MatchSettings,
  values: Partial<Record<NumericSettingKey, number>>,
): MatchSettings {
  let next = settings;
  for (const spec of modeSpec(settings.mode).settings) {
    const value = clampSetting(values[spec.key], spec.min, spec.max, settings[spec.key]);
    if (value !== next[spec.key]) next = { ...next, [spec.key]: value };
  }
  return next;
}

/**
 * Pulls every value the given mode exposes back inside that mode's bounds.
 * Switching modes carries values across rather than resetting them, so a mode
 * with a tighter range must not inherit a number its own stepper cannot reach.
 */
function clampToMode(settings: MatchSettings): MatchSettings {
  let next = settings;
  for (const spec of modeSpec(settings.mode).settings) {
    const value = Math.min(spec.max, Math.max(spec.min, settings[spec.key]));
    if (value !== next[spec.key]) next = { ...next, [spec.key]: value };
  }
  return next;
}
```

Replace the whole `case "setSettings":` block (currently lines 276-294) with:

```ts
    case "setSettings": {
      if (ev.playerId !== room.hostId) return room;
      // Locked once the match starts: changing the round count mid-match
      // would move the finish line under the players.
      if (room.phase.name !== "lobby") return room;
      const settings = applySettings(room.settings, ev.values);
      return settings === room.settings ? room : { ...room, settings };
    }

    case "setMode": {
      if (ev.playerId !== room.hostId) return room;
      if (room.phase.name !== "lobby") return room;
      if (!isGameModeId(ev.mode)) return room;
      if (ev.mode === room.settings.mode) return room;
      return { ...room, settings: clampToMode({ ...room.settings, mode: ev.mode }) };
    }
```

- [ ] **Step 4: Update the wire protocol**

In `shared/protocol.ts`, add the type import at the top:

```ts
import type { NumericSettingKey } from "./gamemodes";
```

Replace the `setSettings` line (currently line 11) with:

```ts
  | { type: "setSettings"; values: Partial<Record<NumericSettingKey, number>> }
  | { type: "setMode"; mode: string }
```

- [ ] **Step 5: Route the messages in `party/server.ts`**

Replace the `case "setSettings":` block (currently lines 267-275) with:

```ts
      case "setSettings":
        this.room = reduce(this.room, {
          t: "setSettings",
          playerId,
          // A hand-rolled message can omit `values` entirely; the rules layer
          // expects an object to iterate.
          values: msg.values ?? {},
          now,
        });
        break;
      case "setMode":
        this.room = reduce(this.room, { t: "setMode", playerId, mode: msg.mode, now });
        break;
```

- [ ] **Step 6: Update the two `HostLobby` call sites**

In `src/screens/host/HostLobby.tsx`, change the two `onChange` handlers (currently lines 67 and 77):

```tsx
          onChange={(roundCount) => roomStore.send({ type: "setSettings", values: { roundCount } })}
```

```tsx
          onChange={(durationSec) => roomStore.send({ type: "setSettings", values: { durationSec } })}
```

- [ ] **Step 7: Run the tests and typecheck**

```bash
npm test && npm run typecheck
```

Expected: all tests PASS, typecheck exits 0.

- [ ] **Step 8: Commit**

```bash
git add shared/reduce.ts shared/reduce.test.ts shared/protocol.ts party/server.ts src/screens/host/HostLobby.tsx && git commit -m "feat: validate settings against the active mode's descriptors

setSettings now carries a values bag and honours only the keys the active
mode exposes. Adds setMode, which carries values across clamped into the
new mode's ranges.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The countdown hold

**Files:**
- Modify: `shared/state.ts` (`Room.configuring`, `createRoom`)
- Modify: `shared/reduce.ts` (event, `apply` case, `settle` gate, `startGame` guard, `disconnect`)
- Modify: `shared/protocol.ts` (new message)
- Modify: `party/server.ts` (`load()` fallbacks, routing)
- Test: `shared/reduce.test.ts`

**Interfaces:**
- Consumes: `backPhase` (already private in `reduce.ts`), `DEFAULT_MODE` / `isGameModeId` / `defaultSettings` from Task 1
- Produces: `Room.configuring: boolean` (rides in `RoomState`, *not* stripped by `toRoomState`); `RoomEvent` variant `{ t: "setConfiguring"; playerId; open: boolean; now }`; `ClientMessage` variant `{ type: "setConfiguring"; open: boolean }`

- [ ] **Step 1: Write the failing tests**

Append to `shared/reduce.test.ts`:

```ts
describe("the drawer hold", () => {
  test("opening a drawer during the countdown drops back to the lobby", () => {
    let room = readyAll(seed(2), 2000);
    expect(room.phase.name).toBe("countdown");
    room = reduce(room, { t: "setConfiguring", playerId: "host", open: true, now: 2500 });
    expect(room.phase.name).toBe("lobby");
    expect(room.configuring).toBe(true);
  });

  // This is what makes it a hold rather than a cancel: cancelStart clears
  // readiness precisely so settle cannot re-open the countdown. Here it must.
  test("the hold leaves every player ready", () => {
    let room = readyAll(seed(2), 2000);
    room = reduce(room, { t: "setConfiguring", playerId: "host", open: true, now: 2500 });
    expect(room.players.every((p) => p.ready)).toBe(true);
  });

  test("no countdown opens while a drawer is open", () => {
    let room = seed(2);
    room = reduce(room, { t: "setConfiguring", playerId: "host", open: true, now: 2000 });
    room = readyAll(room, 2500);
    expect(room.phase.name).toBe("lobby");
  });

  test("closing the drawer derives a fresh full-length countdown", () => {
    let room = readyAll(seed(2), 2000);
    room = reduce(room, { t: "setConfiguring", playerId: "host", open: true, now: 2500 });
    room = reduce(room, { t: "setConfiguring", playerId: "host", open: false, now: 9000 });
    expect(room.phase).toEqual({ name: "countdown", endsAt: 9000 + COUNTDOWN_MS, to: "voting" });
  });

  test("the host cannot force a start while a drawer is open", () => {
    let room = reduce(seed(2), { t: "setConfiguring", playerId: "host", open: true, now: 2000 });
    const before = room;
    room = reduce(room, { t: "startGame", playerId: "host", now: 2500 });
    expect(room).toBe(before);
  });

  test("a player cannot set the flag", () => {
    const before = seed(2);
    const room = reduce(before, { t: "setConfiguring", playerId: "p0", open: true, now: 2000 });
    expect(room).toBe(before);
  });

  test("setting the flag to what it already is is a no-op", () => {
    const before = seed(2);
    const room = reduce(before, { t: "setConfiguring", playerId: "host", open: false, now: 2000 });
    expect(room).toBe(before);
  });

  // A host whose phone locks with a drawer open would otherwise hold the whole
  // room down until the grace reap.
  test("the host disconnecting clears the flag", () => {
    let room = reduce(seed(2), { t: "setConfiguring", playerId: "host", open: true, now: 2000 });
    room = reduce(room, { t: "disconnect", playerId: "host", now: 2500 });
    expect(room.configuring).toBe(false);
  });

  test("a player disconnecting does not clear the flag", () => {
    let room = reduce(seed(2), { t: "setConfiguring", playerId: "host", open: true, now: 2000 });
    room = reduce(room, { t: "disconnect", playerId: "p0", now: 2500 });
    expect(room.configuring).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run shared/reduce.test.ts -t "the drawer hold"
```

Expected: FAIL — `setConfiguring` is not a known event type and `configuring` is not a field on `Room`.

- [ ] **Step 3: Add the field in `shared/state.ts`**

Add to the `Room` type, directly after the `hostGoneAt` field:

```ts
  /**
   * Whether the host has a lobby drawer open. Not a secret — like `votes`,
   * it is a room-wide fact the TV is already showing — so it rides in
   * `RoomState` and the player lobby reads it.
   *
   * It holds the start countdown: settings must never change under a match
   * that is already starting. See `setConfiguring` in shared/reduce.ts.
   */
  configuring: boolean;
```

Add to `createRoom`'s returned object, after `hostGoneAt: null,`:

```ts
    configuring: false,
```

`toRoomState` needs **no change** — `configuring` is deliberately not in the `Omit` list.

- [ ] **Step 4: Add the event and guards in `shared/reduce.ts`**

Add to the `RoomEvent` union, after the `setMode` line:

```ts
  | { t: "setConfiguring"; playerId: PlayerId; open: boolean; now: number }
```

Add this `case` to `apply`, directly after the `setMode` case:

```ts
    case "setConfiguring": {
      if (ev.playerId !== room.hostId) return room;
      if (ev.open === room.configuring) return room;
      // A hold, not a cancel. Readiness is deliberately left untouched, which
      // is the whole mechanism: closing the drawer lets the normal `settle`
      // tail derive a brand-new countdown with no host action and no stored
      // remaining-ms. `cancelStart` clears readiness for the opposite reason —
      // it wants the countdown to stay down.
      const phase =
        ev.open && room.phase.name === "countdown" ? backPhase(room) : room.phase;
      return { ...room, configuring: ev.open, phase };
    }
```

In `settle`, replace the `lobby` branch (currently lines 102-104) with:

```ts
  if (phase.name === "lobby") {
    // A drawer open on the host TV holds the countdown down: without this,
    // any event at all — a join, a ready toggle — would re-derive it while
    // the host is still mid-adjustment.
    if (room.configuring) return room;
    return everyoneReady(room, MIN_PLAYERS) ? openCountdown(room, now, "voting") : room;
  }
```

In the `startGame` case, add this guard directly after the `hostId` check:

```ts
      // Needs its own guard: `reduce` deliberately skips `settle` for
      // `startGame`, so a countdown opened here would survive the hold.
      if (room.configuring) return room;
```

In the `disconnect` case, add a `configuring` line to the returned object:

```ts
    case "disconnect":
      return {
        ...room,
        players: mapPlayer(room.players, ev.playerId, (p) => ({ ...p, connected: false })),
        // The host is not a player, so the line above is a no-op for them and
        // nothing else in the room would record that they left. Stamping the
        // moment is what arms the grace-period reap in `alarmOutcome`.
        hostGoneAt: ev.playerId === room.hostId ? ev.now : room.hostGoneAt,
        // A host whose phone locks with a drawer open would otherwise hold the
        // countdown down for everyone until that reap fires.
        configuring: ev.playerId === room.hostId ? false : room.configuring,
      };
```

- [ ] **Step 5: Add the wire message in `shared/protocol.ts`**

Add after the `setMode` line:

```ts
  | { type: "setConfiguring"; open: boolean }
```

- [ ] **Step 6: Persist and route it in `party/server.ts`**

Change the import from `../shared/categories` — `DEFAULT_ROUND_COUNT` is no longer used there — and add the gamemodes import:

```ts
import { DEFAULT_DURATION_SEC } from "../shared/categories";
import { DEFAULT_MODE, defaultSettings, isGameModeId } from "../shared/gamemodes";
import type { MatchSettings } from "../shared/state";
```

Add `MatchSettings` to the existing `import type { PlayerId, Room } from "../shared/state";` line instead of a second import statement if you prefer; either compiles.

In `load()`, replace the `settings:` property with the block below, and add `configuring:` beside the other fallbacks:

```ts
      kicked: rest.kicked ?? [],
      hostGoneAt: rest.hostGoneAt ?? null,
      votes: rest.votes ?? {},
      history: rest.history ?? [],
      configuring: rest.configuring ?? false,
      settings: (() => {
        const stored = rest.settings as Partial<MatchSettings> | undefined;
        const base = defaultSettings(DEFAULT_MODE);
        const mode = stored?.mode;
        return {
          // A room stored before gamemodes existed has no `mode` at all, and a
          // room stored under a mode since renamed has one nothing recognises.
          mode: isGameModeId(mode) ? mode : DEFAULT_MODE,
          roundCount: stored?.roundCount ?? base.roundCount,
          // Rooms older still carry a top-level `durationSec` and no settings.
          durationSec: stored?.durationSec ?? legacyDuration ?? DEFAULT_DURATION_SEC,
        };
      })(),
```

Add the routing case in `onMessage`, after the `setMode` case:

```ts
      case "setConfiguring":
        this.room = reduce(this.room, {
          t: "setConfiguring", playerId, open: msg.open === true, now,
        });
        break;
```

- [ ] **Step 7: Run the tests and typecheck**

```bash
npm test && npm run typecheck
```

Expected: all tests PASS, typecheck exits 0.

- [ ] **Step 8: Commit**

```bash
git add shared/state.ts shared/reduce.ts shared/reduce.test.ts shared/protocol.ts party/server.ts && git commit -m "feat: hold the start countdown while a host drawer is open

Opening drops the phase back to lobby without touching readiness, so
closing lets settle derive a fresh countdown on its own. Cleared on host
disconnect so a locked phone cannot freeze the room.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The `Drawer` component

**Files:**
- Create: `src/components/Drawer.tsx`
- Modify: `src/components/Stepper.tsx` (add `stepperPropsForKind`)
- Modify: `src/style.css` (append a drawer section)

**Interfaces:**
- Consumes: `SettingKind` from `shared/gamemodes.ts` (Task 1)
- Produces: `<Drawer side="left" | "right" open title onClose>{children}</Drawer>`; `stepperPropsForKind(kind: SettingKind): { step?: (value: number, direction: 1 | -1) => number; format?: (value: number) => string }`

No tests: `npm test` runs `shared/**/*.test.ts` only, and this task touches no rules.

- [ ] **Step 1: Create `src/components/Drawer.tsx`**

```tsx
import { useEffect } from "react";
import type { ReactNode } from "react";

type Props = {
  side: "left" | "right";
  open: boolean;
  /** Rendered as the panel heading and as its accessible name. */
  title: string;
  onClose: () => void;
  children: ReactNode;
};

/**
 * An edge panel over the host lobby. Overlay rather than push: the lobby
 * underneath keeps its exact sizing, and the room code banner — which is
 * negative-margined to full bleed — never has to reflow behind it.
 *
 * Unmounts when closed rather than hiding: nothing inside a drawer holds state
 * worth preserving across a close, and the host screen owns the viewport
 * exactly, so a hidden-but-mounted panel is a layout risk for nothing.
 */
export function Drawer({ side, open, title, onClose, children }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={`drawer drawer--${side}`}>
      <button
        type="button"
        className="drawer__scrim"
        aria-label={`Close ${title}`}
        onClick={onClose}
      />
      <aside className="drawer__panel" role="dialog" aria-label={title}>
        <header className="drawer__head">
          <h2 className="drawer__title">{title}</h2>
          <button
            type="button"
            className="drawer__close"
            aria-label={`Close ${title}`}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="drawer__body">{children}</div>
      </aside>
    </div>
  );
}
```

- [ ] **Step 2: Add `stepperPropsForKind` to `src/components/Stepper.tsx`**

Add the type import at the top of the file:

```ts
import type { SettingKind } from "../../shared/gamemodes";
```

Append at the end of the file, after `formatDuration`:

```ts
/**
 * Maps a setting descriptor's kind to the Stepper behaviour it needs. One
 * place, so a new kind is a change here rather than at every drawer call site.
 */
export function stepperPropsForKind(kind: SettingKind): {
  step?: (value: number, direction: 1 | -1) => number;
  format?: (value: number) => string;
} {
  return kind === "duration" ? { step: stepDuration, format: formatDuration } : {};
}
```

- [ ] **Step 3: Append the drawer CSS to `src/style.css`**

Add at the end of the file. Tokens only — no loose hex.

```css
/* ------------------------------------------------------------- drawers */

/* Overlay, not push: the lobby underneath keeps its exact sizing. Fixed
   rather than absolute so the panel is measured against the viewport the
   host screen already owns, not against a flex child of it. */
.drawer {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: flex;
}

.drawer--left { justify-content: flex-start; }
.drawer--right { justify-content: flex-end; }

/* A button, not a div: dismissing by clicking away has to be reachable
   without a mouse, and this is the whole backdrop. */
.drawer__scrim {
  position: absolute;
  inset: 0;
  border: none;
  padding: 0;
  background: var(--ink);
  opacity: 0.55;
  cursor: pointer;
}

.drawer__panel {
  position: relative;
  display: flex;
  flex-direction: column;
  width: min(420px, 86vw);
  height: 100%;
  background: var(--cream);
  color: var(--ink);
  border-left: var(--border);
  border-right: var(--border);
}

.drawer__head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 20px 20px 14px;
  border-bottom: var(--border);
}

.drawer__title {
  font-family: var(--display);
  font-size: 18px;
  letter-spacing: 0.06em;
  color: var(--ink);
}

.drawer__close {
  width: 34px;
  height: 34px;
  border: var(--border);
  border-radius: 8px;
  background: var(--gold);
  color: var(--ink-gold);
  font-family: var(--display);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

/* The only thing on a host screen allowed to scroll is a box that asked for
   it. A long mode list scrolls here; the page still never does. */
.drawer__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 20px 24px;
}

/* The two buttons that open them, pinned to the lobby's lower corners. */
.drawer-tab {
  position: absolute;
  bottom: 26px;
  z-index: 5;
  font-family: var(--display);
  font-size: 13px;
  letter-spacing: 0.08em;
  padding: 12px 18px;
  border: var(--border);
  border-radius: 99px;
  background: var(--cream);
  color: var(--ink);
  box-shadow: var(--shadow-btn);
  cursor: pointer;
}

.drawer-tab--left { left: 26px; }
.drawer-tab--right { right: 26px; }

.drawer-tab:hover { background: var(--gold); color: var(--ink-gold); }

/* One selectable gamemode. */
.mode-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  text-align: left;
  padding: 14px 16px;
  border: var(--border);
  border-radius: var(--radius);
  background: var(--cream);
  color: var(--ink);
  cursor: pointer;
}

.mode-row--active {
  background: var(--gold);
  color: var(--ink-gold);
  box-shadow: var(--shadow-card);
}

.mode-row__name {
  font-family: var(--display);
  font-size: 16px;
  letter-spacing: 0.04em;
}

.mode-row__blurb {
  font-size: 13px;
  line-height: 1.35;
  color: var(--ink-dim);
}

.mode-row--active .mode-row__blurb { color: var(--ink-gold); }

/* The steppers inside the settings drawer stack instead of sitting in a row. */
.drawer__settings {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 14px;
}

.drawer__note {
  font-size: 13px;
  line-height: 1.35;
  color: var(--ink-dim);
}
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: exits 0. `Drawer` is unused so far; that is fine, this repo has no `noUnusedLocals` failure for an exported component.

- [ ] **Step 5: Commit**

```bash
git add src/components/Drawer.tsx src/components/Stepper.tsx src/style.css && git commit -m "feat: add the Drawer overlay and stepperPropsForKind

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The two drawers, wired into the host lobby

**Files:**
- Create: `src/screens/host/GameModesDrawer.tsx`
- Create: `src/screens/host/GameSettingsDrawer.tsx`
- Modify: `src/screens/host/HostLobby.tsx`

**Interfaces:**
- Consumes: `Drawer` and `stepperPropsForKind` (Task 4); `GAME_MODES`, `GAME_MODE_IDS`, `modeSpec` (Task 1); the `setMode` / `setSettings` / `setConfiguring` messages (Tasks 2-3)
- Produces: `<GameModesDrawer room open onClose />`, `<GameSettingsDrawer room open onClose disabled />`

- [ ] **Step 1: Create `src/screens/host/GameModesDrawer.tsx`**

```tsx
import { Drawer } from "../../components/Drawer";
import { roomStore } from "../../net/room";
import { GAME_MODES, GAME_MODE_IDS } from "../../../shared/gamemodes";
import type { RoomState } from "../../../shared/state";

type Props = {
  room: RoomState;
  open: boolean;
  onClose: () => void;
};

/**
 * The list is generated from the catalog, not written out, so gamemode #2 is
 * a `shared/gamemodes.ts` change and nothing here moves.
 */
export function GameModesDrawer({ room, open, onClose }: Props) {
  return (
    <Drawer side="left" open={open} title="Game modes" onClose={onClose}>
      {GAME_MODE_IDS.map((id) => {
        const mode = GAME_MODES[id];
        const active = room.settings.mode === id;
        return (
          <button
            key={id}
            type="button"
            className={active ? "mode-row mode-row--active" : "mode-row"}
            aria-pressed={active}
            onClick={() => roomStore.send({ type: "setMode", mode: id })}
          >
            <span className="mode-row__name">{mode.name}</span>
            <span className="mode-row__blurb">{mode.blurb}</span>
          </button>
        );
      })}
    </Drawer>
  );
}
```

- [ ] **Step 2: Create `src/screens/host/GameSettingsDrawer.tsx`**

```tsx
import { Drawer } from "../../components/Drawer";
import { Stepper, stepperPropsForKind } from "../../components/Stepper";
import { roomStore } from "../../net/room";
import { modeSpec } from "../../../shared/gamemodes";
import type { RoomState } from "../../../shared/state";

type Props = {
  room: RoomState;
  open: boolean;
  onClose: () => void;
  /** Mirrors the old inline steppers: locked while a countdown runs. */
  disabled?: boolean;
};

/**
 * Renders one Stepper per descriptor the active mode exposes. Adding a setting
 * to a mode is a catalog change; nothing here knows what `roundCount` is.
 */
export function GameSettingsDrawer({ room, open, onClose, disabled }: Props) {
  const mode = modeSpec(room.settings.mode);

  return (
    <Drawer side="right" open={open} title="Game settings" onClose={onClose}>
      <p className="drawer__note">{mode.name}</p>
      <div className="drawer__settings">
        {mode.settings.map((spec) => (
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
        ))}
      </div>
    </Drawer>
  );
}
```

- [ ] **Step 3: Rewrite `src/screens/host/HostLobby.tsx`**

Replace the entire file with:

```tsx
import { useEffect, useState } from "react";
import { useRemaining } from "../../net/clock";
import { PlayerPill } from "../../components/Roster";
import { Wordmark } from "../../components/Wordmark";
import { roomStore } from "../../net/room";
import { currentRound } from "../../../shared/state";
import type { RoomState } from "../../../shared/state";
import { HostHeader, PlayerCount } from "./HostHeader";
import { GameModesDrawer } from "./GameModesDrawer";
import { GameSettingsDrawer } from "./GameSettingsDrawer";

type Props = {
  room: RoomState;
  /** Present during the countdown phase; un-readying still cancels it. */
  countdown?: { endsAt: number; offset: number };
  onLeave: () => void;
};

type OpenDrawer = "modes" | "settings" | null;

export function HostLobby({ room, countdown, onLeave }: Props) {
  const remaining = useRemaining(countdown?.endsAt ?? 0, countdown?.offset ?? 0);
  const host = typeof location === "undefined" ? "" : location.host.toUpperCase();
  const waiting = room.players.length === 0;
  const [drawer, setDrawer] = useState<OpenDrawer>(null);

  // Only the null <-> open transitions cross the wire: switching straight from
  // one drawer to the other must not flap the server flag, which would drop and
  // re-derive the countdown for no reason.
  const openDrawer = (next: Exclude<OpenDrawer, null>) => {
    if (drawer === null) roomStore.send({ type: "setConfiguring", open: true });
    setDrawer(next);
  };
  const closeDrawer = () => {
    if (drawer !== null) roomStore.send({ type: "setConfiguring", open: false });
    setDrawer(null);
  };

  // The server flag outlives this screen — the host leaving the lobby with a
  // drawer open would hold the next countdown down forever.
  useEffect(() => {
    return () => {
      roomStore.send({ type: "setConfiguring", open: false });
    };
  }, []);

  return (
    <main className="screen screen--host">
      <button type="button" className="back-pill" onClick={onLeave}>
        Back
      </button>

      {/* The room chip other host screens carry would only repeat the code
          that is already the hero here, so the lobby leads with the wordmark
          instead — the join instruction below is louder than any chip. */}
      <HostHeader
        left={<Wordmark small />}
        round={currentRound(room)}
        of={room.settings.roundCount}
        right={<PlayerCount n={room.players.length} />}
      />

      <div className="host-lobby__stage">
        <p className="host-lobby__join">
          {host ? `JOIN AT ${host} · ROOM CODE` : "ROOM CODE"}
        </p>
        <div className="banner host-lobby__code">
          <span className="banner__text">{room.code}</span>
        </div>
        <ul className="roster-row roster-row--inline">
          {room.players.map((p) => (
            <PlayerPill
              key={p.id}
              player={p}
              variant="lobby"
              onKick={(id) => roomStore.send({ type: "kick", targetId: id })}
            />
          ))}
        </ul>
      </div>

      <button
        type="button"
        className="drawer-tab drawer-tab--left"
        onClick={() => openDrawer("modes")}
      >
        Game modes
      </button>
      <button
        type="button"
        className="drawer-tab drawer-tab--right"
        onClick={() => openDrawer("settings")}
      >
        Game settings
      </button>

      <div className="host-lobby__footer">
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
        ) : (
          <>
            <p className="host-lobby__hint">
              {waiting
                ? "Waiting for players to join…"
                : "Starting early readies everyone up."}
            </p>
            <button
              type="button"
              className="btn"
              disabled={waiting}
              onClick={() => roomStore.send({ type: "startGame" })}
            >
              Start game
            </button>
          </>
        )}
      </div>

      <GameModesDrawer room={room} open={drawer === "modes"} onClose={closeDrawer} />
      <GameSettingsDrawer
        room={room}
        open={drawer === "settings"}
        onClose={closeDrawer}
        disabled={Boolean(countdown)}
      />
    </main>
  );
}
```

Note what left the file: the `Stepper` / `formatDuration` / `stepDuration` import, the four bound constants imported from `shared/reduce`, and the whole `.host-lobby__settings` block.

- [ ] **Step 4: Remove the dead `.host-lobby__settings` rule from `src/style.css`**

Delete the `.host-lobby__settings { ... }` rule (it sits just under the `/* ---- steppers */` comment, around line 1523) including its comment block. Leave every `.stepper*` rule in place — the drawer still uses them.

- [ ] **Step 5: Typecheck and build**

```bash
npm run typecheck && npm run build
```

Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/screens/host/GameModesDrawer.tsx src/screens/host/GameSettingsDrawer.tsx src/screens/host/HostLobby.tsx src/style.css && git commit -m "feat: move host lobby settings into edge drawers

Game modes on the left, Game settings on the right; the settings drawer
renders one Stepper per descriptor the active mode exposes. Opening either
one sends setConfiguring, which holds the start countdown.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Player-side signal, docs, and the full verification sweep

**Files:**
- Modify: `src/screens/player/PlayerLobby.tsx`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `room.configuring` and `room.settings.mode` from `RoomState` (Tasks 1 and 3), `modeSpec` (Task 1)
- Produces: nothing downstream

- [ ] **Step 1: Show the mode and the hold on `src/screens/player/PlayerLobby.tsx`**

Add the import:

```ts
import { modeSpec } from "../../../shared/gamemodes";
```

Replace the `.player-lobby__settings` paragraph (currently lines 38-42) with:

```tsx
      <p className="player-lobby__settings">
        {modeSpec(room.settings.mode).name}
        {" · "}
        {room.settings.roundCount} {room.settings.roundCount === 1 ? "ROUND" : "ROUNDS"}
        {" · "}
        {formatDuration(room.settings.durationSec)}
      </p>
      {/* Without this the countdown just vanishes and the room looks broken. */}
      {room.configuring && (
        <p className="player-lobby__settings">Host is adjusting settings…</p>
      )}
```

If `PlayerLobby.tsx` renders the settings line inside a conditional or a different element than described, keep the existing structure and only add the mode name and the `configuring` paragraph.

- [ ] **Step 2: Update `CLAUDE.md`**

In the "What this is" section, after the sentence about the voting phase landing, add:

```markdown
The host configures the match from two lobby drawers — **Game modes** (left)
and **Game settings** (right). Modes and their settings are declared in
`shared/gamemodes.ts`; adding a gamemode is a catalog change, not a layout
change. See `docs/superpowers/specs/2026-07-27-gamemode-drawers-design.md`.
```

In the "Docs" list, add:

```markdown
- `docs/superpowers/specs/2026-07-27-gamemode-drawers-design.md` — the gamemode
  and settings drawers: the catalog, descriptor-driven validation, and the
  countdown hold.
```

In "Invariants — breaking these is a defect, not a style choice", add:

```markdown
- **Settings are validated against the active mode's descriptors, never against
  loose constants.** `shared/gamemodes.ts` is the single source of truth for
  which settings a mode exposes and what their bounds are; `setSettings`
  ignores any key the active mode does not declare, even when the field exists
  on `MatchSettings`.
- **`configuring` holds the countdown; it does not cancel it.** Opening a host
  drawer drops the phase back to `lobby` with **readiness untouched**, so
  closing lets `settle` derive a fresh countdown by itself. This is the exact
  opposite of `cancelStart`, which clears readiness precisely so the countdown
  stays down. The flag is cleared on host disconnect — otherwise a locked phone
  freezes the room until the grace reap.
```

- [ ] **Step 3: Full verification sweep**

```bash
npm test && npm run typecheck && npm run build
```

Expected: all tests PASS, both tsc projects clean, build succeeds.

- [ ] **Step 4: Verify no loose hex values entered the stylesheet**

```bash
grep -nE '#[0-9a-fA-F]{3,8}\b' src/style.css | grep -v -- '--'
```

Expected: no output.

- [ ] **Step 5: Verify the old inline settings band is gone**

```bash
grep -rn "host-lobby__settings" src/ ; echo "exit=$?"
```

Expected: no matches (`exit=1`).

- [ ] **Step 6: Commit**

```bash
git add src/screens/player/PlayerLobby.tsx CLAUDE.md && git commit -m "feat: show the gamemode and the settings hold on the player lobby

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage:** catalog → Task 1; `setMode`/`setSettings` → Task 2; `configuring` + hold + `load()` fallbacks → Task 3; `Drawer` + `stepperPropsForKind` + CSS → Task 4; the two drawers + `HostLobby` → Task 5; `PlayerLobby` + docs → Task 6. Every spec section maps to a task.
- **Type consistency:** `NumericSettingKey`, `SettingSpec.key`, `modeSpec`, `defaultSettings`, `isGameModeId`, `stepperPropsForKind`, `configuring` are spelled identically across all six tasks.
- **Live testing is deliberately absent.** No task starts a dev server or a browser.
