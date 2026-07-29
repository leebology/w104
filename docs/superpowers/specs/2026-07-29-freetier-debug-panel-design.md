# Debug menu — design

**Date:** 2026-07-29
**Status:** implemented (v0.4.7)
**Relates to:** `2026-07-28-score-persistence-design.md` (its `DB` binding is
what switched this panel's D1 section on — see §14), `HOSTING.md` (token setup,
per-environment behaviour, the free-tier allowance table).

Sections 1–11 cover the usage reporting this started as. **§12 covers the round
controls and experiment flags added in v0.4.7**, which turned it from a usage
panel into a debug menu.

## Problem

The project runs entirely on free tiers and had no way to see how much of them
was left without opening two dashboards on two vendors. Cloudflare's daily
allowances reset at 00:00 UTC — not monthly, which is the assumption most people
arrive with — so "are we close?" was a question nobody could answer at the table.

This adds a debug panel: a corner triangle that expands on hover, opens a slide-
out with a progress bar per metric, and says how long until each one resets.

## Scope

- `GET /debug/usage` on the Worker, reading Cloudflare's GraphQL Analytics API.
- Bars for Workers requests (account total plus a per-script breakdown),
  Durable Object requests / duration / stored data, and D1 rows read / written /
  stored data.
- A Vercel section that links out instead of reporting.
- The published free-tier allowances as a table in code, drawn against.
- **v0.4.7:** host-only controls to hold, skip, or auto-fill a live round, and
  local on/off flags for mid-round experiments. See §12.

## Non-goals

- **No historical charting.** Current-period usage only. A trend line needs a
  store, and the point of this is to answer one question at a glance.
- **No alerting.** Cloudflare already emails on approach.
- **No writes of any kind.** The panel reads; nothing it does can change a
  deployment.
- **No usage reporting on a game path.** Deleting `party/usage.ts`,
  `src/net/usage.ts` and `shared/usage.ts` leaves the game byte-for-byte the
  same. §12's round controls are the deliberate exception — they exist to
  mutate a round — and are host-only and server-enforced because of it.
- **No changing the game rules mid-match.** Considered alongside §12's controls
  and dropped: settings stay lobby-only.

---

## 1. Why a Worker route rather than a direct call

Cloudflare's Analytics API needs a token. A browser cannot hold one — every
`VITE_`-prefixed variable is inlined into the bundle at build time and readable
in devtools, so putting the token in Vercel's environment settings would publish
it. The Worker already exists, already holds secrets, and is already a
different origin the client talks to.

So: the page asks the Worker, the Worker asks Cloudflare. The token never
leaves the Worker, and there is no Vercel-side configuration at all.

## 2. One request per metric group

Cloudflare's analytics schema is discovered by introspection rather than
published field by field. `durableObjectsPeriodicGroups.sum.activeTime` and
`durableObjectsStorageGroups.max.storedBytes` were best-documented guesses when
this was written (both since confirmed working against a real token).

Batched into one query, a single wrong field name is a GraphQL error that
returns **no data at all** — every bar blanks with no clue why. Split, a wrong
name nulls one bar and prints Cloudflare's own error message on it. That is
worth the extra round trips: they are cached, off the game path, and there are
five of them.

The same principle drives `queryAccount`'s check for an empty `accounts` array.
A token that is valid but lacks *Account Analytics: Read* returns HTTP 200 with
no `errors` key and no data — which without the check reads as "zero usage" and
renders a room full of healthy-looking empty bars.

## 3. Failures are data, never exceptions

Every path returns a `UsageReport`. A missing token, an expired token, a
renamed field and an unreachable Worker each render as something legible.
`ServiceStatus` distinguishes them: `unconfigured` (no credentials, nothing
attempted), `error` (attempted and failed), `manual` (no API exists), `unused`
(not part of this deployment yet), `ok`.

A note shared by every metric in a section is hoisted to the section heading —
a dead token fails five calls with the same 300-character message, and printing
it five times buries the panel. A note on *one* metric stays on its bar, which
is the renamed-field case the split queries exist to isolate.

## 4. The Workers allowance is per account, not per script

100,000 requests/day across everything deployed. The section therefore leads
with **All Workers** — the figure the limit actually applies to — and lists
`w104` and `w104-staging` underneath as a breakdown.

Two independent bars would have been the obvious build and would actively
mislead: 60% each looks survivable while being 120% of one allowance.

The query is unfiltered and grouped by `scriptName` rather than filtered to the
serving Worker. One request answers both "how much is left" and "which Worker
spent it", and the total stays true even for a script not listed in
`WORKER_SCRIPTS`.

## 5. Nothing is scoped to the environment serving it

Every figure reads identically from local, staging and production — deliberately,
so staging usage is checkable from production and vice versa. Durable Object and
D1 counters are account-wide outright, which has a consequence worth stating:
**a match played on staging moves production's bars.**

`ENVIRONMENT` gates nothing and is the only `var` left; it labels the footer so
a tab open against the wrong Worker is obvious. An earlier `WORKER_NAME` var was
removed once the Workers query stopped filtering by it.

**Local dev generates no Cloudflare analytics whatsoever** — `wrangler dev` never
reaches the edge. The Workers section says so, rather than leaving it to be
inferred from a number that will not move.

## 6. Live in production, on purpose

The route originally 404'd when `ENVIRONMENT === "production"`, and the client
gated on a hostname allowlist. Both are gone. The gate meant the numbers worth
watching were the only ones you could not see without deploying a branch first.

The accepted consequences:

- The triangle is on the TV during a real party. 34px, corner, nothing opens it
  by accident.
- `/debug/usage` is public and unauthenticated. It serves a handful of
  account-level usage counts — no tokens, no room state, no player data.

`handleUsage` in `party/server.ts` is where a gate goes if that trade stops
holding. The client's `debugEnabled()` is a button, not a boundary.

## 7. Vercel is a link, not a bar

Hobby publishes no usage API. `GET /v1/billing/charges` reports *charges*, and a
Hobby account has none; the dashboard's figures come from an internal endpoint
with no compatibility promise. Web Analytics measures visitors and page views,
not quota — and its collection scripts add to data transfer and edge requests,
so it would consume the allowance it appears to measure.

The section rendered two permanently empty tracks at first. That reads as a
broken panel rather than a stated limitation, so the bars were removed and the
section is now a heading and a link to the project's usage page.
`vercelService()` is the only thing that changes if Vercel ever ships an API.

## 8. Where the code lives, and the one odd placement

| File | Role |
|---|---|
| `shared/usage.ts` | payload types, the `LIMITS` table, formatting, pure helpers |
| `party/usage.ts` | the GraphQL client and every query |
| `party/server.ts` | the `/debug/usage` route |
| `src/net/usage.ts` | fetch + where-to-ask |
| `src/components/DebugPanel.tsx` | the panel |

`shared/usage.ts` is the one file in `shared/` that is not game logic. It is
there for a mechanical reason: `party/` and `src/` are separate tsconfig
projects, and a type the client imported from `party/` would drag the Worker
into `tsconfig.json`. It is pure data and pure functions, unit-tested like
everything else there, and no game code imports it.

## 8a. Each section says what spends it

`Service.sources` renders under the heading, above the scope caveat. A bar on
its own cannot answer the question the panel is open for — "which resource are
we burning fastest" — because the answer is architectural, not arithmetic.

Durable Object **Duration** is the worked example. It runs an order of
magnitude ahead of Durable Object **Requests** here, and the reason is that
`partyserver` defaults to `hibernate: false` and this repo does not override
it: a room bills wall-clock time from first join until it is reaped, whether
or not anyone is typing. So Duration tracks how long rooms stay *open*, not how
busy they are, and the lever on it is the WebSocket Hibernation API rather than
anything about gameplay. None of that is visible in a 14% bar.

The blurbs are written against how w104 is built rather than restating
Cloudflare's pricing page. **Re-check the hibernation claim if `partyserver` is
upgraded** — it is the one that would silently stop being true.

## 9. Look

The panel deliberately ignores the design tokens for colour and shape. Every
other surface is cream-on-pink with gold for "go"; this is ink-on-ink with a
teal rule. It overlays screens a room may be looking at, and anything wearing
the game's buttons reads as a game control. It should look like it does not
belong, because it does not.

It does honour the flat-graphic rule — no gradients, no blur, no soft shadows —
and it is the one container in the app allowed to scroll at this size: an
overlay with unbounded content, not a game screen whose controls have to stay
reachable.

An unreadable figure renders as a **hatched** track, never an empty one. An
empty track says "none used"; hatching says "unknown", and those are different
facts.

## 10. Caching

60 seconds in Worker module scope. Cloudflare allows 300 GraphQL queries per
5 minutes per user and a collection spends five, so an open panel polling freely
could burn the budget measuring the budget. The panel polls every 60s while
open, fetches nothing while closed, and its **Refresh** button sends `?fresh=1`
to skip the cache.

The analytics pipeline itself runs minutes behind real time, so a round just
played will not appear instantly no matter which button is pressed. The panel
says "Cached, as of …" versus "Read at …" so that "nothing moved" has an
explanation that is not "the panel is broken".

## 11. Decisions

- **Limits are hardcoded, not discovered.** Cloudflare publishes no
  quota-remaining endpoint. `LIMITS` in `shared/usage.ts` is the single source,
  verified 2026-07-29, mirrored in HOSTING.md's table. A test asserts the
  values so a typo fails CI rather than quietly making every bar lie.
- **User API Token, not Account-owned.** Account-owned tokens exist to survive
  the creating user leaving the account, which buys nothing on a single-user
  account, and they are documented as incompatible with some products while the
  GraphQL Analytics API is on neither list.
- **Severity bands at 70% and 90%.** Below 70% is not worth a colour change.
- **The used figure is printed unclamped** even when the bar is pinned full, so
  being over the limit is visible as a number.

## 12. Round controls (v0.4.7)

The panel grew from one section to three. **Debug** at the top acts on a live
round; **Experimental features** holds local on/off flags; **Usage** — sections
1–11 above — moved to the bottom, collapsed, as one thin bar per metric.
Collapsing it is the point: noticing a bar has gone red is a glance, reading the
numbers is a task, and the panel is now usually opened to do something else.

### 12.1 Host-only, enforced twice

The three controls mutate a live round, and the panel renders in production, so
a player finding the triangle must not be able to derail a party. The server is
the boundary: `shared/reduce.ts` rejects `debugPause`/`debugSkip` from a
non-host, `party/server.ts` rejects `debugFill` the same way. The panel disables
the buttons and prints "Host device only", which is a courtesy — it was verified
by sending all three past the UI from a player tab and watching the server
refuse each one.

Changing the game rules mid-match was considered alongside these and
deliberately **not built**. Settings stay lobby-only.

### 12.2 Pause banks time, not a timestamp

`Room.paused` holds the milliseconds left, not the moment of pausing, because
`phase.endsAt` is absolute and a hold has to survive an arbitrary wait; resuming
is `endsAt = now + paused`. While it is non-null `phase.endsAt` is stale by
design, which forces three things:

- `tick` returns the identical room, or the first alarm would read the stale
  deadline as long overdue and end the round.
- `nextAlarmAt` falls back to the **ordinary** idle horizon, not a longer
  paused-specific one. `alarmOutcome` answers a stale room with `touch` while
  anyone is connected, so the people in the room keep a held game alive and an
  abandoned one reaps like any other. A room paused and walked away from should
  not outlive a room merely walked away from.
- Every client timer reads the banked figure via `useRemaining`'s third
  argument. The host's bar says "paused" and the player's wheel turns gold —
  a frozen wheel and a slow one look identical otherwise.

### 12.3 Skip does not transition

`debugSkip` moves the deadline to `now` and lets the alarm fire. The round then
ends down the exact path a natural expiry takes, so scoring, the archive write
and the standings hand-off cannot drift from the real one. It also clears
`paused`, or skipping a held round would resume it instead of ending it.

### 12.4 Auto-fill goes through `submitEntry`

Per word, per player, rather than writing `entries` directly — which keeps
phase, duplicates-within-a-scorer, `MAX_ENTRIES` and the team-merged list in
force for free instead of a second write path free to drift from the one real
players use. Authorship round-robins across a team's members so a shared list
looks like several people typed it.

`fillWordsFor` deals every scorer a subset of one **shared sub-pool** rather
than letting each draw independently. This is the whole design: scoring is
Boggle rules, and independent draws from a 140-word pool collide about half a
word per pair, so every player would score nearly full marks and the scoring
screen would never strike anything through. The sub-pool is
`perScorer * (scorerCount + 1)` — common collisions, still a tail of uniques.
Verified live: two players got 8 words each, 4 shared.

### 12.5 Experiments are local

`localStorage`, read anywhere through `useExperiment(id)`, broadcast in-tab by a
custom event because `storage` only fires in *other* tabs. Local on purpose —
the point is trying something on your own phone mid-round without pushing it at
the room. `sound-effects` is wired to nothing and exists as the shape the next
one copies.

## 13. Follow-ups, not built

- The reset line repeats on all three Workers rows; hoisting it to the section
  the way notes are hoisted is a small polish nobody has asked for yet.
- The reset line repeats on all three Workers rows, since they share a reset.
  Hoisting it to the section the way notes are hoisted is a small polish nobody
  has asked for yet.
- No spend/trend history, per §Non-goals.

## 14. What the D1 archive changed here

Nothing, as designed — and this has now actually happened rather than being a
prediction. `d1Service()` checks for the `DB` binding on the Worker env: absent,
it reports `unused` with the three allowances and no figures; present, it runs
the queries. `2026-07-28-score-persistence-design.md` landed its binding on
2026-07-29 and the D1 section switched itself on, with no edit to this panel.

The allowance that matters there is **100,000 rows written per day, index
updates counted** — the number that spec's §5 budgets against. This panel is
how to watch it during that spec's first real match, which is its outstanding
step.
