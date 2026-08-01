import { Server, routePartykitRequest } from "partyserver";
import type { Connection, ConnectionContext, WSMessage } from "partyserver";
import {
  alarmOutcome, canEndGame, flushEntry, nextAlarmAt, reduce, submitEntry, MAX_PLAYERS,
} from "../shared/reduce";
import type { ClientMessage, ErrorCode, ServerMessage } from "../shared/protocol";
import { createRoom, matchComplete, toRoomState } from "../shared/state";
import type { Entry, MatchSettings, PlayerId, Room } from "../shared/state";
import { DEFAULT_DURATION_SEC } from "../shared/categories";
import { DEFAULT_MODE, customEnabled, defaultSettings, isGameModeId } from "../shared/gamemodes";
import { MAX_TEAM_NAME_LEN, rosterOf } from "../shared/teams";
import type { Scorer } from "../shared/teams";
import { isHuman } from "../shared/bots";
import { inWaitingRoom, seatedPlayers } from "../shared/waiting";
import { driverOf } from "../shared/mirror";
import { isViewId } from "../shared/views";
import type { ViewId } from "../shared/views";
import { SCORING_VERSION, scoreRound } from "../shared/scoring";
import { REVEAL_TIMING, clampLineMs, withSelfStrikes } from "../shared/reveal";
import { NO_SELF_MARKS } from "../shared/selfstrike";
import { placeRound } from "../shared/standings";
import {
  gameId as makeGameId, gameResultRows, gameStartRows, playedCategories,
  roundRows, voteRows,
} from "../shared/archive";
import {
  archiveGameStart, archiveMatchEnd, archiveRound, archiveVotes,
} from "./archive";
import { DEFAULT_FILL_COUNT, fillCategoryFor, fillWordsFor } from "../shared/debug";
import { collectUsage } from "./usage";
import { quotaOfRoom, writersOf } from "../shared/customCategories";

// Bindings declared in wrangler.jsonc.
export interface Env {
  W104: DurableObjectNamespace;
  /**
   * The score archive. Write-only: nothing in this class reads from it, and
   * the game must play identically when it is unavailable.
   */
  DB: D1Database;
  /**
   * Which deployment this is — "production" or "staging" from `vars` in
   * wrangler.jsonc, or "local", which `npm run dev:party` passes. Gates
   * nothing; the debug panel prints it in its footer so that a tab left open
   * against the wrong Worker is obvious rather than merely confusing.
   */
  ENVIRONMENT?: string;
  /** Debug-panel secrets. Absent everywhere until `wrangler secret put`. */
  CF_API_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
  /**
   * Per-IP budget for room connects — see `rateLimited` below.
   *
   * Optional on purpose. `wrangler dev` has no rate limiter unless the binding
   * is in the config it reads, and an environment deployed before this landed
   * has none at all; in both cases the games must still run. A missing limiter
   * means no limiting, never a closed door.
   */
  JOIN_LIMITER?: RateLimit;
}

/**
 * Everything the archive needs that the game itself has no reason to keep.
 * Persisted under its own storage key rather than added to `Room`, so no
 * archive concern can reach `shared/`, ride in a broadcast, or need a
 * defaulting fallback in `load()`.
 */
type ArchiveState = {
  /** When this room was first created — earlier than the match's start. */
  lobbyCreatedAt: number;
  /** Set at the first `startGame`; null while no match has begun. */
  gameId: string | null;
  /** Whether the match-end row has already been written. */
  finalized: boolean;
  /** Whether the category pool and votes have been written for this match. */
  votesWritten: boolean;
  /**
   * The current round's wall-clock window, captured when `playing` opens.
   * `showStandings` is too late to derive it: by then the phase is `scoring`
   * and the deadline it carried is gone.
   */
  round: { startedAt: number; endedAt: number } | null;
};

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
 * A custom category has no length cap any more — see `writeSlot` — but a
 * hostile message still should not be able to bloat `Room` with an unbounded
 * string before it ever reaches `reduce`. Generous on purpose: nowhere near
 * what a real category name would hit.
 */
const MAX_CATEGORY_WIRE_LEN = 2000;

/**
 * One instance per room; the room code is this object's name. Authoritative
 * owner of all state — clients only ever send requests. All game rules live in
 * shared/, so this class is deliberately just plumbing: persist, broadcast,
 * and schedule alarms.
 */
export class W104 extends Server<Env> {
  /**
   * **WebSocket Hibernation.** The object is evicted from memory between
   * messages instead of being pinned there for as long as a socket is open.
   *
   * This is the single biggest lever on Durable Object *duration*, which is
   * billed as wall-clock GB-s while the object is resident. Without it an idle
   * lobby costs roughly 10,800 GB-s a day — 83% of the free allowance — purely
   * for existing; with it the only cost is the moments something actually
   * runs, and an idle room's 15-second reap alarm brings that to a few GB-s.
   *
   * The trade is that **no instance field survives between events.** Everything
   * this class holds must therefore be reloadable in `onStart()`, which
   * PartyServer calls via `#ensureInitialized()` before every
   * `webSocketMessage`, `webSocketClose` and alarm. `Connection` state is the
   * exception and is safe: with hibernation `setState` serializes into the
   * socket's own attachment, so `ConnState` rides along with the socket.
   */
  static options = { hibernate: true };

  private room: Room | null = null;
  /**
   * Which session ids were live for a kicked player at the moment of the kick.
   * Lets a deliberate rejoin (a new `connect()` call mints a new session id)
   * back in while a kicked socket's own automatic reconnect — which resends the
   * same session id — stays blocked.
   *
   * **Persisted, not an instance field.** Under hibernation the object is
   * evicted constantly, so an in-memory copy would be empty on essentially
   * every connect — and an absent entry is treated as "still banned", which
   * would leave a kicked player unable to rejoin at all for the room's
   * lifetime. That was already the behaviour on a cold wake before hibernation;
   * it was simply rare enough not to notice.
   *
   * A `Record` of arrays rather than a `Map` of `Set`s, because Durable Object
   * storage serializes as JSON and both of those come back empty.
   */
  private kickedSessions: Record<PlayerId, string[]> = {};

  /**
   * Archive bookkeeping. Loaded alongside the room and written back whenever
   * it changes; absent for any room created before the archive existed, which
   * is why every read guards on it.
   */
  private archive: ArchiveState | null = null;

  async onStart(): Promise<void> {
    this.room = await this.load();
    this.archive = (await this.ctx.storage.get<ArchiveState>("archive")) ?? null;
    this.kickedSessions =
      (await this.ctx.storage.get<Record<PlayerId, string[]>>("kickedSessions")) ?? {};
  }

  private async saveKickedSessions(next: Record<PlayerId, string[]>): Promise<void> {
    this.kickedSessions = next;
    await this.ctx.storage.put("kickedSessions", next);
  }

  private async saveArchiveState(next: ArchiveState): Promise<void> {
    this.archive = next;
    await this.ctx.storage.put("archive", next);
  }

  /**
   * Fire-and-forget: the archive is never awaited on a path the game is
   * waiting for. `waitUntil` keeps the Durable Object alive long enough for
   * the write to land without the round's transition queueing behind it.
   */
  private archiveInBackground(work: Promise<void>): void {
    this.ctx.waitUntil(work);
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
      // A room stored before the debug pause existed has no such key, and an
      // undefined `paused` would read as "held" to every `!== null` check —
      // freezing the round and stopping its alarm from ever advancing it.
      paused: rest.paused ?? null,
      // Debug-only, so an absent one is harmless — but `undefined + 1` is NaN,
      // and a NaN React key would stop remounting the view on every later jump.
      viewNonce: rest.viewNonce ?? 0,
      // Debug-only too, but an absent one is *not* harmless: it is the
      // denominator of every step in the reveal's schedule, and undefined there
      // would put every line of a stored room's next reveal on one millisecond.
      revealLineMs: clampLineMs(rest.revealLineMs ?? REVEAL_TIMING.LINE_INTERVAL),
      drafts: rest.drafts ?? {},
      cursors: rest.cursors ?? {},
      pool: rest.pool ?? null,
      deal: rest.deal ?? {},
      authorsRevealed: rest.authorsRevealed ?? false,
      teams: rest.teams ?? [],
      // Two backfills in one pass. `teamId` gives players stored before teams
      // existed a null slot, and `by` gives their words an author — redundant
      // against the record key on disk, but load-bearing once a team's list is
      // merged from several keys and a row has to say where it came from.
      players: (rest.players ?? []).map((p) => ({ ...p, teamId: p.teamId ?? null })),
      entries: Object.fromEntries(
        Object.entries(rest.entries ?? {}).map(([id, list]) => [
          id,
          (list as Entry[]).map((e) => ({ ...e, by: e.by ?? id })),
        ]),
      ),
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
          // Rooms stored before this setting existed have no such field at
          // all, and anything but the literal "custom" defaults safe to stock.
          categorySource: stored?.categorySource === "custom" ? "custom" : "stock",
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
        if (phase?.name === "countdown" && !("to" in phase)) {
          return { ...phase, to: "playing" as const };
        }
        // A room persisted mid-scoring before the reveal was driven by the
        // clock has no `startedAt`, and every client would derive its line
        // count from `undefined`. Restarting the reveal from now is the only
        // honest answer — the moment it originally began is not recorded
        // anywhere else.
        if (rest.phase?.name === "scoring") {
          const scoring = rest.phase as Extract<Room["phase"], { name: "scoring" }>;
          return {
            ...scoring,
            startedAt: scoring.startedAt ?? Date.now(),
            skipped: scoring.skipped ?? false,
            // Stored before self-validation existed: no marks, and every
            // derivation reads the empty set as "nothing disowned".
            selfMarks: scoring.selfMarks ?? NO_SELF_MARKS,
          };
        }
        return rest.phase;
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
      // The lobby's birth time. Nothing is archived yet — a lobby that never
      // starts a match is deliberately not a row.
      await this.saveArchiveState({
        lobbyCreatedAt: now,
        gameId: null,
        finalized: false,
        votesWritten: false,
        round: null,
      });
    } else if (!this.room) {
      return this.reject(conn, "no-such-room", "No game with that code.");
    }

    // Before any phase gate and before `join` can seat them: partysocket
    // reconnects on its own, and in the lobby the join below would otherwise
    // welcome a kicked player straight back in as a newcomer.
    if (this.room.kicked.includes(playerId)) {
      const banned = this.kickedSessions[playerId];
      // No recorded sessions at all means the ban's bookkeeping is missing
      // rather than that this connection is new, so it stays enforced — the
      // safe direction, and now a genuine can't-happen since the record is
      // persisted alongside the kick.
      if (banned === undefined || banned.includes(session)) {
        return this.reject(conn, "kicked", "The host removed you from this game.");
      }
      // A session id the ban never recorded means this is a deliberate new
      // connection — Landing → Join again — not the kicked socket retrying
      // itself. Let them back in and lift the ban.
      this.room = {
        ...this.room,
        kicked: this.room.kicked.filter((id) => id !== playerId),
      };
      const { [playerId]: _lifted, ...rest } = this.kickedSessions;
      await this.saveKickedSessions(rest);
    }

    // A host connect for a room that already belongs to somebody else. Only a
    // resumed session reaches this — a create rolls a new code when the room
    // exists, so the only way here is a device coming back to a stored code
    // whose room has since been reaped and re-created by another party.
    // `claimHost` would quietly ignore it and leave that device parked on a
    // host screen driving nothing; refusing sends it back to Landing instead.
    if (role === "host" && this.room.hostId !== null && this.room.hostId !== playerId) {
      return this.reject(conn, "no-such-room", "No game with that code.");
    }

    const existing = this.room.players.find((p) => p.id === playerId);
    const known = this.room.hostId === playerId || existing !== undefined;

    // There used to be a phase gate here, refusing any newcomer past the
    // lobby with `game-in-progress`. A latecomer is now seated into the
    // waiting room by `join` instead and dealt in at the next whistle — see
    // `shared/waiting.ts`. The error code stays in the protocol: staging and
    // production run independently deployed Workers, so a new client pointed
    // at an older one must still handle the answer it gets.

    // Only newcomers are capped. Someone already seated — including the tenth
    // player reconnecting after their phone locked — is `known` and skips
    // this, so the cap can never lock a player out of their own room. The
    // host holds no player slot, hence the role check. Debug bots hold none
    // either — a room dressed with twenty of them must still take real phones.
    // Waiting players are counted: they hold a real seat, and a room of ten
    // plus three waiting is a thirteen-column results screen one round later.
    if (
      !known &&
      role === "player" &&
      this.room.players.filter(isHuman).length >= MAX_PLAYERS
    ) {
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
    // A player rejoining mid-round gets the list they contribute to — their
    // own in free-for-all, their team's in team play.
    this.sendEntriesToTeam(playerId);
    this.pushPrivate(playerId);
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
      if (result.accepted) {
        // Teammates share one list, so they must see each other's words as
        // they land or they spend the round duplicating each other blind.
        //
        // Targeted with `sendTo`, never `broadcast` — the "no per-player entry
        // counts in broadcasts" boundary is untouched, and other teams learn
        // nothing. With teams off this is just the submitter's own list back.
        //
        // Sent *before* the ack, and socket ordering is what makes that
        // load-bearing: the authoritative copy has to arrive ahead of the
        // message that retires the client's optimistic one.
        this.sendEntriesToTeam(playerId);
      }
      this.sendTo(conn, {
        type: "entryAck",
        seq: msg.seq,
        accepted: result.accepted,
        reason: result.reason,
      });
      if (!result.accepted) return;
      await this.persist();
      return; // Still no broadcast: entry counts are not published.
    }

    if (msg.type === "flushEntry") {
      const result = flushEntry(this.room, playerId, msg.text, now);
      this.room = result.room;
      // Silent on refusal — no ack to send it in, and no banner to render it.
      // The reject banner only draws while `playing`, and scolding somebody
      // over a word they did not choose to submit is worse than dropping it.
      if (!result.accepted) return;
      // Teammates share one list and must see the word land — `sendTo`, never
      // `broadcast`.
      this.sendEntriesToTeam(playerId);
      await this.persist();
      return; // Still no broadcast: entry counts are not published.
    }

    /**
     * Debug: put a plausible list in front of every scorer so a round can be
     * driven to the scoring screen without eight people typing.
     *
     * Handled here rather than as a `reduce` event for the same reason
     * `submitEntry` is: it touches the server-only entries map, and that is
     * the one mutation `reduce` deliberately does not own. Going through
     * `submitEntry` per word is what keeps every existing rule — phase,
     * duplicates within a scorer, `MAX_ENTRIES`, the team-merged list — in
     * force for free, instead of a second write path free to drift from the
     * one real players use.
     *
     * Host-only, checked here *and* in `shared/reduce.ts` for the two sibling
     * events. Hiding the button in the panel is not the boundary.
     */
    if (msg.type === "debugFill") {
      if (playerId !== this.room.hostId) return;

      if (this.room.phase.name === "creating") {
        // Loops `commitDraft` rather than writing `drafts` directly, so the
        // cap, the trim and the readiness rule all still apply — the same
        // arrangement the round's auto-fill has with `submitEntry`.
        const quota = quotaOfRoom(this.room);
        // Writers only, matching the quota just computed. `commitDraft` would
        // refuse a waiting player anyway, so this is the loop agreeing with the
        // rule rather than a second copy of it.
        writersOf(this.room.players).forEach((player, seat) => {
          for (let slot = 0; slot < quota; slot++) {
            this.room = reduce(this.room!, {
              t: "commitDraft",
              playerId: player.id,
              slot,
              text: fillCategoryFor(seat, slot),
              now,
            });
          }
        });
        await this.persist();
        this.broadcastState();
        this.pushPrivateAll();
        return;
      }

      if (this.room.phase.name !== "playing") return;
      const scorers = this.fillEveryList(now);
      await this.persist();
      this.pushEntriesFor(scorers);
      // Deliberately no `broadcastState`: entry counts are not published, and
      // nothing in `RoomState` changed.
      return;
    }

    /**
     * The scroll mirror: one player's position in their own results list,
     * forwarded to the TV so their column follows.
     *
     * Handled here rather than as a `reduce` event on purpose. A scroll
     * position is not game state — it has no bearing on scoring, it must not
     * survive a refresh, and exactly one socket in the room wants it. Going
     * through `reduce` would make every send a Durable Object storage write
     * *and* a full `RoomState` re-encode to every socket: an eight-player room
     * paying eight encodes to move one column.
     *
     * This is the one place the app deliberately ticks over the wire. Every
     * other continuous thing — the round timer, the reveal — broadcasts an
     * absolute moment once and is counted locally against `clockOffset`. A
     * scroll is live human input with no schedule to derive it from, so there
     * is no derivation that avoids the traffic; the rate is capped on the
     * client instead. See the request-budget arithmetic in
     * docs/superpowers/specs/2026-07-30-scroll-mirror-design.md.
     */
    if (msg.type === "scrollTo") {
      if (this.room.phase.name !== "scoring") return;
      const scorer = rosterOf(this.room).find((s) => s.members.includes(playerId));
      if (!scorer) return;
      // Enforced here and not on the TV: this is the only place that knows the
      // roster and the connection states, and the panel-style "the client
      // wouldn't send it" argument is not a boundary.
      if (driverOf(this.room, scorer.id) !== playerId) return;
      // A hand-rolled message never went through `scrollFraction`, so the
      // clamp is repeated rather than assumed — the same reason the selfStrike
      // case runs `Number` over `msg.index`.
      const at = Number(msg.at);
      if (!Number.isFinite(at)) return;
      this.sendToHost({
        type: "columnScroll",
        scorer: scorer.id,
        at: Math.min(1, Math.max(0, at)),
      });
      return; // Nothing to persist, nothing to broadcast.
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

    // Captured BEFORE the reduce: banking the round is the single place
    // `entries` is emptied, so a room read afterwards has no words left to
    // archive. See `maybeArchiveBank`.
    const before = this.room;

    /**
     * Debug: put the whole room on any screen, or restart the one it is on.
     *
     * Handled here rather than as one `switch` case because it is more than one
     * `reduce` — a couple of the views are made of a round that has been typed,
     * and standing that round up means writing `entries`, the one mutation
     * `reduce` deliberately does not own. `jumpToView` sequences it; the
     * archive check, the persist and the broadcast below are the ordinary tail,
     * spelled out because the entry push has to sit between two of them.
     *
     * Host-only, checked here *and* in `shared/reduce.ts`.
     */
    if (msg.type === "debugJump") {
      if (playerId !== this.room.hostId) return;
      // The catalog is the gate, not the client: `to` is whatever the socket
      // said, and an unknown id would fall off the end of `jumpTo`'s switch and
      // return undefined as a `Room`.
      if (!isViewId(msg.to)) return;
      const filled = this.jumpToView(msg.to, playerId, now);
      // A jump *out of a real scoring screen* into standings banks that round
      // like any other, so it archives like any other. A jump that stood the
      // round up itself cannot reach this: `before` is the room as the message
      // arrived, and that room was not on `scoring`. Synthetic rounds therefore
      // stay out of the archive for free, with nothing checking for them.
      this.maybeArchiveBank(before, now);
      await this.persist();
      if (filled) this.pushEntriesFor(filled);
      this.broadcastState();
      this.pushPrivateAll();
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
      case "startGame": {
        const before = this.room;
        this.room = reduce(this.room, { t: "startGame", playerId, now });
        // Only the first accepted start of a match writes the game row.
        // `startGame` is legal from the lobby, team select, voting and
        // standings, so it fires several times across one match.
        if (this.room !== before) await this.beginArchivedGame(now);
        break;
      }
      case "cancelStart":
        this.room = reduce(this.room, { t: "cancelStart", playerId, now });
        break;
      case "leaveRoom":
        // The socket closes itself right after this; `onClose` then reduces a
        // `disconnect` for a player who is no longer in the list, which is a
        // no-op on `players` by construction.
        this.room = reduce(this.room, { t: "leaveRoom", playerId, now });
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
          // Written to storage, not just to the instance: the target's
          // reconnect may well arrive after the object has hibernated, and an
          // unpersisted record would leave them banned for good.
          await this.saveKickedSessions({
            ...this.kickedSessions,
            [msg.targetId]: [...sessions],
          });
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
          // A hand-rolled message can omit `values`/`choices` entirely; the
          // rules layer expects objects to iterate.
          values: msg.values ?? {},
          choices: msg.choices ?? {},
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
      case "fastForward":
        this.room = reduce(this.room, { t: "fastForward", playerId, now });
        break;
      case "selfStrike":
        this.room = reduce(this.room, {
          t: "selfStrike",
          playerId,
          // Passed through as sent. `reduce` honours it for the host alone and
          // ignores it from anyone else, so nothing here has to know who this
          // connection is — and an id naming no scorer finds none and is a
          // no-op, which is the same answer as a bad index.
          scorerId: typeof msg.scorerId === "string" ? msg.scorerId : undefined,
          // A hand-rolled message can send anything at all here; `reduce`
          // rejects an index that is not one of this scorer's rows, and
          // `Number` keeps a string or a null from indexing the array at all.
          index: Number(msg.index),
          struck: msg.struck === true,
          now,
        });
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
      case "joinTeam":
        this.room = reduce(this.room, {
          t: "joinTeam", playerId, teamId: msg.teamId, now,
        });
        break;
      case "leaveTeam":
        this.room = reduce(this.room, { t: "leaveTeam", playerId, now });
        break;
      case "balanceTeams":
        // The deal's randomness enters here, like the category draw's, so
        // `reduce` stays pure and a second press can give a second answer.
        this.room = reduce(this.room, {
          t: "balanceTeams", playerId, roll: Math.random(), now,
        });
        break;
      case "debugPause":
        this.room = reduce(this.room, {
          t: "debugPause", playerId, paused: msg.paused === true, now,
        });
        break;
      case "debugSkip":
        this.room = reduce(this.room, { t: "debugSkip", playerId, now });
        break;
      case "debugBots":
        this.room = reduce(this.room, {
          t: "debugBots",
          playerId,
          // A hand-rolled message can send anything at all; `setBotCount`
          // clamps and floors, so a non-number only has to arrive as one.
          count: Number(msg.count),
          now,
        });
        break;
      case "debugRevealSpeed":
        this.room = reduce(this.room, {
          t: "debugRevealSpeed",
          playerId,
          // A hand-rolled message can send anything; `clampLineMs` bounds and
          // floors it, so a non-number only has to arrive as one.
          lineMs: Number(msg.lineMs),
          now,
        });
        break;
      case "setTeamName":
        this.room = reduce(this.room, {
          t: "setTeamName",
          playerId,
          teamId: msg.teamId,
          // Bounded at the edge, exactly like setProfile's name.
          name: msg.name.slice(0, MAX_TEAM_NAME_LEN),
          now,
        });
        break;
      case "moveCursor":
        this.room = reduce(this.room, {
          t: "moveCursor", playerId, slot: Number(msg.slot), now,
        });
        break;
      case "commitDraft":
        this.room = reduce(this.room, {
          t: "commitDraft",
          playerId,
          slot: Number(msg.slot),
          // No length rule to re-check here any more — `reduce` no longer
          // caps it either — but a hostile message still should not be able
          // to make the room object enormous before it gets there.
          text: String(msg.text ?? "").slice(0, MAX_CATEGORY_WIRE_LEN),
          now,
        });
        break;
      case "clearDraft":
        this.room = reduce(this.room, {
          t: "clearDraft", playerId, slot: Number(msg.slot), now,
        });
        break;
    }

    this.maybeArchiveBank(before, now);
    await this.persist();
    this.broadcastState();
    this.pushPrivateAll();
  }

  async onClose(conn: Connection<ConnState>): Promise<void> {
    const state = conn.state;
    if (!state || !this.room) return;
    // A second tab for the same player must not mark them gone.
    if (this.hasOtherConnection(state.playerId, conn)) return;

    const now = Date.now();
    const before = this.room;
    this.room = reduce(this.room, {
      t: "disconnect",
      playerId: state.playerId,
      now,
    });
    // Readiness counts only *connected* players, so the last unready player
    // leaving the results screen can bank the round from here.
    this.maybeArchiveBank(before, now);
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
      case "advance": {
        const previous = this.room.phase.name;
        // A local, not `this.room`: narrowing a mutable class property does
        // not survive the assignment, and tsc collapses the phase to `never`.
        const advanced = outcome.room;
        this.room = advanced;
        // The whistle. This is the only moment the round's start and deadline
        // are both known — `scoring` carries neither, and it is `scoring` that
        // the round is archived from.
        if (advanced.phase.name === "playing" && previous !== "playing" && this.archive) {
          await this.saveArchiveState({
            ...this.archive,
            round: { startedAt: Date.now(), endedAt: advanced.phase.endsAt },
          });
        }
        await this.persist();
        this.broadcastState();
        this.pushPrivateAll();
        return;
      }
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

  // ---- debug view jumper ----

  /**
   * Deals a plausible list to every scorer and returns the scorers it dealt to.
   *
   * Loops `submitEntry` rather than writing `entries` directly, which is what
   * keeps every existing rule — phase, duplicates within a scorer,
   * `MAX_ENTRIES`, the team-merged list — in force for free, instead of a second
   * write path free to drift from the one real players use. Requires the room to
   * be on `playing`, for exactly that reason.
   */
  private fillEveryList(now: number): Scorer[] {
    const scorers = rosterOf(this.room!);
    const lists = fillWordsFor(scorers.length, DEFAULT_FILL_COUNT, Math.random);
    scorers.forEach((scorer, i) => {
      (lists[i] ?? []).forEach((word, w) => {
        // Round-robin the authorship across a team's members, so a shared
        // list ends up looking like several people typed it rather than one.
        // With teams off every scorer has exactly one member and this is a
        // no-op.
        const author = scorer.members[w % scorer.members.length]!;
        // Timestamps ascend so the merged team list sorts sensibly and the
        // archive's `ms_into_round` is not a flat line.
        this.room = submitEntry(this.room!, author, word, now + w).room;
      });
    });
    return scorers;
  }

  /**
   * Pushes each scorer's merged list to its own connected members. One send per
   * *scorer*, not per player: `sendEntriesToTeam` already fans out to everybody
   * on the list it is given.
   */
  private pushEntriesFor(scorers: Scorer[]): void {
    for (const scorer of scorers) {
      if (scorer.members[0]) this.sendEntriesToTeam(scorer.members[0]);
    }
  }

  /** Whether anybody has a word down. See `jumpToView`. */
  private hasWords(): boolean {
    return Object.values(this.room?.entries ?? {}).some((list) => list.length > 0);
  }

  /**
   * Carries out one view jump, standing up a round first for the two views that
   * are made of one.
   *
   * `scoring` and `standings` are the whole reason this is a sequence rather
   * than a single `reduce`. A jump can arrive from a lobby where nobody has
   * typed anything, and a results screen with no words has nothing to reveal —
   * so the room is walked through `playing`, dealt a set of lists, and then
   * jumped on. That chain is also why the fill is reused rather than the entries
   * written straight: it goes through `playing` precisely so `submitEntry`'s
   * rules apply to the synthetic words too.
   *
   * The two synthesis guards are different on purpose. `scoring` stands a round
   * up whenever there are no words, so refreshing the results screen re-reveals
   * the same list rather than an empty one. `standings` additionally requires an
   * **empty history**: without that, every press of refresh on the standings
   * screen would deal a fresh round and bank it, and the match would grow a
   * round per press.
   *
   * Returns the scorers whose lists it wrote, or null when it wrote none.
   */
  private jumpToView(to: ViewId, playerId: PlayerId, now: number): Scorer[] | null {
    const jump = (target: ViewId) => {
      // A fresh roll per jump. Only `playing` spends it — on the category draw.
      this.room = reduce(this.room!, {
        t: "debugJump", playerId, to: target, roll: Math.random(), now,
      });
    };

    const synthesize =
      to === "scoring"
        ? !this.hasWords()
        : to === "standings" && this.room!.history.length === 0 && !this.hasWords();

    let filled: Scorer[] | null = null;
    if (synthesize) {
      jump("playing");
      filled = this.fillEveryList(now);
      jump("scoring");
    }
    // Already there when we synthesized for it; the second jump would only
    // re-roll the same reveal.
    if (!(synthesize && to === "scoring")) jump(to);
    return filled;
  }

  // ---- score archive ----
  //
  // Everything below is a side effect of play. None of it feeds back into the
  // room, none of it is awaited on a path a player is waiting on, and all of
  // it is safe to lose. See docs/superpowers/specs/2026-07-28-score-persistence-design.md.

  /** Writes the game row on the first accepted `startGame` of a match. */
  private async beginArchivedGame(now: number): Promise<void> {
    if (!this.room || !this.archive || this.archive.gameId !== null) return;
    const id = makeGameId(this.room.code, now);
    await this.saveArchiveState({ ...this.archive, gameId: id });
    this.archiveInBackground(
      archiveGameStart(
        this.env.DB,
        gameStartRows(this.room, {
          gameId: id,
          lobbyCreatedAt: this.archive.lobbyCreatedAt,
          startedAt: now,
          scoringVersion: SCORING_VERSION,
        }),
      ),
    );
  }

  /**
   * Writes the round if this event banked one.
   *
   * Keyed off the `scoring -> standings` transition rather than off any one
   * trigger, because there are two now — the host's Standings button and
   * everyone readying up on the results screen — and a third would otherwise
   * silently archive nothing.
   */
  private maybeArchiveBank(before: Room, now: number): void {
    if (!this.room) return;
    if (before.phase.name !== "scoring") return;
    if (this.room.phase.name !== "standings") return;
    this.archiveBankedRound(before, this.room, now);
  }

  /**
   * Writes one banked round, and the match's final rows when that round was
   * the last. `banked` is the room as it stood before the round was banked,
   * which is the only copy that still has the words; `after` is the room with
   * the round pushed onto history, which says whether the match is over.
   *
   * Per round rather than per match on purpose: rooms are abandoned far more
   * often than they are finished, and the reap takes everything with it.
   */
  private archiveBankedRound(banked: Room, after: Room, now: number): void {
    const state = this.archive;
    if (!state?.gameId || banked.phase.name !== "scoring") return;
    const window = state.round ?? { startedAt: now, endedAt: now };
    // The self-validated round, which is the one that was scored and placed.
    // A disowned word archives as not-unique and alone in its collision group —
    // see `withSelfStrikes`.
    const results = withSelfStrikes(banked.phase.results, banked.phase.selfMarks);

    this.archiveInBackground((async () => {
      // The game-start rows again, before the round's. `player` rows are
      // written once at match start, but the roster can now *grow* mid-match —
      // a latecomer admitted in round three writes word rows against a
      // `player_id` with no parent, and D1 enforces foreign keys, so the whole
      // 50-statement chunk carrying them would fail and the round's words would
      // be lost silently. Re-emitting is free rather than clever: every
      // statement in `archiveGameStart` is already idempotent by construction —
      // `player` upserts `last_seen_at`, `game` and `participation` are DO
      // NOTHING — which is the property being spent here.
      await archiveGameStart(
        this.env.DB,
        // Seated players only. `participation` is DO NOTHING, so whatever lands
        // first stands forever — and a waiting player archived at the bank
        // *before* they were admitted would freeze a `team_id` of null against
        // somebody who plays every remaining round in a team. Waiting for the
        // first bank they are actually in costs nothing: that is the same bank
        // their first words are written by, and the parent row still lands
        // ahead of them.
        gameStartRows({ ...banked, players: seatedPlayers(banked.players) }, {
          gameId: state.gameId!,
          lobbyCreatedAt: state.lobbyCreatedAt,
          // The match's own start time is not recorded past `gameId`, and
          // these rows only ever *insert* — `game` is DO NOTHING, so the real
          // one written at `startGame` stands. This value reaches disk only as
          // a newcomer's `first_seen_at`, where the bank they arrived for is
          // the honest answer anyway.
          startedAt: now,
          scoringVersion: SCORING_VERSION,
        }),
      );
      await archiveRound(
        this.env.DB,
        roundRows(banked, results, placeRound(results), {
          gameId: state.gameId!,
          // `after.history` already includes this round, so its index is the
          // length before the push — which is what the round was playing as.
          roundIndex: after.history.length - 1,
          startedAt: window.startedAt,
          endedAt: window.endedAt,
        }),
      );
      // Voting has definitely closed by the first bank, so the tally is final.
      // It could not have been written at `startGame`: voting happens after.
      if (!state.votesWritten) {
        await archiveVotes(this.env.DB, voteRows(banked, state.gameId!));
      }
      if (matchComplete(after)) {
        await archiveMatchEnd(
          this.env.DB, state.gameId!, gameResultRows(after, state.gameId!),
          playedCategories(after), now, true, null,
        );
      }
    })());

    void this.saveArchiveState({
      ...state,
      votesWritten: true,
      finalized: state.finalized || matchComplete(after),
      round: null,
    });
  }

  /**
   * Marks a match that never reached its final standings. Called from the one
   * place a room dies, so a host walking out mid-round still leaves a record
   * of how far the match got.
   */
  private finalizeAbandoned(): void {
    const state = this.archive;
    const room = this.room;
    if (!state?.gameId || state.finalized || !room) return;
    const phase = room.phase.name;
    this.archiveInBackground(
      archiveMatchEnd(
        this.env.DB, state.gameId, gameResultRows(room, state.gameId),
        playedCategories(room), Date.now(), false, phase,
      ),
    );
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

  /**
   * Sends the merged list a player contributes to, to every connected member
   * of that list. With teams off the scorer is the player alone, so this is
   * the same single-socket send the connect path does.
   */
  private sendEntriesToTeam(playerId: PlayerId): void {
    if (!this.room) return;
    // A waiting player is in no scorer, and the fallback below would hand them
    // their own (empty) list — harmless in itself, but the guard is a privacy
    // boundary rather than a tidy-up: it is what stops a latecomer being
    // pushed their future team's live word list mid-round, which is secret
    // from everybody not writing it.
    const me = this.room.players.find((p) => p.id === playerId);
    if (me && inWaitingRoom(me)) return;
    const scorer = rosterOf(this.room).find((s) => s.members.includes(playerId));
    const members = scorer?.members ?? [playerId];
    const entries = members
      .flatMap((id) => this.room!.entries[id] ?? [])
      .sort((a, b) => a.at - b.at);
    const msg: ServerMessage = { type: "yourEntries", entries };
    for (const conn of this.getConnections<ConnState>()) {
      if (conn.state && members.includes(conn.state.playerId)) {
        this.sendTo(conn, msg);
      }
    }
  }

  /**
   * Sends a player the two things `toRoomState` strips: their own committed
   * slots and their own hands. Same arrangement `yourEntries` has, and for the
   * same reason — these are per-socket facts, not room facts.
   *
   * Called after every state change rather than only on the events that alter
   * them: it is two small messages, and a missed push leaves a phone showing
   * an empty hand with no way to recover short of a reconnect.
   */
  private pushPrivate(playerId: PlayerId): void {
    if (!this.room) return;
    // Nothing to push in a built-in-pool match, and the common case is worth
    // not spending two messages per player per state change on.
    if (!customEnabled(this.room.settings)) return;
    const drafts = this.room.drafts[playerId] ?? [];
    const hands = this.room.deal[playerId] ?? [];
    for (const conn of this.getConnections<ConnState>()) {
      if (conn.state?.playerId !== playerId) continue;
      this.sendTo(conn, { type: "yourDrafts", drafts });
      this.sendTo(conn, { type: "yourHands", hands });
    }
  }

  /** Every seated player's private halves. */
  private pushPrivateAll(): void {
    if (!this.room) return;
    for (const player of this.room.players) this.pushPrivate(player.id);
  }

  /**
   * Sends to the host's socket alone, dropping the message when no host is
   * connected. Silent by design: a mirrored scroll that did not land breaks
   * nothing and is not worth a round trip to complain about.
   */
  private sendToHost(msg: ServerMessage): void {
    if (!this.room) return;
    const hostId = this.room.hostId;
    if (hostId === null) return;
    for (const conn of this.getConnections<ConnState>()) {
      if (conn.state?.playerId === hostId) {
        this.sendTo(conn, msg);
        return;
      }
    }
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
    // Before the delete: this reads `this.room` and the archive state, and
    // `deleteAll` takes both. The write itself outlives this call via
    // `waitUntil`, which is why it does not need the storage to still be here.
    this.finalizeAbandoned();
    await this.ctx.storage.deleteAll();
    this.room = null;
    this.archive = null;
    for (const conn of this.getConnections<ConnState>()) {
      if (conn === except) conn.close();
      else this.reject(conn, code, message);
    }
  }
}

/**
 * Free-tier usage for the debug panel, as JSON.
 *
 * **Live in every environment, production included.** It used to 404 on
 * production, which meant the only numbers worth watching were the only ones
 * you could not see without deploying a branch first.
 *
 * The endpoint is therefore unauthenticated on a public host. What it serves
 * is a handful of account-level usage counts — no tokens, no room state, no
 * player data — and the API token itself never leaves the Worker. This is the
 * place to add a gate if that trade ever stops holding; hiding the client
 * button would not close it.
 *
 * CORS is wide open because the caller is always a different origin — the app
 * is on Vercel, this is on workers.dev.
 *
 * `?fresh=1` skips the 60-second cache, for when you have just played a round
 * and want to watch the number move.
 */
async function handleUsage(request: Request, env: Env): Promise<Response> {
  const fresh = new URL(request.url).searchParams.get("fresh") === "1";
  const report = await collectUsage(env, Date.now(), { fresh });
  return new Response(JSON.stringify(report), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      // The figures are already a minute stale by design; letting a browser
      // cache them on top of that would make the refresh button a no-op.
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Whether this connect attempt has spent its caller's budget.
 *
 * Room codes are four-letter words so they can be read off a TV and shouted
 * across a room, and that ceiling is the whole point of them — no list anyone
 * can shout is large enough to hide in. At ~800 words the entire code space is
 * a couple of minutes of requests, and because a room's code *is* its
 * Durable Object name, walking that space enumerates every live lobby. So the
 * defence is a budget, not a bigger list: lengthening `CODE_WORDS` raises the
 * cost of a sweep, this is what makes the cost bite.
 *
 * Be clear about what it buys. The limit is per Cloudflare location and keyed
 * on the client address, so it stops casual enumeration from one machine and
 * does nothing about a sweep spread across a botnet. That is the right trade
 * here: what a sweep actually yields is a list of joinable lobbies — never
 * word lists, which `toRoomState` strips, and never a game in progress, which
 * `onConnect` refuses — so the harm is strangers turning up in someone's
 * living-room game, and raising the price of finding one is proportionate.
 *
 * `MAX_PLAYERS` phones plus a host share one address behind household NAT, and
 * flaky wifi has partysocket reconnecting on top of that, so the budget is set
 * far above a real room's worst hour and far below a walk of the code space.
 * The number itself is in `wrangler.jsonc` — it is configuration, and a
 * constant here that did not control it would only ever go stale.
 *
 * Two ways this declines to limit, both deliberate: no binding (see `Env`), and
 * no `CF-Connecting-IP`, which is every request in `wrangler dev` — there is no
 * caller to key on, and guessing one would rate-limit local development
 * against itself.
 */
async function rateLimited(request: Request, env: Env): Promise<boolean> {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!env.JOIN_LIMITER || !ip) return false;
  const { success } = await env.JOIN_LIMITER.limit({ key: ip });
  return !success;
}

// Worker entrypoint: route /parties/:party/:room to the right room instance.
export default {
  async fetch(request, env) {
    // Checked before `routePartykitRequest`, which would otherwise 404 it
    // itself — this path is not a party route and never reaches a room. Also
    // before the budget below: the debug panel polls on its own schedule and
    // is not what the budget is defending.
    if (new URL(request.url).pathname === "/debug/usage") {
      return handleUsage(request, env);
    }

    // Everything past here is a room connect, which is the only request that
    // can tell an attacker whether a code is live.
    if (await rateLimited(request, env)) {
      return new Response("Too Many Requests", {
        status: 429,
        headers: { "Retry-After": "60" },
      });
    }

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
