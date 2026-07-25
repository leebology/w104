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

function tick(room: Room, _now: number): Room {
  return room;
}
