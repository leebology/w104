export const CODE_WORDS = [
  "bean", "boat", "book", "cake", "clam", "coal", "corn", "crow",
  "desk", "disk", "door", "drum", "duck", "dust", "fern", "fish",
  "flag", "foam", "fork", "frog", "gate", "goat", "gold", "harp",
  "hawk", "herb", "hill", "hive", "hoof", "iron", "jade", "kelp",
  "kiln", "kite", "lamb", "lamp", "leaf", "lime", "loft", "malt",
  "mask", "mast", "milk", "mint", "moon", "moss", "moth", "nest",
  "opal", "oven", "palm", "pear", "pier", "pine", "plum", "pond",
  "raft", "rain", "reed", "rice", "rope", "rust", "sage", "salt",
  "sand", "seal", "shed", "silk", "sled", "snow", "soap", "spur",
  "star", "surf", "swan", "tent", "tide", "twig", "vase", "vine",
  "wave", "wolf", "wool", "yarn", "zinc",
] as const;

/** `rand` is injectable so tests are deterministic. */
export function makeRoomCode(rand: () => number = Math.random): string {
  const i = Math.min(Math.floor(rand() * CODE_WORDS.length), CODE_WORDS.length - 1);
  return CODE_WORDS[i].toUpperCase();
}
