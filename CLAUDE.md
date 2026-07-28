# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

w104 is a Jackbox-style party game: players join from their phones, one device
("create lobby") becomes the non-playing shared/TV screen. Everyone races to
list items in a category before a timer runs out; scoring is Boggle rules — a
word scores only if no other player wrote it.

v1 scope is a match of 1–10 rounds, with the host setting round count and a
per-round timer from 15 seconds to 10 minutes. The category is no longer
fixed: up front, the room votes once on which of 10 categories to play, and
each round draws from that pool weighted by vote share, spending a category
once it has been played. This match structure and the voting phase have
landed — see `docs/superpowers/specs/2026-07-26-match-structure-design.md` and
`docs/superpowers/specs/2026-07-26-category-voting-design.md`. The long
product wishlist (`Project W-104.md`, untracked) is deliberately *not* built —
see "Out of scope" in the design specs before adding anything from them.

The host configures the match from two lobby drawers — **Game modes** (left)
and **Game settings** (right). Modes and their settings are declared in
`shared/gamemodes.ts`; adding a gamemode is a catalog change, not a layout
change. See `docs/superpowers/specs/2026-07-27-gamemode-drawers-design.md`.

A match can also be played in **teams**. The Team Count setting (off, or 2–10)
inserts a team-selection phase between the lobby and category voting, gives
each team one shared word list, and scores and places teams rather than
players. Category voting stays individual. See
`docs/superpowers/specs/2026-07-27-teams-design.md`.

## Commands

Requires Node 22 (`.nvmrc`). Two terminals for a working local setup:

```bash
npm run dev:party    # wrangler dev — realtime Worker on 0.0.0.0:8787
```

```bash
npm run dev          # Vite web app on :5173 (binds all interfaces)
```

- `npm test` — Vitest, runs `shared/**/*.test.ts` only (293 tests)
- `npm run test:watch` — watch mode
- `npx vitest run shared/scoring.test.ts` — one file
- `npx vitest run -t "allowedEdits"` — one test/describe by name
- `npm run typecheck` — **two** tsc projects: `tsconfig.json` (src + shared, DOM
  libs) and `tsconfig.worker.json` (party + shared, workers-types). A change to
  `shared/` must typecheck under both.
- `npm run build` — typecheck then `vite build`
- `npm run deploy:party` — `wrangler deploy` (CI does this on merge to `main`)

Manual smoke test: open `?p=1` (creates the lobby, is the TV), `?p=2`, `?p=3`
(join with that code). `?p=` namespaces each tab's localStorage so three tabs
act as three players instead of fighting over one seat — see
`src/net/identity.ts`. Three real phones on the same wifi is the better test;
that needs `VITE_PARTYKIT_HOST` set to the machine's LAN IP (`.env.example`,
`HOSTING.md`).

## Architecture

Two independently deployed pieces: a React SPA (Vercel) and a PartyServer
Worker (Cloudflare). One SQLite Durable Object per room; **the room code *is*
the DO name**, so there is no registry or lookup table.

```
shared/   pure game logic — no DOM, no Cloudflare runtime, fully unit-tested
party/    server.ts — thin DO shell: persist, broadcast, schedule alarms
src/      React client — net/room.ts socket store + screens/{host,player}
```

The layering is the point: **all game rules live in `shared/`** so they test in
milliseconds. `party/server.ts` is plumbing only. If you find yourself writing a
rule inside the Durable Object, it belongs in `shared/reduce.ts` instead.

### State flow

The Durable Object is the sole authority. Clients hold a read-only replica,
replaced wholesale on each `state` push; every client action is a *request*.

- `reduce(room, event) -> Room` is a pure state machine (`shared/reduce.ts`).
  Returning the identical object means "no change" — `party/server.ts` and
  `reduce` itself both rely on that identity check, so never return a fresh
  object for a no-op.
- Phase transitions run off DO alarms, not client timers. `nextAlarmAt` serves
  double duty: the current phase deadline, or the idle-reap horizon.
- The pre-round↔countdown edge is *derived* in `settle()`, not commanded —
  anything that changes readiness re-evaluates it. "Pre-round" covers both the
  lobby before round one and the standings screen between rounds, guarded by
  `matchComplete` so readying up on the final standings cannot open a countdown
  for a round that does not exist. `startGame` is legal from lobby, team select,
  voting, and standings, and is still the one exception (host solo-start
  bypasses `MIN_PLAYERS`), and `reduce` skips `settle` for it. From a lobby with
  teams on it opens team select rather than a countdown.
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
- The server implements `onAlarm()`, **not** `alarm()`. PartyServer's own
  `alarm()` initializes the object then calls `onAlarm()`; overriding `alarm()`
  skips `onStart()` on a cold wake, `this.room` stays null, and the round hangs
  forever.

### Invariants — breaking these is a defect, not a style choice

- **Word lists never enter `RoomState`.** `toRoomState()` in `shared/state.ts`
  is the privacy boundary: it strips `entries`, `lastActivityAt`, `kicked`.
  A player's words reach only their own socket (`yourEntries`), until `scoring`
  ships full `Results` to everyone.
- **No per-player entry counts in broadcasts.** Players must not see how many
  words rivals have. `submitEntry` deliberately does not broadcast.
- **`votes` is the deliberate exception to the broadcast boundary.** Unlike
  `entries`, it rides in `RoomState`: the host TV renders the full tally to the
  room by design, so guarding it would cost per-connection encoding for a
  secret that is already on the wall.
- **Timers broadcast an absolute `endsAt`, never per-second ticks.** Clients
  count down locally against `clockOffset` (`src/net/clock.ts`). Per-second
  broadcasts put a round at the mercy of party wifi.
- **Anything persisted must survive JSON.** DO storage serializes as JSON, so
  `entries` is a `Record` and `kicked` an array — a `Map`/`Set` comes back
  empty. Also add a defaulting fallback in `load()` for any new field, since
  `storage.get<Room>` is an unchecked cast over older stored rooms.
- **Durable Objects must stay on `new_sqlite_classes`** in `wrangler.jsonc`.
  `new_classes` requires a paid Cloudflare plan and breaks deploys.
- **Local dev stays plain http.** An https page cannot open a `ws://` socket, so
  no `--local-protocol https`.
- The host is not a player. A natural start needs 2+ *connected* players all
  ready; the host's Start button force-readies everyone and can start solo.
- **The round number is derived, never stored.** `currentRound(room)` is
  `history.length + 1`. A stored counter would have to increment when an
  inter-round countdown opens and decrement when it is cancelled; history only
  grows, and only at `showStandings`, so deriving makes a cancel a real no-op.
- **The round's category is drawn at the whistle, never earlier.** Drawing when
  the countdown opens would let a cancelled countdown re-roll it and would let
  the countdown screen leak it. Randomness enters via the tick's `roll` so
  `reduce` stays pure.
- **`Room.history` holds aggregates only, never words.** It rides in
  `RoomState`, so an `entries` field on `RoundSummary` would leak every past
  round to every socket — the same boundary `toRoomState` exists to hold.
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

### Identity, sessions, and kicks

Three distinct ids, easy to confuse:

- `playerId` — UUID in `localStorage`, stable across reloads so a locked phone
  reclaims its seat and its words.
- `session` — fresh per `connect()` call. partysocket reuses the query string
  across its *own* auto-reconnects, so a matching session means "the kicked
  socket is retrying itself" (stay banned) and a new one means "the player came
  back through Landing" (ban lifts).
- `_pk` — partysocket's connection id, **stripped in the Worker fetch handler**
  because it is reused across reconnects and would collide in PartyServer's
  connection map.

A kick is durable for the room's lifetime (`backToLobby` does not clear it) and
is enforced at the connect gate, before `join` can seat anyone.

### Teams

- **The unit of scoring is a `Scorer`, not a `Player`.** `rosterOf(room)` in
  `shared/teams.ts` returns one scorer per player when teams are off and one
  per *non-empty* team when they are on — and it is the only place the "empty
  teams do not score" rule lives, so no render site has to re-check.
- **Membership lives on `Player.teamId`, never on `Team`.** One source of
  truth, so nobody can be on two teams and no member list can desync. A team's
  roster is derived by filtering `players`, which gives it a stable order free.
- **Entries stay keyed by `PlayerId` even in team play.** A team's list is its
  members' lists merged by `at`. Keying by team would have meant a persistence
  migration, a second shape for `toRoomState`, and a special case for a player
  kicked mid-round; this way a kick already scrubs their words.
- **`ready` in the `teams` phase is derived from membership.** `joinTeam` and
  `leaveTeam` own the flag and the `ready` event is rejected there — the same
  arrangement `castVote`/`resetVotes` have during voting. This is why there is
  no unready button: leaving a team *is* the unready.
- **Stragglers are auto-assigned at the host's Continue, and again at the tick
  that opens `voting`.** Assigning at Continue is what keeps `ready` honest —
  it means "on a team", and a force-ready over a teamless player is a flag with
  nothing behind it and nothing for them to leave. The countdown stays fully
  cancellable either way: anyone, including someone just placed, can leave and
  have `settle` drop the room back into team select. The tick is the backstop
  for the one case Continue cannot see — readiness counts only *connected*
  players, so a phone that died in team select arrives at the whistle teamless.
- **`cancelStart` is rejected on the teams countdown.** It clears readiness so
  `settle` cannot re-open the countdown, which would wedge a room landing back
  in `teams` with everyone still on a team and no way to become ready again.
  `HostTeams` therefore renders no Stop button. It does render **Back to room
  throughout**, countdown included — abandoning team select is a different
  thing from pausing it, so `backToLobby` is legal wherever `inTeamSelect` is.
- **With teams on, `backToLobby` out of `voting` steps back to `teams`,** not
  to the lobby — one step, not all the way home. `enterTeams` keeps the
  existing teams when the count still matches, so the names players typed
  survive the trip; membership does not, which is also what stops `settle`
  closing team select again the instant it opens.
- **A rename never recolours.** `Team.colorIndex` is written once at creation;
  the colour is what the room navigates by.
- **The shared list reaches teammates by `sendTo`, never `broadcast`.** On an
  accepted entry the server pushes `yourEntries` to that team's connected
  members only — the "no per-player entry counts in broadcasts" boundary is
  untouched — and sends it *before* the `entryAck`, so the authoritative copy
  lands ahead of the message that retires the client's optimistic one.

### Client

`src/net/room.ts` is a single `RoomStore` singleton exposed via
`useSyncExternalStore`; screens read `useRoom()` and call `roomStore.send(...)`.
Entries render optimistically and reconcile on `entryAck` (a 30s round cannot
wait on a round trip); `seq` is present only while an entry is unacked.

Screens are a pure `switch` on `room.phase.name` in `HostView`/`PlayerView`.
Both have an explicit `ReactElement` return type — **that annotation is what
makes tsc flag an unhandled phase**; deleting a `default` branch alone does not
(no `noImplicitReturns` in this repo).

The text input in `PlayerView` lives outside every phase screen and is moved
with CSS rather than unmounted. iOS only opens the keyboard from a real gesture
and drops it when the focused element disappears, so the "Ready up" tap is the
only chance to have a keyboard up when `playing` begins off a timer. Do not
move that input into a phase-specific screen, and keep it out of a `<form>`
(triggers Safari's AutoFill bar).

## Docs

- `docs/superpowers/specs/2026-07-25-w104-mvp-design.md` — the design spec:
  decisions, rationale, failure-handling table. Read before non-trivial changes.
- `docs/superpowers/specs/2026-07-26-match-structure-design.md` — the match
  structure spec: host-set round count/timer, the standings phase, golf
  placement scoring. Supersedes the single-round scope in the MVP spec above.
- `docs/superpowers/specs/2026-07-26-category-voting-design.md` — the category
  voting spec: the 10-category pool, vote budget, the weighted draw, spent
  categories. Supersedes the fixed `"woman"` category assumed by the MVP spec
  above.
- `docs/superpowers/specs/2026-07-27-teams-design.md` — the teams spec: the
  `teamCount` setting, the team-selection phase, shared word lists, and
  scorer-generic scoring and standings.
- `docs/superpowers/specs/2026-07-27-gamemode-drawers-design.md` — the gamemode
  and settings drawers: the catalog, descriptor-driven validation, and the
  countdown hold.
- `docs/superpowers/plans/2026-07-25-w104-mvp.md` — historical implementation
  plan. Fully executed; its code blocks and numbers are *not* current. Its
  "Deviations discovered during implementation" section is accurate and useful.
- `HOSTING.md` — deploy/CI runbook, staging environment, LAN phone testing.

## Workflow

Branch off `main`, open a PR. CI (`.github/workflows/ci.yml`) runs typecheck,
tests, build. PRs deploy an isolated `w104-staging` Worker; merges to `main`
deploy production (Vercel for the app, GitHub Actions → `wrangler deploy` for
the Worker). Named Wrangler environments do not inherit `durable_objects`
bindings, so `env.staging` repeats them.

Commits here stage explicit paths — never `git add -A`, so the untracked
working note `Project W-104.md` stays untracked.
