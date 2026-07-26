import PartySocket from "partysocket";
import { useSyncExternalStore } from "react";
import type { ClientMessage, ErrorCode, ServerMessage } from "../../shared/protocol";
import type { RejectReason } from "../../shared/reduce";
import type { Entry, RoomState } from "../../shared/state";
import { randomUUID } from "./identity";

// Set by Vercel in production; falls back to the local `wrangler dev` server.
// On a phone this MUST be the host machine's LAN IP — 127.0.0.1 would mean
// the phone itself.
const HOST = import.meta.env.VITE_PARTYKIT_HOST ?? "127.0.0.1:8787";

/** `seq` is present only while an entry is awaiting its ack. */
export type LocalEntry = Entry & { seq?: number };

export type ClientState = {
  connected: boolean;
  room: RoomState | null;
  entries: LocalEntry[];
  /** Add to Date.now() to get the server's clock. */
  clockOffset: number;
  error: { code: ErrorCode; message: string } | null;
  rejected: string | null;
  /**
   * Bumped on every rejection, including a repeat of one already showing.
   * The banner is keyed on it so React remounts the element and replays its
   * fade — typing the same duplicate twice is exactly when a player most
   * needs to see the message again, and an unchanged string would sit there
   * mid-fade instead.
   */
  rejectedSeq: number;
};

export type ConnectOptions = {
  code: string;
  playerId: string;
  role: "player" | "host";
  intent?: "create";
  name?: string;
  emoji?: string;
};

const REJECTIONS: Record<RejectReason, string> = {
  "not-playing": "Round isn't running.",
  empty: "Type something first.",
  "too-long": "That's too long.",
  duplicate: "You already wrote that.",
  limit: "That's enough words!",
};

const EMPTY: ClientState = {
  connected: false,
  room: null,
  entries: [],
  clockOffset: 0,
  error: null,
  rejected: null,
  rejectedSeq: 0,
};

export class RoomStore {
  private listeners = new Set<() => void>();
  private socket: PartySocket | null = null;
  private seq = 0;
  private state: ClientState = EMPTY;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };

  getSnapshot = (): ClientState => this.state;

  private set(patch: Partial<ClientState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  connect(opts: ConnectOptions): void {
    this.disconnect();
    this.state = EMPTY;

    // A fresh id per connect() call, distinct from playerId: partysocket
    // reuses the same query — including this — across its own automatic
    // reconnects of one socket, so the server can tell "the socket that just
    // got kicked is retrying itself" (same session) apart from "the player
    // deliberately came back through Landing and connected again" (new
    // session), and only the latter lifts a kick.
    const query: Record<string, string> = {
      playerId: opts.playerId,
      role: opts.role,
      session: randomUUID(),
    };
    if (opts.intent) query.intent = opts.intent;
    if (opts.name) query.name = opts.name;
    if (opts.emoji) query.emoji = opts.emoji;

    const socket = new PartySocket({
      host: HOST,
      party: "w104",
      room: opts.code,
      query,
    });
    this.socket = socket;

    // `disconnect()` closes the previous socket, but its close event fires
    // asynchronously; without this guard a stale socket's delayed event could
    // land after a newer connect() and clobber live state (e.g. flip
    // `connected` back to false right after the new socket opens).
    const isCurrent = () => this.socket === socket;

    socket.addEventListener("open", () => {
      if (isCurrent()) this.set({ connected: true });
    });
    socket.addEventListener("close", () => {
      if (isCurrent()) this.set({ connected: false });
    });
    socket.addEventListener("message", (event) => {
      if (isCurrent()) this.receive(JSON.parse(event.data as string) as ServerMessage);
    });
  }

  disconnect(): void {
    this.socket?.close();
    this.socket = null;
  }

  send(msg: ClientMessage): void {
    this.socket?.send(JSON.stringify(msg));
  }

  /**
   * Renders immediately and reconciles on ack — a 30-second round cannot wait
   * on a round trip.
   */
  submit(text: string): void {
    const trimmed = text.trim();
    if (trimmed === "") return;
    const seq = ++this.seq;
    this.set({
      entries: [...this.state.entries, { text: trimmed, at: this.now(), seq }],
      rejected: null,
    });
    this.send({ type: "submitEntry", text: trimmed, seq });
  }

  now(): number {
    return Date.now() + this.state.clockOffset;
  }

  private receive(msg: ServerMessage): void {
    switch (msg.type) {
      case "state": {
        const wasScoring = this.state.room?.phase.name === "scoring";
        const nowLobby = msg.state.phase.name === "lobby";
        const freshRound = wasScoring && nowLobby;
        this.set({
          room: msg.state,
          clockOffset: msg.state.serverTime - Date.now(),
          // A new game wipes the local list; the server already cleared its own.
          entries: freshRound ? [] : this.state.entries,
          // Otherwise a rejection from the last round (e.g. "You already wrote
          // that.") would still be showing when the next one starts.
          rejected: freshRound ? null : this.state.rejected,
        });
        break;
      }
      case "yourEntries":
        this.set({ entries: msg.entries });
        break;
      case "entryAck":
        if (msg.accepted) {
          this.set({
            entries: this.state.entries.map((e) =>
              e.seq === msg.seq ? { text: e.text, at: e.at } : e,
            ),
          });
        } else {
          this.set({
            entries: this.state.entries.filter((e) => e.seq !== msg.seq),
            rejected: msg.reason ? REJECTIONS[msg.reason] : "Not accepted.",
            rejectedSeq: this.state.rejectedSeq + 1,
          });
        }
        break;
      case "error":
        this.set({ error: { code: msg.code, message: msg.message } });
        break;
    }
  }
}

export const roomStore = new RoomStore();

export function useRoom(): ClientState {
  return useSyncExternalStore(roomStore.subscribe, roomStore.getSnapshot);
}
