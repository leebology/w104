import type { ReactNode } from "react";

/**
 * "About the game" — one body of copy, three placements.
 *
 * The prose and the credits live here and *only* here. Landing, the host lobby
 * and the player lobby each own the mechanics of getting this on screen (a
 * side panel, a push panel, a scroll-in section) and none of them owns a word
 * of what it says, so a rewrite is one file and the three placements cannot
 * drift apart.
 *
 * **This is the file to edit for copy.** `AboutContent` is plain prose in
 * plain elements — there is no layout in it beyond the section headings, and
 * every placement styles the same classes.
 */

/**
 * The soundtrack, credited track by track.
 *
 * Hand-maintained, and it is the one place in the audio system where the
 * *filename matters*: `src/audio/tracks.ts` globs the folders precisely so a
 * track can be swapped by dragging a file in, and a swap that does not also
 * change this list leaves the wrong attribution on screen. `where` is the
 * scene folder under `src/audio/`, so the two can be read side by side.
 *
 * `by`/`from` are optional and a missing pair renders nothing rather than a
 * placeholder — an unverified attribution is worse than none, since crediting
 * is a licence obligation and a wrong credit does not discharge it.
 *
 * TODO(liam): fill in `by` and `from` for every track below. What is known
 * from the filenames alone is a guess and is deliberately not written here:
 *   - times_up and endgame_standings look like Pixabay uploads
 *     ("openmindaudio", "SergeQuadrado" read as usernames).
 *   - lobby and round_results ("Awesome Call", "Boogie Party") read like
 *     YouTube Audio Library titles.
 *   - gameplay and countdown ("Game-main", "game-lead") have no source in the
 *     filename at all.
 */
type Track = {
  /** The track as it should be credited. */
  title: string;
  /** Where in the game it plays, in words a player would recognise. */
  license?: string;
  /** Artist. Omitted until confirmed. */
  by?: string;
  /** Library or site it came from. Omitted until confirmed. */
  from?: string;
};

const TRACKS: Track[] = [
  { title: "Awesome Call", by: "Kevin MacLeod (incompetech.com)", license: "Licensed under Creative Commons: By Attribution 4.0" },
  { title: "Private Eye", by: "Kevin MacLeod (incompetech.com)", license: "Licensed under Creative Commons: By Attribution 4.0" },
  { title: "Boogie Party", by: "Kevin MacLeod (incompetech.com)", license: "Licensed under Creative Commons: By Attribution 4.0" },
  { title: "Brass Funk Jingle", by: "SergeQuadrado via Pixabay" },
  { title: "Podcast Outro Stinger", by: "openMindAudio via Pixabay" },
];

function TrackCredit({ track }: { track: Track }) {
  const attribution = [track.by, track.from].filter(Boolean).join(" · ");
  return (
    <li className="about__credit">
      <span className="about__credit-title">{track.title}</span>
      <span className="about__credit-meta">
        {track.license}
        {attribution ? ` — ${attribution}` : ""}
      </span>
    </li>
  );
}

/** A titled block of the about copy. */
function AboutSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="about__section">
      <h3 className="about__heading">{title}</h3>
      {children}
    </section>
  );
}

/**
 * The copy itself, with no chrome around it — no panel, no close button, no
 * positioning. Every placement wraps this in whatever container it needs.
 */
export function AboutContent() {
  return (
    <div className="about">
      {/* <AboutSection title="What this is"> */}
        <p className="about__p">
          Created by Aidan, Akshay, and Liam (and Claude)
        </p>
        {/* <p className="about__p">
          The catch is that you only score for a word <em>nobody else wrote</em>.
          The obvious answer is the one everybody has. Being right is not the
          game; being the only one who was is.
        </p> */}
      {/* </AboutSection> */}

      <AboutSection title="How to play">
        <p className="about__p">
          1. On a laptop, create a new room and screenshare to a TV so everyone can see it. Players will join this room on their phone.
        </p>
        <p className="about__p">
          2. Start the game and vote on a category.
        </p>
        <p className="about__p">
          3. When the game begins, type in as many words in that category as you can within the time limit. Highest number of unique words wins!
        </p>
      </AboutSection>

      <AboutSection title="Why does this exist">
        <p className="about__p">
          We saw a thumbnail of a youtuber trying to name 100 women and thought we could easily do that, so a timer was set for a generous 10 minutes and we each wrote down a list on our phones.
        </p>
        <p className="about__p">
          Between the three of us, we did manage to name 104 unique names (though our contributions were <em>not</em> equal).
        </p>
        <p className="about__p">
          Instead of buying a book on feminism, we decided the best way to absolve ourselves of this embarassment was to create a digital version of this game for our friends to play.
        </p>
        <p className="about__p">
          Over two weeks and 3 Claude Code accounts later, we released version 1.0.0 live on August 1st 2026 and playtested somewhat successfully with a group of 25 people. 
        </p>
      </AboutSection>

      <AboutSection title="Music and sound credits">
        <ul className="about__credits">
          {TRACKS.map((t) => (
            <TrackCredit key={t.title} track={t} />
          ))}
        </ul>
      </AboutSection>

      <AboutSection title="font credits">
        <ul className="about__credits">
          <li className="about__credit">
            <span className="about__credit-title">Bungee</span>
            <span className="about__credit-meta">
              David Jonathan Ross · SIL Open Font License
            </span>
          </li>
          <li className="about__credit">
            <span className="about__credit-title">Archivo</span>
            <span className="about__credit-meta">
              Omnibus-Type · SIL Open Font License
            </span>
          </li>
        </ul>
      </AboutSection>

      <AboutSection title="Built with">
        <p className="about__p about__p--quiet">
          React · Vite · TypeScript · Cloudflare Workers and Durable Objects ·
          Vercel
        </p>
      </AboutSection>

      <AboutSection title="Data and privacy">
        <p className="about__p">
          The game keeps a record of the matches played on it — the words, the
          scores and the votes. It is never used to identify anyone and never
          goes anywhere else.
        </p>
        {/* A real link to a real page, not a button that swaps a panel: this
            opens in its own tab, on its own URL, so it can be sent to somebody
            and read without a game running. `public/privacy/index.html` is a
            standalone file for the same reason — see the note at the top of
            it. `rel` is what stops the new tab reaching back through
            `window.opener`. */}
        <a
          className="about__link"
          href="/privacy"
          target="_blank"
          rel="noopener noreferrer"
        >
          Read what is stored and why
        </a>
      </AboutSection>
    </div>
  );
}

/**
 * How long the panel takes to fade in or out, in milliseconds.
 *
 * **Mirrored by `aboutFade` in style.css.** The player lobby holds the panel
 * mounted for exactly this long after it is closed, so a stylesheet that
 * disagreed would either cut the fade off or leave a fully transparent panel
 * holding the scroll box open after it.
 */
export const ABOUT_FADE_MS = 240;

type PanelProps = {
  /**
   * Which placement this is. Only ever a class hook — the copy is identical
   * on all three, and the differences are entirely about how the container
   * arrives on screen.
   */
  variant: "landing" | "host" | "player";
  /** Renders the ✕ in the panel's top-right corner. */
  onClose?: () => void;
  /**
   * Playing its fade-out and about to be unmounted. Only the player lobby has
   * one to play — the other two either slide or unmount outright.
   */
  leaving?: boolean;
};

/**
 * `AboutContent` in a cream card with a heading and, where it has one, a ✕.
 *
 * The heading is the panel's accessible name rather than a bare landmark
 * label, so the section announces as what it is on the two screens where it
 * shares the viewport with the thing it opened from.
 */
export function AboutPanel({ variant, onClose, leaving }: PanelProps) {
  const classes = ["about-pane", `about-pane--${variant}`];
  if (leaving) classes.push("about-pane--leaving");
  return (
    <aside className={classes.join(" ")}>
      <div className="about-pane__card">
        <header className="about-pane__head">
          <h2 className="about-pane__title">About the game</h2>
          {onClose && (
            <button
              type="button"
              className="about-pane__close"
              aria-label="Close about the game"
              onClick={onClose}
            >
              {/* Drawn, not typed — the same reasoning as `HostExit`: Bungee
                  has one weight, and a glyph's side bearings sit it off-centre
                  in a round button by a pixel or two. */}
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
              </svg>
            </button>
          )}
        </header>
        <div className="about-pane__body">
          <AboutContent />
        </div>
      </div>
    </aside>
  );
}

/**
 * The text link that opens it — the same object in all three corners it
 * appears in, so it cannot be styled three ways for one job.
 *
 * Underlined, because on Landing it sits on the same line as the version
 * number in the same quiet type, and the underline is the only thing telling
 * the two apart.
 */
export function AboutLink({
  className,
  onClick,
}: {
  className?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={className ? `about-link ${className}` : "about-link"}
      onClick={onClick}
    >
      about the game
    </button>
  );
}
