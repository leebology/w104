import type { Phase, Room } from "./state";
import { matchComplete } from "./state";

/**
 * Which piece of music a phase asks for.
 *
 * The ids are the folder names under `src/audio/` — that is the whole binding
 * between this file and the media, so adding a scene is a folder plus a case
 * below and nothing else. Music is host-only (see `src/audio/music.ts`), so
 * nothing here ever runs on a phone.
 */
export type SceneId =
  | "lobby"
  | "countdown"
  | "gameplay"
  | "times_up"
  | "round_results"
  | "midgame_standings"
  | "endgame_standings";

/**
 * Whether a scene is a **bed** — a track that loops for as long as its screen
 * is up — or a **cue**, which plays once and stops.
 *
 * The distinction decides what an *empty* folder means, which is the more
 * useful half of it. A bed with no file is silence: the screen changed and
 * there is nothing to play under it. A cue with no file is simply **no cue** —
 * nothing is interrupted and whatever was already playing carries on. That is
 * what lets `midgame_standings/` and `endgame_standings/` be left empty to mean
 * "keep the results music going", with no separate opt-out to set.
 *
 * A `Record` rather than a list of the beds, so adding a `SceneId` above fails
 * to compile until this answers for it — a new scene silently defaulting to
 * "loops" only shows up as a track still going under the next screen.
 */
const LOOPS: Record<SceneId, boolean> = {
  lobby: true,
  countdown: false,
  gameplay: true,
  times_up: false,
  round_results: true,
  midgame_standings: false,
  endgame_standings: false,
};

export function loops(scene: SceneId): boolean {
  return LOOPS[scene];
}

/**
 * Per-scene trim, 0..1. The room's mix, and the one knob here worth turning.
 *
 * **The scale is linear amplitude, not loudness** — it goes straight to
 * `HTMLMediaElement.volume`. Halving the number is not halving the volume, and
 * a value close to 1 does almost nothing: 0.8 is about -2dB, which is on the
 * edge of audible as a change at all. Roughly, 0.7 is -3dB, 0.5 is -6dB and is
 * where a track reads as clearly quieter, and 0.35 is -9dB and well back. Move
 * in those steps rather than in tenths.
 *
 * Deliberately `Partial`, unlike `LOOPS` above: a scene with no entry plays at
 * the level it was mastered at, which is both the right default and the honest
 * one — an entry here means "this track is out against the others", so listing
 * every scene at 1 would bury the handful that actually say something.
 *
 * It is a trim and not a mix bus: there is no master volume, because the TV has
 * one and it is the one people reach for.
 */
const LEVELS: Partial<Record<SceneId, number>> = {
  // Mastered hotter than the rest of the set.
  round_results: 0.4,
};

export function levelOf(scene: SceneId): number {
  return LEVELS[scene] ?? 1;
}

/** Crossfade between two scenes, ms. */
export const MUSIC_FADE_MS = 400;

/**
 * How long the screen sits in silence before its music restarts after a
 * countdown is cancelled.
 *
 * The countdown stops the music dead and its sting takes over; when somebody
 * un-readies, both stop and the room is back where it was. Coming straight
 * back in on the same frame reads as a glitch rather than as a return, so the
 * beat is deliberate.
 */
export const MUSIC_RESUME_DELAY_MS = 1000;

/**
 * How long the clip in `src/audio/countdown/` actually runs, in ms.
 *
 * A measured fact about a file somebody dragged into a folder, written down
 * because it is the one thing about the media the *server* has to know:
 * `COUNTDOWN_MS` must not be shorter, or the lead-in is cut off mid-bar. The
 * test beside this file is what makes the pair fail loudly rather than quietly
 * clipping, so **replacing the clip means updating this number** — and then
 * doing whatever the test says.
 *
 * Nothing reads it at runtime. The hand-off to the round's music fires off the
 * clip's own `ended` event (`src/audio/music.ts`), which needs no duration.
 */
export const LEAD_CLIP_MS = 7_312;

/** The fields `sceneFor` reads — a subset, so `Room` and `RoomState` both fit. */
type SceneView = Pick<Room, "history" | "settings"> & { phase: Phase };

/**
 * The one mapping from phase to music.
 *
 * Two of these groupings are decisions rather than transcription, and both work
 * the same way: **naming the same scene twice is how a track carries across a
 * screen change.** The player compares scene ids and does nothing when they
 * match, so anything that should not restart simply keeps its name.
 *
 * - **The round's music starts at the category vote and runs unbroken into
 *   round one.** `voting`, the countdown that follows it and `playing` all
 *   return `gameplay`, so the track that comes up when the room picks a
 *   category is still going when the whistle blows — one continuous piece
 *   across three screens, with no restart at either seam.
 * - **That is why the round-one countdown is the one countdown with no sting.**
 *   The countdown clip is a *lead-in* to the round's music, and by that point
 *   the round's music is already playing. Every other countdown does get it:
 *   coming out of the lobby it leads into the category vote, and between rounds
 *   it leads into the next round.
 * - **The standings scenes are separate names with usually-empty folders.**
 *   Both are cues, so leaving a folder empty keeps the results music playing
 *   across the standings rather than cutting to silence — and dropping a file
 *   in takes it over, with nothing else to change.
 */
export function sceneFor(view: SceneView): SceneId {
  switch (view.phase.name) {
    case "lobby":
    case "teams":
      return "lobby";
    case "voting":
      return "gameplay";
    case "countdown":
      // The one countdown the round's music is already playing under — see
      // above. `to: "playing"` at round one can only be the count out of the
      // category vote; every later one comes off the standings.
      return view.phase.to === "playing" && view.history.length === 0
        ? "gameplay"
        : "countdown";
    case "playing":
      return "gameplay";
    case "timesup":
      return "times_up";
    case "scoring":
      return "round_results";
    case "standings":
      return matchComplete(view) ? "endgame_standings" : "midgame_standings";
  }
}
