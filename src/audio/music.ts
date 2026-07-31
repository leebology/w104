import { useEffect } from "react";
import { MUSIC_FADE_MS, MUSIC_RESUME_DELAY_MS, levelOf, loops, sceneFor } from "../../shared/music";
import type { SceneId } from "../../shared/music";
import type { RoomState } from "../../shared/state";
import { sourceFor } from "./tracks";

/** Volume steps per fade. 400ms in 16 steps is 25ms a step — smooth, and cheap. */
const FADE_STEPS = 16;

/**
 * What the countdown's lead-in hands over to when it finishes.
 *
 * Every countdown that is not cancelled arrives at the round's music, whether
 * it came out of the lobby (into the category vote) or off the standings (into
 * the next round), so the lead has exactly one destination.
 */
const LEADS_TO: SceneId = "gameplay";

/**
 * The room's music, as one imperative object outside React.
 *
 * Deliberately not state and not a ref: an `HTMLAudioElement` is a long-lived
 * thing whose whole job is to survive re-renders, and the one question that
 * decides everything here — "has the scene changed?" — is answered by comparing
 * two strings. The same reasoning that keeps the scroll mirror out of React
 * (`RoomStore.onColumnScroll`), for a much smaller object.
 *
 * A singleton because there is exactly one pair of speakers.
 */
class MusicPlayer {
  /** What is meant to be playing. `null` before the first scene and after stop. */
  private scene: SceneId | null = null;
  /** One element per scene, kept so a repeat scene never refetches its file. */
  private elements = new Map<SceneId, HTMLAudioElement>();
  private fades = new Map<HTMLAudioElement, number>();
  /** The pending delayed start — see `MUSIC_RESUME_DELAY_MS`. */
  private resume: number | null = null;
  /**
   * What the countdown interrupted, while it is still interrupting it.
   *
   * This is the whole of the cancel rule, and it is a *destination* test rather
   * than a "was it cancelled" flag: a countdown that runs its course moves the
   * room on to the round's music, while one somebody un-readies out of lands
   * back on the very scene it interrupted. Comparing where we arrive against
   * what was playing tells the two apart with nothing recording which happened.
   *
   * Deliberately survives the hand-off below, so a cancel in the gap between
   * the lead ending and the countdown ending still gets its beat of silence.
   */
  private interrupted: SceneId | null = null;
  /** Set while waiting for a gesture to unblock autoplay. See `arm`. */
  private armed = false;

  /**
   * Put the room on `scene`, or on silence.
   *
   * Idempotent on the scene id, and that is load-bearing rather than a nicety:
   * every place a track is meant to carry across a screen change is expressed
   * by naming the same scene on both sides (see `sceneFor`), so continuity
   * *is* this early return.
   */
  play(next: SceneId | null): void {
    if (next === this.scene) {
      // The phase has caught up with the hand-off below: the countdown is over
      // in every sense now, so whatever the room does next is not a cancel of
      // it. Until this point `interrupted` is still live — that is the gap the
      // hand-off opens, between the clip finishing and the card coming down.
      if (next !== "countdown") this.interrupted = null;
      return;
    }

    // A cue with no file is no cue at all: nothing is interrupted and whatever
    // is playing carries on. This is what an empty `midgame_standings/` or
    // `endgame_standings/` means — keep the results music going — and it is why
    // that needs no setting of its own. A missing *bed* is silence, because
    // there its screen really has changed to nothing.
    if (next !== null && !loops(next) && sourceFor(next) === null) return;

    const previous = this.scene;
    this.scene = next;

    this.clearResume();
    const outgoing = previous === null ? null : this.elements.get(previous);
    // **A cue interrupts; a bed crossfades.** A cue is a piece of music with an
    // attack to land on a moment — the lead-in out of team select, the whistle
    // — and four hundred milliseconds of the last track playing over its first
    // bar is not a transition, it is two songs at once. A bed is the opposite:
    // it comes up under a screen and the point is not to announce itself, so
    // one fades out as the other fades in. Stopping the room (`next === null`)
    // fades, because nothing is arriving to cover a hard cut.
    if (outgoing) {
      if (next !== null && !loops(next)) this.cut(outgoing);
      else this.fadeOut(outgoing);
    }

    // Cancelled: back where the countdown found us, so take the beat before
    // coming back in. Read `interrupted` before overwriting it below — the two
    // orders differ for a countdown reached from another countdown, which
    // cannot happen today and should not depend on this line if it ever does.
    const cancelled = next !== null && next === this.interrupted;
    this.interrupted = next === "countdown" ? previous : null;
    if (next === null) return;

    if (!cancelled) {
      this.start(next, { fade: loops(next) });
      return;
    }
    this.resume = window.setTimeout(() => {
      this.resume = null;
      if (this.scene === next) this.start(next, { fade: true });
    }, MUSIC_RESUME_DELAY_MS);
  }

  /** Everything off, now — the host leaving the room. */
  stop(): void {
    this.play(null);
  }

  /**
   * Always from the top: a scene is entered, never resumed.
   *
   * `fade` is off for a cue, which has an attack to land, and off for the
   * hand-off, which is joining one clip to the next on the beat. It is on for a
   * bed coming up under a screen, where the point is not to announce itself.
   */
  private start(scene: SceneId, { fade }: { fade: boolean }): void {
    const el = this.elementFor(scene);
    if (!el) return;
    el.currentTime = 0;
    el.loop = loops(scene);
    // The scene's trim is the ceiling a fade climbs to, not something applied
    // on top of a finished fade — otherwise every fade-in overshoots its level
    // and drops back.
    const level = levelOf(scene);
    if (fade) this.ramp(el, level, () => {});
    else this.setVolume(el, level);
    void el.play().catch(() => this.arm());
  }

  private elementFor(scene: SceneId): HTMLAudioElement | null {
    const existing = this.elements.get(scene);
    if (existing) return existing;
    const src = sourceFor(scene);
    if (!src) return null;
    const el = new Audio(src);
    el.preload = "auto";
    el.volume = 0;
    this.elements.set(scene, el);
    // Attached once, at creation, rather than per play: the element is cached
    // for the life of the page, so a listener added on each countdown would
    // stack up one per round.
    if (scene === "countdown") el.addEventListener("ended", () => this.handOff());
    return el;
  }

  /**
   * The lead-in reaching its last sample, joined to the round's music.
   *
   * The join is driven off the clip rather than off the phase change for the
   * obvious reason: the phase turns over on a server alarm, which is near
   * enough for a screen and nowhere near enough for a bar of music. Firing on
   * `ended` puts the next clip in on the frame after the last one, so the two
   * butt up.
   *
   * That does mean the round's music can start slightly before the countdown
   * card comes down, by however much `COUNTDOWN_MS` overshoots the clip. That
   * is the right way round — the alternative is a gap — and it is why that
   * constant is rounded up rather than trimmed to fit.
   */
  private handOff(): void {
    if (this.scene !== "countdown") return;
    this.scene = LEADS_TO;
    // `interrupted` is deliberately left set: until the phase itself moves on,
    // a cancel is still a cancel and still owes the room its beat of silence.
    this.start(LEADS_TO, { fade: false });
  }

  /**
   * Fetch a scene's file without playing it.
   *
   * The hand-off above is only instant if the round's music is already in
   * memory when the lead ends — a track that starts downloading at that moment
   * arrives well after the beat it was supposed to land on. `preload = "auto"`
   * on a constructed element is enough; it just has to be constructed early,
   * and the lobby is where there is time to spare.
   */
  private warm(scene: SceneId): void {
    this.elementFor(scene);
  }

  /**
   * Wait for a gesture, then try again.
   *
   * A browser refuses `play()` on a page that has never been interacted with.
   * The host normally cannot hit that — creating the lobby is a tap on this
   * very page — but a host who *resumes* a room after a refresh or a discarded
   * tab arrives with no gesture on record, and that is exactly the device the
   * room is listening to. So the failure re-arms rather than giving up, and the
   * next touch of the TV starts whatever should be playing by then.
   */
  private arm(): void {
    if (this.armed) return;
    this.armed = true;
    const retry = () => {
      this.armed = false;
      document.removeEventListener("pointerdown", retry);
      document.removeEventListener("keydown", retry);
      if (this.scene !== null && this.resume === null) {
        this.start(this.scene, { fade: false });
      }
    };
    document.addEventListener("pointerdown", retry, { once: true });
    document.addEventListener("keydown", retry, { once: true });
  }

  private clearResume(): void {
    if (this.resume === null) return;
    window.clearTimeout(this.resume);
    this.resume = null;
  }

  private fadeOut(el: HTMLAudioElement): void {
    this.ramp(el, 0, () => el.pause());
  }

  /**
   * Off now, not over 400ms. Any ramp in flight goes with it — otherwise a fade
   * started a moment earlier would keep stepping the volume of a paused element
   * and hand it back mid-ramp on its next scene.
   */
  private cut(el: HTMLAudioElement): void {
    this.cancelRamp(el);
    el.pause();
  }

  /** So a scene change mid-fade cannot leave two timers fighting over one volume. */
  private cancelRamp(el: HTMLAudioElement): void {
    const running = this.fades.get(el);
    if (running === undefined) return;
    window.clearInterval(running);
    this.fades.delete(el);
  }

  private setVolume(el: HTMLAudioElement, to: number): void {
    this.cancelRamp(el);
    el.volume = to;
  }

  /**
   * Linear volume ramp on a timer.
   *
   * A timer rather than a CSS transition or a Web Audio gain node because
   * `volume` is a plain property on the element and this is four hundred
   * milliseconds of arithmetic — an `AudioContext` would buy a smoother curve
   * at the cost of a second graph to keep alive across hibernating tabs.
   */
  private ramp(el: HTMLAudioElement, to: number, done: () => void): void {
    this.cancelRamp(el);
    const from = el.volume;
    const step = (to - from) / FADE_STEPS;
    let n = 0;
    const timer = window.setInterval(() => {
      n += 1;
      // Clamped: floating-point drift over sixteen steps can land a hair
      // outside [0,1], which throws on assignment rather than saturating.
      el.volume = Math.min(1, Math.max(0, n >= FADE_STEPS ? to : from + step * n));
      if (n < FADE_STEPS) return;
      window.clearInterval(timer);
      this.fades.delete(el);
      done();
    }, MUSIC_FADE_MS / FADE_STEPS);
    this.fades.set(el, timer);
  }

  /** First scene of the session. Warms the one clip that has a beat to hit. */
  begin(): void {
    this.warm(LEADS_TO);
  }
}

export const music = new MusicPlayer();

/**
 * Play the room's music. **Host screens only** — this is called from `HostView`
 * and from nowhere else, which is the whole enforcement: a phone never mounts
 * that component, so there is no per-device check to get wrong.
 *
 * Keyed on the derived scene rather than on the room, so the effect runs on the
 * handful of phase changes that mean something musically and not on every state
 * push.
 */
export function useMusic(room: RoomState): void {
  const scene = sceneFor(room);
  useEffect(() => {
    music.play(scene);
  }, [scene]);
  useEffect(() => {
    music.begin();
    // The host leaving takes the room with it; the music goes too.
    return () => music.stop();
  }, []);
}
