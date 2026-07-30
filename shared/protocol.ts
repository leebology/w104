import type { Entry, PlayerId, RoomState } from "./state";
import type { RejectReason } from "./reduce";
import type { NumericSettingKey } from "./gamemodes";
import type { TeamId } from "./teams";

export type ClientMessage =
  | { type: "setProfile"; name: string; emoji: string }
  | { type: "ready"; ready: boolean }
  | { type: "startGame" }
  | { type: "cancelStart" }
  | { type: "kick"; targetId: PlayerId }
  | { type: "submitEntry"; text: string; seq: number }
  | { type: "setSettings"; values: Partial<Record<NumericSettingKey, number>> }
  | { type: "setMode"; mode: string }
  | { type: "setConfiguring"; open: boolean }
  | { type: "showStandings" }
  /** Host-only, `scoring` only: land every outstanding strike of the reveal. */
  | { type: "fastForward" }
  /**
   * Self-validation, `scoring` only: strike one of your own words out by hand,
   * or take it back. `index` is into your own scorer's `results` entries. Not
   * host-only — it is the player's own list.
   */
  | { type: "selfStrike"; index: number; struck: boolean }
  | { type: "backToLobby" }
  | { type: "castVote"; category: string }
  | { type: "resetVotes" }
  | { type: "joinTeam"; teamId: TeamId }
  | { type: "leaveTeam" }
  | { type: "setTeamName"; teamId: TeamId; name: string }
  | { type: "balanceTeams" }
  /**
   * Debug-panel controls. Host-only and enforced as such in `shared/reduce.ts`
   * and `party/server.ts` — the panel hides them from non-hosts, but a hidden
   * button is not an authorization boundary and these mutate a live round.
   */
  | { type: "debugPause"; paused: boolean }
  | { type: "debugSkip" }
  /** Fills every scorer's list with random words. `playing` only. */
  | { type: "debugFill" }
  | { type: "endGame" };

export type ServerMessage =
  | { type: "state"; state: RoomState }
  | { type: "entryAck"; seq: number; accepted: boolean; reason?: RejectReason }
  | { type: "yourEntries"; entries: Entry[] }
  | { type: "error"; code: ErrorCode; message: string };

export type ErrorCode =
  | "room-exists"      // tried to create a code already in use
  | "no-such-room"     // joined a code with no room behind it
  | "game-in-progress" // joined mid-round as a new player
  | "room-full"        // joined a room already holding MAX_PLAYERS
  | "not-host"         // host-only action from a player connection
  | "kicked"           // the host removed this player from the room
  | "host-left";       // the host ended the game, or never came back
