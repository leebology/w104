# Handoff: Custom categories — creation phase, forked voting, and the transition

> **Provenance.** Verbatim copy of `README.md` from the Claude Design project
> `Ok Name One custom categories`
> (`https://claude.ai/design/p/853962ae-f6d8-4fbc-a092-949722d1148c`), saved here on
> 2026-07-30 so the numeric spec cannot be lost again. **Authoritative for anything
> numeric about the screens.** Where it states a *ruleset* number — pool size, quota, vote
> budget, minimum room size — it is superseded by
> `docs/superpowers/specs/2026-07-30-custom-categories-design.md` §3, which was re-derived
> after the original mechanic document was found to be missing.

## Overview

One setting, one new phase on both surfaces, a **forked** pair of voting screens, and the
beat between them. Everything here is an extension of `design_handoff_marquee_2a/` and
`design_handoff_host_scoring_reveal/`; the stock voting screens are untouched.

| File | What it is |
| --- | --- |
| `Ok Name One - Custom Categories.dc.html` | Eleven frames. Host 1280×720, phone 390×844. Section 1c is a **live, playable transition** — PLAY / STOP / RESET. |
| `README.md` | This spec — every number, every timing. |
| `CLAUDE.md` | The traps, for the implementer. |

The prototype is the source of truth for anything numeric. It is a **design reference in
HTML**, not production code: its inline styles exist because it is one file. Translate them
back to `src/style.css` classes and `:root` tokens — **no new token is introduced by this
design, and no loose hex may be.**

## Fidelity

**High.** Colours, type, spacing, borders, shadows, durations, delays and easing curves are
final. Sample content (names, avatars, category text, tallies) is loose. The side-by-side
canvas is a review arrangement; the app renders one screen at a time, full-viewport.

---

## The organising decision

**The category card is one object, and it appears in exactly one shape everywhere.** Cream,
`3px` ink border, `radius 14px`, hard ink offset shadow, Bungee text — from the phone's
writing card to the host's creation slot to the voting board to the closed-board result to
the phone's review tile. A player who writes a card recognises it in their hand, in the
race, and in the reveal. Nothing in this feature renders a category as a row, a bar, a line
of text, or a list item.

The corollary the host TV enforces: **the creation screen shows progress, never content.**
Printing the drafts on the TV would let the room read, judge and re-derive who wrote what
before the vote — and would spoil the reveal that is this feature's payoff. So the creation
slot is the same card, carrying a *state* rather than a *category*.

---

## What already exists, and what is new

| Screen | Built from |
| --- | --- |
| 1a The setting | `.stepper` (card, label, 38px control row), `.drawer__panel`, `.drawer__settings` |
| 1b Host creation | `HostHeader` / `HostHeaderRight` / `HostExit`, `RoomChip`, `.plaque`, `.player-pill--ready` / `--waiting`, `.player-pill__avatar--bob`, `.vote-card` (as the slot), `.timer-bar` + `.timer-track` + `.timer-track__fill`, `.btn` |
| 1c Transition | Everything above and below; no new object at all |
| 1d Host voting | `.host-voting__board` / `__row` / `.vote-card` **verbatim**, `flex-grow` weighting, `container-type: inline-size` text scaling, `.vote-card__chance`, `.host-voting__prompt`, `.get-ready--tv`, `voting-reveal-in` |
| 1e Phone creation | `.player-voting__head` + `.player-voting__count` + `.pip`, `.card`, `.btn--block`, `.player-voting__bar`, `.screen--locked` + `src/viewport.ts`, the pen glyph from player team select |
| 1e Phone voting | `.vote-tile`, `.vote-tile__badge`, `.vote-tile__chance`, `.player-voting__head`, `.player-voting__bar`, `.get-ready--small` |

**Three new objects, and what each descends from:**

1. **`.setting-choice`** — the two-state track inside a Stepper card. Descended from
   `.stepper`: identical card, identical label, and its control row is the **same 38px
   height** the `− 3 +` row occupies, so the four drawer cards are dimensionally identical.
   Only the row's contents differ, because the value is a word and not a number.
2. **`.slot-strip`** — the phone's card pager. Descended from `.player-voting__pips`: the
   same "one mark per unit of budget" object, grown to a 56×44 tappable chip because these
   marks are also destinations. The pips with a hit target, not a new idiom.
3. **`.slot-state`** — what a creation slot holds instead of text. Two forms, both already
   in the system: the **DONE stamp** is a `.plaque` shrunk to `rotate(-8deg)`, `padding:
   5px 14px`, Bungee 16px `.14em`, gold on ink with a `3px 3px 0` shadow; the **writing
   dots** are three 14px `--teal` circles on the existing `pulseDot` at `1.2s` with `0 /
   .2s / .4s` delays — the lobby's "thinking" tell, moved onto paper.

No new tokens, colours, fonts or shape constants.

---

## Tokens used (all existing)

`--pink #E62E5C` · `--cream #FFF7E8` · `--ink #1A0710` · `--ink-gold #2A1400` ·
`--gold #FFD400` · `--teal #00A6A6` · `--ink-dim #7A6A5C` · `--card-rule #E7D3BE` ·
`--code-empty #F6D9C6` · `--paper-lit #FFF3C4` · `--cream-dim` · `--border 3px` ·
`--border-heavy 4px` · `--radius 14px` · `--shadow-card 6px 6px 0` ·
`--shadow-btn 5px 5px 0` · Bungee / Archivo.

Two do specific work worth naming:

- **`--code-empty`** is every not-yet-started slot, on both surfaces and on the voting board
  for a card with zero votes. It is already "a box waiting to be filled" (room-code boxes)
  and already "waiting" (`.player-pill--waiting`).
- **`--paper-lit`** is the author chip at the voting reveal — the one cream card that is
  *somebody's*.

---

## 1a · The setting

**A fourth Stepper, dimensionally identical to the other three.** No separator, no note, no
hint line, no explanatory copy anywhere in the drawer.

The card is a `.stepper` in every measurement: cream, `3px` ink, `radius 14px`,
`6px 6px 0`, `padding: 8px 14px 12px`, `gap: 4px`, an 11px Bungee `.1em` `CATEGORIES` label
in `--ink-dim`. Its control row is `38px × 200px` — the same height as
`− 3 +` — so the four cards stack as one rhythm.

```
.setting-choice        display:grid; grid-template-columns:1fr 1fr; gap:4px;
                       height:38px; width:200px;
                       background:var(--code-empty); border:var(--border);
                       border-radius:10px; padding:4px
.setting-choice__opt   flex-centred; Bungee 14px/1; border-radius:7px;
                       color:var(--ink-dim)
.setting-choice__opt--on  background:var(--gold); color:var(--ink-gold)
```

The lit option is a **fill inside a sunken track** — no border, no shadow: at drawer
distance a fill reads where a tick does not, and a bordered segment inside a bordered track
draws a double rule.

Order: ROUNDS, TIMER, TEAMS, CATEGORIES. Last, and otherwise unremarkable — the phase it
inserts announces itself the moment the host starts the game, which is a better place to
learn it than a paragraph in a drawer.

---

## 1b · Host TV — creation

Header: `RoomChip` left; right cluster `N PLAYERS · N READY` + `HostExit` (`Back to teams`
with teams on, `Back to room` without). **No round marker.** Stage: `.plaque` in gold,
`-2.5deg`, Bungee 22px, `WRITE YOUR CATEGORIES` — the screen's one gold band. Footer: the
standard `.timer-bar` at `106px`, 52px clock, 28px track, gold `CONTINUE`.

### The slot — three states, one card

`218 × 96px`, `3px` ink, `radius 14px`, contents centred. **No category text, ever.**

| State | Fill | Shadow | Contents |
| --- | --- | --- | --- |
| **Done** | `--cream` | `6px 6px 0` | The **DONE stamp**: gold plaque, `rotate(-8deg)`, `radius 8px`, `padding: 5px 14px`, Bungee 16px `.14em`, `3px 3px 0`. |
| **Writing** | `--cream` | `6px 6px 0` | Three 14px `--teal` dots, `gap: 10px`, `pulseDot 1.2s infinite`, delays `0 / .2s / .4s`. |
| **Not started** | `--code-empty` | none | Nothing. Plus `opacity: .72`. |

Three signals, three channels: the paper says *reached*, the shadow says *lifted off the
board*, the stamp-vs-dots says *finished or in flight*. A room can count remaining work at
sofa distance without reading a word — and does it in the same glance as the player pills
above.

The "writing" state means the phone is **on** that slot, not that keys are being pressed;
it comes from the pager position the phone already publishes, so a player who leaves a card
half-written and jumps ahead does not leave a lying animation behind.

### Layout A — author columns (≤ 12 authors)

Row of columns, `justify-content: center`, `gap: 18px`, column width **fixed 218px** —
fixed, not fractional, same rule as the team panels: a card that resizes when somebody else
finishes is unreadable at sofa distance. Column = `PlayerPill` (`align-self: center`) then
1–3 slots, `gap: 12px`. The pill's third chip reads `··· WRITING` during this phase
(`✓ READY` unchanged) and the waiting avatar keeps `bobAvatar`.

Fits 5 columns × 2 slots at 1280×720 with room to spare; at 1920×1080 the same fixed
columns centre in more field.

### Layout B — the wall (> 12 authors)

Columns stop being possible at 13 authors (13 × 218 + gaps > 1280), so past that the screen
changes shape once, deliberately:

- The plaque gains a counter beside it: `17 / 24 WRITTEN`, Bungee 20px `.12em` cream.
- The pills are gone. The wall is `display: grid`, `repeat(6, 1fr)`,
  `grid-auto-rows: minmax(0,1fr)`, `gap: 12px`, one cell per pool slot in author order.
- **The cell is the same slot card**, same three states, same stamp (13px) and dots (11px),
  with the author moved into it: a **mini player pill** pinned `left: 8px; bottom: 8px` —
  `3px` ink, `radius 99px`, `padding: 3px 8px 3px 5px`, 15px emoji + Bungee 11px name. It
  takes the pill's own two states: gold on `--ink-gold` with `3px 3px 0` when that author
  is done, `--code-empty` on `--ink-dim` and flat while they are not. Same object as the
  column pill, scaled to a grid cell.
- Columns: 6 up to 24 slots, 7 to 35, 8 to 48. Below ~64px of cell height the mini pill
  drops to the avatar alone.

The switch is on **slot count**, not player count: 12 authors × 1 is columns, 5 authors × 3
(15 slots) is columns too — the constraint is horizontal, and only column count can break it.

### Motion — the slot changing state

| Element | Delay | Duration | Easing | What |
| --- | --- | --- | --- | --- |
| dots → stamp (`cardLandA` / `cardLandB`) | `0` | `260ms` | `cubic-bezier(.34,1.42,.64,1)` | Stamp from `scale(.86) translateY(-10px) rotate(-8deg)` to rest. **KEY MOMENT ~62%**, the overshoot — the card is being *stamped*. |
| stamp opacity | `0` | `180ms` | linear | `0 → 1`, shorter than the transform so it is solid before it settles. |
| empty → writing | `0` | `160ms` | `ease-out` | `--code-empty` → cream, shadow in, opacity to 1. Dots begin on the same frame. |
| pill → ready | on the last slot | — | — | The existing `--waiting` → `--ready` fill swap. No animation needed at that size. |

`cardLandA` / `cardLandB` must both exist and alternate per arrival (see CLAUDE.md).

---

## 1c · The transition — 1120ms, both surfaces, live in the prototype

Section 1c **plays**. `PLAY` runs the real timing, `STOP` freezes mid-flight, `RESET`
returns to the creation frame; the phase label reads out the step you are looking at. The
host and the phone are driven by the same clock, side by side, so the two surfaces can be
checked against each other. No countdown.

| t | Element | Duration | Easing | What |
| --- | --- | --- | --- | --- |
| `80 → 320ms` | author pills / wall mini-pills (stagger `24ms`) | `240ms` | `ease-in` | `opacity → 0`, `translateY(12px)`. The people leave first; the cards are what survives the phase. |
| `80 → 620ms` | every done slot (FLIP, stagger `26ms`) | `540ms` | `cubic-bezier(.34,1.28,.64,1)` | Translates to stage centre and rotates into a deck at `-7 / +4.5 / -2.5 / +1.5deg…`. Slots past the top six fade out during their own travel. |
| `880 → 1040ms` | the deck | `160ms` | `ease-in` | `scale(1 → .6)`, fade to 0. |
| `1060 → 1300ms` | the voting board (stagger `60ms`) | `180ms` each | `ease-out` | Every pool card wipes in as a sunken `--code-empty` `.vote-card`, `translateY(8px) → 0`. The board is complete and unvoted before the first vote can land. |

The prompt line and header count crossfade at `880ms` (`180ms`, `ease-out`). The timer bar
never leaves — it re-fills from 0:00 to 1:00 at `1060ms` over `260ms`, the one moment in the
app a timer track *grows* rather than drains, and the clearest possible statement that a new
clock has started.

**Phone**, same clock: the input blurs at `t0` (iOS owns the keyboard's own dismissal and we
do not fight it); the writing card, pager and commit button leave together at `80 → 320ms`
(`translateY(28px)`, fade); the counter **stays** — the one object that does not leave —
crossfading `1 to write` → `2 votes left` in place, which is what anchors the swap; the
first hand deals in from `1060ms`, three cards `80ms` apart, `320ms` on
`cubic-bezier(.34,1.42,.64,1)`.

**Reduced motion:** both surfaces cut straight to the settled voting screen — full board,
first hand present, counter at its vote budget. Correct on the first frame.

---

## 1d · Host TV — custom voting

**This is `HostVoting` with a different pool.** Same board, same object, same weighting
mechanic, same text scaling — the only fork is what feeds it and what happens at close.

Header: `RoomChip`; right `VOTING · N OF M VOTES IN` + `HostExit`. Prompt: the existing
`.host-voting__prompt`, `PICK ONE FROM EACH HAND — N VOTES EACH`. Footer: the standard
`.timer-bar` with `CONTINUE`. No plaque; the board is the loud thing.

### The board

`display: flex; flex-direction: column; gap: 12px; padding: 0 30px 16px`, rows of
`flex: 1` cards with `gap: 12px` — the stock structure. Each card:

```
flex: <votes + 1> 1 0;  min-width: 132px;  container-type: inline-size;
padding: 9px 12px; border: var(--border); border-radius: var(--radius);
background: var(--cream); box-shadow: var(--shadow-btn);
justify-content: space-between; overflow: hidden
name   Bungee max(24px, min(<cap>, 17cqw))/1.06; overflow-wrap: anywhere
count  Bungee 26px var(--pink), bottom-right
```

**Width is the odds**, exactly as it already is: `flex-grow: votes + 1`, transitioned
`220ms cubic-bezier(.2,.8,.2,1)`. The `+ 1` is what keeps an unvoted card a legible card
rather than a stub. Text scales with the card through `17cqw` capped at a per-weight
maximum, so the leader's name is genuinely huge and a one-vote card is still readable —
the stock screen's trick, unchanged.

- **Zero votes:** `--code-empty`, **no shadow**, name centred at `max(24px, min(30px, 17cqw))`,
  no count. Same "waiting" fill as an unstarted writing slot.
- **Voted:** cream, `5px 5px 0`, count bottom-right in `--pink`.
- **No voter avatars anywhere.** The stock board shows them; this one must not — showing
  which four avatars backed a card in your hand tells the room what was in your hand. The
  avatars come back at close, as authorship, which is what this phase actually pays out.

**At 8 cards / 6 votes:** two rows of four. Two big leaders, two mid cards, four sunken
ones. It reads as a race with room left in it — which is true — because the unvoted cards
are still on the board holding their place.

**At 30 cards: the board shows the top ten and no more** — two weight-balanced rows of
five. Everything below them collapses into one cream pill under the board:
`padding: 8px 18px`, `radius 99px`, `3px` ink, Bungee 13px `--ink-dim`,
`+ 20 MORE ON THE BOARD`. A count, never a list; a list would be a second board.

Ten is a measured ceiling, not a taste call. The name is `max(24px, min(<cap>, 17cqw))`, and
**24px is the hard TV floor** — every name on the board must clear it. At eight cards per row
the smallest card is ~104px wide, `17cqw` lands near 12.7px, and the `max()` then holds it at
24px in a box that cannot fit it. Five per row puts the smallest card at ~146px, where `17cqw`
is ~20px and the floor lifts it to 24px inside a box with room for it. `min-width: 132px` is
the guard. Rows are balanced by weight, not sequence, so neither row collapses to slivers.

### Close — chances, then authorship

Both, in that order, on the same screen. Folding them together spends the payoff; a
separate screen puts a wall in front of it.

| t | Element | Duration | Easing | What |
| --- | --- | --- | --- | --- |
| `0` | board (`voting-reveal-in`) | `260ms` | `ease-out` | The existing close fade. |
| `0` | **zero-vote cards leave** | `200ms` | `ease-in` | `opacity → 0`, `translateY(6px)`, then removed. The pack pill goes with them. |
| `0` | count → chance | `200ms` | `ease-out` | Crossfade `9` → `30%`. |
| `0` | reflow to the result board | `260ms` | `ease-out` | Survivors re-grow on `flex: <share>`: a `206px` podium row of the top three, then the runners-up wrapping below at `flex: 1 1 150px; max-width: 220px; min-height: 110px`. Name sizes step 52 / 34 / 30 / 19px; chance 46 / 34 / 30 / 20px in `--pink`. |
| `420ms + n × S` | author chip (`plaquePopA/B`) | `280ms` | `cubic-bezier(.34,1.42,.64,1)` | `scale(.5) → 1.12 → 1`, held at `rotate(-2.5deg)`. Winner first. **KEY MOMENT: the 65% frame.** |

`S = min(140ms, 2200 / cards)`, so the whole reveal lands inside 2.6s — comfortably inside
the 5-second `Get ready…` countdown already running.

**Author chip** — `.author-chip`: `--paper-lit`, `3px` ink, `radius 99px`,
`padding: 5px 11px`, `3px 3px 0`, `rotate(-2.5deg)`, 17px emoji + Bungee 12px name, pinned
top-left **inside** the card, above the name. Reserve its box at the close frame and animate
only transform and opacity, or it shoves the name mid-pop.

**The house card** — silent while it is in play, marked at the reveal. In a hand it is an
unmarked card like any other (marking it would say "nobody wrote this" and put a thumb on
the scale). It is not on the creation TV at all until the phase closes, at which point it
lands in its slot with the same `cardLand` stamp a written card gets — the house *playing*,
not an error. At the reveal it wears the author slot in **gold** on `--ink-gold`:
`HOUSE CARD`. Gold because the house is the game itself.

**Teams** — no `TeamBadge` on either screen. Creation and voting are individual; no team
acts, scores or is named here, so the badge would assert something false and set an
expectation the vote breaks. The room is just people for this phase, and team identity
resumes on the round card immediately after.

---

## 1e · Player phone

`390×844`, `.screen--locked` sized from `--vv-height`. **Not in a `<form>`.**
`padding: 44px 20px 20px`, `gap: 12px`.

### Creation

1. **Meta** — `ROOM JADE · WRITE 3`, 11px `.12em` `--cream-dim`, centred.
2. **Counter** — `.player-voting__head` verbatim: cream card, **82px**, flex row,
   `padding: 14px 16px`, `gap: 14px`. Bungee 48px `--pink` numeral counting **cards still to
   write**, `to write` in Bungee 15px, one 15px `.pip` per card in the quota — gold when
   committed, `--code-empty` when not. The same object the vote counter is.
3. **The card** — `flex: 1`, cream, `3px` ink, `radius 14px`, `6px 6px 0`, `padding: 18px`.
   Slot label `CARD 1 OF 3` in Bungee 11px `.1em` `--ink-dim`; the input is bare Bungee
   **30px** ink on the card's own paper (no inner box — the card *is* the box, as in
   `.entry-overlay`); `4px × 34px` `--teal` caret; right-aligned `0 / 20`. No placeholder,
   no example text.
4. **The pager** — `.slot-strip`: centred row, `gap: 10px`, one `56 × 44px` chip per slot,
   `3px` ink, `radius 12px`, Bungee 16px. Current: cream + `4px 4px 0`. Committed: gold +
   `--ink-gold` + `4px 4px 0`. Untouched: `--code-empty`, flat. Tapping commits and jumps.
   **At quota 1 it is not rendered at all** — one chip is not a pager, it is a decoration
   announcing an absence.
5. **Commit** — `.btn--block` gold, `61px`: `NEXT` on any card but the last, `DONE` on the
   last. Committing the last readies you (D16).
6. **Timer** — `.player-voting__bar`: `76px`, bled `margin: 0 -20px -20px`, Bungee 34px
   clock, 24px track.

**Ready state:** the counter takes its "you're in" form (34px avatar, `you're in`,
`all 3 written — waiting on 2`), and the card area becomes **the three cards, still cards** —
`flex: 1` each in a `gap: 14px` column, cream, `5px 5px 0`, Bungee 26px, `padding: 16px 44px
16px 16px`, with the pen glyph (18px, 2.6px stroke, `--ink-dim`) pinned `right: 14px; bottom:
14px`. Same object as the writing card and the hand card: **a written category is never a
line of text.** The commit button is gone; a `--cream-dim` 13px line reads *"Tap a card to
rewrite it — that un-readies you."* If blanks remain, the button stays and reads `READY UP`.

### The keyboard

At 390×844 with the iOS keyboard and predictive bar up, the visual viewport is **~508px**.
The screen is `position: fixed`, height `var(--vv-height)`, top `var(--vv-top)` — the
existing `.screen--locked` + `src/viewport.ts` — so **nothing moves, nothing scrolls, and
nothing hides under the keyboard.** The card does not slide up; the *screen* is smaller and
re-lays out inside it.

Condensed state keyed off `--vv-height < 620px` — a `.creating--compact` **class** set where
`--vv-height` is written, not a media query (a media query cannot see the visual viewport):

| Band | Roomy (844px) | Compact (508px) |
| --- | --- | --- |
| padding | `44px 20px 20px` | `14px 20px 0` |
| meta line | shown | **hidden** |
| counter | 82px, numeral 48px, pips below | **44px**, numeral 26px, `to write` inline, pips pushed right |
| card | flex, ~458px | flex, `min-height: 132px`, text 26px, caret 28px |
| pager | 44px | 44px — **never shrinks** |
| commit | 61px | 57px — the hit target **never goes below 52px** |
| timer | `76px` bar, clock + track | **34px** strip, 14px track only, no numeral |

~420px of 508px used; the slack goes to the card. Two rules behind the table: the two things
a thumb aims at keep their size at every viewport, and the timer gives up its numeral first
because the TV in the room is showing the same clock at 52px.

**Motion:** commit → next card is `slotAdvanceA/B`, `220ms`,
`cubic-bezier(.34,1.28,.64,1)` — outgoing text `translateX(-24px)` + fade, incoming from
`+24px`, and **the card frame does not move**, only its contents. Pip fill `120ms ease-out`
(`votePop`, existing). Chip commit `160ms ease-out`, no transform.

### Custom voting

Same three bands. The hand is three `.vote-tile`s in a column, `flex: 1` each, `gap: 14px`
— cream, `3px` ink, `radius 14px`, `5px 5px 0`, `padding: 16px`, Bungee **28px**/1.12, the
existing `:active` press (`translate(3px,3px)`, shadow to `2px 2px`). At 390×844 each is
**~186px** tall — 28px is nearly double the stock tile's 16px, and that is the upside of
dealing hands rather than showing a pool. No reset, no skip, no back; one instruction.

**Spent / closed:** the counter takes its "you're in" form and the grid becomes **your picks
only** (you cannot revisit a hand, so showing what you did not pick shows you a decision you
cannot change). Each keeps its `.vote-tile__badge` — your avatar, gold, overhanging
`top: -11px; left: -9px` — stays `flex: 1` (a full card, not a summary row), and gains the
existing `.vote-tile__chance` (22px `--pink` + 11px `CHANCE`) plus the author chip on the
same beat as the TV: `--paper-lit`, `-2.5deg`, right of the chance row,
`plaquePop` at `420ms + n × 140ms`. Footer: `.get-ready--small`.

**Hand swap**, `840ms` total: pick flashes gold (`pickFlashA/B`, `180ms ease-out`) and the
counter pops (`120ms`); at `180ms` the picked card goes **up** `translateY(-40px)` + fade
(`200ms ease-in`) while the other two drop `translateY(24px)` (`180ms ease-in`); at `520ms`
the next hand deals in (`dealInA/B`, ×3, `80ms` stagger, `320ms`,
`cubic-bezier(.34,1.42,.64,1)`).

---

## Ranges the layout survives

| Case | Result |
| --- | --- |
| 2 players | *(Superseded — see the spec §3.4. The design assumed a fallback to the stock pool; 1–2 player rooms now play custom with the rules bent.)* |
| 3 × 3, 1920×1080 | Three fixed 218px columns of three slots, centred with a lot of pink either side. Deliberate: they do not stretch. |
| 6–12 authors | Columns wrap to a second row past 5 per row on a 1280 TV. |
| 13+ authors / 16+ slots | The wall, 6 columns, mini pills in the cells. |
| 8-card pool | Two rows of four; unvoted cards sunken and still in place. |
| 30-card pool | The top ten over two rows of five + the pack pill. Nothing on the board is under 24px. |
| 20-character text | `max(24px, min(cap, 17cqw))` handles it on the board; 26px wraps in a 218px slot; 28px wraps to two lines on a phone card. |
| Nobody writes anything | Every slot backfills as a house card at close; the reveal is all gold `HOUSE CARD` chips — a joke the room gets, not a failure. |
| Disconnected player | Pill dims to `--player-pill--offline` `.45`; their cards stay in the pool. |

---

## The eight questions (§9), answered

1. **The setting — peer or louder?** A peer, completely: a fourth Stepper card with the same
   38px control row, no separator and no explanatory copy. The phase announces itself when
   the game starts, which teaches it better than a paragraph in a drawer. Last in the order.
   → 1a
2. **The pager, and quota 1.** `.slot-strip` — the vote pips grown to 56×44 tappable chips,
   because these marks are also destinations. At quota 1 it is **not rendered**: one card,
   one `DONE`. → 1e
3. **The keyboard.** The card does not move, shrink or scroll. `.screen--locked` +
   `src/viewport.ts` make the *screen* 508px; `.creating--compact` (`--vv-height < 620`)
   drops the meta line, halves the counter, and reduces the timer bar to its track. Pager
   and commit never shrink. ~420px of 508px used. → 1e
4. **The race.** It is the stock board — same `.vote-card`, same `flex-grow: votes + 1`,
   same `17cqw` text scaling, same 220ms curve. At 8 cards / 6 votes: two big leaders, two
   mid, four sunken `--code-empty` cards holding their places, so a quiet board is quiet and
   not broken. At 30: the **top ten only**, two weight-balanced rows of five, everything else
   in a `+ 20 MORE` pack pill — ten is what a 24px name floor allows at 1280. No voter
   avatars — hands stay private until close. → 1d
5. **The authorship reveal.** Its own beat on the same screen, after the chances: zero-vote
   cards leave, survivors re-grow on share into a podium + runners-up, then author chips pop
   in from `t+420ms` at `min(140ms, 2200/cards)` apart — done by 2.6s inside the 5s
   countdown. → 1d
6. **The house card.** Silent in a hand; a *moment* on the creation TV at close (it lands in
   the empty slot with the same stamp a written card gets); **marked at the reveal** with a
   gold `HOUSE CARD` chip in the author slot. Gold because the house is the game. → 1d
7. **Teams.** No `TeamBadge` on either screen. Creation and voting are individual — the
   badge would assert something false and set an expectation the vote breaks. Team identity
   resumes on the round card immediately after. → 1d
8. **The empty and crowded ends.** 3 × 3 on 1920×1080: three fixed 218px columns centred,
   not stretched. 24–30 × 1: the wall, a 6-column grid where each cell is the same slot card
   with the author as a mini pill in its bottom-left, `17 / 24 WRITTEN` beside the plaque,
   and no separate pill row. The switch is on **slot count**, because the constraint is
   horizontal. → 1b

---

## State

> Superseded in part by the spec §6. The privacy intent below is correct; the field
> placement is not — `drafts` and `deal` are top-level `Room` fields stripped by
> `toRoomState`, not phase members.

- `room.drafts[playerId][]` — committed text per slot, `""` until committed.
- `room.slotCursor[playerId]` — which slot each phone is on; the only thing that drives the
  writing-dots state on the TV. Nothing else about a draft is ever broadcast.
- `room.pool[]` — built at close, author-blocked, house-backfilled.
- `room.deal[playerId][][]` — **this socket only**, never broadcast wholesale.
- `room.votes` — as today; the board reads `tallyVotes` and `voteShares`.
- `room.phase` gains `creating`; `phase.endsAt` drives both timer bars through
  `useRemaining` / `formatClock`, never a local interval.
- Local, per client: current slot, in-flight text, reveal animation step.

## Assets

None. Avatars are emoji from `AVATARS`; the pen glyph is the existing two-path inline SVG;
no images, no icon fonts. The keyboard in the phone frame is a grey stand-in for iOS — not
an asset, and nothing renders it in the app.
