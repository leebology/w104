# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

w104 is a Jackbox-style party game: players join from their phones, one device
("create lobby") becomes the non-playing shared/TV screen. Everyone races to
list items in a category before a timer runs out; scoring is Boggle rules — a
word scores only if no other player wrote it.

v1 scope is a match of 1–10 rounds on the fixed category "woman", with the host
setting round count and a per-round timer from 15 seconds to 10 minutes. This
match structure has landed — see
`docs/superpowers/specs/2026-07-26-match-structure-design.md`. The long product
wishlist (`Project W-104.md`, untracked) is deliberately *not* built — see "Out
of scope" in the design spec before adding anything from it.

## Commands

Requires Node 22 (`.nvmrc`). Two terminals for a working local setup:

```bash
npm run dev:party    # wrangler dev — realtime Worker on 0.0.0.0:8787
```

```bash
npm run dev          # Vite web app on :5173 (binds all interfaces)
```

- `npm test` — Vitest, runs `shared/**/*.test.ts` only (129 tests)
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
  for a round that does not exist. `startGame` is legal from both lobby and
  standings and is still the one exception (host solo-start bypasses
  `MIN_PLAYERS`), and `reduce` skips `settle` for it.
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
- **`Room.history` holds aggregates only, never words.** It rides in
  `RoomState`, so an `entries` field on `RoundSummary` would leak every past
  round to every socket — the same boundary `toRoomState` exists to hold.

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
