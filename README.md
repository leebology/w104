# w104

Making lists is more fun with friends.

A Jackbox-style party game: everyone joins from their phone, and the shared
screen runs the show.

## Stack

- **Web app** — Vite + TypeScript, deployed to Vercel at https://w104.leebo.io
- **Realtime server** — PartyKit (on Cloudflare), one authoritative room per game

## Local development

Requires Node 22+ (`.nvmrc`). Two terminals:

```bash
npm install
npm run dev:party    # realtime server on :1999
npm run dev          # web app on :5173
```

Open the web app in two windows to see the connection count sync — that's the
current smoke test proving the realtime loop works end to end.

## Deploying

Push a branch, open a PR against `main`, get a Vercel preview URL, merge when CI
is green. Merges to `main` auto-deploy the web app (Vercel) and the server
(GitHub Actions). Full setup and the everyday workflow are in
[HOSTING.md](HOSTING.md).
