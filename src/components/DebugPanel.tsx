import { useCallback, useEffect, useState } from "react";
import type { Metric, Service, UsageReport } from "../../shared/usage";
import {
  formatCountdown,
  formatValue,
  fraction,
  nextReset,
  RESET_LABEL,
  severity,
} from "../../shared/usage";
import { debugEnabled, fetchUsage } from "../net/usage";
import type { UsageResult } from "../net/usage";

/**
 * Free-tier usage, on staging and local builds only.
 *
 * **Deliberately not in the game's visual language.** Every other surface in
 * this app is cream-on-pink with gold for "go"; this one is ink with a teal
 * rule, because the panel sits over a screen a room full of people may be
 * looking at and a control that borrows the game's buttons reads as a game
 * button. It should look like something that does not belong there, because it
 * does not.
 *
 * Mounted once at the root, outside `App`, so it survives every screen
 * transition and holds no game state.
 */

/** Long enough to stay inside Cloudflare's GraphQL rate limit; see party/usage.ts. */
const POLL_MS = 60_000;

export function DebugPanel() {
  // Evaluated once: `location` cannot change without a reload, and calling it
  // per render would run the regex on every keystroke of a round.
  const [enabled] = useState(debugEnabled);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<UsageResult | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (fresh: boolean) => {
    setLoading(true);
    setResult(await fetchUsage(fresh));
    setLoading(false);
  }, []);

  // Nothing is fetched until the panel is opened — a closed triangle must not
  // cost the free tier it is measuring.
  useEffect(() => {
    if (!open) return;
    void load(false);
    const id = setInterval(() => void load(false), POLL_MS);
    return () => clearInterval(id);
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!enabled) return null;

  return (
    <>
      {/* Stays mounted while the panel is open so its collapse animation has
          something to run on, and so focus has somewhere to return to. */}
      <button
        type="button"
        className={`debug-tab${open ? " debug-tab--hidden" : ""}`}
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-label="Debug menu"
        tabIndex={open ? -1 : 0}
      >
        <span className="debug-tab__label">debug menu</span>
      </button>

      <aside
        className={`debug-panel${open ? " debug-panel--open" : ""}`}
        role="dialog"
        aria-label="Free tier usage"
        // Kept in the tree when closed so it can slide rather than pop, but
        // taken out of the accessibility tree and the tab order with it.
        aria-hidden={!open}
        inert={!open}
      >
        <header className="debug-panel__head">
          <div>
            <h2 className="debug-panel__title">Free tier usage</h2>
            <p className="debug-panel__sub">{summarise(result, loading)}</p>
          </div>
          <div className="debug-panel__actions">
            <button
              type="button"
              className="debug-btn"
              onClick={() => void load(true)}
              disabled={loading}
            >
              {loading ? "…" : "Refresh"}
            </button>
            <button
              type="button"
              className="debug-btn debug-btn--close"
              onClick={() => setOpen(false)}
              aria-label="Close debug menu"
            >
              ✕
            </button>
          </div>
        </header>

        <div className="debug-panel__body">
          {result === null && <p className="debug-note">Loading…</p>}
          {result?.ok === false && <p className="debug-note debug-note--bad">{result.message}</p>}
          {result?.ok &&
            result.report.services.map((service) => (
              <ServiceBlock key={service.id} service={service} now={result.report.fetchedAt} />
            ))}
        </div>

        <footer className="debug-panel__foot">
          <span>v{__APP_VERSION__}</span>
          <span>{result?.ok ? result.report.environment : "—"}</span>
        </footer>
      </aside>
    </>
  );
}

/**
 * The one line under the title. Says which of the three things is true —
 * loading, stale-from-cache, or freshly read — because "I played a round and
 * nothing moved" has three different explanations and only one is a bug.
 */
function summarise(result: UsageResult | null, loading: boolean): string {
  if (loading) return "Reading…";
  if (result === null) return "Not loaded";
  if (!result.ok) return "Unavailable";
  const at = new Date(result.report.fetchedAt).toLocaleTimeString();
  return result.report.cached ? `Cached, as of ${at}` : `Read at ${at}`;
}

const STATUS_TEXT: Record<Service["status"], string | null> = {
  ok: null,
  unconfigured: "no credentials",
  manual: "dashboard only",
  error: "failed",
  unused: "not in use",
};

/**
 * The failure every metric in a service shares, or null when they differ.
 *
 * A dead token fails all four Cloudflare calls with the same 300-character
 * message, and printing it four times buries the rest of the panel under one
 * fact. A *renamed field* fails exactly one, and that one has to stay on its
 * own bar — which is the whole reason the collector queries them separately.
 */
function commonNote(service: Service): string | null {
  const [first, ...rest] = service.metrics;
  if (!first?.note) return null;
  return rest.every((m) => m.note === first.note) ? first.note : null;
}

function ServiceBlock({ service, now }: { service: Service; now: number }) {
  const tag = STATUS_TEXT[service.status];
  const shared = commonNote(service);
  return (
    <section className="debug-service">
      <h3 className="debug-service__name">
        {service.dashboard ? (
          <a href={service.dashboard} target="_blank" rel="noreferrer">
            {service.name}
          </a>
        ) : (
          service.name
        )}
        {tag && <span className={`debug-chip debug-chip--${service.status}`}>{tag}</span>}
      </h3>
      {service.detail && <p className="debug-service__detail">{service.detail}</p>}
      {/* Only for services whose dashboard is the sole source of the numbers.
          Everywhere else the heading link is enough, and a second link per
          section would be four rows of chrome for nothing. */}
      {service.dashboardLabel && service.dashboard && (
        <a className="debug-service__cta" href={service.dashboard} target="_blank" rel="noreferrer">
          {service.dashboardLabel}
        </a>
      )}
      {shared && <p className="debug-bar__note">{shared}</p>}
      {service.metrics.map((metric) => (
        <Bar key={metric.label} metric={metric} now={now} showNote={shared === null} />
      ))}
    </section>
  );
}

function Bar({
  metric,
  now,
  showNote,
}: {
  metric: Metric;
  now: number;
  /** False when the service already printed this bar's note for the whole group. */
  showNote: boolean;
}) {
  const known = metric.used !== null;
  const reset = nextReset(metric.reset, now);
  return (
    <div className="debug-bar">
      <div className="debug-bar__row">
        <span className="debug-bar__label">{metric.label}</span>
        <span className="debug-bar__value">
          {/* The used figure is printed unclamped even when the bar is pinned
              full, so being over the limit is visible as a number. */}
          {known ? formatValue(metric.used!, metric.unit) : "—"}
          <span className="debug-bar__limit"> / {formatValue(metric.limit, metric.unit)}</span>
        </span>
      </div>
      <div className={`debug-track${known ? "" : " debug-track--unknown"}`}>
        <div
          className={`debug-fill debug-fill--${severity(metric.used, metric.limit)}`}
          style={{ width: `${fraction(metric.used, metric.limit) * 100}%` }}
        />
      </div>
      <p className="debug-bar__reset">
        {RESET_LABEL[metric.reset]}
        {reset !== null && ` · in ${formatCountdown(reset - now)}`}
      </p>
      {showNote && metric.note && <p className="debug-bar__note">{metric.note}</p>}
    </div>
  );
}
