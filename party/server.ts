import { Server, routePartykitRequest } from "partyserver";
import type { Connection, ConnectionContext, WSMessage } from "partyserver";
import {
  alarmOutcome, canEndGame, nextAlarmAt, reduce, submitEntry, MAX_PLAYERS,
} from "../shared/reduce";
import type { ClientMessage, ErrorCode, ServerMessage } from "../shared/protocol";
import { createRoom, toRoomState } from "../shared/state";
import type { MatchSettings, PlayerId, Room } from "../shared/state";
import { DEFAULT_DURATION_SEC } from "../shared/categories";
import { DEFAULT_MODE, defaultSettings, isGameModeId } from "../shared/gamemodes";

// Durable Object binding declared in wrangler.jsonc.
export interface Env {
  W104: DurableObjectNamespace;
}

type ConnState = { playerId: PlayerId; role: "player" | "host"; session: string };

const MAX_NAME_LEN = 20;
/**
 * No emoji has a natural length: 🙂 is 2 UTF-16 units, a flag sequence 6, a
 * family with skin tones 11 or more. 16 clears every real sequence and still
 * caps a hostile one.
 */
const MAX_EMOJI_LEN = 16;
const DEFAULT_EMOJI = "🙂";

/**
 * One instance per room; the room code is this object's name. Authoritative
 * owner of all state — clients only ever send requests. All game rules live in
 * shared/, so this class is deliberately just plumbing: persist, broadcast,
 * and schedule alarms.
 */
export class W104 extends Server<Env> {
  private room: Room | null = null;
  /**
   * In-memory only, not persisted: which session ids were live for a kicked
   * player at the moment of the kick. Lets a deliberate rejoin (a new
   * `connect()` call mints a new session id) back in while a kicked socket's
   * own automatic reconnect — which resends the same session id — stays
   * blocked. If the object hibernates and loses this, a stale reconnect can
   * slip through; for a casual party game that failure mode (occasionally
   * early, never permanently stuck) is the acceptable side to fail on.
   */
  private kickedSessions = new Map<PlayerId, Set<string>>();

  async onStart(): Promise<void> {
    this.room = await this.load();
  }

  /**
   * `get<Room>` is an unchecked cast over whatever JSON is on disk, and a room
   * written before `kicked`, `settings`/`history`, `hostGoneAt`, `votes`, or a
   * countdown's `to` existed has no such key. Filling them in on the way out
   * means the rest of the class — and all of shared/ — can treat the fields as
   * always present.
   */
  private async load(): Promise<Room | null> {
    const stored = await this.ctx.storage.get<Room>("room");
    if (!stored) return null;
    // Rooms written before this change carry `round` and a top-level
    // `durationSec` instead of `settings`/`history`. Destructure the dead
    // fields off rather than spreading them, so they cannot ride along into
    // every broadcast.
    const { round: _round, durationSec: legacyDuration, ...rest } = stored as Room & {
      round?: number;
      durationSec?: number;
    };
    return {
      ...rest,
      kicked: rest.kicked ?? [],
      hostGoneAt: rest.hostGoneAt ?? null,
      votes: rest.votes ?? {},
      history: rest.history ?? [],
      configuring: rest.configuring ?? false,
      settings: (() => {
        const stored = rest.settings as Partial<MatchSettings> | undefined;
        const base = defaultSettings(DEFAULT_MODE);
        const mode = stored?.mode;
        return {
          // A room stored before gamemodes existed has no `mode` at all, and a
          // room stored under a mode since renamed has one nothing recognises.
          mode: isGameModeId(mode) ? mode : DEFAULT_MODE,
          roundCount: stored?.roundCount ?? base.roundCount,
          // Rooms older still carry a top-level `durationSec` and no settings.
          durationSec: stored?.durationSec ?? legacyDuration ?? DEFAULT_DURATION_SEC,
          // Rooms stored before teamCount existed have no such field at all.
          teamCount: stored?.teamCount ?? base.teamCount,
        };
      })(),
      // A room persisted mid-countdown before `to` existed has a countdown
      // phase with no destination at all, and `tick` would route it nowhere and
      // hang the room. "playing" is the only thing that countdown could have
      // meant.
      phase: (() => {
        // `Phase` declares `to` as required, so without this cast TS treats
        // `"to" in phase` as always true and narrows the `else` branch to
        // `never`. The cast makes `to` optional just long enough to detect
        // and backfill a pre-`to` countdown persisted to disk.
        const phase = rest.phase as {
          name: "countdown";
          endsAt: number;
          to?: "voting" | "playing";
        };
        return phase?.name === "countdown" && !("to" in phase)
          ? { ...phase, to: "playing" as const }
          : rest.phase;
      })(),
    };
  }

  async onConnect(conn: Connection<ConnState>, ctx: ConnectionContext): Promise<void> {
    const url = new URL(ctx.request.url);
    const playerId = url.searchParams.get("playerId");
    const role = url.searchParams.get("role") === "host" ? "host" : "player";
    const intent = url.searchParams.get("intent");
    // `null` means the parameter was absent; "" means it was sent empty. Only
    // the first case falls back to the stored profile.
    const nameParam = url.searchParams.get("name");
    const emojiParam = url.searchParams.get("emoji");
    const session = url.searchParams.get("session") ?? "";
    const now = Date.now();

    if (!playerId) {
      return this.reject(conn, "no-such-room", "Missing player id.");
    }

    if (intent === "create") {
      // Self-guarding code allocation: an occupied room refuses, and the
      // client rolls a new code. No central registry needed.
      if (this.room) {
        return this.reject(conn, "room-exists", "That code is already in use.");
      }
      this.room = createRoom(this.name, now);
    } else if (!this.room) {
      return this.reject(conn, "no-such-room", "No game with that code.");
    }

    // Before any phase gate and before `join` can seat them: partysocket
    // reconnects on its own, and in the lobby the join below would otherwise
    // welcome a kicked player straight back in as a newcomer.
    if (this.room.kicked.includes(playerId)) {
      const banned = this.kickedSessions.get(playerId);
      if (!banned || banned.has(session)) {
        return this.reject(conn, "kicked", "The host removed you from this game.");
      }
      // A session id the ban never recorded means this is a deliberate new
      // connection — Landing → Join again — not the kicked socket retrying
      // itself. Let them back in and lift the ban.
      this.room = {
        ...this.room,
        kicked: this.room.kicked.filter((id) => id !== playerId),
      };
      this.kickedSessions.delete(playerId);
    }

    const existing = this.room.players.find((p) => p.id === playerId);
    const known = this.room.hostId === playerId || existing !== undefined;
    if (!known && this.room.phase.name !== "lobby") {
      return this.reject(conn, "game-in-progress", "That game is already running.");
    }

    // Only newcomers are capped. Someone already seated — including the tenth
    // player reconnecting after their phone locked — is `known` and skips
    // this, so the cap can never lock a player out of their own room. The
    // host holds no player slot, hence the role check.
    if (!known && role === "player" && this.room.players.length >= MAX_PLAYERS) {
      return this.reject(conn, "room-full", "That room is full.");
    }

    conn.setState({ playerId, role, session });

    // `join` applies name and emoji unconditionally, so a connect that omits
    // them must re-supply what this player already had rather than blank it.
    const name = (nameParam ?? existing?.name ?? "").slice(0, MAX_NAME_LEN);
    const emoji = (emojiParam ?? existing?.emoji ?? DEFAULT_EMOJI).slice(
      0,
      MAX_EMOJI_LEN,
    );

    this.room =
      role === "host"
        ? reduce(this.room, { t: "claimHost", playerId, now })
        : reduce(this.room, { t: "join", playerId, name, emoji, now });

    await this.persist();
    // Only this socket learns this player's words.
    this.sendTo(conn, {
      type: "yourEntries",
      entries: this.room.entries[playerId] ?? [],
    });
    this.broadcastState();
  }

  async onMessage(conn: Connection<ConnState>, raw: WSMessage): Promise<void> {
    if (typeof raw !== "string" || !this.room) return;
    const state = conn.state;
    if (!state) return;

    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      return;
    }

    const { playerId } = state;
    const now = Date.now();

    if (msg.type === "submitEntry") {
      const result = submitEntry(this.room, playerId, msg.text, now);
      this.room = result.room;
      this.sendTo(conn, {
        type: "entryAck",
        seq: msg.seq,
        accepted: result.accepted,
        reason: result.reason,
      });
      if (!result.accepted) return;
      await this.persist();
      return; // No broadcast: entry counts are deliberately not published.
    }

    // Ends the room outright rather than producing a new state, so it cannot
    // go through `reduce` and the shared persist/broadcast tail below — there
    // is nothing left to persist or broadcast.
    if (msg.type === "endGame") {
      if (!canEndGame(this.room, playerId)) return;
      // The host asked for this and is already on their way back to Landing;
      // telling them the host left would put the other players' banner on the
      // screen of the person who pressed the button.
      await this.endRoom("host-left", "The host ended the game.", conn);
      return;
    }

    switch (msg.type) {
      case "setProfile":
        this.room = reduce(this.room, {
          t: "setProfile",
          playerId,
          name: msg.name.slice(0, MAX_NAME_LEN),
          emoji: msg.emoji.slice(0, MAX_EMOJI_LEN),
          now,
        });
        break;
      case "ready":
        this.room = reduce(this.room, { t: "ready", playerId, ready: msg.ready, now });
        break;
      case "startGame":
        this.room = reduce(this.room, { t: "startGame", playerId, now });
        break;
      case "cancelStart":
        this.room = reduce(this.room, { t: "cancelStart", playerId, now });
        break;
      case "kick": {
        const before = this.room;
        this.room = reduce(this.room, { t: "kick", playerId, targetId: msg.targetId, now });
        // Only tear down the target's sockets if the kick actually applied —
        // `reduce` ignores a kick from a non-host, and a bare close would
        // otherwise disconnect someone the room still considers a player.
        if (this.room !== before) {
          // Record every session currently live for the target before
          // closing them, so onConnect can tell their socket auto-retrying
          // (same session) apart from a deliberate rejoin (a new one).
          const sessions = new Set<string>();
          for (const c of this.getConnections<ConnState>()) {
            if (c.state?.playerId === msg.targetId) sessions.add(c.state.session);
          }
          this.kickedSessions.set(msg.targetId, sessions);
          // Tell them why before the socket goes away, so their device can
          // return to the first screen instead of showing a bare close.
          this.rejectConnectionsFor(
            msg.targetId,
            "kicked",
            "The host removed you from this game.",
          );
        }
        break;
      }
      case "setSettings":
        this.room = reduce(this.room, {
          t: "setSettings",
          playerId,
          // A hand-rolled message can omit `values` entirely; the rules layer
          // expects an object to iterate.
          values: msg.values ?? {},
          now,
        });
        break;
      case "setMode":
        this.room = reduce(this.room, { t: "setMode", playerId, mode: msg.mode, now });
        break;
      case "setConfiguring":
        this.room = reduce(this.room, {
          t: "setConfiguring", playerId, open: msg.open === true, now,
        });
        break;
      case "showStandings":
        this.room = reduce(this.room, { t: "showStandings", playerId, now });
        break;
      case "backToLobby":
        this.room = reduce(this.room, { t: "backToLobby", playerId, now });
        break;
      case "castVote":
        this.room = reduce(this.room, {
          t: "castVote", playerId, category: msg.category, now,
        });
        break;
      case "resetVotes":
        this.room = reduce(this.room, { t: "resetVotes", playerId, now });
        break;
    }

    await this.persist();
    this.broadcastState();
  }

  async onClose(conn: Connection<ConnState>): Promise<void> {
    const state = conn.state;
    if (!state || !this.room) return;
    // A second tab for the same player must not mark them gone.
    if (this.hasOtherConnection(state.playerId, conn)) return;

    this.room = reduce(this.room, {
      t: "disconnect",
      playerId: state.playerId,
      now: Date.now(),
    });
    await this.persist();
    this.broadcastState();
  }

  /**
   * Fires at a phase deadline, or at the idle-reap horizon. This is `onAlarm`,
   * not `alarm`: PartyServer's own `alarm()` initializes the object and then
   * calls `onAlarm()`, so `onStart()` has already restored `this.room` even
   * when the alarm wakes an evicted object. Overriding `alarm()` would skip
   * that initialization and the round would never advance.
   */
  async onAlarm(): Promise<void> {
    if (!this.room) return;

    // Which of the alarm's two jobs this is — advancing a phase or reaping an
    // abandoned room — is decided in `shared/`, where it is under test. This
    // method only carries the decision out.
    // The only randomness in the game, and it enters here — shared/ stays pure.
    const outcome = alarmOutcome(this.room, Date.now(), this.hasAnyConnection(), Math.random());
    switch (outcome.action) {
      case "advance":
        this.room = outcome.room;
        await this.persist();
        this.broadcastState();
        return;
      case "touch":
        this.room = outcome.room;
        await this.persist();
        return;
      case "rearm":
        // Nothing changed, but persisting is what re-arms the next alarm.
        await this.persist();
        return;
      case "reap":
        // Sockets outlive the room they were opened for. Left connected they
        // would sit on a lobby that no longer exists, and would receive the
        // broadcasts of whatever party reuses this code next.
        await (outcome.reason === "host-left"
          ? this.endRoom("host-left", "The host ended the game.")
          : this.endRoom("no-such-room", "This game expired."));
        return;
    }
  }

  // ---- plumbing ----

  private async persist(): Promise<void> {
    if (!this.room) return;
    const pending = this.room;
    try {
      await this.ctx.storage.put("room", pending);
    } catch (err) {
      // A rejected write must not leave this object serving a room it never
      // stored: partyserver swallows the rejection, so memory would silently
      // diverge from disk and every later persist would fail the same way.
      // Roll back to stored truth and log; the caller's broadcast then carries
      // what is actually on disk.
      console.error(`W104 ${this.name}: persist failed, rolling back room`, err);
      this.room = await this.load();
      return;
    }
    await this.ctx.storage.setAlarm(nextAlarmAt(pending));
  }

  private broadcastState(): void {
    if (!this.room) return;
    this.broadcast(
      this.encode({ type: "state", state: toRoomState(this.room, Date.now()) }),
    );
  }

  private sendTo(conn: Connection<ConnState>, msg: ServerMessage): void {
    conn.send(this.encode(msg));
  }

  private encode(msg: ServerMessage): string {
    return JSON.stringify(msg);
  }

  private reject(conn: Connection<ConnState>, code: ErrorCode, message: string): void {
    conn.send(this.encode({ type: "error", code, message }));
    conn.close();
  }

  /**
   * Object identity, not connection id: partysocket reuses its `_pk` across
   * auto-reconnects, so a replaced socket and its replacement share an id and
   * an id comparison would mistake the live socket for the dead one.
   */
  private hasOtherConnection(playerId: PlayerId, except: Connection<ConnState>): boolean {
    for (const other of this.getConnections<ConnState>()) {
      if (other !== except && other.state?.playerId === playerId) return true;
    }
    return false;
  }

  private hasAnyConnection(): boolean {
    for (const _ of this.getConnections<ConnState>()) return true;
    return false;
  }

  private rejectConnectionsFor(
    playerId: PlayerId,
    code: ErrorCode,
    message: string,
  ): void {
    for (const conn of this.getConnections<ConnState>()) {
      if (conn.state?.playerId === playerId) this.reject(conn, code, message);
    }
  }

  /**
   * Deletes the room and hangs up on everyone still holding a socket to it.
   * Storage first: if the delete throws, the sockets stay open on a room that
   * still exists, which is recoverable — closing first and then failing to
   * delete would strand a live room nobody is connected to.
   */
  private async endRoom(
    code: ErrorCode,
    message: string,
    /** The connection that asked for this, if any; closed without the error. */
    except?: Connection<ConnState>,
  ): Promise<void> {
    await this.ctx.storage.deleteAll();
    this.room = null;
    for (const conn of this.getConnections<ConnState>()) {
      if (conn === except) conn.close();
      else this.reject(conn, code, message);
    }
  }
}

// Worker entrypoint: route /parties/:party/:room to the right room instance.
export default {
  async fetch(request, env) {
    // PartyServer takes the connection id from `_pk`, and partysocket mints one
    // `_pk` per socket instance and reuses it on every auto-reconnect. Two
    // sockets would then share an id in a Map keyed by it, and the stale one's
    // cleanup would evict its live replacement. Dropping the parameter makes
    // PartyServer mint a fresh id per connection instead, so that cannot arise.
    const url = new URL(request.url);
    let req = request;
    if (url.searchParams.has("_pk")) {
      url.searchParams.delete("_pk");
      req = new Request(url, request);
    }
    return (
      (await routePartykitRequest(req, env)) ??
      new Response("Not Found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
