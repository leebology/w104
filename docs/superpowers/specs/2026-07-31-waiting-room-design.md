# The waiting room — design

**Date:** 2026-07-31
**Status:** implemented (§13 steps 1–8)
**Builds on:** `2026-07-27-teams-design.md` (the `Scorer` seam and team
membership), `2026-07-26-match-structure-design.md` (the standings phase and
the inter-round countdown), `2026-07-28-marquee-2a-design.md` (the host header
and the room chip).

## Problem

A player who arrives after the host has started is refused outright. The
connect gate answers `game-in-progress` and their phone lands back on Landing:

```ts
// party/server.ts, onConnect
const known = this.room.hostId === playerId || existing !== undefined;
if (!known && this.room.phase.name !== "lobby") {
  return this.reject(conn, "game-in-progress", "That game is already running.");
}
```

In a living room that is the wrong answer. Somebody's phone was on 1%, somebody
took a call, somebody walked in during round two. The room's only recourse today
is for the host to press Back to room, throwing away every round played so far,
and start the match again.

This change gives the room a **waiting room**: a latecomer is seated
immediately, sits out the round in progress, and is dealt into the next one.

## Scope

- `join` becomes legal in every phase. Past the lobby a newcomer is seated
  **waiting**.
- A waiting player is inert: no word list, no vote, no readiness, no place in
  the standings, no scorer.
- They are **admitted at the whistle** — the tick that opens `playing` — and
  play from that round on.
- With teams on they must **pick a team first**; without one they are not
  admitted and simply wait for the whistle after that.
- The host TV shows who is waiting, as badges immediately right of the room
  chip.
- The phones get a waiting screen, which carries the same `GetReady` card the
  room gets when the countdown that will admit them opens — **with no Stop and
  no un-ready.**

## Non-goals

- **A latecomer does not vote.** Category voting is one 60-second window at the
  top of the match; somebody who arrives after it closed missed it, and there
  is nothing to re-open. `castVote` is rejected from the waiting room.
- **No mid-match team re-pick for the room.** Only the latecomer picks; the
  teams that are playing are not disturbed, cannot be renamed by a waiting
  player, and are not re-balanced by their arrival.
- **No holding a round open for someone.** The room never waits on a waiting
  player, in either direction: they cannot delay a countdown and they cannot
  make one open.
- **No host admit/refuse control.** The gate is the whistle, not a person. The
  host already has kick.
- **No second lobby screen on the TV.** The waiting strip is a read-out in the
  header, not a panel and not a control.
- **No change to `MAX_PLAYERS`.** A waiting player holds a real seat and counts
  against the cap.

---

## 1. What a waiting player *is*

One optional flag on `Player`, and two predicates.

```ts
// shared/state.ts
export type Player = {
  // …
  /**
   * Seated, but not in the match yet: they joined past the lobby and are
   * waiting for the next whistle. Inert in every derivation — see
   * `shared/waiting.ts`.
   *
   * Optional, and absent on everyone in a room stored before this landed,
   * which reads as seated through `inWaitingRoom` — the correct answer, since
   * such a room has no waiting players by construction. That is why there is
   * no `load()` fallback for it, unlike `paused` or `revealLineMs`.
   *
   * `boolean` rather than the `true` literal `isBot` uses, because unlike
   * `isBot` this one is *cleared*: returning to the lobby seats everybody.
   */
  waiting?: boolean;
};
```

```ts
// shared/waiting.ts — new module
import type { Player } from "./state";

export const inWaitingRoom = (p: Player): boolean => p.waiting === true;
export const isSeated = (p: Player): boolean => !inWaitingRoom(p);
export const seatedPlayers = (ps: Player[]): Player[] => ps.filter(isSeated);
export const waitingPlayers = (ps: Player[]): Player[] => ps.filter(inWaitingRoom);
```

Its own module, importing **types only**, for the reason `shared/rng.ts` and
`shared/revealtiming.ts` have theirs: `shared/teams.ts` needs `isSeated` inside
`rosterOf`, and anything that imported `teams.ts` back would close a cycle. The
admission rule, which does need `teamsEnabled`, therefore lives in
`shared/reduce.ts` beside `enterTeams` and `bankRound` — the other two phase-edge
helpers.

### A naming collision worth stating

`shared/bots.ts` already exports `isWaiting(player)`, and it means something
else entirely: *"not the one everybody is waiting on"* — ready, or a bot. It is
about readiness and has nothing to do with this. Nothing is renamed (it is
threaded through the pills, the standings rows and `everyoneReady`), so the new
predicates are deliberately named for the *room* rather than the state:
`inWaitingRoom` / `isSeated`, never `isWaiting`.

---

## 2. The connect gate

The phase check in `onConnect` goes away. Nothing else there changes:

```ts
// party/server.ts
const existing = this.room.players.find((p) => p.id === playerId);
const known = this.room.hostId === playerId || existing !== undefined;
// The phase gate that lived here is gone: a newcomer past the lobby is now
// seated into the waiting room by `join` rather than turned away.
if (!known && role === "player" && this.room.players.filter(isHuman).length >= MAX_PLAYERS) {
  return this.reject(conn, "room-full", "That room is full.");
}
```

The cap stays, and it counts waiting players — they hold a seat, they are going
to be in the next round, and a room of ten plus three waiting is a results
screen with thirteen columns on it one round later.

**`game-in-progress` stays in `ErrorCode` and in `isFailedJoin`.** Nothing emits
it any more, but staging and production run independently deployed Workers, and
a new client pointed at an old Worker must still handle the answer it gets.
Deleting the code is a separate cleanup, once both are past this.

---

## 3. Seating — `join`

```ts
case "join": {
  if (room.players.some((p) => p.id === ev.playerId)) {
    // Unchanged. `...p` carries `waiting` across, so a waiting player's
    // reconnect does not smuggle them into the round.
    return { ...room, players: mapPlayer(/* … */) };
  }
  if (room.players.filter(isHuman).length >= MAX_PLAYERS) return room;
  return {
    ...room,
    players: [...room.players, {
      id: ev.playerId, name: ev.name, emoji: ev.emoji,
      ready: false, connected: true, teamId: null,
      // The lobby seats people into the match; every other phase seats them
      // into the waiting room. One rule, no phase list to keep in sync.
      waiting: room.phase.name !== "lobby",
    }],
  };
}
```

**Uniform across every non-lobby phase, `teams` and `voting` included**, and
that is deliberately not a hardship: admission is at the *whistle*, and the
whistle into round one is a whistle. Somebody who joins during team selection or
during the category vote is admitted for round one and misses nothing but the
ballot. Only an arrival after round one has started actually waits.

The alternative — a list of phases that join normally — would have a newcomer
able to tear down a live countdown, hold a vote open, or move a team panel under
somebody's thumb, for the sake of a case the uniform rule already handles.

`ready` stays honestly `false` for a waiting player and is never propped up.
Nothing reads it, because §4 removes them from the only thing that does.

---

## 4. Inert: what a waiting player is excluded from

Every exclusion below is a filter at the single place the rule already lives —
none of them is a new special case at a render site.

### Readiness — `everyoneReady`

```ts
function everyoneReady(room: Room, min: number): boolean {
  const active = room.players.filter((p) => p.connected && isSeated(p));
  return active.filter(isHuman).length >= min && active.every(isWaiting);
}
```

One line, and both halves of the inertness fall out of it: a waiting player is
not counted toward `readyFloor`, so they can never make a room startable that
would not have started; and they are not asked whether they are ready, so they
can never hold a countdown down or tear one back off the screen. This is the
same shape the bot rule has, arrived at from the other side.

The consequence worth naming: a room whose seated players have all left, with
one waiting player connected, sits where it is. `readyFloor` past the lobby is
1, and the floor counts seated humans only, so nothing opens. That is right — a
waiting player alone has no match to be admitted to — and the idle reap takes
the room as it takes any other.

### Scoring — `rosterOf`

```ts
export function rosterOf(view: TeamView & Pick<Room, "settings">): Scorer[] {
  if (!teamsEnabled(view.settings)) {
    return view.players.filter(isSeated).map((p) => ({ /* … */ }));
  }
  return view.teams
    .map((t) => ({
      // …
      members: membersOf(view, t.id).filter(isSeated).map((p) => p.id),
    }))
    .filter((s) => s.members.length > 0);
}
```

`rosterOf` is already "the one place the empty-teams rule lives", and this is
the same kind of rule, so it goes in the same place. Everything downstream is
then correct for free and without knowing this feature exists:

- `scoreRound` has no column for them, so the reveal has no column for them.
- `placeRound` gives them no place, so `roundPoints` prices the round at the
  size it actually had.
- `computeStandings` iterates the roster, so they are not on the board — and
  once admitted, its existing "rounds this scorer was actually in" filter gives
  them a strip with no hole and no phantom last place. That code was written for
  exactly this and has never had a caller until now.
- `driverOf` picks from `scorer.members`, so a waiting teammate cannot own a
  column of the scroll mirror.
- `roundRows` and `gameResultRows` archive the round as it was played.

**`membersOf` is deliberately *not* filtered.** It is display truth — who is on
this team — and the team tiles want to show a latecomer who has picked. The
filter belongs at the scoring boundary, which is exactly one function.

### Words — `submitEntry`

```ts
export function submitEntry(room, playerId, text, now): SubmitResult {
  if (room.phase.name !== "playing") return { room, accepted: false, reason: "not-playing" };
  const me = room.players.find((p) => p.id === playerId);
  if (!me || inWaitingRoom(me)) return { room, accepted: false, reason: "not-playing" };
  // …
}
```

Not optional and not covered by the roster filter: the existing scorer lookup
falls back to `[playerId]`, so without this a waiting player's socket would have
its words accepted into `entries` under its own key — invisible to the reveal,
but present in `entries` and archived as words in a round they were not in.

`fillEveryList` needs no change: it deals to `rosterOf`'s members, which are
seated by construction.

`sendEntriesToTeam` gets an early return for a waiting sender, so a latecomer is
never pushed their team's live word list mid-round. That is a privacy boundary,
not a tidy-up: the team's list is secret from everyone who is not writing it.

### Votes, readiness, renames

- `castVote` and `resetVotes`: rejected from the waiting room (see Non-goals).
- `ready`: rejected. There is no Ready button on the waiting screen, and a
  hand-rolled message must not set a flag `settle` would then read past
  admission.
- `setTeamName`: stays `inTeamSelect`-only. A waiting player has not joined the
  team yet, and renaming one that is mid-match is not theirs to do.

---

## 5. Picking a team while waiting

With teams on, admission requires a team. The picker is the only thing a waiting
player can do to the room.

```ts
/** Where the team actions are legal: team select, and the waiting room. */
function mayPickTeam(room: Room, playerId: PlayerId): boolean {
  if (inTeamSelect(room)) return true;
  if (!teamsEnabled(room.settings)) return false;
  const me = room.players.find((p) => p.id === playerId);
  return me !== undefined && inWaitingRoom(me);
}
```

`joinTeam` and `leaveTeam` gate on this instead of `inTeamSelect`. Two things
inside `joinTeam` must **not** apply to a waiting player, and both are the
difference between a picker and a participant:

- **`ready: true` is not set.** The flag means "on a team" only inside team
  select; for a waiting player it would be a readiness nothing can un-set and
  nothing should read.
- **The countdown is not re-stamped.** `joinTeam` puts the full countdown back
  when someone switches teams mid-count, because the room needs a chance to
  react. A latecomer picking a team is not something the room reacts to, and a
  latecomer able to extend the room's countdown — repeatedly — is a latecomer
  able to stop the match.

A waiting player may change or leave their team freely right up to the whistle,
because admission is evaluated at the whistle and nowhere earlier.

### The dealers ignore the waiting room

`assignStragglers` treats a waiting player as already placed, and `balanceTeams`
deals only seated players. Both are internal to the two functions, so no call
site changes.

This is the explicit requirement that a latecomer **choose**: the host's
Continue out of team select, the auto-assign backstop at the voting tick, and
Auto sort must none of them put somebody on a team they never picked and cannot
be held to. It also keeps Auto sort honest — it is the host re-dealing *the
match*, and the match does not include the waiting room.

---

## 6. Admission — at the whistle, nowhere else

```ts
/**
 * Seats every waiting player the next round can take.
 *
 * Called from exactly one edge: the `countdown -> playing` tick, beside the
 * category draw, and for the same reason that draw lives there. Admitting when
 * the countdown *opens* would have to be undone when it is cancelled, and a
 * two-way write is a state machine with a second copy of the truth in it.
 * Admitting at the whistle makes a cancelled countdown a genuine no-op: the
 * latecomer simply keeps waiting.
 *
 * Two conditions, both about whether putting them in the round is honest:
 *
 * - **Connected.** The waiting room's promise is "you are in the next round".
 *   A phone that is not there arrives as an empty column on the TV and a last
 *   place in the standings for somebody who is not playing, and the next
 *   whistle costs them nothing, because they were not playing either way.
 * - **On a live team, when teams are on.** See §5. `null`, or an id naming no
 *   current team, both count as no team.
 */
function admitWaiting(room: Room): Room {
  const live = new Set(room.teams.map((t) => t.id));
  const needsTeam = teamsEnabled(room.settings);
  const players = room.players.map((p) => {
    if (!inWaitingRoom(p)) return p;
    if (!p.connected) return p;
    if (needsTeam && (p.teamId === null || !live.has(p.teamId))) return p;
    return { ...p, waiting: false };
  });
  return players.some((p, i) => p !== room.players[i]) ? { ...room, players } : room;
}
```

Wired into the one tick that opens a round:

```ts
// tick(), countdown -> playing
return {
  ...admitWaiting(room),
  category: pickCategory(room.votes, spentCategories(room), roll),
  phase: { name: "playing", endsAt: now + room.settings.durationSec * 1_000 },
};
```

That is the whole of the rule, and it covers both whistles: the one out of
voting into round one and the one out of standings into round *n*. Nothing else
in `reduce` writes `waiting` except the two lobby edges in §7.

`debugSkip` reaches this path too, because it moves the deadline rather than
transitioning itself — which is exactly why it was built that way.

---

## 7. Leaving the waiting room the other ways

- **`backToLobby`** seats everybody: its existing player map gains
  `waiting: false` alongside `ready: false, teamId: null`. Back in the room
  there is no match to be outside of.
- **`leaveRoom`** becomes legal for a waiting player in **any** phase, not just
  the lobby. The reason that event is lobby-only is that walking out mid-match
  leaves a half-scored round and a hole in the standings — a waiting player has
  neither, so giving up the seat costs the room nothing and frees a slot under
  `MAX_PLAYERS`.
- **`kick`** already works: it removes the player outright.
- **The view jumper.** `jumpTo("lobby")` clears `waiting` with the rest of the
  reset. Every other target **admits** — `admitWaiting` first, then
  `standUpTeams`, so an admitted player with no team is placed by the jump. A
  jump is a teleport, not a promise, and the debug menu's job is to show the
  screen as the room would really have it.

---

## 8. The host TV — the waiting strip

Immediately right of the room chip, in the header's `left` slot, on every host
screen the chip appears on.

```tsx
// src/components/RoomChip.tsx
export function RoomChip({ room }: { room: RoomState }) {
  return (
    <div className="room-chip-group">
      <div className="pill room-chip">{/* unchanged */}</div>
      <WaitingStrip room={room} />
    </div>
  );
}
```

**The strip lives inside `RoomChip` rather than beside it at six call sites**,
which is the arrangement `TeamBadge` has and for the same reason: it is then
correct wherever the chip is dropped, and a new host screen gets it by using the
chip rather than by remembering a rule. The six call sites change from
`code={room.code}` to `room={room}`.

`HostLobby` draws its own chip and needs none of this — there are no waiting
players in a lobby, by construction.

### What it draws

```tsx
/**
 * Who is joining next round, in the corner the room already reads.
 *
 * One badge shows the face and the name; two or more show faces only. That is
 * not a space saving so much as the honest amount of information: one arrival
 * is a person the room can greet by name, and five arrivals are a *number* —
 * five names in the header would compete with the room code, which is the one
 * thing in that corner that has to stay legible from a sofa.
 *
 * Nothing here is a control. The host's way to remove somebody is kick, from
 * the lobby, and a control in this corner would sit one pixel from the join
 * instruction on a screen being driven with a trackpad from across a room.
 */
function WaitingStrip({ room }: { room: RoomState }) {
  const waiting = waitingPlayers(room.players);
  if (waiting.length === 0) return null;
  // …
}
```

- **Empty renders nothing at all** — no label, no zero. The common case is a
  match with nobody waiting, and the header must look exactly as it does today.
- **One:** emoji + name, in a pill sized like the chip's own label.
- **Two or more:** emoji only, overlapping left-to-right the way an avatar
  stack does, in join order. Past six, the sixth is replaced by `+n`, so the
  strip has a maximum width and the room code never moves.
- **Teams on:** a badge whose player has picked wears that team's accent as a
  ring, set inline as `--accent` from `TEAM_COLORS[colorIndex].token` — the
  colour is what the room navigates teams by, and a swatch says which team in
  less room than a name. A badge whose player has **not** picked is drawn
  hollow, and that is the useful signal on this screen: it is the host's only
  view of the one thing standing between a latecomer and the next round.
- **Disconnected:** the existing `--gone` dimming. Same rule, same reason: they
  will not be admitted while they are like that.
- `aria-label` on the strip carries the full list of names, since the emoji
  stack does not.

The strip is `flex: 0 1 auto` with `min-width: 0` inside the group and the chip
is `flex: 0 0 auto`, so the strip is what gives when the header is tight — never
the room code.

---

## 9. The phone — `PlayerWaiting`

`PlayerView` renders it **ahead of the phase switch**, because a waiting player
is not on the room's screen at all:

```tsx
const me = room.players.find((p) => p.id === getPlayerId());
if (me && inWaitingRoom(me)) return <PlayerWaiting room={room} playerId={me.id} … />;
```

It sits inside the `viewNonce` fragment with the other screens, and outside the
entry-input overlay, which is untouched — the input stays mounted and offstage,
so a player admitted at the whistle gets the same keyboard behaviour everybody
else does.

### What it says

A locked, never-scrolling mobile screen, like its neighbours. Three things, in
this order:

1. **Where the room is.** "Round 2 of 3 is being played", "The room is voting on
   categories", "Reading the results" — derived from `room.phase.name` and
   `currentRound(room)`. It is the only thing on this screen that changes on its
   own, and without it the screen is a spinner.
2. **The promise.** "You're in from the next round." When
   `matchComplete(room)` it says the honest thing instead — this match has
   finished, and they are in the next one the host starts.
3. **The team picker**, when teams are on. `PlayerTeams` gains a `waiting` prop
   rather than a second grid being written: same tiles, same colours, same Leave
   button, with the title plaque reading "Pick a team to join the next round"
   and the **name editor suppressed** (§4). When the picker is not needed — teams
   off, or a team already picked — its slot holds the chosen `TeamBadge`, or
   nothing.

### The countdown

When the phase is `countdown` with `to: "playing"` and this player is eligible,
the same `GetReady` card every other screen in the game wears, posed over the
dimmed screen, labelled `ROUND n`:

```tsx
{countdown && eligible && (
  <div className="countdown-pose">
    <GetReady remaining={remaining} label={`ROUND ${currentRound(room)}`} />
  </div>
)}
```

- **No `onStop`.** That prop is the host's cancel and never appears on a phone.
- **No Ready button anywhere on this screen**, so there is nothing to un-ready.
  This is the one countdown in the game with no brake on it, and the reason is
  that the room did not agree to it on this player's account — the seated
  players' readiness opened it, and a latecomer who could tear it down could
  hold the match open indefinitely.
- A `to: "voting"` countdown shows **no card**: it admits nobody.
- An **ineligible** waiting player — teams on, no team — gets no card either.
  The picker stays lit and undimmed through the count, and a tap that lands
  before the whistle still gets them in, because §6 evaluates admission at the
  tick and not when the card went up. **The card is not the deadline; the
  whistle is.**

---

## 10. The archive

One real defect to fix, in `party/server.ts` rather than in any row builder.

`word.player_id` and `participation.player_id` both `REFERENCES player(player_id)`,
and D1 enforces foreign keys. `player` rows are written once, at
`archiveGameStart`. A latecomer admitted in round three therefore writes word
rows against a `player_id` with no parent, and the whole 50-statement chunk
carrying them fails — the round's words are lost, silently, as the archive is
designed to lose things.

The fix is to re-emit the game-start rows at each bank, before the round:

```ts
// archiveBankedRound, inside the existing waitUntil'd IIFE
await archiveGameStart(this.env.DB, gameStartRows(banked, { /* … */ }));
await archiveRound(this.env.DB, roundRows(banked, results, placeRound(results), { /* … */ }));
```

No new row shapes and no new SQL: every statement in `archiveGameStart` is
already idempotent by construction — `player` upserts `last_seen_at`, `game` and
`participation` are `DO NOTHING` — which is the property that makes re-emitting
them free. A latecomer picks up a `participation` row carrying the team they were
on when they first banked a round, and re-runs never overwrite it.

The cost is roughly a dozen extra statements per round on a path that is already
`waitUntil`'d and already allowed to fail.

---

## 11. Failure handling

| Situation | Behaviour |
| --- | --- |
| Player joins during a round | Seated waiting; TV badge appears; admitted at the next whistle |
| Player joins during the final standings | Seated waiting; screen says the match has finished; seated normally when the host returns to the room |
| Waiting player's phone dies before the whistle | Not admitted; keeps their seat; admitted at the whistle after they reconnect |
| Waiting player never picks a team | Never admitted; picker stays on their screen; hollow badge on the TV says why |
| Waiting player picks a team during the countdown | Admitted — admission is read at the tick |
| Countdown cancelled by a seated player un-readying | Nothing to undo; the latecomer is still waiting |
| Waiting player closes the tab | Ordinary disconnect; keeps their seat until the reap |
| Waiting player taps Leave | Seat freed immediately, in any phase |
| Host kicks a waiting player | Removed and banned, exactly as from a lobby |
| Host presses Back to room | Everybody seated, waiting room emptied |
| Room fills to `MAX_PLAYERS` with waiting players | Further joins get `room-full`, as today |
| Hand-rolled `submitEntry` / `castVote` / `ready` from the waiting room | Rejected in `shared/`, not only hidden in the UI |
| Stored room from before this change | No `waiting` key anywhere; reads as everyone seated; no `load()` fallback needed |

---

## 12. Tests

`shared/waiting.test.ts` — the predicates, including the absent-field case.

`shared/reduce.test.ts`:

- `join` past the lobby seats waiting, in each of `teams`, `voting`,
  `countdown`, `playing`, `timesup`, `scoring`, `standings`.
- `join` in the lobby is unchanged.
- A waiting player's reconnect stays waiting.
- `MAX_PLAYERS` counts waiting players.
- Admission: connected + teams off → admitted at the whistle; connected +
  teams on + team → admitted; no team → not; disconnected → not; a `teamId`
  naming a dead team → not.
- A waiting player does not open a countdown from `standings`, does not hold
  one down, and is not counted in `readyFloor`.
- `ready`, `castVote`, `resetVotes`, `setTeamName` from the waiting room are
  no-ops returning the identical object.
- `joinTeam` from the waiting room does not set `ready` and does **not**
  re-stamp a running countdown; from team select it still does both.
- `backToLobby` clears `waiting`; `leaveRoom` works from a non-lobby phase for
  a waiting player and is still refused for a seated one.
- `debugJump` to `lobby` clears; every other target admits.

`shared/teams.test.ts` — `rosterOf` excludes waiting players in both branches;
a team whose only member is waiting does not score; `membersOf` still lists
them; `assignStragglers` and `balanceTeams` leave them alone.

`shared/standings.test.ts` — an admitted player's badge strip and points from
their first round; the rounds before it price at their own size.

`shared/mirror.test.ts` — a waiting teammate is never `driverOf`.

`shared/archive.test.ts` — a round banked with a player who joined mid-match
emits `player` and `participation` rows for them.

`submitEntry` — rejected from the waiting room with `not-playing`.

---

## 13. Implementation order

Each step typechecks under **both** projects and leaves the suite green.

1. `Player.waiting`, `shared/waiting.ts`, and its tests. Nothing reads it yet.
2. The exclusions: `everyoneReady`, `rosterOf`, `submitEntry`,
   `castVote`/`resetVotes`/`ready`, `sendEntriesToTeam`. Still unreachable —
   nothing sets the flag.
3. `join` seats waiting; `admitWaiting` and the whistle; `backToLobby`,
   `leaveRoom`, the jumper. The rules are now complete and tested with no UI at
   all.
4. The connect gate in `party/server.ts`. **The feature is live from here** —
   a latecomer is seated and admitted, with no screen to say so.
5. `PlayerWaiting`, the `PlayerTeams` `waiting` prop, the `PlayerView` branch.
6. `RoomChip` takes `room`; `WaitingStrip`; the six call sites; the CSS.
7. The archive fix in `archiveBankedRound`.
8. Bump the version in all three places and open the PR against `staging`.

Steps 1–3 are the whole design and are pure `shared/` work under the existing
vitest glob. Step 4 is one deletion. Steps 5–7 are independent of each other.

---

## 14. Deviations discovered during implementation

### The custom categories merge

This spec was written against a base that predated the custom categories
feature (`2026-07-30-custom-categories-design.md`), which landed on `staging`
first and adds a `creating` phase. The uniform seating rule in §3 covered it for
free — a latecomer during `creating` is seated waiting, like any other phase —
but the phase needed its own exclusions, and one of them is the sharpest case in
the feature:

- **`quotaOfRoom` in `shared/customCategories.ts` is now the only way to ask for
  the quota**, and it counts seated players. Previously the server and three
  screens each called `quotaFor(room.players.length, …)`. Counting the waiting
  room would move everybody's quota the instant somebody walked in — slots
  appearing or vanishing mid-word, and `hasWrittenAll` silently un-readying a
  player who had finished — and a phone disagreeing with the server about the
  count would draw a slot the server refuses.
- **`writeSlot`, `moveCursor` and `clearDraft` refuse a latecomer**, the same
  way `castVote` does.
- **`closeCreating` builds the pool and the deal from `writersOf` alone.** An
  author who never wrote would have their share filled with house cards under
  their name, which is a lie the authorship reveal tells on the TV; and a hand
  dealt to somebody who cannot spend it costs every card in it its exposure,
  which is the one property §4 of that spec exists to guarantee.
- `PlayerWaiting`'s status line gained `creating` and `to: "creating"` cases —
  caught by tsc, since the function has an explicit return type.
- Six more render sites needed the seated filter: `HostCreating`'s columns,
  wall and ready count, `HostVotingCustom`'s two `VotingCount`s,
  `PlayerVotingCustom`'s waiting count and write quota, `PlayerCreating`'s
  quota and waiting count, and the two new `RoomChip` call sites.

### The three from the first pass

All small.

- **The team grid was extracted rather than re-flagged.** §9 proposed a
  `waiting` prop on `PlayerTeams`. `PlayerTeams` is a whole `<main class="screen">`
  and cannot be nested inside the waiting screen, so instead the tiles came out
  as `src/components/TeamGrid.tsx` and both screens render it. Same intent —
  one grid, not two — with the title slot, the name editor, the footer and the
  countdown card staying with whichever screen owns them.
- **`startGame` no longer force-readies the waiting room.** Not foreseen: the
  host's Start maps `ready: true` over every player, so a latecomer arrived at
  the countdown flagged ready. Inert, since `everyoneReady` skips them, but it
  is a value nothing reads and nothing they can clear, and the next screen
  would have rendered it. Both branches now skip anyone in the waiting room.
- **The archive re-emits *seated* players only** (§10). Emitting everyone was
  the obvious reading, but `participation` is `ON CONFLICT DO NOTHING`, so a
  latecomer archived at the bank *before* they were admitted would freeze a
  null `team_id` against somebody who then plays every remaining round on a
  team. Waiting for the first bank they are actually in costs nothing: it is
  the same bank their first words are written by, so the parent row still lands
  ahead of them.
