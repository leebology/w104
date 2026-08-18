import { useState } from "react";
import { music } from "../audio/music";

/**
 * The room's mute, in the corner of every host screen.
 *
 * **Host-only by construction, like the music itself.** `useMusic` is called
 * from `HostView` alone, so a phone has nothing to mute — there is no
 * per-device check here to get wrong, exactly as there is none in `useMusic`.
 *
 * It wears the `host-exit` shape rather than a `.btn`: gold with a hard shadow
 * means "go forward" in this app, and this is furniture in the corner beside
 * the way out. Unlike the exit it never expands into words on hover — the state
 * *is* the icon, and a speaker with a line through it is not clearer for having
 * "Unmute" written beside it. The label rides as `aria-label` either way.
 *
 * The state is seeded from the player rather than owned here. `music` is a
 * singleton outside React and the mute survives every screen change, so this
 * component is a view of it: a remount (a view jump bumps `viewNonce`, which
 * re-keys the whole screen) re-reads the truth instead of resetting it.
 */
export function MuteButton() {
  const [muted, setMuted] = useState(() => music.isMuted());

  return (
    <button
      type="button"
      className={muted ? "host-mute host-mute--muted" : "host-mute"}
      aria-label={muted ? "Unmute music" : "Mute music"}
      aria-pressed={muted}
      onClick={() => {
        const next = !muted;
        music.setMuted(next);
        setMuted(next);
      }}
    >
      {/* Drawn, not typed, for the reason `HostExit`'s ✕ is: 🔇 is an emoji
          with its own colour and its own side bearings, so it would neither
          take the cream stroke this corner is drawn in nor sit centred in a
          circle. Two strokes on a symmetric viewBox are centred by
          construction and as heavy as `stroke-width` says. */}
      <svg
        className="host-mute__icon"
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
      >
        {/* The cone is one closed path so its fill and its stroke agree at the
            corners; the waves and the cross are strokes over it. */}
        <path
          className="host-mute__cone"
          d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z"
        />
        {muted ? (
          <path d="M16 9.5l4.5 5M20.5 9.5l-4.5 5" />
        ) : (
          <path d="M15.5 9a4.2 4.2 0 010 6M18.5 6.8a7.6 7.6 0 010 10.4" />
        )}
      </svg>
    </button>
  );
}
