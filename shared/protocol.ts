import type { Entry, PlayerId, RoomState } from "./state";
import type { RejectReason } from "./reduce";

export type ClientMessage =
  | { type: "setProfile"; name: string; emoji: string }
  | { type: "ready"; ready: boolean }
  | { type: "startGame" }
  | { type: "kick"; targetId: PlayerId }
  | { type: "submitEntry"; text: string; seq: number }
  | { type: "newGame" };

export type ServerMessage =
  | { type: "state"; state: RoomState }
  | { type: "entryAck"; seq: number; accepted: boolean; reason?: RejectReason }
  | { type: "yourEntries"; entries: Entry[] }
  | { type: "error"; code: ErrorCode; message: string };

export type ErrorCode =
  | "room-exists"      // tried to create a code already in use
  | "no-such-room"     // joined a code with no room behind it
  | "game-in-progress" // joined mid-round as a new player
  | "not-host"         // host-only action from a player connection
  | "kicked";          // the host removed this player from the room
