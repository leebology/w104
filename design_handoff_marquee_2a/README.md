# Handoff: Ok, Name One — Lobby, Teams & Category Selection (Marquee 2A)

## Overview
"Ok, Name One" is a Jackbox-style party game: a shared host screen plus one phone per
player. This package covers the ten views that were unspecified in the original MVP
handoff — everything between "the room exists" and "the round starts":

room setup (including the two host drawers and the close-room confirm), team selection,
and category voting in both its open and locked states, each in host and player form.

The **Marquee 2A** formatting was chosen from three explored directions. Its rule: one
−2.5° gold band per screen carries the single loudest thing, and everything else is a
flat cream pill on the pink field. This is a continuation of the shipped host-playing
screen, not a new look.

## About the Design Files
`Ok Name One - Marquee 2A.dc.html` is a **design reference written in HTML** — a
prototype showing intended look and layout, not production code to lift. All ten views
are laid out side by side in one scrollable canvas at fixed frame sizes so they can be
compared; the real app renders one view at a time, full-viewport.

The task is to **recreate these views in the existing `w104` codebase** (React + Vite +
TypeScript, plain CSS in `src/style.css`) using its established patterns:

- Screens live in `src/screens/host/*.tsx` and `src/screens/player/*.tsx`.
- Shared pieces already exist and should be reused, not re-implemented:
  `Wordmark`, `RoomChip`, `PlayerPill`, `Roster`, `AvatarPicker`, `Stepper`, `Drawer`,
  `HostHeader`.
- Styling is **class-based CSS in `src/style.css`**, whose custom properties are the
  source of truth. The inline styles in the prototype exist only because the prototype
  is a single file — translate them back to the existing classes and tokens rather than
  shipping inline styles. Where a token already exists (`--ink`, `--paper`, `--gold`,
  `--teal`, `--field`, `--tilt`, hard-offset shadows) use it.
- Game rules and data come from `shared/` — `categories.ts`, `teams.ts`, `gamemodes.ts`,
  `state.ts`. Do not hard-code category lists, team colours, or caps.

## Fidelity
**High-fidelity.** Colours, type, spacing, borders and shadows are final and match the
existing design system. Recreate pixel-for-pixel using the codebase's classes. The only
deliberately loose parts are the sample content (names, avatars, vote tallies) and the
side-by-side canvas arrangement.

## Design Tokens
Every value below is already defined in `src/style.css`. No new tokens are introduced.

### Colour
| Token | Hex | Use |
|---|---|---|
| `--field` | `#E62E5C` | Pink screen background, host and player |
| `--paper` | `#FFF7E8` | Cream cards, pills, drawers, timer footer |
| `--ink` | `#1A0710` | All borders (3px, 4px on primaries) and hard shadows |
| `--ink-dim` | `#7A6A5C` | Secondary text on cream |
| `--gold` | `#FFD400` | The band, primary buttons, ready state, vote badges |
| `--ink-gold` | `#2A1400` | Text on gold |
| `--teal` | `#00A6A6` | "OK," plaque, timer fill, caret, pulse dot |
| `--paper-sunk` | `#F6D9C6` | Unfilled/inactive: waiting pills, unvoted tiles |
| `--paper-track` | `#E7D3BE` | Timer track, unselected avatar cells |
| `--paper-lit` | `#FFF3C4` | Row tint for the player's own team |

Team colours come from `TEAM_COLORS` in `shared/teams.ts`, indexed by team position:
red `#e5484d`, blue `#3e63dd`, green `#30a46c`, yellow `#ffb224`, purple `#8e4ec6`,
orange `#f76b15`. The prototype extends the list to ten for exploration
(pink `#d6409f`, cyan `#05a2c2`, lime `#99d52a`, brown `#ad7f58`) — **add these to
`shared/teams.ts` only if the team cap is actually being raised**; otherwise keep six.

### Type
- Display: **Bungee** — all headings, buttons, counts, names, room codes. Uppercase by
  intent, tracked `.06em`–`.18em` for small labels.
- Body: **Archivo** 400/500/600/700 — sentence copy, member lists, hints.
- Host minimum body size 14px, display sizes 18px–132px. Player minimum 11px labels,
  15px–48px display.

### Form
- Borders: 3px ink default; 4px on primary buttons and the player's own team card.
- Radius: 8px small plaques, 10px slats/inputs, 12px avatar cells, 14px cards,
  99px pills and buttons.
- Shadows: **hard offsets only, never blurred** — `3px 3px`, `4px 4px`, `5px 5px`,
  `6px 6px`, `7px 7px`, `8px 8px 0 var(--ink)`. The gold band uses
  `0 12px 0 rgba(0,0,0,.25)` as its drop.
- Tilt: `--tilt: -2.5deg` for the band and plaques; the wordmark is `-4deg` / `+2deg`.
- Motion: only `pulseDot 1.2s infinite` (the "still picking" dot). Everything is wrapped
  by `@media (prefers-reduced-motion: reduce)`.

## Screens / Views

### 1. Host · Room
**Purpose:** the join screen; shows the code and who's in, and starts the game.

Layout, top to bottom in a `1200×675` pink frame:
- **Header** (`padding: 22px 34px`, space-between): `Wordmark` at left (teal "OK," plaque
  rotated −4°, gold "NAME ONE!" plaque rotated +2°, overlapping by 6px); `ROUND 1 / 3` in
  Bungee 18px absolutely centred; right cluster (`gap: 16px`) of the player count and a
  **`CLOSE ROOM`** button (Bungee 13px, transparent, 3px cream border, pill).
- **Centre** (`gap: 26px`): the line `JOIN AT OKAYNAMEONE.APP · ROOM CODE` in cream
  18px tracked `.16em`; then the **gold band** — full-bleed (`margin: 0 -74px`), rotated
  −2.5°, `padding: 18px 0 22px`, holding the room code in Bungee **132px** tracked `.1em`
  on `--ink-gold`; then the roster.
- **Roster:** centred wrapping flex, `gap: 14px`. Each pill is `border-radius: 99px`,
  3px ink border, `padding: 9px 12px 9px 16px`, holding a 22px emoji, the name in
  Bungee 15px, and a state tag in Bungee 11px on its own 99px chip.
  **Ready state is carried by the whole pill, not a glyph:** ready is gold fill,
  `--ink-gold` text, `4px 4px 0` ink shadow, cream tag reading `✓ READY`; waiting is
  `--paper-sunk` fill, `--ink-dim` text, **no shadow**, tag reading `··· WAITING`.
- **Footer:** the primary `START GAME` (Bungee 16px, gold, 4px ink border,
  `5px 5px 0` shadow, `padding: 16px 30px`), plus `GAME MODES` bottom-left and
  `GAME SETTINGS` bottom-right as absolutely positioned cream pills with the same shadow.

### 2. Host · Room (drawers extended)
Both drawers are shown open **for review only** — the app opens one at a time.

- Room content stays behind, dimmed by a full-bleed `#1A0710` at `opacity: .55`.
- Each drawer is an **inset rounded panel**, not a full-height slab:
  `top/bottom/left(or right): 26px`, `width: 400px`, cream, 4px… (3px) ink border,
  `border-radius: 14px`, `box-shadow: 8px 8px 0 var(--ink)`, `overflow: hidden`.
- Title row: Bungee 18px, `border-bottom: 3px solid var(--ink)`.
- **Collapse affordance:** no close box. A gold arrow tab straddles the drawer's inner
  edge — `44×62px`, 3px ink border, radius 12px, `5px 5px 0` shadow, `‹` on the left
  drawer and `›` on the right, vertically centred. Tapping it *or the dimmed area*
  collapses the drawer.
- **Game modes** (left): one card per mode from `GAME_MODES` — gold fill, 3px ink border,
  radius 14px, `6px 6px 0` shadow, Bungee 16px name over Archivo 13px blurb. Currently
  only Free-for-All; the trailing note reads "More modes are on the way. The room keeps
  whichever one is lit."
- **Game settings** (right): the mode name, then one `Stepper` per setting from
  `modeSpec` — ROUNDS, TIMER, TEAMS. Each is a cream card (3px ink, radius 14px,
  `6px 6px 0`) with an 11px tracked label, a `−` / value / `+` row where the buttons are
  `32×32px` gold squares (3px ink, radius 8px) and the value is Bungee 26px, plus a
  formatted hint below (`0:30`, `4 teams`). Respect `MIN_TEAM_COUNT` / `MAX_TEAM_COUNT`
  and the clock formatter in `net/clock.ts`.

### 3. Host · Room (closing the room)
Same dim over the room; the `CLOSE ROOM` button flips to its active cream fill.

Dialog: centred, `width: 660px`, cream, 4px ink border, radius 14px,
`8px 8px 0` shadow, `overflow: hidden`, with a **16px pink cap strip** across the top
(`border-bottom: 3px solid var(--ink)`) — the cap colour signals a destructive action.
Body: `Close this room?` in Bungee 30px, then Archivo 17px `--ink-dim`:
"Are you sure you want to close this room? All players will be kicked."
Actions, right-aligned, `gap: 14px`: `NO, KEEP PLAYING` (cream, 3px ink) and
`YES, CLOSE IT` (gold, 4px ink) — both Bungee 16px, `padding: 14px 30px`, `5px 5px 0`.

### 4. Player · Room
`390×844`, `padding: 52px 24px 30px`, `gap: 16px`.
- Gold `ROOM PLUM` plaque rotated −2.5°, 4px ink, `5px 5px 0`, Bungee 20px.
- Settings line in 12px cream: mode · rounds · timer · teams.
- **Your name** card: cream, 3px ink, radius 14px, `6px 6px 0`; Bungee 14px label over a
  10px-radius 3px-ink input, Archivo 18px/600.
- **Pick an avatar** card: same shell; a 3-row grid of `48px` cells scrolling
  horizontally (`grid-auto-flow: column`). Unselected cells are `--paper-track` with a
  transparent 3px border; the selected cell is cream with a 3px **ink** border and a
  `4px 4px 0 var(--gold)` shadow — selection happens in place. Order is append-only per
  `AvatarPicker`.
- `READY UP` primary pinned to the bottom (`margin-top: auto`), full width.

### 5. Host · Team Selection
No round marker — team selection only happens before round 1.

- Header: `RoomChip` (cream pill, `JOIN AT OKAYNAMEONE.APP · ROOM` in 14px `--ink-dim`
  plus the code in Bungee 28px) at left; right cluster of the player count and
  **`BACK TO ROOM`** (same top-right treatment as `CLOSE ROOM`).
- Gold `PICK A TEAM` plaque, centred, rotated −2.5°, Bungee 22px.
- **Team grid:** fixed **182px** columns, `gap: 12px`, `justify-content: center`,
  five per row so 6–10 teams spill to a second row. Adding a team adds a panel; it must
  **not** rescale the others. Each panel is cream, 3px ink, radius 14px, `6px 6px 0`,
  `padding: 26px 14px 14px`, with the team name on a tab overhanging the top-left
  (`top: -14px`), filled with the team colour, ink text, 3px ink border, rotated −2.5°,
  `3px 3px 0`. Members list as 20px emoji + Archivo 14px name.
- **Still picking:** the label in Bungee 12px followed by a pill per straggler —
  `--paper-sunk`, 3px ink, their avatar and name, and an 8px teal dot running `pulseDot`.
- Footer: `CONTINUE` primary, centred.

### 6. Player · Team Selection
- Gold `PICK A TEAM` plaque, Bungee 16px.
- **Your team card** — visually separated from the rest: cream, **4px** ink border,
  radius 14px, `7px 7px 0` shadow, `overflow: hidden`, with a **16px team-colour strip**
  inside the top edge (`border-bottom: 3px solid var(--ink)`) so the ink outline stays
  continuous on all four sides. A gold `JOINED!` badge (Bungee 11px, 3px ink, rotated
  −2.5°, `3px 3px 0`) sits at the card's top-right. The name is Bungee 26px followed by a
  **pen glyph** (17px, 2.6px stroke, `--ink-dim`) marking it renameable; members below in
  Archivo 14px.
- A divider — 3px cream rules either side of `OR SWITCH TO` — with `margin: 14px 0 6px`.
- **Switch grid:** two columns, `gap: 12px`. Each tile is cream, 3px ink, radius 14px,
  `5px 5px 0`, with the same **10px inner colour strip** at the top, the team name in
  Bungee 15px and its members' emoji in Archivo 18px.
- Footer: gold `Get ready… 3` plaque over a full-width cream `LEAVE TEAM`.

### 7. Host · Category Selection (choosing)
- Header: `RoomChip`; right cluster of `N PLAYERS · N READY` and **`BACK TO TEAMS`**
  (`BACK TO ROOM` when teams are off).
- Sub-line: `PICK YOUR CATEGORIES — N VOTES EACH`, Bungee 15px.
- **Vote cards:** two flex rows of five. **A card's width is the odds** — `flex-grow`
  is `votes + 1`. The two rows are balanced to near-equal total grow so a card's width
  means the same thing in either row; without that, a 1-vote card in a quiet row ends up
  wider than a 2-vote card in a loud one.
  Each card: `min-width: 104px`, `container-type: inline-size`, 3px ink, radius 14px,
  `padding: 9px 12px`. Voted cards are cream with `5px 5px 0`; zero-vote cards are
  `--paper-sunk` with **no** shadow.
  The name is Bungee at `min(scaledSize, 17cqw)` where `scaledSize` grows with vote share
  (26px at zero votes up to ~66px for the leader) — the container query is what keeps
  long names like "Towns in MA" from clipping in a narrow card, with
  `overflow-wrap: anywhere`. Voter emoji sit bottom-left (19px, wrapping to two lines,
  clipped under pressure); the count sits bottom-right in Bungee 22px `--field`.
- **Timer footer:** `flex: 0 0 106px`, cream, `border-top: 3px solid var(--ink)`;
  Bungee 52px clock, a 28px 99px-radius `--paper-track` bar with a teal fill, and the
  `CONTINUE` primary. Nothing else lives here.

### 8. Player · Category Selection (choosing)
- Meta line: `ROOM PLUM · N VOTES EACH`.
- **Budget card:** cream, 3px ink, radius 14px, `6px 6px 0`; the remaining count in
  Bungee 48px `--field`, `N vote(s) left`, and one 15px pip per vote in the budget —
  gold when spent, `--paper-sunk` when not, each with a 3px ink border.
- **Category grid:** two columns, `gap: 16px 14px`, `padding: 14px 18px 4px`. Tiles are
  `<button>`s: cream, 3px ink, radius 14px, `5px 5px 0`, `min-height: 56px`, Bungee 16px,
  left-aligned. A tile you've backed carries a gold 👾 badge overhanging its top-left
  corner (`top: -11px; left: -9px`, 3px ink, 99px).
- Footer: full-width cream `RESET VOTES`, and **below it** the host's timer bar —
  the same cream `76px` strip, Bungee 34px clock and teal-on-`--paper-track` fill,
  bled to the frame edges. Using the host's bar here is deliberate: it's the same object
  on both screens.

### 9. Host · Category Selection (locked)
- Header: `RoomChip`; right cluster of `VOTING CLOSED · N VOTES IN` and the back-out
  button (`BACK TO TEAMS` / `BACK TO ROOM`).
- **Podium:** the top three in a `206px`-tall row, `flex-grow` = votes, cream, 3px ink,
  radius 14px, `5px 5px 0`. Names step 52 / 34 / 30px; percentages step 46 / 34 / 30px in
  Bungee `--field`.
- **Runners-up:** wrapping row of `flex: 1 1 150px; max-width: 220px` cards,
  `min-height: 86px`, name Bungee 19px, percentage Bungee 20px.
- **Footer:** the gold `Get ready… 3` plaque alone — rotated −2.5°, 4px ink,
  `5px 5px 0`, Bungee 40px.

### 10. Player · Category Selection (locked)
Continuity with view 8 is the point: **same grid, same tiles.**
- Status card: 34px avatar, `you're in` in Bungee 15px, and
  `all N votes spent — waiting on N` in 13px `--ink-dim`.
- Tiles keep the exact geometry of the voting grid — set `box-sizing: border-box` on
  them, since they render as `<div>`s rather than `<button>`s and would otherwise
  compute wider than the cells they must match.
  - **Your picks** are unchanged: cream, `5px 5px 0`, gold 👾 badge, no transform —
    plus the **draw chance**: the percentage in 22px `--field` with a 11px/600
    `CHANCE` label in `--ink-dim`. Any badged category is ≥1 vote, so this can never
    read 0%.
  - **Everything else** presses into its own shadow: `--paper-sunk` fill, `--ink-dim`
    text, no shadow, `transform: translate(4px, 4px)` — the shipped
    `.vote-tile--locked` behaviour.
- Footer: the gold `Get ready… 3` plaque.

## Interactions & Behavior
- **Room:** `CLOSE ROOM` opens the confirm dialog; `YES, CLOSE IT` tears the room down
  and kicks every player, `NO, KEEP PLAYING` dismisses. `START GAME` before everyone is
  ready readies the remainder implicitly.
- **Drawers:** one open at a time. Open from the footer buttons, dismiss via the inner
  arrow tab or a click on the dimmed backdrop (and `Esc`). Stepper changes apply live to
  the room's `MatchSettings` and are visible to players immediately.
- **Player room:** name and avatar write through on change; `READY UP` toggles ready.
- **Team selection:** tapping a team joins/switches it; leaving un-readies. Stragglers
  are assigned to the emptiest team by `assignStragglers` when the host continues.
  Team names are renameable by the team's own members (the pen glyph).
- **Category voting:** each player has `budget` votes, at most one per category. Tapping
  a tile spends a vote, tapping again returns it, `RESET VOTES` returns all. The host
  board updates live — card widths and type sizes re-derive from the tally on every vote.
  When the timer expires or the host continues, voting locks, the board resolves to the
  podium, and the winning category is drawn weighted by vote share at the whistle.
- **Motion:** none beyond `pulseDot` and the countdown text. All of it disabled under
  `prefers-reduced-motion`.

## State Management
Everything needed already exists in `shared/state.ts` and the room store. The views read:
- `room.players[]` — id, name, avatar, ready, teamId
- `room.settings` — mode, roundCount, durationSec, teamCount
- `room.teams[]` — id, name, colour index, member ids
- `room.votes` — playerId → category ids; derive per-category tallies and voter avatars
- `room.phase` — `lobby | teams | voting | votingLocked | playing`
- `room.deadline` — read through `useRemaining` / `formatClock` in `net/clock.ts`, never
  a local interval
- Local, per-client only: the drawer that's open, the close-room dialog, and in-flight
  name/avatar/team-name text.

## Assets
None. Avatars are emoji from `AVATARS` in `src/components/AvatarPicker.tsx`; the pen
glyph is a two-path inline SVG; there are no images, icon fonts, or illustrations.
Fonts are Bungee and Archivo, already loaded by the app.

## Files
- `Ok Name One - Marquee 2A.dc.html` — all ten views. Open it directly in a browser.
- `support.js` — the runtime the prototype loads; needed only to view the HTML, and not
  something to port.

## Notes for the implementer
- The prototype's tweak controls (players 1–10, teams 2–10, votes 1–5) exist to prove the
  layouts hold at the extremes. Check your implementation at 10 players / 10 teams /
  5 votes and at 1 player / 2 teams / 1 vote.
- Two things the prototype proves and the implementation must preserve: fixed-width team
  panels that wrap rather than rescale, and locked category tiles that measure identically
  to the voting tiles they replace.
