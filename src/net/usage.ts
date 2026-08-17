import type { UsageReport } from "../../shared/usage";

/**
 * Client half of the debug panel's data path: where to ask, and whether to ask
 * at all.
 */

// Same fallback as `net/room.ts`: Vercel sets this per environment, and
// without it we are talking to `wrangler dev`.
const HOST = import.meta.env.VITE_PARTYKIT_HOST ?? "127.0.0.1:8787";

/**
 * The Worker always matches the page's scheme in this setup — both halves are
 * plain http locally (an https page cannot open a `ws://` socket, which is why
 * HOSTING.md pins local dev to http) and both are https once deployed. So the
 * page's own protocol is the right one to dial, and there is no list of hosts
 * to keep in step with the socket's.
 */
function usageUrl(fresh: boolean): string {
  return `${location.protocol}//${HOST}/debug/usage${fresh ? "?fresh=1" : ""}`;
}

/**
 * Where the panel is hidden by default. Everywhere else — staging, PR
 * previews, a LAN IP on somebody's wifi, localhost — it simply shows.
 *
 * A hostname list rather than a build-time flag on purpose. It is answerable
 * from the browser that is drawing the triangle, so there is no Vercel setting
 * to keep in step with a `define`, and it fails in the direction that matters:
 * a build that reaches the production address by some route nobody planned
 * still recognises the address bar it arrived at.
 */
const PRODUCTION_HOSTS = ["oknameone.com", "www.oknameone.com"];

/**
 * Set by `?debug=1`, cleared by `?debug=0`. Deliberately not namespaced by
 * `?p=` the way `net/identity.ts` namespaces a seat: that exists so three tabs
 * on one machine can be three players, and one machine's tabs are never the
 * production site.
 */
const UNLOCK_KEY = "w104:debug";

/**
 * Whether this device gets the debug triangle at all.
 *
 * Hidden on production, because a 34px tab labelled "debug menu" sits on a TV
 * in front of a room of people who did not ask for it. **Not hidden very
 * hard**: `?debug=1` once on the production site unlocks it for that device
 * until `?debug=0`, and the reason that hatch exists is the reason this
 * function stopped being a hostname allowlist the first time. The production
 * numbers are the only ones worth watching, and a gate that made checking them
 * mean deploying a branch was doing the opposite of its job.
 *
 * It is a visibility gate and nothing more. Two things it does not do:
 *
 * - It does not close `/debug/usage`, which is reachable on the production
 *   Worker without authentication. What it serves is a handful of
 *   account-level usage counts — no tokens, no room state, no player data. If
 *   that ever stops being an acceptable trade, gate the Worker route
 *   (`handleUsage` in party/server.ts); hiding the button does not close the
 *   endpoint.
 * - It does not stop the events. Every control that mutates a live room is
 *   host-only and rejected server-side in `shared/reduce.ts` and
 *   `party/server.ts`. That is the boundary; this is the tab not being in a
 *   stranger's hand at a party.
 */
export function debugEnabled(): boolean {
  if (!PRODUCTION_HOSTS.includes(location.hostname)) return true;

  const asked = new URLSearchParams(location.search).get("debug");
  if (asked !== null) {
    const on = asked !== "0" && asked !== "false";
    try {
      if (on) localStorage.setItem(UNLOCK_KEY, "1");
      else localStorage.removeItem(UNLOCK_KEY);
    } catch {
      // Storage can throw in a locked-down Safari. Honour the parameter for
      // this page load rather than refusing to open at all.
    }
    return on;
  }

  try {
    return localStorage.getItem(UNLOCK_KEY) === "1";
  } catch {
    return false;
  }
}

export type UsageResult =
  | { ok: true; report: UsageReport }
  | { ok: false; message: string };

/**
 * Never throws. The panel's whole job is to show what is going on, so a dead
 * Worker or a 404 from a production deployment has to arrive as something it
 * can print, not as an unhandled rejection.
 */
export async function fetchUsage(fresh = false): Promise<UsageResult> {
  try {
    const res = await fetch(usageUrl(fresh), { cache: "no-store" });
    if (res.status === 404) {
      // The route is live in every environment now, so a 404 means the Worker
      // this build is pointed at predates it — a stale production deploy, or
      // `VITE_PARTYKIT_HOST` aimed at the wrong one.
      return {
        ok: false,
        message: `${HOST} has no /debug/usage route — that Worker needs redeploying.`,
      };
    }
    if (!res.ok) {
      return { ok: false, message: `Worker returned HTTP ${res.status}.` };
    }
    return { ok: true, report: (await res.json()) as UsageReport };
  } catch (err) {
    // Almost always "the local Worker isn't running": `npm run dev` works
    // without `npm run dev:party`, and this is the first thing that notices.
    return {
      ok: false,
      message: `Couldn't reach ${HOST} — is the Worker running? (${
        err instanceof Error ? err.message : String(err)
      })`,
    };
  }
}
