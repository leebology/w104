# gameplay

The round's music, and the longest continuous stretch in the game. It starts at
the **category vote**, plays through the **countdown** before round one without
a break, and loops through **round one itself** — one piece across three
screens, never restarted at a seam.

From round two on it is picked up by the `countdown/` lead-in, which hands over
to it exactly as it ends.

It stops when the Time's Up card takes over.

Drop one `.mp3` or `.ogg` in here. The filename does not matter — but prefer
`.ogg`, both because this track loops (an MP3's encoder padding ticks at the
seam) and because the lead-in joins onto its first sample.
