import type { UsageReport } from "../../shared/usage";

/**
 * Client half of the debug panel's data path: where to ask, and whether to ask
 * at all. The Worker's `/debug/usage` route is the real gate — it 404s on the
 * production deployment — so everything here is about not bothering it, and
 * about never rendering a developer affordance on a screen a party is looking
 * at.
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
 * Loopback and the RFC1918 ranges. The LAN-IP case is the one that matters:
 * phone testing runs the app on e.g. `192.168.1.42:5173`, which is a *preview*
 * build as often as a dev one, so `import.meta.env.DEV` alone would hide the
 * panel exactly where three real devices are hammering the free tier.
 */
const PRIVATE_HOST =
  /^(localhost|\[::1\]|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;

/**
 * Staging and local only. An allowlist rather than "hide on the production
 * domain": a new production hostname added later fails closed this way, and
 * the failure mode of the other arrangement is a debug triangle on a TV.
 */
export function debugEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  const host = location.hostname;
  if (PRIVATE_HOST.test(host)) return true;
  // The branch domain, and every per-PR Vercel preview.
  return host === "staging.oknameone.com" || host.endsWith(".vercel.app");
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
      return {
        ok: false,
        message: "The Worker has no /debug/usage route — it is disabled in production.",
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
