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

Staging is publicly reachable. It's a party game with no accounts and no
personal data, so that's acceptable; if you'd rather it not be indexed, add a
`X-Robots-Tag: noindex` header for the staging domain in `vercel.json`.

---

## Everyday workflow (for you and friends)

**Shipping to production:**

1. Branch off `main`: `git checkout -b my-feature`
2. Push and open a PR against `main`.
3. **CI** runs `typecheck` + `test` + `build`; **Vercel** posts a preview URL
   for the PR, pointed at the staging Worker.
4. Merge when green. On merge to `main`:
   - Vercel deploys the web app to `https://w104.leebo.io`.
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
