# Category voting — design

Status: approved, ready for an implementation plan.
Supersedes the fixed single category (`DEFAULT_CATEGORY`) assumed by
`2026-07-25-w104-mvp-design.md`. Builds on the match structure defined in
`2026-07-26-match-structure-design.md`.

Visual source: `design_handoff_ok_name_one/Ok Name One MVP.dc.html`, frames
`Voting — Host (open) B`, `Voting — Host (closed)`, `Voting — Player (voting) A`,
`Voting — Player (spent)`. The tokens in that bundle's `README.md` are final.

## The idea

The category stops being fixed. After the host taps **Start game**, the room
votes once, up front, on which of 10 categories it wants to play. Every round
then draws from that vote pool weighted by share, and a category that has been
played is spent for the rest of the match — so the shares recalculate as the
match goes on, and a category the room voted for heavily is likely but never
certain to come up early.

Voting happens exactly once per match, not once per round.

## Rules

### The pool

10 categories, fixed set, fixed order, in `shared/categories.ts`:

```
woman · animal · song · movie · country ·
colour · sport · car · food · job
```

Singular and lowercase, per the existing copy voice. The array order is the
render order in every grid — nothing sorts it. Categories are rendered as text
only: no icon, no per-category emoji. The only emoji on a category card are
player avatars.

> **Revised 2026-07-27, sixteen down to ten.** Cut: `man`, `city` and `drink`
> each sat too close to a neighbour that survived (`woman`, `country`, `food`)
> to feel like a different round; `plant`, `brand` and `body part` have answer
> spaces too thin to reward a full timer.

The pool now exactly equals `MAX_ROUND_COUNT` (10). The draw runs at round N
with N-1 spent, so a full match reaches round ten with exactly one category
left: the pool is consumed to the last card but never runs dry. **A pool
smaller than the round cap would be a real bug**, not a shorter game — it would
make the guard below reachable and let a match replay a category.
`voting.test.ts` asserts `CATEGORIES.length >= MAX_ROUND_COUNT` for that
reason.

The trade this buys: at the full ten rounds every category gets played, so the
vote decides the *order* rather than the set. Below ten rounds — the common
case — it still decides which ones come up at all.

### The budget

`voteBudget(settings) = Math.max(1, settings.roundCount - 1)`

So 1 or 2 rounds give one vote each, 3 rounds two, up to 9 votes at 10 rounds.
It lives in `shared/voting.ts` and is called on both sides; neither the server
nor a component recomputes it inline.

**Stacking is allowed.** A player may spend several votes on one category to
push its odds, so votes are counts, not a set:

```ts
votes: Record<PlayerId, Record<string, number>>
```

### Visibility

Votes ride in `RoomState` and are broadcast to everyone, as a single payload.

This is a deliberate exception to the reflex the codebase otherwise follows. The
`toRoomState` boundary exists because a player's *words* are competitive
information during a live round. Votes are not: the host TV renders the full
tally to the whole room by design, so a player reading `RoomState` in devtools
learns exactly what they would learn by looking up. Guarding it would cost
per-connection encoding on every vote and every reconnect, in exchange for
nothing.

The player's phone still shows only their own votes — that is a UI decision (ten
avatars do not fit on a thumb-sized tile), not a privacy boundary.

### Spent categories are derived

`spentCategories(room) = room.history.map(h => h.category)`

Not stored. Same reasoning as `currentRound` and for the same payoff: history
only grows, and only at `showStandings`, so there is no second copy to fall out
of sync. Because the draw happens at the whistle and the previous round is
already banked by then, this list is always complete at the moment it is read.

### The draw

`pickCategory(votes, spent, roll)` in `shared/voting.ts`:

1. Weight every unspent category by its total votes. If any has weight, walk the
   cumulative distribution with `roll`.
2. If every voted category is already spent, fall back to equal weights over the
   unspent categories nobody voted for.
3. If nothing is unspent — unreachable while the pool is at least as large as
   the round cap — equal weights over the whole pool. A guard, not a case.

`roll` is a uniform `[0,1)` injected at the edge: the tick event carries it
(`{ t: "tick"; now; roll }`) and the Durable Object supplies `Math.random()`.
`reduce` stays pure, and the weighted pick is testable against fixed rolls
(`0`, `0.5`, `0.99`) rather than a stubbed global. `alarmOutcome` grows the same
parameter and threads it through.

The draw resolves at the **whistle** — the same tick that opens `playing` — so
there is no window in which a cancelled countdown could re-roll it, and nothing
on the countdown screen can leak it.

### Shares

`voteShares(votes)` returns integer percentages summing to exactly 100, by
largest remainder. Used only by the closed host screen. In `shared/voting.ts`
with tests, not in a component.

## State machine

Voting is bookended by a 5-second countdown on both sides. Nothing in this game
changes phase the instant a condition is met — the countdown is how every
transition announces itself — and voting is no exception.

```ts
| { name: "voting"; endsAt: number }
| { name: "countdown"; endsAt: number; to: "voting" | "playing" }
```

`VOTING_MS = 60_000`, alarm-driven like every other timed phase.

```
lobby
  │  all ready  │  host: Start game
  ▼
countdown (to: voting) ──5s──▶ voting
                                 │  all votes spent  │  host: Continue  │  60s expires
                                 ▼
                          countdown (to: playing) ──5s──▶ playing
                                 ▲                          (category drawn here)
                                 │                                │
   standings ◀── scoring ◀── timesup ◀──────────────────────────┘
       │
       └── all ready │ host: Next round ──▶ countdown (to: playing)
```

**Entering voting** has two triggers, not three: every connected player is ready,
or the host taps Start game. Either opens `countdown { to: "voting" }`, and
voting begins when those 5 seconds elapse. There is no lobby-side global timer —
a room with nobody in it should wait, not start.

**Leaving voting** has three: every connected player has spent their budget, the
host taps Continue, or the 60-second timer expires. All three open
`countdown { to: "playing" }` — including the timer, so the round always starts
the same way regardless of what closed the voting.

### `to` is stored, not derived

Every other derived value in this codebase is derived because history only grows
and a stored copy could drift. `to` is different: two distinct countdowns now sit
at `history.length === 0` — lobby→voting and voting→playing — so there is nothing
left to derive it *from*. It is stored on the phase, set once when the countdown
opens, and read by `tick` to decide what to open next.

Rounds 2+ are otherwise untouched: `standings → countdown { to: "playing" } →
playing`.

### Readiness is derived

There is no ready button on the voting screen. `castVote` sets
`player.ready = spent >= budget`; `resetVotes` clears the player's row and sets
`ready = false`. Because readiness is still the `ready` flag, `settle()` closes
voting with the machinery it already has, and the roster's ready pill and the
host header's `N READY` count both work unchanged.

`everyoneReady` grows a minimum parameter: `MIN_PLAYERS` for lobby and standings,
**1** for voting. The match has already begun by then, so a host solo-start must
be able to close voting with one player.

### Three consequences of inserting a phase before round one

- **Opening `voting` clears every ready flag.** This is not housekeeping, it is
  load-bearing: `ready` means "waiting in the room" on one side of the edge and
  "votes spent" on the other. Carry the lobby's flags across and the very next
  `settle` sees every connected player ready, closes voting on the spot, and the
  room never gets to vote. The clear happens in exactly one place — the `tick`
  that turns `countdown { to: "voting" }` into `voting` — which is the whole
  reason for routing both entry triggers through that one countdown.
- **The post-voting countdown is not readiness-cancellable.** `settle`'s cancel
  branch needs `MIN_PLAYERS` connected, so after a host solo-start it would tear
  down `countdown { to: "playing" }` on the very next event. That branch is
  therefore skipped when the countdown came out of voting. Readiness has already
  done its job by then; re-litigating it can only do harm.
- **Two different questions about a countdown, two functions.** `preRoundPhase`
  keeps its current job — where a *cancelled* countdown returns to — and keeps
  returning `"lobby" | "standings"`. A new `countdownScreen(view)` returns
  `"lobby" | "voting" | "standings"` and answers the client's question: which
  screen renders *under* the countdown. `to === "voting"` gives `lobby`;
  `to === "playing"` gives `voting` at round one and `standings` after. Those
  answers differ from `preRoundPhase`'s, which is precisely why overloading one
  function would be wrong.

### Aborting

`cancelStart` (**Stop**) follows `preRoundPhase` as it does today:

| From | Returns to | Clears |
| --- | --- | --- |
| `countdown { to: "voting" }` | lobby | `ready` |
| `countdown { to: "playing" }`, round 1 | lobby | `ready`, `votes` |
| `countdown { to: "playing" }`, round 2+ | standings | `ready` |

**Back to room** during voting (`backToLobby`, now legal from `voting` as well as
`standings`) clears `ready` and `votes` the same way. Once a match is abandoned
back to the room, the votes belong to a match that no longer exists.

### Messages

```ts
{ type: "castVote"; category: string }
{ type: "resetVotes" }
```

**There is no `skipVoting`.** The host's Continue button is `startGame`, which
already means "push this forward, force-readying everyone, and open a
countdown" — exactly what the user asked Continue to do. It becomes legal from
`lobby`, `voting`, and `standings`, opening `countdown { to: "voting" }` from the
first and `countdown { to: "playing" }` from the other two. It keeps its two
existing exemptions: it bypasses `MIN_PLAYERS`, and `reduce` skips `settle` for
it.

`castVote` and `resetVotes` from a non-player, or in any phase but `voting`,
return the identical room — silently, matching every other rejected action in
`reduce`. The `not-host` error code exists but has no sender today, and this is
not the place to add the first one.

Server validation, since a hand-rolled socket message is not bound by the UI:
the category must be in `CATEGORIES` and the player's total must be below their
budget. Any failure returns the identical room.

### Persistence

`createRoom` seeds `votes: {}`. `load()` gains `votes: rest.votes ?? {}`, since
`storage.get<Room>` is an unchecked cast over rooms written before this existed.
The nested record survives JSON, which a `Map` would not.

`to` needs the same treatment for a different reason: a room persisted *mid-
countdown* before this change has a `countdown` phase with no `to` at all, and
`tick` would then route it nowhere and hang the room. `load()` defaults it to
`"playing"` — the only thing that countdown could ever have meant.

## Screens

Host frames are 1200×675, player frames 390×844; both scale fluidly from there
rather than pixel-pinning. Neither ever scrolls the page — anything that
overflows scrolls inside its own box.

The handoff document
(`design_handoff_ok_name_one/README.md` plus the four canvas frames) is the
source of truth for every number below. This section records only the decisions
the handoff left open.

### Host — voting open (`HostVoting.tsx`)

Four rows of four in fixed order. **Card width is the odds**: each card is
`flex: <votes + 1> 1 0; min-width: 104px`, so a vote visibly grows its card with
no measurement and no JS. Name size steps with share so the leader reads from
the sofa. A card with no votes drops to `#F6D9C6`, loses its shadow, and shows
its name alone.

Avatars sit at the bottom-left of a card with `×N` when stacked; the total vote
count sits bottom-right in Bungee pink. The row is `overflow: hidden` and the
pink numeral is the graceful degradation — at ten players the avatars clip and
the number never does.

The footer drops the redundant `18 OF 30 SEC LEFT` caption from the existing
timer pattern. That is what frees room for **Back to room** (ghost — a cream fill
would vanish against the cream footer) and **Continue** (gold). It is the only
change to the footer treatment.

The handoff calls the gold button *Skip ahead*. It sends `startGame`, and what it
actually does is force-ready the room and start the countdown — the same thing
Start game and Next round do elsewhere. **Continue** says that; *Skip ahead*
implies the countdown is being skipped, which it is not.

### Host — voting closed

The same component, not a second screen — reached when `countdownScreen(room)`
returns `"voting"`, i.e. `countdown { to: "playing" }` at round one. The other
countdown that can sit at `history.length === 0` (`to: "voting"`) renders the
lobby, which is why the screen choice goes through `countdownScreen` rather than
a bare `phase.name === "countdown"` check.

Zero-vote categories are removed; survivors collect into the centre, the top
three share-weighted and the remainder at a fixed width — below roughly 10% the
differences are not worth a size difference. `Get ready… 5` on a TV-scaled
`.get-ready--tv` plaque, plus **Stop**.

**Nothing on this screen names the drawn category.** It has not been drawn yet.

**Transition:** ship the reduced-motion path for everyone in v1 — zero-vote cards
fade out, survivors cut to their new sizes, the plaque fades in. The specified
FLIP is the only thing in this feature that needs `getBoundingClientRect` and a
transform on the first frame; it layers on afterwards as a self-contained
follow-up, and the cut version has to exist regardless to satisfy
`prefers-reduced-motion`.

### Player — voting (`PlayerVoting.tsx`)

Three bands: pinned head, scrolling grid, pinned foot. The votes-left numeral is
the loudest thing on the screen and animates on every tap; a pip row underneath
carries the budget. A voted tile takes the player's own avatar in a gold pill at
the top-left corner, with `×N` when stacked — the grid's padding is clearance for
those badges and the offset shadows, not decoration.

**Reset votes** is the only way to change a vote. Tiles add; they do not toggle.
That keeps a stacked tile unambiguous, and reset is the recovery from a mis-tap.

### Player — spent

The same component with `votesLeft === 0`. Tiles lock by dropping their shadow
and translating into where it was — the button's own press physics, so "locked"
needs no new colour or icon. The head card swaps the numeral for the player's
avatar and says who is still being waited on. **Reset votes** stays live.

### Player — during the round-1 countdown

Not covered by the handoff; resolved here. `PlayerVoting` stays mounted in its
locked state and the foot swaps the timer for the existing `.get-ready--small`
plaque. The lock is driven by `phase.name === "countdown" || votesLeft === 0`,
so a player who never spent their votes before the 60s expired locks too rather
than being handed a live grid during the countdown. **Reset votes** goes away
here — voting is over, and `resetVotes` is rejected outside the `voting` phase
anyway, so leaving the button on screen would offer an action the server ignores.

### Elsewhere

- `HostLobby`'s button becomes **Start game**. `HostStandings` keeps **Next
  round** — it starts a round, not a match.
- `HostLobby` and `PlayerLobby` **keep** their `countdown` branches unchanged.
  The lobby countdown still exists; it now counts down to voting rather than to
  a round, and neither screen has to know the difference.

## Out of scope

- Host-curated category lists. All 16 are always votable.
- Re-voting mid-match. When the voted categories run out, remaining rounds draw
  uniformly from the unvoted ones — see the draw, step 2.
- Revealing the drawn category before the whistle.
- The FLIP transition (deferred, above).
- Per-category emoji or art.

## Testing

All rules land in `shared/`, so they test in milliseconds.

`shared/voting.test.ts`:
- `voteBudget` across `roundCount` 1–10, including the `max(1, …)` floor.
- `pickCategory` at fixed rolls: proportionality, boundary rolls (`0`, just under
  a cumulative edge, `0.999…`), the spent filter, the unvoted fallback, and the
  all-spent guard.
- `voteShares` sums to exactly 100 across cases that expose largest-remainder
  rounding.

`shared/reduce.test.ts`:
- `castVote` caps at the budget, stacks on one category, rejects an unknown
  category and any phase but `voting`.
- `resetVotes` clears the row and un-readies; it is rejected outside `voting`.
- Both entry triggers open `countdown { to: "voting" }`, and the tick that opens
  `voting` clears stale lobby readiness — so the natural everyone-readies-up path
  does not close voting the instant it opens. This is the subtlest rule in the
  design; it gets its own test.
- All three exit triggers — all-spent, the 60s tick, and host `startGame` —
  open `countdown { to: "playing" }`. A non-host `startGame` does nothing.
- `tick` routes a countdown by its `to`, not by `history.length`.
- A solo host-start survives: `countdown { to: "playing" }` is not torn down by
  the next event.
- `cancelStart` returns to lobby / lobby / standings per the aborting table, and
  clears `votes` on the two lobby paths. `backToLobby` from voting does the same.
- `nextAlarmAt` returns the voting deadline while voting.

`shared/state.test.ts`:
- `votes` survives `toRoomState`; `spentCategories` tracks `history`.
