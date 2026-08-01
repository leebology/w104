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
 *
 * Also installs the layout-viewport pin below, which is the other half of the
 * same job: this function keeps a screen the right *size* when the keyboard is
 * up, and the pin keeps the page from sliding around underneath it.
 */
export function trackVisualViewport(): void {
  // Ahead of the early return: a browser with no `visualViewport` still scrolls
  // its page to reveal a focused field, and that is the half being prevented.
  pinLayoutViewport();

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

/**
 * Holds the *layout* viewport at the origin, for the whole app's lifetime.
 *
 * `html, body { overflow: hidden }` in style.css says the document never
 * scrolls, and on a desktop browser that is the end of it. iOS is not bound by
 * it: focusing an in-flow input scrolls the page to reveal the field above the
 * keyboard whatever `overflow` says, and `focus({ preventScroll: true })` does
 * not stop it — Safari ignores the option, and it never applied to the user's
 * own tap on the field in the first place. The page then slides under the
 * thumb while they type, which is the one thing a phone screen here must not
 * do: the control they are reaching for moves with it.
 *
 * The round escapes this only because its input is `.entry-overlay`, fixed to
 * the visual viewport — there is nothing for Safari to scroll toward. Every
 * other screen that takes typing has its field in flow, so the pin is what
 * gives them the same behaviour without moving their inputs out of the layout
 * they are drawn in.
 *
 * Nothing is lost by snapping back: a locked screen is *sized* from the visual
 * viewport (`--vv-height`), so the field is already inside the visible area and
 * the scroll Safari performed was never revealing anything.
 */
function pinLayoutViewport(): void {
  const pin = () => {
    // Reading first: an unconditional `scrollTo` on every scroll event is a
    // write in a handler the write itself re-fires.
    if (window.scrollX === 0 && window.scrollY === 0) return;
    window.scrollTo(0, 0);
  };
  // `scroll` catches the drift itself; `focusin` catches the case where the
  // scroll and the keyboard's own resize land in the same frame and the
  // browser settles on a non-zero offset without emitting a second event.
  window.addEventListener("scroll", pin, { passive: true });
  window.addEventListener("focusin", pin);
}
