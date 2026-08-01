# Timer entry flush — design

Status: designed, not implemented.

The round timer expires while a player is still typing. Whatever is in the box
is submitted for them, if it is long enough to be worth submitting.

This is the first of the timer improvements. The second — spoken warnings as
time runs down — shares no machinery with it and gets its own spec.

## Problem

A round ends on a deadline nobody can see precisely. A player mid-word at the
whistle loses the word: the phase changes, `PlayerView`'s effect clears `text`,
and the characters are gone. Nothing about that is visible as a rule — it reads
as the game eating an answer, and the answer is often one the player had all but
finished.

The half-typed text exists **only in the browser**, in `text` at
`src/screens/player/PlayerView.tsx`. The server has never seen those characters,
so it cannot submit them on the player's behalf. The flush has to be fired by
the phone, and the phone fires it into a room that has already moved on.

## Scope

- On leaving `playing`, the phone submits its pending buffer.
- Accepted only if the trimmed text is 5 or more characters.
- Accepted late, through the `timesup` window, and refused once scoring starts.
- Everything else about an entry — duplicates, `MAX_ENTRIES`, `MAX_ENTRY_LEN`,
  the team-merged list — applies unchanged.

## Non-goals

- **No setting.** Not a gamemode descriptor, not a drawer row. The floor is a
  constant.
- **No new UI, and no confirmation.** The rescued word appears in the player's
  own list on the results screen, which the phone shows in full from the first
  frame. That is the feedback.
- **No rejection message.** A flush that is too short, duplicate, or over the
  cap fails silently. The reject banner renders only while `playing`, and a
  banner over the results screen would be scolding somebody for a word they did
  not choose to submit.
- **The buffer is not staged on the server.** See §2.
- **`submitEntry` is unchanged.** Late submission does not become a general
  capability.

## 1. The floor is 5, and it lets fragments through

`MIN_FLUSH_LEN = 5`, measured on the **trimmed text as typed** — not on the
normalized form. `Mr. T` is five characters and flushes; `J.Lo` is four and does
not. This is the generous reading, and it is the same thing `maxLength={64}` and
`MAX_ENTRY_LEN` already measure against.

Five is not arbitrary. `allowedEdits` in `shared/scoring.ts` already treats
five as the length below which an entry is too short to guess at — under it,
typo tolerance is zero. The flush floor sits on the line the scoring already
draws.

**A flushed fragment can outscore the finished word, and that is accepted.**
At 5–8 characters the tolerance is one edit, so `Beyon` against `Beyonce` is
distance 2 and does not match. Everyone who finished the word strikes each other
out under the Boggle rule; the fragment is unique and scores. Being wrong is
what makes it unique.

This is left alone deliberately. Exploiting it means deliberately hanging on a
deadline nobody can see precisely, for one word per player per round. A rule
that killed the fragment — struck by any longer word it prefixes, say — would
cost a real change in `shared/scoring.ts` and a `SCORING_VERSION` bump, and it
would silently destroy the rescued word this feature exists to save. The feature
is here so players stop feeling robbed; a clause that robs them quietly instead
works against it.

## 2. The grace window is `timesup`, and why

The phase flips `playing -> timesup` on a Durable Object alarm at `endsAt`. A
phone that fires at the deadline is racing the alarm it is firing against: the
message takes a round trip and `submitEntry` refuses anything that is not
`playing`. Firing *early* — at `endsAt - 300ms`, as an ordinary submit — was
rejected: a player who then finishes the word and presses Enter lands **both**
copies, and per §1 the fragment is the one that scores. Fixing that means
locking the input before the whistle, which is worse than the problem.

So the flush is accepted late, and the window it is accepted in already exists.
`timesup` runs `TIMESUP_MS` (3s) before the tick that computes `Results`. A
flush is accepted through it and refused from `scoring` onward — a boundary that
needs no new constant and is the honest one, because past it the scores are
computed.

**Staging the buffer on the server was rejected.** Streaming each phone's
in-progress text would remove the race outright and would survive a phone dying
at the whistle, but it puts a second continuous ticker on the wire. The scroll
mirror is described in CLAUDE.md as the one thing in the app that deliberately
ticks over the wire, and it is post-round, one socket, one direction. This would
be every player, every round, against an account-wide ceiling of 100,000
requests a day — plus per-player transient state that would have to survive
hibernation. Real machinery for a case the grace window handles.

## 3. The wire

One new client message. No new server message.

```ts
| { type: "flushEntry"; text: string }
```

**No `seq`, no ack, and no optimistic render** — all three of which
`submitEntry` has. The optimistic path exists because a 30-second round cannot
wait on a round trip; a flush has nothing left to wait for. Nothing renders
`state.entries` after `playing` ends — `PlayerScoring` reads
`room.phase.results` — so an optimistic copy would only sit unacked in client
state until the standings transition cleared it.

The server's existing `sendEntriesToTeam(playerId)` on an accepted entry is
unchanged and still fires, which is what teammates sharing a list need.

## 4. `flushEntry` in `shared/reduce.ts`

```ts
export function flushEntry(
  room: Room, playerId: PlayerId, text: string, now: number,
): SubmitResult
```

Two gates of its own, then the same rules as any other entry:

- **Phase** — `playing` or `timesup`. Anything else returns `not-playing`.
- **Length** — trimmed length `>= MIN_FLUSH_LEN`, else a new `too-short` on
  `RejectReason`.

Both reasons stay **inside the server**. `SubmitResult` carries them so the
tests can assert on them and so the two functions share one result shape, but a
flush sends no `entryAck` (§3) and neither reason reaches a client.

Then `MAX_ENTRY_LEN`, normalize-to-empty, duplicate within the **scorer's**
merged list, and `MAX_ENTRIES` — identical to `submitEntry`. That shared tail is
**extracted into one helper** that both call, rather than copied. Two divergent
copies of the entry rules is how a duplicate check ends up applying on one path
and not the other.

`at` stays `now`, unclamped to `endsAt`. A flushed word sorts last in the team
merge and last in the reveal because it genuinely was last.

`lastActivityAt` updates as it does for any entry. Extending the idle horizon by
a fraction of the `timesup` window changes nothing.

## 5. The client seam

The effect at `src/screens/player/PlayerView.tsx` already fires on leaving
`playing` and already clears `text`. The flush goes there, before the clear.

It reads the pending text from a **ref**, not from the dependency array. Adding
`text` to the deps re-runs the effect on every keystroke, and — worse — its own
`setText("")` re-triggers it with an empty buffer. The ref keeps `[playing]` as
the only dependency, so the flush fires exactly once per round.

**The phone checks nothing but emptiness.** Not the deadline, not the phase it
is landing in, not the 5-character floor. It sends a non-empty buffer and the
server decides. That is what keeps the rule in `shared/` where it is testable,
and it is why the debug controls need no special case: `debugSkip` moves the
deadline and the round ends down the ordinary path, so the flush fires down the
ordinary path with it.

## 6. Failure handling

| Case | Behaviour |
| --- | --- |
| Buffer empty at the whistle | Phone sends nothing. |
| Buffer under 5 characters | Sent, refused `too-short`, silent. |
| Flush duplicates a word already on the scorer's list | Refused `duplicate`, silent. Includes a teammate's word. |
| Scorer already at `MAX_ENTRIES` | Refused `limit`, silent. |
| Flush arrives after `timesup` ends | Refused `not-playing`. The word is lost; scores are already computed. |
| Phone suspended past the 3s window | Same as above — the word is lost. Accepted hole; see §2 for the fix that was rejected and why. |
| Host pauses the round | `playing` persists, so no flush. Pause is not an ending. |
| Host `debugSkip` | Deadline moves to now, round ends naturally, flush fires and is accepted. |
| Host `backToLobby` mid-round | Phone flushes, server refuses on phase. The abandoned round keeps no words. |
| Debug view jump out of `playing` | Same — refused on phase unless the target is `timesup`. |
| Player disconnected at the whistle | No socket, no flush. Their earlier entries are untouched. |
| Two flushes from one phone | Second is a duplicate of the first and refused. |

## 7. Tests

`shared/reduce.test.ts`, under the existing glob — all pure, no transport:

- Accepted in `playing`.
- Accepted in `timesup`, and the entry is present in the room it returns.
- **Refused in `scoring`**, and in `lobby`, `countdown` and `standings`.
- Refused at 4 characters, accepted at 5.
- `Mr. T` accepted (5 trimmed) and `J.Lo` refused (4 trimmed) — the trimmed-not-
  normalized measure, which is the one line of this most likely to be
  "corrected" into normalized later.
- Whitespace-only and punctuation-only buffers refused.
- Refused as a duplicate of the player's own earlier word, and of a teammate's.
- Refused at `MAX_ENTRIES`.
- Over `MAX_ENTRY_LEN` refused.
- Every refusal returns the **same room object** it was given, so a rejected
  flush cannot persist a mutation.

The client effect and the transport have no unit-test precedent here and are
covered by the manual smoke test.

## Verification

- `npm test`
- `npm run typecheck` — **both** projects. `RejectReason` and the new
  `ClientMessage` member sit in `shared/`, which is compiled under
  `tsconfig.json` and `tsconfig.worker.json` both.
- `npm run build`
- Manual: `?p=1` as the TV, `?p=2` and `?p=3` as phones. Set a short round.
  Type five or more characters on `?p=2` without pressing Enter and let the
  timer expire — the word appears in their list on the results screen. Repeat
  with four characters and confirm it does not. Repeat with the Team Count
  setting on, confirming a flush that duplicates a teammate's word is dropped.

## Branch & PR

Branch `timer-improvements`, cut from `origin/staging`. Version bump in all
three places (`package.json`, `package-lock.json` top-level, and under
`packages: { "": ... }`). Commits stage explicit paths — never `git add -A`, so
the untracked working note stays untracked.
