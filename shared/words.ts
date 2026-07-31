/**
 * The room code space: every code is one of these words, uppercased.
 *
 * Four letters because Landing's join control is four single-letter boxes
 * (`CODE_LEN` in `src/screens/Landing.tsx`), and real words because the code
 * gets read off a TV and shouted across a room — `PLUM` survives that trip and
 * `XQVB` does not. Those two constraints, not the list, are the design.
 *
 * The list itself is just how much of that space is claimed, and it started at
 * 85 words. That was a live capacity bug, not a tidiness one: room creation is
 * self-guarding (the DO refuses an occupied code and the client rolls another,
 * capped at `MAX_CODE_ATTEMPTS` in `src/App.tsx`), so with N rooms live out of
 * 85 a create fails outright at roughly (N/85)^6 — about one create in ten at
 * sixty concurrent games. At any length in the hundreds that cliff is gone,
 * which is why the floor in `words.test.ts` sits well below the current count:
 * words get deleted here on taste, and that must never break a build.
 *
 * What the length does *not* fix is enumeration. Eight hundred codes is eight
 * hundred requests, and no word list anyone can shout across a room is large
 * enough to change that. The request budget in `party/server.ts` is what
 * addresses it; growing this list only raises the cost of a sweep.
 *
 * Enforced by `words.test.ts`: exactly four letters, lowercase `a`–`z`, no
 * duplicates, alphabetical, nothing on the profanity blocklist.
 *
 * Judgement calls, which no test can make — a code has to survive being
 * shouted across a noisy room and typed by someone who only heard it, so the
 * list deliberately holds no:
 *
 * - **homophones**, in or out of the list — `flew`/`flue`, `pair`/`pear`,
 *   `sail`/`sale`. Hearing one and typing the other lands on a dead code.
 * - **words spelled unlike they sound** — `hymn`, `debt`, `gnaw`, `wren`.
 * - **words with two pronunciations** — `read`, `live`, `tear`, `wind`.
 * - **spelling variants** — `grey`/`gray`, `curb`/`kerb`, `tire`/`tyre`.
 * - **function words** — `onto`, `such`, `very`, `with`. Common enough; they
 *   just do not read as a name for anything.
 * - **bare past tenses** — `gave`, `took`, `sang`, `went`. A past tense that
 *   also has its own noun or adjective sense is fine and several are here on
 *   purpose: a *bent* nail, a *felt* tip, the *left*, a *lost* dog, a *shot* of
 *   espresso, a *rose*, a plaster *cast*. The test is whether the word names
 *   something, not whether it happens to be a verb somewhere else.
 *
 * Everything left is a concrete, familiar thing with one obvious spelling.
 */
export const CODE_WORDS = [
  "able", "acid", "ally", "aloe", "apex", "arch", "area", "army",
  "atom", "aunt", "auto", "axis", "axle", "baby", "back", "bait",
  "bake", "bald", "ball", "band", "bank", "barn", "bash", "bath",
  "bead", "beam", "beef", "bell", "belt", "bend", "bent", "bike",
  "bill", "bind", "bird", "blob", "blot", "blur", "boat", "body",
  "boil", "bold", "bolt", "bond", "bone", "book", "boom", "boot",
  "boss", "bowl", "brag", "brew", "brim", "brow", "bulb", "bulk",
  "bull", "bump", "bunk", "burn", "bush", "busy", "buzz", "cafe",
  "cage", "cake", "calf", "call", "calm", "camp", "cane", "cape",
  "card", "care", "carp", "cart", "case", "cash", "cast", "cave",
  "chap", "chat", "chef", "chew", "chin", "chip", "chop", "city",
  "clam", "clan", "clap", "claw", "clay", "clip", "clog", "club",
  "clue", "coal", "coat", "code", "coil", "coin", "cold", "colt",
  "cone", "cook", "cool", "cope", "copy", "cork", "corn", "cost",
  "cove", "crab", "cram", "crew", "crib", "crop", "crow", "cube",
  "cuff", "cult", "cure", "curl", "damp", "dark", "dart", "dash",
  "data", "date", "dawn", "deal", "dean", "deck", "deed", "deep",
  "demo", "dent", "deny", "desk", "dial", "dice", "diet", "dime",
  "dine", "dirt", "dish", "dive", "dock", "doll", "dome", "doom",
  "door", "dose", "down", "doze", "drag", "draw", "drip", "drop",
  "drum", "duck", "duct", "dude", "duet", "duke", "dull", "dune",
  "dunk", "dusk", "dust", "duty", "ease", "east", "easy", "echo",
  "edge", "edit", "envy", "epic", "exam", "exit", "face", "fact",
  "fade", "fail", "fake", "fall", "fame", "farm", "fast", "fate",
  "fear", "feed", "feel", "felt", "fern", "feud", "file", "fill",
  "film", "find", "fine", "fire", "firm", "fish", "fist", "five",
  "flag", "flap", "flat", "flaw", "flex", "flip", "flop", "flow",
  "foam", "foil", "fold", "folk", "font", "food", "fool", "foot",
  "fork", "form", "fort", "frog", "fuel", "full", "fume", "fund",
  "fuse", "fuss", "fuzz", "gain", "gala", "gale", "game", "gang",
  "gasp", "gaze", "gear", "germ", "gift", "gill", "girl", "give",
  "glad", "glee", "glow", "glue", "glum", "goal", "goat", "gold",
  "golf", "gong", "good", "gown", "grab", "gram", "grid", "grim",
  "grin", "grip", "grit", "grow", "grub", "gulf", "gull", "gulp",
  "guru", "gust", "half", "halo", "halt", "hand", "hang", "harm",
  "harp", "hash", "hate", "hawk", "haze", "head", "heap", "heat",
  "helm", "help", "hemp", "herb", "hero", "hide", "high", "hike",
  "hill", "hilt", "hint", "hive", "hoax", "hold", "home", "hone",
  "honk", "hood", "hoof", "hook", "hoop", "hoot", "hope", "horn",
  "hose", "host", "howl", "huge", "hulk", "hull", "hump", "hunt",
  "hurl", "hush", "husk", "icon", "idea", "inch", "iris", "iron",
  "itch", "item", "jade", "jazz", "jeep", "jinx", "join", "joke",
  "jolt", "jump", "junk", "jury", "kale", "keel", "keen", "keep",
  "kelp", "kick", "kind", "king", "kiss", "kite", "kiwi", "lace",
  "lady", "lair", "lake", "lamb", "lamp", "land", "lane", "lark",
  "lash", "last", "late", "lava", "lawn", "leaf", "lean", "leap",
  "left", "lend", "lens", "lick", "life", "lift", "like", "lily",
  "lime", "limp", "line", "link", "lint", "lion", "list", "load",
  "loaf", "lobe", "lock", "loft", "logo", "long", "look", "loom",
  "loop", "lord", "loss", "lost", "loud", "love", "luck", "lull",
  "lump", "lung", "lure", "lurk", "lush", "make", "malt", "mare",
  "mark", "mash", "mask", "mass", "mast", "mate", "math", "meal",
  "mean", "meek", "melt", "memo", "mend", "menu", "mesh", "mess",
  "mice", "mild", "mile", "milk", "mill", "mime", "mind", "mine",
  "mint", "mist", "moat", "mock", "mode", "mole", "monk", "mood",
  "moon", "moss", "moth", "move", "mule", "mull", "mush", "musk",
  "mute", "myth", "nail", "name", "navy", "near", "neat", "neck",
  "neon", "nest", "news", "next", "nice", "nick", "nine", "node",
  "nook", "noon", "nose", "note", "noun", "nova", "oath", "obey",
  "oboe", "omen", "onyx", "ooze", "opal", "open", "oval", "oven",
  "pace", "pack", "pact", "page", "palm", "pant", "park", "part",
  "pass", "path", "pave", "pawn", "peck", "pelt", "perk", "pest",
  "pick", "pike", "pile", "pill", "pine", "pink", "pint", "pipe",
  "pity", "plan", "play", "plea", "plot", "ploy", "plug", "plum",
  "plus", "poem", "poet", "poke", "polo", "pond", "pony", "pool",
  "pork", "port", "pose", "posh", "post", "pout", "pram", "prod",
  "prom", "prop", "pull", "pulp", "pump", "punt", "pure", "purr",
  "push", "quid", "quip", "quit", "quiz", "race", "rack", "raft",
  "rage", "raid", "rail", "rake", "ramp", "rank", "rant", "rare",
  "rash", "rate", "rave", "reap", "rear", "reef", "rely", "rent",
  "rest", "rice", "rich", "ride", "rift", "rind", "ring", "rink",
  "riot", "ripe", "rise", "risk", "roar", "robe", "rock", "roof",
  "rook", "room", "rope", "rose", "rosy", "rude", "ruin", "rule",
  "runt", "rush", "rust", "sack", "safe", "saga", "sage", "sake",
  "salt", "same", "sand", "sane", "sash", "save", "scan", "scar",
  "seal", "seat", "seed", "seek", "self", "send", "shed", "shin",
  "ship", "shoe", "shop", "shot", "show", "shut", "sick", "side",
  "sift", "sigh", "sign", "silk", "sill", "silo", "sing", "sink",
  "size", "skid", "skim", "skin", "skip", "slab", "slam", "slap",
  "sled", "slim", "slip", "slit", "slot", "slow", "slug", "smog",
  "snag", "snap", "snip", "snow", "snug", "soak", "soap", "sock",
  "soda", "sofa", "soft", "soil", "solo", "song", "soon", "soot",
  "sort", "soup", "sour", "span", "spin", "spot", "spur", "stab",
  "stag", "star", "stay", "stem", "step", "stew", "stir", "stop",
  "stow", "stub", "stun", "surf", "swan", "swap", "swat", "sway",
  "swim", "tack", "taco", "tact", "take", "talk", "tall", "tame",
  "tank", "tape", "tarp", "tart", "task", "taxi", "teal", "tech",
  "tell", "tend", "tent", "term", "test", "text", "thaw", "thin",
  "thud", "tick", "tidy", "tile", "tilt", "time", "tint", "tiny",
  "toga", "toil", "toll", "tone", "tool", "toss", "tour", "town",
  "trap", "tray", "tree", "trek", "trim", "trio", "trip", "trot",
  "true", "tuba", "tube", "tuck", "tuft", "tuna", "tune", "turf",
  "tusk", "twig", "twin", "type", "typo", "ugly", "undo", "unit",
  "urge", "user", "vase", "vast", "veal", "veer", "vent", "verb",
  "vest", "veto", "vibe", "vice", "view", "vine", "visa", "void",
  "volt", "vote", "wage", "wake", "walk", "wall", "wand", "want",
  "ward", "warm", "warn", "warp", "wart", "wash", "wasp", "wave",
  "wavy", "waxy", "weed", "weep", "weld", "well", "west", "whim",
  "whip", "wick", "wide", "wife", "wild", "will", "wilt", "wine",
  "wing", "wink", "wipe", "wire", "wise", "wish", "wisp", "wolf",
  "wood", "wool", "word", "work", "worm", "yard", "yarn", "yawn",
  "year", "yell", "yelp", "yoga", "zeal", "zero", "zest", "zinc",
  "zone", "zoom",
] as const;

/** `rand` is injectable so tests are deterministic. */
export function makeRoomCode(rand: () => number = Math.random): string {
  const i = Math.min(Math.floor(rand() * CODE_WORDS.length), CODE_WORDS.length - 1);
  return CODE_WORDS[i].toUpperCase();
}
