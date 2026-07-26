# Handoff: Ok, Name One — MVP UI

## Overview
"Ok, Name One" is a Jackbox-style party game. Players join from their phones with a 4-letter
room code; one device creates the room and becomes a shared, non-playing TV/host screen that
the room looks at together. In a round, players race to type as many items as they can into a
category (v1: **woman**) before a 30-second timer expires. Scoring is Boggle-style: a word
only earns a point if **no other player wrote it**, so creativity beats obviousness.

This package specifies the visual system and four screens of the MVP.

## About the design files
The files in this bundle are **design references authored in HTML** — prototypes that show the
intended look, hierarchy, and behavior. They are **not production code to copy**. The task is
to **recreate these designs inside the existing w104 codebase** (React + TypeScript, Vite,
plain CSS in `src/style.css`) using its established patterns — not to ship this HTML.

Files:
- `Ok Name One MVP.dc.html` — source of the four screens (needs `support.js` alongside it).
- `Ok Name One MVP (standalone).html` — same thing, self-contained; open this one to look at it.
- `support.js` — runtime for the `.dc.html` file. Not part of the deliverable app.

`screens/` holds 2× PNG renders of each screen for quick visual reference:
`01-landing.png`, `02-host-playing.png`, `03-host-scoring.png`, `04-player-scoring.png`.
The HTML is the source of truth for exact values; the PNGs are for orientation.

Each screen in the HTML carries a `data-screen-label` attribute (`MVP Landing`,
`MVP Host Playing`, `MVP Host Scoring`, `MVP Player Scoring`) so you can find it quickly.

## ⚠️ This design does not cover every screen in the game
Only four screens were designed. The codebase contains several more, and they must be built by
**extending the design system below** — same palette, type, card treatment, spacing, and copy
voice. Do not invent a second visual language, and do not fall back to unstyled defaults.

Screens **specified** here:

| Screen | Source component |
| --- | --- |
| Landing | `src/screens/Landing.tsx` |
| Host — playing | `src/screens/host/HostPlaying.tsx` (via `HostView.tsx`) |
| Host — scoring | `src/screens/host/HostScoring.tsx` |
| Player — scoring | `src/screens/player/PlayerScoring.tsx` |

Screens **not specified — you design these** from the system:

| Screen | Source component | Notes for the gap-fill |
| --- | --- | --- |
| Host — lobby | `src/screens/host/HostLobby.tsx` | Big room code (the join affordance is the hero), avatar+name roster filling in as players arrive, gold "Start round" button. Reuse the landing plaque wordmark and the host header bar. |
| Player — lobby / join | `src/screens/player/PlayerLobby.tsx` | Name field + emoji avatar picker on cream cards; the avatar set is `AVATARS` in `src/components/AvatarPicker.tsx`. Selected avatar = 4px black border + gold offset shadow. |
| Player — playing | `src/screens/player/PlayerPlaying.tsx` | The typing screen: category headline, large text input, running list of your own submitted words, countdown. **Never show other players' counts or words.** Min 44px hit targets. |
| Times up | `src/screens/shared/TimesUp.tsx` | Full-bleed gold banner moment on the same −2.5° slant as the category banner. Short, loud, brief. |
| Connecting | `src/screens/Connecting.tsx` | Pink field, centered cream card, quiet copy. |
| Error | `src/screens/ErrorScreen.tsx` | Same shell as Connecting; message plus a gold retry button. |
| Roster | `src/components/Roster.tsx` | The avatar+name pill defined below; shared by lobby and host views. |

## Fidelity
**High-fidelity.** Colors, type sizes, borders, radii, and shadows below are final — match them.
Layout is expressed in flex with explicit gaps; keep the proportions. The one thing that is
deliberately *loose* is responsive behavior: the mobile screens were drawn at 390×844 and the
host screens at 1200×675 (16:9), so scale fluidly from there rather than pixel-pinning.

---

## Design tokens

### Color
| Token | Hex | Use |
| --- | --- | --- |
| Pink field | `#E62E5C` | Every screen background |
| Cream paper | `#FFF7E8` | Cards, pills, timer bar, text on pink |
| Ink | `#1A0710` | All borders, offset shadows, text on cream/gold |
| Ink (on gold) | `#2A1400` | Text sitting on gold |
| Gold | `#FFD400` | Category banner, primary buttons, accents |
| Teal | `#00A6A6` | Secondary accent: timer fill, live activity dots, "OK," plaque |
| Cream dim | `rgba(255,247,232,.8)` | Divider rules and de-emphasized text on pink |
| Ink dim | `#7A6A5C` | Secondary text **inside** cream cards |
| Struck | `#9C8B79` | Duplicated (non-scoring) words + their attribution emoji |
| Card rule | `#E7D3BE` | Hairline/track inside cream cards |
| Code-box empty | `#F6D9C6` | Unfilled room-code box fill |

Contrast rule that bit us in review: **never put cream text on cream**. Inside a cream card,
body text is `#1A0710`, secondary is `#7A6A5C`.

### Typography
- Display: **Bungee** (Google) — wordmark, numerals, player names, labels, buttons. All caps by nature.
- Body: **Archivo** (Google), weights 400/600 — sentences, list entries, small caps labels.
- Word list entries: Archivo **600** at 16–19px, ink.
- Struck entries: same size, `#9C8B79`, `line-through`; the emoji attribution trails 3px smaller.
- Letter-spacing: `.08em`–`.18em` on small all-caps labels; `.1em`–`.14em` on the room code.
- Line-height: `1.06` for display, `1.35`–`1.45` for body.

### Shape, border, shadow
- Card: cream fill, **3px solid ink** border, **14px** radius, **6px 6px 0 ink** hard shadow.
- Primary button: gold fill, **4px** ink border, **999px** radius, **5px 5px 0 ink** shadow, Bungee 16px, `#2A1400`.
- Room-code box: `aspect-ratio: 3/4`, 12px radius, 4px ink border; filled = cream + `4px 4px 0 gold`; empty = `#F6D9C6`.
- Player pill: cream, 3px ink border, 999px radius, 9px 16px padding.
- No soft/blurred shadows anywhere. Every shadow is a hard offset in ink.

### Spacing
Base rhythm 4px. Common values: gaps 8/10/12/14/16/22/26/34; card padding 14–20px;
mobile screen padding `0 26px` with 52px top inset on scoring; host screens `24px 26px 18px`
(scoring) and `22px 34px` for the header row.

---

## Screens

### 1. Landing (mobile, 390×844)
**Purpose:** join an existing room, or create one and become the shared screen.

Vertically centered column, `gap: 32px`, screen padding `0 26px`.

1. **Wordmark — two tilted plaques** (this is branding, not a heading):
   - "OK," — teal fill, cream text, Bungee **26px**, 4px ink border, 8px radius, padding 4px 14px,
     `rotate(-4deg)`, `4px 4px 0 ink`, left-aligned, sits above and overlapping.
   - "NAME ONE!" — gold fill, `#2A1400` text, Bungee **41px** (`white-space: nowrap`), 4px ink border,
     10px radius, padding 12px 18px, `rotate(2deg)`, `7px 7px 0 ink`, `margin-top: -6px`.
   - The pair is centered; the block is pulled 14px into the side margins.
2. **Card — "Enter room code"**: Bungee 22px label, 14px gap, then a 4-box row (`gap: 12px`),
   Bungee 30px characters. This is the CTA for joining; there is no separate join button.
   Behaves like a 2FA input: auto-advance, backspace steps back, paste fills all four, uppercase only.
3. **Divider**: 3px cream-dim rules either side of a 13px `OR`, `.16em` tracking.
4. **Card — create**: 14px Archivo copy in `#7A6A5C` — "No room yet? This device becomes the
   shared screen and doesn’t play." — then the gold **"Create a room"** button, full width.
5. **Version**: bottom-left, 11px, `.12em`, cream-dim. Currently `v0.4.1`.

**Terminology:** the product says **room**, never "lobby", in all user-facing copy.

### 2. Host — playing (TV, 1200×675)
**Purpose:** the shared screen during the live round.

**Hidden invariant — do not violate:** the host screen shows *that* people are writing, never
*how much*. No per-player word counts, no per-player progress bars, no leader hints until scoring.

- **Header** (`padding: 22px 34px`, `position: relative`):
  - Left: room-code chip — cream pill, 3px ink border, 999px radius, padding 7px 18px, containing
    `JOIN AT OKAYNAMEONE.APP · ROOM` (14px, `#7A6A5C`, `.16em`) then the code in Bungee 28px ink,
    `.1em`. **Present on every host screen** so latecomers can join mid-round.
  - Center: `ROUND 1` — Bungee 18px cream, `.14em`, absolutely positioned at `left:50%` with
    `translateX(-50%)` and `white-space: nowrap`.
  - Right: `5 PLAYERS` — 15px cream, `.16em`.
- **Category banner** — the centerpiece. Gold block bleeding 40px past both edges,
  `rotate(-2.5deg)`, padding `18px 0 22px`, `box-shadow: 0 12px 0 rgba(0,0,0,.25)`,
  with the category in Bungee **132px** `#2A1400`.
- **`NAME A:`** — Bungee **38px** cream, `.18em`, centered, `top: 26px`, `z-index: 3`, sitting
  **above/off** the banner (not on the gold).
- **Roster row** — 22px above the timer, `gap: 14px`, centered: player pills (cream, 3px ink,
  999px), each avatar emoji 22px + name in Bungee 15px + an 8px **teal** dot pulsing on a
  per-player interval (0.9s–1.6s) to signal "writing". The pulse is the only activity signal.
- **Timer bar** — a 106px full-width cream footer, 3px ink top border, padding `0 32px`, gap 24px:
  Bungee 56px `0:18`, then a 32px-tall pill track (`#E7D3BE`) with a **teal** fill at
  `remaining / 30`, then Bungee 20px `18 OF 30 SEC LEFT`.

### 3. Host — scoring (TV, 1200×675)
**Purpose:** the shared results reveal.

- **Header**: `Results · woman` in Bungee 32px cream on the left; room-code chip on the right.
  (No explanatory "struck = someone else wrote it" caption — the strikethrough is self-evident.)
- **Five equal columns**, `gap: 12px`, stretched to full height. Each column is **two stacked
  cards** with a 12px gap — deliberately the same pair as the player's own scoring view:
  1. **Identity card** (padding 14px): 30px avatar; then name in Bungee 17px with
     `RANK n` beneath it (11px, `#7A6A5C`, `.08em`); then two stat columns on the right —
     unique in Bungee 24px **pink** over a 9px `UNIQUE` label, total in Bungee 24px `#7A6A5C`
     over `TOTAL`.
  2. **List card** (`flex: 1`, padding 14px): a **single scrollable column** of that player's
     words — `overflow-y: auto`, `scrollbar-width: thin`,
     `scrollbar-color: #C9B8A2 transparent`, `padding-right: 8px`, `gap: 5px`, entries at 16px.
     Scoring words are ink/600. Duplicated words are struck in `#9C8B79` with the emoji of the
     other players who also wrote them, right-aligned on the row.
     Never render entries as pills or chips — plain rows only.
- **Footer**: centered gold **`NEW ROUND`** button.
- Players are sorted by unique count descending, then total descending.

### 4. Player — scoring (mobile, 390×844)
**Purpose:** your own results on your own phone.

Padding `52px 24px 30px`. Same two-card pattern as one host column, scaled up:
1. **Identity card**: 38px avatar; name Bungee 22px; `ROOM PLUM · ROUND 1` (12px, `#7A6A5C`,
   `.08em`); right-hand stat pair — unique Bungee 30px pink, total Bungee 30px `#7A6A5C`, each
   over a 10px `.1em` label.
2. **List card** (`flex: 1`): the same single scrollable column, entries at 19px.
3. **Footer line**: 14px cream, centered — "Waiting for the host to start a new round…".

---

## Interactions & behavior
- **Code entry**: 4 uppercase letters, auto-advance on input, backspace to the previous box,
  paste distributes across boxes, submit on the 4th character. Invalid/unknown code → inline
  error in the card (ink text, no new color).
- **Create a room** → this device becomes host and never plays; it goes straight to host lobby.
- **Round timing**: 30s, driven by the server clock (`src/net/clock.ts`, `useRemaining`), not a
  local `setInterval`. The timer fill is `remaining / duration`; the numerals are `mm:ss`.
- **Activity dots**: purely decorative CSS pulse
  (`@keyframes pulseDot { 0%,100%{opacity:.25;transform:scale(.8)} 50%{opacity:1;transform:scale(1.15)} }`),
   desynchronized per player. They must not encode word counts.
- **Scoring reveal**: struck-through duplicates are shown alongside the emoji of every other
  player who wrote the same word (normalization — case, accents, punctuation — is already handled
  in `shared/scoring.ts`; use it, don't reimplement).
- **Reduced motion**: respect `prefers-reduced-motion` by freezing the pulse.
- **Long lists**: 20+ entries per player is normal. Every list scrolls in place; the surrounding
  layout must never grow or push the footer button off-screen.

## State
No new state model is needed — the screens are views over the existing `ClientState` from
`src/net/room.ts` and the `Results` type from `shared/scoring.ts`. Local UI state is limited to
the four code characters, name/avatar draft on the player lobby, and the current text input on
the playing screen.

## Assets
No images. Avatars are the emoji array `AVATARS` in `src/components/AvatarPicker.tsx` — the
designs use 🦩 🦊 🐙 🍄 👾 as sample players; ship the real set. Fonts are Google Fonts:
`Bungee` and `Archivo` (400/500/600/700). Self-host them if the app should work offline.

## Copy voice
Short, plain, lowercase-friendly, no exclamation inflation outside the wordmark. Categories are
singular and lowercase ("woman"), per `shared/categories.ts`. Say **room**, not lobby.
