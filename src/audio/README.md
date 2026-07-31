# Music

One folder per piece of music. Drop a single `.mp3` or `.ogg` into a folder and
it plays — **the filename does not matter**, so swapping a track is a drag and a
delete, never a rename. Vite discovers whatever is in here at build time
(`tracks.ts`), hashes it, and ships it as a normal asset.

| Folder                | Plays on                                        | Loops |
| --------------------- | ----------------------------------------------- | ----- |
| `lobby/`              | lobby, team select                              | yes   |
| `countdown/`          | the Get Ready card, as a lead-in                | no    |
| `gameplay/`           | category vote → countdown → the round           | yes   |
| `times_up/`           | the Time's Up card at the end of a round        | no    |
| `round_results/`      | the scoring reveal                              | yes   |
| `midgame_standings/`  | the standings between rounds                    | no    |
| `endgame_standings/`  | the final standings                             | no    |

**Music is host-only.** It plays on the device that created the lobby — the TV —
and never on a player's phone. `HostView` is the only caller of `useMusic`, and
a phone never mounts it.

## How the pieces fit together

A track carries across a screen change when both screens name the same scene —
that is the whole mechanism, and `sceneFor` in `shared/music.ts` is where it is
decided. Two consequences worth knowing:

- **The round's music is one unbroken stretch across three screens.** It comes
  up at the category vote, plays through the countdown before round one, and
  loops through the round. No restart at either seam.
- **The countdown is a lead-in, not a sting.** It hands over to `gameplay/` the
  instant its clip ends — driven off the clip, not the phase change, so the two
  butt up with no gap and no fade. Round one is the one countdown that does not
  get it, because the track it would lead into is already playing.
- **If somebody un-readies**, the lead-in stops and the interrupted track
  restarts from the beginning after a one-second beat. Coming back on the same
  frame reads as a glitch rather than as a return.

## Beds and cues

A **bed** loops under a screen; a **cue** plays once. The distinction decides
what an *empty* folder means, which is the more useful half of it:

- An empty **bed** is silence — the screen changed and there is nothing under it.
- An empty **cue** is simply **no cue**: nothing is interrupted and whatever is
  playing carries on.

It also decides how a track *arrives*. A cue has an attack to land on a moment,
so **whatever was playing stops dead as it starts** — no overlap, because four
hundred milliseconds of the old track over a lead-in's first bar is two songs at
once rather than a transition. Beds crossfade with each other over 400ms, since
the point of a bed is not to announce itself.

That is why both standings folders are cues. Leaving them empty is a real
setting, and the one currently in use for `midgame_standings/`: the
`round_results/` track just keeps playing from the reveal into the standings.
Drop a file in and it takes over, with nothing else to change.

## Levels

There is no master volume — the TV has one, and that is the one people reach
for. What there is, is a per-scene trim: `LEVELS` in `shared/music.ts`, `0..1`,
applied as the ceiling a fade climbs to rather than on top of one.

A scene with no entry plays at the level it was mastered at, so an entry there
means "this track is out against the others". Currently only
`round_results/` is trimmed, to `0.8`.

## Rules

- **One track per folder.** Both encodings of the *same* track is fine — if
  `lobby/` holds an `.mp3` and an `.ogg`, the browser takes the ogg where it
  can (no encoder padding, so the loop has no tick) and the mp3 on Safari, which
  does not play ogg at all. Two *different* tracks in one folder is not
  supported; the first by filename wins.
- **Prefer `.ogg` for `countdown/` and `gameplay/`.** Those two are joined
  sample to sample, and MP3 padding is silence at exactly the join.
- **Replacing the countdown clip means changing two constants.** It is the one
  place a dragged-in file couples to the server — see `countdown/README.md`. A
  test fails if you forget.
- **Nothing else belongs in these folders.** Only `.mp3` and `.ogg` are picked
  up, but stray album art still gets committed and shipped — delete it.
