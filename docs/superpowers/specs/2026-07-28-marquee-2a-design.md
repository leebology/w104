# Marquee 2A — the v1 screens, as implemented

**Date:** 2026-07-28
**Source:** `design_handoff_marquee_2a/` from Claude Design, answering
[`docs/design/2026-07-27-v1-screens-handoff.md`](../../design/2026-07-27-v1-screens-handoff.md).
**Supersedes:** nothing. It fills in the ten screens the MVP handoff
([`2026-07-26-ok-name-one-ui-design.md`](2026-07-26-ok-name-one-ui-design.md))
never covered — everything between "the room exists" and "the round starts".

This is the same kind of document as the MVP UI spec: what the handoff asked
for, what was decided at implementation time, and where the code deliberately
does not match the prototype. The prototype's `.dc.html` remains the source of
truth for anything numeric.

## The formatting rule

**One gold band per screen, carrying the single loudest thing on it.**
Everything else is a flat cream pill on the pink field. That band already
existed as `.banner` (the room code, the category, TIME'S UP) and `.get-ready`
(the countdown); this handoff added the third and quietest member of the
family, `.plaque` — a screen's title, slanted −2.5° like its siblings.

The slant is load-bearing. `.btn` is gold too, and a gold heading that sat
square would look tappable. Nothing in this design system may be ambiguous
about whether it is a control.

## What changed, and why

### Back-out actions moved to the top-right of every host screen

`CLOSE ROOM` on the lobby, `BACK TO ROOM` on team select, `BACK TO TEAMS` /
`BACK TO ROOM` on voting. One corner, one component (`HostExit`), one
treatment: a cream outline on the field, deliberately **not** a `.btn`.

Gold with a hard shadow is what "go forward" looks like in this app. The
footer now carries exactly one forward action per screen — Start game,
Continue — and the button that abandons the phase is never beside it.

This replaced the lobby's `.back-pill`, which sat in the same corner but said
only "Back" and did not ask. The player screens keep their `.back-pill`:
leaving as a player costs a seat, not a room.

### Closing the room asks first

`CLOSE ROOM` opens `ConfirmDialog` rather than firing `endGame` on the tap.
The event itself is unchanged — the server already tears the room down and
kicks everyone with `host-left` — so this is purely the missing question in
front of the one host action whose damage cannot be undone by pressing it
again.

The dialog wears a **16px `--pink` cap strip**. `--pink` is the field colour
everywhere else in the app and appears inside a cream card nowhere but here,
so the strip reads as "this question is a different kind" before a word of it
is. Escape cancels; **the scrim is not clickable**, unlike `.drawer__scrim` —
a stray tap on the backdrop is not consent to kicking a room full of people.

### No round marker on team select or category voting

`HostHeader`'s `round` is now optional. Both phases only ever happen at
`history.length === 0`, so the number cannot change while the screen is up and
naming a round the room is not in yet is worse than saying nothing.
`PlayerVoting`'s meta line dropped it for the same reason.

### The drawers became inset cards with an inner-edge handle

`.drawer__panel` is inset 26px on all sides, rounded, with an `8px 8px`
shadow — one more object on the pink field rather than a second screen sliding
over the first. The close box is gone; a gold arrow tab straddles the panel's
inner edge (`.drawer__handle`, half on the card and half on the field), which
is the only new affordance plus the scrim and Escape.

A `×` in the corner of a panel that already has a handle is two controls for
one job, and the handle is the one that says which direction the panel goes.

The panel and its handle are flex siblings inside `.drawer`, whose padding
*is* the inset — so the handle needs no magic offset that would have to track
the panel's width.

### Readiness is the whole pill

`.player-pill--ready` fills gold with a `4px 4px` shadow and reads `✓ READY`;
`.player-pill--waiting` is `--code-empty`, flat, `··· WAITING`. The old
tick/ellipsis glyph is gone.

This is a TV. At sofa distance a glyph is already lost and a fill is not —
the host can read the room's state from the shape of the row.

### Team panels are fixed-width and wrap

`.team-grid` went from `repeat(var(--cols), minmax(0, 1fr))` to
`repeat(var(--cols), 182px)` with `justify-content: center`. Adding a team
adds a panel; it never rescales the other nine.

**This is the most important rule on the screen.** Players are aiming at a
colour on a TV while somebody shouts at them, and a target that moves every
time another player joins is the one thing team select cannot do. The
laptop-width media query narrows the panel to 148px — still fixed, so the
invariant that matters (width does not vary with team *count*) holds; only the
viewport moves it.

### The accent is an inner strip, never a top border

On every surface a player *aims at* — `.team-panel`, `.team-tile`,
`.player-teams__mine` — the team colour is carried inside the card: a filled,
slanted name tab overhanging the panel's top-left corner on the host screen, a
10px or 16px strip below the top edge on the phone. The card's ink outline
stays continuous on all four sides.

A coloured border reads as a card with a piece missing. `.id-card` and
`.standing-card` keep their `--accent` borders on purpose: those cards are
being *read*, not aimed at, and a border is the cheaper way to group a column.

### The ten team accents were revised against the field

The handoff flagged three problems. Two were real and both are fixed by
changing a colour rather than by rules:

| Slot | Was | Now | Why |
|---|---|---|---|
| 7 | `--team-pink` `#e93d82` | `#d6409f` | The old value sat close enough to `--pink` `#E62E5C` to vanish into the field. Magenta separates. |
| 8 | `--team-teal` `#12a594` | `--team-cyan` `#05a2c2` | Competed with `--teal`, which is the timer fill and the "OK," plaque. |
| 10 | `--team-cyan` `#00a2c7` | `--team-brown` `#ad7f58` | Freed by the above; brown is the only remaining hue that survives both the pink field and gold. |

`--team-yellow` stays `#ffb224` and deliberately does **not** move toward
`--gold`: a team must never read as the primary action.

`TEAM_COLORS` order is the palette — team *i* takes entry *i* — so the first
five teams, by far the common case, get the five most separated hues and the
two compromised slots are the ones a room rarely reaches.

### Width is the odds, on one scale across both rows

`flex-grow` is only ever relative to the row a card is in, so ten cards split
into two arbitrary rows made a one-vote card in a quiet row wider than a
two-vote card in a loud one — the mechanic quietly lying. `balancedRows()`
assigns heaviest-card-to-lighter-row, five per row, then restores pool order
*within* each row. The list still never re-sorts; only which row a card lands
in is derived.

Name size followed: a step function became `26 + 40 × (votes / max)` set
inline as `--name-size`, clamped in CSS by `min(var(--name-size), 17cqw)`
against the card's own width via `container-type: inline-size`. Two ceilings,
smaller wins — which is what stops a long category clipping in the narrow
column while still letting the leader be enormous.

### The timer bar is blockified in CSS, not at the call site

`.timer-track` and `.timer-track__fill` now declare `display: block`. They are
`<span>`s on both voting screens and `<div>`s on the round screen; an inline
box ignores `width` and `height` outright, so the span version had been drawing
an empty track with no fill at all — the host voting timer never animated.
Fixing it in the stylesheet rather than by swapping the tags means the element
a future call site happens to pick cannot break the bar again.

### The player's timer bar *is* the host's timer bar

`PlayerVoting` now renders `.timer-bar` — the same class, cream strip, Bungee
clock and teal-on-`--card-rule` fill the TV shows — bled to the frame edges
below `RESET VOTES`, rather than the thin cream-track sliver it had. It is one
object and the room is watching both copies of it at once.

### Locked picks show the draw chance

A player's own badged tiles gain the percentage that category gets drawn, from
`voteShares`. Gated on the countdown, not on `locked`: while voting is open the
tally is still moving, and a number ticking under the player's thumb reads as a
score rather than as odds. Any badged category holds at least that player's own
vote, so it can never render 0%.

## Deviations from the handoff

Two, both additive.

1. **Team select says where its brake is.** The prototype has no Stop on the
   host team screen — correct, and for a good reason (`cancelStart` is
   *rejected* there; see the teams spec). But a TV showing a running countdown
   with no visible way to stop it reads as broken, so the footer says "Leaving
   a team on your phone stops the countdown."

   The phone's `Leave team` button is deliberately **not** restyled to match.
   An earlier pass had it change wording and colour during a countdown; that
   was wrong. It is the same action either way, and a button that restyles
   itself mid-countdown reads as a *different* button appearing under the
   thumb already reaching for it. The TV explains; the phone stays still.

2. **The shared team-name field says it is shared.** The prototype marks it
   renameable with a pen glyph. It does not say *whose* name it is — and the
   field is shared, last-write-wins, so a teammate's edit can arrive under your
   thumb. A line of 11px copy ("Your whole team can rename this") makes that
   the expected thing rather than a glitch. The pen leads the name rather than
   trailing it, where it collided with the `JOINED!` badge.

The locked voting screen follows the prototype exactly: **no Stop button.**
`cancelStart` is legal there and would return the room to `voting`, but that
is a hair's breadth from where "Back to teams" already goes and reads as the
same escape. One way out per screen, in the corner every host screen keeps it
in.

One thing in the handoff was already stale on arrival: it says `TEAM_COLORS`
holds six colours and to extend it "only if the team cap is actually being
raised". The cap is 10 and has been since the teams branch; the list already
held ten. Only the four values in the table above changed.

## Out of scope

Untouched, and deliberately: the round screens (`playing`, `scoring`,
`standings`), Landing, the word list, and the entry overlay. `shared/` gained
nothing but the four palette values — no rule, event or phase moved for this,
and the whole change is presentation plus one confirmation dialog.
