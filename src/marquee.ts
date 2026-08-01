import { useEffect, useRef } from "react";
import type { RefObject } from "react";

/**
 * Text that does not fit is cut off at its container's edge and travels back
 * and forth — no ellipsis, no wrap. Long player names, long team names, long
 * words and a long attribution trail all use it.
 *
 * The travel distance cannot be expressed in CSS, so it is measured: every
 * `[data-marquee]` clip box gets `--travel` set to how far its single inline
 * child overflows, negative, or `0px` when it fits. `marqueeX` in style.css
 * animates the child by that amount, so anything that fits never moves.
 *
 * Deliberately **not** `container-type: inline-size`, which would zero an
 * element's intrinsic width contribution — that collapses a shrink-to-fit team
 * badge to nothing. Measuring lets the badge keep its natural width *and* clip
 * when it has to.
 */
export function measureMarquee(root: HTMLElement): void {
  const boxes = root.matches("[data-marquee]") ? [root] : [];
  boxes.push(...root.querySelectorAll<HTMLElement>("[data-marquee]"));

  for (const box of boxes) {
    const run = box.firstElementChild as HTMLElement | null;
    if (!run) continue;
    // Against the *content* box: `clientWidth` includes padding, and a badge's
    // 10px of it would otherwise read as 10px of room the text does not have.
    const style = getComputedStyle(box);
    const room =
      box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const travel = Math.min(0, room - run.getBoundingClientRect().width);
    const next = `${Math.round(travel)}px`;
    if (box.style.getPropertyValue("--travel") === next) continue;
    box.style.setProperty("--travel", next);
    // A running `infinite alternate` animation does not reliably re-resolve
    // a `var()` inside its own keyframes the moment the custom property
    // changes — an already-looping run can keep animating toward the stale
    // value it started with until something unrelated forces a style
    // recalc. Restarting the animation outright is what makes a travel
    // change (a name that was already long at mount, a host reload with an
    // existing roster) take effect immediately instead of sitting frozen
    // until the next incidental re-render.
    run.style.animation = "none";
    void run.offsetWidth;
    run.style.animation = "";
  }
}

/**
 * Measures every clip box under the returned ref.
 *
 * Re-runs on `deps` — new rows, a renamed team — and on resize, but the one that
 * matters is `document.fonts.ready`: Bungee is far wider than its fallback and
 * arrives after first paint, so a mount-only measurement reports "it fits" for
 * runs that then overflow.
 */
export function useMarquee<T extends HTMLElement>(deps: unknown[]): RefObject<T | null> {
  const ref = useRef<T>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const measure = () => measureMarquee(root);
    measure();
    // `fonts` is missing in jsdom and in older Safari; the mount measurement is
    // then all there is, which is the pre-webfont behaviour rather than a crash.
    document.fonts?.ready.then(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return ref;
}
