import type { Results } from "./scoring";
import { DEFAULT_CATEGORY } from "./categories";
import { DEFAULT_MODE, defaultSettings } from "./gamemodes";
import type { CategorySource, GameModeId } from "./gamemodes";
import type { SelfMarks } from "./selfstrike";
import type { VoteMap } from "./voting";
import type { ScorerId, Team, TeamId } from "./teams";
import { teamsEnabled } from "./teams";

export type PlayerId = string;

export type Entry = {
  text: string;      // as typed, preserved for display
  at: number;        // server receipt timestamp, ms
  /**
   * Who wrote it. Redundant against the `entries` record key on disk, but
   * load-bearing on the wire: a team's list is the merge of its members'
   * lists, and a merged row has to say who it came from. `load()` backfills
   * it from the key for rooms stored before it existed.
   */
  by: PlayerId;
};

export type MatchSettings = {
  /** Which gamemode this match plays. See shared/gamemodes.ts. */
  mode: GameModeId;
  /** 1..MAX_ROUND_COUNT. How many rounds this match runs. */
  roundCount: number;
  /** MIN_DURATION_SEC..MAX_DURATION_SEC. Seconds of typing per round. */
  durationSec: number;
  /**
   * 0 = off (the default). Otherwise MIN_TEAM_COUNT..MAX_TEAM_COUNT teams
   * share word lists for the match. See shared/teams.ts.
   */
  teamCount: number;
  /**
   * Where this match's categories come from. `"stock"` is the built-in ten;
   * `"custom"` inserts the writing phase. See shared/customCategories.ts.
   */
  categorySource: CategorySource;
};

/** One player's outcome in one round. */
export type RoundPlace = {
  unique: number;
  total: number;
  /** 1-based finishing position. Ties share a place; see shared/standings.ts. */
  place: number;
};

/**
 * One completed round. Aggregates only — never words — so this is safe to
 * carry in RoomState and cheap to rebroadcast on every state push.
 *
 * Deliberately carries no round number: its index in `Room.history` is its
 * round number, and a stored copy could disagree with the index.
 */
export type RoundSummary = {
  category: string;
  /** Keyed by scorer — a player id in free-for-all, a team id in team play. */
  places: Record<ScorerId, RoundPlace>;
};

export type Player = {
  id: PlayerId;
  name: string;
  emoji: string;
  ready: boolean;
  connected: boolean;
  /**
   * Which team this player is on, or null. The *single* source of truth for
   * membership — `Team` carries no member list, so the two cannot desync and
   * nobody can be on two teams. A team's roster is derived by filtering
   * `players`, which also gives it a stable order for free.
   */
  teamId: TeamId | null;
  /**
   * A debug-menu placeholder rather than a person — see `shared/bots.ts`.
   *
   * Optional, and absent on every real player: that is what keeps it off the
   * persistence migration list, since a room stored before it existed loads
   * back with the field simply missing rather than needing a backfill in
   * `load()`. Read it through `isBot`, never as a bare truthiness test.
   *
   * It rides in `RoomState` with the rest of the player, deliberately: the
   * point of a bot is that every screen renders it exactly as it renders a
   * player, so nothing downstream has to be told which is which.
   */
  isBot?: true;
};

export type Phase =
  | { name: "lobby" }
  /**
   * Players picking teams. Untimed, like `standings` — everyone readies by
   * joining a team, or the host forces it. Only reachable when teams are on.
   */
  | { name: "teams" }
  /** The room picking this match's categories. One 60-second window per match. */
  | { name: "voting"; endsAt: number }
  /**
   * Where this countdown lands. Stored rather than derived because two
   * distinct countdowns now sit at `history.length === 0` — the one before
   * voting and the one before round one — so there is nothing left to derive
   * it from.
   */
  | { name: "countdown"; endsAt: number; to: "voting" | "playing" }
  | { name: "playing"; endsAt: number }
  | { name: "timesup"; endsAt: number }
  /**
   * The round's results, played to the room as a reveal.
   *
   * `startedAt` is server time and is the *only* thing the reveal is driven by:
   * the TV and every phone derive the same line count from it against the same
   * schedule (`shared/reveal.ts`), so nothing has to be ticked over the wire.
   * Same principle as a phase deadline — broadcast the absolute moment once and
   * let each client count locally.
   *
   * `skipped` is the host's FAST FORWARD. A flag rather than a moment, because
   * skipping means "every outstanding strike lands now", which has no schedule
   * left to sit on.
   *
   * `selfMarks` is self-validation — the words scorers struck out by hand. It
   * rides here rather than on `Results` because it is a *choice made during this
   * screen*, not an output of `scoreRound`: the phase owns it, so abandoning the
   * round or banking it takes the marks with it and nothing has to clear them.
   * Like `votes`, it is no secret — the TV renders it to the room by design.
   */
  | {
      name: "scoring";
      results: Results;
      startedAt: number;
      skipped: boolean;
      selfMarks: SelfMarks;
    }
  /** Match standings between rounds and at the end. Untimed; the host advances it. */
  | { name: "standings" };

/** Server-only. The Durable Object's complete picture. Never sent as-is. */
export type Room = {
  code: string;
  hostId: PlayerId | null;
  players: Player[];
  phase: Phase;
  category: string;
  settings: MatchSettings;
  /**
   * Everyone's category votes for this match. Unlike `entries`, this is *not*
   * server-only: the host TV renders the full tally to the whole room by
   * design, so a player reading it in RoomState learns nothing they could not
   * learn by looking up. Guarding it would cost per-connection encoding on
   * every vote in exchange for nothing.
   */
  votes: VoteMap;
  /**
   * This match's teams, or empty when teams are off. Built when the room
   * enters the `teams` phase and torn down by `backToLobby`.
   *
   * Rides in `RoomState`: like `votes` and `configuring`, it is a room-wide
   * fact the host TV is already showing to everyone present.
   */
  teams: Team[];
  /**
   * Every round already played, oldest first. Aggregates only — no words —
   * so it rides in RoomState safely and cheaply.
   *
   * This is also the round counter: there is no stored `round`, because a
   * stored one would have to increment when the inter-round countdown opens
   * and decrement when it is cancelled. History only ever grows, and only at
   * `showStandings`, so deriving from it makes cancelling a genuine no-op.
   */
  history: RoundSummary[];
  lastActivityAt: number;
  /** Everyone's words. Server-side only — see Global Constraints. */
  entries: Record<PlayerId, Entry[]>;
  /**
   * Players the host has kicked. Server-side only: the connection gate reads
   * it, no screen renders it. An array, not a Set — Durable Object storage
   * serializes as JSON and a Set would come back empty. The ban lasts for the
   * room's lifetime; there is no un-kick in v1.
   */
  kicked: PlayerId[];
  /**
   * When the host's last socket closed, or null while they are here. The host
   * holds no player slot, so their leaving is invisible in `players` — this is
   * the only trace of it. `alarmOutcome` reaps the room once it has stood for
   * `HOST_GRACE_MS`; a reconnecting host clears it. A number, not a Date, so
   * it survives the JSON round trip through Durable Object storage.
   */
  hostGoneAt: number | null;
  /**
   * Whether the host has a lobby drawer open. Not a secret — like `votes`,
   * it is a room-wide fact the TV is already showing — so it rides in
   * `RoomState` and the player lobby reads it.
   *
   * It holds the start countdown: settings must never change under a match
   * that is already starting. See `setConfiguring` in shared/reduce.ts.
   */
  configuring: boolean;
  /**
   * Debug only. Milliseconds left on the running round when the host paused
   * it, or null when nothing is held.
   *
   * The *remaining* time, not the moment of pausing, because `phase.endsAt` is
   * absolute and a pause has to survive an arbitrary wait: storing when it
   * started would mean recomputing against a deadline that has long since
   * passed. Resuming is then `endsAt = now + paused`, and `phase.endsAt` is
   * simply stale — and unread — for as long as this is non-null.
   *
   * Rides in `RoomState` like `configuring` and `votes`: every screen showing
   * the timer has to know it is held, or it counts down to a dead deadline and
   * sits on 0:00.
   */
  paused: number | null;
  /**
   * Debug only. Bumped by every view jump; nothing else reads or writes it.
   *
   * It exists so that a jump to the view the room is *already* on is still an
   * observable change. `HostView` and `PlayerView` key their phase screen on
   * it, so a bump remounts that screen and every CSS animation and every piece
   * of screen-local state starts over — which is the whole of "refresh this
   * view". Re-stamping the phase's own clock is not enough on its own:
   * `HostScoring` holds the swap, the podium and the footer in local state, and
   * a fresh `startedAt` alone would restart the line count under an already
   * settled grid.
   *
   * Rides in `RoomState` deliberately. A refresh the TV kept to itself would
   * leave the phones running the reveal the room has been taken back to the
   * start of — the same reasoning that puts FAST FORWARD in room state.
   *
   * A counter rather than a timestamp so it is stable to compare and cheap to
   * read as a React key.
   */
  viewNonce: number;
};

/** Broadcast to every connection. Safe for all eyes. */
export type RoomState = Omit<
  Room,
  "entries" | "lastActivityAt" | "kicked" | "hostGoneAt"
> & {
  serverTime: number;
};

export function createRoom(code: string, now: number): Room {
  return {
    code,
    hostId: null,
    players: [],
    phase: { name: "lobby" },
    category: DEFAULT_CATEGORY,
    settings: defaultSettings(DEFAULT_MODE),
    votes: {},
    teams: [],
    history: [],
    lastActivityAt: now,
    entries: {},
    kicked: [],
    hostGoneAt: null,
    configuring: false,
    paused: null,
    viewNonce: 0,
  };
}

/** Strips the server-only fields. This function is the privacy boundary. */
export function toRoomState(room: Room, now: number): RoomState {
  const {
    entries: _entries,
    lastActivityAt: _lastActivityAt,
    kicked: _kicked,
    hostGoneAt: _hostGoneAt,
    ...rest
  } = room;
  return { ...rest, serverTime: now };
}

/**
 * The fields the derived match helpers read. Typed as a subset so they work
 * on a server-side `Room` and a client-side `RoomState` alike.
 */
type MatchView = Pick<Room, "history" | "settings">;

/** 1-based. Derived, never stored — see `Room.history`. */
export function currentRound(view: MatchView): number {
  return view.history.length + 1;
}

/** Whether every round of the match has been played and banked. */
export function matchComplete(view: MatchView): boolean {
  return view.history.length >= view.settings.roundCount;
}

/**
 * Which phase a cancelled countdown returns to. Derived rather than recorded
 * on the countdown phase, so there is no second copy of the truth to drift.
 */
export function preRoundPhase(view: MatchView): "lobby" | "standings" {
  return view.history.length === 0 ? "lobby" : "standings";
}

/**
 * Which screen renders *under* a countdown. Distinct from `preRoundPhase`,
 * which answers where a *cancelled* countdown returns to — at round one those
 * answers differ, so overloading one function would be wrong.
 */
export function countdownScreen(
  view: MatchView & { phase: Phase },
): "lobby" | "voting" | "standings" | "teams" {
  if (view.phase.name === "countdown" && view.phase.to === "voting") {
    // With teams on there is no lobby→voting countdown at all — the lobby
    // hands off to `teams` first — so a `to: "voting"` countdown can only
    // have come out of team select. Derived, so nothing extra is stored.
    return teamsEnabled(view.settings) ? "teams" : "lobby";
  }
  return view.history.length === 0 ? "voting" : "standings";
}
