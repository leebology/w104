import type { SceneId } from "../../shared/music";

/**
 * Every audio file in every scene folder under `src/audio`, keyed by its path.
 *
 * One glob for all of them rather than one per scene: the folder name *is* the
 * `SceneId`, so adding a scene is a folder and a case in `shared/music.ts`,
 * with nothing to remember here. Eager, because the set is a handful of files
 * and a lazy import would put a network round trip between the phase change and
 * the first note.
 *
 * Vite resolves each match to a hashed asset URL at build time, which is the
 * whole reason the media lives in `src/` rather than `public/`: a `public/`
 * file can only be reached by an exact literal path, and the point of these
 * folders is that **the filename never matters**. Drop a track in, delete the
 * old one, done — no rename, no code change.
 */
const FILES = import.meta.glob("./*/*.{mp3,ogg,MP3,OGG}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

/** Scene id -> its files, sorted by path so the pick is stable across builds. */
const BY_SCENE = new Map<string, string[]>();
for (const path of Object.keys(FILES).sort()) {
  const folder = path.split("/")[1];
  const list = BY_SCENE.get(folder);
  if (list) list.push(FILES[path]);
  else BY_SCENE.set(folder, [FILES[path]]);
}

/**
 * Whether this browser plays Ogg Vorbis.
 *
 * Ogg is preferred where it works because an MP3 carries encoder padding at
 * both ends that no decoder can strip, which is an audible tick every time a
 * loop comes round. Safari does not play Ogg at all, so an ogg-only folder
 * would be silence there — hence a *preference* rather than a requirement, and
 * hence a folder is allowed to hold both encodings of the same track.
 *
 * `canPlayType` returns `""`, `"maybe"` or `"probably"`; anything but empty is
 * a yes. Computed once, lazily, because it needs a DOM element.
 */
let oggOk: boolean | null = null;
function prefersOgg(): boolean {
  if (oggOk === null) {
    oggOk = document.createElement("audio")
      .canPlayType('audio/ogg; codecs="vorbis"') !== "";
  }
  return oggOk;
}

/**
 * The file to play for a scene, or `null` for an empty folder.
 *
 * An empty folder is silence, not an error: the game has to play exactly as it
 * does today with no music at all, so every scene is independently optional.
 */
export function sourceFor(scene: SceneId): string | null {
  const files = BY_SCENE.get(scene);
  if (!files || files.length === 0) return null;
  if (prefersOgg()) {
    const ogg = files.find((url) => /\.ogg(\?|$)/i.test(url));
    if (ogg) return ogg;
  }
  const mp3 = files.find((url) => /\.mp3(\?|$)/i.test(url));
  return mp3 ?? files[0];
}
