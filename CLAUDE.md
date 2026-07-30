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

- `npm test` — Vitest, runs `shared/**/*.test.ts` only (378 tests)
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

Two subsystems hang off the Worker:

- **The D1 score archive** — on no game path at all. `shared/archive.ts` maps
  `Room`/`Results` to row shapes (pure, so the `shared/**/*.test.ts` glob covers
  it); `party/archive.ts` is the only file that touches the `DB` binding;
  `migrations/` holds the schema. Every call goes through `ctx.waitUntil()` in
  try/catch that logs and swallows — **the archive is allowed to lose data, the
  game is not allowed to notice.** The game never reads it back.
- **The debug menu** (`src/components/DebugPanel.tsx`) — five sections. Two of
  them, experiment flags and free-tier usage (`party/usage.ts` behind
  `/debug/usage`), touch nothing. The other three **deliberately mutate a live
  room** — the round controls (pause, skip, auto-fill), the view jumper, and the
  bot bench — and are therefore host-only and enforced server-side. See "Debug
  menu" below.

Each keeps files in `shared/` that are **not** game logic — `shared/archive.ts`,
`shared/usage.ts`, `shared/views.ts`, `shared/bots.ts` — and for the same two
reasons: purity makes them testable under the existing vitest glob, and `party/`
and `src/` are separate tsconfig projects, so a type the client imported from
`party/` would drag the whole Worker into `tsconfig.json`. The archive and usage
files are imported by nothing in the game at all; the debug ones are reached only
through the events they define.

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
  place — the tick that opens `voting`. **Opening `scoring` clears them for the
  same reason** — see "The scoring reveal" — as does banking a round.
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
- **WebSocket Hibernation is on (`static options = { hibernate: true }`), so no
  instance field survives between events.** Anything the `W104` class holds must
  be reloadable in `onStart()` — that is why `room`, `archive` and
  `kickedSessions` are all read from storage there. Adding a `private` field
  with meaningful state and no `onStart()` load is a defect that will look like
  intermittent amnesia rather than a crash. `Connection` state is the exception:
  `setState` serializes into the socket's own attachment, so `ConnState` rides
  with the socket. Hibernation is what keeps Durable Object *duration* off the
  free-tier ceiling — an idle pinned room costs ~83% of a day's allowance on its
  own.
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

**`kickedSessions` is persisted, not an instance field**, and hibernation is
why. An absent entry is treated as "still banned" — the safe direction — so an
in-memory copy lost to eviction would leave a kicked player unable to rejoin at
all rather than letting a stale socket slip through. That was already true on a
cold wake before hibernation; it was just rare enough not to notice. Stored as
a `Record<PlayerId, string[]>` because DO storage is JSON and a `Map` of `Set`s
comes back empty.

Known gap, pre-existing: kicking a player who is *already disconnected* records
no sessions, so their next connect finds an empty array, matches nothing, and
lifts the ban immediately.

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
- **Team panels are fixed-width and wrap; they never rescale.** `.team-grid`
  is `repeat(var(--cols), 182px)`, not `1fr` tracks. Adding a team adds a
  panel — players are aiming at a colour on a TV, and a target that moves when
  somebody else joins is the one thing this screen cannot do.
- **A team is named by `TeamBadge`, on every screen that shows one.** The
  tilted name tab in the team's accent, overhanging the card's top-left corner
  — team select on the TV and on the phones, the round, and the results. It is
  a component (`src/components/TeamBadge.tsx`) rather than a rule per screen,
  and it sets `--accent` itself so it is correct wherever it is dropped. A card
  that carries one needs `position: relative`, top padding, and **no**
  `overflow: hidden`, or the overhang is shaved off.
- **The accent is never a border.** It rides the badge; the card's ink outline
  stays continuous and one weight on all four sides. A `10px` accent border
  against `3px` sides flares the corners the radius rounds, and `--accent` is
  set inline only for a *team*, so on a solo card the whole border declaration
  resolves invalid and that edge loses its stroke entirely. `.standing-card` is
  the last one still on a border (`border-left`); it has both problems waiting
  in it, and no badge yet.
- **The shared list reaches teammates by `sendTo`, never `broadcast`.** On an
  accepted entry the server pushes `yourEntries` to that team's connected
  members only — the "no per-player entry counts in broadcasts" boundary is
  untouched — and sends it *before* the `entryAck`, so the authoritative copy
  lands ahead of the message that retires the client's optimistic one.

### Debug menu

Mostly off every game path — the Usage and Experimental sections are deletable
without the game noticing. Three sections are the exception: **Debug**, **Views**
and **Bots** are the only things outside normal play that mutate a live room, and
all three are host-only and enforced on the server.

The Debug section holds the round controls.

- **Its three controls are host-only and `playing`-only, enforced on the
  server.** `debugPause` and `debugSkip` are rejected in `shared/reduce.ts`;
  `debugFill` is rejected in `party/server.ts`. The panel also disables the
  buttons for non-hosts, but **that is a courtesy, not the boundary** — the
  panel renders in production, so the server assumes the buttons are missing.
- **`Room.paused` holds the milliseconds remaining, not the moment of
  pausing.** `phase.endsAt` is absolute and a pause must survive an arbitrary
  wait; resuming is `endsAt = now + paused`. While it is non-null `phase.endsAt`
  is stale by design, so `tick` returns early and every client timer reads the
  banked figure through `useRemaining`'s third argument instead of counting to
  a dead deadline.
- **A held round falls back to the ordinary idle horizon**, not a longer
  paused-specific one. `alarmOutcome` answers a stale room with `touch` while
  anyone is connected, so the people in the room keep it alive and an abandoned
  paused room reaps like any other.
- **`debugSkip` moves the deadline to now rather than transitioning itself**,
  so the round ends down the exact path a natural expiry takes — scoring, the
  archive write and the standings hand-off cannot drift from the real one.
- **Auto-fill loops `submitEntry`** rather than writing `entries` directly, so
  phase, duplicates-within-a-scorer, `MAX_ENTRIES` and the team-merged list all
  still apply. `fillWordsFor` in `shared/debug.ts` deals from a shared sub-pool
  so the lists *deliberately overlap* — independent draws would leave nothing
  for the Boggle rule to strike through.

**The view jumper** (`shared/views.ts`, the Views section) puts the whole room —
TV and phones — on any screen, and jumping to the screen already showing is the
panel's refresh button.

- **`VIEWS` is the catalog and the gate.** It is not the same list as
  `Phase["name"]`: `countdown` renders two different screens, so it appears twice
  and `currentView` tells them apart. `to` off the wire is checked with `isViewId`
  — an unknown id would fall off the end of `jumpTo`'s switch and return
  `undefined` as a `Room`.
- **A jump is not a phase transition.** `jumpTo` builds the target phase and
  leaves `history`, `settings` and `votes` alone — the point is to look at one
  screen without losing the state that makes it worth looking at. It is host-only
  and legal from **every** phase; a legal-phase list would be a jumper that could
  not reach most of what it lists.
- **`debugJump` is the second event `reduce` skips `settle` for.** Readiness is
  *forced* for a countdown target and *cleared* for every untimed one, and both
  halves are load-bearing: `settle` would tear down a countdown on a room below
  `MIN_PLAYERS`, and a fully-ready room arriving at `lobby`/`voting`/`scoring`
  would settle straight back out of the screen the jump just asked for.
- **`Room.viewNonce` is the remount key, and it rides in `RoomState` on
  purpose.** `HostView` and `PlayerView` key their phase screen on it, so a bump
  restarts CSS animations *and* screen-local state. Re-stamping the phase clock
  is not enough — `HostScoring` holds the swap, podium and footer in local state
  seeded at mount. It is public for the same reason FAST FORWARD is: a refresh
  the TV kept to itself would leave the phones on a reveal the room has been
  taken back to the start of.
- **The two views made of a round are stood up by `party/server.ts`, not
  `reduce`.** `jumpToView` chains `playing` → `fillEveryList` → `scoring`,
  because writing `entries` is the one mutation `reduce` deliberately does not
  own. Standings additionally requires an empty `history` before it synthesizes,
  or every refresh press would bank another round and the match would grow one
  per press.
- **Synthetic rounds stay out of the D1 archive for free.** `maybeArchiveBank`
  reads the `before` captured at the top of `onMessage`, and a room that
  synthesized its own round was not on `scoring` then. A jump out of a *real*
  results screen into standings banks and archives like any other.

**The bot bench** (`shared/bots.ts`, the Bots section) dresses the room with up
to 20 placeholder players, named for the fellowship, so one person at one laptop
can see a crowded screen.

- **Bots are inert, and `isWaiting` is the whole of that rule.** A bot is always
  counted as waiting and never counted toward `everyoneReady`'s floor, so it can
  neither hold a countdown down nor make a room startable that would not have
  started without it. Every "n of m ready" readout on a screen goes through the
  same predicate, so a bot never reads as the holdout.
- **They are `Player`s, deliberately.** `isBot?: true` is optional and absent on
  every real player, which is what keeps it off the persistence-migration list.
  Everything downstream — `rosterOf`, the reveal grid, the podium, auto-fill —
  treats a bot as a seat with no special case, and that is the feature.
- **`MAX_BOTS` is double `MAX_PLAYERS`, and bots hold no seat against the cap.**
  The join gate counts humans only, in `reduce` *and* at the connect gate, so a
  room dressed with twenty of them still takes real phones. The panel says which
  layouts are over their design limit rather than leaving it to look like a bug.
- **`debugBots` sets the population absolutely, and is *not* exempt from
  `settle`** — it needs no exemption, because inert scenery gives `settle`
  nothing to open or tear down. Trimmed bots take their `entries` with them, the
  same rule a kick follows.
- **`seatBots` runs at `enterTeams`, and touches bots only.** Team select is for
  humans picking; a placeholder has nothing to pick with, and an empty panel is
  the one thing that screen is dressed to avoid.

The rest is off every game path, and deletable without the game noticing.

- **`GET /debug/usage` on the Worker, live in every environment including
  production.** It was staging-only at first; that hid the only numbers worth
  watching behind a branch deploy. The endpoint is consequently public and
  unauthenticated, which is an accepted trade — it serves account-level usage
  counts, never tokens or room state. `handleUsage` in `party/server.ts` is
  where a gate goes if that changes; the client's `debugEnabled()` is a button,
  not a boundary.
- **`ENVIRONMENT` gates nothing** and is the only `var` left. It is the label in
  the panel footer, so a tab open against the wrong Worker is obvious.
- **Every figure in the panel reads the same from every environment.** Nothing
  is scoped to the Worker serving it: the Workers query is unfiltered and
  grouped by `scriptName`, so both deployed scripts are always listed and
  staging usage is checkable from production and vice versa. Durable Object and
  D1 counters are account-wide outright — a match played on staging moves
  production's bars.
- **The Workers allowance is per *account*, not per script.** 100,000/day
  across everything deployed, which is why that section leads with the account
  total and the per-script rows are a breakdown of it. Two independent bars at
  60% each would look survivable while being 120% of one allowance.
- `WORKER_SCRIPTS` in `party/usage.ts` mirrors the `name` fields in
  `wrangler.jsonc`. Renaming a Worker without updating it shows that script as
  permanently idle rather than as an error.
- **Local dev generates no Cloudflare analytics at all.** `wrangler dev` never
  reaches the edge, so nothing you do locally moves any bar. The Workers
  section says so rather than leaving it to be discovered.
- **One GraphQL request per metric, each with its own try/catch.** Cloudflare's
  analytics schema is discovered by introspection rather than published field
  by field, so a field name in `party/usage.ts` may be wrong. Batched, one bad
  name returns no data at all and the panel goes blank with no clue why; split,
  it nulls one bar and prints the error on it.
- **Vercel has no usage API on Hobby.** The panel shows the ceilings and links
  to the dashboard rather than inventing a number. `vercelService()` is the
  only place that changes if Vercel ever ships one.
- The panel deliberately ignores the design tokens for colour and shape: it is
  ink-on-ink with a teal rule because anything wearing the game's gold-and-cream
  buttons reads as a game control.

See "The debug usage panel" in `HOSTING.md` for the API token setup.

### Client

`src/net/room.ts` is a single `RoomStore` singleton exposed via
`useSyncExternalStore`; screens read `useRoom()` and call `roomStore.send(...)`.
Entries render optimistically and reconcile on `entryAck` (a 30s round cannot
wait on a round trip); `seq` is present only while an entry is unacked.

**Every host screen's back-out lives top-right, as `HostExit`** — a cream
outline on the field, deliberately not a `.btn`. Gold with a hard shadow means
"go forward" in this app, so the footer carries exactly one forward action and
the button that abandons the phase is never beside it. Closing the room is the
one host action that asks first (`ConfirmDialog`), because `endGame` kicks
everyone and cannot be undone by pressing it again. The round marker is
**omitted** on team select and voting: both only happen at `history.length ===
0`, so `HostHeader`'s `round` is optional.

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

### The scoring reveal

`HostScoring` plays a round's results as three frames — deal in, reveal line by
line, swap into final order. Every visible thing derives from **one integer**,
`step`, against a schedule built once in `shared/reveal.ts`: which words are out,
which are struck, whose emoji trails them, what each UNIQUE reads, what rank each
card ends on. Rules to keep:

- **`step` is derived from `scoring.startedAt`, not from a chain of timers.**
  `useRevealStep` (`src/reveal.ts`) counts lines off the server clock, the same
  arrangement the round timer uses and for the same reason. That is what lets
  **`PlayerScoring` run the identical reveal on every phone** — it builds the
  same schedule from the same arguments and strikes each word on the beat the TV
  does. Nothing about the reveal is ticked over the wire, and the two schedules
  must not drift: `playerOrder`/`lineOrder`/seed are the same in both screens.
- **FAST FORWARD is room state (`scoring.skipped`), not a local jump.** A skip
  the TV kept to itself would leave the phones crawling through lines the room
  has already been shown.
- **The phone shows the whole list from the first frame; only the *bad news*
  arrives over time.** It is your own list and you know what is on it. So
  `PlayerScoring` ignores `RowView.revealed` and reads only `struck`/`alsoShown`,
  and its strike delay is zero — the hold exists so a word on the TV never
  *appears* pre-struck, and here it has been on screen all along.
- **Readying up on the results screen banks the round.** `settle` treats
  `scoring` like `standings`: everyone ready advances with no host action, and
  the host's Standings button still overrides a half-ready room. This is why the
  `timesup -> scoring` tick clears every ready flag — carried over from the round
  just played, `settle` would bank the round before anyone read a word of it. The
  archive write is therefore keyed off the `scoring -> standings` *transition*
  (`maybeArchiveBank`), never off one trigger.
- **Every flash's alternating parity comes from an ordinal, never from a step.**
  `cardView` reports `strikeCount`/`flinchCount` and `rowView` reports
  `popCount` for exactly this: two strikes an even number of steps apart share a
  step parity, so a class keyed on the step does not change, the animation never
  re-fires and the flash is silently missed. The UNIQUE stat skips the trick
  altogether — it is **keyed on `strikeCount` so React remounts it**, which
  restarts the blink by definition. The card's dip cannot do that (a remount
  would drop its scroll position and its measured rect), so it keeps the A/B
  pair.

- **Nothing is stored per row and nothing is diffed.** A rule that needs its own
  piece of state belongs in `shared/reveal.ts` as a derivation.
- **A row is struck once any partner is already on screen.** Back-checking falls
  out of that with nothing watching for it, and `struckAt` is never earlier than
  the row's own step, so a word never appears pre-struck.
- **`flinchAt` is back-check strikes only** — the active card does not flinch at
  its own words.
- **The strike partners are re-derived here, not carried on `ScoredEntry`.**
  `alsoBy` keeps scorer ids, and the reveal needs the matching *rows*, because a
  word strikes at the step another column lands it. Re-clustering with the same
  `normalize`/`isMatch` leaves the wire format and the stored `Room` alone.
- **The frame-3 swap is measured, never calculated.** The DOM stays in deal
  order; columns are translated by `getBoundingClientRect` deltas, so the grid's
  arithmetic is not duplicated in the driver.
- **The marquee is measured too, and must not use `container-type`** — that
  zeroes an element's intrinsic width and collapses a shrink-to-fit team badge.
  `src/marquee.ts` re-measures on `document.fonts.ready`, because Bungee lands
  after first paint and a mount-only measurement says "it fits".

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
- `docs/superpowers/specs/2026-07-26-ok-name-one-ui-design.md` — the design
  system as first absorbed: tokens, shape constants, the never-scroll rule.
- `docs/superpowers/specs/2026-07-28-marquee-2a-design.md` — the second design
  handoff, covering the lobby, team select and category voting: the gold-band
  rule, top-right back-outs, the close-room confirmation, inset drawers, and
  the revised team accents. Read with `docs/design/2026-07-27-v1-screens-handoff.md`,
  which is the brief it answers.
- `docs/superpowers/specs/2026-07-28-score-persistence-design.md` — the D1
  archive: schema, where the writes happen, and the rule that the game never
  reads it back. Implemented (§14 steps 1–4); the write path has not yet been
  exercised by a real match, which is step 5.
- `docs/superpowers/specs/2026-07-29-freetier-debug-panel-design.md` — the
  debug menu. §§1–11 are the usage half: the `/debug/usage` route, why one
  GraphQL request per metric, the per-account Workers allowance, why Vercel is
  a link rather than a bar. **§12 is the round controls** — pause, skip,
  auto-fill, experiment flags, and why each is host-only. Implemented.
- `docs/superpowers/specs/2026-07-29-host-scoring-reveal-design.md` — the host
  results screen and its three-frame reveal: the merged card, the derive-from-one-
  integer schedule, the strike/back-check rule, the measured swap, the podium and
  the guarded footer swap. Read with `design_handoff_host_scoring_reveal/README.md`,
  which is the brief it answers. Implemented.
- `docs/superpowers/plans/2026-07-25-w104-mvp.md` — historical implementation
  plan. Fully executed; its code blocks and numbers are *not* current. Its
  "Deviations discovered during implementation" section is accurate and useful.
- `HOSTING.md` — deploy/CI runbook, staging environment, LAN phone testing.

## Workflow

Branch off `main`, open a PR. CI (`.github/workflows/ci.yml`) runs typecheck,
tests, build. Merges to `main` deploy production (Vercel for the app, GitHub
Actions → `wrangler deploy` for the Worker).

**Every PR bumps the version.** Vite's `define` substitutes `package.json`'s
`version` as `__APP_VERSION__`, which renders in Landing's corner and in the
debug panel's footer — so on a deployed URL it is the only way to tell a fresh
page from a cached one. Bump it in **three** places, all kept in sync:
`package.json`, `package-lock.json`'s top-level `version`, and the matching one
under `packages: { "": ... }`.

Two long-lived branches: `main` (production, `www.oknameone.com`) and `staging`
(`staging.oknameone.com` + the `w104-staging` Worker). **PRs no longer deploy
the Worker** — they used to, which meant any open PR overwrote the shared
staging Worker and changed what people testing on phones were talking to. Merge
to `staging` to test a `party/` change or to get a URL three phones can type.
Vercel still previews every PR, pointed at the staging Worker.

Named Wrangler environments do not inherit `durable_objects` bindings, so
`env.staging` repeats them.

Commits here stage explicit paths — never `git add -A`, so the untracked
working note `Project W-104.md` stays untracked.
