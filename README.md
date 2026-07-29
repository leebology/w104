# w104

Making lists is more fun with friends.

A Jackbox-style party game: everyone joins from their phone, and the shared
screen runs the show.

## Stack

- **Web app** — Vite + TypeScript, deployed to Vercel at https://www.oknameone.com
- **Realtime server** — PartyServer on a Cloudflare Worker; one SQLite Durable
  Object per room (authoritative room state)

## Local development

Requires Node 22+ (`.nvmrc`). Two terminals:

```bash
npm install
npm run dev:party    # wrangler dev — realtime server on :8787
npm run dev          # web app on :5173
npm test             # 322 tests
```

Every build shows a small triangle in the top-right corner. Hover it, click it,
and you get free-tier usage bars for Workers, Durable Objects and D1, with how
long until each allowance resets. It needs a read-only Cloudflare API token to
show live numbers — see
[HOSTING.md](HOSTING.md#the-debug-usage-panel) — and without one it still opens
and shows every limit.

Open three tabs — `http://localhost:5173/?p=1` (creates the lobby; this is
the shared/TV screen and doesn't play), then `?p=2` and `?p=3` (join it) —
that's the current smoke test proving the realtime loop works end to end. The
`?p=` value namespaces each tab's localStorage so they don't fight over one
seat. Three real devices on the same wifi work too, and are the better test —
see [HOSTING.md](HOSTING.md#testing-on-phones) for the LAN setup.

## Deploying

Push a branch, open a PR against `main`, get a Vercel preview URL, merge when CI
is green. Merges to `main` auto-deploy the web app (Vercel) and the server
(GitHub Actions → `wrangler deploy`). Full setup and the everyday workflow are in
[HOSTING.md](HOSTING.md).
