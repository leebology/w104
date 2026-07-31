import type { Entry, PlayerId, RoomState } from "./state";
import type { RejectReason } from "./reduce";
import type { ChoiceSettingKey, NumericSettingKey } from "./gamemodes";
import type { TeamId } from "./teams";
import type { ViewId } from "./views";
import type { Hand } from "./customCategories";

export type ClientMessage =
  | { type: "setProfile"; name: string; emoji: string }
  | { type: "ready"; ready: boolean }
  | { type: "startGame" }
  | { type: "cancelStart" }
  | { type: "kick"; targetId: PlayerId }
  /**
   * Give up your seat. Distinct from simply closing the socket, which leaves
   * the player in the room greyed out so a locked phone can reclaim its seat —
   * this is the deliberate version, and it takes the seat with it.
   */
  | { type: "leaveRoom" }
  | { type: "submitEntry"; text: string; seq: number }
  | {
      type: "setSettings";
      values: Partial<Record<NumericSettingKey, number>>;
      choices?: Partial<Record<ChoiceSettingKey, string>>;
    }
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
   * The phone publishing which slot it is on. Cheap and frequent; the only
   * thing that drives the writing state on the TV, and it carries no text.
   */
  | { type: "moveCursor"; slot: number }
  /**
   * Committing a category. **Committing is readying** — never on keystroke,
   * or the phase could close under a player mid-word.
   */
  | { type: "commitDraft"; slot: number; text: string }
  /** Taking one back. Un-readies, which tears down an in-flight close. */
  | { type: "clearDraft"; slot: number }
  /**
   * Debug-panel controls. Host-only and enforced as such in `shared/reduce.ts`
   * and `party/server.ts` — the panel hides them from non-hosts, but a hidden
   * button is not an authorization boundary and these mutate a live round.
   */
  | { type: "debugPause"; paused: boolean }
  | { type: "debugSkip" }
  /** Fills every scorer's list with random words. `playing` only. */
  | { type: "debugFill" }
  /**
   * Puts the whole room — TV and phones — on the named screen. Legal from every
   * phase, and jumping to the screen already showing restarts it, which is the
   * panel's refresh button. `to` is checked against the catalog on arrival.
   */
  | { type: "debugJump"; to: ViewId }
  /**
   * Sets the placeholder-bot population to exactly `count`, clamped to
   * 0..MAX_BOTS on arrival. Legal from every phase.
   */
  | { type: "debugBots"; count: number }
  | { type: "endGame" };

export type ServerMessage =
  | { type: "state"; state: RoomState }
  | { type: "entryAck"; seq: number; accepted: boolean; reason?: RejectReason }
  | { type: "yourEntries"; entries: Entry[] }
  /** This player's own committed slots. Never broadcast — see toRoomState. */
  | { type: "yourDrafts"; drafts: string[] }
  /** This player's own hands. Never broadcast: a leaked hand plus a public
      tally lets the room deduce who voted for what. */
  | { type: "yourHands"; hands: Hand[] }
  | { type: "error"; code: ErrorCode; message: string };

export type ErrorCode =
  | "room-exists"      // tried to create a code already in use
  | "no-such-room"     // joined a code with no room behind it
  | "game-in-progress" // joined mid-round as a new player
  | "room-full"        // joined a room already holding MAX_PLAYERS
  | "not-host"         // host-only action from a player connection
  | "kicked"           // the host removed this player from the room
  | "host-left";       // the host ended the game, or never came back
