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
