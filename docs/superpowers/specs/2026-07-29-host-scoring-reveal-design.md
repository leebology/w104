# Host scoring reveal — design

Status: implemented.
Brief: `design_handoff_host_scoring_reveal/` (README is the spec, CLAUDE.md the
working notes).

The host results screen stops being a static table. It becomes three frames the
room watches together: the cards deal in, every list fills a line at a time with
duplicates striking through as they collide, and then the cards swap into final
order and the top three take medals.

## The shape of it

All of the state is `phase` plus **one integer**, `step` — the number of lines
revealed so far. Everything visible is derived from that integer against a
schedule built once:

- which words are on screen (`stepOf`)
- which are struck, and whether the strike was a back-check (`rowView`)
- whose emoji trails a word, and when the trail last grew
- what each UNIQUE count reads (`cardView`)
- what rank each card ends on (`finalRanks`)

`shared/reveal.ts` holds all of it and knows nothing about the DOM, so it tests
in milliseconds — `shared/reveal.test.ts` covers back-checking, the cascade, the
count-down, the tie rule and the seeded orders. `HostScoring.tsx` owns the
timers, the classes and the FLIP measurement, and nothing else.

**Nothing is stored per row and nothing is diffed.** That is the whole design.
FAST FORWARD is `setStep(lastStep)`, and a dev step-through would be `step + 1`
— neither is a second code path.

## Decisions

- **One card per player, not two.** `.card.id-card` and `.card.list-card` were
  siblings, each with a 3px border and a 6px shadow, with a 12px gap between.
  Merged behind a 1px `--card-rule` hairline they give back around 30px of
  vertical per column, which is what makes the six-to-ten player two-row layout
  readable. It is also what lets the penalty ring cover the whole reaction
  instead of half a card flinching.
- **The identity block is two lines.** Name on its own full-width line, then
  RANK and the stat pair beneath. On one row the name collides with the stats
  for anything over about five characters inside a 240px track; the measured
  room for a 14-character Bungee name went from far too little to 184px.
- **A word never appears pre-struck.** `struckAt` is never earlier than the
  row's own step, and the strike animation is delayed by the row-enter duration
  on the line's own reveal (zero on a back-check). The line always lands in
  plain ink and is drawn through after.
- **The active card does not flinch at its own words.** `cardView.flinchAt`
  reports only back-check strikes, so the ring and the dip belong to the cards
  being caught out. The revealing card takes the teal offset shadow and nothing
  else — no scale; the card must not change size.
- **The strike rule is derived, never diffed.** A row renders struck once any
  partner is already on screen, so back-checking is automatic: a column revealed
  five beats ago flips the instant a later column lands its word, with nothing
  watching for it.
- **UNIQUE opens at TOTAL and only counts down.** It reads `—` through frame 1:
  nothing is revealed, so there is no provisional score, and a number there
  would be read as one.
- **RANK reads `—` until the swap frame.** Deal order is not rank. Hiding the
  line would shift the row's height when the real one arrives.
- **Pacing is uniform and never batched.** One line, identical interval,
  whatever the list length. No accelerating stagger, no length-scaled timing, no
  threshold past which lines batch. A ten-player wall taking 95 seconds is
  acceptable — FAST FORWARD is the escape valve — because the single cadence is
  the point: it pulls the whole room to the same word at the same moment.
- **The inter-column pause is not dead time.** The next card shakes through all
  of it, so the beat is a cue rather than a stall.
- **Only the active column auto-scrolls.** A back-check landing elsewhere must
  not yank a column away from where the room is looking.
- **Consecutive strikes must restart, not coalesce.** An identical `animation`
  string does not re-trigger, so the ring, the dip, the stat blink and the trail
  pop each exist as two identical copies (`…A` / `…B`) alternated by the parity
  of the step they fired on. Without this, back-to-back strikes read as a
  deliberate cooldown. The parity is derived, not stored.
- **The penalty ring lives on an overlay child**, `.card__penalty`. On `.card`
  itself it fights the card's hard offset shadow. Its feathering is the single
  blur in the design system, and it is a light effect *inside* a card rather
  than a shadow *under* one.
- **The swap is measured, not calculated.** The DOM stays in deal order for the
  screen's whole life; each column is translated to the slot its rank earns it
  from `getBoundingClientRect` deltas. The grid's arithmetic — two rows, a short
  last row, the 20vw cap — is therefore never duplicated in the driver.
  Vertical travel leads and horizontal trails it by 180ms **only when the card
  changes rows**, which is what stops an eight-player two-row swap reading as a
  shuffle.
- **The podium is flat graphic.** No glow, no blur, no sparkle: a plaque on the
  house `-2.5deg` angle at the card's top-right, opposite the team badge, plus
  the existing hard offset shadow recoloured from ink to the medal.
- **Ties share a place and the next place skips** (`1, 2, 2, 4`), on equal
  `unique` *and* equal `total`. A tie for first is two gold plaques and no
  silver, which falls out of the rank numbers rather than needing a case.
- **The footer swap is guarded three ways**, because a host mashing FAST FORWARD
  would otherwise land the second press on STANDINGS and blow past the results:
  the two buttons never share a hit target (left inset vs centred), the footer
  is deliberately *empty* for 480ms between them, and STANDINGS ignores clicks
  through its 280ms entry. ≈920ms of dead window, longer than a mash interval.
  It fires the moment the reveal is over — run out or skipped — so FAST FORWARD
  is never left on screen with nothing to skip.
- **FAST FORWARD is a compressed run, not a hard cut.** Every outstanding strike
  lands on one frame, the grid takes a single 320ms ring together as the
  acknowledgement, and frame 3 then runs at 1.6×. The room sees "all of that
  happened" rather than a jump cut, and the podium still arrives as a moment.
- **Text that does not fit clips and travels.** Measured, not
  `container-type: inline-size` — that zeroes an element's intrinsic width
  contribution and collapses a shrink-to-fit team badge to nothing. `--travel`
  is `content width − run width`, clamped at zero, re-measured on
  `document.fonts.ready` (Bungee is much wider than the fallback and lands after
  first paint) and on resize. Anything that fits gets `0px` and never moves.
  The clip box carries the pop and the run carries the travel, one transform
  each, so the two never fight.
- **Reduced motion is the settled end state, not "animations removed".** The
  screen renders in final order, fully revealed, struck, ranked, plaqued, with
  STANDINGS already in the footer, on first paint.

## Four new tokens

`--penalty #8E0B24` (the strike moment), `--penalty-soft #BA1B40` (the ring),
`--silver #C9CDD4`, `--bronze #C08457`. Gold was already a token. `--penalty` is
darker and less saturated than `--pink` on purpose so it never reads as brand
pink, and both penalty colours live only inside cream cards, never on the field.

## Deliberately not done

- The prototype's review controls — play/pause, replay, step +1, start/mid/end
  jumps, and the whole Tweaks panel. They are scaffolding for dialling in
  timings, not product UI. Every timing they expose is shipped at its
  recommended value as a constant in `HostScoring.tsx`.
- `splitStrike`, and the `shortest`/`longest`/`duplicates` orders. The
  machinery for them is in `shared/reveal.ts` and unit-tested, because it costs
  nothing there and picking a different order later is then a one-word change;
  the screen ships `random` columns and `entry` lines.
- The prototype's room-chip trim to `JOIN AT OKAYNAMEONE.APP`. That is an
  artefact of the 1200px design basis, where the full label collides with the
  centred round marker. On a real TV viewport it fits.
