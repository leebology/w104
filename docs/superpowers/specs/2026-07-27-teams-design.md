# Teams — design

**Date:** 2026-07-27
**Status:** approved, not yet implemented
**Builds on:** `2026-07-27-gamemode-drawers-design.md`. Teams arrive as a
setting descriptor in that spec's catalog, and the `"teams"` `SettingKind` is
the first use of the seam that spec deliberately left open.

## Problem

Every match today is free-for-all: one private word list per player, scored and
placed per player. A party of eight wants to play in pairs or in fours, and the
game has no way to express that.

This change adds a **Team Count** setting (off by default, 2–10 when on). When
it is on, the match gains a team-selection phase before category voting, each
team shares one word list, and scoring and standings run on teams rather than
players.

## Scope

- A `teamCount` setting on the gamemode catalog, off by default.
- A new `teams` phase between the lobby and category voting.
- Shared per-team word lists, live to teammates during the round.
- Team-level scoring, placement, and match standings.

## Non-goals

- **No effect on category voting.** Voting stays individual: individual vote
  budgets, individual tallies, the same weighted draw.
- **No re-picking teams between rounds.** Teams are chosen once and stand for
  the whole match.
- **No team-size balancing.** Everyone may pile onto one team; the resulting
  empty teams simply do not score.
- **No visual polish.** Layout here is plain and structural, matching the
  drawers spec. Production styling is a separate pass.
- **No second gamemode.** Free-for-All gains the setting; no new mode.

---

## 1. `shared/teams.ts` — new module

New file. The catalog of team colours and every derivation over teams.

```ts
export type TeamId = string; // "t0".."t9" — index-derived, stable, JSON-safe

export type Team = {
  id: TeamId;
  /**
   * Index into TEAM_COLORS. Fixed at creation and never written again:
   * renaming a team must not recolour it, and the colour is what players
   * actually navigate by.
   */
  colorIndex: number;
  name: string;
};

/** Ten accents, each with the default name a fresh team carries. */
export const TEAM_COLORS: readonly { readonly token: string; readonly name: string }[];
export const MAX_TEAM_COUNT = 10;
export const MIN_TEAM_COUNT = 2;
/** Matches the server's MAX_NAME_LEN for players. */
export const MAX_TEAM_NAME_LEN = 20;
```

`token` is a design-token name, not a hex literal — `style.css` owns the actual
colour, per the drawers spec's no-loose-hex rule.

### Membership lives on the player

`Player` gains `teamId: TeamId | null`. `Team` carries **no** member list.

One source of truth means a player cannot be on two teams and the two copies
cannot desync. A team's roster is derived by filtering `room.players`, which
also gives it a stable order for free — the same reasoning that makes
`currentRound` derive from `history` rather than being stored.

### Helpers

- `teamsEnabled(settings: MatchSettings): boolean` — true when the **active
  mode declares a `teamCount` descriptor** *and* `settings.teamCount >= 2`.
  The descriptor check is not belt-and-braces: settings are validated against
  the active mode's descriptors and never against a field's mere existence, so
  a mode without the descriptor must ignore a `teamCount` left over from a mode
  that had it.
- `makeTeams(count: number): Team[]` — `count` fresh teams, team *i* taking
  `TEAM_COLORS[i]`'s token and default name.
- `teamOf(room, playerId): Team | undefined`
- `membersOf(room, teamId): Player[]` — filter, preserving `players` order.
- `rosterOf(room): Scorer[]` — see §6. **This is the one place empty teams are
  excluded**, so no render site has to remember to.
- `assignStragglers(players, teams): Player[]` — every player with
  `teamId === null` joins the team with the fewest members; ties break by lowest
  `colorIndex`. Assignments are applied one at a time so two stragglers land on
  two different teams rather than both on the same smallest one.

---

## 2. The `teamCount` setting

### `MatchSettings`

```ts
export type MatchSettings = {
  mode: GameModeId;
  roundCount: number;
  durationSec: number;
  /** 0 = off. Otherwise MIN_TEAM_COUNT..MAX_TEAM_COUNT. */
  teamCount: number;
};
```

`NumericSettingKey` gains `"teamCount"`, and `gamemodes.test.ts`'s existing
assertion that the union agrees with `MatchSettings` covers it.

### A new `SettingKind`

```ts
export type SettingKind = "count" | "duration" | "teams";
```

FFA's descriptor:

```ts
{ key: "teamCount", label: "TEAMS", kind: "teams",
  min: 0, max: MAX_TEAM_COUNT, default: 0 }
```

`min` is 0 rather than `MIN_TEAM_COUNT` because 0 is a real, reachable value —
the default one. The gap at 1 is the kind's business, not the bounds'.

### `normalizeSetting`

The stepper's refusal to stop at 1 is a UI fact, and the wire is not bound by
the UI. A new `normalizeSetting(spec, value, current)` in `gamemodes.ts`
replaces the bare `clampSetting` call inside `applySettings` and `clampToMode`:
it clamps exactly as today, then applies the kind's own rule — for `"teams"`, a
value of 1 snaps to 0.

Living beside the descriptors keeps the rule in the one file that is allowed to
quote bounds, and gives the next non-linear setting somewhere obvious to go.

---

## 3. Phase graph

```
teams off:  lobby ──all ready──────────────> countdown(to:"voting") ─> voting ─> …
teams on:   lobby ──all ready──> teams ──all on a team──> countdown(to:"voting") ─> voting ─> …
```

`Phase` gains `{ name: "teams" }` — untimed, exactly like `standings`, so
`nextAlarmAt` falls through to the idle-reap horizon with no change.

There is deliberately **no countdown into `teams`**. Team select is itself a
waiting room; a five-second countdown into a screen whose whole purpose is
waiting is dead air, and it would put three countdowns in front of the first
word typed.

### `settle`'s lobby branch

```
if (room.configuring) return room;               // unchanged — the drawer hold
if (!everyoneReady(room, MIN_PLAYERS)) return room;
return teamsEnabled(room.settings)
  ? enterTeams(room)
  : openCountdown(room, now, "voting");
```

`enterTeams` builds `makeTeams(settings.teamCount)`, clears every player's
`teamId`, and **clears every `ready` flag**.

That clear is load-bearing for exactly the reason the one at the voting edge is:
`ready` means "waiting in the room" on the lobby side and "has a team" on the
teams side. Carried across, the next `settle` would see everyone ready and close
team select before a single player picked.

The `configuring` hold still works untouched. It now holds the lobby→`teams`
edge instead of a lobby countdown, because `settle`'s lobby branch is already
gated on `!room.configuring` before either outcome. `setConfiguring`'s
countdown-drop simply never fires when teams are on, since no countdown exists
in the lobby then.

### `settle`'s new `teams` branch

```
if (phase.name === "teams") {
  return everyoneReady(room, MIN_PLAYERS) ? openCountdown(room, now, "voting") : room;
}
```

The destination is `"voting"`, not `"playing"`: the teams phase sits *before*
voting, and the round-one countdown still comes out of voting as it does today.

### `backPhase` and `countdownScreen`

Both fork on the same fact, and both derive it — no new stored field:

- `backPhase`: a `to: "voting"` countdown returns to `teams` when teams are
  enabled, `lobby` otherwise. This is sound precisely because when teams are on,
  the lobby→voting countdown does not exist, so a `to:"voting"` countdown can
  only have come from `teams`.
- `countdownScreen`: a `to: "voting"` countdown renders `"teams"` underneath
  when enabled, `"lobby"` otherwise.

`preRoundPhase` keeps its current signature and meaning; only `backPhase`, which
can already see `room.phase`, learns about the fork.

### Readiness in the teams phase

`ready` is **derived from membership** and never set by the `ready` event, which
is rejected in the `teams` phase. `joinTeam` and `leaveTeam` own the flag, in
exactly the way `castVote` and `resetVotes` own it during voting.

This is why the player has no separate "unready" button: **Leave team is the
unready.** Being on a team is being ready.

---

## 4. New events

All three take the same phase guard: legal in `teams`, **and** in a
`countdown` whose `to` is `"voting"` while teams are enabled. The countdown case
is what lets a player cancel the start by leaving their team, which is the
behaviour the design calls for; allowing a *switch* during the same window costs
nothing extra.

| Event | Rules |
|---|---|
| `joinTeam { playerId; teamId }` | `teamId` must be a real team in `room.teams`. Sets `teamId`, sets `ready = true`. Already on that team → identical object. |
| `leaveTeam { playerId }` | Not on a team → identical object. Clears `teamId` and `ready`. The `ready = false` is what makes `settle`'s countdown branch drop back to `teams`. |
| `setTeamName { playerId; teamId; name }` | Sender must be a **member of that team**. Trimmed; empty falls back to `TEAM_COLORS[colorIndex].name`. Last write wins — a rename race between teammates is not worth a lock. Unchanged name → identical object. |

Name length is capped at `MAX_TEAM_NAME_LEN` (20, matching player names) and is
sliced at the server edge like `setProfile`'s, so `reduce` receives a bounded
string.

### `startGame` from `teams` — the host's Continue

Legal from `lobby`, `voting`, `standings`, and now `teams`. From `teams` it
force-readies everyone and opens `countdown(to: "voting")` — the five-second
countdown the host sees on the button.

Force-readying players who have no team is momentarily a lie, and the tick that
closes the countdown makes it true (below). It is still the right flag to set:
if a player then leaves their team, `leaveTeam` clears their `ready` and
`settle` tears the countdown down, which is what should happen.

From `lobby` with teams enabled, `startGame` lands on `teams` rather than a
countdown, with `ready` cleared — the same `enterTeams` the natural path uses.

### Auto-assignment runs at the tick, not at countdown-open

Any player still unassigned when the `countdown(to:"voting")` **fires** is
placed by `assignStragglers`. That happens in the `tick` that opens `voting` —
the same tick that already clears `ready` and resets `votes`.

Doing it when the countdown *opens* would be wrong twice over: every player
would instantly be "ready", so `settle` could never tear the countdown down, and
a player could therefore never leave their team to cancel it.

### `backToLobby`

Becomes legal from `teams` as well as `standings` and `voting`. It resets
`teams` to `[]` and every `teamId` to `null` alongside the existing resets, so
the next match re-derives teams from whatever `teamCount` is by then.

---

## 5. Entries — the storage shape does not change

`room.entries` stays `Record<PlayerId, Entry[]>`. **A team's list is the merge
of its members' lists, sorted by `at`.**

This is the highest-leverage decision in the spec. Keying entries by team would
have meant a persistence migration, a second shape for `toRoomState` to reason
about, and a special case for a player kicked mid-round. Keying by player and
merging at read time means:

- no migration and no new `load()` fallback for the entries map itself;
- the privacy boundary in `toRoomState` is untouched;
- a kicked player's words leave their team's list for free, because `kick`
  already deletes `entries[targetId]`;
- the free-for-all path is byte-for-byte what it is today — a scorer with one
  member merges one list.

### `Entry.by`

`Entry` gains `by: PlayerId`. It is redundant on disk (the record key already
says who wrote it) but necessary on the wire once lists are merged, so a
teammate's word can be attributed. `load()` backfills it from the record key —
the defaulting fallback the JSON-survival invariant requires for any new field.

### `submitEntry`

With teams on, the list checked for duplicates and against `MAX_ENTRIES` is the
**merged team list**; the entry is still stored under `entries[playerId]`. A
word a teammate already wrote is rejected with the existing `duplicate` reason,
and `MAX_ENTRIES` (200) becomes a per-team cap.

The rejection copy in `src/net/room.ts` (`"You already wrote that."`) needs a
team-aware variant, since in a team match it may well have been a teammate.

---

## 6. Scoring becomes scorer-generic

The unit of scoring stops being a player and becomes **whoever owns a word
list**: one scorer per player when teams are off, one per non-empty team when
they are on. Every consumer works off that single idea rather than branching on
teams at each site.

```ts
export type ScorerId = string; // a PlayerId or a TeamId

export type Scorer = {
  id: ScorerId;
  name: string;
  /** The player's emoji; "" for a team, which is identified by colour. */
  emoji: string;
  /** The team's accent; null for a player. */
  colorIndex: number | null;
  /** [self] for a player; the roster for a team. */
  members: PlayerId[];
};
```

`rosterOf(room)` returns the scorer list, and **excludes teams with no
members** — the single enforcement point for the "empty teams don't score"
rule.

### `scoreRound`

Signature becomes `scoreRound({ scorers, entries })`. The algorithm is
unchanged in every step: flatten each scorer's members' entries by `at`, drop
the scorer's own repeats, union-find across scorers with the existing
`isMatch`, project back preserving submission order. Only the word "player"
changes meaning.

Two consequences fall out of the flatten step and are correct without special
casing: two teammates writing the same word dedupe within the team and count
once, and two *teams* sharing a word cancel it for both.

### Result types

```ts
export type ScoredEntry = {
  text: string;
  /** Which member wrote it. The scorer's own id when teams are off. */
  by: PlayerId;
  unique: boolean;
  /** The other scorers who also had this word. Ids, not display strings. */
  alsoBy: ScorerId[];
};

export type ScorerResult = Scorer & {
  total: number;
  unique: number;
  entries: ScoredEntry[];
};

export type Results = { scorers: ScorerResult[] };
```

`Results.players` → `Results.scorers` and `PlayerResult` → `ScorerResult` is a
wide but mechanical rename across `scoring.ts`, `standings.ts`, `reduce.ts`,
`HostScoring`, `PlayerScoring`, and three test files. It is worth doing: a field
named `players` holding teams is a lie every future reader has to un-learn.

`alsoBy` changes from emoji strings to scorer ids. The screens already receive
the full scorer list in `Results`, so the lookup is local, and a team needs a
colour rather than an emoji — which a pre-baked display string cannot carry.

---

## 7. Standings

`RoundSummary.places` becomes `Record<ScorerId, RoundPlace>`. Nothing else about
`RoundSummary` changes; it still holds aggregates only, never words.

`computeStandings(scorers, history)` takes the scorer list in place of the
player list. **It keeps its current direction** — iterate the live roster, look
history up by id, never the reverse — and teams inherit exactly what that
direction already buys: a disconnected player keeps their badges, a kicked one
vanishes, and a team whose member was kicked keeps its points and its place.

`Standing` gains `colorIndex: number | null` and `members: PlayerId[]` so the TV
can draw the accent and the player avatars beneath each row.

Because teams are fixed for the whole match, names and colours are read from
live `room.teams` at render time. History stores no snapshot of them — a second
copy that could drift, for no benefit.

---

## 8. The live shared list

Teammates must see each other's words as they land, or they spend the round
duplicating each other blind.

`submitEntry` still does not broadcast — the "no per-player entry counts in
broadcasts" invariant holds untouched. Instead, on an accepted entry, the server
does a **targeted `yourEntries` send to every connected member of the
submitter's team** (just the submitter when teams are off), using `sendTo`
rather than `broadcast`. Other teams learn nothing.

Ordering is load-bearing: the server sends `yourEntries` **before** `entryAck`,
so the authoritative list always arrives ahead of the acknowledgement that
retires the optimistic copy.

### Client reconciliation

One rule, both modes, no `teamsEnabled` branch in the store:

- `yourEntries` → the server list, plus any local entries still carrying a
  `seq`. Unacked optimistic entries ride on top of server truth.
- `entryAck` accepted → **drop** the optimistic entry rather than stripping its
  `seq`. The server's copy of it is already in the list from the push that
  preceded this message.
- `entryAck` rejected → unchanged: filter it out, show the banner.

No flicker, no duplicates. The cost is one extra small message per submission
per teammate, which at `MAX_PLAYERS` 10 is nothing.

---

## 9. Server & persistence

`party/server.ts`:

- `load()` gains, in the established style: `teams: rest.teams ?? []`;
  `teamCount: stored?.teamCount ?? 0` inside the settings block; `teamId:
  p.teamId ?? null` mapped over `players`; and the `Entry.by` backfill from each
  record key. All four survive the JSON round trip (arrays, a number, a string,
  a string).
- `onMessage` routes `joinTeam`, `leaveTeam`, and `setTeamName`, slicing the
  name to `MAX_TEAM_NAME_LEN` at the edge exactly as `setProfile` does.
- The `submitEntry` branch gains the team-member `yourEntries` fan-out described
  in §8, before its existing `entryAck`.

`shared/protocol.ts`:

```ts
| { type: "joinTeam"; teamId: TeamId }
| { type: "leaveTeam" }
| { type: "setTeamName"; teamId: TeamId; name: string }
```

`shared/state.ts`: `teams` **rides in `RoomState`** — it is not stripped by
`toRoomState`. Like `votes` and `configuring`, it is a room-wide fact the host
TV is already displaying to everyone in the room. `teamId` rides along on
`Player`, which is already broadcast whole; `teamCount` rides inside `settings`,
likewise.

---

## 10. Client

| File | Change |
|---|---|
| `src/screens/host/HostTeams.tsx` *(new)* | One panel per team, in its accent, with member avatars; a strip of still-unassigned players; a Continue button sending `startGame`, and the countdown readout when one is running. A renamed team keeps its accent — the name is the only thing that moves. |
| `src/screens/player/PlayerTeams.tsx` *(new)* | Grid of team choices in their accents. Once on a team: the teammate list, the team name as a tappable inline edit sending `setTeamName`, and **Leave team** sending `leaveTeam`. Tapping a different team sends `joinTeam` and switches. |
| `src/screens/host/HostView.tsx`, `src/screens/player/PlayerView.tsx` | New `teams` case in the phase switch, and the `countdown` case routed through the updated `countdownScreen`. The explicit `ReactElement` return type is what makes tsc demand both. |
| `src/screens/host/HostScoring.tsx`, `src/screens/player/PlayerScoring.tsx` | Iterate `results.scorers`. A team card renders its accent, its name, and its member avatars underneath; each word row shows the author's emoji, and `alsoBy` resolves ids against the scorer list. |
| `src/screens/host/HostStandings.tsx`, `src/screens/player/PlayerStandings.tsx` | Iterate scorer standings; accent and member avatars per row. |
| `src/screens/player/PlayerPlaying.tsx` | Renders the merged list, tagging words written by a teammate with their emoji. |
| `src/screens/player/PlayerLobby.tsx` | Team count joins the existing settings summary line. |
| `src/components/Stepper.tsx` | `stepperPropsForKind` learns `"teams"`: a `step` that moves 0 ↔ 2 and 2..10 by one, and a `format` rendering 0 as `OFF`. `Stepper` itself stays unchanged. |
| `src/net/room.ts` | The `yourEntries`/`entryAck` reconciliation of §8, and a team-aware `duplicate` rejection string. |
| `src/style.css` | Ten team accent custom properties; `.team-panel`, `.team-card`, `.team-picker`, unassigned strip. Design tokens only, no loose hex. Structural, not polished. |

`GameSettingsDrawer` needs no change: it already maps the active mode's
descriptors to Steppers, so the `teamCount` descriptor renders itself. That is
the seam from the drawers spec paying off.

---

## 11. Tests

`shared/` only, per the layering rule.

**`shared/teams.test.ts`** *(new)* — `TEAM_COLORS` has `MAX_TEAM_COUNT` entries
with distinct tokens and distinct default names. `makeTeams(n)` yields `n` teams
with ids `t0..t(n-1)` and ascending `colorIndex`. `teamsEnabled` is false at 0
and 1, false when the active mode declares no `teamCount` descriptor, true at
2..10. `rosterOf` returns players when off, non-empty teams when on, and drops
empty teams. `assignStragglers` fills the smallest team, breaks ties by lowest
`colorIndex`, and spreads two stragglers across two teams rather than stacking
them.

**`shared/reduce.test.ts`** additions — lobby readiness enters `teams` only when
enabled, and clears every `ready` flag on the edge; `joinTeam` sets `ready` and
`leaveTeam` clears it; all-on-a-team opens `countdown(to:"voting")`; leaving
during that countdown drops back to `teams`; switching teams during it does not;
`setTeamName` from a non-member returns the identical object; the `ready` event
is rejected in `teams`; `startGame` from `teams` force-readies and opens the
countdown; **auto-assignment happens at the voting tick and not at
countdown-open**; `backToLobby` from `teams` clears `teams` and every `teamId`;
`joinTeam` to an unknown team id and every other no-op return the identical
object.

**`shared/gamemodes.test.ts`** additions — the `teamCount` descriptor satisfies
the existing catalog invariants; `normalizeSetting` snaps 1 to 0 for kind
`"teams"` and leaves `"count"`/`"duration"` behaviour unchanged; a `teamCount`
of 1 arriving via `setSettings` lands as 0.

**`shared/scoring.test.ts`** additions — two teammates writing the same word
count once for the team; two teams sharing a word cancel it for both;
`ScoredEntry.by` names the member who wrote it; a scorer with one member scores
identically to today's per-player result.

**`shared/standings.test.ts`** additions — teams place as single rows; a team
whose member was kicked keeps its points and badges.

## Verification

`npm test`, `npm run typecheck` (**both** tsc projects — `shared/` changes must
pass under `tsconfig.json` and `tsconfig.worker.json`), `npm run build`.

Live browser testing is deliberately out of scope for the implementation pass;
the author runs the three-tab smoke test and a separate design pass afterwards.

## Branch & PR

Branch `teams` off `gamemode-drawers`, PR targeting `gamemode-drawers` — a
fourth level on the existing `v1` → `category-voting` → `gamemode-drawers`
stack. The dependency is real rather than incidental: the `teamCount` setting is
a descriptor in the catalog that branch introduces.
