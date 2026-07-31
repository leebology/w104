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
you rather than quietly clipping. Note that the card counts down in whole
seconds, so the number the room sees starts from the clip's length rounded up.

Prefer `.ogg` here and in `gameplay/`: MP3 encoder padding puts a few
milliseconds of silence at both ends of the file, which is exactly where the
join happens.
