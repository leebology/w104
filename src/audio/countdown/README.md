# countdown

A **lead-in**, not a sting. It plays once over the Get Ready card and hands
straight over to the `gameplay/` track the instant it finishes — the join is
driven off this clip's own end, not off the phase change, so the two butt up
with no gap and no fade.

It plays on every countdown **except the one before round one**, where the
gameplay track is already running (it started at the category vote) and there is
nothing to lead into.

## Replacing this clip means changing two numbers

The current file is **7.312 seconds**. Two constants are written down from it:

- `LEAD_CLIP_MS` in `shared/music.ts` — the measured length.
- `COUNTDOWN_MS` in `shared/reduce.ts` — how long the card stays up. It must be
  **at least** the clip length or the last bar is cut off, and it is rounded up
  rather than matched exactly, since a little slack is inaudible and a shortfall
  is not.

`shared/music.test.ts` fails if those two disagree, so a swapped clip will tell
you rather than quietly clipping.

**The number on the card is not affected by either.** It counts 5 down to 1
whatever the clip's length, and the *step* stretches to fill it — see
`shared/countdown.ts`. That is the whole reason the count is derived rather
than read off a seconds clock: a card counting whole seconds would open on
whatever this file's length happened to round up to, and swapping the music
would silently change what the room chants.

Prefer `.ogg` here and in `gameplay/`: MP3 encoder padding puts a few
milliseconds of silence at both ends of the file, which is exactly where the
join happens.
