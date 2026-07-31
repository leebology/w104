# Scroll mirror — design

Status: designed, not implemented.

During the results reveal a player scrolls their own word list on their phone,
and their column on the host TV follows. The room looks where the player is
looking.

This is the sibling of self-validation (`shared/selfstrike.ts`): a player action
taken on the results screen that the TV reflects, so the room argues about the
same word at the same time. The difference is that a self-strike is a discrete
decision the round keeps, and a scroll is a continuous gesture the round should
forget.

## Problem

`PlayerScoring` shows a player their whole list from the first frame, in a
scroll box. `HostScoring` shows every scorer as a column, each with the same
`WordList` in its own scroll box. The two are unconnected. A player who wants
the room to look at word 40 of their list can only say "scroll down" out loud,
and nobody on the sofa is holding the TV's remote.

## Scope

- A player's scroll drives their own column on the host TV, and only there.
- Live once the reveal has finished. Not during it.
- Teams: one member drives the team's shared column.

## Non-goals

- **No indication on the phone that it is driving the TV.** The room can see
  whose thumb is moving. If it turns out to need saying, it can be said later.
- **No way to turn the mirror off**, per player or per room. A setting for it
  would be a gamemode descriptor and a drawer row for something nobody has yet
  asked not to have.
- **The mirror does not survive anything.** Not a refresh, not a reconnect, not
  the round. It is not state.
- **The host cannot scroll a column.** The TV has no pointer; that is the whole
  reason this exists.

## 1. The unit is a fraction, not pixels

`at` is `scrollTop / (scrollHeight - clientHeight)`, in `[0, 1]`, quantized to
three decimals.

Pixels cannot cross. The phone renders its list at `size={19}` and the host
column at `size={15}`, in boxes of different heights — the same `scrollTop`
means two different words.

A **fraction** was chosen over the obvious alternative, a top row index, for a
property worth stating outright. Both ends land their window at
`f × (rows − visible)`, so the TV's visible window is always *nested inside* the
phone's. The word being read is on the TV's screen by construction rather than
by luck, and no clamping rule is needed at the ends of the list. A row index
would have to be clamped near the bottom, where "put row N at the top" is not
satisfiable, and would then disagree with the phone about what is showing.

Three decimals is 0.19 rows on a 200-entry list (`MAX_ENTRIES`), so the
quantization is invisible. It also gives deduplication for free: if the rounded
value has not moved, nothing is sent.

## 2. `shared/mirror.ts` — new module

Two pure functions, so the existing `shared/**/*.test.ts` glob covers them.

```ts
/** The one member whose scroll drives this scorer's column, or null. */
export function driverOf(room: TeamView & Pick<Room, "settings">, scorerId: ScorerId): PlayerId | null;

/** scrollTop/range as a wire value, or null when there is nothing to scroll. */
export function scrollFraction(scrollTop: number, scrollHeight: number, clientHeight: number): number | null;
```

`scrollFraction` owns both the clamp to `[0, 1]` and the rounding to three
decimals, so the wire value is fully formed by the time any caller sees it and
both are covered by the same unit tests. The server clamps again on receipt —
not belt-and-braces, since a hand-rolled message never went through this
function at all.

`driverOf` resolves the scorer through `rosterOf` and returns the **first member
that is connected and human**, in roster order.

- **Roster order, not team-join order.** `membersOf` derives a team's roster by
  filtering `players`, so the order is who joined the *room* first. That is
  already the order the emoji row is drawn in on both the phone and the TV, so
  the driver is the face on the left of the card — visible without being
  labelled. Recording real team-join order would mean a new persisted field on
  `Player`, a `load()` fallback for older stored rooms, and a migration
  consideration, to reorder a row nobody can see.
- **Connected, because a dead phone must not hold the column.** `membersOf`
  does not filter on `connected`, so without this a member whose phone locked
  would own a column nobody could drive.
- **Human, because bots are `connected: true`** (`shared/bots.ts:114`). Without
  this a bot seated on a team by `seatBots` could lead its roster and own a
  column it can never drive, and the mirror would silently go missing for that
  team. `isHuman` already exists in `shared/bots.ts`.
- **Derived on every message, never stored.** There is no claim to take, release
  or clear, so a disconnect hands the column over with nothing watching for it,
  and a reconnect takes it straight back.
- **Teams off, this collapses with no special case.** A scorer's `members` is
  the one player, so `driverOf` returns them. Same unification `rosterOf`
  already does.

`shared/mirror.ts` imports `teams.ts` and `bots.ts`, which is acyclic — `bots.ts`
imports `teams.ts`, and nothing imports `mirror.ts` back. Its own module rather
than a corner of `teams.ts` for exactly that reason: `teams.ts` cannot import
`bots.ts` without closing a cycle.

`scrollFraction` returns **null** when `scrollHeight - clientHeight <= 0`. A list
too short to scroll has no position to mirror, and the caller sends nothing.

## 3. The wire

```ts
// shared/protocol.ts
ClientMessage | { type: "scrollTo"; at: number }
ServerMessage | { type: "columnScroll"; scorer: ScorerId; at: number }
```

The server stamps the scorer id on rather than the sender's `playerId`: the host
addresses columns by scorer, and with teams on the sender is not the column.

## 4. The server hop

Handled in `party/server.ts` **above** the reduce/persist/broadcast tail, in the
same fast-path block as `submitEntry` and `debugFill`.

```
phase is scoring?            no -> drop
sender's scorer resolved?    no -> drop
sender === driverOf(...)?    no -> drop
                                -> sendTo(hostConn, { type: "columnScroll", scorer, at })
```

- **Nothing enters `Room`, nothing is persisted, nothing is broadcast.** A
  scroll position has no bearing on scoring, must not survive a refresh, and is
  wanted by exactly one socket in the room. Putting it on the `scoring` phase
  beside `selfMarks` would make every 250ms tick a Durable Object storage write
  *and* a full `RoomState` re-encode to every socket — an eight-player room
  paying eight encodes to move one column — and would file a transient gesture
  as persisted state needing a JSON shape, a `load()` fallback and clearing on
  phase change.
- **`Number(msg.at)` and a clamp to `[0, 1]`**, rejecting `NaN`. Same defensive
  shape the `selfStrike` case uses on `msg.index`: a hand-rolled message can
  send anything.
- **Ownership is enforced here, not on the host client.** The server is the only
  place that knows the roster and the connection states, and it is one
  comparison. The host then applies whatever arrives.
- **A missing host connection is a silent drop.** Nothing is broken, and a
  scroll that did not land is not worth a round trip to complain about.

### Cost

Every incoming WebSocket message wakes the hibernating Durable Object and counts
against `doRequestsPerDay`, which is **100,000/day account-wide**
(`shared/usage.ts`) and shared between staging and production.

This is the one place the app deliberately ticks over the wire. Every other
continuous thing — the round timer, the reveal — broadcasts an absolute moment
once and is counted locally against `clockOffset`. A scroll has no schedule to
derive it from; it is live human input, and there is no derivation that avoids
the traffic.

So the rate is chosen rather than assumed: **a trailing send every 250ms while
scrolling, plus one final send 150ms after the last `scroll` event.** The
settle send is what guarantees the TV ends up exactly where the finger stopped
rather than up to 250ms short of it. On an assumption of five of eight players scrolling
about four seconds a round over ten rounds, that is roughly 800 messages a
match, or about 125 matches a day from the mirror alone. At 100ms it would be
~2,000 a match and about 50 matches a day, which is too much of a shared daily
ceiling for one gesture.

## 5. The two gates

**The phone sends** once its own reveal has run out: `step >= schedule.lastStep`.
Both screens derive `step` from the same `scoring.startedAt` against the same
schedule, so this is the same instant on every device, and a FAST FORWARD lands
it on all of them together (`useRevealStep` returns `lastStep` when `skipped`).

**The TV applies** at `rankStage === 2` — once the swap has finished and the
cards are settled in final order. It holds the latest value per scorer in a ref
from the moment messages start arriving.

The two gates are deliberately not the same instant. Between them the TV is
finishing the last column's auto-scroll (`activeColumn` still returns the final
column at `step === lastStep`) and then flying the measured swap; a mirror
fighting either would read as a bug. **Buffering rather than dropping** is what
makes the gap invisible: a player who scrolls during the swap and then stops
still sees the TV arrive where they left it, with no further gesture.

Nothing can fight the mirror once it is live. `HostScoring` computes `active`
only while `phase === "reveal"`, so the reveal's own auto-scroll effect is
already dead by `rankStage === 2`.

## 6. The host applies it

**The value never enters React state.** `HostScoring` renders up to ten columns
of up to 200 rows; putting a 4Hz value into the `roomStore` snapshot would
re-render that tree four times a second per scrolling player.

`roomStore` therefore exposes a plain listener — `onColumnScroll(cb)`, a
subscriber list, not part of the `useSyncExternalStore` snapshot. `HostScoring`
subscribes in an effect and writes `scrollTop` directly on the nodes it already
holds in `lists.current`. This screen already does imperative DOM work where
React state would be wrong; the measured swap is the precedent.

**One rAF loop for the whole grid**, not one per column, running only while some
column has an outstanding delta. Each frame `cur += (target - cur) * 0.25`, then
snap and drop the column out when within half a pixel. At 60fps that closes ~99%
in about 280ms — near enough one send interval, so 4Hz reads as continuous
motion without stacking noticeable lag on top of the interval itself. Under
`prefers-reduced-motion` the same loop runs — it is the only write path, there
is no separate one outside it — but there is no easing to do, so it assigns
the full delta on its first pass and then self-terminates once the column
stops moving.

A self-strike landing mid-mirror re-renders the column but does not disturb it:
`WordList` keys rows on `${entry.text}-${i}`, so React reuses the nodes and
`scrollTop` survives the render.

## 7. The indicator

While a column has been driven within the last ~2s, its scrollbar thumb takes
the cream accent in place of `--scroll-thumb`. One custom property, no new
element, no layout cost, and it sits exactly where the eye goes when something
moves.

The alternative considered was nothing at all, on the grounds that the room can
see whose thumb is moving. Rejected because with ten columns on a TV, one
scrolling on its own — moments after the reveal stopped scrolling them all —
reads as a glitch rather than as a person.

## 8. Failure handling

| Case | Behaviour |
| --- | --- |
| Host socket absent | Dropped silently, no error to the sender. |
| Sender is not the driver | Dropped server-side. Their phone scrolls normally; only the TV does not follow. |
| List too short to scroll | `scrollFraction` returns null, the phone sends nothing, the TV no-ops. |
| Player disconnects mid-scroll | Column holds its last position. No snap-back. |
| Driver disconnects | Next connected human is driver from the next message. The column stays put until they scroll, so the handover has no jump. |
| Every member disconnected | `driverOf` returns null, nothing is accepted, the column holds. |
| Phase is not `scoring` | Dropped. |
| Malformed `at` | `Number` then clamp; `NaN` dropped. |
| Debug view jump | `viewNonce` remounts `HostScoring`; refs and targets are fresh and the phone re-derives. Correct with nothing added. |

## 9. Tests

`shared/mirror.test.ts`, under the existing glob:

- `driverOf` with teams off returns the player; returns null when they are
  disconnected.
- `driverOf` with teams on returns the first member in roster order.
- `driverOf` skips a disconnected first member and returns the next connected
  one.
- `driverOf` skips a bot, including a bot in first position.
- `driverOf` returns null for an all-disconnected team, an all-bot team, and an
  unknown scorer id.
- `scrollFraction` returns null with no scrollable range, 0 at the top, 1 at the
  bottom, and clamps out-of-range input.

The transport and the DOM driving have no unit-test precedent in this repo and
are covered by the manual smoke test.

## Verification

- `npm test`
- `npm run typecheck` — **both** projects. `shared/mirror.ts` is imported by
  `party/` and by `src/`, so it is on both sides of the tsconfig split.
- `npm run build`
- Manual: `?p=1` as the TV, `?p=2` and `?p=3` as phones. Let a round reach
  results, wait for the swap to settle, scroll on `?p=2` and watch its column.
  Repeat with the Team Count setting on, checking that the first member's phone
  drives and the second's does not, and that closing the first member's tab
  hands the column to the second.

## Branch & PR

Branch `player-host-screen-mirror`, already cut from
`updated-round-placement-screens`. Version bump in all three places
(`package.json`, `package-lock.json` top-level, and under `packages: { "": ... }`).
Commits stage explicit paths — never `git add -A`, so the untracked working note
stays untracked.
