# Custom categories — design

**Status:** design settled except §3.3 (vote count), which is the one open decision.
**Supersedes:** nothing. Extends `2026-07-26-category-voting-design.md`, which stays
correct for the built-in pool — that vote is untouched and remains the default.

## 0 · Provenance, and what was lost

This feature was designed in a Claude Design project
(`https://claude.ai/design/p/853962ae-f6d8-4fbc-a092-949722d1148c`) that produced three
documents and an eleven-frame HTML prototype. Two of the three are preserved verbatim
alongside this spec:

- `docs/design/2026-07-30-custom-categories-brief.md` — the numeric design spec. Every
  size, colour, duration, delay and easing curve. **Authoritative for anything numeric
  about the screens.**
- `docs/design/2026-07-30-custom-categories-traps.md` — the implementation trap list.
- The prototype itself stays in the design project. Section 1c plays the
  creation→voting transition at real timing.

The third document was an implementation handoff which repeatedly deferred to a
`docs/design/2026-07-30-custom-categories-brief.md` §4 "settled mechanic" and a plan with a
decision log (D15, D16, D20). **Neither existed in this repo and neither is in git
history** — that is the loss this document exists to prevent recurring. The handoff was
explicit that it was reconstructing the ruleset from memory, that its own prototype frames
contradicted the rule it recalled, and that ten questions had to be answered from documents
that turned out not to exist.

**So §1–§3 below are re-derived from first principles, not recovered.** They are settled by
decision, and this spec is now their only source. The three decisions the handoff quoted
often enough to be trustworthy are carried forward and marked.

Four things the handoff asserted about this codebase that are simply wrong, corrected here
so nobody re-derives them from it:

| Handoff says | Actually |
| --- | --- |
| `room.votes` is `Record<PlayerId, string[]>` | `VoteMap = Record<PlayerId, Record<string, number>>` (`shared/voting.ts`) |
| The setting is one more entry beside the others | `SettingSpec` is numeric-only; a two-option setting needs a new descriptor kind |
| `creating.drafts` can live on the phase | `toRoomState` strips whole top-level fields; drafts must be one |
| Rooms reach 24–30 authors | `MAX_PLAYERS` is 10. 20–30 is reachable only via the bot bench, until the cap raise |

## 1 · What this is

A player-written category pool, as an alternative to the built-in ten.

One new setting, one new phase, a forked pair of voting screens, and an animated
transition between them. With the setting off, nothing in this document exists at runtime
and the built-in vote plays exactly as it does today.

### 1.1 The flow

1. Host sets **CATEGORIES** to **Custom** in the Game settings drawer.
2. Host starts. With teams on, team select happens first, unchanged.
3. The existing five-second countdown runs, then the new **`creating`** phase opens.
4. Everyone writes categories on their phone. The TV shows **progress, never content**.
5. The window closes on its deadline or when everyone is ready. Blank slots become
   house cards. The deal is computed. **This is the only moment either happens.**
6. A ~1.1s animated transition, no countdown, into **`voting`**.
7. Voting: each player is dealt hands of three and spends one vote per hand. The TV runs
   the existing race board.
8. At close: zero-vote cards leave, counts become percentages, then **authorship is
   revealed** — a name tag pops onto each card, winner first.
9. Rounds draw from the pool weighted by votes, exactly as they do today.

### 1.2 Why the hand mechanic exists

Twenty players writing one card each is a twenty-card pool. That cannot be a grid on a
phone. Dealing hands of three solves the layout, and buys two things the built-in vote does
not have:

- **It defeats bandwagoning outright.** You can only vote from your own three cards, so
  what is winning on the TV cannot influence you. This is why the live race board is pure
  spectacle here with no cost to fairness — which is *not* true of the built-in screen.
- **It bounds the phase.** Voting is a fixed number of taps regardless of pool size.

The cost is that the deal has to be *solved*, not sampled: every card must be shown to the
same number of people or the vote is not fair. See §4.

### 1.3 What the feature is for

**The authorship reveal.** Everything else serves it. The TV never shows draft text, no
voter avatars ever appear, and identical texts stay separate through voting — all three
exist to keep authorship hidden until the one beat that pays it off.

## 2 · The three carried decisions

Quoted from the lost plan's decision log by the handoff, consistently enough to trust.

- **D15 — never deal a player their own card.** Teammates' cards are fine. Softened here:
  see §4.2.
- **D16 — committing is readying.** A player is ready when every slot they own is
  committed. Never on keystroke — the phase can close under someone mid-word.
- **D20 — identical texts stay separate through voting and merge at the draw.** Two cards
  reading "smells" are two cards on the board with two tallies, and one entry in the draw
  with the summed weight. Merging earlier would tell the room two people matched, which is
  an authorship leak.

## 3 · The ruleset

`P` = players in the room, `R` = `settings.roundCount`, `q` = cards each player writes,
`V` = pool size, `B` = votes each player gets. Hand size is **always 3**.

### 3.1 Pool size

**The pool is half again the round count, with a floor so small rooms still have something
to vote on.** The floor matters because with 3 players and 1 round, "cover the rounds"
would mean a 2-card pool.

```
band(P)  = P <= 4 ? 3 : P <= 7 ? 2 : 1
q        = clamp(max(band(P), ceil(1.5 * R / P)), 1, 4)      // P >= 3
q        = ceil(R / P)                                        // P <= 2, see 3.4
V        = P * q
```

| | R=1 | R=3 | R=5 | R=10 |
| --- | --- | --- | --- | --- |
| **3 players** | 3 (9) | 3 (9) | 3 (9) | 4 (12) |
| **4 players** | 3 (12) | 3 (12) | 3 (12) | 4 (16) |
| **5 players** | 2 (10) | 2 (10) | 2 (10) | 3 (15) |
| **8 players** | 1 (8) | 1 (8) | 2 (16) | 2 (16) |
| **10 players** | 1 (10) | 1 (10) | 1 (10) | 2 (20) |
| **20 players** | 1 (20) | 1 (20) | 1 (20) | 1 (20) |

**The ceiling is 4, not 5.** Five was considered and rejected: 5 does not divide evenly
into any workable vote count, so it is the one quota that cannot deliver exact equal
exposure (§4.1). The cost is confined to a 3-player 10-round match, which gets a 12-card
pool instead of 15 — still covering the match, with 2 spare categories rather than 5.

**Why excess at all.** A pool exactly the size of the round count means every category
plays and the vote decides nothing but running order. The feature would be theatre. Half
again is the smallest excess that makes winning the vote mean something without pushing the
writing load past what a phone keyboard is worth.

**Competition is uneven across room sizes and cannot be evened out.** Everybody writes at
least one card, so a 20-player 3-round match cuts 17 of 20 cards no matter what rule is
chosen, and a 3-player match is generous no matter what. The rule controls the middle.
This is accepted, not a defect.

### 3.2 Round coverage

`V >= R` always holds under §3.1 for `P >= 3` — the tightest case is 3 players at 10
rounds, where `q` hits its ceiling of 4 and yields 12 for 10. **The round count is never
clamped and the Rounds stepper is never restricted.** Earlier candidates that shortened the
match or house-backfilled the pool were both rejected: the room writes its own match.

### 3.3 Vote count — **OPEN**

Constrained by two requirements that interact:

- **Exact equal exposure** (§4.1) requires `q` to divide `3B`. This is firm.
- **No repeats within a player's deal** requires `3B <= q(P - 1)`. This is negotiable.

`q` ranges over `{1, 2, 3, 4}`, and 12 is the smallest number divisible by all four, so
**`B = 4` is the only fixed vote count that satisfies exact exposure at every pool shape.**
`B = 6` works only if `q = 4` is excluded or special-cased; `B = 5` works for almost
nothing.

Three candidates, all of which preserve exact exposure:

| | Votes | Repeats | Notes |
| --- | --- | --- | --- |
| **A** | 4 everywhere | Only in rooms whose non-own pool is under 12 | The unique clean fixed count |
| **B** | 6 everywhere, 4 in a 3-player long match | Mild in 11–17 player rooms | Biggest numbers on the board |
| **C** | Scales 2–6 with room size | Never | Number changes unpredictably between room sizes |

Resolve before writing `shared/customCategories.ts`. `voteBudgetFor()` is written **once**
and both counters — the TV prompt and the phone's pips — read it.

### 3.4 Rooms of 1–2 players

Allowed, with the rules bent rather than a fallback to the built-in pool.

- `q = ceil(R / P)`: exact coverage, no excess, no ceiling. A solo host writing a 10-round
  match writes 10 cards.
- **Own cards are dealt**, because there is nothing else to deal. See §4.2.
- Authorship is not hidden at these sizes and cannot be. Accepted — these are test and
  couch-play rooms.

The design brief assumed 2-player rooms fell back to the built-in pool. **That is
overridden here.**

### 3.5 Character cap

20 characters, trimmed. From the design brief; the host slot's 26px type and 218px column
are sized against it.

### 3.6 The writing window

60 seconds, matching `VOTING_MS`. A constant, not a setting — `durationSec` is the round
timer and means something else. Closes early when everyone is ready.

## 4 · The deal

Computed once, in full, at the moment writing closes and before voting opens. Never
incrementally, never sampled per hand.

### 4.1 Exact equal exposure

**Every card appears in exactly the same number of hands. Not ±1.**

Total dealt slots are `P * B * 3`; the pool is `P * q`. Exposure per card is therefore
`3B / q`, and the player count cancels out entirely. Exactness is the requirement that
`q` divides `3B` — which is why §3.3 is a constraint problem rather than a taste call.

This is the property that makes the vote fair, and it is why a rare collision must never be
"fixed" with a filter. A filter breaks exposure.

### 4.2 Never your own card

Enforced whenever the pool can support it — i.e. whenever there are at least 3 cards you
did not write, which is always true at `P >= 3` (the smallest non-own pool is 6, at 3
players writing 3 each).

Relaxed only at `P <= 2`, where own cards are dealt because there is nothing else. The rule
is therefore "prefer non-own, allow own only when unavoidable", not a hard filter.

**Teammates' cards are dealt normally.** No team filter — adding one would break exposure.

### 4.3 Repeats

No card appears twice **within one hand**, ever.

Whether a card may appear in two of a player's *different* hands is decided by §3.3. Note
that this is not a strategic move — you cannot choose to be dealt a card again, so framing
it as "stacking votes" (as the built-in vote genuinely does) would be wrong.

At 4+ players with `B = 4`, the dealt slots frequently fill the available non-own pool
exactly, with nothing spare.

### 4.4 Construction

The brief called this the "arc construction" and claimed it yields never-own and equal
exposure for free. **Its actual definition is lost.** Implement to the properties, not to a
recalled algorithm. The properties are the contract:

1. No hand contains a card the hand's owner wrote (subject to §4.2).
2. No team filter.
3. No duplicate card within a hand.
4. Every card appears in exactly `3B / q` hands.
5. Each player gets exactly `B` hands of exactly 3.

A round-robin over the pool ordered so each author's cards are maximally spaced, taking
each player's hands as strides starting past their own block, satisfies all five. Whatever
is implemented, these five are the tests, and they are written first.

## 5 · Privacy

Three secrets, three mechanisms. All are load-bearing on the reveal.

| Secret | Held until | Mechanism |
| --- | --- | --- |
| Draft text | Writing closes | Never leaves the server except to its author |
| Your hands | Never public | Per-socket send, never broadcast |
| Authorship | Voting closes | Withheld from the pool payload until the close |

- **`drafts` is a top-level `Room` field stripped by `toRoomState`**, alongside `entries`.
  It cannot live on the phase: `toRoomState` strips whole fields, and a nested one would
  ride out in `RoomState`.
- **The host's creation payload is derived in `toRoomState`** — a per-player array of
  `"empty" | "writing" | "done"`, plus a written/total count. Never the strings, in any
  form: not truncated, not blurred, not in a title attribute.
- **`"writing"` means the phone's cursor is on that slot**, not that keys are moving. It
  comes from a published cursor position, so a player who leaves a slot half-written and
  jumps ahead does not leave a lying animation behind.
- **The deal goes out per-socket**, the same way `yourEntries` does. A leaked hand plus a
  public tally lets the room deduce who voted for what.
- **No voter avatars on the voting board, ever.** The built-in board shows them; this one
  must not, for the same reason.

## 6 · Data model

```ts
// shared/customCategories.ts (new)

export type SlotState = "empty" | "writing" | "done";

export type PoolCard = {
  id: string;              // stable through voting, the draw and the reveal
  text: string;
  authorId: PlayerId | null;   // null = house card
  slot: number;            // which of the author's slots it came from
};

export type Hand = { cardIds: string[] };   // always 3
```

`Room` additions:

```ts
settings.categorySource: "stock" | "custom"       // default "stock"

phase: ... | { name: "creating"; endsAt: number }
phase.countdown.to: "voting" | "playing" | "creating"

drafts: Record<PlayerId, string[]>   // SERVER ONLY, stripped by toRoomState
pool: PoolCard[] | null              // built at close, never before
deal: Record<PlayerId, Hand[]>       // SERVER ONLY, stripped by toRoomState
```

- **`quota` is derived, never stored** — `quotaFor(P, R)` from the live room, same
  principle as `currentRound`. A stored copy could disagree with the room it describes.
- **`votes` reuses the existing `VoteMap` unchanged**, keyed by `PoolCard.id` instead of a
  category name. Counts stay 0/1 per card unless §3.3 admits repeats.
- **`authorId` is withheld, not absent.** The pool ships to clients with `authorId`
  nulled during voting and populated in the close payload, in rank order, so the client can
  stagger the chip pops without a second round trip.
- **Everything persisted survives JSON**, and every new field needs a defaulting fallback
  in `load()` — `storage.get<Room>` is an unchecked cast over older stored rooms.

## 7 · The setting

`MatchSettings` is numeric-only today, and `SettingSpec` is `{key, label, kind, min, max,
default}` over a hand-written `NumericSettingKey` union. A `"stock" | "custom"` value does
not fit.

**Extend the descriptor system rather than special-casing the setting.** The invariant in
CLAUDE.md is that settings are validated against the active mode's descriptors and never
against loose constants; a setting validated beside the descriptors would break it.

- `SettingSpec` becomes a union: the existing numeric spec, plus a choice spec carrying its
  option list.
- `setSettings` keeps ignoring any key the active mode does not declare.
- `normalizeSetting` gains a branch that falls back to the current value for an
  unrecognised option, the same way it falls back on a non-finite number.

Rendered as a fourth card in the Game settings drawer, after ROUNDS, TIMER and TEAMS,
dimensionally identical to the three steppers — same card, same 11px label, same 38px
control row. No separator, no note, no hint line. See brief §1a.

## 8 · Phase mechanics

- **Placement:** after `teams` when teams are on, after `lobby` when they are not. The
  existing five-second countdown precedes it, so `Phase.countdown.to` gains `"creating"`
  and `countdownScreen()` gains the matching branch.
- **Closes** on `endsAt` or on everyone ready. `buildPool` then `buildDeal` run exactly
  once, in the tick that closes it.
- **Committing readies; clearing a committed card un-readies**, and that path must cancel
  an in-flight everyone-ready close.
- **`backToLobby`** steps back one phase, matching the teams precedent: to `teams` with
  teams on, to `lobby` without. `HostExit` reads accordingly.
- **The host's CONTINUE closes the window early**, force-readying, the same shape as team
  select's Continue.
- **Bots never write.** Their slots all become house cards. `isWaiting` already excuses
  them from the ready floor, so they cannot stall the close.
- **Disconnected players keep their slots and their cards.** Blank slots become house
  cards like anyone else's; their pill dims.
- **Debug:** `creating` joins `isHoldable` alongside `playing` and `voting`, so pause and
  skip cover it. `debugFill` learns to fill drafts, which is what makes the crowded
  layouts testable before the cap raise. The view jumper gains the two new screens.

## 9 · The draw

`pickCategory` is generalised over the pool source; its behaviour is otherwise unchanged.

- **Identical texts merge here and only here** (D20), summing their weights.
- **A zero-vote card is not dead, it is last in line.** The draw takes voted-and-unspent
  cards first, weighted; only if it runs out does it fall back to a uniform draw over the
  unvoted ones. This is exactly the existing fallback and it is what makes losing the vote
  soft rather than final.
- `voteShares` is computed over **voted cards only**, since zero-vote cards leave the board
  at close and including them would understate every share. Its `BALLOT.indexOf` tie-break
  generalises to a passed-in order — pool order for custom.
- `spentCategories` keys off the drawn card, and `RoundSummary.category` carries the
  custom text unchanged, so history, the round header and the archive need no new shape.

## 10 · Screens

**All numbers are in `docs/design/2026-07-30-custom-categories-brief.md`. All traps are in
`docs/design/2026-07-30-custom-categories-traps.md`.** Only the rules that override or are
absent from those two are restated here.

- **A category is always a card.** Cream, 3px ink, radius 14px, hard ink shadow, Bungee —
  in the writing card, the creation slot, the hand, the board, the closed board and the
  phone's review tiles. Never a row, a bar, or a list item.
- **The creation TV shows progress, never content.** Three signals on three channels:
  paper fill = reached, shadow = lifted, stamp-vs-dots = finished or in flight. Never
  collapsed into one.
- **The voting screens are the existing ones with a different pool source and a different
  close sequence.** Not new screens. Reuse `.host-voting__board` / `__row` / `.vote-card`
  and `flex-grow: votes + 1`.
- **The creation TV switches to the wall layout on slot count, not player count** — the
  constraint is horizontal. It additionally switches whenever `q >= 4`, since a column of
  four 96px slots does not fit a 720p stage. Brief §1b covers the rest.
- **The board shows at most ten cards**, five per row, balanced by weight rather than by
  sequence, with the remainder in a pack pill. Ten is a measured ceiling from the 24px name
  floor, not a preference.
- **No new tokens, no loose hex, no `color-mix()`, no `oklch()`.**
- **Every keyframe needs an A/B pair**, alternated by index parity. Every animation on this
  feature can fire twice in a row.
- **`prefers-reduced-motion: reduce` degrades to the settled end state**, not to no
  animation. For the transition that means the full voting board and the first hand on
  frame one.

## 11 · Out of scope

- **Raising `MAX_PLAYERS`.** Agreed as a separate project, sequenced after this one. This
  feature is nonetheless built to work at 20–30 now: the wall layout and the ten-card board
  cap are in scope, reachable via the bot bench.
- **The three crowded screens the cap raise needs** — the scoring reveal grid, the
  standings list and the podium — all of which are built for ten and none of which this
  design touches. They are only a problem with teams off; team play caps scorers at 10.
- **A warning that turning the setting on inserts a phase.** Deliberately none. The phase
  announces itself.
- **Archiving the pool or authorship.** `RoundSummary.category` carries the drawn text and
  that is all the archive gets.
- **Any team involvement in creation or voting.** Both phases are individual. No
  `TeamBadge` on either screen; team identity resumes on the round card immediately after.

## 12 · Decision log

Every number above was decided in conversation on 2026-07-30, not recovered.

| # | Decision | Rejected |
| --- | --- | --- |
| 1 | Cap raise to 20 is a separate project, after this | Before this; folded in |
| 2 | The room writes enough to cover its own match | House top-up; shortening the match |
| 3 | Pool is 1.5× the round count | 2×; a few spare |
| 4 | Writing ceiling 4 cards | 5 — cannot deliver exact exposure |
| 5 | 1–2 player rooms bend the rules and vote on own cards | Falling back to the built-in pool; blocking the start |
| 6 | Exposure is exact, not ±1 | ±1, as the handoff had it |
| 7 | Board text visible throughout; one reveal, authorship | Hiding text until close; flipping cards on first vote |
| 8 | Vote count | **OPEN — §3.3** |
