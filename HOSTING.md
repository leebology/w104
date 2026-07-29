# Hosting & deployment

This document is the one-time setup runbook plus the everyday workflow. Once
setup is done, contributors only need the "Everyday workflow" and "Local
development" sections.

## Architecture

Two independent pieces, deployed to two hosts, both on free tiers:

| Piece           | What it is                              | Host              | URL                              |
| --------------- | --------------------------------------- | ----------------- | -------------------------------- |
| Web app         | Vite + TypeScript static frontend       | Vercel            | `https://www.oknameone.com`      |
| Realtime server | PartyServer on a Cloudflare Worker;     | Cloudflare        | `wss://w104.liam-donaher.workers.dev` |
|                 | one SQLite Durable Object per room       |                   |                                  |

The browser loads the web app from Vercel, then opens a WebSocket to the
Cloudflare Worker. They are separate origins — that is intentional.

```
Player phones ─┐
               ├─► wss://w104.liam-donaher.workers.dev  (Cloudflare Worker, PartyServer)
Big screen ────┘
       │  loads UI from
       └─► https://www.oknameone.com  (Vercel)
```

> The game used to live at `w104.leebo.io`, a subdomain of a personal site.
> It now has its own domain. `w104` survives as the repo name, the Worker
> name and the Durable Object class — those are deployment identifiers and
> renaming them would mean a new Worker and a migration for no gain.

> Why PartyServer and not PartyKit? PartyKit's shared hosting is full, and its
> CLI can only create key-value Durable Objects, which Cloudflare's free plan no
> longer allows. PartyServer is PartyKit's Cloudflare-maintained successor: same
> room model, deployed as a normal Worker via Wrangler, with the DO pinned to the
> SQLite backend (`new_sqlite_classes` in `wrangler.jsonc`) that the free plan
> requires.

### Staging

There are two long-lived branches, each with its own complete environment —
web app, Worker, and Durable Object storage. Nothing in staging can touch
production room state.

| Branch    | Web app (Vercel)             | Worker (Cloudflare)                     |
| --------- | ---------------------------- | --------------------------------------- |
| `main`    | `https://www.oknameone.com`  | `wss://w104.liam-donaher.workers.dev`         |
| `staging` | `https://staging.oknameone.com` | `wss://w104-staging.liam-donaher.workers.dev` |

`wrangler.jsonc` defines the `env.staging` that produces the second Worker
(Durable Object bindings are not inherited by named environments, so they're
repeated inside `env.staging`; `migrations` is top-level and applies to every
environment already). `.github/workflows/deploy.yml` runs
`wrangler deploy --env staging` on **push to `staging`**.

`staging` is a soak environment, not a release gate. Merge anything into it
freely to try it on real phones; `main` still takes PRs directly from feature
branches. The two are independent, and staging is allowed to be broken.

> **Why the Worker no longer deploys on PRs.** It used to, which meant every
> open pull request overwrote the one shared `w104-staging` Worker. That is
> fine for throwaway previews and useless for an environment people are
> actively testing against — the behaviour would change mid-session with
> nothing to point at the cause. Worker changes are now tested by merging them
> to `staging`. Vercel still builds a frontend preview per PR, and those
> previews point at the staging Worker, which is stable precisely because PRs
> no longer deploy it.

Three Vercel environment settings make this work. `VITE_PARTYKIT_HOST` is set
per environment, so each frontend talks to its matching Worker:

| Vercel environment       | `VITE_PARTYKIT_HOST`                     |
| ------------------------ | ---------------------------------------- |
| Production (`main`)      | `w104.liam-donaher.workers.dev`          |
| Preview (`staging`)      | `w104-staging.liam-donaher.workers.dev`  |
| Preview (all other branches) | `w104-staging.liam-donaher.workers.dev` |

Feature-branch previews deliberately share the staging Worker rather than
getting one each — a Worker per branch would mean a Wrangler environment per
branch.

Note: pull requests opened from a fork do not receive repository secrets, so
Worker deploys fail for outside contributors. Acceptable for a
private-collaborator repo — revisit if the repo opens up.

### Testing on phones

Local dev binds to loopback by default, which a phone on the same wifi cannot
reach. Three changes, all already made in this repo:

1. Vite listens on all interfaces, not just localhost: `vite.config.ts` has
   `server: { host: true }`.
2. Wrangler does the same: `dev:party` runs `wrangler dev --ip 0.0.0.0`.
3. `VITE_PARTYKIT_HOST` must point at your machine's **LAN IP**, e.g.
   `192.168.1.42:8787` — not the `127.0.0.1:8787` fallback. From a phone,
   `127.0.0.1` means the phone itself, so the page loads fine and the socket
   just never connects, with nothing in the console pointing at the cause. Set
   this in a local `.env` (see `.env.example`).

Keep both servers on plain **http**. An https page cannot open a `ws://`
socket, so passing `--local-protocol https` to `wrangler dev` breaks the
connection; with both sides on http there's no mixed-content problem to work
around.

---

## One-time setup

### 1. Web app on Vercel (`www.oknameone.com`)

1. In Vercel, **Add New → Project** and import `leebology/w104`.
2. Framework preset **Vite** (auto-detected). Leave build command / output dir at
   defaults (`npm run build` → `dist`).
3. Add an environment variable (Production + Preview + Development):
   - **Key:** `VITE_PARTYKIT_HOST`
   - **Value:** `w104.liam-donaher.workers.dev` (your Worker's URL — the
     `<worker-name>.<your-workers.dev-subdomain>` from step 2 below)
4. **Settings → Domains → Add** `www.oknameone.com` and assign it to
   **Production**; accept the DNS record Vercel offers (or add the shown
   `CNAME` at your registrar). Add the apex `oknameone.com` too and let Vercel
   redirect it to `www` — people will type it without the prefix.

### 2. Realtime server on Cloudflare (Wrangler)

You need a free Cloudflare account with a `workers.dev` subdomain enabled
(**Workers & Pages** → pick a subdomain once, e.g. `liam-donaher`).

Get two credentials:

- **Account ID** — Workers & Pages overview, right sidebar.
- **API token** — https://dash.cloudflare.com/profile/api-tokens → Create Token →
  **"Edit Cloudflare Workers"** template.

Deploy from the repo root (PowerShell):

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = "<account id>"
$env:CLOUDFLARE_API_TOKEN  = "<api token>"
npm run deploy:party        # = wrangler deploy
```

The output prints the Worker URL, e.g. `https://w104.liam-donaher.workers.dev`.
That host (without `https://`) must equal the `VITE_PARTYKIT_HOST` you set in
Vercel. Reload `www.oknameone.com`, create a lobby, then join it with the room
code from a second tab and confirm that player appears on the host's roster.

> Do **not** use Cloudflare's dashboard "Create application / Connect to Git"
> flow — `wrangler deploy` (and CI) creates the Worker. That dashboard pipeline
> would be a second, conflicting deploy path.

### 3. GitHub secrets (for CI deploys)

The deploy workflow needs the same two Cloudflare values as repo secrets:

```bash
gh secret set CLOUDFLARE_ACCOUNT_ID --body "<account id>"
gh secret set CLOUDFLARE_API_TOKEN   # paste when prompted (hidden input)
```

The API token is a powerful credential — it lives only here (GitHub Actions),
never in a committed file or a shared `.env`. Contributors don't need it; local
dev uses a local server (see below). `.github/workflows/deploy.yml` then deploys
the Worker on every push to `main` (and via the Actions tab's "Run workflow").

### 4. Branch protection (reviewed PRs into main)

Easiest after the first PR has run CI once (so the `check` context exists):

```bash
gh api -X PUT repos/leebology/w104/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f "required_status_checks[strict]=true" \
  -f "required_status_checks[checks][][context]=check" \
  -f "enforce_admins=false" \
  -f "required_pull_request_reviews[required_approving_review_count]=0" \
  -f "restrictions=null"
```

Set `required_approving_review_count` to `1` to require a review. Add friends at
**repo → Settings → Collaborators**.

### 5. Staging web app (`staging.oknameone.com`)

The `staging` branch and the Worker side are already wired by
`.github/workflows/deploy.yml`. The web app half is Vercel dashboard work,
done once:

1. **Settings → Domains → Add** `staging.oknameone.com`. When Vercel asks which
   git branch it should serve, choose **`staging`** — not Production. This is
   the step that turns a throwaway preview into a stable environment.
2. Add the `CNAME` Vercel shows at whoever hosts `oknameone.com`'s DNS.
3. **Settings → Environment Variables** → add `VITE_PARTYKIT_HOST` scoped to
   **Preview**, with the value `w104-staging.liam-donaher.workers.dev`. Vercel
   lets a Preview variable target a specific branch; either target `staging` or
   leave it branch-wide so feature-branch previews use the staging Worker too.
   Leave the existing Production value pointing at the production Worker.
4. Confirm the production variable is still Production-scoped only. A
   Production-and-Preview variable would silently point staging at the
   production Worker, and the symptom — staging players landing in production
   rooms — looks like a game bug, not a config one.
5. **Settings → Deployment Protection → Vercel Authentication → off → Save.**
   Without this, staging is not public — see below.

### Deployment protection must be off

A branch domain still serves *preview* deployments, and Vercel Authentication
protects previews by default. Left on, `staging.oknameone.com` bounces every
visitor to a Vercel login, and granting access one person at a time does not
rescue it: **Hobby allows exactly one external user per account.** The second
friend you hand the URL to cannot get in at all. This is the setting to check
first when staging "works for me" and for nobody else.

The toggle is not plan-gated — Hobby teams can disable it on their own
projects. Equivalently, via the API:

```bash
curl -X PATCH "https://api.vercel.com/v9/projects/w104" -H "Authorization: Bearer $VERCEL_TOKEN" -H "Content-Type: application/json" -d '{"ssoProtection":null}'
```

Protection is **per-project, not per-domain**, so turning it off also makes
every PR preview URL public. That is fine here and is the accepted trade:
the frontend is a static bundle with nothing secret in it (`VITE_PARTYKIT_HOST`
is a public hostname by definition — the browser has to dial it), there are no
accounts and no personal data, and the real access control on a game is the
room code. The paid alternatives (Password Protection, Sharable Links) are
Pro-only and this project stays on free tiers.

> If PR previews ever *do* need to stay locked, the free way is a second Vercel
> project on the same repo whose production branch is `staging`, with
> `staging.oknameone.com` as that project's **production** domain — Standard
> Protection leaves custom production domains public. It costs a duplicated
> project and a duplicated `VITE_PARTYKIT_HOST`. Not worth it today.

Staging is therefore publicly reachable. If you'd rather it not be indexed, add
an `X-Robots-Tag: noindex` header for the staging domain in `vercel.json`.

---

## Everyday workflow (for you and friends)

**Shipping to production:**

1. Branch off `main`: `git checkout -b my-feature`
2. Push and open a PR against `main`.
3. **CI** runs `typecheck` + `test` + `build`; **Vercel** posts a preview URL
   for the PR, pointed at the staging Worker.
4. Merge when green. On merge to `main`:
   - Vercel deploys the web app to `https://www.oknameone.com`.
   - GitHub Actions runs `wrangler deploy` for the production Worker.

**Testing on real phones:** merge into `staging` instead. Within a minute or so
both halves redeploy and `https://staging.oknameone.com` is live for whoever
you hand it to. Nothing about that touches production, and staging is expected
to break sometimes — that's the point of it.

A PR preview URL is enough for anything frontend-only. Use `staging` when the
change touches `party/` (a PR no longer deploys the Worker), or when you need a
URL that three people can type into their phones.

No dashboard access needed to contribute — just push branches and open PRs.

---

## Local development

Requires Node 22+ (`.nvmrc`). Two terminals:

```bash
npm install
npm run dev:party    # wrangler dev — realtime server on http://127.0.0.1:8787
npm run dev          # web app on http://localhost:5173
```

The app auto-connects to the local Worker (no credentials, no env var needed).
Open three tabs — `http://localhost:5173/?p=1` (creates the lobby, plays as
the TV screen), `?p=2` and `?p=3` (join it) — to see the realtime loop end to
end. The `?p=` value namespaces each tab's localStorage identity so they don't
fight over one seat. See "Testing on phones" above to do the same with real
devices.

---

## Costs & limits

All free tier:

- **Vercel Hobby** — free for non-commercial use.
- **Cloudflare Workers + SQLite Durable Objects free tier** — fine for
  party-sized rooms. Review current Workers/DO free-tier limits before any public
  launch.

Current allowances, verified 2026-07-29. Cloudflare's compute limits reset at
**00:00 UTC daily**; storage is a total ceiling that never resets. Vercel's
reset on the account's billing anniversary.

| Service | Metric | Free allowance | Resets |
| --- | --- | --- | --- |
| Workers | Requests | 100,000 / day | daily, 00:00 UTC |
| Durable Objects | Requests | 100,000 / day | daily, 00:00 UTC |
| Durable Objects | Duration | 13,000 GB-s / day | daily, 00:00 UTC |
| Durable Objects | Stored data | 5 GB | never |
| D1 | Rows read | 5,000,000 / day | daily, 00:00 UTC |
| D1 | Rows written | 100,000 / day | daily, 00:00 UTC |
| D1 | Stored data | 5 GB | never |
| Vercel Hobby | Fast data transfer | 100 GB / month | billing date |
| Vercel Hobby | Edge requests | 1,000,000 / month | billing date |

These numbers also live in `LIMITS` in `shared/usage.ts`, which is what the
debug panel draws its bars against. **Change them in both places** — a stale
constant there makes every bar quietly lie, which is worse than no panel.

### The debug usage panel

Every build renders a small triangle in the top-right corner; hovering expands
it to read "debug menu" and clicking slides out a panel with a progress bar per
metric above, plus how long until each one resets.

**Production included, deliberately.** It was staging-only at first, which meant
the numbers worth watching were the only ones you could not see without
deploying a branch. Two things follow from that and are worth knowing rather
than discovering:

- The triangle is on the TV during a real party. It is 34px in a corner and
  nothing opens it by accident, but it is there.
- `https://w104.liam-donaher.workers.dev/debug/usage` is public and
  unauthenticated. What it serves is a handful of account-level usage counts —
  no tokens, no room state, no player data — and the API token never leaves the
  Worker. If that trade stops holding, gate `handleUsage` in `party/server.ts`;
  hiding the client button would not close the endpoint.

**Vercel's two rows are always blank, and that is the honest answer.** Hobby
has no usage API. `GET /v1/billing/charges` exists but reports *charges*, and a
Hobby account has none; the dashboard's own numbers come from an internal
endpoint with no compatibility promise. So the panel prints the ceilings, links
to <https://vercel.com/dashboard/usage>, and declines to invent a figure. If
Vercel ever ships a real endpoint, `vercelService()` in `party/usage.ts` is the
only thing that has to change.

D1's rows stay blank for a different reason: nothing is bound yet. The panel
starts reporting it the moment the score archive's `DB` binding lands.

#### Giving the panel real numbers

Without credentials the panel still opens and still shows every limit — it just
cannot fill in the "used" half. To read live figures it needs a Cloudflare API
token with exactly one permission.

> **Nothing goes into Vercel.** The token lives on the Cloudflare Worker and
> only there. The browser never sees it: the page asks the Worker for
> `/debug/usage`, and the Worker is what calls Cloudflare's API. A
> `VITE_`-prefixed variable is compiled into the JS bundle and readable by
> anyone who opens devtools, so putting an API token in Vercel's environment
> settings would publish it. There is no Vercel-side step at all.
>
> Which mechanism you need depends on which Worker is answering:
>
> | Panel is showing… | Worker answering | Set the token via |
> | --- | --- | --- |
> | `localhost:5173` or a LAN IP | `wrangler dev` | `.dev.vars` |
> | `staging.oknameone.com` or a PR preview | `w104-staging` | `wrangler secret put --env staging` |
> | `www.oknameone.com` | `w104` | `wrangler secret put` |
>
> "NO CREDENTIALS" on a local page therefore means `.dev.vars` is missing —
> `wrangler secret` would not fix it, because that writes to a deployed Worker
> your local page is not talking to.

1. <https://dash.cloudflare.com/profile/api-tokens> → **Create Token** →
   **Create Custom Token** → Permissions: **Account | Account Analytics |
   Read**. Nothing else. Do **not** reuse the "Edit Cloudflare Workers" deploy
   token — that one can rewrite the Worker, and this one only reads numbers.
2. Locally, copy `.dev.vars.example` to `.dev.vars` (gitignored) and fill in
   `CF_API_TOKEN` and `CF_ACCOUNT_ID`. `wrangler dev` picks it up.
3. Set them as Worker secrets on **both** deployed environments — each Worker
   has its own secret store, and the staging pair does not reach production:

```bash
npx wrangler secret put CF_API_TOKEN --env staging
```

```bash
npx wrangler secret put CF_ACCOUNT_ID --env staging
```

```bash
npx wrangler secret put CF_API_TOKEN
```

```bash
npx wrangler secret put CF_ACCOUNT_ID
```

The last two (no `--env`) target production. Skipping them is a supported
state, not a broken one: the production panel opens and shows every limit, it
just says "no credentials" instead of filling in the used half.

Figures are cached in the Worker for 60 seconds, because Cloudflare's GraphQL
API allows 300 queries per 5 minutes per user and a collection spends six. The
panel's **Refresh** button sends `?fresh=1` and skips the cache. The analytics
pipeline itself runs a few minutes behind, so a round you just played will not
appear instantly no matter which button you press.
