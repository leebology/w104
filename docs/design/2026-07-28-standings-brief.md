# Match standings screen — design brief for Claude Design

**Date:** 2026-07-28
**For:** Claude Design
**From:** w104 / "Ok, Name One" — `staging` branch, v0.4.2
**Scope:** the **match standings screen** — host TV and player phone. This is
the screen *after* the round results; it shows places and points, never words.

---

## 1. The ask

Redesign the layout of the match standings screen — the table the room lands on
between rounds, and again at the end of the match when it becomes the final
result.

The logic behind it is finished, tested and not moving. What exists visually is
a first pass written to be *correct* rather than to be looked at: a stack of
identical cream rows, each `place · avatar · name · badges · points`. It reads
as a spreadsheet, and it gives the same weight to "we're at half time" as it
does to "you won the match".

Everything in §3–§6 is the contract the design has to sit inside. §7 is what
I'd like your opinion on, and §8 lists two known defects in the current
implementation that the redesign should resolve rather than inherit.

---

## 2. The game, in five lines

Jackbox-style party game. One device creates the room and becomes the shared TV
screen; everyone else joins from their phone. Each round the room gets a
category ("name a **woman**") and races to type as many as they can before the
timer ends. Scoring is Boggle rules — a word only scores if nobody else wrote
it. A match runs 1–10 rounds, and a round's finishing place is what feeds this
screen.

Optionally the match is played in **teams** (2–10). A team shares one word list
and the team — not the player — is the thing that places and scores.

---

## 3. Where this screen sits, and its four states

```
playing → timesup → scoring (round results, the words) 
                        ↓ host taps "Standings"
                    standings          ← THIS SCREEN
                        ↓ everyone readies, or host taps "Next round"
                    countdown (5s)     ← STILL THIS SCREEN, with a countdown on it
                        ↓
                    playing (next round)

…and on the last round, `standings` becomes the final screen and the match ends.
```

The same component serves **four states**, and today they differ only by title
and footer:

| State | Host TV | Player phone |
|---|---|---|
| **Between rounds** | Title "Standings". Hint *"Starting early readies everyone up."* + gold **Next round**. | Gold block **Ready up** / secondary **Not ready** (a toggle). |
| **Counting down** | *"Get ready… 5"* + small secondary **Stop**. | *"Get ready… 5"* above the same ready toggle. |
| **Final** | Title "Final standings". Gold **Back to lobby**. | *"That's the match. Waiting for the host…"* — no button. |
| Never | — | A player who joined mid-match and has no standing row: their "me" card is simply absent. |

Two things follow:

- **The screen is untimed except in the countdown state.** Between rounds it
  sits there indefinitely while people argue. The countdown is 5 seconds and is
  **cancellable** — anyone un-readying tears it down and returns to this screen.
- **"Between rounds" and "final" are the same screen doing very different
  jobs.** One is a pause; the other is the end of the match and the only moment
  anybody wins anything. The current design does almost nothing to separate
  them. That is the single biggest opportunity here.

---

## 4. The exact payload

The screen renders off one array, computed client-side by a pure shared
function — `computeStandings(rosterOf(room), room.history)`. Verbatim from
`shared/standings.ts`:

```ts
type Standing = {
  id: string;              // player id, or team id in team play
  name: string;            // player's display name, or the team's name
  emoji: string;           // player's avatar emoji; "" for a team
  colorIndex: number|null; // team's accent slot (0–9); null for a solo player
  members: PlayerId[];     // [self] for a player; the roster for a team

  points: number;          // sum of finishing places across the match
  badges: number[];        // place per round, in play order — [1, 3, 2]
  place: number;           // 1-based standing; ties SHARE a place (1,2,2,4)
};
```

The array arrives **already sorted by `place` ascending**.

### Golf scoring — the thing the current design fails to communicate

**`points` is a sum of finishing places, and the lowest total wins.** Come 1st
in a round and you get 1 point. Come 4th and you get 4. Across a 3-round match,
1st/1st/2nd = **4 points** and beats 2nd/3rd/3rd = 8.

Ties share a place and the places after a tie are skipped (1, 2, 2, 4), because
under golf points a shared place has to cost what it costs — dense ranking would
make tying *cheaper* than losing outright.

This is inverted from what anyone expects of a party-game scoreboard, and right
now the screen shows a bare number with no cue at all about which direction is
good. **Fixing that is part of the ask.**

### Also available on this screen, currently unused

```ts
room.history[]   // every round played, oldest first:
                 //   { category: "woman",
                 //     places: { [scorerId]: { unique, total, place } } }
room.settings    // { mode, roundCount, durationSec, teamCount }
room.players[]   // live roster — includes `connected`, `ready`, `teamId`
room.code        // "JADE" — the join code
currentRound(room)   // 1-based; matchComplete(room) → boolean
```

So the screen already knows, for free and with no backend work:

- **Which category each past round was** — the badge strip renders `[1, 3, 2]`
  with no hint that those were *woman*, *sport*, *movie*.
- **How many unique and total words each scorer had in each round**, not just
  their place.
- **How many rounds remain** (`roundCount − history.length`).
- **Who has dropped off** (`connected: false`) and **who has readied up** for
  the next round — the phone shows a ready toggle but neither screen shows
  *who else* is ready, which is the thing everyone in the room is asking.

### What is genuinely not available

- **No words, ever.** `Room.history` holds aggregates only — never entries —
  because it rides in the broadcast state that reaches every phone, and word
  lists are a privacy boundary everywhere except the results screen. The raw
  word store is also wiped the moment this screen opens. A standings design
  cannot show a single word.
- **No per-round timings, no speed data, no streak flags.** Streaks and
  "biggest climb" would have to be derived from `badges`/`history` in the
  client — cheap to do, but nothing hands them to you.
- **No historical matches.** The room forgets everything on "Back to lobby".

---

## 5. Ranges the layout must survive

| Dimension | Range | Notes |
|---|---|---|
| Rows | **1–10** | 10 is the hard player cap. Solo (host force-start) is legal and looks very empty today. |
| Teams | 0 (off), or **2–10** | Empty teams never appear. Team sizes are wildly uneven — 6 against 1 is legal. |
| Badges per row | **1–10** | One chip per round played. Grows as the match runs; at round 1 there is exactly one. |
| `points` | 1 upward | Realistically 1–30. Theoretical worst case 100. |
| Ties | **Common** | Two or more rows sharing a place is normal, not an edge case. Especially at round 1. |
| Name | 1–20 chars | Player names and team names both. |
| Team roster trail | 1–9 emoji | Rendered after the team name today. |
| Round marker | "ROUND 3 / 5" | Hidden when the match is a single round. On the final screen it pins to the last round played, not one past it. |
| Disconnected | possible | They keep their seat, points and badges. A **kicked** player vanishes entirely. |

---

## 6. The surfaces, and the rules the code enforces

### Design system — fixed, do not move

Flat-graphic poster look. `src/style.css` holds the tokens; there is no loose
hex anywhere outside `:root`.

```
--pink   #E62E5C   every screen background
--cream  #FFF7E8   cards, pills, text on pink
--ink    #1A0710   all borders, all offset shadows, text on cream
--gold   #FFD400   primary buttons, and the 1st-place badge — gold means "won" / "go forward"
--teal   #00A6A6   timer fill, activity dots, the "OK," plaque
--ink-dim #7A6A5C  secondary text inside cream cards
--cream-dim        quiet text on the pink field
+ 10 team accents, --team-red … --team-brown

--border 3px solid --ink      --radius 14px
--shadow-card 6px 6px 0 --ink --shadow-btn 5px 5px 0 --ink
Display: Bungee.  Body: Archivo.
```

Rules the code enforces, each for a reason:

- **Neither screen may scroll.** The TV owns the viewport exactly
  (`height: 100dvh; overflow: hidden`); the phone is pinned to the *visual*
  viewport the same way. The standings list is the one thing allowed to scroll,
  **inside its own box** — the footer button must stay on screen at ten rows.
- **One forward action per screen, in gold, in the footer.** A host back-out
  lives top-right as a cream outline (`HostExit`), never beside the gold button.
  This screen currently has no back-out at all — see §7.
- **A team is named by `TeamBadge`** — a tilted name tab in the team's accent,
  overhanging the card's top-left corner. It is the one way a team identifies
  itself on every other screen: team select, the round, the results.
- **A team accent is never a border.** It rides the badge; the card's ink
  outline stays continuous and one weight on all four sides. **This screen is
  the last place still violating that** — see §8.
- **The 1st-place badge is gold, every other place cream.** A run of wins
  should read across a room at a glance.
- **The pulse on the lobby dots is the only motion in the app.** There is a
  `prefers-reduced-motion` block. If the final screen wants a celebration
  moment, that is a deliberate new exception and needs to say so.

### Host TV

16:9, read from a sofa — assume 1280×720 up to 1920×1080. Nothing on it is
interactive except the single footer button. Currently: header (join code left,
round marker centre, "Standings" right), a vertical list of full-width cream
cards, then a centred footer button.

### Player phone

Drawn at 390×844, capped at 480px. Currently: a room/round line, your own "me"
card (54px place number, name, badges, points), a plain list of everyone below
it, and the ready button pinned to the bottom.

**One hard constraint on the phone:** the **Ready up** tap here is load-bearing
beyond its label. It is the last real user gesture before a round that starts
off a server timer, and iOS only opens the keyboard from a real gesture — so
that tap is the only chance the app gets to have a keyboard up when the next
round begins. **The phone must keep a real, tappable primary button in this
state.** It cannot become an auto-advance, a swipe, or a delayed control.

---

## 7. What I'd like from you

1. **Separate the two jobs.** "Standings, round 3 of 5" and "Final standings"
   are currently one layout with a different word in the title. The final one is
   the only moment anyone wins anything — give it a result, not a table row.
2. **Make golf scoring legible.** Somebody looking at this for the first time
   should understand within a second that low is good. Copy, a "pts" unit, an
   arrow, an ordering cue, a different treatment for the leader — your call.
3. **Give 1st place somewhere to stand.** Today the leader is the top row of an
   otherwise uniform stack, distinguished only by a smaller number.
4. **A view on the badge strip.** One chip per round, gold for a win. It is the
   most information-dense thing on the screen and the least explained — nothing
   says those chips are rounds, or in what order, or what category each was
   (which the screen *does* know, per §4).
5. **Teams vs solo.** Same layout serves both today, with a colour swatch
   standing in for the avatar and the roster's emoji trailing the team name.
   Say if they should diverge — and note the `TeamBadge` rule in §6.
6. **Whether the room's state belongs here.** Between rounds every phone shows
   a ready toggle and neither screen shows who has actually readied. The data is
   there; the lobby already has a vocabulary for it (ready pills, activity dots).
7. **The empty-ish cases.** One or two rows on a 1920×1080 TV, and round 1 of 5
   where every badge strip is a single chip and half the room is tied.

If any of it wants data the payload doesn't carry, say so explicitly rather than
designing around it — most additions are cheap, but they go through shared game
logic and its tests, so I need to know up front.

---

## 8. Two known defects to resolve, not inherit

Both are in the current implementation and both are documented in the repo as
things this screen is on the wrong side of:

1. **The team accent is rendered as a 10px `border-left`** on the standings
   card. Two problems live in that: a 10px edge against 3px sides on a 14px
   radius flares the corners, and `--accent` is only ever set for a *team*, so
   on a solo player's card the whole declaration resolves invalid and that edge
   loses its stroke entirely. Every other screen solved this by moving the
   accent onto the `TeamBadge` tab. This is the last card still on a border,
   and it has no badge yet.

2. **There is no way for the host to leave a match from here.** `backToLobby`
   is already legal from this phase server-side, but between rounds the host
   gets no control for it — the only exit is finishing every remaining round.
   Adding a top-right `HostExit` needs zero backend work. Worth designing in.

---

## 9. Out of scope

- The round results screen before this one — separate screen, separate pass.
- The scoring *rules*: Boggle uniqueness, fuzzy matching, golf placement points,
  shared places on ties. All settled and tested.
- The design system itself. Tokens, shapes and fonts are fixed.
- Cross-match history, profiles, or persistence — the room forgets everything
  on "Back to lobby". (A D1 score archive is specced but deliberately never
  read back into the game.)
