import { scoreRound, normalize } from "./scoring";
import type { Entry, Player, PlayerId, Room } from "./state";

export const COUNTDOWN_MS = 5_000;
export const TIMESUP_MS = 3_000;
export const IDLE_REAP_MS = 4 * 60 * 60 * 1_000;
export const MAX_ENTRY_LEN = 64;
export const MAX_ENTRIES = 200;
export const MIN_PLAYERS = 2;

export type RoomEvent =
  | { t: "join"; playerId: PlayerId; name: string; emoji: string; now: number }
  | { t: "claimHost"; playerId: PlayerId; now: number }
  | { t: "setProfile"; playerId: PlayerId; name: string; emoji: string; now: number }
  | { t: "ready"; playerId: PlayerId; ready: boolean; now: number }
  | { t: "startGame"; playerId: PlayerId; now: number }
  | { t: "kick"; playerId: PlayerId; targetId: PlayerId; now: number }
  | { t: "disconnect"; playerId: PlayerId; now: number }
  | { t: "newGame"; playerId: PlayerId; now: number }
  | { t: "tick"; now: number };

const mapPlayer = (
  players: Player[],
  id: PlayerId,
  fn: (p: Player) => Player,
): Player[] => players.map((p) => (p.id === id ? fn(p) : p));

/**
 * Readiness counts only connected players. Otherwise one person whose phone
 * died in the lobby would block the game for everyone until they came back.
 */
function everyoneReady(room: Room): boolean {
  const active = room.players.filter((p) => p.connected);
  return active.length >= MIN_PLAYERS && active.every((p) => p.ready);
}

/**
 * The lobby <-> countdown edge is derived, not commanded: any event that
 * changes readiness re-evaluates it, so un-readying mid-countdown backs out
 * without needing its own case.
 */
function settle(room: Room, now: number): Room {
  if (room.phase.name === "lobby" && everyoneReady(room)) {
    return { ...room, phase: { name: "countdown", endsAt: now + COUNTDOWN_MS } };
  }
  if (room.phase.name === "countdown" && !everyoneReady(room)) {
    return { ...room, phase: { name: "lobby" } };
  }
  return room;
}

export function reduce(room: Room, ev: RoomEvent): Room {
  const next = apply(room, ev);
  if (next === room) return room;
  return settle({ ...next, lastActivityAt: ev.now }, ev.now);
}

function apply(room: Room, ev: RoomEvent): Room {
  switch (ev.t) {
    case "claimHost":
      if (room.hostId !== null && room.hostId !== ev.playerId) return room;
      return { ...room, hostId: ev.playerId };

    case "join": {
      if (room.players.some((p) => p.id === ev.playerId)) {
        return {
          ...room,
          players: mapPlayer(room.players, ev.playerId, (p) => ({
            ...p, name: ev.name, emoji: ev.emoji, connected: true,
          })),
        };
      }
      // New players may only join between rounds; the server rejects earlier,
      // this is the second line of defence.
      if (room.phase.name !== "lobby") return room;
      return {
        ...room,
        players: [...room.players, {
          id: ev.playerId, name: ev.name, emoji: ev.emoji,
          ready: false, connected: true,
        }],
      };
    }

    case "setProfile":
      return {
        ...room,
        players: mapPlayer(room.players, ev.playerId, (p) => ({
          ...p, name: ev.name, emoji: ev.emoji,
        })),
      };

    case "ready":
      if (room.phase.name !== "lobby" && room.phase.name !== "countdown") return room;
      return {
        ...room,
        players: mapPlayer(room.players, ev.playerId, (p) => ({ ...p, ready: ev.ready })),
      };

    case "startGame":
      if (ev.playerId !== room.hostId) return room;
      if (room.phase.name !== "lobby") return room;
      return { ...room, players: room.players.map((p) => ({ ...p, ready: true })) };

    case "kick": {
      if (ev.playerId !== room.hostId) return room;
      const { [ev.targetId]: _removed, ...entries } = room.entries;
      return {
        ...room,
        players: room.players.filter((p) => p.id !== ev.targetId),
        entries,
      };
    }

    case "disconnect":
      return {
        ...room,
        players: mapPlayer(room.players, ev.playerId, (p) => ({ ...p, connected: false })),
      };

    case "newGame":
      if (ev.playerId !== room.hostId) return room;
      if (room.phase.name !== "scoring") return room;
      return {
        ...room,
        phase: { name: "lobby" },
        players: room.players.map((p) => ({ ...p, ready: false })),
        entries: {},
      };

    case "tick":
      return tick(room, ev.now);
  }
}

/**
 * Deadlines are absolute, so a late alarm still lands in the right phase —
 * `now >= endsAt` rather than an equality check.
 */
function tick(room: Room, now: number): Room {
  const phase = room.phase;
  if (phase.name === "countdown" && now >= phase.endsAt) {
    return { ...room, phase: { name: "playing", endsAt: now + room.durationSec * 1_000 } };
  }
  if (phase.name === "playing" && now >= phase.endsAt) {
    return { ...room, phase: { name: "timesup", endsAt: now + TIMESUP_MS } };
  }
  if (phase.name === "timesup" && now >= phase.endsAt) {
    return {
      ...room,
      phase: {
        name: "scoring",
        results: scoreRound({ players: room.players, entries: room.entries }),
      },
    };
  }
  return room;
}

export type RejectReason =
  | "not-playing" | "empty" | "too-long" | "duplicate" | "limit";

export type SubmitResult = {
  room: Room;
  accepted: boolean;
  reason?: RejectReason;
};

/**
 * Kept out of `reduce` because it is the only mutation that touches the
 * server-only entries map, and it is the only one that answers back.
 */
export function submitEntry(
  room: Room,
  playerId: PlayerId,
  text: string,
  now: number,
): SubmitResult {
  if (room.phase.name !== "playing") {
    return { room, accepted: false, reason: "not-playing" };
  }
  const trimmed = text.trim();
  if (trimmed === "") return { room, accepted: false, reason: "empty" };
  if (trimmed.length > MAX_ENTRY_LEN) {
    return { room, accepted: false, reason: "too-long" };
  }

  const norm = normalize(trimmed);
  // Punctuation-only survives trim() but normalizes to nothing.
  if (norm === "") return { room, accepted: false, reason: "empty" };

  const own = room.entries[playerId] ?? [];
  if (own.length >= MAX_ENTRIES) return { room, accepted: false, reason: "limit" };
  if (own.some((e) => normalize(e.text) === norm)) {
    return { room, accepted: false, reason: "duplicate" };
  }

  const entry: Entry = { text: trimmed, at: now };
  return {
    room: {
      ...room,
      entries: { ...room.entries, [playerId]: [...own, entry] },
      lastActivityAt: now,
    },
    accepted: true,
  };
}

/**
 * One alarm serves two jobs: advancing a timed phase, and reaping a room
 * nobody came back to.
 */
export function nextAlarmAt(room: Room): number {
  const phase = room.phase;
  if (phase.name === "countdown" || phase.name === "playing" || phase.name === "timesup") {
    return phase.endsAt;
  }
  return room.lastActivityAt + IDLE_REAP_MS;
}
