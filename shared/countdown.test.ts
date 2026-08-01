import { describe, expect, it } from "vitest";
import { COUNTDOWN_TICKS, TICK_MS, countdownNumber } from "./countdown";
import { COUNTDOWN_MS } from "./reduce";
import { LEAD_CLIP_MS } from "./music";

describe("countdownNumber", () => {
  it("opens on COUNTDOWN_TICKS at the top of the phase", () => {
    expect(countdownNumber(COUNTDOWN_MS)).toBe(COUNTDOWN_TICKS);
  });

  it("shows every number from COUNTDOWN_TICKS down to 1", () => {
    // Sampled at the middle of each step, so this says nothing about where the
    // boundaries fall — only that none of the five numbers is skipped.
    const seen = Array.from({ length: COUNTDOWN_TICKS }, (_, i) =>
      countdownNumber(COUNTDOWN_MS - (i + 0.5) * TICK_MS));
    expect(seen).toEqual([5, 4, 3, 2, 1]);
  });

  it("holds each number for a full step", () => {
    // The instant a step opens and the instant before it closes are the same
    // numeral. `ceil` puts the boundary itself on the number above.
    for (let i = 1; i <= COUNTDOWN_TICKS; i++) {
      expect(countdownNumber(i * TICK_MS)).toBe(i);
      expect(countdownNumber(i * TICK_MS - TICK_MS + 1)).toBe(i);
    }
  });

  it("never shows 0, however late the tick is", () => {
    expect(countdownNumber(1)).toBe(1);
    expect(countdownNumber(0)).toBe(1);
    expect(countdownNumber(-500)).toBe(1);
  });

  it("never shows more than COUNTDOWN_TICKS, however skewed the clock", () => {
    expect(countdownNumber(COUNTDOWN_MS + 1)).toBe(COUNTDOWN_TICKS);
    expect(countdownNumber(COUNTDOWN_MS * 2)).toBe(COUNTDOWN_TICKS);
  });

  it("stretches its step past a second rather than counting seconds", () => {
    // The point of the whole module: the card is five numbers long and the
    // phase is as long as the audio, so a step is *not* a second. If this ever
    // came back to 1000 the card would be a plain seconds clock again.
    expect(TICK_MS).toBeGreaterThan(1000);
    expect(TICK_MS * COUNTDOWN_TICKS).toBe(COUNTDOWN_MS);
  });

  it("spans the lead-in clip", () => {
    // The five numbers cover the music rather than running out under it. The
    // pairing itself is pinned in music.test.ts; this is the display end of it.
    expect(TICK_MS * COUNTDOWN_TICKS).toBeGreaterThanOrEqual(LEAD_CLIP_MS);
  });
});
