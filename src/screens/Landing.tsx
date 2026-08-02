import { useEffect, useRef, useState } from "react";
import { AboutLink, AboutPanel } from "../components/About";
import { Wordmark } from "../components/Wordmark";

const CODE_LEN = 4;

/**
 * Moves the caret to another box without letting the browser scroll to it.
 *
 * A plain `focus()` scrolls the focused element into view, and on a phone the
 * on-screen keyboard has just shrunk the visual viewport — so every letter
 * typed *and* every backspace made the whole page jump up and settle back
 * down. The boxes are all on one row and all already on screen; there is
 * nothing for that scroll to reveal.
 */
function focusBox(el: HTMLInputElement | null | undefined): void {
  el?.focus({ preventScroll: true });
}

/** Four single-letter boxes, 2FA-style, instead of one free-text field. */
function RoomCodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const chars = Array.from({ length: CODE_LEN }, (_, i) => value[i] ?? "");

  const setChar = (i: number, ch: string) => {
    const next = chars.slice();
    next[i] = ch;
    onChange(next.join(""));
  };

  return (
    <div className="code-boxes">
      {chars.map((ch, i) => (
        <input
          key={i}
          ref={(el) => { boxes.current[i] = el; }}
          value={ch}
          onChange={(e) => {
            const raw = e.target.value.toUpperCase().replace(/[^A-Z]/g, "");
            if (raw.length > 1) {
              // Handles pasting the whole code into one box.
              const letters = raw.slice(0, CODE_LEN - i).split("");
              const next = chars.slice();
              letters.forEach((c, j) => { next[i + j] = c; });
              onChange(next.join(""));
              focusBox(boxes.current[Math.min(i + letters.length, CODE_LEN - 1)]);
              return;
            }
            setChar(i, raw);
            if (raw && i < CODE_LEN - 1) focusBox(boxes.current[i + 1]);
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !chars[i] && i > 0) {
              focusBox(boxes.current[i - 1]);
            } else if (e.key === "Enter" && i < CODE_LEN - 1) {
              e.preventDefault();
              focusBox(boxes.current[i + 1]);
            }
          }}
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          inputMode="text"
          maxLength={1}
          // A typed box lifts off the page in gold; an empty one stays sunken.
          className={ch ? "code-box code-box--filled" : "code-box"}
          aria-label={`Room code letter ${i + 1}`}
        />
      ))}
    </div>
  );
}

/**
 * The layout rule that picks the side-by-side about panel over the stacked
 * one. **Mirrored in style.css** — the two must agree, or the link performs
 * one gesture while the screen is drawn for the other.
 *
 * Landscape *and* wide, not either alone: a phone held sideways is still a
 * phone and wants the swipe, and a tall narrow desktop window has no room
 * beside the main screen to put a panel in.
 */
const WIDE_ABOUT = "(min-width: 900px) and (orientation: landscape)";

type Props = {
  onCreate: () => void;
  onJoin: (code: string) => void;
  /** A failed join attempt (bad code, game already running) — shown inline,
   * since the code boxes are right here on the same page. */
  joinError?: string | null;
};

export function Landing({ onCreate, onJoin, joinError }: Props) {
  const [code, setCode] = useState("");
  /**
   * Whether the about panel is out — **on a wide landscape screen only**.
   *
   * On a phone the about section is not opened or closed at all: it is simply
   * the second pane of a scroll-snapping column and the thumb decides what is
   * on screen, which is the whole of "swipe up and down to show and hide it".
   * So this flag is read by the desktop half of the CSS and ignored by the
   * mobile half, and the link's job differs accordingly — see `showAbout`.
   */
  const [about, setAbout] = useState(false);
  const shell = useRef<HTMLDivElement>(null);
  const aboutPane = useRef<HTMLDivElement>(null);
  // Guards against re-firing for the same completed code — e.g. if this
  // component re-renders for an unrelated reason while the code is still
  // sitting at 4 characters. Editing any box changes `code`, which lifts
  // the guard for the next attempt.
  const submitted = useRef<string | null>(null);

  useEffect(() => {
    if (code.length !== CODE_LEN) return;
    if (submitted.current === code) return;
    submitted.current = code;
    onJoin(code);
  }, [code, onJoin]);

  // Only the wide layout has a state to escape from; the stacked one is a
  // scroll position, and Escape does not undo a scroll anywhere else either.
  useEffect(() => {
    if (!about) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbout(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [about]);

  /**
   * One link, two gestures, decided by the same rule the stylesheet uses.
   *
   * Wide: raise the flag and let CSS slide the pair. Stacked: there is no flag
   * — the panel is already the next pane down and the link just takes the
   * thumb there, which is exactly what a swipe would have done by hand.
   */
  const showAbout = () => {
    if (window.matchMedia(WIDE_ABOUT).matches) {
      setAbout(true);
      return;
    }
    aboutPane.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  /**
   * The ✕, which both layouts now carry — and which therefore has to undo
   * whichever of the two gestures got here. Stacked, that is the scroll back
   * up to the main screen; the panel is a pane, not a thing that closes.
   */
  const hideAbout = () => {
    if (window.matchMedia(WIDE_ABOUT).matches) {
      setAbout(false);
      return;
    }
    shell.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    // The shell owns the viewport — the fixed, keyboard-aware sizing that was
    // `.screen--locked`'s job on the main element until there was a second
    // pane to hold beside (or below) it. `.landing` itself is now a pane that
    // fills the shell rather than a screen that fills the window.
    <div
      ref={shell}
      className={about ? "landing-shell landing-shell--about" : "landing-shell"}
    >
      <main className="screen screen--mobile landing">
        <Wordmark />

        {/* The code boxes are themselves the join button — filling the fourth
            one submits, so there is no separate call to action here. */}
        <section className="card code-card">
          <h1 className="code-card__label">Enter room code</h1>
          <RoomCodeInput value={code} onChange={setCode} />
          {joinError && <p className="code-card__error">{joinError}</p>}
        </section>

        <div className="divider"><span>OR</span></div>

        <section className="card create-card">
          <p className="create-card__copy">
            No room yet? This device becomes the shared screen and doesn’t play.
          </p>
          <button type="button" className="btn btn--block" onClick={onCreate}>
            Create a room
          </button>
        </section>

        {/* The two ends of the bottom edge: the way in on the left, the build
            on the right. Same quiet type for both — the underline is what
            tells a control from a label at this size. */}
        <AboutLink className="about-link--landing" onClick={showAbout} />
        <span className="version">v{__APP_VERSION__}</span>
      </main>

      {/* Always mounted, in both layouts. Wide, it is parked off the right
          edge and slid in; stacked, it is simply the pane below and the shell
          scroll-snaps between the two. Rendering it only when open would mean
          nothing to scroll to on a phone, where there is no open. */}
      <div className="landing-shell__about" ref={aboutPane}>
        <AboutPanel variant="landing" onClose={hideAbout} />
      </div>
    </div>
  );
}
