# Ok, Name One — MVP UI Design

**Date:** 2026-07-26
**Status:** Approved, in implementation
**Source:** `design_handoff_ok_name_one/` (Claude Design handoff)

## Overview

The MVP ships with plain-text styling — 177 lines of `src/style.css` that get
the game playable and look like nothing. This replaces the whole presentation
layer with the visual system from the design handoff: a flat-graphic,
hard-shadow, pink/cream/gold poster look, branded **Ok, Name One**.

Game rules, protocol, and the socket store are untouched apart from two small
server additions (below), both of which exist to keep the new UI honest rather
than to change how the game plays.

The handoff specifies four screens. The app has eleven. The other seven are
designed here from the same system — that is the explicit instruction in the
handoff README, and the alternative (unstyled fallbacks next to finished
screens) is worse than a considered extension.

## Source of truth

`Ok Name One MVP.dc.html` holds the exact values and wins any disagreement with
the PNGs. The PNGs are for orientation only; `03-host-scoring.png` in
particular shows overlapping text where long entries wrap, which is an artifact
of the mockup's fixed row heights and is **not** reproduced — rows wrap.

## Decisions taken before implementation

| Question | Decision | Rationale |
|---|---|---|
| Join URL on the host chip | Derive from `location.host`, uppercased | The mockup says `OKAYNAMEONE.APP`; production is `w104.leebo.io` and LAN testing is a bare IP. Deriving is correct in all three and never goes stale |
| Product name | Rename all user-facing copy to "Ok, Name One" | The two-plaque wordmark is the branding. Repo, package, Worker name and docs stay `w104` — infrastructure, and renaming churns deploy config for nothing |
| `ROUND 1` indicator | Add `round` to server state | The button now says NEW ROUND, so a hardcoded "1" starts lying on the second round |
| Fonts | Self-host via `@fontsource` | Bungee has no near system fallback; a phone on bad party wifi would render the whole design in Arial |
| Scoring columns past 5 | Wrap to a second row; cap the room at 10 players | Two rows of five is the most a TV reads at a glance |
| Kick and Back | Kept, styled into the system | Both exist and work; the design simply doesn't cover them |

## Design tokens

Taken verbatim from the handoff. Declared once in `:root`, referenced
everywhere — no loose hex values in rules.

| Token | Value | Use |
|---|---|---|
| `--pink` | `#E62E5C` | Every screen background |
| `--cream` | `#FFF7E8` | Cards, pills, timer bar, text on pink |
| `--ink` | `#1A0710` | All borders, offset shadows, text on cream |
| `--ink-gold` | `#2A1400` | Text on gold |
| `--gold` | `#FFD400` | Category banner, primary buttons |
| `--teal` | `#00A6A6` | Timer fill, activity dots, "OK," plaque |
| `--cream-dim` | `rgba(255,247,232,.8)` | Rules and de-emphasized text on pink |
| `--ink-dim` | `#7A6A5C` | Secondary text inside cream cards |
| `--struck` | `#9C8B79` | Duplicated words and their attribution emoji |
| `--card-rule` | `#E7D3BE` | Hairlines and the timer track |
| `--code-empty` | `#F6D9C6` | Unfilled room-code box |

Shape constants follow the same pattern: `--border: 3px solid var(--ink)`,
`--shadow-card: 6px 6px 0 var(--ink)`, `--shadow-btn: 5px 5px 0 var(--ink)`,
`--radius-card: 14px`.

**Contrast rule:** never cream on cream. Inside a cream card, body text is
`--ink` and secondary text is `--ink-dim`.

**No soft shadows anywhere.** Every shadow is a hard ink offset.

`color-scheme: light dark` is removed. This is one committed look; letting the
OS invert it destroys the contrast rule.

### Type

Display is **Bungee**, body is **Archivo** (400/600), both self-hosted.
Fallback stacks stay declared so a font failure degrades instead of breaking.

### Scaling

Mobile screens were drawn at 390×844 and use the literal pixel values. Host
screens were drawn at 1200×675 and get `clamp()` on the large display type —
the 132px category becomes `clamp(64px, 11vw, 160px)`, the 56px timer numerals
`clamp(34px, 4.7vw, 64px)` — so both a 1024px laptop and a 4K TV work. Borders,
radii and shadows stay fixed; scaling them softens the flat-graphic look.

Reduced motion is respected by freezing the activity pulse at full opacity.

## Server changes

Two, both small, both in service of the UI.

### Round counter

`round: number` on `Room`, initialized to 1 by `createRoom`, incremented by the
`newGame` case in `shared/reduce.ts`. It reaches clients automatically —
`RoomState` is an `Omit` of `Room`, not a pick.

`load()` in `party/server.ts` gains `round: stored.round ?? 1`, alongside the
existing `kicked` fallback, per the invariant that `storage.get<Room>` is an
unchecked cast over rooms persisted before the field existed.

### Ten-player cap

`MAX_PLAYERS = 10` in `shared/reduce.ts`, with a new `room-full` `ErrorCode`.

Enforced at the connect gate in `party/server.ts`, **after** the existing-player
lookup — a returning tenth player must reclaim their seat rather than be locked
out of the room they are already in. `reduce`'s `join` case repeats the check as
a second line of defence, matching how the phase gate is already doubled up.

Client-side, `App.tsx` treats `room-full` exactly as it treats `no-such-room`:
disconnect, back to Landing, message inline in the code card. It is a routine
failed join, not a terminal error.

## Components

Three new presentational components, each earned by repetition rather than by
principle:

- **`Wordmark`** — the two tilted plaques. Landing and host lobby.
- **`RoomChip`** — the cream `JOIN AT <HOST> · ROOM <CODE>` pill, on all four
  host screens so latecomers can join mid-round. Host from `location.host`.
- **`WordList`** — the scored-entry column. `HostScoring` and `PlayerScoring`
  render an identical structure at different type sizes, driven by one prop.
  Plain rows, never pills or chips. Scrolls in place; the surrounding layout
  never grows.

`Roster` is rewritten to emit the cream avatar+name pill with three variants: a
pulsing teal dot while `playing`, a ready mark in the lobby, and dimmed plus an
ink `×` on the host lobby. `AvatarPicker` keeps its `AVATARS` array and gains
the selected state (4px ink border, gold offset).

## Screens

**Landing** — wordmark, code card, `OR` divider, create card, version
bottom-left. Join errors render as ink text inside the code card, no new color.
The kicked notice becomes a cream-on-ink bar above the fold.

**Host lobby** — header with `RoomChip` and player count; the room code as the
hero; roster pills filling in as players arrive; gold `START ROUND`. During
countdown the button is replaced by a gold `GET READY… n` banner on the
category banner's −2.5° slant.

**Host playing** — matched to the mockup: header, `NAME A:` floating above the
gold banner that bleeds 40px past both edges at −2.5°, roster pills with
desynchronized teal pulses, 106px cream timer footer with the fill at
`remaining / durationSec`.

**Host scoring** — `Results · <category>` header, identity+list card pairs.
Column count is `n ≤ 5 ? n : ceil(n / 2)`, so six players give 3×2 and ten give
5×2 — balanced rows, never a stranded single card. Gold `NEW ROUND` footer.

**Player lobby** — room code, name field, avatar grid, roster, gold `READY UP`.

**Player playing** — category headline, timer, and the player's own words
bottom-anchored. No opponent counts, ever.

**Player scoring** — identity card with `ROOM <CODE> · ROUND n`, scrolling word
list, cream waiting line.

**Times up** — full-bleed gold banner on the −2.5° slant. Short and loud.

**Connecting / Error** — pink field, centered cream card, quiet copy; the error
adds a gold retry.

## Invariants this must not break

Restated because they are presentation-adjacent and easy to violate while
restyling:

- Word lists never enter `RoomState`; no per-player entry counts in broadcasts.
  The host activity dots are decorative CSS and must not encode counts.
- Timers broadcast an absolute `endsAt`; clients count down locally against
  `clockOffset`. No per-second broadcasts.
- The entry input in `PlayerView` stays mounted outside every phase screen and
  is moved with CSS, never unmounted, and never wrapped in a `<form>`. Its
  `visualViewport` height handling stays as-is. Restyled, not relocated.
- `HostView` and `PlayerView` keep their explicit `ReactElement` return type —
  that annotation is what makes tsc flag an unhandled phase.
- Anything added to persisted state needs a `load()` fallback.

## Verification

`npm test`, `npm run typecheck` across both tsc projects, `npm run build`.

Then the real app driven in a browser at 390×844 and 1200×675 through every
phase with multiple tabs, screenshotted against the handoff PNGs. Typecheck and
unit tests cannot see a layout, so the visual pass is not optional.

## Out of scope

Everything in `Project W-104.md`. This is a restyle of the existing eleven
screens plus the two server fields that keep them truthful — no new game
features, no category selection, no animation beyond the specified pulse.
