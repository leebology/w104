# Ok, Name One — design handoff for the v1 screens

**Date:** 2026-07-27
**For:** Claude Design
**From:** the w104 implementation branch (`teams`, folded into `v1`)
**Status:** functionality complete and merged into the v1 stack; presentation
is placeholder and is what this brief asks for.

---

## 1. What this is

Four features landed on top of the shipped MVP: a multi-round match structure,
category voting, gamemode/settings drawers, and team play. Two of them added
**new screens** and one **rebuilt the host lobby**. Those screens were built to
be *correct*, not to be looked at — every rule, edge case and privacy boundary
is settled and tested, and the CSS is a first pass written by the implementer
to keep the thing legible while the logic was proven.

**This brief asks for design iterations on those screens only.** Everything
else in the app already came through the "Ok, Name One" system and should not
move.

The reverse of this document already exists: the *previous* Claude Design
handoff was turned into
[`docs/superpowers/specs/2026-07-26-ok-name-one-ui-design.md`](../superpowers/specs/2026-07-26-ok-name-one-ui-design.md).
Read that first — it records how the last handoff was interpreted, which
decisions were taken at implementation time, and why. This brief follows the
same shape so the output can be absorbed the same way.

## 2. The design system is fixed

`design_handoff_ok_name_one/Ok Name One MVP.dc.html` remains the source of
truth for anything numeric. A flat-graphic poster look: pink field, cream
cards, ink borders with hard offset shadows, gold for primary action, Bungee
display over Archivo body.

Constraints that are not negotiable, because the code enforces them:

- **Tokens only.** `src/style.css` has no loose hex outside `:root`. New
  colours must arrive as new tokens with a stated purpose.
- **No `color-mix()`, no `oklch()`, no relative colour syntax.** Not a taste
  call — the file deliberately avoids them and a mixed value cannot be
  round-tripped back into a token.
- **Shape constants never scale with the viewport.** `--border`, `--radius`,
  `--shadow-card`, `--shadow-btn` are fixed. Only type scales. Enlarging
  borders on a TV softens the flat-graphic look the system is built on.
- **Never cream on cream.** There is no dark mode; `color-scheme: light` is
  declared and the OS must not invert anything.
- **The document never scrolls.** Scrolling belongs to individual boxes (the
  word list vertically, avatar strips horizontally), never the page. On a phone
  the keyboard would otherwise drag the whole layout around.
- **Two viewports, both fixed.** Phone screens were drawn at 390×844
  (`.screen--mobile`); the host screen is a TV/laptop in landscape
  (`.screen--host`) and must read from a sofa. Every host screen is
  `100dvh` with no scroll — content fits or it is redesigned.

## 3. The ten team accents

Team play introduced a second colour axis, which is the largest new thing in
the system and the part most worth a designer's eye. Ten fixed accents, one per
possible team:

| Token | Value | | Token | Value |
|---|---|---|---|---|
| `--team-red` | `#e5484d` | | `--team-orange` | `#f76b15` |
| `--team-blue` | `#3e63dd` | | `--team-pink` | `#e93d82` |
| `--team-green` | `#30a46c` | | `--team-teal` | `#12a594` |
| `--team-yellow` | `#ffb224` | | `--team-lime` | `#99d52a` |
| `--team-purple` | `#8e4ec6` | | `--team-cyan` | `#00a2c7` |

These were picked for hue separation, not for the poster palette, and **they
have never been seen next to `--pink`**. Reviewing them against the field is
explicitly in scope. Three problems to solve rather than inherit:

1. `--team-pink` and `--team-red` sit very close to `--pink` (`#E62E5C`) and
   may disappear against it.
2. `--team-yellow` and `--team-lime` may fight `--gold` (`#FFD400`), which is
   the primary-action colour and must stay the loudest thing on a screen.
3. Ten swatches must stay distinguishable **across a room**, at TV distance, at
   whatever size a ten-panel grid allows.

Mechanical rules the colour system has to respect:

- A team's colour is assigned at creation by index (team 0 = red, team 1 =
  blue, …) and **is never rewritten**. Renaming a team must not recolour it —
  the colour is what the room navigates by, and the name is the thing that
  changes.
- Every accented surface reads a single custom property `--accent`, set inline
  from one of the tokens above. No other rule in `style.css` names a team
  colour. Whatever you propose has to survive that one-property indirection.
- A team is identified by **colour, not emoji**. Teams have no avatar; the
  emoji belong to the players inside them.

---

## 4. Screen briefs

Class names are given so proposals can be mapped back to real markup. Each
screen lists its states — every one needs to work, and the states are where the
current CSS is weakest.

### A. Host lobby — **rebuilt** (`.screen--host`)

The old lobby had settings steppers inline on the screen. They now live in two
edge drawers, so the lobby itself is emptier and the room code is the hero.

Composition, top to bottom: a `Back` pill, a header row (wordmark left,
`ROUND 1 OF 3` centre, player count right), then the stage — a join
instruction, the room code in a full-bleed banner, and a row of player pills —
then a footer with a hint and the `Start game` button.

Two tabs sit on the left and right edges: `.drawer-tab--left` ("Game modes")
and `.drawer-tab--right` ("Game settings"). Tapping one opens
`.drawer` — a scrim plus an `.drawer__panel` sliding in from that edge, with
`.drawer__head` (title + `×`) over `.drawer__body`.

- **Game modes drawer** — a list of `.mode-row` buttons, each a name plus a
  one-line blurb, one marked `.mode-row--active`. Generated from a catalog:
  today there is one mode, tomorrow there may be six. Design for the list, not
  for one item.
- **Game settings drawer** — a `.drawer__note` naming the active mode, then one
  `.stepper` per setting the mode declares. A stepper is a label, a `−`/value/`+`
  row where the value is a typable input, and a formatted hint underneath.
  Today: Rounds (`1–10`), Timer (`15s–10:00`, shown as `45s` or `2:30`), Teams
  (`OFF`, or `2–10`, shown as `4 teams`).

States to design:
1. Empty room — "Waiting for players to join…", Start disabled.
2. Players present, none ready.
3. Countdown running — the footer swaps to `Get ready… 5` plus a `Stop`
   button, and the settings drawer's steppers render `.stepper--disabled`.
4. Either drawer open, over any of the above.

Known rough edges worth solving:
- **The tabs are easy to miss.** They are the only route to every match
  setting, on a screen a host sees for ten seconds before their friends start
  shouting. Discoverability is the brief.
- **The Teams stepper jumps `0 → 2`** and labels zero as `OFF`. It is a
  three-state control (off / on / how many) wearing a number stepper's clothes.
  A better control for that is welcome.
- The drawers overlay rather than push, deliberately: the room-code banner is
  negative-margined to full bleed and must never reflow.

### B. Player lobby — **modified** (`.screen--mobile`)

Unchanged except for a settings summary line under the room code:

```
CLASSIC · 3 ROUNDS · 0:45 · 4 TEAMS
```

`.player-lobby__settings`. The teams clause appears only when teams are on. A
second line, same class, appears while the host has a drawer open:
"Host is adjusting settings…" — it exists because the host's countdown visibly
vanishes when a drawer opens, and without an explanation the room looks broken.
That line is doing real work and needs to read as *status*, not as a setting.

### C. Host team select — **new** (`.host-teams`, `.screen--host`)

The room-scale view of team picking, between the lobby and category voting.
Header is the same shape as the voting screen: room chip, round indicator,
player count.

Body is `.team-grid` — a grid of `.team-panel` cards, one per team, capped at
five columns (so 2–5 teams is one row, 6–10 is two). Each panel carries its
team's `--accent`, a `.team-panel__name` heading, and
`.team-panel__members`: a list of avatar + name, with `.team-member--gone` for
a player whose phone dropped.

Below that, `.team-unassigned` — a "STILL PICKING" label and the avatars of
everyone who has not chosen yet. It is absent once everyone has picked.

Footer: a hint ("Anyone still picking gets dropped into the emptiest team."),
a `Continue` button, and a `Back to room` ghost button.

States:
1. Nobody has picked — every panel empty, everyone in the unassigned strip.
2. Partly picked.
3. Everyone picked — the unassigned strip disappears and the footer's hint and
   Continue are replaced by `Get ready… 5`. **`Back to room` stays.**
4. Countdown running after a manual Continue, which looks like (3).

The hard problem, and the reason this screen matters most:

- **Ten panels have to work as well as two.** Two teams on a TV is easy. Ten
  panels in two rows of five, each with up to five players and a name long
  enough to be a joke, is the case that will actually break.
- **Avatars moving into panels is the moment of the screen.** A player tapping
  a colour on their phone should visibly land on the TV. There is no motion
  design at all right now.
- **There is no Stop button and that is deliberate.** Cancelling would clear a
  readiness state nothing could restore. Players stop the countdown by leaving
  their team, on their own phones. The TV should probably *say* that.
- The panel name is live-edited by players from their phones. It updates
  mid-countdown, mid-glance.

### D. Player team select — **new** (`.player-teams`, `.screen--mobile`)

The phone half of the same phase.

Top: `ROOM PLUM · PICK A TEAM`. Then, if the player has a team, a
`.player-teams__mine` card in that team's accent containing an editable team
name input (`.player-teams__name`, 20 chars, commits on blur or Enter) and
`.player-teams__members`, the roster with "(you)" marking self. If they have no
team, a hint instead: "Tap a colour to join it."

Then `.player-teams__grid` — the picker. One `.team-tile` per team, each in its
own accent, showing `.team-tile__name` and `.team-tile__count` (the members'
emoji strung together, or an em-dash when empty). The player's own tile is
`.team-tile--mine`.

Footer: `Get ready… 5` during a countdown, and a `Leave team` button whenever
the player is on a team.

States:
1. No team chosen — no card, hint showing, no Leave button.
2. On a team, no countdown.
3. On a team, countdown running — **the picker stays live**. Tapping another
   team switches; `Leave team` halts the countdown for the whole room.
4. Editing the team name, keyboard up. This is a phone with a fixed-height
   locked screen and a soft keyboard over the bottom third.

Things to solve:
- **`Leave team` is doing two jobs** — it is both "I changed my mind" and the
  only emergency brake on a countdown the host started. In state (3) it is the
  more important button on the screen and currently looks identical to state
  (2). It probably should not.
- **Ten tiles on a 390px-wide screen.** They are colour swatches carrying a
  name and a variable-length emoji string.
- **The team name field is shared, not personal.** Two teammates can type into
  it; last write wins. Nothing currently signals that it is a *team* field
  rather than the player's own.

### E. Team accents in the round screens — **adjustments**

Not new screens, but scoring and standings now render teams where they used to
render players, and the changes were made mechanically:

- `.id-card` on host and player scoring takes the team `--accent`, shows the
  team name where a player's emoji was, and grows an `.id-card__members` strip
  of member avatars underneath.
- `.standing-card` likewise, with `.standing-card__members` as an emoji string.
- Words are attributed to the teammate who wrote them, so a team's list carries
  per-word author emoji that an individual's list does not.

These want a designer's pass mainly for **hierarchy**: with a team accent, a
team name, a placement number, a score, a member strip and per-word authors, an
id-card now has six kinds of information where it had three.

---

## 5. What would be most useful back

In rough priority:

1. **Host team select**, at 2, 5 and 10 teams. It is the screen with the most
   new surface and the one a whole room looks at simultaneously.
2. **The ten team accents against `--pink`**, revised or replaced, as tokens.
3. **Player team select**, including the countdown state and the keyboard-up
   state.
4. **The drawer tabs and the Teams control** on the host lobby.
5. Scoring/standings hierarchy with team cards.

Same delivery format as last time works well: a `.dc.html` carrying exact
values as the source of truth, PNGs for orientation. Where a screen has states,
the states are the deliverable — a single beauty shot of the full case is the
one thing that reliably does not survive implementation.

## 6. Where to look

| | |
|---|---|
| Design system in force | `src/style.css` (`:root` for tokens) |
| How the last handoff was absorbed | `docs/superpowers/specs/2026-07-26-ok-name-one-ui-design.md` |
| Team rules and rationale | `docs/superpowers/specs/2026-07-27-teams-design.md` |
| Drawer rules and rationale | `docs/superpowers/specs/2026-07-27-gamemode-drawers-design.md` |
| Host team select | `src/screens/host/HostTeams.tsx` |
| Player team select | `src/screens/player/PlayerTeams.tsx` |
| Host lobby + drawers | `src/screens/host/HostLobby.tsx`, `GameModesDrawer.tsx`, `GameSettingsDrawer.tsx` |
| Stepper behaviour | `src/components/Stepper.tsx` |

Run it with `npm run dev:party` and `npm run dev`, then open `?p=1` (creates
the room and is the TV), `?p=2`, `?p=3` in three tabs. Set Teams to 2 in the
settings drawer to reach the team screens.
