const NS = "w104";

/**
 * localStorage is shared across every tab of an origin, so three tabs would
 * otherwise all claim the same seat. `?p=2` namespaces the keys, which is what
 * makes single-machine testing possible. Real devices never need it.
 */
function key(field: string): string {
  const p = new URLSearchParams(location.search).get("p");
  return p ? `${NS}:${field}:${p}` : `${NS}:${field}`;
}

/**
 * `crypto.randomUUID` only exists in secure contexts (https, or localhost).
 * The spec requires testing over plain http on a LAN IP (e.g.
 * http://192.168.1.42:5173) so a phone on the same Wi-Fi can open a `ws://`
 * socket — an https page cannot. That origin is not a secure context, so
 * `crypto.randomUUID` is undefined there and this fallback is load-bearing,
 * not dead code. Randomness quality doesn't matter: this id only namespaces a
 * seat in a party game.
 */
export function randomUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Stable across reloads and tab closes, so a locked phone reclaims its seat. */
export function getPlayerId(): string {
  const k = key("playerId");
  let id = localStorage.getItem(k);
  if (!id) {
    id = randomUUID();
    localStorage.setItem(k, id);
  }
  return id;
}

/**
 * Which room this device is in, if any. Written when a host opens a room and
 * cleared the moment the room stops being this device's — see `App`.
 *
 * **Host-only, and the `role` field is what says so rather than a comment.**
 * A player refreshing goes back to Landing to type a code, always: the phone
 * is the device somebody picks up to join *the next* room, and resuming into
 * the last one is the app deciding that for them. The TV is the opposite — it
 * has no way back into a room it opened except this, and nobody types a code
 * on it. So the record is kept for one of the two devices and the type is
 * narrowed to match, which makes a player session unwritable rather than
 * written-and-ignored.
 */
export type SavedSession = { code: string; role: "host" };

/**
 * How long a saved session is worth resuming.
 *
 * The server is the real gate — an abandoned room is reaped seconds after its
 * last socket closes, so a stale code simply comes back "no such room". This
 * only decides how long *trying* is worth it: past the window, opening the app
 * is opening the app, not rejoining last night's party. It is generous because
 * the failure mode of too short (the app forgets a game still running upstairs)
 * is worse than the failure mode of too long (one wasted connect, and the
 * landing page a beat later).
 */
const RESUME_WINDOW_MS = 6 * 60 * 60 * 1000;

/**
 * The room to reclaim on a cold start, or null.
 *
 * This is what makes a backgrounded *host* tab survivable. A TV that locks
 * keeps its socket and partysocket reconnects on its own, but a browser is
 * free to discard the page outright — and a discarded page comes back as a
 * *fresh load* with no React state at all, which without this strands a room
 * full of people on a screen nothing is driving.
 *
 * A `"player"` role in storage is refused here as well as being unwritable, so
 * a key left by a build that saved them resolves to Landing rather than
 * resuming one last time on the way past.
 */
export function getSession(): SavedSession | null {
  const raw = localStorage.getItem(key("session"));
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as Partial<SavedSession> & { at?: number };
    if (typeof saved.code !== "string" || saved.code === "") return null;
    if (saved.role !== "host") return null;
    if (typeof saved.at !== "number" || Date.now() - saved.at > RESUME_WINDOW_MS) return null;
    return { code: saved.code, role: saved.role };
  } catch {
    // Anything unparseable is treated as absent rather than thrown: this runs
    // on the first render of the app, and a corrupt key must not be the reason
    // nobody can get to the landing page.
    return null;
  }
}

export function saveSession(session: SavedSession): void {
  localStorage.setItem(key("session"), JSON.stringify({ ...session, at: Date.now() }));
}

export function clearSession(): void {
  localStorage.removeItem(key("session"));
}

export function getProfile(): { name: string; emoji: string } {
  return {
    name: localStorage.getItem(key("name")) ?? "",
    emoji: localStorage.getItem(key("emoji")) ?? "",
  };
}

export function saveProfile(name: string, emoji: string): void {
  localStorage.setItem(key("name"), name);
  localStorage.setItem(key("emoji"), emoji);
}
