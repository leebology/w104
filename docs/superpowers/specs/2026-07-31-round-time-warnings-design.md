# Round time warnings — design

Status: designed, not implemented.

A band flashes on the phones and on the TV as the round runs down — at the
halfway mark on a long round, then at a minute, thirty seconds and ten.

This is the second of the timer improvements. The first — flushing a half-typed
entry at the whistle — is
`docs/superpowers/specs/2026-07-31-timer-entry-flush-design.md`. The two share
no machinery.

## Problem

The round clock is on the TV, in numerals, with a bar. It is not where the
player is looking. `PlayerPlaying` gives the phone a small conic-gradient pie in
the corner and says why in its own comment: the round screen's job is getting
words down, so the countdown is a glance, not a second thing to read.

That is right for the middle of a round and wrong for the end of one. A player
heads-down typing has no idea the round is nearly over until it is over, and the
corner pie is exactly the thing they are not looking at.

## Scope

- Warnings fire on the phones **and** on the TV.
- The set of warnings is derived from the round length, which runs 15s–600s.
- Each fires once per round.

## Non-goals

- **No sound, and no haptics.** There is no audio anywhere in this app today —
  no `Audio`, no `AudioContext`, no `navigator.vibrate` — and this is not the
  feature to introduce it. Ten phones chirping over each other in a small room
  is worse than nothing, iOS needs a user gesture to unlock audio at all (the
  round start has none, which is the same reason the keyboard focus there is
  fragile), and `navigator.vibrate` is unsupported in iOS Safari, so a haptic
  would silently do nothing for every iPhone in the room.
- **No setting.** Not a gamemode descriptor, not a drawer row. The set is
  derived from the round length and needs no host input.
- **Nothing new on the wire.** See §2.
- **No warning on any other phase's clock.** Voting has a 60s deadline of its
  own; it is not a race and wants no countdown drama.

## 1. The milestone set

`shared/roundwarnings.ts` — pure, and therefore covered by the existing
`shared/**/*.test.ts` glob, the same arrangement `reveal.ts` and `mirror.ts`
have.

```ts
export const TAIL_SEC = [60, 30, 10];
export const WARNING_GAP_SEC = 20;

export function warningsFor(durationSec: number): number[] {
  const tail = TAIL_SEC.filter((s) => s < durationSec);
  const half = Math.floor(durationSec / 2);
  const top = tail.length ? Math.max(...tail) : 0;
  return half >= top + WARNING_GAP_SEC ? [half, ...tail] : tail;
}
```

Returned descending — the order they fire in.

**The tail needs no separation check among its own members.** 60, 30 and 10 are
already at least `WARNING_GAP_SEC` apart by construction, so the tail is a fixed
set filtered by round length and nothing more.

**Half is a candidate, not a member.** It survives only if it clears the top of
the tail by the gap. That single comparison is what removes every collision:

| Round | Warnings | What the naive set would have done |
| --- | --- | --- |
| 15s | `10` | also `7`, 2.5s later |
| 20s | `10` | half lands **exactly** on 10 |
| 30s (default) | `10` | also `15`, five seconds earlier |
| 60s | `30, 10` | half lands **exactly** on 30 |
| 120s | `60, 30, 10` | half lands **exactly** on 60 |
| 160s | `80, 60, 30, 10` | — |
| 180s | `90, 60, 30, 10` | — |
| 600s (max) | `300, 60, 30, 10` | — |

Half first appears at 160s.

**Half must be checked against the tail rather than merged into it**, and the
15-second round is why. Merged and sorted by urgency, half (7) is *more* urgent
than the tail's 10 and would be kept first — then 10 would be dropped for
sitting within the gap of it. The round would warn at 7 seconds instead of 10,
having discarded the more urgent warning to keep the less urgent one. The order
of these two operations is load-bearing.

## 2. Derived on every client, never broadcast

Each client computes its own milestones from `phase.endsAt` and its
`clockOffset`, exactly as the round timer and the reveal schedule already do.
The TV and the phones fire together because they are reading one deadline off
one clock, not because anything was sent.

No new `RoomState` field and no per-second traffic — the invariant CLAUDE.md
states most plainly. Nothing about this feature touches `shared/reduce.ts`,
`party/server.ts` or the protocol.

## 3. Firing once

> **This section is historical on two points; implementation found it wrong.**
> The round identity described below does not survive a pause: `debugPause`
> banks the remaining milliseconds and resume recomputes
> `endsAt = now + paused` (`shared/reduce.ts`), so keying on `endsAt` reads a
> resume as a new round and cuts short a band that is on screen. The claim
> further down that "pause needs no code at all" is false for the same reason.
>
> What shipped: `useRoundWarning` holds **no round identity at all**. It seeds
> once per mount and relies on `HostView`/`PlayerView` rendering a different
> component type per phase, which React unmounts on — between rounds the phase
> passes through `timesup`, `scoring`, `standings` and `countdown`. The three
> behavioural rules below are unchanged and shipped as written.
>
> The rest of this document is accurate.

A hook in `src/` holds the set of milestones already fired, keyed on `endsAt`
so a new round resets it with nothing watching for it.

1. **On the first `remaining` observed for a given `endsAt`, mark every
   milestone `>= remaining` as fired and show nothing.** This is the
   catch-up rule, and it is what a player joining mid-round needs: seeded
   empty, a phone that joins at 45 seconds left on a 180-second round would
   immediately flash `1:30 LEFT`, which is both startling and false.

   The comparison is `>=` and not `>`, so a phone arriving at exactly a
   milestone second banks it silently rather than flashing a warning for a
   moment it did not witness. This cannot suppress a warning on a normal
   round: every milestone is strictly less than `durationSec` by
   construction, so the first observation of a round started on time marks
   nothing.
2. **On each later tick, take the unfired milestones with `remaining <= m`,
   show the smallest, and mark them all fired.** A locked phone's tab can jump
   from 60 straight to 5; firing every milestone it skipped would burst three
   bands at once. Showing the smallest shows the one still closest to true.
3. **Never show anything at `remaining <= 0`.** `debugSkip` moves the deadline
   to now, so `remaining` hits 0 while the phase is still `playing` for one
   round trip. Without this guard the room would flash `0:10 LEFT` at the exact
   moment the round ended.

**Pause needs no code at all.** `useRemaining` freezes under `room.paused`, so
`remaining` stops moving and nothing crosses. Milestones are keyed to values,
never to elapsed time.

## 4. One component, two positions

`TimeWarning` in `src/components/`, reusing `.reject-banner`'s language: the
tilted ink band, `pointer-events: none` so it cannot eat a tap mid-round, full
opacity on the first frame then fading over two seconds. That last part is not a
detail — the existing rule's comment says a message that fades *in* is a message
half-missed, and a ten-second warning is the most literal case of that in the
app.

- **Phone** — anchored high on the viewport, deliberately not centre. The
  reject banner owns the centre, and a duplicate submitted at ten seconds left
  would otherwise put two bands on the same pixels.
- **TV** — the same band across `.host-stage`, sized to be read across a room.

Position is a modifier class; the component is one file.

## 5. Copy

`formatClock` throughout, so there is one rule and no second format to keep in
step: `2:30 LEFT`, `1:00 LEFT`, `0:30 LEFT`, `0:10 LEFT`.

This is the most reversible decision in the document. `10 SECONDS` hits harder
than `0:10`, at the cost of a second format and a branch deciding between them.
Changing it later touches one function.

## 6. Failure handling

| Case | Behaviour |
| --- | --- |
| Round at `MIN_DURATION_SEC` (15s) | One warning, at 10. |
| Round where half collides with a tail member (20s, 60s, 120s) | The gap check drops half; the tail is unaffected. |
| Player joins mid-round | Already-passed milestones are marked fired silently. Only what crosses while they watch is shown. |
| Tab backgrounded across several milestones | One band, the most urgent crossed. |
| Host pauses | `remaining` freezes; nothing crosses; nothing fires. |
| Host resumes | Counting continues from the banked figure; unfired milestones still fire. |
| Host `debugSkip` | `remaining` reaches 0; the `> 0` guard shows nothing. |
| Debug view jump to `playing` | New `endsAt`, so the fired set resets and the catch-up rule seeds it. |
| Reject banner on screen simultaneously | Both visible; different anchors, neither takes a tap. |
| Clock offset wrong by seconds | Warnings fire early or late by that much, exactly as the round timer already does. Not a new failure mode. |

## 7. Tests

`shared/roundwarnings.test.ts`, pure:

- `warningsFor` at 15, 20 and 30 returns `[10]` — the three short rounds where
  half is suppressed for a different reason each time.
- At 60 returns `[30, 10]`; at 120 returns `[60, 30, 10]` — the two exact
  collisions.
- At 159 returns `[60, 30, 10]` and at 160 returns `[80, 60, 30, 10]` — the two
  sides of the boundary where half starts appearing.
- At 180 returns `[90, 60, 30, 10]`; at 600 returns `[300, 60, 30, 10]`.
- Every result is sorted strictly descending, and every adjacent pair is at
  least `WARNING_GAP_SEC` apart — asserted over the whole legal range
  `MIN_DURATION_SEC..MAX_DURATION_SEC`, which is the property the hand-picked
  cases above are only samples of.
- No result contains a value `>= durationSec`.

The hook and the component have no test precedent in this repo — the Vitest glob
is `shared/**` only — and are covered by the manual smoke test.

## Verification

- `npm test`
- `npm run typecheck` — both projects.
- `npm run build`
- Manual: `?p=1` as the TV, `?p=2` as a phone. Play a 30-second round and
  confirm exactly one band, at ten seconds, on both screens. Then a 180-second
  round for all four. Then pause from the debug menu across a milestone and
  confirm nothing fires while held.

## Branch & PR

`timer-improvements`, alongside the entry-flush work — decided 2026-07-31. Both
timer features ship as one PR into `staging` rather than two, which is what the
branch name says and what keeps the pair reviewable together.

One consequence: `CLAUDE.md`'s stated test count moves again when the
`warningsFor` tests land. It is currently wrong by two (says 604, suite is 606)
from the flush work's own final fix. **Correct it once, at the end of this
feature**, rather than twice — a number that has drifted three times on one
branch is worth landing right on the last commit that can change it.

Version bump in all three places (`package.json`, `package-lock.json`
top-level, and under `packages: { "": ... }`). Commits stage explicit paths —
never `git add -A`, so the untracked working notes stay untracked.
