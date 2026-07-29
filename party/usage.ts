/**
 * Free-tier usage collection for the debug panel.
 *
 * Reads Cloudflare's GraphQL Analytics API and shapes the answer into the
 * `UsageReport` that `src/components/DebugPanel.tsx` renders. Nothing here is
 * on any game path — `party/server.ts` calls it from one HTTP route that is
 * 404 in production, and the game plays identically if this file is deleted.
 *
 * Two rules shape the whole file:
 *
 * **One request per metric group, each with its own try/catch.** Cloudflare's
 * analytics schema is discovered by introspection rather than published field
 * by field, so a field name here can be wrong. Batched into one query, one
 * wrong name is a GraphQL error that returns *no* data and the panel goes
 * blank with no clue why. Split, a wrong name nulls one bar and prints the
 * error on it. That is worth the extra round trips: they are cached, off the
 * game path, and there are six of them.
 *
 * **Failures become data, never exceptions.** Every path returns a report.
 * A missing token, an expired token and a renamed field all render as
 * something legible in the panel.
 */

import {
  activeTimeToGbSeconds,
  LIMITS,
  type Metric,
  type Service,
  type UsageReport,
} from "../shared/usage";

const GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";

/**
 * Cloudflare's per-user cap is 300 GraphQL queries per 5 minutes and this
 * endpoint spends six per collection, so an open panel polling freely could
 * burn the budget on its own. A minute is also honest about the data: these
 * analytics pipelines are minutes behind real time, so a faster refresh would
 * show the same numbers while claiming to be new.
 */
const CACHE_TTL_MS = 60_000;

/**
 * Module scope, so it lives as long as the isolate and no longer. Losing it
 * on eviction costs one extra API call.
 */
let cache: { at: number; report: UsageReport } | null = null;

export type UsageEnv = {
  /** "production" | "staging" | "local". Set as a var in wrangler.jsonc. */
  ENVIRONMENT?: string;
  /** The deployed script name, so Workers metrics count this Worker only. */
  WORKER_NAME?: string;
  /** Secret. Needs Account Analytics: Read. */
  CF_API_TOKEN?: string;
  /** Secret. The account the Worker is deployed to. */
  CF_ACCOUNT_ID?: string;
  /** Present only once the score archive ships; gates the D1 section. */
  DB?: unknown;
};

// ---------------------------------------------------------------- graphql

type GraphQLResponse<T> = {
  data?: { viewer?: { accounts?: T[] } | null } | null;
  errors?: { message?: string }[] | null;
};

/**
 * Runs one account-scoped query and returns the single account node.
 *
 * Throws on every failure mode — transport, HTTP status, GraphQL `errors`, and
 * the quietly awful one where `data.viewer.accounts` is `[]` because the token
 * is valid but lacks Account Analytics: Read. That last case returns HTTP 200
 * with no errors array, so without this check it would read as "zero usage"
 * and the panel would show a room full of empty bars that look fine.
 */
async function queryAccount<T>(
  env: UsageEnv,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CF_API_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      query,
      variables: { accountTag: env.CF_ACCOUNT_ID, ...variables },
    }),
  });

  if (!res.ok) {
    // Cloudflare puts the actual reason in the body — "Invalid request
    // headers" for a bad token, a field name for a bad query — and the status
    // line alone says none of it. Truncated because this is going into a
    // 380px panel, and read defensively because an error path that throws its
    // own error tells you nothing at all.
    const body = await res.text().catch(() => "");
    throw new Error(
      `HTTP ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 300)}` : ""}`,
    );
  }

  const body = (await res.json()) as GraphQLResponse<T>;
  if (body.errors?.length) {
    throw new Error(body.errors.map((e) => e.message ?? "unknown").join("; "));
  }

  const accounts = body.data?.viewer?.accounts;
  if (!accounts?.length) {
    throw new Error(
      "no account data — check CF_ACCOUNT_ID and that the token has Account Analytics: Read",
    );
  }
  return accounts[0]!;
}

/** `2026-07-29` in UTC, which is the day Cloudflare's daily allowances run on. */
function utcDate(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Midnight UTC today, ISO — the start of the current daily allowance. */
function utcDayStart(now: number): string {
  return `${utcDate(now)}T00:00:00Z`;
}

/**
 * Runs a collector and turns any throw into the metric's `note`, so one
 * renamed analytics field cannot blank the whole panel. See the file header.
 */
async function readMetric(
  base: Omit<Metric, "used">,
  read: () => Promise<number>,
): Promise<Metric> {
  try {
    return { ...base, used: await read() };
  } catch (err) {
    return { ...base, used: null, note: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------- datasets

type SumNodes<K extends string> = Record<string, { sum: Record<K, number> }[]>;
type MaxNodes<K extends string> = Record<string, { max: Record<K, number> }[]>;

/**
 * Adaptive datasets return one node per group, and asking for no `dimensions`
 * does not reliably collapse that to a single node. Summing the nodes is
 * correct whether there is one or fifty.
 */
function sumOver<K extends string>(
  nodes: { sum: Record<K, number> }[] | undefined,
  field: K,
): number {
  return (nodes ?? []).reduce((total, node) => total + (node.sum?.[field] ?? 0), 0);
}

function maxOver<K extends string>(
  nodes: { max: Record<K, number> }[] | undefined,
  field: K,
): number {
  return (nodes ?? []).reduce((peak, node) => Math.max(peak, node.max?.[field] ?? 0), 0);
}

async function workersRequests(env: UsageEnv, now: number): Promise<number> {
  const account = await queryAccount<SumNodes<"requests">>(
    env,
    `query($accountTag: string!, $start: string!, $scriptName: string!) {
       viewer { accounts(filter: { accountTag: $accountTag }) {
         workersInvocationsAdaptive(
           limit: 10000
           filter: { scriptName: $scriptName, datetime_geq: $start }
         ) { sum { requests } }
       } }
     }`,
    { start: utcDayStart(now), scriptName: env.WORKER_NAME ?? "w104" },
  );
  return sumOver(account.workersInvocationsAdaptive, "requests");
}

async function doRequests(env: UsageEnv, now: number): Promise<number> {
  const account = await queryAccount<SumNodes<"requests">>(
    env,
    `query($accountTag: string!, $date: string!) {
       viewer { accounts(filter: { accountTag: $accountTag }) {
         durableObjectsInvocationsAdaptiveGroups(
           limit: 10000
           filter: { date_geq: $date }
         ) { sum { requests } }
       } }
     }`,
    { date: utcDate(now) },
  );
  return sumOver(account.durableObjectsInvocationsAdaptiveGroups, "requests");
}

/**
 * Duration is billed in GB-s but reported as `activeTime` in microseconds, so
 * the conversion — and the 128 MB figure behind it — lives in `shared/usage.ts`
 * next to the limit it is compared against.
 */
async function doDurationGbs(env: UsageEnv, now: number): Promise<number> {
  const account = await queryAccount<SumNodes<"activeTime">>(
    env,
    `query($accountTag: string!, $date: string!) {
       viewer { accounts(filter: { accountTag: $accountTag }) {
         durableObjectsPeriodicGroups(
           limit: 10000
           filter: { date_geq: $date }
         ) { sum { activeTime } }
       } }
     }`,
    { date: utcDate(now) },
  );
  return activeTimeToGbSeconds(
    sumOver(account.durableObjectsPeriodicGroups, "activeTime"),
  );
}

/**
 * Stored bytes is a level, not a flow: the account's peak today is the number
 * that matters against a 5 GB ceiling, so this maxes where the others sum.
 */
async function doStoredBytes(env: UsageEnv, now: number): Promise<number> {
  const account = await queryAccount<MaxNodes<"storedBytes">>(
    env,
    `query($accountTag: string!, $date: string!) {
       viewer { accounts(filter: { accountTag: $accountTag }) {
         durableObjectsStorageGroups(
           limit: 10000
           filter: { date_geq: $date }
         ) { max { storedBytes } }
       } }
     }`,
    { date: utcDate(now) },
  );
  return maxOver(account.durableObjectsStorageGroups, "storedBytes");
}

async function d1Rows(env: UsageEnv, now: number, field: "rowsRead" | "rowsWritten") {
  const account = await queryAccount<SumNodes<"rowsRead" | "rowsWritten">>(
    env,
    `query($accountTag: string!, $date: string!) {
       viewer { accounts(filter: { accountTag: $accountTag }) {
         d1AnalyticsAdaptiveGroups(
           limit: 10000
           filter: { date_geq: $date }
         ) { sum { rowsRead rowsWritten } }
       } }
     }`,
    { date: utcDate(now) },
  );
  return sumOver(account.d1AnalyticsAdaptiveGroups, field);
}

/**
 * Summed, not maxed, and deliberately: each node is one database's size on one
 * day, and the 5 GB ceiling is per account. Pinning the date to today keeps it
 * one node per database rather than one per database per day.
 */
async function d1StoredBytes(env: UsageEnv, now: number): Promise<number> {
  const account = await queryAccount<SumNodes<"databaseSizeBytes">>(
    env,
    `query($accountTag: string!, $date: string!) {
       viewer { accounts(filter: { accountTag: $accountTag }) {
         d1AnalyticsAdaptiveGroups(
           limit: 10000
           filter: { date_geq: $date }
         ) { sum { databaseSizeBytes } }
       } }
     }`,
    { date: utcDate(now) },
  );
  return sumOver(account.d1AnalyticsAdaptiveGroups, "databaseSizeBytes");
}

// ---------------------------------------------------------------- services

const WORKERS_DASHBOARD = "https://dash.cloudflare.com/?to=/:account/workers/overview";
const D1_DASHBOARD = "https://dash.cloudflare.com/?to=/:account/workers/d1";
/**
 * The project's own usage page, not the account-wide one. Both are behind a
 * Vercel login, so this link is only useful to whoever owns the project — and
 * it is the only route to these two numbers at all, hence the explicit
 * call-to-action row rather than a link on the heading.
 */
const VERCEL_DASHBOARD = "https://vercel.com/leebotomy/w104/usage";

/**
 * Vercel publishes no usage API on Hobby. `/v1/billing/charges` exists but
 * reports charges, and a Hobby account has none; the dashboard's own figures
 * come from an internal endpoint with no compatibility promise. So this
 * section states the ceilings and sends you to the dashboard rather than
 * inventing a number — a bar filled from a guess is worse than an empty one.
 *
 * The ceilings are still worth rendering: the panel is also where you go to be
 * reminded what the allowance *is*.
 */
function vercelService(): Service {
  const manual = (label: string, limit: number, unit: Metric["unit"]): Metric => ({
    label,
    used: null,
    limit,
    unit,
    reset: "monthly",
  });
  return {
    id: "vercel",
    name: "Vercel (Hobby)",
    status: "manual",
    detail: "No usage API on Hobby — these two can only be read off the dashboard.",
    dashboard: VERCEL_DASHBOARD,
    dashboardLabel: "Open Vercel usage →",
    metrics: [
      manual("Fast data transfer", LIMITS.vercelBandwidthBytesPerMonth, "bytes"),
      manual("Edge requests", LIMITS.vercelEdgeRequestsPerMonth, "count"),
    ],
  };
}

async function cloudflareServices(env: UsageEnv, now: number): Promise<Service[]> {
  const [requests, doReq, doDur, doBytes] = await Promise.all([
    readMetric(
      { label: "Requests", limit: LIMITS.workersRequestsPerDay, unit: "count", reset: "daily" },
      () => workersRequests(env, now),
    ),
    readMetric(
      { label: "Requests", limit: LIMITS.doRequestsPerDay, unit: "count", reset: "daily" },
      () => doRequests(env, now),
    ),
    readMetric(
      { label: "Duration", limit: LIMITS.doDurationGbsPerDay, unit: "gb-seconds", reset: "daily" },
      () => doDurationGbs(env, now),
    ),
    readMetric(
      { label: "Stored data", limit: LIMITS.doStoredBytes, unit: "bytes", reset: "none" },
      () => doStoredBytes(env, now),
    ),
  ]);

  return [
    {
      id: "workers",
      name: `Workers — ${env.WORKER_NAME ?? "w104"}`,
      status: requests.used === null ? "error" : "ok",
      detail: "This Worker only. Other scripts on the account share the allowance.",
      dashboard: WORKERS_DASHBOARD,
      metrics: [requests],
    },
    {
      id: "durable-objects",
      name: "Durable Objects",
      status: doReq.used === null && doDur.used === null ? "error" : "ok",
      detail: "Account-wide — every room, every environment.",
      dashboard: WORKERS_DASHBOARD,
      metrics: [doReq, doDur, doBytes],
    },
  ];
}

async function d1Service(env: UsageEnv, now: number): Promise<Service> {
  const base: Omit<Service, "metrics" | "status"> = {
    id: "d1",
    name: "D1",
    dashboard: D1_DASHBOARD,
  };

  // No binding means the score archive has not shipped yet. Show the ceilings
  // it will be measured against rather than hiding the section — knowing the
  // budget before the writes start is the point of budgeting.
  if (!env.DB) {
    return {
      ...base,
      status: "unused",
      detail: "No database bound yet — the score archive is designed but not built.",
      metrics: [
        { label: "Rows read", used: null, limit: LIMITS.d1RowsReadPerDay, unit: "count", reset: "daily" },
        { label: "Rows written", used: null, limit: LIMITS.d1RowsWrittenPerDay, unit: "count", reset: "daily" },
        { label: "Stored data", used: null, limit: LIMITS.d1StoredBytes, unit: "bytes", reset: "none" },
      ],
    };
  }

  const [read, written, bytes] = await Promise.all([
    readMetric(
      { label: "Rows read", limit: LIMITS.d1RowsReadPerDay, unit: "count", reset: "daily" },
      () => d1Rows(env, now, "rowsRead"),
    ),
    readMetric(
      { label: "Rows written", limit: LIMITS.d1RowsWrittenPerDay, unit: "count", reset: "daily" },
      () => d1Rows(env, now, "rowsWritten"),
    ),
    readMetric(
      { label: "Stored data", limit: LIMITS.d1StoredBytes, unit: "bytes", reset: "none" },
      () => d1StoredBytes(env, now),
    ),
  ]);

  return {
    ...base,
    status: read.used === null && written.used === null ? "error" : "ok",
    detail: "Account-wide, across every database.",
    metrics: [read, written, bytes],
  };
}

/**
 * Every Cloudflare section, with no credentials to read them with. Rendered
 * the same way as a live report so the panel is worth opening before the token
 * is set up — the limits are useful on their own.
 */
function unconfiguredServices(env: UsageEnv): Service[] {
  const blank = (label: string, limit: number, unit: Metric["unit"], reset: Metric["reset"]): Metric =>
    ({ label, used: null, limit, unit, reset });
  const detail = "Set CF_API_TOKEN and CF_ACCOUNT_ID to read live figures.";
  return [
    {
      id: "workers",
      name: `Workers — ${env.WORKER_NAME ?? "w104"}`,
      status: "unconfigured",
      detail,
      dashboard: WORKERS_DASHBOARD,
      metrics: [blank("Requests", LIMITS.workersRequestsPerDay, "count", "daily")],
    },
    {
      id: "durable-objects",
      name: "Durable Objects",
      status: "unconfigured",
      detail,
      dashboard: WORKERS_DASHBOARD,
      metrics: [
        blank("Requests", LIMITS.doRequestsPerDay, "count", "daily"),
        blank("Duration", LIMITS.doDurationGbsPerDay, "gb-seconds", "daily"),
        blank("Stored data", LIMITS.doStoredBytes, "bytes", "none"),
      ],
    },
    {
      id: "d1",
      name: "D1",
      status: "unconfigured",
      detail,
      dashboard: D1_DASHBOARD,
      metrics: [
        blank("Rows read", LIMITS.d1RowsReadPerDay, "count", "daily"),
        blank("Rows written", LIMITS.d1RowsWrittenPerDay, "count", "daily"),
        blank("Stored data", LIMITS.d1StoredBytes, "bytes", "none"),
      ],
    },
  ];
}

// ---------------------------------------------------------------- entrypoint

/**
 * The whole report. Never throws: a caller that got a `UsageReport` back knows
 * only that *something* is renderable, and each service says for itself
 * whether its numbers are real.
 */
export async function collectUsage(
  env: UsageEnv,
  now: number,
  options: { fresh?: boolean } = {},
): Promise<UsageReport> {
  if (!options.fresh && cache && now - cache.at < CACHE_TTL_MS) {
    return { ...cache.report, cached: true };
  }

  const environment = env.ENVIRONMENT ?? "local";
  const credentialled = Boolean(env.CF_API_TOKEN && env.CF_ACCOUNT_ID);

  const services = credentialled
    ? [...(await cloudflareServices(env, now)), await d1Service(env, now), vercelService()]
    : [...unconfiguredServices(env), vercelService()];

  const report: UsageReport = { environment, fetchedAt: now, cached: false, services };
  cache = { at: now, report };
  return report;
}

/** Test seam and a way for `?fresh=1` to be honest about what it discarded. */
export function clearUsageCache(): void {
  cache = null;
}
