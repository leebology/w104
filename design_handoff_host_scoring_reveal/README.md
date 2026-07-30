# Handoff: Host Scoring — static screen + reveal animation

## Overview

The host round-scoring screen for **"Ok, Name One"** (w104) — the TV/laptop view a room
watches after everyone has submitted their answers — plus the full three-phase reveal
animation that plays over it.

Two deliverables:

1. **`Host Scoring.dc.html`** — the static screen, high fidelity, framed for a 16:9 TV.
2. **`Host Scoring Reveal.dc.html`** — the motion spec: the same screen with the reveal
   sequence broken into three independently replayable frames, every timing value
   exposed as a live control, plus a written timing table, keyframe source, new tokens
   and the decisions behind them.

The screen is `100dvh` and **never scrolls**. Only the word list inside each card
scrolls. Any motion that grows the layout or pushes the footer button off-screen is out
of bounds.

## About the design files

The files in this bundle are **design references created in HTML** — prototypes showing
intended look and behaviour, not production code to copy. The task is to **recreate
them in the existing codebase** (`w104`, React + plain CSS in `src/style.css`) using its
established patterns: real components under `src/screens/host/` and `src/components/`,
real tokens in `:root`, real keyframes in `style.css`.

Concretely, the implementation targets already exist:

| Design element | Existing source file |
| --- | --- |
| Screen shell, column grid | `src/screens/host/HostScoring.tsx` |
| Header (room chip, round marker, results title) | `src/screens/host/HostHeader.tsx` |
| Room code chip | `src/components/RoomChip.tsx` |
| Word rows | `src/components/WordList.tsx` |
| Team badge tab | `src/components/TeamBadge.tsx` |
| Avatar set | `src/components/AvatarPicker.tsx` (`AVATARS`) |
| Team accents | `src/shared/teams.ts` (`TEAM_COLORS`) |
| Scoring derivation | `src/shared/scoring.ts` (`ScoredEntry`, `alsoBy`) |
| All tokens, all keyframes | `src/style.css` |

Nothing in this bundle needs a new component tree. It needs the existing one restyled
in two places (identity block, card structure) and animated.

## Fidelity

**High fidelity.** Every colour, size, border, radius, shadow offset, duration, delay,
easing curve and transform value in this bundle is intentional and should be reproduced
exactly. The timing table in the Reveal file is the real deliverable — it is written to
be ported line by line into `src/style.css`.

The one place this bundle **departs from the shipped screen** is called out under
"Deviations from staging" below. Read that section before starting.

---

## Screen: Host Scoring

### Purpose

Show every player's list of answers side by side, mark which answers were duplicated,
and rank the players. The room reads this together from a sofa; the host presses one
button to move on.

### Layout

```
.host-scoring                     1200 × 675 design basis, 16:9, flex column
                                  padding 24px 26px 18px, background --pink
├── HostHeader                    flex row, padding 22px 34px, flex 0 0 auto
│   ├── RoomChip                  LEFT
│   ├── "ROUND 1 / 3"             CENTRED — position:absolute, left:50%,
│   │                             translateX(-50%), pointer-events:none
│   └── "Results · <category>"    RIGHT
├── .results                      flex 1, min-height 0, CSS grid, gap 12px,
│                                 grid-auto-rows minmax(0,1fr), margin 0 auto,
│                                 max-width calc(var(--cols) * 20vw)
│   └── .result-col × N           grid item, min-width 0, min-height 0
│       └── .card                 ONE card per player (see Deviations)
│           ├── identity block    flex 0 0 auto, flex column, gap 4px
│           ├── hairline          1px --rule, margin 7px 0
│           └── .word-list        flex 1, min-height 0, overflow-y auto
└── footer                        flex 0 0 auto, centred, padding-top 16px,
                                  min-height 57px, position relative
```

**Column count** — `columnsFor(n)`: 1–5 players is one row of `n`; 6–10 is two balanced
rows of `ceil(n / 2)`. Set as `--cols` on `.results`.

**Card width does not stretch.** `.results` is capped at `calc(var(--cols) * 20vw)` and
centred, so each card is a fifth of the screen regardless of player count. Type, borders,
radii and gaps are fixed px and never scale.

### The card

| Property | Value |
| --- | --- |
| Background | `--cream` `#FFF7E8` |
| Text | `--ink` `#1A0710` |
| Border | `3px solid var(--ink)` — **never animates** |
| Radius | `14px` — **never animates** |
| Shadow | `6px 6px 0 var(--ink)` — hard offset, no blur |
| Padding | `10px` |
| Layout | flex column, `min-width: 0`, `min-height: 0` |
| Overflow | **must not be `hidden`** — the team badge overhangs the top-left |

### Identity block

Two lines. This is a change from staging — see Deviations.

**Line 1 (solo play only)** — flex row, `gap: 10px`, `min-width: 0`:
- Avatar emoji, `font-size: 30px`, `line-height: 1`, `flex: 0 0 auto`
- Name, `flex: 1`, `min-width: 0`, `overflow: hidden`, Bungee `17px`/`1.06`.
  Inner `<span>` is `inline-block; white-space: nowrap` and carries the marquee.

**Team play** replaces line 1 with, in order, top to bottom:
- `padding-top: 15px` on the block — clearance for the badge overhang
- Member emoji strip: flex row, `gap: 5px`, `font-size: 19px`, `line-height: 1`,
  `margin-bottom: -2px`
- (the name lives in the badge, not in the block)

**Line 2** — flex row, `align-items: flex-end`, `gap: 10px`, `min-width: 0`:
- `.id-card__meta` — `flex: 1`, `min-width: 0`, `11px`, `--ink-soft` `#7A6A5C`,
  `letter-spacing: .08em`, `white-space: nowrap`. Reads `RANK n`, or `—` before ranks
  resolve.
- Stat pair — flex row, `gap: 10px`, `flex: 0 0 auto`, centred text. Each stat is a
  flex column, `gap: 2px`:
  - numeral: Bungee `24px`/`1.06`, `font-variant-numeric: tabular-nums`.
    UNIQUE is `--pink` `#E62E5C`; TOTAL is `--ink-soft`.
  - label: `9px`, `--ink-soft`, `letter-spacing: .1em`, text `UNIQUE` / `TOTAL`

### Team badge

- `position: absolute; top: -12px; left: 10px`
- `max-width: calc(100% - 20px)` — **shrink-to-fit up to the card width**, then clips
- Bungee `13px`/`1.06`, `--ink` text, `3px solid --ink`, radius `8px`,
  `padding: 4px 10px`, `box-shadow: 3px 3px 0 var(--ink)`
- `transform: rotate(-2.5deg)` — the house angle
- Background: the team's accent from `TEAM_COLORS`
- `overflow: hidden; white-space: nowrap`; inner run is `inline-block` and marquees

### Word list

- Scroll container: `flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden`,
  `padding-right: 8px`, flex column, `gap: 5px`,
  `scrollbar-width: thin; scrollbar-color: #C9B8A2 transparent`
- Empty state: `Nothing written.` at `15px` `--ink-soft`

**Row** — flex row, `justify-content: space-between`, `gap: 10px`,
`align-items: baseline`, `line-height: 1.35`:

| Part | Styling |
| --- | --- |
| `.word-row__by` (team only) | author emoji, `11px`, `--ink-soft`, `flex: 0 0 auto` |
| `.word` clip box | `flex: 1 1 0`, **`min-width: 60%`**, `display: block`, `overflow: hidden` |
| `.word` run | `inline-block`, `white-space: nowrap`, `15px`. Unique: `600`, `--ink`. Struck: `400`, `--struck` `#9C8B79`, `text-decoration: line-through`, `text-decoration-color: --struck` |
| `.word-row__also` clip box | `flex: 0 1 auto`, `min-width: 0`, `max-width: 40%`, `display: block`, `overflow: hidden` — carries the pop |
| `.word-row__also` run | `inline-block`, `11px`, `line-height: 1`, `--struck`, `white-space: nowrap`, `letter-spacing: -.16em`, `padding-right: .16em` — carries the travel |

The `min-width: 60%` / `max-width: 40%` split matters: without it the emoji trail takes
the row and the word is squeezed to nothing.

### Footer

`min-height: 57px`, `position: relative`, so swapping the two buttons never reflows the
grid above.

| Button | Treatment |
| --- | --- |
| **FAST FORWARD** (during the sequence) | `position: absolute; left: 34px; top: 16px`. Cream fill, `--ink` text, `3px solid --ink`, radius `99px`, `padding: 12px 22px`, `box-shadow: 3px 3px 0 --ink`, Bungee `14px`, uppercase |
| **STANDINGS** (after) | Centred. `--gold` `#FFD400` fill, `#2A1400` text, `4px solid --ink`, radius `99px`, `padding: 16px 30px`, `box-shadow: 5px 5px 0 --ink`, Bungee `16px`, uppercase |

Gold, the 4px border and the 5px shadow are reserved for STANDINGS — the forward action.
FAST FORWARD is deliberately quieter so the two never read as the same control.

---

## The three orderings

Three different orders are in play. Confusing them is the main way this goes wrong.

| # | Order | Rule |
| --- | --- | --- |
| **1 · ENTRY** | Frame 1, deal-in | Round 1: random (seed it, so replays match). Later rounds: current match standings, best first. |
| **2 · REVEAL** | Frame 2 | Two independent controls. `playerOrderMode` picks which player's list goes next (`random` / `shortest` / `longest` by list length). `revealOrderMode` picks line order **within every list** (`entry` = as typed, `duplicates` = every shared word first, uniques held back for the end). Unrelated to entry order. |
| **3 · FINAL** | Frame 3 | `unique` descending, then `total` descending. What the screen ships in today. |

---

## Frame 1 — Deal in

Cards swing in from the side with momentum, in **entry order**, one unit per column.

| Element | Delay | Duration | Easing | What |
| --- | --- | --- | --- | --- |
| `.result-col` | `deal rank × 150ms` | `920ms` | `cubic-bezier(.34,1.42,.64,1)` | Offset → none. `left`/`right`: `translateX(∓900px) rotate(∓2deg)`. `top`/`bottom`: `translateY(∓900px) rotate(∓1.5deg)`. `alternate`: sides by slot parity. **KEY MOMENT ~62%** — the curve carries the card past its slot. |
| card `opacity` | with transform | `460ms` | linear | `0 → 1`, half the transform duration, so the card is solid before it overshoots. |

Deal order is left-to-right through the slots, or a seeded scatter with
`dealRandomOrder`.

**State during Frame 1:**
- Word lists arrive **blank** — not the `Nothing written.` empty state. That string
  means the player wrote nothing, and using it here would lie for a second.
- `.id-card__meta` reads **`—`**. Entry order is not rank; hiding the line would shift
  the row height, and a placeholder number would be read as a standing.
- `.stat__num--unique` reads **`—`** too. Nothing is revealed, so there is no
  provisional score. It resolves to the player's TOTAL as Frame 2 opens, and only ever
  counts down from there.

---

## Frame 2 — Reveal and strike

Lists fill **one line at a time**, column by column in reveal order.

### The strike rule is derived, never diffed

Each entry carries `alsoBy[]` — the ids of other players who wrote the same word. A row
renders struck once **any** player in its `alsoBy` has already been revealed. Two
consequences:

- **Back-checking is automatic.** When a later column reveals a word, every
  already-revealed column holding that word flips to struck at that moment. The
  `.word-row__also` trail shows only the subset of `alsoBy` revealed so far, and grows
  as more columns land.
- **The last column is a cascade, not a trickle.** The first revealed list strikes
  nothing. The last collides with everything, so many rows strike near-simultaneously.
  Both extremes are in scope — a single lonely strike and a ten-row wall.

### Pacing is uniform and never batched

One line at a time, always, with an identical interval regardless of list length. No
accelerating stagger, no length-scaled timing, no batching past a threshold. The
single-line cadence is the point: it pulls the whole room to the same word at the same
moment. A long reveal is acceptable — FAST FORWARD is the escape valve.

**Runtime** = `(total lines × lineInterval) + (players × columnPause)`

| Case | Arithmetic | Total |
| --- | --- | --- |
| 3 players × 10 words | `30 × 260ms + 3 × 420ms` | **9.1s** |
| 10 players × 35 words | `350 × 260ms + 10 × 420ms` | **95.2s** |

`260ms` is the recommended interval: a 30-line round lands under ten seconds, and a
strike plus its emoji trail still reads as one beat. 95s for a ten-player wall is
acceptable. **`splitStrike` roughly doubles these figures** — it gives a duplicated
word its own extra beat.

### Timing table

| Element | Delay | Duration | Easing | What |
| --- | --- | --- | --- | --- |
| `.word-row` enter | `step × 660ms` | `min(180ms, interval × .6)` | `ease-out` | `rowIn`: opacity `0→1`, `translateY(-6px)→0`. |
| inter-column beat | `+1000ms` | — | — | Added once at each column's first line. Separate tweak from the line interval — and not dead time: it is the cue below. |
| next card (cue) | on the previous column's last line | `max(600ms, columnPause)` | `ease-in-out` | `shakeCue`: `±5px` / `±0.7deg` settling to `±2px`. Fires before the first column too, so the room's eye is on the next list before its first word lands. |
| active card | on its first line | `180ms` | `ease-out` | Offset shadow `--ink → --teal`, plus `z-index: 4`, for as long as that list is revealing. **No scale — the card does not change size.** Teal is already the app's liveness signal, so "this one is talking" needs no new colour. |
| active `.word-list` | each line | native smooth scroll | native | The revealing list scrolls to its newest line. **Only the active column follows** — a back-check landing elsewhere must not yank that column away from where the room is looking. |
| `.word → .word--struck` | `180ms` on its own reveal, `0ms` on back-check | `300ms` | `cubic-bezier(.2,.7,.3,1)` | `strikeIn`: colour `--ink → --penalty` at 55% `→ --struck`; `text-decoration-color` transparent `→ --struck`. A word never appears pre-struck — the line always lands in plain ink first. Owns its duration independently of the interval, so a slow interval leaves no dead air and a fast one does not truncate it. **KEY MOMENT: the 55% frame** is the only time `--penalty` touches a word. |
| `.word-row__also` | with the strike | `260ms` | `cubic-bezier(.34,1.42,.64,1)` | `popIn`: `scale .4 → 1.18 → 1`. Fires again each time the trail grows, so a word shared by four pops four times across the phase. |
| `.card__penalty` overlay | with the strike | `420ms` | `ease-out` | `penaltyBlink`: `opacity 0 → 1 → 0` on an **inset feathered ring** — `inset 0 0 17px 3px var(--penalty-soft)` at the default intensity. Drawn on an absolutely-positioned child so the card's hard offset shadow is never touched. Reads as light bleeding in from the card's edge, not the panel changing colour. |
| `.card` dip | with the strike | `483ms` (`blink × 1.15`) | `cubic-bezier(.3,1.5,.5,1)` | `dip`: `translateY 0 → +7px` at 26% `→ -28%` of that at 62% `→ 0`. The card takes the hit physically, with weight down and a small overshoot back. **KEY MOMENT: the 26% frame**, deepest point. |
| `.stat__num--unique` | with the strike | `420ms` | `ease-in-out` | `statBlink`: `--pink → --penalty`, `scale 1.16 → 1`. The decremented value is committed on the first frame. |

**The active card does not flinch at its own words** — no ring, no dip. The penalty
belongs to the cards being caught out.

**Every strike flashes, with no cooldown.** `penaltyBlink`, `statBlink` and `popIn`
each need **two identical copies** — `…A` and `…B` — alternated per line. An identical
animation string does not restart, so consecutive strikes would otherwise coalesce and
look like a cooldown.

**Two pacing answers, for the record:**
- There **is** an extra beat between columns (`1000ms` default), a separate control from
  the line interval.
- A strike **owns its own duration**, independent of the interval. At `900ms` there is
  no dead air; at `90ms` strikes simply overlap on different rows rather than truncating.

---

## Frame 3 — Rank and podium

Cards swap into final order, ranks resolve, and 1st/2nd/3rd take medal treatments.

| Element | Delay | Duration | Easing | What |
| --- | --- | --- | --- | --- |
| wrapper (Y travel) | `0ms` | `1600ms` | `cubic-bezier(.34,1.28,.64,1)` | `translateY` to the final row. **Vertical first** — this is what stops an 8-player two-row swap reading as a shuffle. |
| card (X travel) | `180ms` when changing rows | `1600ms` | same | `translateX` to the final column, plus `rotate(1.5deg) scale(1.03)` and `z-index: 3` while in flight, so a travelling card visibly passes over a stationary one. |
| `.id-card__meta` | `0ms` | — | — | `—` resolves to the real `RANK n` on the swap frame. |
| medal plaque | after the swap settles | `280ms` | `cubic-bezier(.34,1.42,.64,1)` | `plaquePop`: `scale .5 → 1.12 → 1`, held at `rotate(-2.5deg)`. Tab overhangs the card's **top-right**, opposite the team badge. **KEY MOMENT: the 65% overshoot frame.** |
| `.card` shadow | after the swap settles | `260ms` | `ease-out` | `medalGold` / `medalSilver` / `medalBronze`: `6px 6px 0 --ink → 6px 6px 0 <medal>`. Hard offset only. |

**Plaque styling** — Bungee `13px`/`1.06`, `#2A1400` text, `3px solid --ink`, radius
`8px`, `padding: 4px 10px`, `box-shadow: 4px 4px 0 --ink`, `top: -13px; right: 10px`,
`rotate(-2.5deg)`. Copy: `1ST` / `2ND` / `3RD`.

**Podium is flat-graphic, by decision.** The design system forbids soft shadows and
`color-mix()`/`oklch()`, so a glowy sparkle is off-system. Instead: a tilted plaque on
the house `-2.5deg` angle plus the card's existing hard offset shadow recoloured from ink
to the medal. No glow, no blur, no sparkle.

**Ties share a place.** Equal `unique` **and** equal `total` ⇒ same `RANK n`, and the
next place skips (`1, 2, 2, 4`). A tie for first means two gold plaques and no silver.

---

## Footer: FAST FORWARD → STANDINGS

**Fast forward is a compressed run, not a hard cut.** Press → every outstanding strike
lands on the same frame, the whole grid takes one `320ms` penalty ring together as the
acknowledgement, then Frame 3 runs at `1.6×`. The room sees "that all happened" rather
than a jump cut, and the podium still arrives as a moment.

**The double-press guard is three things at once**, because a host mashing FAST FORWARD
will otherwise land a second press on STANDINGS and blow past the results:

1. **Position** — FAST FORWARD sits at the footer's left inset, STANDINGS is centred.
   They never share a hit target.
2. **A deliberate gap** — `ffOut` runs `160ms` (`opacity → 0`, `translateY(14px)`), then
   the footer is **empty for 480ms**. The emptiness is what tells the host to stop
   pressing.
3. **`pointer-events: none`** on STANDINGS for its `280ms` `stdIn` entry
   (`translateY(16px) scale(.92)` → overshoot `1.04` → rest).

Total dead window ≈ **920ms**, longer than a mash interval.

---

## Reduced motion

Every animation is wrapped by `@media (prefers-reduced-motion: reduce)` and degrades to
the **final state with no motion**:

- Final order, real `RANK n`
- All lists fully revealed, all strikes applied, all UNIQUE counts at final values
- Podium plaques and medal shadows present
- Footer showing STANDINGS
- No transform, no ring, no dip, no pop, no marquee — everything at its end value on
  first paint. List auto-scroll becomes instant rather than smooth.

The screen must be correct and readable with all motion off.

---

## Text that does not fit: cut off, then travel

Long player names, long team names and long words **clip at their container edge and
travel back and forth** — no ellipsis, no wrap.

```css
@keyframes marqueeX {
  from { transform: translateX(0) }
  to   { transform: translateX(var(--travel, 0px)) }
}
/* applied to .id-card__name, .team-badge span, .word, .word-row__also span */
animation: marqueeX 5200ms ease-in-out 700ms infinite alternate;
```

`--travel` is **measured per element after render**: `clipWidth - scrollWidth`, clamped
at `0`, written as an inline custom property. Two things this must get right:

1. **Do not use `container-type: inline-size` for this.** It zeroes the element's
   intrinsic contribution, which collapses a shrink-to-fit team badge to nothing. The
   measured approach lets the badge keep its natural width *and* clip when it must.
2. **Re-measure on `document.fonts.ready` and on resize**, not only on mount. Bungee is
   much wider than the fallback and loads after first paint, so a mount-only measurement
   reports "it fits" for runs that then overflow.

Anything that fits gets `--travel: 0px` and never moves, so the animation is free on
normal rows.

The avatar trail scrolls too — four or five attributions overflow the 40% the row can
spare, and a clipped emoji is a missing attribution. **The clip box carries the pop, the
inner run carries the travel**, one transform each, so the two never fight.

---

## Interactions & behaviour

The screen itself has exactly one control: the footer button. During the sequence it is
FAST FORWARD (skip to the settled end state); after, it is STANDINGS (advance to the
next screen).

The prototype adds per-frame review controls — play/pause, replay, step +1,
start/mid/end jumps — that are **prototype scaffolding, not product UI**. Do not ship
them. The one worth keeping in a dev build is **step +1**: the back-check, the growing
avatar trail and the simultaneous multi-card reaction all happen inside one interval and
cannot be judged in motion.

## State management

Derived, minimal:

- `step` — one integer per phase. Phase 1 counts dealt cards; phase 2 counts revealed
  lines; phase 3 is `0 | 1 | 2` (pre-swap, swapping, settled).
- `playing` — boolean per phase, drives the interval timer.
- The **schedule** is precomputed once: player order → line order within each player →
  a flat `stepOf[playerId + ":" + wordIndex]` map, plus `colStart[playerId]`.
- Everything visible is derived from `step` against that schedule. Struck state,
  UNIQUE counts, the emoji trail and rank all fall out of `alsoBy` and `stepOf` — nothing
  is stored per row, and nothing is diffed.

This matters for FAST FORWARD and for step-through: both are just `step` assignments.

## Design tokens

Existing, in `:root`:

| Token | Value | Use |
| --- | --- | --- |
| `--pink` | `#E62E5C` | Field background, UNIQUE numeral |
| `--cream` | `#FFF7E8` | Cards, chips |
| `--ink` | `#1A0710` | Text, every border, every hard shadow |
| `--ink-soft` | `#7A6A5C` | Labels, meta, TOTAL numeral |
| `--struck` | `#9C8B79` | Struck words, emoji trail |
| `--gold` | `#FFD400` | STANDINGS, 1st place |
| `--teal` | `#00A6A6` | Liveness — reused here for the active column |
| `--rule` | `#E7D3BE` | The in-card hairline |
| `--border` | `3px` | Never scales, never animates |
| `--radius` | `14px` | Never scales, never animates |
| `--shadow-card` | `6px 6px 0 var(--ink)` | Hard offset, no blur |
| `--shadow-btn` | `5px 5px 0 var(--ink)` | Hard offset, no blur |

**New tokens this design needs:**

| Token | Value | Purpose |
| --- | --- | --- |
| `--penalty` | `#8E0B24` | The strike moment — the word mid-strike and the UNIQUE numeral. Darker and less saturated than the pink field, so it never reads as brand pink. **Only ever inside cream cards**, never on the pink field. |
| `--penalty-soft` | `#BA1B40` | The feathered ring bleeding in from inside a card's edge on a strike. Only ever feathered, only ever inside a card. |
| `--silver` | `#C9CDD4` | 2nd place plaque + card offset shadow. |
| `--bronze` | `#C08457` | 3rd place. Warm enough to sit beside cream, dark enough to hold ink text. |

**Constraints on all of it:**
- Tokens only. No loose hex outside `:root`.
- No `color-mix()`, no `oklch()`, no relative colour syntax. (The prototype's intensity
  controls mix hex numerically in JS for exactly this reason — shipped code takes the
  fixed token.)
- `--border`, `--radius`, `--shadow-card`, `--shadow-btn` never scale. Motion may
  translate, rotate and scale cards but **must not animate border width or radius**.
- Never cream on cream. No dark mode.
- The **one** blur in the system is the penalty ring's feathering. It is a light effect
  *inside* a card, never a shadow *under* one. Everything else stays a hard offset.

## Typography

| Role | Font | Size / line-height |
| --- | --- | --- |
| Results title | Bungee | `32px` / `1.06` |
| Room code | Bungee | `28px` / `1.06`, `letter-spacing: .1em` |
| Round marker | Bungee | `18px`, `letter-spacing: .14em` |
| Player / team name | Bungee | `17px` / `1.06` (badge: `13px`) |
| Stat numerals | Bungee | `24px` / `1.06`, `tabular-nums` |
| STANDINGS | Bungee | `16px` / `1.06` |
| FAST FORWARD | Bungee | `14px` / `1.06` |
| Room chip label | Archivo 400 | `14px`, `letter-spacing: .16em` |
| Words | Archivo | `15px` — `600` unique, `400` struck |
| `RANK n` | Archivo 400 | `11px`, `letter-spacing: .08em` |
| Stat labels | Archivo 400 | `9px`, `letter-spacing: .1em` |
| Emoji trail | Archivo | `11px`, `line-height: 1`, `letter-spacing: -.16em` |

Minimum on-screen size is `9px` at the 1200px design basis. On a real TV this screen is
scaled up as a whole, so the effective size is far larger — do not "fix" the small
labels by bumping them locally.

## Assets

None. Avatars are Unicode emoji from `AVATARS` in `src/components/AvatarPicker.tsx`;
team accents are `TEAM_COLORS` from `src/shared/teams.ts`. Fonts are Bungee and Archivo
from Google Fonts, already used by the app.

---

## Deviations from staging — read before starting

Three intentional differences from `HostScoring.tsx` as it ships today.

1. **One card per player, not two.** Staging renders `.card.id-card` and
   `.card.list-card` as siblings. This design merges them into a single card split by a
   `1px --rule` hairline. It buys back a border pair, a 6px shadow and a 12px gap per
   player — around 30px of vertical, which is what makes the 6–10 player two-row layout
   readable. If you keep the two-card structure, the penalty ring needs to cover both
   cards or the reaction reads as half a card flinching.

2. **The identity block is two lines.** Staging puts name, `RANK n` and both stat pairs
   on one row, which collides for any name longer than about five characters inside a
   240px track. This design gives the name its own full-width line (avatar + name), then
   `RANK n` and the stats beneath. The name gets roughly 4× the room; the card grows 6px.

3. **Padding is tighter** — card `14px → 10px`, head-block gap `4px`, hairline margin
   `7px`, and in team play the member strip moved above `RANK n`. All of it goes to the
   word list.

Also worth knowing: staging's footer button reads **Standings** (this design keeps that,
and adds FAST FORWARD as its during-sequence counterpart), and staging's room-chip label
is `JOIN AT {location.host} · CODE:`. At the 1200px design basis that label collides with
the absolutely-centred round marker, so the prototype trims it to `JOIN AT
OKAYNAMEONE.APP`. On a real TV viewport the full label fits — **keep the staging string
and let it be**; the trim is a prototype artefact, not a design decision.

---

## Prototype controls (what each one is for)

Every control below is prototype-only. They exist to stress the layout and to dial in
timings that cannot be judged from a static spec. Values marked **default** are the
recommended shipping values.

### Content

| Control | Range | Purpose |
| --- | --- | --- |
| `scorers` | 2–10 | Players in the room. Drives `--cols`; crossing 5 splits one row into two. The layout's real stress point. |
| `wordsPerList` | 3–40 | Longest list; others fan down from it. Drives in-card scrolling and runtime. |
| `overlap` | low / medium / high | How much of each list is drawn from the obvious answers, so how many strikes land. **The most informative single control** — it decides whether the last column is a trickle or a wall. |
| `mode` | solo / team | Team play adds the badge overhang, the member strip and per-word author emoji. The tighter layout. |
| `playerOrderMode` | random / shortest / longest | Which player's list reveals next. |
| `revealOrderMode` | entry / duplicates | Line order within every list. `duplicates` holds uniques back, so a column ends on its own points. |
| `splitStrike` | off / on | On, a word gets two beats — line, then strike. Roughly doubles felt runtime without changing the interval. Back-check strikes stay immediate either way. |

### Deal in

| Control | Range | Default |
| --- | --- | --- |
| `dealDirection` | left / right / top / bottom / alternate | `right` |
| `dealRandomOrder` | off / on | `off` (left-to-right through the slots) |
| `dealStagger` | 20–400ms | `150ms` |
| `dealDistance` | 40–900px | `900px` |
| `dealDuration` | 120–1600ms | `920ms` |

### Timing

| Control | Range | Default |
| --- | --- | --- |
| `lineInterval` | 60–1200ms | `660ms` (spec recommends `260ms` — see runtime table) |
| `columnPause` | 0–2000ms | `1000ms` |
| `strikeDuration` | 60–1200ms | `300ms` |
| `popDuration` | 60–1200ms | `260ms` |
| `blinkDuration` | 60–1600ms | `420ms` |
| `cardFlash` | 0–100 | `60` — drives ring spread (7–24px) and dip depth (3–10px) together |
| `statFlash` | 0–100 | `60` — how far the numeral travels toward `--penalty`, and its scale (1.00–1.26) |
| `swapDuration` | 120–2000ms | `1600ms` |
| `speed` | 0.25–8× | `1×` — divides every duration and delay without touching their ratios. The only way a two-minute reveal is reviewable. |

### Edge cases

| Toggle | What it proves |
| --- | --- |
| `edgeTie` | Two players on identical unique **and** total. Asserted on the *outcome*: words are swapped in and out of one list (length preserved) until its derived unique matches its neighbour's — equal-length inputs are not enough, because collisions depend on what everyone else wrote. Proves place-sharing and the double-gold podium. |
| `edgeZeroUnique` | One player's entire list duplicated — a full column of strikes ending on `UNIQUE 0`. |
| `edgeEmptyList` | The last player's list empty, so `Nothing written.` gets reviewed in situ. |
| `edgeLongStrings` | A long player/team name and a 35-character word, both planted so they clip and travel. The long word is planted in **two** lists, so it also strikes and grows a trail. |
| `reducedMotion` | Renders every frame at its settled end state — the degraded output, reviewable without changing OS settings. |

---

## Keyframes, ready to port

```css
@keyframes rowIn {
  from { opacity: 0; transform: translateY(-6px) }
  to   { opacity: 1; transform: none }
}

@keyframes strikeIn {
  0%   { color: var(--ink);     text-decoration-color: transparent }
  55%  { color: var(--penalty); text-decoration-color: var(--penalty) }
  100% { color: var(--struck);  text-decoration-color: var(--struck) }
}

@keyframes popIn {
  0%   { opacity: 0; transform: scale(.4) }
  62%  { transform: scale(1.18) }
  100% { opacity: 1; transform: scale(1) }
}

/* The penalty ring lives on .card__penalty — position:absolute; inset:0;
   border-radius:calc(var(--radius) - 3px); pointer-events:none; opacity:0;
   box-shadow: inset 0 0 17px 3px var(--penalty-soft);
   NEVER on .card itself, or it fights the hard offset shadow. */
@keyframes penaltyBlink {
  0%, 100% { opacity: 0 }
  18%      { opacity: 1 }
  52%      { opacity: .82 }
}

@keyframes dip {
  0%, 100% { transform: none }
  26%      { transform: translateY(var(--dip)) }
  62%      { transform: translateY(calc(var(--dip) * -.28)) }
}

@keyframes statBlink {
  0%, 100% { color: var(--pink); transform: none }
  24%      { color: var(--penalty); transform: scale(1.16) }
}

@keyframes shakeCue {
  0%, 100% { transform: none }
  10% { transform: translateX(-5px) rotate(-.7deg) }
  25% { transform: translateX(5px)  rotate(.7deg) }
  40% { transform: translateX(-4px) rotate(-.5deg) }
  55% { transform: translateX(4px)  rotate(.5deg) }
  70% { transform: translateX(-2px) }
  85% { transform: translateX(2px) }
}

@keyframes marqueeX {
  from { transform: translateX(0) }
  to   { transform: translateX(var(--travel, 0px)) }
}

@keyframes plaquePop {
  0%   { opacity: 0; transform: rotate(-2.5deg) scale(.5) }
  65%  { transform: rotate(-2.5deg) scale(1.12) }
  100% { opacity: 1; transform: rotate(-2.5deg) scale(1) }
}

@keyframes medalGold   { from { box-shadow: var(--shadow-card) } to { box-shadow: 6px 6px 0 var(--gold) } }
@keyframes medalSilver { from { box-shadow: var(--shadow-card) } to { box-shadow: 6px 6px 0 var(--silver) } }
@keyframes medalBronze { from { box-shadow: var(--shadow-card) } to { box-shadow: 6px 6px 0 var(--bronze) } }

@keyframes ffOut { to { opacity: 0; transform: translateY(14px) } }

@keyframes stdIn {
  0%   { opacity: 0; transform: translateY(16px) scale(.92) }
  70%  { transform: translateY(0) scale(1.04) }
  100% { opacity: 1; transform: none }
}

@media (prefers-reduced-motion: reduce) {
  .result-col, .card, .card__penalty, .word, .word-row, .word-row__also,
  .id-card__name, .stat__num, .medal-plaque, .host-scoring__footer .btn {
    animation: none !important;
    transition: none !important;
    transform: none !important;
  }
}
```

`penaltyBlink`, `statBlink` and `popIn` each need an `…A` and `…B` copy with identical
bodies, alternated per revealed line — see "Every strike flashes" above.

---

## Implementation order (suggested)

1. **Tokens** — add `--penalty`, `--penalty-soft`, `--silver`, `--bronze` to `:root`.
2. **Static screen first** — merge the two cards into one, restructure the identity
   block to two lines, tighten the padding, add the marquee clip boxes and the
   measurement hook. Ship-able and reviewable on its own; every frame depends on it.
3. **The schedule** — player order, line order, the flat `stepOf` map, and derived
   struck/unique/rank from `alsoBy`. Pure logic, unit-testable, no CSS. Get
   back-checking and the tie rule right here.
4. **Frame 2** — the phase with all the risk. Row enter, strike, trail pop, ring, dip,
   stat blink, active-column shadow, auto-scroll, the shake cue. Build it with a
   step-through control from the start.
5. **Frame 1** — comparatively simple once the card is right.
6. **Frame 3** — the FLIP swap, then the plaques.
7. **The footer swap and its guard.**
8. **Reduced motion**, verified as an end state rather than as "animations removed".

## Files in this bundle

| File | What it is |
| --- | --- |
| `Host Scoring Reveal.dc.html` | The motion spec — three frames, live controls, the timing table, keyframe source, tokens and decisions. The primary reference. |
| `Host Scoring.dc.html` | The static screen on its own, framed for a 16:9 TV. |
| `support.js` | Runtime needed to open either HTML file in a browser. Not production code — do not port it. |

Open either `.dc.html` directly in a browser. The Reveal file's controls live in the
host's Tweaks panel; the per-frame play/step/jump buttons are in the page itself.
