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
 * Every environment, production included — a deliberate choice, not an
 * oversight, and the reason this function still exists instead of the call
 * sites simply dropping the check.
 *
 * It was originally a hostname allowlist covering local, LAN and staging. The
 * production numbers are the ones actually worth watching, and checking them
 * meant deploying a branch to see them, so the gate was doing the opposite of
 * its job. Two consequences, both accepted on purpose:
 *
 * - The triangle is on the TV during a real party. It is 34px in a corner and
 *   nothing opens it by accident.
 * - `/debug/usage` is reachable on the production Worker without
 *   authentication. What it serves is a handful of account-level usage counts
 *   — no tokens, no room state, no player data. If that ever stops being an
 *   acceptable trade, gate the Worker route (party/server.ts) rather than this
 *   function: hiding the button does not close the endpoint.
 *
 * Kept as a function so there is one place to put a condition back.
 */
export function debugEnabled(): boolean {
  return true;
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
