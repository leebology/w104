import type { Results } from "./scoring";
import { DEFAULT_CATEGORY, DEFAULT_DURATION_SEC, DEFAULT_ROUND_COUNT } from "./categories";

export type PlayerId = string;

export type Entry = {
  text: string; // as typed, preserved for display
  at: number;   // server receipt timestamp, ms
};

export type MatchSettings = {
  /** 1..MAX_ROUND_COUNT. How many rounds this match runs. */
  roundCount: number;
  /** MIN_DURATION_SEC..MAX_DURATION_SEC. Seconds of typing per round. */
  durationSec: number;
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
  places: Record<PlayerId, RoundPlace>;
};

export type Player = {
  id: PlayerId;
  name: string;
  emoji: string;
  ready: boolean;
  connected: boolean;
};

export type Phase =
  | { name: "lobby" }
  | { name: "countdown"; endsAt: number }
  | { name: "playing"; endsAt: number }
  | { name: "timesup"; endsAt: number }
  | { name: "scoring"; results: Results };

/** Server-only. The Durable Object's complete picture. Never sent as-is. */
export type Room = {
  code: string;
  hostId: PlayerId | null;
  players: Player[];
  phase: Phase;
  category: string;
  settings: MatchSettings;
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
    settings: {
      roundCount: DEFAULT_ROUND_COUNT,
      durationSec: DEFAULT_DURATION_SEC,
    },
    history: [],
    lastActivityAt: now,
    entries: {},
    kicked: [],
    hostGoneAt: null,
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
