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
  where: string;
  /** Artist. Omitted until confirmed. */
  by?: string;
  /** Library or site it came from. Omitted until confirmed. */
  from?: string;
};

const TRACKS: Track[] = [
  { title: "Awesome Call", where: "The room and team select" },
  { title: "Game-main", where: "The category vote and the round" },
  { title: "Game-lead", where: "The countdown into a round" },
  { title: "Podcast Outro Stinger", where: "Time's up" },
  { title: "Boogie Party", where: "The scoring reveal and the standings" },
  { title: "Brass Funk Jingle", where: "The final podium" },
];

function TrackCredit({ track }: { track: Track }) {
  const attribution = [track.by, track.from].filter(Boolean).join(" · ");
  return (
    <li className="about__credit">
      <span className="about__credit-title">{track.title}</span>
      <span className="about__credit-meta">
        {track.where}
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
      <AboutSection title="What this is">
        <p className="about__p">
          Ok, Name One is a party game for a room and their phones. One device
          — a TV, a laptop, anything with a big screen — opens a room and shows
          it; everyone else joins from a phone. The room votes on the
          categories, then races to name things in them before the timer runs
          out.
        </p>
        <p className="about__p">
          The catch is that you only score for a word <em>nobody else wrote</em>.
          The obvious answer is the one everybody has. Being right is not the
          game; being the only one who was is.
        </p>
      </AboutSection>

      <AboutSection title="How it was built">
        <p className="about__p">
          It started as a question about whether a whole realtime party game
          could be built and run without paying for anything, and it still runs
          entirely on free tiers. The screen you're reading is a React app; the
          rooms themselves live on Cloudflare, one small server object per room,
          which is why the room code is all you need to find your way back in.
        </p>
        <p className="about__p">
          Every rule of the game — scoring, the category draw, teams, the
          reveal — is kept apart from both of those and covered by around seven
          hundred and fifty tests, so the parts that decide who won can be
          checked in a second rather than by getting six people in a room.
          Which is not to say we didn't also do that.
        </p>
        <p className="about__p">
          It was written with the help of Claude Code, over rather more evenings
          than originally planned.
        </p>
      </AboutSection>

      <AboutSection title="Music and sound">
        <ul className="about__credits">
          {TRACKS.map((t) => (
            <TrackCredit key={t.title} track={t} />
          ))}
        </ul>
      </AboutSection>

      <AboutSection title="Type">
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
    </div>
  );
}

type PanelProps = {
  /**
   * Which placement this is. Only ever a class hook — the copy is identical
   * on all three, and the differences are entirely about how the container
   * arrives on screen.
   */
  variant: "landing" | "host" | "player";
  /**
   * Renders the ✕. Omitted where the panel has no close button of its own
   * because something else dismisses it — the player lobby, where scrolling
   * back to the top is the close.
   */
  onClose?: () => void;
};

/**
 * `AboutContent` in a cream card with a heading and, where it has one, a ✕.
 *
 * The heading is the panel's accessible name rather than a bare landmark
 * label, so the section announces as what it is on the two screens where it
 * shares the viewport with the thing it opened from.
 */
export function AboutPanel({ variant, onClose }: PanelProps) {
  return (
    <aside className={`about-pane about-pane--${variant}`}>
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
