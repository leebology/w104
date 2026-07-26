# Hosting & deployment

This document is the one-time setup runbook plus the everyday workflow. Once
setup is done, contributors only need the "Everyday workflow" and "Local
development" sections.

## Architecture

Two independent pieces, deployed to two hosts, both on free tiers:

| Piece           | What it is                              | Host              | URL                              |
| --------------- | --------------------------------------- | ----------------- | -------------------------------- |
| Web app         | Vite + TypeScript static frontend       | Vercel            | `https://w104.leebo.io`          |
| Realtime server | PartyServer on a Cloudflare Worker;     | Cloudflare        | `wss://w104.liam-donaher.workers.dev` |
|                 | one SQLite Durable Object per room       |                   |                                  |

The browser loads the web app from Vercel, then opens a WebSocket to the
Cloudflare Worker. They are separate origins — that is intentional. Your main
site at `leebo.io` is never touched.

```
Player phones ─┐
               ├─► wss://w104.liam-donaher.workers.dev  (Cloudflare Worker, PartyServer)
Big screen ────┘
       │  loads UI from
       └─► https://w104.leebo.io  (Vercel)

leebo.io (your portfolio) — untouched
```

> Why PartyServer and not PartyKit? PartyKit's shared hosting is full, and its
> CLI can only create key-value Durable Objects, which Cloudflare's free plan no
> longer allows. PartyServer is PartyKit's Cloudflare-maintained successor: same
> room model, deployed as a normal Worker via Wrangler, with the DO pinned to the
> SQLite backend (`new_sqlite_classes` in `wrangler.jsonc`) that the free plan
> requires.

### Staging

`wrangler.jsonc` defines an `env.staging` that deploys a second, fully
isolated Worker: `w104-staging.<subdomain>.workers.dev`, with its own Durable
Object storage (Durable Object bindings are not inherited by named
environments, so they're repeated inside `env.staging`; `migrations` is
top-level and applies to every environment already). `.github/workflows/deploy.yml`
runs `wrangler deploy --env staging` on every pull request into `main`, so a PR
never touches the production room state.

Vercel's **Preview** environment (as opposed to Production) should set
`VITE_PARTYKIT_HOST` to the staging host, e.g. `w104-staging.liam-donaher.workers.dev`,
so PR preview builds of the web app talk to the staging Worker instead of
production.

Note: pull requests opened from a fork do not receive repository secrets, so
the `staging` job fails for outside contributors. That's acceptable for a
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

### 1. Web app on Vercel (subdomain `w104.leebo.io`)

1. In Vercel, **Add New → Project** and import `leebology/w104`.
2. Framework preset **Vite** (auto-detected). Leave build command / output dir at
   defaults (`npm run build` → `dist`).
3. Add an environment variable (Production + Preview + Development):
   - **Key:** `VITE_PARTYKIT_HOST`
   - **Value:** `w104.liam-donaher.workers.dev` (your Worker's URL — the
     `<worker-name>.<your-workers.dev-subdomain>` from step 2 below)
4. **Settings → Domains → Add** `w104.leebo.io`; accept the DNS record Vercel
   offers (or add the shown `CNAME` at your registrar).

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
Vercel. Reload `w104.leebo.io`, create a lobby, then join it with the room
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

---

## Everyday workflow (for you and friends)

1. Branch off `main`: `git checkout -b my-feature`
2. Push and open a PR against `main`.
3. **CI** runs `typecheck` + `build`; **Vercel** posts a preview URL for the PR.
4. Merge when green. On merge to `main`:
   - Vercel deploys the web app to `https://w104.leebo.io`.
   - GitHub Actions runs `wrangler deploy` for the Worker.

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
