import { describe, expect, it } from "vitest";
import { COUNTDOWN_TICKS, START_HOLD_MS, TICK_MS, countdownFace } from "./countdown";
import { COUNTDOWN_MS } from "./reduce";
import { LEAD_CLIP_MS } from "./music";

describe("countdownFace", () => {
  it("opens on COUNTDOWN_TICKS at the top of the phase", () => {
    expect(countdownFace(COUNTDOWN_MS)).toBe(COUNTDOWN_TICKS);
  });

  it("shows every number from COUNTDOWN_TICKS down to 1", () => {
    // Sampled at the middle of each step, so this says nothing about where the
    // boundaries fall — only that none of the five numbers is skipped.
    const seen = Array.from({ length: COUNTDOWN_TICKS }, (_, i) =>
      countdownFace(COUNTDOWN_MS - (i + 0.5) * TICK_MS));
    expect(seen).toEqual([5, 4, 3, 2, 1]);
  });

  it("holds each number for a full second", () => {
    // The instant a step opens and the instant before it closes are the same
    // numeral. `ceil` puts the boundary itself on the number above. Measured
    // from the top of the START window, which is where the count now ends.
    for (let i = 1; i <= COUNTDOWN_TICKS; i++) {
      expect(countdownFace(START_HOLD_MS + i * TICK_MS)).toBe(i);
      expect(countdownFace(START_HOLD_MS + i * TICK_MS - TICK_MS + 1)).toBe(i);
    }
  });

  it("counts in real seconds", () => {
    // The change this module exists for now: a step is a second, not a share of
    // whatever the audio made the phase. A room chanting along counts seconds.
    expect(TICK_MS).toBe(1000);
  });

  it("never shows 0 — the count runs out into START", () => {
    expect(countdownFace(1)).toBe("start");
    expect(countdownFace(0)).toBe("start");
    expect(countdownFace(-500)).toBe("start");
  });

  it("never shows more than COUNTDOWN_TICKS, however skewed the clock", () => {
    expect(countdownFace(COUNTDOWN_MS + 1)).toBe(COUNTDOWN_TICKS);
    expect(countdownFace(COUNTDOWN_MS * 2)).toBe(COUNTDOWN_TICKS);
  });

  it("holds START for the whole tail of the phase, and only the tail", () => {
    expect(START_HOLD_MS).toBeGreaterThan(0);
    expect(countdownFace(START_HOLD_MS)).toBe("start");
    // The instant before the tail opens is still the last numeral, so START and
    // the count between them cover the phase with no gap and no overlap.
    expect(countdownFace(START_HOLD_MS + 1)).toBe(1);
  });

  it("covers the lead-in clip between the count and START", () => {
    // The card is showing *something* for as long as the music plays: five
    // seconds of numbers plus the tail is the whole phase, and the phase is at
    // least the clip. The pairing itself is pinned in music.test.ts.
    expect(START_HOLD_MS + COUNTDOWN_TICKS * TICK_MS).toBe(COUNTDOWN_MS);
    expect(COUNTDOWN_MS).toBeGreaterThanOrEqual(LEAD_CLIP_MS);
  });
});
