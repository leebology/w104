import { scoreRound, normalize } from "./scoring";
import type { Results } from "./scoring";
import { rowKey, withSelfStrikes } from "./reveal";
import { NO_SELF_MARKS, toggleMark } from "./selfstrike";
import { placeRound } from "./standings";
import { matchComplete, preRoundPhase } from "./state";
import type { Entry, MatchSettings, Player, PlayerId, Room, RoundSummary } from "./state";
import { BALLOT, CATEGORIES } from "./categories";
import {
  customEnabled, isGameModeId, isNumericSpec, modeSpec, normalizeChoice, normalizeSetting,
} from "./gamemodes";
import type { CategorySource, ChoiceSettingKey, NumericSettingKey } from "./gamemodes";
import { MAX_CATEGORY_LEN, WRITE_MS, buildDeal, buildPool, quotaFor } from "./customCategories";
import { pickCategory, spentCategories, voteBudget, votesSpent } from "./voting";
import { MAX_TEAM_NAME_LEN, TEAM_COLORS, assignStragglers, balanceTeams, makeTeams, rosterOf, teamsEnabled } from "./teams";
import type { TeamId } from "./teams";
import { MIN_TEAM_COUNT } from "./gamemodes";
import type { ViewId } from "./views";
import { isHuman, isWaiting, seatBots, setBotCount } from "./bots";

export const COUNTDOWN_MS = 5_000;
/** One voting window per match, whatever the round count. */
export const VOTING_MS = 60_000;
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
/**
 * Re-exported, not re-declared: the bounds now live beside the descriptors
 * that quote them in `shared/gamemodes.ts`. Every existing import site and
 * test keeps working, and the dependency runs one way only.
 */
export {
  MAX_DURATION_SEC, MAX_ROUND_COUNT, MIN_DURATION_SEC, MIN_ROUND_COUNT,
} from "./gamemodes";

export type RoomEvent =
  | { t: "join"; playerId: PlayerId; name: string; emoji: string; now: number }
  | { t: "claimHost"; playerId: PlayerId; now: number }
  | { t: "setProfile"; playerId: PlayerId; name: string; emoji: string; now: number }
  | { t: "ready"; playerId: PlayerId; ready: boolean; now: number }
  | { t: "startGame"; playerId: PlayerId; now: number }
  | { t: "cancelStart"; playerId: PlayerId; now: number }
  | { t: "kick"; playerId: PlayerId; targetId: PlayerId; now: number }
  /**
   * A player giving up their seat, from the lobby. Everything a kick does to
   * the room, minus the ban — they walked out, so they are welcome back — and
   * it is not host-only, since it only ever acts on the sender.
   */
  | { t: "leaveRoom"; playerId: PlayerId; now: number }
  | { t: "disconnect"; playerId: PlayerId; now: number }
  | {
      t: "setSettings";
      playerId: PlayerId;
      /** Only keys the *active mode* exposes are honoured. */
      values: Partial<Record<NumericSettingKey, number>>;
      choices: Partial<Record<ChoiceSettingKey, string>>;
      now: number;
    }
  | { t: "setMode"; playerId: PlayerId; mode: string; now: number }
  | { t: "setConfiguring"; playerId: PlayerId; open: boolean; now: number }
  | { t: "showStandings"; playerId: PlayerId; now: number }
  | { t: "backToLobby"; playerId: PlayerId; now: number }
  | { t: "castVote"; playerId: PlayerId; category: string; now: number }
  | { t: "resetVotes"; playerId: PlayerId; now: number }
  | { t: "joinTeam"; playerId: PlayerId; teamId: TeamId; now: number }
  | { t: "leaveTeam"; playerId: PlayerId; now: number }
  | { t: "setTeamName"; playerId: PlayerId; teamId: TeamId; name: string; now: number }
  /**
   * The phone publishing which slot it is on. Cheap and frequent; the only
   * thing that drives the writing state on the TV, and it carries no text.
   */
  | { t: "moveCursor"; playerId: PlayerId; slot: number; now: number }
  /**
   * Committing a category. **Committing is readying** — never on keystroke,
   * or the phase could close under a player mid-word.
   */
  | { t: "commitDraft"; playerId: PlayerId; slot: number; text: string; now: number }
  /** Taking one back. Un-readies, which tears down an in-flight close. */
  | { t: "clearDraft"; playerId: PlayerId; slot: number; now: number }
  /**
   * The host's Auto sort. `roll` is a uniform [0,1) from the caller, the same
   * arrangement the category draw uses: the deal has to be random — pressing
   * the button twice must be able to give two answers — while `reduce` stays
   * pure.
   */
  | { t: "balanceTeams"; playerId: PlayerId; roll: number; now: number }
  /**
   * Debug controls, host-only and legal only during `playing`. They exist to
   * make a round inspectable — hold it still, or cut it short — and the host
   * check lives here rather than only in the UI, because a hidden button is
   * not an authorization boundary.
   */
  | { t: "debugPause"; playerId: PlayerId; paused: boolean; now: number }
  | { t: "debugSkip"; playerId: PlayerId; now: number }
  /**
   * Host-only, legal from **every** phase: put the room on the named screen.
   * `roll` is the category draw's, for the one target that needs it. See
   * `jumpTo`.
   */
  | { t: "debugJump"; playerId: PlayerId; to: ViewId; roll: number; now: number }
  /**
   * Host-only, legal from every phase: set the placeholder-bot population to
   * exactly `count` (0..MAX_BOTS). Absolute rather than an add/remove delta so
   * a double-tapped button cannot drift the room away from what the panel is
   * showing. See `shared/bots.ts`.
   */
  | { t: "debugBots"; playerId: PlayerId; count: number; now: number }
  /**
   * Host-only, `scoring` only: land every outstanding strike at once. In state
   * rather than as a client-side control because the phones are watching the
   * same reveal — a skip only the TV knew about would leave them crawling
   * through lines the room has already been shown.
   */
  | { t: "fastForward"; playerId: PlayerId; now: number }
  /**
   * Self-validation, `scoring` only: the scorer strikes one of their own words
   * out by hand, or takes it back. `index` addresses their own row in
   * `phase.results`; anything else — somebody else's list, an index past the
   * end, a word the round already struck — is ignored. See shared/selfstrike.ts.
   */
  | { t: "selfStrike"; playerId: PlayerId; index: number; struck: boolean; now: number }
  /**
   * `roll` is a uniform [0,1) supplied by the caller. Randomness is injected
   * at the edge so `reduce` stays a pure function and the draw is testable
   * against fixed rolls rather than a stubbed global.
   */
  | { t: "tick"; now: number; roll: number };

const mapPlayer = (
  players: Player[],
  id: PlayerId,
  fn: (p: Player) => Player,
): Player[] => players.map((p) => (p.id === id ? fn(p) : p));

/** This room's quota, derived from the live room. Never stored. */
function quotaOf(room: Room): number {
  return quotaFor(room.players.length, room.settings.roundCount);
}

/** Whether every slot this player owns holds something. */
function hasWrittenAll(room: Room, playerId: PlayerId): boolean {
  const quota = quotaOf(room);
  const mine = room.drafts[playerId] ?? [];
  for (let i = 0; i < quota; i++) {
    if ((mine[i] ?? "").trim() === "") return false;
  }
  return true;
}

function writeSlot(room: Room, playerId: PlayerId, slot: number, text: string): Room {
  const quota = quotaOf(room);
  if (!Number.isInteger(slot) || slot < 0 || slot >= quota) return room;
  if (!room.players.some((p) => p.id === playerId)) return room;

  const mine = [...(room.drafts[playerId] ?? [])];
  while (mine.length < quota) mine.push("");
  const next = text.trim().slice(0, MAX_CATEGORY_LEN);
  if (mine[slot] === next) return room;
  mine[slot] = next;

  const drafts = { ...room.drafts, [playerId]: mine };
  const staged: Room = { ...room, drafts };
  return {
    ...staged,
    players: mapPlayer(staged.players, playerId, (p) => ({
      ...p,
      ready: hasWrittenAll(staged, playerId),
    })),
  };
}

/**
 * Readiness counts only connected players. Otherwise one person whose phone
 * died in the lobby would block the game for everyone until they came back.
 *
 * `min` is the floor on how many connected players it takes to be a room at
 * all: MIN_PLAYERS in the lobby and at standings, but 1 during voting — the
 * match has already begun by then, and a host solo-start has to be able to
 * close its own vote.
 *
 * Debug bots are inert on both halves — excluded from the floor, and always
 * counted as waiting. Scenery must neither hold a room down nor make one
 * startable that would not have started without it. See `shared/bots.ts`.
 */
function everyoneReady(room: Room, min: number): boolean {
  const active = room.players.filter((p) => p.connected);
  return active.filter(isHuman).length >= min && active.every(isWaiting);
}

function openCountdown(
  room: Room,
  now: number,
  to: "creating" | "voting" | "playing",
): Room {
  return { ...room, phase: { name: "countdown", endsAt: now + COUNTDOWN_MS, to } };
}

/** Where a match heads once the room is settled: writing first, if custom. */
function afterLobby(room: Room): "creating" | "voting" {
  return customEnabled(room.settings) ? "creating" : "voting";
}

/**
 * Applies host-supplied values, honouring only the keys the *active mode*
 * actually exposes — the wire is not trusted, so a message naming a field this
 * mode does not have is ignored even though the field exists on the type.
 * Returns the identical object when nothing changed, per the no-op rule.
 */
function applySettings(
  settings: MatchSettings,
  values: Partial<Record<NumericSettingKey, number>>,
  choices: Partial<Record<ChoiceSettingKey, string>>,
): MatchSettings {
  let next = settings;
  for (const spec of modeSpec(settings.mode).settings) {
    if (isNumericSpec(spec)) {
      const value = normalizeSetting(spec, values[spec.key], settings[spec.key]);
      if (value !== next[spec.key]) next = { ...next, [spec.key]: value };
    } else {
      const value = normalizeChoice(spec, choices[spec.key], settings[spec.key]);
      if (value !== next[spec.key]) {
        next = { ...next, [spec.key]: value as CategorySource };
      }
    }
  }
  return next;
}

/**
 * Pulls every value the given mode exposes back inside that mode's bounds.
 * Switching modes carries values across rather than resetting them, so a mode
 * with a tighter range must not inherit a number its own stepper cannot reach.
 */
function clampToMode(settings: MatchSettings): MatchSettings {
  let next = settings;
  for (const spec of modeSpec(settings.mode).settings) {
    if (isNumericSpec(spec)) {
      const value = normalizeSetting(spec, settings[spec.key], settings[spec.key]);
      if (value !== next[spec.key]) next = { ...next, [spec.key]: value };
    }
  }
  return next;
}

/**
 * Opens team select: teams for the current count, nobody assigned, and every
 * ready flag cleared.
 *
 * That clear is load-bearing, exactly as the one at the voting edge is:
 * `ready` means "waiting in the room" on the lobby side and "has a team" on
 * this side. Carried across, the next `settle` would see everyone ready and
 * close team select before a single player had picked.
 *
 * The existing teams are kept when the count already matches, which is the
 * case when the host steps *back* here from voting: the names players typed
 * are theirs and must survive the trip. Coming from the lobby there are none
 * to keep — `backToLobby` cleared them — so that path builds fresh.
 */
function enterTeams(room: Room): Room {
  const teams =
    room.teams.length === room.settings.teamCount
      ? room.teams
      : makeTeams(room.settings.teamCount);
  return {
    ...room,
    phase: { name: "teams" },
    teams,
    // Clearing membership is what stops `settle` closing team select the
    // instant it opens; the bots are then put straight back on teams, because
    // a placeholder has nothing to pick with and an empty panel is the one
    // thing this screen is dressed to avoid.
    players: seatBots(
      room.players.map((p) => ({ ...p, ready: false, teamId: null })),
      teams,
    ),
  };
}

/**
 * Banks the round on screen into history and moves the room to standings.
 *
 * Two things reach this now — the host's Standings button and everyone readying
 * up on the results screen — so it is a function rather than a branch of
 * `showStandings`. `party/server.ts` keys the archive write off the resulting
 * `scoring -> standings` transition rather than off either trigger, for the
 * same reason.
 *
 * Clearing `ready` is not optional: everyone is still flagged ready from the
 * results screen they just left, and `settle` would fire the next countdown
 * instantly, skipping the standings screen entirely.
 *
 * Clearing `entries` here is the single place the raw word store is emptied —
 * the round is banked into history and the words have already been shown, so
 * nothing reads it again.
 *
 * `results` is what both callers must pass through `withSelfStrikes` first: the
 * places banked into history are the ones the room was shown, self-validation
 * included. The marks themselves need no clearing — they live on the phase this
 * leaves behind.
 */
function bankRound(room: Room, results: Results): Room {
  const summary: RoundSummary = {
    category: room.category,
    places: placeRound(results),
  };
  return {
    ...room,
    phase: { name: "standings" },
    history: [...room.history, summary],
    entries: {},
    players: room.players.map((p) => ({ ...p, ready: false })),
  };
}

/**
 * Turns the writing window into a pool and a deal, and opens voting.
 *
 * **Both happen exactly once, here.** House cards do not exist before this
 * call, and the deal is solved in one shot rather than sampled per hand —
 * every card has to be shown to the same number of people or the vote is not
 * fair.
 *
 * No countdown on this edge: the transition between the two screens is an
 * animation, not a phase. See the design brief's §1c.
 */
function closeCreating(room: Room, now: number, roll = 0): Room {
  const quota = quotaOf(room);
  const playerIds = room.players.map((p) => p.id);
  const pool = buildPool(playerIds, room.drafts, quota, CATEGORIES, roll);
  return {
    ...room,
    phase: { name: "voting", endsAt: now + VOTING_MS },
    pool,
    deal: buildDeal(pool, playerIds, quota, roll),
    authorsRevealed: false,
    // `ready` means "votes spent" on the far side of this edge, so the flags
    // and the empty tally have to agree.
    players: unready(room.players),
    votes: {},
  };
}

/**
 * The pre-round <-> countdown edge is derived, not commanded: any event that
 * changes readiness re-evaluates it, so un-readying mid-countdown backs out
 * without needing its own case.
 *
 * Three phases can open a countdown now. The lobby opens one *to voting*;
 * voting and standings open one *to a round*.
 */
function settle(room: Room, now: number): Room {
  const phase = room.phase;

  if (phase.name === "lobby") {
    // A drawer open on the host TV holds this edge shut: without it, any
    // event at all — a join, a ready toggle — would fire it while the host is
    // still mid-adjustment.
    if (room.configuring) return room;
    if (!everyoneReady(room, MIN_PLAYERS)) return room;
    return teamsEnabled(room.settings)
      ? enterTeams(room)
      : openCountdown(room, now, afterLobby(room));
  }

  if (phase.name === "teams") {
    // `ready` here means "on a team" — joinTeam and leaveTeam own the flag,
    // the way castVote and resetVotes own it during voting.
    return everyoneReady(room, MIN_PLAYERS)
      ? openCountdown(room, now, afterLobby(room))
      : room;
  }

  if (phase.name === "creating") {
    // `ready` means "every slot committed" here — `commitDraft` and
    // `clearDraft` own the flag, the way `castVote` owns it during voting.
    // Which is why clearing a card tears the close down for free.
    return everyoneReady(room, MIN_PLAYERS) ? closeCreating(room, now) : room;
  }

  if (phase.name === "voting") {
    return everyoneReady(room, 1) ? openCountdown(room, now, "playing") : room;
  }

  if (phase.name === "scoring") {
    // The results screen is the one place `ready` means "seen enough" rather
    // than "waiting". It advances the room the host's Standings button does, so
    // a room that has finished reading does not sit waiting on the TV.
    return everyoneReady(room, MIN_PLAYERS)
      ? bankRound(room, withSelfStrikes(phase.results, phase.selfMarks))
      : room;
  }

  if (phase.name === "standings") {
    if (matchComplete(room)) return room;
    return everyoneReady(room, MIN_PLAYERS) ? openCountdown(room, now, "playing") : room;
  }

  if (phase.name === "countdown") {
    // The countdown from voting into round one is deliberately not
    // readiness-cancellable: everyoneReady needs MIN_PLAYERS, so after a host
    // solo-start this branch would tear the countdown down on the very next
    // event. Readiness has already done its job by the time voting closes.
    //
    // This guard covers only that one countdown. The other two — lobby into
    // voting, and a solo "Next round" at round two or later — have no such
    // guard, so a solo host start there is still torn down by any event
    // inside the 5-second window while fewer than MIN_PLAYERS are connected.
    // Pre-existing, not fixed here; noted so it isn't mistaken for handled.
    if (phase.to === "playing" && room.history.length === 0) return room;
    if (!everyoneReady(room, MIN_PLAYERS)) return { ...room, phase: backPhase(room) };
  }

  return room;
}

/**
 * Written as explicit branches rather than `{ name: preRoundPhase(room) }`
 * because TypeScript will not assign `{ name: "lobby" | "standings" }` to the
 * `Phase` union.
 */
function backPhase(room: Room): Room["phase"] {
  if (
    room.phase.name === "countdown" &&
    (room.phase.to === "voting" || room.phase.to === "creating") &&
    teamsEnabled(room.settings)
  ) {
    // Same derivation as `countdownScreen`: with teams on, a `to: "voting"` or
    // `to: "creating"` countdown can only have come out of team select —
    // `afterLobby` is what a teams-on room's Continue always heads through.
    return { name: "teams" };
  }
  return preRoundPhase(room) === "lobby" ? { name: "lobby" } : { name: "standings" };
}

/**
 * Where the three team actions are legal: team select itself, and the
 * countdown out of it. The countdown case is what lets a player cancel the
 * start by leaving their team — allowing a *switch* in the same window costs
 * nothing extra.
 *
 * `to === "creating"` joins `to === "voting"` here for the same reason it
 * joins it in `backPhase`: a custom match with teams on heads to the writing
 * window through team select exactly as a stock match heads to voting, so the
 * countdown that follows Continue is a team-select countdown either way.
 */
function inTeamSelect(room: Room): boolean {
  if (room.phase.name === "teams") return true;
  return (
    room.phase.name === "countdown" &&
    (room.phase.to === "voting" || room.phase.to === "creating") &&
    teamsEnabled(room.settings)
  );
}

const unready = (players: Player[]): Player[] =>
  players.map((p) => ({ ...p, ready: false }));

/**
 * The phases the debug menu's hold and skip apply to: the ones that run a
 * deadline the room can still be *deciding* against. Written as a predicate so
 * both events agree on the list and tsc narrows `endsAt` for them.
 */
function isHoldable(
  phase: Room["phase"],
): phase is Extract<Room["phase"], { name: "playing" | "voting" | "creating" }> {
  return phase.name === "playing" || phase.name === "voting" || phase.name === "creating";
}

/**
 * Stands the teams up as team select would have left them: the teams exist and
 * everybody is on one.
 *
 * Everything downstream of team select assumes that, and gets it for free
 * because the only way past team select is through it. A **jump skips that
 * edge**, so a team match dropped straight into a round would otherwise reach
 * `rosterOf` with no teams — and `rosterOf` drops empty ones, so the round
 * would have no scorers at all and the results screen nothing to show.
 *
 * A no-op with teams off, which is why every jump past the lobby can call it
 * unconditionally.
 */
function standUpTeams(room: Room): Room {
  if (!teamsEnabled(room.settings)) return room;
  const teams =
    room.teams.length === room.settings.teamCount
      ? room.teams
      : makeTeams(room.settings.teamCount);
  return { ...room, teams, players: assignStragglers(room.players, teams) };
}

/**
 * Puts the room on the named screen, standing up whatever that screen needs.
 *
 * **A jump is not a transition.** It does not reset the match: history, votes
 * and settings survive, because the point is to look at one screen without
 * losing the state that makes it interesting. What it does do is satisfy each
 * view's own preconditions, since it arrives from anywhere and cannot rely on
 * the edge that normally leads there.
 *
 * Two of those preconditions are load-bearing rather than cosmetic:
 *
 * - **Readiness is cleared for every untimed target** — lobby, team select,
 *   voting, results, standings. Left as it was, the very next event would
 *   `settle` straight back out of the screen the jump just asked for.
 * - **Readiness is *forced* for the countdowns**, and `reduce` skips `settle`
 *   for this event entirely, exactly as it does for `startGame`. `settle`'s
 *   countdown branch tears one down below MIN_PLAYERS, so without both a
 *   countdown jumped to on a quiet room would revert on the next message.
 *
 * The words are not this function's business: `scoring` and `standings` are
 * made of a round that has been typed, and standing that up means writing
 * `entries`, which `reduce` deliberately does not own. `party/server.ts` deals
 * the lists first and then jumps here. See `jumpToView`.
 */
function jumpTo(room: Room, to: ViewId, now: number, roll: number): Room {
  // Cleared on every jump. A held round's `endsAt` is stale by design, so
  // carrying the hold into a phase whose timer nothing can resume would freeze
  // the room with no visible cause.
  const base: Room = { ...room, paused: null };

  switch (to) {
    case "lobby":
      return { ...base, phase: { name: "lobby" }, players: unready(base.players) };

    case "teams": {
      // Team select does not exist with teams off, so asking for it turns them
      // on. A jump is allowed to move a setting — that is what separates it
      // from a request, which `setSettings` would refuse outside the lobby.
      const settings = teamsEnabled(base.settings)
        ? base.settings
        : { ...base.settings, teamCount: MIN_TEAM_COUNT };
      // `teams: []` forces a rebuild rather than keeping the panels: a jump to
      // team select is a fresh one, and the names typed on the last pass belong
      // to it. `enterTeams` also clears readiness and membership, which is what
      // keeps `settle` from closing team select the instant it opens.
      return enterTeams({ ...base, settings, teams: [] });
    }

    case "countdownToCreating":
    case "countdownToVoting":
    case "countdownToPlaying": {
      const staged = standUpTeams(base);
      return {
        ...staged,
        // Forced, not cleared — see the note above.
        players: staged.players.map((p) => ({ ...p, ready: true })),
        phase: {
          name: "countdown",
          endsAt: now + COUNTDOWN_MS,
          to:
            to === "countdownToCreating"
              ? "creating"
              : to === "countdownToVoting"
                ? "voting"
                : "playing",
        },
      };
    }

    case "creating": {
      const staged = standUpTeams(base);
      return {
        ...staged,
        phase: { name: "creating", endsAt: now + WRITE_MS },
        players: unready(staged.players),
        drafts: {},
        cursors: {},
        pool: null,
        deal: {},
        authorsRevealed: false,
      };
    }

    case "voting": {
      const staged = standUpTeams(base);
      return {
        ...staged,
        phase: { name: "voting", endsAt: now + VOTING_MS },
        players: unready(staged.players),
        // `ready` means "votes spent" on this side of the edge, so the tally has
        // to start empty or the cleared flags disagree with the votes behind
        // them. The same pairing the `countdown -> voting` tick makes.
        votes: {},
      };
    }

    case "playing": {
      const staged = standUpTeams(base);
      return {
        ...staged,
        // Drawn here for the same reason the whistle draws it: `playing` is the
        // first screen that shows the category, so it is the first that needs
        // one. Weighted by whatever votes the room has, uniform when it has none.
        category: pickCategory(staged.votes, spentCategories(staged), roll),
        phase: { name: "playing", endsAt: now + staged.settings.durationSec * 1_000 },
        // A round starts empty. This is also what makes jumping to `playing`
        // the way to re-run a round from the top, rather than resuming into a
        // list somebody already filled.
        entries: {},
      };
    }

    case "timesup":
      // Entries survive: this is the end of a round, and the scoring screen it
      // falls into three seconds later is made of them.
      return {
        ...standUpTeams(base),
        phase: { name: "timesup", endsAt: now + TIMESUP_MS },
      };

    case "scoring": {
      const staged = standUpTeams(base);
      return {
        ...staged,
        phase: {
          name: "scoring",
          // Re-scored from `entries` rather than carried over from a `scoring`
          // phase already on screen, so a refresh picks up any word dealt since
          // — and so the reveal's schedule is rebuilt from the same input the
          // real transition builds it from.
          results: scoreRound({ scorers: rosterOf(staged), entries: staged.entries }),
          startedAt: now,
          skipped: false,
          // A refresh is a fresh reveal, and the marks belonged to the last one.
          selfMarks: NO_SELF_MARKS,
        },
        players: unready(staged.players),
      };
    }

    case "standings": {
      const staged = standUpTeams(base);
      // Arriving from the results screen banks the round on it, exactly as the
      // host's Standings button does — so the round the room was just shown
      // lands in history and earns its badge, rather than being dropped on the
      // way to the screen that would have displayed it.
      if (staged.phase.name === "scoring") {
        return bankRound(
          staged,
          withSelfStrikes(staged.phase.results, staged.phase.selfMarks),
        );
      }
      return { ...staged, phase: { name: "standings" }, players: unready(staged.players) };
    }
  }
}

export function reduce(room: Room, ev: RoomEvent): Room {
  const next = apply(room, ev);
  if (next === room) return room;
  const withTime = { ...next, lastActivityAt: ev.now };
  // `startGame` already decided the countdown transition itself, overriding
  // MIN_PLAYERS as a deliberate host action. Running it back through
  // `settle`'s everyoneReady gate would immediately revert a solo start.
  //
  // `debugJump` is skipped for the same reason and one more: it has just built
  // the exact phase it was asked for, and `settle` exists to derive a phase
  // from readiness. Every countdown it can land on would be torn straight back
  // down on a room below MIN_PLAYERS, which is most rooms a jump is used on.
  return ev.t === "startGame" || ev.t === "debugJump" ? withTime : settle(withTime, ev.now);
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
      // Bots do not count against the cap. Twenty of them fit on purpose, and
      // a room dressed for a screenshot must not be a room real phones are
      // locked out of.
      if (room.players.filter(isHuman).length >= MAX_PLAYERS) return room;
      return {
        ...room,
        players: [...room.players, {
          id: ev.playerId, name: ev.name, emoji: ev.emoji,
          ready: false, connected: true, teamId: null,
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
        room.phase.name !== "standings" &&
        // Readying on the results screen is what advances it to standings with
        // no host action — see `settle`. Unlike `teams` and `voting`, nothing
        // else here derives the flag, so the plain event owns it.
        room.phase.name !== "scoring"
      ) {
        return room;
      }
      return {
        ...room,
        players: mapPlayer(room.players, ev.playerId, (p) => ({ ...p, ready: ev.ready })),
      };

    case "startGame": {
      if (ev.playerId !== room.hostId) return room;
      // Needs its own guard: `reduce` deliberately skips `settle` for
      // `startGame`, so a countdown opened here would survive the hold.
      if (room.configuring) return room;
      // Legal from the room, from team select, from voting, and from
      // standings between rounds. It always means the same thing: force-ready
      // everyone and move on. Only the destination differs.
      const from = room.phase.name;
      if (from !== "lobby" && from !== "teams" && from !== "voting" && from !== "standings") {
        return room;
      }
      if (from === "standings" && matchComplete(room)) return room;
      // A deliberate host override: unlike the natural everyoneReady path,
      // this can start with just one connected player.
      if (room.players.filter((p) => p.connected).length < 1) return room;
      // From the lobby with teams on, Start means "open team select", not
      // "start the match" — and readiness is cleared, not set, because on the
      // far side of that edge `ready` means "has a team".
      if (from === "lobby" && teamsEnabled(room.settings)) return enterTeams(room);
      // Continue out of team select assigns the stragglers *now* rather than
      // leaving them teamless behind a force-ready that is not true yet.
      // `ready` in this phase means "on a team", and the countdown it opens is
      // still fully cancellable: anyone — including someone just placed here —
      // can leave their team, which clears the flag and has `settle` drop the
      // room back into team select. Assigning here is what gives an auto-placed
      // player something to leave.
      if (from === "teams") {
        return {
          ...room,
          players: assignStragglers(room.players, room.teams).map((p) => ({
            ...p, ready: true,
          })),
          phase: { name: "countdown", endsAt: ev.now + COUNTDOWN_MS, to: afterLobby(room) },
        };
      }
      return {
        ...room,
        players: room.players.map((p) => ({ ...p, ready: true })),
        phase: {
          name: "countdown",
          endsAt: ev.now + COUNTDOWN_MS,
          // Only `lobby` (with teams off — the teams-on lobby returned above)
          // heads for writing or voting; `voting` and `standings` head for a
          // round.
          to: from === "lobby" ? afterLobby(room) : "playing",
        },
      };
    }

    case "cancelStart": {
      if (ev.playerId !== room.hostId) return room;
      if (room.phase.name !== "countdown") return room;
      // Cancelling clears everyone's readiness so `settle` cannot re-open the
      // countdown. Landing back in `teams` that would wedge the room: every
      // player is still on a team, and nothing they can do would set `ready`
      // again short of leaving and rejoining. Leaving a team is already the
      // cancel here, so the host screen offers no Stop button either.
      if (backPhase(room).name === "teams") return room;
      const back = backPhase(room);
      // Resets everyone's readiness rather than leaving it as-is: it was
      // solo-start's `startGame` that force-readied everyone, and leaving
      // that in place would have `settle` immediately re-open the countdown
      // this cancel is meant to stop.
      return {
        ...room,
        phase: back,
        players: room.players.map((p) => ({ ...p, ready: false })),
        // Abandoning back to the room abandons the match, and the votes
        // belonged to a match that no longer exists.
        votes: back.name === "lobby" ? {} : room.votes,
      };
    }

    case "kick": {
      if (ev.playerId !== room.hostId) return room;
      const { [ev.targetId]: _removed, ...entries } = room.entries;
      // A kicked player's stacked votes must not keep weighting the draw for a
      // round they can no longer play in.
      const { [ev.targetId]: _removedVotes, ...votes } = room.votes;
      // Removing the player is not enough on its own: their socket
      // auto-reconnects and the lobby would re-admit them as a newcomer. The
      // ban is what makes a kick stick, so it outlives the round —
      // `backToLobby` deliberately does not clear it.
      return {
        ...room,
        players: room.players.filter((p) => p.id !== ev.targetId),
        entries,
        votes,
        kicked: room.kicked.includes(ev.targetId)
          ? room.kicked
          : [...room.kicked, ev.targetId],
      };
    }

    case "leaveRoom": {
      // Lobby only, countdown included — that is the one screen the button is
      // on, and the countdown renders it. Walking out mid-match would leave a
      // half-scored round and a standings table with a hole in it; a player
      // who wants out of one closes the tab, which is the disconnect path.
      if (room.phase.name !== "lobby" && room.phase.name !== "countdown") return room;
      if (!room.players.some((p) => p.id === ev.playerId)) return room;
      const { [ev.playerId]: _removed, ...entries } = room.entries;
      const { [ev.playerId]: _removedVotes, ...votes } = room.votes;
      // No `kicked` entry: the ban is what makes a *kick* stick against the
      // socket's own reconnect. This player is closing their socket on
      // purpose, and coming back through Landing has to seat them again.
      return {
        ...room,
        players: room.players.filter((p) => p.id !== ev.playerId),
        entries,
        votes,
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
        // A host whose phone locks with a drawer open would otherwise hold the
        // countdown down for everyone until that reap fires.
        configuring: ev.playerId === room.hostId ? false : room.configuring,
      };

    case "setSettings": {
      if (ev.playerId !== room.hostId) return room;
      // Locked once the match starts: changing the round count mid-match
      // would move the finish line under the players.
      if (room.phase.name !== "lobby") return room;
      const settings = applySettings(room.settings, ev.values, ev.choices);
      return settings === room.settings ? room : { ...room, settings };
    }

    case "setMode": {
      if (ev.playerId !== room.hostId) return room;
      if (room.phase.name !== "lobby") return room;
      if (!isGameModeId(ev.mode)) return room;
      if (ev.mode === room.settings.mode) return room;
      return { ...room, settings: clampToMode({ ...room.settings, mode: ev.mode }) };
    }

    case "setConfiguring": {
      if (ev.playerId !== room.hostId) return room;
      if (ev.open === room.configuring) return room;
      // A hold, not a cancel. Readiness is deliberately left untouched, which
      // is the whole mechanism: closing the drawer lets the normal `settle`
      // tail derive a brand-new countdown with no host action and no stored
      // remaining-ms. `cancelStart` clears readiness for the opposite reason —
      // it wants the countdown to stay down.
      // Drawers only ever open on the host *lobby*, so this only ever drops a
      // lobby countdown. The guard stops a hand-rolled message from dropping a
      // teams countdown into a phase whose readiness it cannot restore.
      const phase =
        ev.open &&
        room.phase.name === "countdown" &&
        backPhase(room).name === "lobby"
          ? backPhase(room)
          : room.phase;
      return { ...room, configuring: ev.open, phase };
    }

    case "castVote": {
      if (room.phase.name !== "voting") return room;
      // A hand-rolled socket message is not bound by the UI, so the ballot and
      // the budget are both checked here rather than trusted. The *ballot*,
      // not the pool: `random` is votable but is not a category.
      if (!(BALLOT as readonly string[]).includes(ev.category)) return room;
      if (!room.players.some((p) => p.id === ev.playerId)) return room;
      const budget = voteBudget(room.settings);
      const row = room.votes[ev.playerId] ?? {};
      const spent = votesSpent(row);
      if (spent >= budget) return room;
      return {
        ...room,
        votes: {
          ...room.votes,
          [ev.playerId]: { ...row, [ev.category]: (row[ev.category] ?? 0) + 1 },
        },
        // Ready is derived from the budget, never a button — spending the last
        // vote is what readies you, and that is what `settle` closes voting on.
        players: mapPlayer(room.players, ev.playerId, (p) => ({
          ...p, ready: spent + 1 >= budget,
        })),
      };
    }

    case "resetVotes": {
      if (room.phase.name !== "voting") return room;
      if (!room.players.some((p) => p.id === ev.playerId)) return room;
      if (!room.votes[ev.playerId]) return room;
      const { [ev.playerId]: _cleared, ...votes } = room.votes;
      return {
        ...room,
        votes,
        players: mapPlayer(room.players, ev.playerId, (p) => ({ ...p, ready: false })),
      };
    }

    case "joinTeam": {
      if (!inTeamSelect(room)) return room;
      if (!room.teams.some((t) => t.id === ev.teamId)) return room;
      const me = room.players.find((p) => p.id === ev.playerId);
      if (!me || me.teamId === ev.teamId) return room;
      // `ready` is derived from membership and set only here and in
      // leaveTeam — the `ready` event is rejected in this phase, exactly as
      // castVote and resetVotes own the flag during voting.
      const players = mapPlayer(room.players, ev.playerId, (p) => ({
        ...p, teamId: ev.teamId, ready: true,
      }));
      // A *switch* mid-countdown puts the full five seconds back on the clock.
      // Leaving a team already stops the count dead — it clears `ready` and
      // `settle` drops the room back into team select — but switching keeps
      // the flag set, so without this someone changing their mind on the last
      // second is carried into voting on a team they have just left, with no
      // time for anyone to react to the move. `inTeamSelect` has already
      // established that this countdown is the one out of team select.
      return room.phase.name === "countdown"
        ? { ...room, players, phase: { ...room.phase, endsAt: ev.now + COUNTDOWN_MS } }
        : { ...room, players };
    }

    case "leaveTeam": {
      if (!inTeamSelect(room)) return room;
      const me = room.players.find((p) => p.id === ev.playerId);
      if (!me || me.teamId === null) return room;
      // Clearing `ready` is what makes `settle` tear the countdown back down.
      // Leaving is the unready; there is no separate button for it.
      return {
        ...room,
        players: mapPlayer(room.players, ev.playerId, (p) => ({
          ...p, teamId: null, ready: false,
        })),
      };
    }

    case "setTeamName": {
      if (!inTeamSelect(room)) return room;
      const team = room.teams.find((t) => t.id === ev.teamId);
      if (!team) return room;
      // Members only. Last write wins — a rename race between two teammates
      // is not worth a lock in a party game.
      const me = room.players.find((p) => p.id === ev.playerId);
      if (!me || me.teamId !== ev.teamId) return room;
      const trimmed = ev.name.trim().slice(0, MAX_TEAM_NAME_LEN);
      const name = trimmed === "" ? TEAM_COLORS[team.colorIndex].name : trimmed;
      if (name === team.name) return room;
      // `colorIndex` is deliberately untouched: renaming must never recolour.
      return {
        ...room,
        teams: room.teams.map((t) => (t.id === ev.teamId ? { ...t, name } : t)),
      };
    }

    case "balanceTeams": {
      if (ev.playerId !== room.hostId) return room;
      if (!inTeamSelect(room)) return room;
      const players = balanceTeams(room.players, room.teams, ev.roll);
      if (players === room.players) return room;
      // A player moved onto a team the same way joinTeam would ready them;
      // a player already on a team just changes colour and stays ready.
      //
      // Sorting *during the countdown* therefore does not stop it, and should
      // not: everyone still has a team, which is all `ready` means here, and
      // anyone unhappy with where they landed can leave — which is the brake,
      // exactly as it is for a switch.
      return {
        ...room,
        players: players.map((p) => (p.teamId !== null ? { ...p, ready: true } : p)),
      };
    }

    case "moveCursor": {
      if (room.phase.name !== "creating") return room;
      const quota = quotaOf(room);
      if (!Number.isInteger(ev.slot) || ev.slot < 0 || ev.slot >= quota) return room;
      if (room.cursors[ev.playerId] === ev.slot) return room;
      return { ...room, cursors: { ...room.cursors, [ev.playerId]: ev.slot } };
    }

    case "commitDraft": {
      if (room.phase.name !== "creating") return room;
      return writeSlot(room, ev.playerId, ev.slot, ev.text);
    }

    case "clearDraft": {
      if (room.phase.name !== "creating") return room;
      // Goes through the same path a commit does, so un-readying is the same
      // one rule rather than a second copy of it — and `settle` then tears
      // down any close this player's readiness was holding open.
      return writeSlot(room, ev.playerId, ev.slot, "");
    }

    case "showStandings": {
      if (ev.playerId !== room.hostId) return room;
      if (room.phase.name !== "scoring") return room;
      return bankRound(
        room,
        withSelfStrikes(room.phase.results, room.phase.selfMarks),
      );
    }

    /**
     * Lands every outstanding strike at once, on the TV and on the phones
     * together. Sets a flag rather than jumping a stored line count, because
     * there is no stored line count to jump — the reveal is derived from
     * `startedAt`, and this is the one thing that derivation cannot know.
     */
    case "fastForward": {
      if (ev.playerId !== room.hostId) return room;
      if (room.phase.name !== "scoring") return room;
      if (room.phase.skipped) return room;
      return { ...room, phase: { ...room.phase, skipped: true } };
    }

    /**
     * Self-validation: a scorer disowning one of their own words, or taking it
     * back. Not host-only — it is the *player's* judgement on the player's own
     * list, and in team play any member may mark the list the team shares.
     *
     * A duplicate is refused rather than toggled. It is already struck by the
     * round's own rule, so striking it would change nothing and restoring it
     * would award back a point nobody had — which is why the phones render those
     * rows inert, and why that is not the boundary.
     */
    case "selfStrike": {
      if (room.phase.name !== "scoring") return room;
      const scorer = room.phase.results.scorers.find((s) =>
        s.members.includes(ev.playerId),
      );
      if (!scorer) return room;
      const entry = scorer.entries[ev.index];
      if (entry === undefined) return room;
      if (entry.alsoBy.length > 0) return room;
      const marks = toggleMark(
        room.phase.selfMarks,
        rowKey(scorer.id, ev.index),
        ev.struck,
        ev.now,
      );
      // `toggleMark` hands back the identical object when the row is already
      // the way it was asked for — the no-op contract, not an optimisation.
      if (marks === room.phase.selfMarks) return room;
      return { ...room, phase: { ...room.phase, selfMarks: marks } };
    }

    case "backToLobby": {
      if (ev.playerId !== room.hostId) return room;
      // The round-1 countdown out of voting renders the same `HostVoting`
      // closed reveal with its exit button still on screen (`countdownScreen`
      // gives it the "voting" screen), so the button has to work there too —
      // round 2+'s post-standings countdown does not qualify, since that one
      // renders `HostStandings` with no exit button at all.
      const postVotingCountdown =
        room.phase.name === "countdown" &&
        room.phase.to === "playing" &&
        room.history.length === 0;
      // `inTeamSelect` rather than a bare `=== "teams"`: the host's Back button
      // stays on screen through the countdown out of team select, so it has to
      // work there too. `creating` joins the list for the same reason
      // `voting` is on it: both are one step out from the lobby, not the
      // match's start.
      if (
        room.phase.name !== "standings" &&
        room.phase.name !== "voting" &&
        room.phase.name !== "creating" &&
        !postVotingCountdown &&
        !inTeamSelect(room)
      ) {
        return room;
      }
      // With teams on, Back out of voting, the writing window, or the
      // countdown right after voting is one step, not all the way home: the
      // room returns to team selection. The teams themselves survive —
      // `enterTeams` keeps them when the count still matches — but nobody is
      // on one, which is also what stops `settle` closing team select again
      // the instant it opens. The votes go: they belonged to the voting round
      // being abandoned, and a stale tally must not sit under the team
      // screen. `drafts`/`cursors`/`pool`/`deal` go for the same reason —
      // whatever was written or drawn belonged to the match being abandoned.
      if (
        (room.phase.name === "voting" || room.phase.name === "creating" || postVotingCountdown) &&
        teamsEnabled(room.settings)
      ) {
        return {
          ...enterTeams(room),
          votes: {},
          drafts: {},
          cursors: {},
          pool: null,
          deal: {},
        };
      }
      // Settings survive — the host usually wants the same match again — and
      // so does `kicked`, which is durable for the room's lifetime. The votes
      // and the teams do not: both belonged to the match being abandoned, and
      // the next one rebuilds teams from whatever `teamCount` is by then. Nor
      // does anything written for it — `drafts`/`cursors`/`pool`/`deal` reset
      // the same way for a custom match that never gets replayed as one.
      return {
        ...room,
        phase: { name: "lobby" },
        players: room.players.map((p) => ({ ...p, ready: false, teamId: null })),
        entries: {},
        history: [],
        votes: {},
        teams: [],
        drafts: {},
        cursors: {},
        pool: null,
        deal: {},
      };
    }

    /**
     * Holds the round — or the vote — where it stands, or lets it go again.
     *
     * Pausing banks the time left; resuming spends it forward from `now`, so
     * an hour spent paused costs the phase nothing.
     *
     * `playing` and `voting`, and nothing else. Those are the two phases with a
     * deadline long enough that a room can be mid-*decision* when it expires,
     * which is the thing worth holding. The countdown and `timesup` are short
     * fixed-length screens on their way somewhere; pausing one buys nothing
     * worth the extra states to reason about.
     */
    case "debugPause": {
      if (ev.playerId !== room.hostId) return room;
      if (!isHoldable(room.phase)) return room;
      if (ev.paused) {
        // Already held — returning a fresh object here would re-bank a
        // shorter remainder every time the button was pressed.
        if (room.paused !== null) return room;
        return { ...room, paused: Math.max(0, room.phase.endsAt - ev.now) };
      }
      if (room.paused === null) return room;
      return {
        ...room,
        phase: { ...room.phase, endsAt: ev.now + room.paused },
        paused: null,
      };
    }

    /**
     * Ends the phase now by moving its deadline to the present rather than
     * transitioning here. The alarm re-arms on persist, `tick` fires, and the
     * phase ends down the exact path a natural expiry takes — so scoring, the
     * archive write and the standings hand-off cannot drift from the real one,
     * and a skipped vote closes into the same countdown the deadline opens.
     *
     * Clears `paused` because a held phase has a stale `endsAt`, and skipping
     * without this would resume it instead of ending it.
     */
    case "debugSkip": {
      if (ev.playerId !== room.hostId) return room;
      if (!isHoldable(room.phase)) return room;
      if (room.paused === null && room.phase.endsAt <= ev.now) return room;
      return { ...room, phase: { ...room.phase, endsAt: ev.now }, paused: null };
    }

    /**
     * Puts the room on any screen at all, from any screen at all.
     *
     * Host-only, like its two siblings, and enforced here rather than only in
     * the panel — this moves every phone in the room, not just the TV.
     *
     * Unlike them it is **not** restricted to `playing`: "jump to a view" with a
     * legal-phase list would be a jumper that could not reach most of what it
     * lists. The phase it lands on is built by `jumpTo`.
     *
     * `viewNonce` is bumped unconditionally, and that is what makes a jump to
     * the view the room is already on — the refresh button — a real change
     * rather than a no-op returning the identical object. See `Room.viewNonce`.
     */
    case "debugJump": {
      if (ev.playerId !== room.hostId) return room;
      return {
        ...jumpTo(room, ev.to, ev.now, ev.roll),
        viewNonce: room.viewNonce + 1,
      };
    }

    /**
     * Dresses the room with placeholder players, or clears them away.
     *
     * Host-only and enforced here, like its siblings. Legal from every phase,
     * because "see what this screen looks like with six players on it" is the
     * entire point and most of those screens are not the lobby.
     *
     * Deliberately *not* exempt from `settle`: bots are inert by construction
     * (`isWaiting`, and excluded from the readiness floor), so there is no
     * countdown for `settle` to open or tear down on their account, and no
     * reason to make this the third special case.
     *
     * A bot on a live results screen is scenery arriving late: `phase.results`
     * was computed when the phase opened and is not recomputed here. Refreshing
     * the view (`debugJump`) is what re-scores the room as it now stands.
     */
    case "debugBots": {
      if (ev.playerId !== room.hostId) return room;
      const players = setBotCount(room.players, ev.count);
      if (players === room.players) return room;
      // Bots trimmed away take their words with them, exactly as a kick does —
      // `scoreRound` clusters by scorer, and a departed bot's list would
      // otherwise keep striking through the words of players still on screen.
      const live = new Set(players.map((p) => p.id));
      const entries = Object.fromEntries(
        Object.entries(room.entries).filter(([id]) => live.has(id)),
      );
      return { ...room, players: seatBots(players, room.teams), entries };
    }

    case "tick":
      return tick(room, ev.now, ev.roll);
  }
}

/**
 * Deadlines are absolute, so a late alarm still lands in the right phase —
 * `now >= endsAt` rather than an equality check.
 */
function tick(room: Room, now: number, roll: number): Room {
  // A held round's `endsAt` is stale by design, so every deadline comparison
  // below would read as long overdue and end the round the first time an
  // alarm fired. Returning the identical object is the "no change" contract
  // `alarmOutcome` and `party/server.ts` both rely on.
  if (room.paused !== null) return room;
  const phase = room.phase;
  if (phase.name === "countdown" && now >= phase.endsAt) {
    if (phase.to === "voting" || phase.to === "creating") {
      return {
        ...room,
        phase:
          phase.to === "creating"
            ? { name: "creating", endsAt: now + WRITE_MS }
            : { name: "voting", endsAt: now + VOTING_MS },
        // Load-bearing, not housekeeping: `ready` means "has a team" on this
        // side of the edge and "votes spent" (or "every slot committed") on
        // the other.
        //
        // The backstop for auto-assignment. The host's Continue already places
        // every straggler, and leaving a team tears the countdown down rather
        // than reaching this tick — but readiness counts only *connected*
        // players, so someone whose phone died in team select can still arrive
        // here without a team.
        players: assignStragglers(room.players, room.teams).map((p) => ({
          ...p, ready: false,
        })),
        votes: {},
        // A fresh writing window starts with nothing written; a fresh voting
        // window has no drafts to carry, so this is a no-op on that edge.
        drafts: phase.to === "creating" ? {} : room.drafts,
        cursors: phase.to === "creating" ? {} : room.cursors,
      };
    }
    return {
      ...room,
      // Drawn here and nowhere else. Doing it at the whistle rather than when
      // the countdown opens means there is no window in which a cancelled
      // countdown could re-roll it, and nothing on the countdown screen can
      // leak it.
      category: pickCategory(room.votes, spentCategories(room), roll),
      phase: { name: "playing", endsAt: now + room.settings.durationSec * 1_000 },
    };
  }
  if (phase.name === "creating" && now >= phase.endsAt) {
    return closeCreating(room, now, roll);
  }
  if (phase.name === "voting" && now >= phase.endsAt) {
    // The global deadline closes voting into the same countdown the other two
    // triggers open, so a round always starts the same way.
    return { ...room, phase: { name: "countdown", endsAt: now + COUNTDOWN_MS, to: "playing" } };
  }
  if (phase.name === "playing" && now >= phase.endsAt) {
    return { ...room, phase: { name: "timesup", endsAt: now + TIMESUP_MS } };
  }
  if (phase.name === "timesup" && now >= phase.endsAt) {
    return {
      ...room,
      phase: {
        name: "scoring",
        results: scoreRound({ scorers: rosterOf(room), entries: room.entries }),
        // The reveal's zero. Every client counts its own lines from here.
        startedAt: now,
        skipped: false,
        selfMarks: NO_SELF_MARKS,
      },
      // Load-bearing, exactly as the clear at the voting edge is: `ready` means
      // "typing this round" on this side of the edge and "seen enough of the
      // results" on the other. Carried across, `settle` would bank the round
      // and skip the whole reveal before anyone had read a word of it.
      players: room.players.map((p) => ({ ...p, ready: false })),
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

  // The list this entry competes against is the *scorer's*, not the player's:
  // with teams on that is the whole team's merged list, so a word a teammate
  // already wrote is a duplicate and MAX_ENTRIES is a per-team cap. Storage is
  // unchanged — the entry still goes under its own author's key.
  const scorer = rosterOf(room).find((s) => s.members.includes(playerId));
  const own = (scorer?.members ?? [playerId]).flatMap((id) => room.entries[id] ?? []);
  if (own.length >= MAX_ENTRIES) return { room, accepted: false, reason: "limit" };
  if (own.some((e) => normalize(e.text) === norm)) {
    return { room, accepted: false, reason: "duplicate" };
  }

  const mine = room.entries[playerId] ?? [];
  const entry: Entry = { text: trimmed, at: now, by: playerId };
  return {
    room: {
      ...room,
      entries: { ...room.entries, [playerId]: [...mine, entry] },
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
  // A held round has no deadline to wake for, so the alarm falls back to its
  // other job. That is deliberately the ordinary idle horizon rather than a
  // longer paused-specific one: `alarmOutcome` answers a stale room with
  // `touch` while anyone is still connected, so a paused game is kept alive by
  // the people in it and reaped like any other once they all leave. A room
  // paused and abandoned should not outlive one that was simply abandoned.
  //
  // The `paused` check sits inside the condition rather than in a named
  // boolean above it, because tsc only narrows `phase` through the test it
  // can see here.
  const base =
    room.paused === null &&
    (phase.name === "countdown" ||
      phase.name === "voting" ||
      phase.name === "playing" ||
      phase.name === "timesup")
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
  /** Uniform [0,1) for the category draw — see the tick event. */
  roll: number,
): AlarmOutcome {
  // Outranks the phase deadline below — the one case that legitimately does.
  // A round with no host behind it has nothing to advance *to*: nobody can
  // start the next one, so finishing this one only strands the players on a
  // results screen that never moves.
  if (room.hostGoneAt !== null && now >= room.hostGoneAt + HOST_GRACE_MS) {
    return { action: "reap", reason: "host-left" };
  }

  const next = reduce(room, { t: "tick", now, roll });
  if (next !== room) return { action: "advance", room: next };

  if (now < room.lastActivityAt + IDLE_REAP_MS) return { action: "rearm" };

  // `lastActivityAt` only moves on state-changing events, so a host sitting in
  // an empty lobby — nobody has joined, nothing to react to — looks exactly
  // like an abandoned room. A live connection means someone is actually still
  // here; bump the clock and let them be.
  if (hasConnections) return { action: "touch", room: { ...room, lastActivityAt: now } };

  return { action: "reap", reason: "expired" };
}
