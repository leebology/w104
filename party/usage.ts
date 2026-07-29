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

/**
 * Every Worker's request count for today, broken down by script, plus the
 * account total.
 *
 * Deliberately **unfiltered** by `scriptName` and grouped by it instead. One
 * request then answers "how much of the allowance is left" and "which Worker
 * spent it" at once, and the total is the true account figure rather than the
 * sum of the two scripts this repo happens to know about.
 *
 * A script with no traffic today simply does not appear in the response, which
 * is why the caller defaults a missing entry to 0 rather than to unknown.
 */
async function workersByScript(
  env: UsageEnv,
  now: number,
): Promise<{ total: number; byScript: Map<string, number> }> {
  const account = await queryAccount<{
    workersInvocationsAdaptive?: {
      sum: { requests: number };
      dimensions: { scriptName: string };
    }[];
  }>(
    env,
    `query($accountTag: string!, $start: string!) {
       viewer { accounts(filter: { accountTag: $accountTag }) {
         workersInvocationsAdaptive(
           limit: 10000
           filter: { datetime_geq: $start }
         ) { sum { requests } dimensions { scriptName } }
       } }
     }`,
    { start: utcDayStart(now) },
  );

  const byScript = new Map<string, number>();
  let total = 0;
  for (const node of account.workersInvocationsAdaptive ?? []) {
    const requests = node.sum?.requests ?? 0;
    total += requests;
    const name = node.dimensions?.scriptName;
    if (name) byScript.set(name, (byScript.get(name) ?? 0) + requests);
  }
  return { total, byScript };
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
 * Storage lives in its own dataset — `d1StorageAdaptiveGroups`, not the
 * `d1AnalyticsAdaptiveGroups` the row counts come from. Cloudflare's own
 * documented example lists `databaseSizeBytes` under the latter's `sum`, and
 * the live schema rejects it there: "unknown field". The panel surfaced that
 * as one blank bar with the message on it, which is the entire argument for
 * one request per metric.
 *
 * **Max per database, then summed across them.** Size is a level, not a flow,
 * so summing raw nodes would multiply a database by however many samples the
 * day happens to hold. Grouping by `databaseId` and taking each one's peak
 * gives one honest figure each; adding those gives the account total, which is
 * what the 5 GB ceiling actually applies to.
 */
async function d1StoredBytes(env: UsageEnv, now: number): Promise<number> {
  const account = await queryAccount<{
    d1StorageAdaptiveGroups?: {
      max: { databaseSizeBytes: number };
      dimensions: { databaseId: string };
    }[];
  }>(
    env,
    `query($accountTag: string!, $date: string!) {
       viewer { accounts(filter: { accountTag: $accountTag }) {
         d1StorageAdaptiveGroups(
           limit: 10000
           filter: { date_geq: $date }
         ) { max { databaseSizeBytes } dimensions { databaseId } }
       } }
     }`,
    { date: utcDate(now) },
  );

  const peak = new Map<string, number>();
  for (const node of account.d1StorageAdaptiveGroups ?? []) {
    const id = node.dimensions?.databaseId ?? "";
    const bytes = node.max?.databaseSizeBytes ?? 0;
    peak.set(id, Math.max(peak.get(id) ?? 0, bytes));
  }
  return [...peak.values()].reduce((total, bytes) => total + bytes, 0);
}

// ---------------------------------------------------------------- services

const WORKERS_DASHBOARD = "https://dash.cloudflare.com/?to=/:account/workers/overview";

/**
 * The deployed scripts, in the order they should read. These names are the
 * `name` fields in `wrangler.jsonc` — top level and `env.staging`. A rename
 * there without one here shows that Worker as permanently idle rather than as
 * an error, which is the failure mode to watch for.
 *
 * Both are listed regardless of which environment the panel is opened from, so
 * staging and production usage are checkable from anywhere.
 */
const WORKER_SCRIPTS = [
  { name: "w104", label: "· w104 (production)" },
  { name: "w104-staging", label: "· w104-staging" },
] as const;

/**
 * The Workers daily allowance is **per account, not per script** — 100,000
 * requests across everything deployed. So the section leads with the account
 * total, which is the figure the limit actually applies to, and the per-script
 * rows under it are a breakdown rather than independent budgets. Two bars at
 * 60% each would otherwise look survivable while being 120% of one allowance.
 *
 * The local caveat is stated unconditionally because it is unconditionally
 * true: `wrangler dev` runs on your machine and never reaches Cloudflare's
 * edge, so local play generates no analytics no matter where the panel is
 * opened from.
 */
const WORKERS_DETAIL =
  "One 100,000/day allowance for the whole account; the rows below break it down. Local dev never reaches Cloudflare, so it adds nothing here.";

/** Durable Object and D1 counters are neither per-script nor per-environment. */
const ACCOUNT_WIDE = "Account-wide — shared between every environment.";

/**
 * What actually spends each allowance, in this app specifically.
 *
 * Written against how w104 is built rather than restating Cloudflare's
 * pricing page, because the useful question is "which of ours is going
 * fastest and why", and the answer is not obvious from the bars: Durable
 * Object *duration* runs far ahead of Durable Object *requests* here, and the
 * reason is architectural rather than anything to do with how busy a room is.
 *
 * Verified against Cloudflare's pricing docs and this repo on 2026-07-29.
 * Re-check the hibernation claim if `partyserver` is upgraded — it is the one
 * that would silently stop being true.
 */
const SOURCES = {
  workers:
    "One request per socket a phone opens, plus this panel's own polling. The page itself loads from Vercel and never touches the Worker.",
  durableObjects:
    "Requests are incoming socket messages — each word submitted, each ready tap — plus alarms; broadcasts out are free and messages in bill 20:1. Duration is wall-clock time a room is held in memory, and PartyServer runs without the hibernation API here, so a room bills from first join until it is reaped whether or not anyone is typing. That makes Duration the fastest-moving bar, and it tracks how long rooms stay open rather than how busy they are.",
  d1:
    "Writes from the score archive: one row per word plus round and scorer rows each time a round banks, and index updates count as writes too. The game never reads D1, so rows read stays near zero.",
} as const;
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
  return {
    id: "vercel",
    name: "Vercel (Hobby)",
    status: "manual",
    // No bars at all, on purpose. Fast data transfer and edge requests used to
    // render as two permanently empty tracks, which reads as a panel that is
    // failing rather than one reporting a limitation. A link is the honest
    // shape for a number nothing can fetch.
    detail: "Hobby tier doesn't include usage API. Check analytics on Vercel site.",
    dashboard: VERCEL_DASHBOARD,
    dashboardLabel: "Open Vercel usage →",
    metrics: [],
  };
}

/**
 * One query feeds every bar here, so this builds the whole section rather than
 * going through `readMetric` per bar — a failure blanks all three rows with
 * the same note, which the panel hoists to the section heading.
 */
async function workersService(env: UsageEnv, now: number): Promise<Service> {
  const row = (label: string, used: number | null, note?: string): Metric => ({
    label,
    used,
    limit: LIMITS.workersRequestsPerDay,
    unit: "count",
    reset: "daily",
    note,
  });
  const base: Omit<Service, "metrics" | "status"> = {
    id: "workers",
    name: "Workers",
    sources: SOURCES.workers,
    detail: WORKERS_DETAIL,
    dashboard: WORKERS_DASHBOARD,
  };

  try {
    const { total, byScript } = await workersByScript(env, now);
    return {
      ...base,
      status: "ok",
      metrics: [
        row("All Workers", total),
        // Absent from the response means no traffic today, not no data.
        ...WORKER_SCRIPTS.map((s) => row(s.label, byScript.get(s.name) ?? 0)),
      ],
    };
  } catch (err) {
    const note = err instanceof Error ? err.message : String(err);
    return {
      ...base,
      status: "error",
      metrics: [
        row("All Workers", null, note),
        ...WORKER_SCRIPTS.map((s) => row(s.label, null, note)),
      ],
    };
  }
}

async function durableObjectsService(env: UsageEnv, now: number): Promise<Service> {
  const [doReq, doDur, doBytes] = await Promise.all([
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

  return {
    id: "durable-objects",
    name: "Durable Objects",
    status: doReq.used === null && doDur.used === null ? "error" : "ok",
    sources: SOURCES.durableObjects,
    detail: ACCOUNT_WIDE,
    dashboard: WORKERS_DASHBOARD,
    metrics: [doReq, doDur, doBytes],
  };
}

async function d1Service(env: UsageEnv, now: number): Promise<Service> {
  const base: Omit<Service, "metrics" | "status"> = {
    id: "d1",
    name: "D1",
    sources: SOURCES.d1,
    dashboard: D1_DASHBOARD,
  };

  // No binding means the score archive has not shipped yet. Show the ceilings
  // it will be measured against rather than hiding the section — knowing the
  // budget before the writes start is the point of budgeting.
  if (!env.DB) {
    return {
      ...base,
      status: "unused",
      detail:
        "Nothing writes to D1 yet. The score archive is specced but unbuilt; these fill in on their own once its DB binding lands.",
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
    detail: ACCOUNT_WIDE,
    metrics: [read, written, bytes],
  };
}

/**
 * Every Cloudflare section, with no credentials to read them with. Rendered
 * the same way as a live report so the panel is worth opening before the token
 * is set up — the limits are useful on their own.
 */
function unconfiguredServices(): Service[] {
  const blank = (label: string, limit: number, unit: Metric["unit"], reset: Metric["reset"]): Metric =>
    ({ label, used: null, limit, unit, reset });
  const detail = "Set CF_API_TOKEN and CF_ACCOUNT_ID to read live figures.";
  return [
    {
      id: "workers",
      name: "Workers",
      status: "unconfigured",
      // Worth showing without a token too: what burns an allowance is useful
      // to know before you can see how much of it is gone.
      sources: SOURCES.workers,
      detail,
      dashboard: WORKERS_DASHBOARD,
      // Same three rows the live section has, so the shape does not change
      // when credentials arrive.
      metrics: [
        blank("All Workers", LIMITS.workersRequestsPerDay, "count", "daily"),
        ...WORKER_SCRIPTS.map((s) =>
          blank(s.label, LIMITS.workersRequestsPerDay, "count", "daily"),
        ),
      ],
    },
    {
      id: "durable-objects",
      name: "Durable Objects",
      status: "unconfigured",
      sources: SOURCES.durableObjects,
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
      sources: SOURCES.d1,
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
    ? [
        ...(await Promise.all([
          workersService(env, now),
          durableObjectsService(env, now),
          d1Service(env, now),
        ])),
        vercelService(),
      ]
    : [...unconfiguredServices(), vercelService()];

  const report: UsageReport = { environment, fetchedAt: now, cached: false, services };
  cache = { at: now, report };
  return report;
}

/** Test seam and a way for `?fresh=1` to be honest about what it discarded. */
export function clearUsageCache(): void {
  cache = null;
}
