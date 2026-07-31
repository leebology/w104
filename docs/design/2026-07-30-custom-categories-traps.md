# Custom categories — implementation traps

> **Provenance.** Verbatim copy of `CLAUDE.md` from the Claude Design project
> `Ok Name One custom categories`
> (`https://claude.ai/design/p/853962ae-f6d8-4fbc-a092-949722d1148c`), saved here on
> 2026-07-30. Read `2026-07-30-custom-categories-brief.md` for the numbers and
> `docs/superpowers/specs/2026-07-30-custom-categories-design.md` for the ruleset. Items
> 27, 30 and 31 are superseded where marked — the mechanic they describe was re-derived
> after the original was found missing.

Order of work is the plan's: `shared/` pure functions → `creating` phase → phone screens →
TV screens → the transition.

## The one that will definitely bite you

**An identical `animation` string does not restart.** Every keyframe on this feature can
fire twice in a row, so every one of them needs two identical copies alternated by index
parity:

| Pair | Fires repeatedly because |
| --- | --- |
| `cardLandA` / `cardLandB` | Two players stamp DONE within a second on the creation TV. |
| `slotAdvanceA` / `slotAdvanceB` | NEXT, NEXT, DONE — three advances in a row on one card frame. |
| `pickFlashA` / `pickFlashB` | Hand 1, hand 2, hand 3, each a pick. |
| `dealInA` / `dealInB` | Consecutive hands are the same three-card deal. |
| `plaquePopA` / `plaquePopB` | The author chips are a staggered run of the same pop. |

`popInA/B` and `dipA/B` already exist and are the precedent. Do not "fix" this with
`animation: none` + reflow. `pulseDot` is exempt — it is an infinite idle loop, never
retriggered.

## The rule that governs every screen

**A category is always a card.** Cream, `3px` ink, `radius 14px`, hard ink shadow, Bungee.
Never a row, a bar, a line of text or a list item — not in the phone's committed-cards
review, not in the creation slot, not on the race board, not in the reveal. If a layout
seems to want a list, it wants smaller cards.

## Host creation traps

1. **Never render draft text on the TV.** Not truncated, not blurred, not in a tooltip. The
   host payload for `creating` carries `slotCursor` and a filled/not-filled bitmap per
   player — **not the strings**. Send the drafts and someone will render them.
2. **"Writing" means the phone's cursor is on that slot**, not that keys are moving. Drive
   the dots from `slotCursor`, so a player who skips ahead does not leave a lying animation
   on an abandoned slot.
3. **Three signals, three channels.** Paper fill = reached, shadow = lifted, stamp-vs-dots =
   finished or in flight. Do not collapse them (e.g. a dimmed stamp for "writing"); the
   room reads this at 3 metres.
4. **The DONE stamp is a `.plaque`**, `rotate(-8deg)`, gold on `--ink-gold`, `3px 3px 0`.
   It is not a `✓` chip and not a `.player-pill` fragment.
5. **Fixed 218px columns.** Do not let them be `1fr`. A card that resizes when somebody else
   finishes is the same failure the team panels were fixed for.
6. **The wall switches on slot count, not player count.** 5 authors × 3 cards is 15 slots and
   still fits as columns; 13 authors × 1 does not. Branch on `players × quota > 15` or
   `players > 12`, whichever trips first. *(Spec §10 adds a third trip: quota ≥ 4, since a
   column of four 96px slots does not fit a 720p stage.)*
7. **The wall's mini pill is a `.player-pill`, scaled** — pinned inside the cell at
   `left: 8px; bottom: 8px`, taking the pill's own ready/waiting fills. Do not let it become
   unstyled text (that was the first draft's bug), and do not let it overhang the cell: at
   12px grid gaps an overhang lands on the neighbour.
8. **Not-started slots are `--code-empty`, no shadow, `opacity: .72`.** The missing shadow is
   the state change; do not also animate the border or radius.

## Voting board traps

9. **This is `HostVoting`, not a new screen.** Reuse `.host-voting__board` / `__row` /
   `.vote-card` and `flex-grow: votes + 1`. If you find yourself writing a `.race-lane`,
   stop — the fork is the *pool source* and the *close sequence*, nothing else.
10. **Width is `flex-grow`, not an inline `width`.** The cards are siblings in a row; that is
    what makes the weighting relative and the 220ms transition free.
11. **Keep `container-type: inline-size`, and the name is `max(24px, min(<cap>, 17cqw))`.**
    Drop the `cqw` and the leader's name stops being huge, which is the whole read of the
    board. Drop the `max()` and the smallest card falls to ~13px on a 1280 TV.
12. **Never put more than ten cards on the board**, five per row, `min-width: 132px`. At eight
    per row the smallest card is ~104px and cannot fit a 24px name — the `max()` clamps it and
    the text overflows instead. Everything past ten goes in the pack pill.
13. **Balance the crowded rows by weight, not by sequence.** Slicing the sorted list in half
    puts all the heavy cards in row one and collapses row two.
14. **Zero-vote cards stay on the board during voting** (sunken, no count) and **leave at
    close**. Both halves matter: they hold the shape while votes land, and they must be gone
    before shares are shown or the percentages look wrong.
15. **The count is bottom-right in `--pink`, inside the card** — the stock position. It only
    becomes a `%` at close.
16. **No voter avatars, ever.** No trail, no "N players hold this" hint. The TV shows the
    tally only; hands are private until the reveal.
17. **Reserve the author chip's box before it pops.** It sits inside the card above the name,
    in flow. Insert it at pop time and it shoves the name sideways mid-animation. Render at
    `opacity: 0` with its final size from the close frame, then animate transform + opacity.
18. **The author chip is not a `TeamBadge`** and there is no `TeamBadge` on either screen.

## Phone / keyboard traps

19. **The creation input must not be inside a `<form>`** — Safari's AutoFill bar. It is a
    *different* input from the round's entry field; the round's field still lives outside the
    phase screens in `PlayerView` and is moved offstage with CSS, not unmounted.
20. **`.creating--compact` is a class, not a media query.** Media queries measure the layout
    viewport, which does not shrink when the keyboard opens. Set the class where
    `--vv-height` is written (`src/viewport.ts`), threshold `620px`.
21. **Never resize the pager chips or the commit button.** 44px and ≥52px at every viewport.
    If something has to give, it is the timer numeral.
22. **Do not scroll the creation screen, and do not `scrollIntoView` the card.** The screen is
    `position: fixed` at `--vv-top`; a scroll here fights the browser's own keyboard scroll
    and the card ends up half under the keys.
23. **The committed-cards review keeps `flex: 1` per card.** They are the same cards, not
    summary rows. The pen glyph is pinned bottom-right so it never competes with the text.
24. **`.vote-tile`s need `box-sizing: border-box`** in their locked/`<div>` form, exactly as
    the stock locked grid does, or the picks measure wider than the cards they replace.
25. **Committing is readying (D16), on commit only.** Never flag ready on keystroke — the
    phase can close under the player mid-word. Filled is measured after `trim()`.
26. **Clearing a committed card un-readies**, and that path must also cancel an in-flight
    "everyone ready" close on the server.

## Mechanic traps

27. **Never deal a player their own card**; teammates' are fine (D15). Do not add a filter
    that breaks equal exposure. *(Superseded in part — spec §4.2 softens this to "prefer
    non-own, allow own only when unavoidable", which only ever bites at 1–2 players. The
    "no filter" half stands.)*
28. **The house card does not exist until creation closes.** Do not render house cards on the
    creation TV before the deadline, and do not mark them in a hand. Marked only at the
    reveal.
29. **Identical texts stay separate through voting and merge at the draw** (D20). The board
    can therefore show two cards with the same text — correct, not a bug; merging them on the
    TV would misstate the weights.
30. **`voteBudget` forks.** Custom is not `roundCount − 1`. Both counters (TV prompt, phone
    pips) read the same function. *(Superseded — the `V / 3` rule this originally cited was
    unrecoverable and contradicted by the prototype's own frames. See spec §3.3.)*
31. **Two-player rooms fall back to the stock pool.** *(Superseded — spec §3.4 lets 1–2
    player rooms play custom with the rules bent. The guard-before-the-phase-opens principle
    still applies to whatever gating remains.)*

## System rules that still apply

- `--border` and `--radius` never animate. Translate, rotate, scale, fade only.
- No soft shadows. Every shadow is a hard ink offset. The only blur in the system is the
  scoring screen's penalty ring, and nothing here uses it.
- No loose hex outside `:root`. No `color-mix()`, no `oklch()`.
- Neither screen scrolls. Only a box that explicitly asked for it may.
- One gold band per screen. Creation has the plaque; voting has the footer button; the closed
  board has the `Get ready…` plaque.
- The host's back-out is top-right (`HostExit`), never beside the gold button. Players get a
  `.back-pill`.
- No round marker on either phase — both only ever happen before round one.
- Every animation degrades under `prefers-reduced-motion: reduce` to **the settled end
  state**, not to "no animation". For the transition that means the voting screen, fully laid
  out, on the first frame.

## Verify at these settings

- 3 players × 3 cards, and 24 players × 1 card, on the creation TV.
- One player mid-phase: one DONE, one dots, one empty, all three in the same column.
- Quota 1 on the phone: no pager, `DONE` on the only card.
- Keyboard up at 390×844 **and** at 375×667 (`--vv-height` ≈ 407) — the compact table has
  ~100px of slack at 508 and roughly none at 407, so the card hits its 132px floor there.
- Board at 6 votes / 8 cards, and at 62 votes / 30 cards — measure every name; none under 24px.
- A 20-character category in a 218px slot, on the board at one vote, and on a phone hand card.
- Everyone blank at close: all house cards, all gold at the reveal.
- The transition at `prefers-reduced-motion: reduce`: voting screen on frame one.
