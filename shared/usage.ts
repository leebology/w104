/**
 * Free-tier usage: the payload the Worker's `/debug/usage` endpoint returns,
 * and the published limits it is measured against.
 *
 * This is the one file in `shared/` that is not game logic. It lives here for
 * a mechanical reason: `party/usage.ts` produces this payload and
 * `src/components/DebugPanel.tsx` renders it, and those two live in different
 * tsconfig projects (workers-types vs DOM). A type the client imported from
 * `party/` would drag the whole Worker into `tsconfig.json`. Everything below
 * is pure data and pure functions — no DOM, no Cloudflare runtime — so it
 * satisfies the same constraint the rest of `shared/` does.
 *
 * Nothing in the game imports this. Deleting the debug panel would delete it.
 */

/** How a metric's allowance refills. Drives the "resets" line in the panel. */
export type ResetPeriod =
  /** Refills at 00:00 UTC. Every Cloudflare free-tier compute limit. */
  | "daily"
  /** Refills on the account's billing anniversary. Vercel Hobby. */
  | "monthly"
  /** A ceiling, not an allowance — stored bytes. Never refills. */
  | "none";

/** How to format the numbers. The panel has no other knowledge of the metric. */
export type Unit = "count" | "bytes" | "gb-seconds";

export type Metric = {
  /** Shown as the bar's label, e.g. "Requests". */
  label: string;
  /** Null when the figure could not be read; the bar renders as unknown. */
  used: number | null;
  /** The published free-tier allowance. */
  limit: number;
  unit: Unit;
  reset: ResetPeriod;
  /**
   * Why `used` is null, when it is. Surfaced verbatim in the panel — a debug
   * panel that hides its own failure is worse than no panel.
   */
  note?: string;
};

export type ServiceStatus =
  /** Live figures were read. */
  | "ok"
  /** Credentials are absent, so nothing was even attempted. */
  | "unconfigured"
  /** The service exists but publishes no usage API we can call. */
  | "manual"
  /** Credentials were present and the call failed. */
  | "error"
  /** Not part of this deployment yet (D1, until the archive ships). */
  | "unused";

export type Service = {
  /** Stable key, used for React keys and nothing else. */
  id: string;
  /** Shown as the section heading, e.g. "Durable Objects". */
  name: string;
  status: ServiceStatus;
  /** Explains a non-"ok" status, or adds context to an "ok" one. */
  detail?: string;
  /** Where a human goes to see the real numbers. */
  dashboard?: string;
  metrics: Metric[];
};

export type UsageReport = {
  /** Which deployment answered — the panel prints it so a stale tab is obvious. */
  environment: string;
  /** Server clock at collection, ms. Also what the reset countdown is drawn from. */
  fetchedAt: number;
  /**
   * True when the figures came from cache rather than a fresh API call.
   * The panel says so, so "I just played a round and nothing moved" has an
   * explanation that is not "the panel is broken".
   */
  cached: boolean;
  services: Service[];
};

// ---------------------------------------------------------------- limits

/**
 * Published free-tier allowances, verified against Cloudflare's pricing docs
 * on 2026-07-29. These are constants in a table rather than inline numbers
 * because they are the thing most likely to be wrong later: Cloudflare moves
 * them, and a stale number here makes every bar quietly lie.
 *
 * Cloudflare's compute allowances all reset at 00:00 UTC; storage allowances
 * are total ceilings and never reset.
 */
export const LIMITS = {
  /** Workers Free: 100,000 requests/day, reset midnight UTC. */
  workersRequestsPerDay: 100_000,
  /** Durable Objects on Workers Free: 100,000 requests/day. */
  doRequestsPerDay: 100_000,
  /** Durable Objects on Workers Free: 13,000 GB-s/day. */
  doDurationGbsPerDay: 13_000,
  /** SQLite-backed DO storage, total across the account. */
  doStoredBytes: 5 * 1024 ** 3,
  /** D1 Free: 5M rows read/day. */
  d1RowsReadPerDay: 5_000_000,
  /** D1 Free: 100,000 rows written/day — index updates count. */
  d1RowsWrittenPerDay: 100_000,
  /** D1 Free: 5 GB total. */
  d1StoredBytes: 5 * 1024 ** 3,
  /** Vercel Hobby: 100 GB fast data transfer/month. */
  vercelBandwidthBytesPerMonth: 100 * 1024 ** 3,
  /** Vercel Hobby: 1M edge requests/month. */
  vercelEdgeRequestsPerMonth: 1_000_000,
} as const;

/**
 * Durable Object duration is billed in GB-s, but the analytics API reports
 * `activeTime` in microseconds. A Durable Object is allotted 128 MB, so one
 * second of active time is 128/1024 = 0.125 GB-s.
 */
export const DO_GB_PER_INSTANCE = 128 / 1024;

export function activeTimeToGbSeconds(activeTimeMicroseconds: number): number {
  return (activeTimeMicroseconds / 1_000_000) * DO_GB_PER_INSTANCE;
}

// ---------------------------------------------------------------- helpers

/**
 * Fraction of the allowance spent, clamped to 0..1 so a bar can never render
 * wider than its track. The *number* is allowed to exceed the limit — the
 * panel prints "104,000 / 100,000" and pins the bar full — because a bar
 * that silently caps its label would hide the one case worth noticing.
 */
export function fraction(used: number | null, limit: number): number {
  if (used === null || limit <= 0) return 0;
  return Math.min(1, Math.max(0, used / limit));
}

/** Where the panel draws attention. Only the top band is alarming. */
export type Severity = "ok" | "warn" | "danger";

export function severity(used: number | null, limit: number): Severity {
  if (used === null) return "ok";
  const f = used / limit;
  if (f >= 0.9) return "danger";
  if (f >= 0.7) return "warn";
  return "ok";
}

/**
 * When the allowance next refills, as an epoch ms, or null for a ceiling that
 * never does. Daily is the next 00:00 UTC — Cloudflare's, not the viewer's
 * local midnight, which for most of the world is a different day.
 *
 * Monthly has no honest answer: Vercel resets on the account's own billing
 * anniversary, which no API we can call will tell us. The first of the next
 * month is the closest defensible guess, and `RESET_LABEL` says so in words
 * rather than letting the date imply a precision it does not have.
 */
export function nextReset(period: ResetPeriod, now: number): number | null {
  const d = new Date(now);
  if (period === "daily") {
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  }
  if (period === "monthly") {
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }
  return null;
}

export const RESET_LABEL: Record<ResetPeriod, string> = {
  daily: "resets 00:00 UTC",
  monthly: "resets monthly (billing date)",
  none: "total, never resets",
};

// ---------------------------------------------------------------- formatting

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatBytes(n: number): string {
  let value = n;
  let i = 0;
  while (value >= 1024 && i < BYTE_UNITS.length - 1) {
    value /= 1024;
    i += 1;
  }
  // Whole bytes read oddly with a decimal; everything larger reads oddly
  // without one.
  return `${i === 0 ? Math.round(value) : value.toFixed(value < 10 ? 2 : 1)} ${BYTE_UNITS[i]}`;
}

export function formatCount(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function formatValue(n: number, unit: Unit): string {
  if (unit === "bytes") return formatBytes(n);
  if (unit === "gb-seconds") return `${formatCount(n)} GB-s`;
  return formatCount(n);
}

/**
 * "3h 12m" — a duration, not a wall-clock time. A reset at 00:00 UTC printed
 * as a local timestamp makes the reader do timezone arithmetic to answer the
 * only question they have, which is "how long until this frees up".
 */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return "now";
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
