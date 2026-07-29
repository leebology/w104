# Free-tier usage debug panel — design

**Date:** 2026-07-29
**Status:** implemented (v0.4.6)
**Relates to:** `2026-07-28-score-persistence-design.md` (the D1 section of this
panel stays dark until that ships), `HOSTING.md` (token setup, per-environment
behaviour, the free-tier allowance table).

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

## Non-goals

- **No historical charting.** Current-period usage only. A trend line needs a
  store, and the point of this is to answer one question at a glance.
- **No alerting.** Cloudflare already emails on approach.
- **No writes of any kind.** The panel reads; nothing it does can change a
  deployment.
- **Nothing on a game path.** Deleting `party/usage.ts`,
  `src/components/DebugPanel.tsx`, `src/net/usage.ts` and `shared/usage.ts`
  leaves the game byte-for-byte the same.

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

## 12. Follow-ups, not built

- D1's three bars are live code waiting on a binding — see §13.
- The reset line repeats on all three Workers rows, since they share a reset.
  Hoisting it to the section the way notes are hoisted is a small polish nobody
  has asked for yet.
- No spend/trend history, per §Non-goals.

## 13. What the D1 archive changed here

Nothing, as designed — and this has now actually happened rather than being a
prediction. `d1Service()` checks for the `DB` binding on the Worker env: absent,
it reports `unused` with the three allowances and no figures; present, it runs
the queries. `2026-07-28-score-persistence-design.md` landed its binding on
2026-07-29 and the D1 section switched itself on, with no edit to this panel.

The allowance that matters there is **100,000 rows written per day, index
updates counted** — the number that spec's §5 budgets against. This panel is
how to watch it during that spec's first real match, which is its outstanding
step.
