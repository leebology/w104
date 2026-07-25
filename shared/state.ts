import type { Results } from "./scoring";
import { DEFAULT_CATEGORY, DEFAULT_DURATION_SEC } from "./categories";

export type PlayerId = string;

export type Entry = {
  text: string; // as typed, preserved for display
  at: number;   // server receipt timestamp, ms
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
  durationSec: number;
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
};

/** Broadcast to every connection. Safe for all eyes. */
export type RoomState = Omit<Room, "entries" | "lastActivityAt" | "kicked"> & {
  serverTime: number;
};

export function createRoom(code: string, now: number): Room {
  return {
    code,
    hostId: null,
    players: [],
    phase: { name: "lobby" },
    category: DEFAULT_CATEGORY,
    durationSec: DEFAULT_DURATION_SEC,
    lastActivityAt: now,
    entries: {},
    kicked: [],
  };
}

/** Strips the server-only fields. This function is the privacy boundary. */
export function toRoomState(room: Room, now: number): RoomState {
  const {
    entries: _entries,
    lastActivityAt: _lastActivityAt,
    kicked: _kicked,
    ...rest
  } = room;
  return { ...rest, serverTime: now };
}
