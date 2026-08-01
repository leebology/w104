import { useCallback, useEffect, useState } from "react";
import type { Metric, Service, UsageReport } from "../../shared/usage";
import {
  formatCountdown,
  formatValue,
  barWidth,
  nextReset,
  RESET_LABEL,
  severity,
} from "../../shared/usage";
import { debugEnabled, fetchUsage } from "../net/usage";
import type { UsageResult } from "../net/usage";
import { getPlayerId } from "../net/identity";
import { roomStore, useRoom } from "../net/room";
import { VIEWS, currentView, isViewId } from "../../shared/views";
import { MAX_BOTS, isBot } from "../../shared/bots";
import { MAX_LINE_MS, MIN_LINE_MS, REVEAL_TIMING } from "../../shared/reveal";

/**
 * The debug menu: a corner triangle that opens a drawer of development tools.
 *
 * Five sections, top to bottom. **Debug** holds the controls that act on a
 * live round — hold the timer, cut it short, fill every list with test data.
 * **Views** jumps the room to any screen, or restarts the one it is on.
 * **Bots** dresses the room with placeholder players so a crowded screen can be
 * looked at by one person. **Experimental features** holds on/off switches for
 * things being tried mid-round. **Usage** sits pinned to the bottom, collapsed,
 * because it is the section you want to glance at rather than read: free-tier
 * headroom is a background fact, not a task.
 *
 * Debug, Views and Bots all mutate the live room and are host-only, enforced on
 * the server. The other two touch nothing.
 *
 * **The tab itself is host-only too** — see the gate in `DebugPanel` below. The
 * server checks are still the boundary; this is just not putting the thing in
 * a player's hand at a party.
 *
 * **Deliberately not in the game's visual language.** Every other surface in
 * this app is cream-on-pink with gold for "go"; this one is ink with a teal
 * rule, because the panel sits over a screen a room full of people may be
 * looking at and a control that borrows the game's buttons reads as a game
 * button. It should look like something that does not belong there, because it
 * does not.
 *
 * Mounted once at the root, outside `App`, so it survives every screen
 * transition and holds no game state of its own.
 */

/** Long enough to stay inside Cloudflare's GraphQL rate limit; see party/usage.ts. */
const POLL_MS = 60_000;

const EXPERIMENTS_KEY = "w104:debug:experiments";

/**
 * The on/off switches in the Experimental section.
 *
 * `sound-effects` does nothing at all yet and is here as the shape the next
 * one copies: a flag the panel owns, readable anywhere via
 * `useExperiment(id)`, with no server involvement. Experiments are local to a
 * device on purpose — the point is to try something on your own phone mid-
 * round without pushing it at everyone else in the room.
 */
const EXPERIMENTS = [
  { id: "sound-effects", label: "Sound effects", note: "Not wired up yet." },
  {
    id: "flush-on-timeout",
    label: "Submit half-typed word at time's up",
    note: "Off. Whatever is in the box when the round ends is thrown away instead of submitted.",
  },
] as const;

type ExperimentId = (typeof EXPERIMENTS)[number]["id"];

function readExperiments(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(EXPERIMENTS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    // A malformed value is not worth crashing the app the panel sits on top of.
    return {};
  }
}

/**
 * Read one experiment flag from anywhere in the app. Exported so a feature
 * behind a flag does not have to reach into the panel's internals — and so
 * that deleting the panel leaves one obvious thing to grep for.
 */
export function useExperiment(id: ExperimentId): boolean {
  const [on, setOn] = useState(() => readExperiments()[id] === true);
  useEffect(() => {
    const sync = () => setOn(readExperiments()[id] === true);
    window.addEventListener("w104:experiments", sync);
    return () => window.removeEventListener("w104:experiments", sync);
  }, [id]);
  return on;
}

export function DebugPanel() {
  // Evaluated once: `location` cannot change without a reload, and calling it
  // per render would run the check on every keystroke of a round.
  const [enabled] = useState(debugEnabled);
  const [open, setOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [result, setResult] = useState<UsageResult | null>(null);
  const [loading, setLoading] = useState(false);
  const state = useRoom();

  const load = useCallback(async (fresh: boolean) => {
    setLoading(true);
    setResult(await fetchUsage(fresh));
    setLoading(false);
  }, []);

  // Fetched whenever the panel is open, not only when the Usage section is
  // expanded — the collapsed view still draws bars, and a closed triangle
  // must not cost the free tier it is measuring.
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

  /**
   * Players never see it. Three of the five sections move a live room from
   * whatever screen it is on, and a phone in somebody's hand at a party is
   * exactly where a tab labelled "debug menu" gets pressed to find out what it
   * does. The server already refuses those events from a non-host — this is
   * the tab not being there to press in the first place.
   *
   * A device with no room is still shown it: nobody is a player yet, and the
   * landing page is where the usage bars are actually read. It disappears the
   * moment this device joins somebody else's room.
   */
  const room = state.room;
  if (!enabled || (room !== null && room.hostId !== getPlayerId())) return null;

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
        aria-label="Debug menu"
        // Kept in the tree when closed so it can slide rather than pop, but
        // taken out of the accessibility tree and the tab order with it.
        aria-hidden={!open}
        inert={!open}
      >
        <header className="debug-panel__head">
          <h2 className="debug-panel__title">Debug Menu</h2>
          <button
            type="button"
            className="debug-btn debug-btn--close"
            onClick={() => setOpen(false)}
            aria-label="Close debug menu"
          >
            ✕
          </button>
        </header>

        <div className="debug-panel__body">
          <DebugControls state={state} />
          <ViewJumper state={state} />
          <BotBench state={state} />
          <Experiments state={state} />
          <UsageSection
            result={result}
            loading={loading}
            expanded={usageOpen}
            onToggle={() => setUsageOpen((v) => !v)}
            onRefresh={() => void load(true)}
          />
        </div>

        <footer className="debug-panel__foot">
          <span>v{__APP_VERSION__}</span>
          <span>{result?.ok ? result.report.environment : "—"}</span>
        </footer>
      </aside>
    </>
  );
}

// ------------------------------------------------------------------- debug

/**
 * The controls that touch a live round.
 *
 * Every one of them is **host-only**, and this component only decides what to
 * *show*: `shared/reduce.ts` rejects the events from a non-host and from the
 * wrong phase, and `party/server.ts` rejects the fill the same way. A greyed-out
 * button is a courtesy, not the boundary — the panel renders in production, so
 * the server has to assume the buttons are missing.
 *
 * The phases differ between them, and the split is not arbitrary: hold and skip
 * act on a *deadline*, and every phase that runs one long enough to be caught
 * mid-decision has one — the round, the category vote, and the writing phase.
 * Auto-fill needs somewhere to *write*, which is the round and the writing
 * phase but not the vote, where there is nothing to fill in.
 */
function DebugControls({ state }: { state: ReturnType<typeof useRoom> }) {
  const room = state.room;
  const isHost = room !== null && room.hostId === getPlayerId();
  const playing = room?.phase.name === "playing";
  const creating = room?.phase.name === "creating";
  // Kept in step with `isHoldable` in shared/reduce.ts, which is what actually
  // decides — this only greys the buttons out.
  const timed = playing || creating || room?.phase.name === "voting";
  const paused = room?.paused ?? null;
  // The two phases `party/server.ts`'s `debugFill` branch knows how to write
  // into: words during the round, categories during the writing phase.
  const fillable = playing || creating;
  const canAct = isHost && fillable;
  const canTime = isHost && timed;

  const reason = !room
    ? "Not in a room."
    : !isHost
      ? "Host device only."
      : !timed
        ? "Only while a round, the vote or the writing phase is running."
        : !fillable
          ? "Auto-fill needs a round or the writing phase."
          : null;

  return (
    <section className="debug-section">
      <h3 className="debug-section__title">Debug</h3>
      {reason && <p className="debug-section__detail">{reason}</p>}
      <div className="debug-actions">
        <button
          type="button"
          className="debug-btn debug-btn--wide"
          disabled={!canTime}
          onClick={() =>
            roomStore.send({ type: "debugPause", paused: paused === null })
          }
        >
          {paused === null ? "Pause timer" : "Resume timer"}
        </button>
        <button
          type="button"
          className="debug-btn debug-btn--wide"
          disabled={!canTime}
          onClick={() => roomStore.send({ type: "debugSkip" })}
        >
          Skip timer
        </button>
        <button
          type="button"
          className="debug-btn debug-btn--wide"
          disabled={!canAct}
          onClick={() => roomStore.send({ type: "debugFill" })}
        >
          {creating ? "Fill categories" : "Fill words"}
        </button>
      </div>
      {paused !== null && (
        <p className="debug-section__detail debug-section__detail--live">
          {playing ? "Round" : creating ? "Writing" : "Vote"} held with{" "}
          {Math.ceil(paused / 1000)}s left.
        </p>
      )}
    </section>
  );
}

// ------------------------------------------------------------------- views

/**
 * Jump the room to any screen, or restart the one it is on.
 *
 * **Host-only, and the room moves with it** — every phone follows the TV, which
 * is the point: a screen inspected on the TV alone is half the screen. Enforced
 * in `shared/reduce.ts`; the disabled buttons here are a courtesy.
 *
 * The list is `VIEWS` in play order rather than a hand-written one, so a new
 * screen becomes reachable by being added to the catalog. The current view is
 * marked rather than disabled: jumping to where you already are *is* the
 * refresh, so it has to stay pressable.
 */
function ViewJumper({ state }: { state: ReturnType<typeof useRoom> }) {
  const room = state.room;
  const isHost = room !== null && room.hostId === getPlayerId();
  const rawHere = room ? currentView(room) : null;
  // `currentView` can answer `"creating"`, which has no catalog entry or jump
  // target yet — narrowed here so "restart this view" has nothing to send to
  // while the room sits on a phase the panel cannot yet name.
  const here = rawHere !== null && isViewId(rawHere) ? rawHere : null;

  return (
    <section className="debug-section">
      <h3 className="debug-section__title">Views</h3>
      <p className="debug-section__detail">
        {!room
          ? "Not in a room."
          : !isHost
            ? "Host device only."
            : "Moves every phone in the room, not just this screen."}
      </p>
      <div className="debug-views">
        {VIEWS.map((view) => (
          <button
            key={view.id}
            type="button"
            className={`debug-btn debug-view${here === view.id ? " debug-view--here" : ""}`}
            disabled={!isHost}
            onClick={() => roomStore.send({ type: "debugJump", to: view.id })}
            aria-current={here === view.id}
          >
            {view.label}
          </button>
        ))}
      </div>
      <div className="debug-actions">
        <button
          type="button"
          className="debug-btn debug-btn--wide"
          disabled={!isHost || here === null}
          onClick={() => here && roomStore.send({ type: "debugJump", to: here })}
        >
          Restart this view
        </button>
      </div>
      {/* The two views made of a round say so: jumping to either from a lobby
          deals a set of word lists, which is not obvious from the label. */}
      <p className="debug-section__detail">
        Results and Standings deal test words when nobody has typed any.
      </p>
    </section>
  );
}

// -------------------------------------------------------------------- bots

/**
 * Add or remove placeholder players.
 *
 * Host-only and server-enforced like the two sections above it. The count is
 * sent absolutely rather than as a delta, so a fast double-tap cannot drift the
 * room away from the number on the button.
 *
 * The population is read back off `room.players` rather than held in local
 * state: the server is the authority, so the readout is the room's answer and
 * a second tab showing this panel cannot disagree with the first.
 */
function BotBench({ state }: { state: ReturnType<typeof useRoom> }) {
  const room = state.room;
  const isHost = room !== null && room.hostId === getPlayerId();
  const bots = room ? room.players.filter(isBot) : [];
  const count = bots.length;
  const set = (n: number) => roomStore.send({ type: "debugBots", count: n });

  return (
    <section className="debug-section">
      <h3 className="debug-section__title">Bots</h3>
      <p className="debug-section__detail">
        {!room
          ? "Not in a room."
          : !isHost
            ? "Host device only."
            : "Placeholder players. They never type, vote or ready up."}
      </p>
      <div className="debug-stepper">
        <button
          type="button"
          className="debug-btn"
          disabled={!isHost || count === 0}
          onClick={() => set(count - 1)}
          aria-label="Remove a bot"
        >
          −
        </button>
        <span className="debug-stepper__value" aria-live="polite">
          {count} / {MAX_BOTS}
        </span>
        <button
          type="button"
          className="debug-btn"
          disabled={!isHost || count >= MAX_BOTS}
          onClick={() => set(count + 1)}
          aria-label="Add a bot"
        >
          +
        </button>
        <button
          type="button"
          className="debug-btn"
          disabled={!isHost || count === 0}
          onClick={() => set(0)}
        >
          Clear
        </button>
      </div>
      {count > 0 && (
        <p className="debug-section__detail debug-section__detail--live">
          {bots.map((b) => `${b.emoji} ${b.name}`).join("  ")}
        </p>
      )}
      {/* The cap is deliberately past MAX_PLAYERS, and the results grid is laid
          out for ten columns — so say which way it will break rather than
          leaving it to look like a bug. */}
      <p className="debug-section__detail">
        Past 10 the round and results layouts are over their design limit.
      </p>
    </section>
  );
}

// ------------------------------------------------------------- experiments

/**
 * The reveal's cadence, as a slider.
 *
 * The one control in this section that is **not** local to the device, and the
 * only one that is host-only and server-enforced. It cannot be local: every
 * phone builds the same reveal schedule the TV does and strikes each word on the
 * same beat, so a cadence one device kept to itself would put the room on two
 * different reveals — see `Room.revealLineMs`.
 *
 * Sent on every input event rather than on release, so dragging it *during* a
 * running reveal is the point rather than a side effect. The schedule is derived
 * from `scoring.startedAt` and this figure, so a change mid-reveal re-times every
 * line at once, including the ones already out.
 *
 * Inverted between the control and the value: the slider runs left-to-right
 * slow-to-fast, which is how a speed control has to read, while the number
 * underneath is a *delay* and therefore runs the other way.
 */
function RevealSpeed({ state }: { state: ReturnType<typeof useRoom> }) {
  const room = state.room;
  const isHost = room !== null && room.hostId === getPlayerId();
  const lineMs = room?.revealLineMs ?? REVEAL_TIMING.LINE_INTERVAL;
  // The slider's own value: high is fast. See the note above.
  const slider = MIN_LINE_MS + MAX_LINE_MS - lineMs;

  return (
    <div className="debug-slider">
      <label className="debug-slider__row" htmlFor="debug-reveal-speed">
        <span className="debug-slider__label">Reveal speed</span>
        <span className="debug-slider__value">{lineMs}ms / word</span>
      </label>
      <input
        id="debug-reveal-speed"
        type="range"
        min={MIN_LINE_MS}
        max={MAX_LINE_MS}
        step={10}
        value={slider}
        disabled={!isHost}
        onChange={(e) =>
          roomStore.send({
            type: "debugRevealSpeed",
            lineMs: MIN_LINE_MS + MAX_LINE_MS - Number(e.target.value),
          })
        }
      />
      <p className="debug-section__detail">
        {!room
          ? "Not in a room."
          : !isHost
            ? "Host device only."
            : `How fast words appear on the results screen. Moves every phone in the room. Default ${REVEAL_TIMING.LINE_INTERVAL}ms.`}
      </p>
    </div>
  );
}

function Experiments({ state }: { state: ReturnType<typeof useRoom> }) {
  const [flags, setFlags] = useState(readExperiments);

  function toggle(id: string) {
    const next = { ...flags, [id]: !flags[id] };
    setFlags(next);
    try {
      localStorage.setItem(EXPERIMENTS_KEY, JSON.stringify(next));
    } catch {
      // Private mode, quota, a locked-down browser — the switch still works
      // for this session, it just will not survive a reload.
    }
    // Tells every `useExperiment` in the tree to re-read. `storage` only fires
    // in *other* tabs, so same-tab listeners need their own event.
    window.dispatchEvent(new Event("w104:experiments"));
  }

  return (
    <section className="debug-section">
      <h3 className="debug-section__title">Experimental features</h3>
      <RevealSpeed state={state} />
      {/* Said here rather than at the top of the section: the slider above is
          the exception to it, and a blanket "local to this device" over a
          control that moves every phone in the room would be a lie. */}
      <p className="debug-section__detail">
        The switches below are local to this device — toggling one does not
        change anyone else's game.
      </p>
      {EXPERIMENTS.map((exp) => (
        <label key={exp.id} className="debug-toggle">
          <input
            type="checkbox"
            checked={flags[exp.id] === true}
            onChange={() => toggle(exp.id)}
          />
          <span className="debug-toggle__track" aria-hidden="true">
            <span className="debug-toggle__knob" />
          </span>
          <span className="debug-toggle__text">
            {exp.label}
            {exp.note && <span className="debug-toggle__note">{exp.note}</span>}
          </span>
        </label>
      ))}
    </section>
  );
}

// ------------------------------------------------------------------- usage

function UsageSection({
  result,
  loading,
  expanded,
  onToggle,
  onRefresh,
}: {
  result: UsageResult | null;
  loading: boolean;
  expanded: boolean;
  onToggle: () => void;
  onRefresh: () => void;
}) {
  const report = result?.ok ? result.report : null;
  return (
    <section className="debug-section debug-section--usage">
      <button
        type="button"
        className="debug-section__toggle"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span className="debug-section__title">Usage</span>
        <span className="debug-section__meta">{summarise(result, loading)}</span>
        <span className="debug-section__chev" aria-hidden="true">
          {expanded ? "▾" : "▸"}
        </span>
      </button>

      {!expanded && report && <MiniBars report={report} />}
      {!expanded && result?.ok === false && (
        <p className="debug-note debug-note--bad">{result.message}</p>
      )}

      {expanded && (
        <div className="debug-usage__full">
          <button type="button" className="debug-btn" onClick={onRefresh} disabled={loading}>
            {loading ? "…" : "Refresh"}
          </button>
          {result === null && <p className="debug-note">Loading…</p>}
          {result?.ok === false && (
            <p className="debug-note debug-note--bad">{result.message}</p>
          )}
          {report?.services.map((service) => (
            <ServiceBlock key={service.id} service={service} now={report.fetchedAt} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * The collapsed view: every metric as one thin bar, no numbers.
 *
 * The whole reason the section can default to closed. Reading "how much of the
 * free tier is left" is a task; noticing that a bar has gone red is not, and
 * the second one is what you actually want from a panel you opened to do
 * something else. Metrics with nothing to report are skipped rather than drawn
 * hatched — an unreadable figure is worth explaining in the expanded view and
 * is only noise here.
 */
function MiniBars({ report }: { report: UsageReport }) {
  const rows = report.services.flatMap((s) =>
    s.metrics
      .filter((m) => m.used !== null)
      .map((m) => ({ key: `${s.id}:${m.label}`, service: s, metric: m })),
  );
  if (rows.length === 0) {
    return <p className="debug-note">No live figures — expand for why.</p>;
  }
  return (
    <ul className="debug-mini">
      {rows.map(({ key, service, metric }) => (
        <li className="debug-mini__row" key={key}>
          <span className="debug-mini__label">
            {shortLabel(service, metric)}
          </span>
          <span className="debug-track debug-track--mini">
            <span
              className={`debug-fill debug-fill--${severity(metric.used, metric.limit)}`}
              style={{ width: barWidth(metric.used, metric.limit) }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * "DO · Duration". The service name alone is ambiguous once a section has
 * three bars, and the full name does not fit beside one.
 */
const SHORT_SERVICE: Record<string, string> = {
  workers: "WK",
  "durable-objects": "DO",
  d1: "D1",
};

function shortLabel(service: Service, metric: Metric): string {
  const prefix = SHORT_SERVICE[service.id] ?? service.name;
  // The Workers breakdown rows already carry a "· " marker of their own.
  return `${prefix} · ${metric.label.replace(/^· /, "")}`;
}

/**
 * The one line beside the section title. Says which of the three things is
 * true — loading, stale-from-cache, or freshly read — because "I played a
 * round and nothing moved" has three different explanations and only one is a
 * bug.
 */
function summarise(result: UsageResult | null, loading: boolean): string {
  if (loading) return "reading…";
  if (result === null) return "not loaded";
  if (!result.ok) return "unavailable";
  const at = new Date(result.report.fetchedAt).toLocaleTimeString();
  return result.report.cached ? `cached ${at}` : `read ${at}`;
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
      <h4 className="debug-service__name">
        {service.dashboard ? (
          <a href={service.dashboard} target="_blank" rel="noreferrer">
            {service.name}
          </a>
        ) : (
          service.name
        )}
        {tag && <span className={`debug-chip debug-chip--${service.status}`}>{tag}</span>}
      </h4>
      {/* What spends this allowance, before the caveats about scope. Ordered
          this way on purpose: "which are we burning fastest" is the question
          the panel is open to answer. */}
      {service.sources && <p className="debug-service__sources">{service.sources}</p>}
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
          style={{ width: barWidth(metric.used, metric.limit) }}
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
