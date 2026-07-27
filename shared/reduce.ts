import { scoreRound, normalize } from "./scoring";
import { placeRound } from "./standings";
import { matchComplete, preRoundPhase } from "./state";
import type { Entry, Player, PlayerId, Room, RoundSummary } from "./state";

export const COUNTDOWN_MS = 5_000;
export const TIMESUP_MS = 3_000;
export const IDLE_REAP_MS = 15_000;
/**
 * How long a room outlives the host's socket. Tapping Back ends the game at
 * once (see `canEndGame`); this window covers only the involuntary exits — a
 * locked phone, a backgrounded tab, a wifi blip — where killing the room
 * instantly would end everyone's game over a two-second hiccup.
 */
export const HOST_GRACE_MS = 15_000;
export const MAX_ENTRY_LEN = 64;
export const MAX_ENTRIES = 200;
export const MIN_PLAYERS = 2;
/**
 * The host results screen lays players out as at most two rows of five, and
 * past ten columns the words stop being readable across a room. The cap is a
 * legibility limit, not a capacity one.
 */
export const MAX_PLAYERS = 10;
export const MIN_ROUND_COUNT = 1;
export const MAX_ROUND_COUNT = 10;
/** 15 seconds to 10 minutes. */
export const MIN_DURATION_SEC = 15;
export const MAX_DURATION_SEC = 600;

export type RoomEvent =
  | { t: "join"; playerId: PlayerId; name: string; emoji: string; now: number }
  | { t: "claimHost"; playerId: PlayerId; now: number }
  | { t: "setProfile"; playerId: PlayerId; name: string; emoji: string; now: number }
  | { t: "ready"; playerId: PlayerId; ready: boolean; now: number }
  | { t: "startGame"; playerId: PlayerId; now: number }
  | { t: "cancelStart"; playerId: PlayerId; now: number }
  | { t: "kick"; playerId: PlayerId; targetId: PlayerId; now: number }
  | { t: "disconnect"; playerId: PlayerId; now: number }
  | { t: "setSettings"; playerId: PlayerId; roundCount?: number; durationSec?: number; now: number }
  | { t: "showStandings"; playerId: PlayerId; now: number }
  | { t: "backToLobby"; playerId: PlayerId; now: number }
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
 * Settings arrive over a socket, so the stepper's restrictions are not a
 * guarantee — a hand-rolled message must not be able to set a nine-hour
 * round. Non-finite values fall back to what is already set rather than
 * poisoning the room with NaN.
 */
function clampSetting(value: number | undefined, min: number, max: number, current: number): number {
  if (value === undefined || !Number.isFinite(value)) return current;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * The pre-round <-> countdown edge is derived, not commanded: any event that
 * changes readiness re-evaluates it, so un-readying mid-countdown backs out
 * without needing its own case.
 *
 * "Pre-round" is the lobby before round one and the standings screen between
 * rounds — readiness governs every round start, not just the first. The
 * `matchComplete` guard is what stops readying up on the final standings from
 * opening a countdown for a round that does not exist.
 */
function settle(room: Room, now: number): Room {
  const phase = room.phase;
  if (phase.name === "lobby" || phase.name === "standings") {
    if (phase.name === "standings" && matchComplete(room)) return room;
    if (!everyoneReady(room)) return room;
    return { ...room, phase: { name: "countdown", endsAt: now + COUNTDOWN_MS, to: "playing" } };
  }
  if (phase.name === "countdown" && !everyoneReady(room)) {
    return { ...room, phase: backPhase(room) };
  }
  return room;
}

/**
 * Written as an explicit ternary rather than `{ name: preRoundPhase(room) }`
 * because TypeScript will not assign `{ name: "lobby" | "standings" }` to the
 * `Phase` union.
 */
function backPhase(room: Room): Room["phase"] {
  return preRoundPhase(room) === "lobby" ? { name: "lobby" } : { name: "standings" };
}

export function reduce(room: Room, ev: RoomEvent): Room {
  const next = apply(room, ev);
  if (next === room) return room;
  const withTime = { ...next, lastActivityAt: ev.now };
  // `startGame` already decided the countdown transition itself, overriding
  // MIN_PLAYERS as a deliberate host action. Running it back through
  // `settle`'s everyoneReady gate would immediately revert a solo start.
  return ev.t === "startGame" ? withTime : settle(withTime, ev.now);
}

function apply(room: Room, ev: RoomEvent): Room {
  switch (ev.t) {
    case "claimHost":
      if (room.hostId !== null && room.hostId !== ev.playerId) return room;
      // Clearing `hostGoneAt` is what calls off the grace-period reap their
      // disconnect armed: the host made it back inside the window.
      return { ...room, hostId: ev.playerId, hostGoneAt: null };

    case "join": {
      if (room.players.some((p) => p.id === ev.playerId)) {
        return {
          ...room,
          players: mapPlayer(room.players, ev.playerId, (p) => ({
            ...p, name: ev.name, emoji: ev.emoji, connected: true,
          })),
        };
      }
      // New players may only join between rounds, and only up to the cap; the
      // server rejects both earlier, this is the second line of defence.
      // Both checks sit below the returning-player branch above, so someone
      // already seated always gets back in.
      if (room.phase.name !== "lobby") return room;
      if (room.players.length >= MAX_PLAYERS) return room;
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
      if (
        room.phase.name !== "lobby" &&
        room.phase.name !== "countdown" &&
        room.phase.name !== "standings"
      ) {
        return room;
      }
      return {
        ...room,
        players: mapPlayer(room.players, ev.playerId, (p) => ({ ...p, ready: ev.ready })),
      };

    case "startGame":
      if (ev.playerId !== room.hostId) return room;
      // Legal from the lobby and from standings between rounds — both are
      // pre-round phases, and both open the same countdown.
      if (room.phase.name !== "lobby" && room.phase.name !== "standings") return room;
      if (room.phase.name === "standings" && matchComplete(room)) return room;
      // A deliberate host override: unlike the natural everyoneReady path,
      // this can start the countdown with just one connected player.
      if (room.players.filter((p) => p.connected).length < 1) return room;
      return {
        ...room,
        players: room.players.map((p) => ({ ...p, ready: true })),
        phase: { name: "countdown", endsAt: ev.now + COUNTDOWN_MS, to: "playing" },
      };

    case "cancelStart": {
      if (ev.playerId !== room.hostId) return room;
      if (room.phase.name !== "countdown") return room;
      // Resets everyone's readiness rather than leaving it as-is: it was
      // solo-start's `startGame` that force-readied everyone, and leaving
      // that in place would have `settle` immediately re-open the countdown
      // this cancel is meant to stop.
      return {
        ...room,
        phase: backPhase(room),
        players: room.players.map((p) => ({ ...p, ready: false })),
      };
    }

    case "kick": {
      if (ev.playerId !== room.hostId) return room;
      const { [ev.targetId]: _removed, ...entries } = room.entries;
      // Removing the player is not enough on its own: their socket
      // auto-reconnects and the lobby would re-admit them as a newcomer. The
      // ban is what makes a kick stick, so it outlives the round —
      // `backToLobby` deliberately does not clear it.
      return {
        ...room,
        players: room.players.filter((p) => p.id !== ev.targetId),
        entries,
        kicked: room.kicked.includes(ev.targetId)
          ? room.kicked
          : [...room.kicked, ev.targetId],
      };
    }

    case "disconnect":
      return {
        ...room,
        players: mapPlayer(room.players, ev.playerId, (p) => ({ ...p, connected: false })),
        // The host is not a player, so the line above is a no-op for them and
        // nothing else in the room would record that they left. Stamping the
        // moment is what arms the grace-period reap in `alarmOutcome`.
        hostGoneAt: ev.playerId === room.hostId ? ev.now : room.hostGoneAt,
      };

    case "setSettings": {
      if (ev.playerId !== room.hostId) return room;
      // Locked once the match starts: changing the round count mid-match
      // would move the finish line under the players.
      if (room.phase.name !== "lobby") return room;
      const roundCount = clampSetting(
        ev.roundCount, MIN_ROUND_COUNT, MAX_ROUND_COUNT, room.settings.roundCount,
      );
      const durationSec = clampSetting(
        ev.durationSec, MIN_DURATION_SEC, MAX_DURATION_SEC, room.settings.durationSec,
      );
      if (
        roundCount === room.settings.roundCount &&
        durationSec === room.settings.durationSec
      ) {
        return room;
      }
      return { ...room, settings: { roundCount, durationSec } };
    }

    case "showStandings": {
      if (ev.playerId !== room.hostId) return room;
      if (room.phase.name !== "scoring") return room;
      const summary: RoundSummary = {
        category: room.category,
        places: placeRound(room.phase.results),
      };
      // Clearing `ready` is not optional: everyone is still flagged ready from
      // the round that just ended, and `settle` would fire the next countdown
      // instantly, skipping the standings screen entirely.
      //
      // Clearing `entries` here is the single place the raw word store is
      // emptied — the round is banked into history and the words have already
      // been shown, so nothing reads it again.
      return {
        ...room,
        phase: { name: "standings" },
        history: [...room.history, summary],
        entries: {},
        players: room.players.map((p) => ({ ...p, ready: false })),
      };
    }

    case "backToLobby":
      if (ev.playerId !== room.hostId) return room;
      if (room.phase.name !== "standings") return room;
      // Settings survive — the host usually wants the same match again — and
      // so does `kicked`, which is durable for the room's lifetime.
      return {
        ...room,
        phase: { name: "lobby" },
        players: room.players.map((p) => ({ ...p, ready: false })),
        entries: {},
        history: [],
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
    return {
      ...room,
      phase: { name: "playing", endsAt: now + room.settings.durationSec * 1_000 },
    };
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
 * Whether this player may end the room outright. Host-only, like every other
 * host action — but unlike them it produces no new `Room`, because the room
 * stops existing. It is a predicate rather than a `RoomEvent` for exactly that
 * reason; the Durable Object carries out the teardown.
 */
export function canEndGame(room: Room, playerId: PlayerId): boolean {
  return room.hostId === playerId;
}

/**
 * One alarm serves three jobs: advancing a timed phase, reaping a room nobody
 * came back to, and ending a room whose host walked off.
 */
export function nextAlarmAt(room: Room): number {
  const phase = room.phase;
  const base =
    phase.name === "countdown" || phase.name === "playing" || phase.name === "timesup"
      ? phase.endsAt
      : room.lastActivityAt + IDLE_REAP_MS;
  if (room.hostGoneAt === null) return base;
  // The host deadline can fall mid-round, before any phase deadline, so it
  // has to be able to pull the alarm earlier — never later.
  return Math.min(base, room.hostGoneAt + HOST_GRACE_MS);
}

/**
 * What a fired alarm means. Since `nextAlarmAt` serves double duty, the
 * handler has to work out which of the two jobs woke it.
 *
 * - `advance` — a phase deadline passed; broadcast the new phase.
 * - `touch`   — nothing to advance and the room is stale, but someone is
 *               still connected, so push the horizon out instead of reaping.
 * - `rearm`   — nothing to do; persist to re-arm the next alarm.
 * - `reap`    — delete the room. Either stale and empty (`expired`) or the
 *               host never came back (`host-left`); the two differ only in
 *               what the closing sockets are told.
 *
 * **Order matters and is the whole point of this function.** A phase deadline
 * must be evaluated before the idle horizon: a round is `DEFAULT_DURATION_SEC`
 * (30s) but the horizon is `IDLE_REAP_MS` (15s), so any round whose players go
 * quiet for its back half looks stale at exactly the moment it is supposed to
 * end. Checking staleness first would swallow the tick that ends the round and
 * defer it to a second, re-armed alarm — the round visibly hangs on "0:00".
 *
 * Lives here rather than in the Durable Object because it is a rule, not
 * plumbing, and because only `shared/` is under test.
 */
export type ReapReason = "expired" | "host-left";

export type AlarmOutcome =
  | { action: "advance"; room: Room }
  | { action: "touch"; room: Room }
  | { action: "rearm" }
  | { action: "reap"; reason: ReapReason };

export function alarmOutcome(
  room: Room,
  now: number,
  /** Whether any socket is still open for this room. */
  hasConnections: boolean,
): AlarmOutcome {
  // Outranks the phase deadline below — the one case that legitimately does.
  // A round with no host behind it has nothing to advance *to*: nobody can
  // start the next one, so finishing this one only strands the players on a
  // results screen that never moves.
  if (room.hostGoneAt !== null && now >= room.hostGoneAt + HOST_GRACE_MS) {
    return { action: "reap", reason: "host-left" };
  }

  const next = reduce(room, { t: "tick", now });
  if (next !== room) return { action: "advance", room: next };

  if (now < room.lastActivityAt + IDLE_REAP_MS) return { action: "rearm" };

  // `lastActivityAt` only moves on state-changing events, so a host sitting in
  // an empty lobby — nobody has joined, nothing to react to — looks exactly
  // like an abandoned room. A live connection means someone is actually still
  // here; bump the clock and let them be.
  if (hasConnections) return { action: "touch", room: { ...room, lastActivityAt: now } };

  return { action: "reap", reason: "expired" };
}
