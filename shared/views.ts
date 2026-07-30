import type { Room } from "./state";

/**
 * Every distinct screen the game can be on, as one flat list, so the debug
 * menu can jump to any of them.
 *
 * **Not the same thing as `Phase["name"]`.** `countdown` renders two different
 * screens depending on where it lands — the one before the category vote and
 * the one before a round — and the jumper has to be able to ask for either.
 * Everything else is one phase, one view.
 *
 * It is deliberately *not* split any finer than that. The lobby and team-select
 * countdowns are one id, because which of the two screens sits under a
 * `to: "voting"` countdown is already derived from `teamCount` by
 * `countdownScreen` — a second id would be a second copy of that rule.
 *
 * Order is play order, which is also the order the panel renders them in: the
 * list doubles as a map of the match, so a jump target is found by remembering
 * where in a game the screen appears rather than by reading nine labels.
 */
export const VIEWS = [
  { id: "lobby", label: "Lobby" },
  { id: "teams", label: "Team select" },
  { id: "countdownToVoting", label: "Countdown → vote" },
  { id: "voting", label: "Category vote" },
  { id: "countdownToPlaying", label: "Countdown → round" },
  { id: "playing", label: "Round" },
  { id: "timesup", label: "Time's up" },
  { id: "scoring", label: "Results" },
  { id: "standings", label: "Standings" },
] as const;

export type ViewId = (typeof VIEWS)[number]["id"];

/**
 * The jump target arrives over a socket, so it is checked rather than trusted —
 * the same treatment `isGameModeId` gives a mode id.
 */
export function isViewId(value: unknown): value is ViewId {
  return typeof value === "string" && VIEWS.some((v) => v.id === value);
}

/**
 * Which view the room is showing. Derived, never stored — the phase already
 * says, and a stored copy would be a second truth to drift.
 *
 * This is what makes "refresh the view I am on" a jump to where you already
 * are, rather than its own event with its own per-phase rules to keep in step.
 */
export function currentView(view: Pick<Room, "phase">): ViewId {
  const phase = view.phase;
  if (phase.name === "countdown") {
    return phase.to === "voting" ? "countdownToVoting" : "countdownToPlaying";
  }
  return phase.name;
}
