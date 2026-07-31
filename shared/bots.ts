/**
 * Placeholder players for the debug menu — scenery, not opponents.
 *
 * A bot occupies a seat and renders on every screen a player renders on, and
 * that is the whole feature: it exists so one developer at one laptop can see
 * what the lobby, the team panels, the reveal grid and the podium look like
 * with eight players in the room. Nothing here plays: a bot never types, never
 * votes, and never readies up.
 *
 * The one rule that keeps them harmless is `isWaiting` below — a bot neither
 * blocks a room nor makes one startable. Adding scenery must not change whether
 * a real match can begin.
 *
 * Not game logic, and nothing in the game imports it — the same standing as
 * `shared/archive.ts` and `shared/usage.ts`. It lives in `shared/` because
 * `reduce` needs it and because purity makes it testable under the existing
 * vitest glob.
 */
import type { Player, PlayerId } from "./state";
import type { Team } from "./teams";
import { assignStragglers } from "./teams";

/**
 * Deliberately double MAX_PLAYERS. Twenty seats is past anything a real room
 * can reach, which is the point: the layouts that break under crowding are the
 * ones worth being able to look at on purpose.
 */
export const MAX_BOTS = 20;

/**
 * Fixed and append-only, so the same count always deals the same fellowship
 * and a screenshot is reproducible. Emoji are all drawn from the client's own
 * AVATARS list (`src/components/AvatarPicker.tsx`) so a bot is indistinguishable
 * from a player who picked well; they are duplicated rather than imported
 * because `shared/` must not reach into `src/` — the Worker compiles `shared/`
 * under its own tsconfig and would drag the DOM in with it.
 */
export const BOT_ROSTER = [
  { name: "Frodo", emoji: "💎" },
  { name: "Sam", emoji: "🌻" },
  { name: "Gandalf", emoji: "🎩" },
  { name: "Aragorn", emoji: "👑" },
  { name: "Legolas", emoji: "🍀" },
  { name: "Gimli", emoji: "🥁" },
  { name: "Merry", emoji: "🍄" },
  { name: "Pippin", emoji: "🍕" },
  { name: "Boromir", emoji: "🔥" },
  { name: "Gollum", emoji: "🐊" },
  { name: "Galadriel", emoji: "⭐" },
  { name: "Elrond", emoji: "🌈" },
  { name: "Arwen", emoji: "🌙" },
  { name: "Éowyn", emoji: "🦄" },
  { name: "Éomer", emoji: "🐝" },
  { name: "Théoden", emoji: "🦉" },
  { name: "Treebeard", emoji: "🌵" },
  { name: "Bilbo", emoji: "🥑" },
  { name: "Saruman", emoji: "👻" },
  { name: "Sauron", emoji: "👾" },
] as const;

/**
 * Index-derived, so setting the count twice reuses the same seats rather than
 * dealing new ones — and so a bot's id is recognisable in a JSON dump. The
 * prefix cannot collide with a real `playerId`, which is a UUID.
 */
export const botId = (index: number): PlayerId => `bot:${index}`;

export const isBot = (player: Player): boolean => player.isBot === true;
export const isHuman = (player: Player): boolean => !isBot(player);

/**
 * Whether a player is not the one everybody is waiting on.
 *
 * Bots are always waiting, and are never counted toward the floor on how many
 * players it takes to be a room (see `everyoneReady` in `shared/reduce.ts`).
 * The pair is what makes them inert: a bot cannot hold a countdown down, and a
 * room full of bots and one human still cannot start naturally. Every "n of m
 * ready" readout on a screen uses this too, so a bot never reads as the
 * holdout on the TV.
 */
export const isWaiting = (player: Player): boolean => player.ready || isBot(player);

export const botCount = (players: Player[]): number => players.filter(isBot).length;

/**
 * Sets every bot's `ready` flag, leaving the humans exactly as they are.
 *
 * Called at the standings edge, and only there. Everywhere else a bot's flag
 * stays honestly false and `isWaiting` does the excusing — but the standings
 * board draws a marker per row rather than a tally, and a bot sitting under a
 * blank marker is the room being told it is waiting on a thing that never
 * readies. Nothing about the rules moves: `isWaiting` was already true for a
 * bot, so no countdown opens or closes because of this.
 *
 * Returns the identical array when there are no bots, per the no-op rule.
 */
export function readyBots(players: Player[]): Player[] {
  if (!players.some(isBot)) return players;
  return players.map((p) => (isBot(p) ? { ...p, ready: true } : p));
}

/**
 * Grows or shrinks the bot population to exactly `count`, clamped to
 * 0..MAX_BOTS. Idempotent, which is what lets the panel be a plain stepper
 * instead of two separate add/remove events.
 *
 * Existing bots are kept as they are, not rebuilt, so raising the count leaves
 * the teams the ones already seated are on. Trimming always takes from the end
 * of the roster, so the seat a given bot holds never shifts under it.
 *
 * Returns the identical array when nothing changed, per the no-op rule.
 */
export function setBotCount(players: Player[], count: number): Player[] {
  const wanted = Math.max(0, Math.min(MAX_BOTS, Math.floor(count) || 0));
  const humans = players.filter(isHuman);
  const bots = players.filter(isBot);
  if (bots.length === wanted) return players;

  const kept = bots.slice(0, wanted);
  const held = new Set(kept.map((b) => b.id));
  for (let i = 0; kept.length < wanted && i < MAX_BOTS; i++) {
    if (held.has(botId(i))) continue;
    kept.push({
      id: botId(i),
      name: BOT_ROSTER[i].name,
      emoji: BOT_ROSTER[i].emoji,
      // Never ready and always connected: `isWaiting` is what excuses them
      // from readiness, so the flag itself stays honestly false rather than
      // being propped up at every site that clears it.
      ready: false,
      connected: true,
      teamId: null,
      isBot: true,
    });
  }
  // Humans first, so the seats a real room fills stay at the front of every
  // list on every screen and the scenery collects behind them.
  return [...humans, ...kept];
}

/**
 * Puts every unseated bot on a team, spread evenly across them.
 *
 * Team select is *for* humans picking, so this must not touch them — which is
 * why it delegates to `assignStragglers` over the bots alone rather than over
 * the roster. Bots therefore balance among themselves and ignore how full a
 * team already is; they are scenery, and an even spread of scenery is what
 * makes the panels worth looking at.
 *
 * Returns the identical array when nothing changed, per the no-op rule.
 */
export function seatBots(players: Player[], teams: Team[]): Player[] {
  const bots = players.filter(isBot);
  if (teams.length === 0 || bots.length === 0) return players;
  const seated = assignStragglers(bots, teams);
  if (seated === bots) return players;
  const byId = new Map(seated.map((b) => [b.id, b]));
  return players.map((p) => byId.get(p.id) ?? p);
}
