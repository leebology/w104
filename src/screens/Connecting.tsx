import { useEffect, useState } from "react";

/** How long a connection may take before the screen offers a way out. */
const SLOW_MS = 8_000;

/**
 * Waiting on the first `state` push.
 *
 * A socket that cannot reach the server at all never errors — partysocket just
 * retries — so without the escape hatch below this screen is a dead end: no
 * back button, and a saved session dials it again on the next load. That is the
 * shape of a misconfigured `VITE_PARTYKIT_HOST` on a phone, and of a room whose
 * Worker is simply down. Eight seconds is well past a normal connect and short
 * enough that nobody is left wondering whether to force-quit.
 */
export function Connecting({ onBack }: { onBack?: () => void }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(id);
  }, []);

  return (
    <main className="screen screen--centered">
      <div className="card centered-card">
        <p className="notice">Connecting…</p>
        <p className="notice notice--dim">
          {slow ? "Still trying. Check you're on the same wifi." : "Finding the room."}
        </p>
        {/* Secondary, unlike ErrorScreen's gold "Try again": leaving is not the
            thing to do here, it is the thing to do once the waiting turns out
            to be pointless. */}
        {slow && onBack && (
          <button type="button" className="btn btn--secondary btn--block" onClick={onBack}>
            Back
          </button>
        )}
      </div>
    </main>
  );
}
