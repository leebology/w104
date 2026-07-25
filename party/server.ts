import { Server, routePartykitRequest } from "partyserver";
import type { Connection, ConnectionContext, WSMessage } from "partyserver";
import { nextAlarmAt, reduce, submitEntry, IDLE_REAP_MS } from "../shared/reduce";
import type { ClientMessage, ErrorCode, ServerMessage } from "../shared/protocol";
import { createRoom, toRoomState } from "../shared/state";
import type { PlayerId, Room } from "../shared/state";

// Durable Object binding declared in wrangler.jsonc.
export interface Env {
  W104: DurableObjectNamespace;
}

type ConnState = { playerId: PlayerId; role: "player" | "host" };

/**
 * One instance per room; the room code is this object's name. Authoritative
 * owner of all state — clients only ever send requests. All game rules live in
 * shared/, so this class is deliberately just plumbing: persist, broadcast,
 * and schedule alarms.
 */
export class W104 extends Server<Env> {
  private room: Room | null = null;

  async onStart(): Promise<void> {
    this.room = (await this.ctx.storage.get<Room>("room")) ?? null;
  }

  async onConnect(conn: Connection<ConnState>, ctx: ConnectionContext): Promise<void> {
    const url = new URL(ctx.request.url);
    const playerId = url.searchParams.get("playerId");
    const role = url.searchParams.get("role") === "host" ? "host" : "player";
    const intent = url.searchParams.get("intent");
    const name = (url.searchParams.get("name") ?? "").slice(0, 20);
    const emoji = url.searchParams.get("emoji") ?? "🙂";
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

    const known =
      this.room.hostId === playerId || this.room.players.some((p) => p.id === playerId);
    if (!known && this.room.phase.name !== "lobby") {
      return this.reject(conn, "game-in-progress", "That game is already running.");
    }

    conn.setState({ playerId, role });

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

    switch (msg.type) {
      case "setProfile":
        this.room = reduce(this.room, {
          t: "setProfile",
          playerId,
          name: msg.name.slice(0, 20),
          emoji: msg.emoji,
          now,
        });
        break;
      case "ready":
        this.room = reduce(this.room, { t: "ready", playerId, ready: msg.ready, now });
        break;
      case "startGame":
        this.room = reduce(this.room, { t: "startGame", playerId, now });
        break;
      case "kick":
        this.room = reduce(this.room, { t: "kick", playerId, targetId: msg.targetId, now });
        this.closeConnectionsFor(msg.targetId);
        break;
      case "newGame":
        this.room = reduce(this.room, { t: "newGame", playerId, now });
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
    const now = Date.now();

    if (now >= this.room.lastActivityAt + IDLE_REAP_MS) {
      await this.ctx.storage.deleteAll();
      this.room = null;
      return;
    }

    const next = reduce(this.room, { t: "tick", now });
    const changed = next !== this.room;
    this.room = next;
    await this.persist();
    if (changed) this.broadcastState();
  }

  // ---- plumbing ----

  private async persist(): Promise<void> {
    if (!this.room) return;
    await this.ctx.storage.put("room", this.room);
    await this.ctx.storage.setAlarm(nextAlarmAt(this.room));
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

  private hasOtherConnection(playerId: PlayerId, except: Connection<ConnState>): boolean {
    for (const other of this.getConnections<ConnState>()) {
      if (other.id !== except.id && other.state?.playerId === playerId) return true;
    }
    return false;
  }

  private closeConnectionsFor(playerId: PlayerId): void {
    for (const conn of this.getConnections<ConnState>()) {
      if (conn.state?.playerId === playerId) conn.close();
    }
  }
}

// Worker entrypoint: route /parties/:party/:room to the right room instance.
export default {
  async fetch(request, env) {
    return (
      (await routePartykitRequest(request, env)) ??
      new Response("Not Found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
