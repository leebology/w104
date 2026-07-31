import PartySocket from "partysocket";
import { useSyncExternalStore } from "react";
import type { ClientMessage, ErrorCode, ServerMessage } from "../../shared/protocol";
import type { RejectReason } from "../../shared/reduce";
import type { Entry, RoomState } from "../../shared/state";
import type { Hand } from "../../shared/customCategories";
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
  /** This player's own committed categories. Never in `room`. */
  drafts: string[];
  /** This player's own hands. Never in `room`. */
  hands: Hand[];
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
  // In a team match the list is shared, so it may well have been a teammate.
  duplicate: "That's already on the list.",
  limit: "That's enough words!",
};

const EMPTY: ClientState = {
  connected: false,
  room: null,
  entries: [],
  drafts: [],
  hands: [],
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
  private playerId = "";
  /** Tears down the wake listeners for the current socket. See `connect`. */
  private unwatch: (() => void) | null = null;

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
    this.playerId = opts.playerId;

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

    /**
     * Come back the moment the phone does.
     *
     * partysocket retries on its own, but a backgrounded tab is exactly where
     * that goes wrong: the OS suspends its timers, so the retry that was due
     * during the two minutes the screen was off fires late — and the backoff it
     * fires on has meanwhile grown. Every one of these events means "this
     * device is being used again", and `reconnect()` both resets the retry
     * counter and goes now rather than at the end of a delay computed while
     * nobody was looking.
     *
     * A no-op when the socket is already open or dialling, which is the common
     * case: a short screen-off does not close a socket at all.
     */
    const wake = () => {
      if (!isCurrent()) return;
      if (document.visibilityState !== "visible") return;
      if (socket.readyState === WebSocket.OPEN) return;
      if (socket.readyState === WebSocket.CONNECTING) return;
      socket.reconnect();
    };
    document.addEventListener("visibilitychange", wake);
    // `pageshow` rather than `focus`: it also fires when Safari restores the
    // page from the back/forward cache, where the socket is dead but no
    // visibility change is ever dispatched.
    window.addEventListener("pageshow", wake);
    window.addEventListener("online", wake);
    this.unwatch = () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("pageshow", wake);
      window.removeEventListener("online", wake);
    };
  }

  disconnect(): void {
    this.unwatch?.();
    this.unwatch = null;
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
      entries: [
        ...this.state.entries,
        { text: trimmed, at: this.now(), by: this.playerId, seq },
      ],
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
        // `history` only ever grows (banked one round at a time by
        // showStandings) or resets to empty (backToLobby ending the match) —
        // the only two places shared/reduce.ts touches it — so a length
        // change is exactly "the round this client was typing in is now
        // over," regardless of which phases happen to sit on either side of
        // it. This used to be a direct `scoring -> lobby` phase check, which
        // silently stopped firing the moment showStandings started landing
        // on "standings" instead of "lobby"; keying off the data rather than
        // the phase shape survives the next phase rename too.
        //
        // Guarded on `this.state.room` because the very first `state`
        // message a freshly-connected socket receives has no previous room
        // to diff against — comparing against nothing would read as a
        // "change" and wipe out the entries `yourEntries` just populated a
        // moment earlier, for a player rejoining mid-match.
        const historyChanged =
          this.state.room !== null &&
          this.state.room.history.length !== msg.state.history.length;
        this.set({
          room: msg.state,
          clockOffset: msg.state.serverTime - Date.now(),
          // The server already cleared its own copy at showStandings/backToLobby.
          entries: historyChanged ? [] : this.state.entries,
          // Otherwise a rejection from the last round (e.g. "You already wrote
          // that.") would still be showing when the next one starts.
          rejected: historyChanged ? null : this.state.rejected,
        });
        break;
      }
      case "yourEntries":
        // Server truth, plus anything typed since that has not been acked
        // yet. In team play this message also arrives when a *teammate*
        // submits, so dropping the local unacked entries here would make the
        // word you are mid-submitting vanish and come back.
        this.set({
          entries: [
            ...msg.entries,
            ...this.state.entries.filter((e) => e.seq !== undefined),
          ],
        });
        break;
      case "entryAck":
        if (msg.accepted) {
          // Drop the optimistic copy rather than stripping its `seq`: the
          // server sends the authoritative list immediately *before* this
          // message, so its copy of this entry is already in `entries` and
          // keeping both would show the word twice.
          this.set({ entries: this.state.entries.filter((e) => e.seq !== msg.seq) });
        } else {
          this.set({
            entries: this.state.entries.filter((e) => e.seq !== msg.seq),
            rejected: msg.reason ? REJECTIONS[msg.reason] : "Not accepted.",
            rejectedSeq: this.state.rejectedSeq + 1,
          });
        }
        break;
      case "yourDrafts":
        this.set({ drafts: msg.drafts });
        break;
      case "yourHands":
        this.set({ hands: msg.hands });
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
