# Hosting & deployment

This document is the one-time setup runbook plus the everyday workflow. Once
the setup steps are done, contributors only ever need the "Everyday workflow"
and "Local development" sections.

## Architecture

Two independent pieces, deployed to two hosts, both on free tiers:

| Piece            | What it is                          | Host                | URL                              |
| ---------------- | ----------------------------------- | ------------------- | -------------------------------- |
| Web app          | Vite + TypeScript static frontend   | Vercel              | `https://w104.leebo.io`          |
| Realtime server  | PartyKit (one room instance / game) | Cloudflare/PartyKit | `wss://w104.leebology.partykit.dev` |

The browser loads the web app from Vercel, then opens a WebSocket to the
PartyKit server. They are separate origins — that is fine and intentional. Your
main site at `leebo.io` is never touched.

```
Player phones ─┐
               ├─► wss://w104.leebology.partykit.dev  (PartyKit, Cloudflare)
Big screen ────┘
       │  loads UI from
       └─► https://w104.leebo.io  (Vercel)

leebo.io (your portfolio) — untouched
```

---

## One-time setup

Do these once. Steps 1–2 stand up the two hosts; steps 3–5 wire up automated
deploys so contributors never touch a dashboard again.

### 1. Web app on Vercel (subdomain `w104.leebo.io`)

1. In Vercel, **Add New → Project** and import `leebology/w104` from GitHub.
2. Framework preset: **Vite** (auto-detected). Build command `npm run build`,
   output directory `dist` — both defaults, leave as-is.
3. Add an environment variable (used at build time):
   - **Key:** `VITE_PARTYKIT_HOST`
   - **Value:** `w104.leebology.partykit.dev`
     (this is `<partykit.json name>.<your-partykit-login>.partykit.dev`; the
     login is your GitHub username, `leebology`.)
   - Apply to **Production, Preview, and Development**.
4. Deploy. Confirm the app loads at the temporary `*.vercel.app` URL.
5. **Project → Settings → Domains → Add** `w104.leebo.io`.
   - Because `leebo.io` already lives on Vercel, Vercel will offer to create the
     DNS record for you automatically — accept it. (A subdomain can point to a
     different Vercel project than the apex; they don't conflict.)
   - If your DNS is instead managed at your registrar, add the exact record
     Vercel shows — typically a `CNAME` from `w104` to `cname.vercel-dns.com`.
6. Wait for the certificate to issue, then load `https://w104.leebo.io`.

> The status will read "disconnected" until the PartyKit server exists (step 2).

### 2. Realtime server on PartyKit

PartyKit runs on Cloudflare's free tier and uses your GitHub login for auth.
Run locally, from the repo root:

```bash
npx partykit login      # opens a browser, authorizes as leebology (one time)
npx partykit deploy      # first deploy — creates the project
```

The deploy prints the server URL: `https://w104.leebology.partykit.dev`. That
must match the `VITE_PARTYKIT_HOST` you set in Vercel. Reload `w104.leebo.io`;
status should now read **connected**, and opening a second tab should bump the
"connected" count.

### 3. PartyKit deploy token for CI

So GitHub Actions can deploy the server on merge (instead of you running
`partykit deploy` by hand):

```bash
npx partykit token generate
```

This prints a `PARTYKIT_LOGIN` (your username) and a `PARTYKIT_TOKEN` (secret —
anyone with it can deploy as you; never commit it).

### 4. GitHub secrets

Add both values at **repo → Settings → Secrets and variables → Actions → New
repository secret**, or via the CLI:

```bash
gh secret set PARTYKIT_LOGIN --body "leebology"
gh secret set PARTYKIT_TOKEN --body "<paste the token>"
```

Now `.github/workflows/deploy.yml` will deploy the server on every push to
`main`.

### 5. Branch protection (so friends merge via reviewed PRs)

Protect `main` so all changes go through a PR whose CI passes. Easiest after the
first PR has run CI once (so the check name "check" is registered):

```bash
gh api -X PUT repos/leebology/w104/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f "required_status_checks[strict]=true" \
  -f "required_status_checks[checks][][context]=check" \
  -f "enforce_admins=false" \
  -f "required_pull_request_reviews[required_approving_review_count]=0" \
  -f "restrictions=null"
```

Bump `required_approving_review_count` to `1` if you want a review required
before merge. Add collaborators at **repo → Settings → Collaborators**.

---

## Everyday workflow (for you and friends)

1. Branch off `main`: `git checkout -b my-feature`
2. Push and open a PR against `main`.
3. **CI** runs `typecheck` + `build` on the PR. **Vercel** posts a unique
   **preview URL** for that PR — click it to try the change live.
4. Merge when CI is green (and reviewed, if required). On merge to `main`:
   - Vercel deploys the web app to `https://w104.leebo.io`.
   - GitHub Actions deploys the PartyKit server.

No one needs dashboard access to contribute — just push branches and open PRs.

---

## Local development

Requires Node 22+ (`.nvmrc` pins it). Two terminals:

```bash
npm install
npm run dev:party    # terminal 1 — realtime server on http://127.0.0.1:1999
npm run dev          # terminal 2 — web app on http://localhost:5173
```

The app auto-connects to the local PartyKit server (no env var needed). Open the
web app in two browser windows to see presence/waves sync.

---

## Costs & limits

Everything above is free tier. Things to keep an eye on as usage grows:

- **Vercel Hobby** — free for non-commercial use; generous static-bandwidth
  limits.
- **PartyKit / Cloudflare free tier** — fine for party-sized rooms; check
  current Workers/Durable Objects free-tier limits before any public launch.
