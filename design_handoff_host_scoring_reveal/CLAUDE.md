# CLAUDE.md — implementing the Host Scoring reveal in w104

Read `README.md` in this folder first. It is the spec. This file is the working brief:
what to change, in what order, and the traps.

## Task

Implement the host round-scoring screen and its three-phase reveal animation in the
existing `w104` codebase. **Recreate the design in React + `src/style.css`** — do not
port the HTML prototypes, and do not copy `support.js` (prototype runtime only).

The components you need already exist:

- `src/screens/host/HostScoring.tsx` — screen shell and column grid
- `src/screens/host/HostHeader.tsx` — room chip / round marker / results title
- `src/components/WordList.tsx` — word rows
- `src/components/TeamBadge.tsx` — team badge tab
- `src/components/RoomChip.tsx` — room code chip
- `src/shared/scoring.ts` — `ScoredEntry`, `alsoBy`
- `src/style.css` — all tokens (`:root`) and all keyframes

## Non-negotiables

- **Tokens only.** No loose hex outside `:root`. Add exactly four: `--penalty #8E0B24`,
  `--penalty-soft #BA1B40`, `--silver #C9CDD4`, `--bronze #C08457`.
- **No `color-mix()`, no `oklch()`, no relative colour syntax.** The prototype mixes hex
  numerically in JS to build its intensity sliders; shipped code takes the fixed token.
- **No soft shadows.** Every shadow is a hard offset in ink. The single exception is the
  penalty ring's feathering, which is a light effect *inside* a card, never a shadow
  *under* one.
- **`--border` and `--radius` never animate.** Motion may translate, rotate and scale.
- **The screen never scrolls.** `100dvh`, only `.word-list` scrolls internally. No motion
  may grow the layout or push the footer off-screen.
- **`.card` must not use `overflow: hidden`** — the team badge overhangs its top-left
  corner. Any effect that would clip it is out.
- **Every animation degrades under `prefers-reduced-motion: reduce`** to the settled end
  state, not to "no animation". See README → Reduced motion.
- Both solo and team play throughout. Team is the tighter layout — check it first.

## Order of work

### 1. Tokens
Four additions to `:root`. Nothing else.

### 2. Static screen
Reviewable and ship-able on its own; every frame depends on it.

- Merge `.card.id-card` + `.card.list-card` into **one card** split by a `1px --rule`
  hairline (`margin: 7px 0`).
- Identity block becomes **two lines**: avatar + name full-width, then `RANK n` + the
  stat pair. Fixes the name/stat collision at any name over ~5 characters.
- Padding: card `10px`, head-block gap `4px`. Team play: `padding-top: 15px` for the
  badge overhang, member strip above `RANK n` at `19px`.
- Word rows get clip boxes: word `flex: 1 1 0; min-width: 60%`, trail
  `flex: 0 1 auto; max-width: 40%`, both `overflow: hidden`. Inner runs are
  `inline-block; white-space: nowrap`.
- Marquee measurement hook (see Trap 1).

### 3. The schedule — pure logic, no CSS
Player order (`playerOrderMode`) → line order within each player (`revealOrderMode`) → a
flat `stepOf[playerId + ":" + wordIndex]` map plus `colStart[playerId]`.

Everything visible derives from one integer `step` against that map: struck state,
UNIQUE counts, the emoji trail, rank. **Nothing is stored per row and nothing is
diffed.** Unit-test this. Get back-checking and the tie rule right here, before any CSS.

The payoff: FAST FORWARD and step-through are both just `step` assignments.

### 4. Frame 2 — all the risk lives here
Row enter, strike, trail pop, penalty ring, card dip, stat blink, active-column shadow,
list auto-scroll, next-column shake cue. **Build a step-forward-one-line dev control
first** — the back-check, the growing trail and the simultaneous multi-card reaction all
happen inside one interval and cannot be judged in motion.

### 5. Frame 1
Straightforward once the card is right.

### 6. Frame 3
FLIP swap (wrapper Y first, card X 180ms later), then the plaques.

### 7. Footer swap and its guard

### 8. Reduced motion
Verify as an end state, not as "animations removed".

---

## Traps

**1 · The marquee needs measurement, not `container-type`.**
`container-type: inline-size` zeroes an element's intrinsic width contribution, which
collapses a shrink-to-fit team badge to nothing. Measure instead: `--travel =
clipWidth - scrollWidth`, clamped at 0, written as an inline custom property.
**Re-measure on `document.fonts.ready` and on resize**, not just on mount — Bungee is much
wider than the fallback and loads after first paint, so a mount-only measurement reports
"it fits" for runs that then overflow. Anything that fits gets `0px` and never moves.

**2 · Consecutive strikes must restart, not coalesce.**
An identical `animation` string does not re-trigger. `penaltyBlink`, `statBlink` and
`popIn` each need two identical copies (`…A` / `…B`) alternated per revealed line, or
back-to-back strikes look like a deliberate cooldown. This was a real bug in review.

**3 · The tie must be asserted on the outcome, not the inputs.**
Equal list lengths and equal shared counts still derive *different* unique totals, because
collisions depend on what everyone else wrote. To force a tie, swap words in and out of
one list (length preserved) until its derived unique matches its neighbour's. Ties share a
place and the next place skips (`1, 2, 2, 4`); a tie for first means two gold plaques and
no silver.

**4 · The penalty ring goes on an overlay child, never on `.card`.**
`.card__penalty` — `position: absolute; inset: 0; border-radius: calc(var(--radius) -
3px); pointer-events: none; opacity: 0`. On `.card` itself it fights the hard offset
shadow. (If you keep the two-card structure instead of merging, the ring has to cover
both cards or the reaction reads as half a card flinching.)

**5 · Only the active column auto-scrolls.**
A back-check strike landing in another column must not yank that column away from wherever
the room is looking.

**6 · The active card does not flinch at its own words.**
No ring, no dip, and no size change — it takes the teal offset shadow and `z-index: 4`
only. The penalty belongs to the cards being caught out.

**7 · The inter-column pause is not dead time.**
The next card shakes for its full duration. Land them as one beat or the pause reads as a
stall.

**8 · Never batch or accelerate the line cadence.**
One line at a time, identical interval, regardless of list length. No accelerating
stagger, no length-scaled timing, no batching past a threshold. A 95-second ten-player
reveal is acceptable — FAST FORWARD is the escape valve. This is the phase's whole point:
the room looks at the same word at the same moment.

**9 · A word never appears pre-struck.**
The line always lands in plain ink first; the strike draws through it after (delayed by
the row-enter duration on its own reveal, immediate on back-check).

**10 · Guard the footer swap.**
A host mashing FAST FORWARD will otherwise land a second press on STANDINGS and blow past
the results. Three overlapping guards: different position (left inset vs centred), a
480ms deliberately-empty footer between them, and `pointer-events: none` during
STANDINGS' 280ms entry. ≈920ms total dead window.

**11 · Keep staging's room-chip label.**
The prototype trims it to `JOIN AT OKAYNAMEONE.APP` because at the 1200px design basis the
full string collides with the absolutely-centred round marker. On a real TV viewport it
fits — keep `JOIN AT {location.host} · CODE:`. The trim is a prototype artefact.

---

## Definition of done

- [ ] Four new tokens in `:root`; no loose hex anywhere; no `color-mix()`/`oklch()`
- [ ] Solo and team both correct at 2, 5, 6 and 10 players
- [ ] Team badge sizes to its name up to the card width, then clips and travels
- [ ] Long names and long words clip and travel; short ones never move
- [ ] Emoji trail scrolls rather than clipping; word keeps at least 60% of the row
- [ ] Back-check verified by stepping one line at a time: already-revealed columns flip
      at the moment a later column lands, and the trail grows
- [ ] Last column produces a simultaneous cascade; first column strikes nothing
- [ ] Card and UNIQUE flash on **every** strike, including consecutive ones
- [ ] `UNIQUE` counts down only, starts at `—` in Frame 1, resolves to TOTAL as Frame 2
      opens
- [ ] Ties share a place; the next place skips; a tie for first shows two golds
- [ ] Zero-unique and empty-list players both render correctly
- [ ] 8-player two-row swap reads as travel, not a shuffle
- [ ] Footer never lets a mashed press reach STANDINGS
- [ ] `prefers-reduced-motion` shows the settled end state, fully readable, no motion
- [ ] Footer button never leaves the screen at any player count or list length
