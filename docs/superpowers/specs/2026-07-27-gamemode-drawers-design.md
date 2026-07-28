# Gamemode & settings drawers — design

**Date:** 2026-07-27
**Status:** approved, not yet implemented
**Supersedes:** the lobby settings layout described in
`2026-07-26-match-structure-design.md`. That spec's *rules* (round count,
per-round timer, golf placement) are unchanged; only where the host adjusts
them moves.

## Problem

The host lobby renders the round-count and round-timer Steppers inline, in a
`.host-lobby__settings` band under the room code. That works for exactly one
gamemode with exactly two settings. The next wave of work adds more gamemodes,
each with its own settings, and an inline band cannot absorb that: every new
mode would either widen the band past the TV's viewport or force a bespoke
layout.

This change moves settings off the main lobby into two edge drawers and, more
importantly, replaces the hard-coded pair of Steppers with a **declarative
catalog** so that adding gamemode #2 is a data change rather than a layout
change.

## Scope

- Two drawers on the host lobby: **Game modes** (left) and **Game settings**
  (right).
- A gamemode catalog in `shared/`, with per-mode setting descriptors.
- `settings.mode` becomes real room state.
- A countdown *hold* while a drawer is open, so settings can never change
  under a match that is already starting.

Exactly one gamemode ships: **Free-for-All**, the listing game the app already
is. The one-entry list is the point — it proves the seam.

## Non-goals

- **No second gamemode.** Not designed, not stubbed.
- **No non-numeric setting kinds.** `SettingKind` is `"count" | "duration"`.
  Toggles and multi-selects land when a mode needs one; `SettingKind` is the
  seam they extend.
- **No drawers outside the lobby.** `setSettings` stays lobby-only — changing
  the round count mid-match moves the finish line under the players. The
  standings→round countdown is untouched.
- **No visual polish.** Layout here is plain and structural. Production styling
  is a separate pass.

---

## 1. `shared/gamemodes.ts` — the catalog

New file. The single source of truth for what modes exist, what settings each
exposes, and what each setting's bounds are.

```ts
export const GAME_MODE_IDS = ["ffa"] as const;
export type GameModeId = (typeof GAME_MODE_IDS)[number];
export const DEFAULT_MODE: GameModeId = "ffa";

/**
 * Which Stepper behaviour a numeric setting gets. The seam where a future
 * toggle or select mode setting extends the union.
 */
export type SettingKind = "count" | "duration";

/** A numeric key of MatchSettings — the fields a spec is allowed to drive. */
export type NumericSettingKey = "roundCount" | "durationSec";

export type SettingSpec = {
  key: NumericSettingKey;
  /** Rendered on the Stepper. Uppercase, matching today's "ROUNDS"/"TIMER". */
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
  settings: readonly SettingSpec[];
};

export const GAME_MODES: Record<GameModeId, GameMode>;
```

### Bounds move here

`MIN_ROUND_COUNT`, `MAX_ROUND_COUNT`, `MIN_DURATION_SEC`, `MAX_DURATION_SEC`
move from `shared/reduce.ts` into this file and are consumed by the FFA
descriptors. **`reduce.ts` re-exports them** so every existing import site and
test keeps working unchanged, and so the dependency runs one way only
(`reduce.ts → gamemodes.ts`) with no cycle.

### Helpers

- `modeSpec(id: string): GameMode` — returns `GAME_MODES[DEFAULT_MODE]` for an
  id that is not in `GAME_MODE_IDS`. Stored rooms and hand-rolled socket
  messages both need this fallback; no caller should have to null-check.
- `isGameModeId(v: unknown): v is GameModeId`
- `defaultSettings(id: GameModeId): MatchSettings` — used by `createRoom`.

### Import direction

`state.ts` imports `GameModeId` and `DEFAULT_MODE` from `gamemodes.ts` at
runtime. `gamemodes.ts` must therefore **only ever `import type`** from
`state.ts` — the `MatchSettings` return type of `defaultSettings`. Type-only
imports erase, so there is no runtime cycle. For the same reason
`NumericSettingKey` is a **hand-written literal union**, not `keyof
MatchSettings` — with a test asserting the two agree, so a drifted key is a
test failure rather than a silent gap.

### Why a flat settings bag, not `Record<string, number>`

`MatchSettings` keeps its named numeric fields:

```ts
export type MatchSettings = {
  mode: GameModeId;
  roundCount: number;
  durationSec: number;
};
```

A mode declares which *subset* of these fields it exposes. Mode #2 adding a
genuinely new setting adds one field here (with a default) and one descriptor
to its catalog entry.

The rejected alternative was `settings: { mode, values: Record<string, number> }`.
It is more generic and strictly worse: every read site in the codebase —
`room.settings.durationSec` in `tick`, in `matchComplete`, in `voteBudget`, on
`PlayerLobby` — becomes a possibly-undefined lookup, and TypeScript stops
catching a typo'd key. Fields that some modes ignore cost nothing; unchecked
lookups cost real bugs.

---

## 2. `shared/reduce.ts`

### `setMode`

```ts
| { t: "setMode"; playerId: PlayerId; mode: string; now: number }
```

- Host-only, lobby-only (same two guards as `setSettings`).
- `mode` not in `GAME_MODE_IDS` → return `room` unchanged.
- Same mode already selected → return `room` unchanged (**identity**, per the
  no-op rule in CLAUDE.md).
- On change, values carry across but are **clamped into the new mode's ranges**
  for each key the new mode exposes. A mode whose timer caps at 60s must not
  inherit a 600s value. Keys the new mode does not expose are left alone —
  unused, not reset, so switching away and back is lossless.

### `setSettings` generalizes

```ts
| { t: "setSettings"; playerId: PlayerId;
    values: Partial<Record<NumericSettingKey, number>>; now: number }
```

Replaces today's `roundCount?` / `durationSec?` pair. Host-only, lobby-only,
unchanged. Then:

- Iterate the **active mode's** specs. A key the active mode does not expose is
  ignored, even if it is a valid `MatchSettings` field — the wire is not
  trusted.
- Each accepted value goes through the existing `clampSetting(value, spec.min,
  spec.max, current)`; non-finite falls back to current, as today.
- If nothing changed, return `room` unchanged (identity).

### `setConfiguring` — the countdown hold

```ts
| { t: "setConfiguring"; playerId: PlayerId; open: boolean; now: number }
```

`Room` gains `configuring: boolean`. Host-only.

This is what makes the drawer a **pause** rather than a cancel:

- When `open` flips to `true` **and the phase is `countdown`**, the phase drops
  to `backPhase(room)` — which in the lobby is `{ name: "lobby" }` — and
  **readiness is left completely untouched.** This is the one deliberate
  difference from `cancelStart`, which clears `ready` precisely so `settle`
  cannot immediately re-open the countdown. Here, re-opening is exactly what we
  want on close.
- When `open` flips to `false`, nothing special happens: `reduce`'s normal
  `settle` tail sees a lobby where everyone is still ready and derives a
  **fresh `now + COUNTDOWN_MS` countdown** on its own. No host action, no new
  phase state, no stored remaining-ms, no alarm juggling.

The countdown therefore **restarts at a full 5s** rather than resuming from
where it froze. That is deliberate: players deserve a full warning after the
host changed the round timer under them, and resuming would have required
making `countdown` a stateful phase with a JSON-persisted `remainingMs` and its
own `load()` fallback.

### Guards that follow from the hold

- **`settle`'s `lobby` branch is gated on `!room.configuring`.** Without it, any
  event at all (a join, a ready toggle) would re-derive the countdown while the
  drawer is still open.
- **`startGame` is rejected while `configuring`.** It needs its own guard
  because `reduce` deliberately skips `settle` for `startGame` — a countdown
  opened that way would survive until the next event.
- **`disconnect` clears `configuring` when the disconnecting player is the
  host.** Otherwise a host whose phone locks with a drawer open freezes the
  whole room until the 15s host-grace reap.

No other event needs to clear it: `configuring` is consulted only in the lobby
and `startGame` paths, and the client sends `false` on unmount.

---

## 3. Server & persistence

`party/server.ts`:

- `load()` gains two fallbacks, in the same style as the existing ones:
  `configuring: rest.configuring ?? false`, and `mode` filled into `settings`
  via `defaultSettings`/`DEFAULT_MODE` for rooms stored before it existed.
  Both survive the JSON round trip (a boolean and a string literal).
- `onMessage` routes the two new `ClientMessage` cases and passes
  `msg.values` through for the reworked `setSettings`.

`shared/protocol.ts`:

```ts
| { type: "setSettings"; values: Partial<Record<NumericSettingKey, number>> }
| { type: "setMode"; mode: string }
| { type: "setConfiguring"; open: boolean }
```

`shared/state.ts`: `configuring` **rides in `RoomState`** — it is not stripped
by `toRoomState`. Like `votes`, it is a room-wide fact, not a secret: it says
the host is fiddling with settings, which is visible to anyone in the room by
looking at the TV. Guarding it would cost per-connection encoding for nothing.
`mode` rides along inside `settings`, which is already broadcast whole.

---

## 4. Client

| File | Change |
|---|---|
| `src/components/Drawer.tsx` *(new)* | Generic overlay: `{ side: "left" \| "right", open, title, onClose, children }`. Scrim + edge panel. Dismisses on scrim click, Escape, and a close button. Renders nothing when closed. `role="dialog"` + `aria-label`. |
| `src/components/Stepper.tsx` | Add `stepperPropsForKind(kind: SettingKind)` returning `{ step, format }` — `"duration"` binds `stepDuration`/`formatDuration`, `"count"` binds neither. Puts the kind→behaviour mapping in one place instead of at each call site. `Stepper` itself is unchanged. |
| `src/screens/host/GameModesDrawer.tsx` *(new)* | Maps `GAME_MODES` to selectable rows (name + blurb), marks the active one, sends `setMode` on click. One row today. |
| `src/screens/host/GameSettingsDrawer.tsx` *(new)* | Maps the active mode's `settings` specs to a `<Stepper>` each, sending `setSettings { values: { [spec.key]: v } }`. Header names the active mode. |
| `src/screens/host/HostLobby.tsx` | `.host-lobby__settings` block deleted. Two edge buttons added ("Game modes" left, "Game settings" right). Local `useState<"modes" \| "settings" \| null>`; **`setConfiguring` is sent only on the `null` ↔ open transitions**, so switching modes→settings does not flap the server flag. A `useEffect` cleanup sends `open: false` on unmount. |
| `src/screens/player/PlayerLobby.tsx` | Mode name joins the settings summary line. When `room.configuring`, the start hint is replaced with "Host is adjusting settings…" — otherwise players watch the countdown vanish for no visible reason. |
| `src/style.css` | `.drawer` / `.drawer__scrim` / `.drawer__panel` / `.drawer--left` / `.drawer--right`, drawer button styles, `.mode-row`. `.host-lobby__settings` removed. Design tokens only, no loose hex. |

Steppers inside the settings drawer stay `disabled` during a countdown, as
today. In practice the hold means a countdown cannot be running while the
drawer is open, but the guard costs nothing and matches the server rule.

---

## 5. Tests

`shared/` only, per the layering rule. New file `shared/gamemodes.test.ts` plus
additions to `shared/reduce.test.ts`.

**Catalog invariants** — for every mode, every spec: `min <= default <= max`,
`min < max`, `key` is a real `MatchSettings` numeric key, no duplicate keys
within a mode. `DEFAULT_MODE` is in `GAME_MODE_IDS`. `modeSpec` falls back for
an unknown id. FFA's descriptors match the constants `reduce.ts` re-exports.

**`setMode`** — non-host rejected; rejected outside `lobby`; unknown id
rejected; selecting the already-active mode returns the identical object;
carried values are clamped into the new mode's ranges.

**`setSettings`** — a key the active mode does not expose is ignored; clamping
and the non-finite fallback still hold; a no-op returns the identical object.

**The hold** — opening during a `countdown` returns to `lobby` **with every
player still `ready`**; closing derives a fresh countdown at exactly
`now + COUNTDOWN_MS`; `settle` does not open a countdown while `configuring`;
`startGame` is rejected while `configuring`; a **host** `disconnect` clears the
flag but a **player** `disconnect` does not.

## Verification

`npm test`, `npm run typecheck` (**both** tsc projects — `shared/` changes must
pass under `tsconfig.json` and `tsconfig.worker.json`), `npm run build`. Live
browser testing is deliberately out of scope for the implementation pass; the
author will run the three-tab smoke test.
