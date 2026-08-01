/**
 * Publishes the *visual* viewport — the part of the page a phone keyboard is
 * not covering — onto the document root as `--vv-height` and `--vv-top`.
 *
 * The layout viewport, which is what `100dvh` measures, does not shrink when
 * the keyboard opens. It stays full-screen and the browser scrolls it instead.
 * That is the whole bug: a screen sized to `100dvh` keeps its full height, the
 * page slides up and down under the player's thumb, and the part of it below
 * the keyboard shows as a band of empty background under the word list.
 *
 * Locked screens size themselves from `--vv-height` instead, so the visible
 * area is the only area there is and the sole thing that scrolls is whatever
 * has its own `overflow` — the word list. Installed once, for the app's
 * lifetime: no screen wants the old behaviour.
 */
export function trackVisualViewport(): void {
  const vv = window.visualViewport;
  // Every use site has a `100dvh` fallback baked into its `var()`, so a
  // browser without visualViewport simply keeps the pre-keyboard behaviour.
  if (!vv) return;

  const root = document.documentElement;
  const sync = () => {
    root.style.setProperty("--vv-height", `${vv.height}px`);
    // `scroll` matters as much as `resize`: iOS shifts the visual viewport
    // down over the layout viewport to reveal a focused input, and a screen
    // pinned at a stale offset would sit partly off the top of the display.
    root.style.setProperty("--vv-top", `${vv.offsetTop}px`);
    // A class, not a media query: media queries measure the *layout* viewport,
    // which does not shrink when the keyboard opens. 620px is the threshold
    // below which the creation screen drops its meta line and halves its
    // counter — see the brief's §1e.
    root.classList.toggle("vv-compact", vv.height < 620);
  };

  sync();
  vv.addEventListener("resize", sync);
  vv.addEventListener("scroll", sync);
}
