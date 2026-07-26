# Match structure and host lobby controls — design

Date: 2026-07-26
Status: approved, not yet implemented
Supersedes: the single-round scope in `2026-07-25-w104-mvp-design.md`

## What this is

The MVP plays exactly one round. `Room.round` increments but nothing
accumulates, so there is no match, no standings, and no way for the host to
choose how long a round runs or how many there are.

This spec adds the **match**: host-chosen settings, a repeating
round → results → standings loop, golf-style placement points that accumulate
across rounds, and a return to the lobby at the end.

It is the first of six sub-projects carved out of a larger gameplay expansion.
The other five — category voting, animated read-through, contesting, awards,
superlatives and the share card — each get their own spec. See "Deliberately
out of scope" at the end; several items there are already listed as out of
scope in the MVP spec and stay that way until their own spec exists.

## Vocabulary

Two words that are easy to confuse, used precisely throughout:

- **Round** — one 15s–10min stretch of typing, ending in that round's results.
- **Match** — the whole sitting: 1 to 10 rounds, ending in final standings.

The screen showing one round's word lists is **round scoring** (`scoring`
phase, already exists). The screen showing accumulated match position is
**standings** (`standings` phase, new). The user-facing name for standings is
"game scoring".

## Decisions

### Golf placement points

Each round ranks players by **unique** words, highest first. A player's
finishing position *is* their score for that round: 1st = 1 point, 2nd = 2,
and so on. Points accumulate across rounds and **the lowest total wins**.

Rationale: it makes a bad round survivable — finishing last in round 1 costs
you the same as finishing 3rd instead of 2nd twice — which keeps a 3-round
match live to the end. It also gives the badge strip on each player card an
obvious meaning: the badges *are* the score.

### Ties share a place, and co-winners are real

Ranking is **standard competition ranking**. Unique counts of 7, 5, 5, 2 give
places 1, 2, 2, 4 — two players sharing 2nd means nobody takes 3rd.

Dense ranking (1, 2, 2, 3) was rejected: under golf points it would make a tie
*cheaper* than losing outright, which is backwards.

Ties are never broken. Two players level on points at the end are both
winners, and the final screen says so. There is no tiebreaker on total words,
no earliest-submission rule, no coin flip. With 1–3 rounds and a handful of
players, ties are the common case rather than an edge case, and an arbitrary
tiebreaker would decide most matches on a rule nobody in the room agreed to.

### Readiness governs every round start, not just the first

At standings, players ready up exactly as they do in the lobby, and the host
can force-start. Both open the same 5-second countdown.

This is the load-bearing decision of the spec. The alternative — the host taps
"Next round" and play begins immediately — loses something specific:
`PlayerLobby.tsx` notes that readying up is *the last real user gesture before
a round that starts off a server timer*, which is the only reason iOS ever
opens the keyboard in time. Rounds 2+ need that gesture as much as round 1
does. Reusing readiness gets it back, and reuses the `settle()` path that is
already under test rather than inventing a second way into `playing`.

### Round number is derived, never stored

`currentRound(room) = room.history.length + 1`.

A stored counter would have to increment when the inter-round countdown opens
and decrement when it is cancelled. History only ever grows, and only at
`showStandings`, so deriving from it makes cancelling a countdown a genuine
no-op. The stored `Room.round` field and its `load()` fallback are removed.

### Standings data is derived client-side

`Room` stores per-round aggregates; the client computes standings from them
with a pure function in `shared/`. The server does not compute, store, or
broadcast a standings object.

Rationale: ranking rules belong in `shared/` where they test in milliseconds,
broadcasts stay small, and a kicked player drops out of the standings
automatically because the computation iterates the live roster.

## Data model

### `shared/state.ts`

```ts
export type MatchSettings = {
  roundCount: number;   // 1..10
  durationSec: number;  // 15..600
};

/**
 * One completed round. Aggregates only — never words, so this is safe to
 * carry in RoomState and cheap to rebroadcast on every push.
 */
export type RoundSummary = {
  category: string;
  places: Record<PlayerId, { unique: number; total: number; place: number }>;
};
```

`Room` changes:

- **gains** `settings: MatchSettings`
- **gains** `history: RoundSummary[]`
- **loses** `durationSec` (moves into `settings`)
- **loses** `round` (derived — see above)

`RoundSummary` deliberately holds no `round` field: its index in `history` is
its round number, and a stored copy could disagree with the index.

`RoomState` continues to omit only `entries`, `lastActivityAt`, `kicked` and
`hostGoneAt`. `settings` and `history` are both public.

### JSON survival

`places` is a `Record` and `history` an array, per the standing invariant that
a `Map` or `Set` comes back empty from Durable Object storage.

`load()` in `party/server.ts` must default both new fields over rooms written
before they existed, and stop defaulting `round`:

```ts
settings: stored.settings ?? {
  roundCount: DEFAULT_ROUND_COUNT,
  durationSec: stored.durationSec ?? DEFAULT_DURATION_SEC,
},
history: stored.history ?? [],
```

### Constants

No new file. Defaults sit with the other defaults, bounds sit with the other
rules — the split the codebase already uses.

`shared/categories.ts`, beside `DEFAULT_CATEGORY` and `DEFAULT_DURATION_SEC`:

```ts
export const DEFAULT_ROUND_COUNT = 1;
```

`shared/reduce.ts`, beside `MIN_PLAYERS`, `MAX_PLAYERS` and `MAX_ENTRIES`:

```ts
export const MIN_ROUND_COUNT = 1;
export const MAX_ROUND_COUNT = 10;
export const MIN_DURATION_SEC = 15;
export const MAX_DURATION_SEC = 600;
```

`reduce.ts` is where the clamping happens and where every other numeric game
rule already lives.

## Phase machine

```
        ┌──────────────── backToLobby (final) ─────────────────┐
        │                                                      │
        ▼                                                      │
     lobby ──────┐                                             │
                 ├──► countdown ──► playing ──► timesup ──► scoring ──► standings
   standings ────┘         │                                                 │
        ▲                  │                                                 │
        └── un-ready ──────┴──────────────────────────────────────────────────┘
            / cancelStart              (ready up / startGame, when not final)
```

Both entrances to `countdown` are the same edge, and a cancelled countdown
returns to whichever of the two it came from. Transitions and what drives
each:

| From | To | Driver |
| --- | --- | --- |
| `lobby` | `countdown` | `settle` on everyone ready, or host `startGame` |
| `standings` | `countdown` | `settle` on everyone ready, or host `startGame` |
| `countdown` | `playing` | alarm at `endsAt` |
| `countdown` | `lobby` / `standings` | `settle` on un-ready, or host `cancelStart` |
| `playing` | `timesup` | alarm at `endsAt` |
| `timesup` | `scoring` | alarm at `endsAt` |
| `scoring` | `standings` | host `showStandings` |
| `standings` | `lobby` | host `backToLobby` |

`scoring` and `standings` are untimed and wait for the host, so `nextAlarmAt`
falls through to the idle-reap horizon for both — exactly as `scoring` already
behaves today.

### Where a cancelled countdown returns to

Derived, not stored: `history.length === 0 ? "lobby" : "standings"`. The
countdown phase gains no `from` field, so there is no second copy of the truth
to drift.

### Shared helpers

```ts
export function currentRound(room: Room): number;      // history.length + 1
export function matchComplete(room: Room): boolean;    // history.length >= settings.roundCount
export function preRoundPhase(room: Room): "lobby" | "standings";
```

### `settle` must not bounce a match

`settle` currently derives `lobby ↔ countdown` from readiness. It gains the
`standings ↔ countdown` edge on the same rule, guarded by `!matchComplete` so
readying up on the final standings cannot open a countdown for a round that
does not exist.

The existing `startGame` bypass in `reduce` still applies and is still the
only bypass: a host force-start overrides `MIN_PLAYERS`, and running it back
through `settle` would immediately revert it.

## Events and protocol

Three new host-only events; one existing event widened; one removed.

| Event | Legal from | Effect |
| --- | --- | --- |
| `setSettings` | `lobby` | Clamps and stores `roundCount` / `durationSec` |
| `showStandings` | `scoring` | Appends the `RoundSummary`, clears `entries`, clears all `ready`, → `standings` |
| `backToLobby` | `standings` | Full match reset |
| `startGame` | `lobby` **and `standings`** | Force-readies everyone, opens the countdown |
| `cancelStart` | `countdown` | Returns to `preRoundPhase`, clears `ready` |
| ~~`newGame`~~ | — | **Removed**, replaced by `showStandings` + `startGame` |

`ready` widens its phase guard from `lobby | countdown` to
`lobby | countdown | standings`.

`ClientMessage` gains `setSettings`, `showStandings` and `backToLobby`, and
drops `newGame`.

### `showStandings` clears ready — this is not optional

Players are still flagged ready from the round that just ended. Entering
`standings` without clearing them would have `settle` see everyone ready and
fire the next countdown instantly, skipping the standings screen entirely.

### `showStandings` clears entries

The round is fully banked into `history` at that point, and the words have
already been shown during `scoring`. `entries` has no further reader, so this
is the single place the raw word store is emptied.

### Clamping lives in `reduce`, not the input

The stepper UI restricts values, but a hand-rolled socket message must not be
able to set a nine-hour round. `setSettings` rounds fractional values, ignores
non-finite ones in favour of the current setting, and clamps `roundCount` to
`[1, 10]` and `durationSec` to `[15, 600]`.

Values are clamped, not snapped to the stepper grid: typing `37` gives a
37-second round. The grid governs what `+`/`−` do, not what is legal.

### What `backToLobby` resets

| Reset | Kept |
| --- | --- |
| `phase` → `lobby` | `settings` — the host usually wants the same again |
| `history` → `[]` | `kicked` — a kick is durable for the room's lifetime |
| `entries` → `{}` | `code`, `hostId`, `players` |
| every player `ready` → `false` | `category` — still fixed until category voting ships |

`backToLobby` is legal from `standings` generally, not only when the match is
complete. The button renders only at the end, but allowing the event gives a
host an escape hatch from a match they want to abandon.

### Client/Worker version skew

The SPA (Vercel) and the Worker (Cloudflare) deploy independently, so a client
running old code can briefly meet a new Worker. Removing `newGame` means such
a client's "New round" button does nothing. Rooms live minutes, so the window
is small and self-healing on reload; accepted rather than versioning the
protocol.

## Scoring rules — `shared/standings.ts` (new)

```ts
export type RoundPlace = { unique: number; total: number; place: number };

export type Standing = {
  id: PlayerId;
  name: string;
  emoji: string;
  points: number;    // sum of places across played rounds
  badges: number[];  // place per round, in play order
  place: number;     // standing position; ties share
};

/** Standard competition ranking on unique count. Ties share a place. */
export function placeRound(results: Results): Record<PlayerId, RoundPlace>;

/** Ranks by points ascending — lowest total is 1st. Ties share a place. */
export function computeStandings(
  players: Player[],
  history: RoundSummary[],
): Standing[];
```

Both functions use the **same** standard competition ranking: equal scores
share a place and the places after a tie are skipped. `placeRound` ranks on
unique count descending; `computeStandings` ranks on points ascending. The
returned array is already sorted by `place`, so no screen re-sorts it.

`computeStandings` iterates `players` and looks up `history` by id. That
direction matters: a kicked player disappears from the standings with no
special-casing, and a merely disconnected player keeps their seat, points and
badges.

A player with no entry in a given `RoundSummary` — possible only if the room
is edited out from under us, since joining mid-match is already rejected —
contributes nothing for that round rather than throwing.

## Screens

### `HostLobby` — settings row

Two stepper cards on a single compact band, between the room code and the
footer. Cream card, `--border`, `--shadow-card`, display-font value, `−` / `+`
buttons either side. The value is a numeric input (`inputmode="numeric"`) that
commits on blur or Enter, so it can be typed as well as stepped.

Stepper increments:

- Rounds: 1 throughout, range 1–10.
- Timer: **15s steps from 15s to 60s, then 30s steps from 60s to 600s.**
  Stepping up from a typed off-grid value goes to the next grid value above it.

Disabled during `countdown`. Absent once a match is under way.

**Layout risk:** `.screen--host` is `height: 100dvh; overflow: hidden` — the
host screen must never scroll. Room code plus settings row plus a ten-player
roster is tight at 16:9. The band is capped at roughly 90px and must be
verified at `MAX_PLAYERS`.

### `HostHeader` — round marker

`round` prop becomes the derived `currentRound(room)`, and the marker reads
`ROUND 2 / 3` when `roundCount > 1`, `ROUND 2` when it is 1.

### `HostScoring` — footer button

The existing footer button changes from **"New round"** (`newGame`) to
**"Standings"** (`showStandings`). Nothing else on the round-scoring screen
changes.

`PlayerScoring` is unchanged: the `scoring` phase stays host-gated, so phones
show the round result with no control on it.

### `HostStandings` (new)

Player name cards compacted toward the top — no word lists, which is what the
round-scoring screen is for. Each card carries its accumulating badge strip:
one small chip per played round showing that round's place, gold fill for a
1st, cream for the rest, appended left to right.

Sorted by points ascending. Final standings mark the winner (or all tied
winners) and swap the footer button from "Next round" to "Back to lobby".

The animated transition *into* this screen — word lists dissolving, cards
sliding up — belongs to the animated read-through sub-project, not here. This
screen renders its end state directly.

### `PlayerStandings` (new)

Phones must not be stranded during `standings`. Your place, points and badge
strip large; everyone else's totals compact below.

Carries the same **Ready up / Not ready** button as `PlayerLobby`, except on
final standings where there is no next round to ready for — that variant shows
the final result and waits for the host.

`PlayerView`'s `switch` has an explicit `ReactElement` return type, so tsc
refuses to compile until this screen exists. That is the intended safety net,
not an accident.

### `PlayerLobby` — settings context

Shows the match settings read-only, e.g. `3 ROUNDS · 60s`, so players know
what they are readying up for.

### Design system

Everything above is built from the existing tokens in `src/style.css` — pink
field, cream cards, ink borders, gold for primary and celebration, `--display`
for numerals. No new colours, radii or shadow values. Per the handoff README,
unspecified screens extend the system rather than inventing a second visual
language.

## Failure handling

| Situation | Behaviour |
| --- | --- |
| Host taps "Next round" twice | Second is a no-op — `reduce` returns the identical object, which `party/server.ts` relies on |
| Non-host sends `setSettings` / `showStandings` / `backToLobby` | Ignored, identical object returned |
| `setSettings` outside the lobby | Ignored — settings cannot change mid-match |
| Player un-readies during an inter-round countdown | `settle` returns the room to `standings`, not `lobby` |
| Everyone readies on final standings | `settle` guarded by `!matchComplete`; no countdown opens |
| Player disconnects during standings | Keeps seat, points and badges; excluded from `everyoneReady` |
| Player kicked mid-match | Drops out of standings entirely, past rounds included |
| Connected players fall below `MIN_PLAYERS` mid-match | Natural start blocked; host force-start still works, as in the lobby |
| Host disconnects on standings | Existing `HOST_GRACE_MS` reap applies — the match is lost. Unchanged, and out of scope here |
| Room stored before this change | `load()` defaults `settings` and `history`; a legacy `round` field is dropped |
| 10-minute round | `MAX_ENTRIES` (200) becomes reachable. Verify the cap holds and the union-find stays fast at 10 players × 200 entries (~2M comparisons, still milliseconds) |

## Testing

New `shared/standings.test.ts`:

- `placeRound` with no ties, with a tie, with everyone tied
- standard competition ranking skips places after a tie (1, 2, 2, 4)
- zero-unique players still ranked
- golf accumulation across multiple rounds
- co-winners at equal points
- a kicked player excluded from standings despite appearing in history
- empty history returns every player on 0 points

Additions to `shared/reduce.test.ts`:

- host-only authorization on `setSettings`, `showStandings`, `backToLobby`
- phase gating on each
- `setSettings` clamps out-of-range and non-integer values
- `showStandings` appends history, clears entries, clears ready
- `settle` opens the countdown from `standings` on everyone ready
- `settle` does **not** open it when `matchComplete`
- `cancelStart` from an inter-round countdown returns to `standings`
- `startGame` from `standings` force-readies and bypasses `settle`
- `backToLobby` resets history, entries and readiness but keeps settings and
  kicked
- `currentRound` is stable across a countdown open/cancel cycle

Everything in `shared/` must typecheck under **both** tsconfig projects
(`tsconfig.json` and `tsconfig.worker.json`).

Manual smoke test: `?p=1` creates the lobby, `?p=2` and `?p=3` join; set 3
rounds and 60s; play through to final standings and back to the lobby.

## Deliberately out of scope

Owned by later sub-projects, not to be built here:

- **Category voting and the category-reveal countdown.** The category stays
  `DEFAULT_CATEGORY` for every round of the match.
- **Animated round-scoring read-through** — the 400ms word-by-word reveal,
  ticking counters, live cross-outs, re-sort by unique.
- **In-round time warnings** on the TV and phones. Note the thresholds only
  make sense against the new duration range: a "30s remaining" warning is dead
  weight at a 15s round and useful at a 10-minute one.
- **Contesting, keep/remove voting, point wagers, and category validity.**
  Validity has no oracle in this codebase — `shared/` is pure and offline with
  no dictionary — so contesting may be the only validity mechanism available.
  That needs its own brainstorm.
- **Crowns, medals and ribbons** beyond the plain numeric badge strip.
- **Superlatives, the phone-side final table, and the shareable summary.**
  Superlatives will need per-round stats this spec does not retain;
  `RoundSummary` will have to grow when that spec lands.
