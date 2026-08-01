import { useState } from "react";
import type { ReactNode } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { roomStore } from "../../net/room";

type Props = {
  left: ReactNode;
  /**
   * Omitted entirely on the screens that only ever happen *before* round one
   * — team selection and category voting. A marker reading "ROUND 1 / 3"
   * there is not wrong so much as meaningless: there is no round to be in
   * yet, and the number cannot change while the screen is up. The lobby
   * omits it on the same grounds until a round has actually been played —
   * see `HostLobby`.
   */
  round?: number;
  /**
   * Total rounds in the match. A one-round match renders no marker at all:
   * "ROUND 1" with nothing to count against is a label, not a position. From
   * two rounds up the marker is always the pair — "ROUND 1 / 3" on the first
   * round as much as "ROUND 3 / 3" on the last.
   */
  of?: number;
  right: ReactNode;
};

/**
 * The bar every host screen wears. What sits at the ends differs by screen —
 * the results screen leads with its title and puts the room chip on the right
 * — so both ends are slots and only the centred round marker is fixed.
 */
export function HostHeader({ left, round, of, right }: Props) {
  return (
    <header className="host-header">
      {left}
      {round !== undefined && of !== 1 && (
        <span className="host-header__round">
          ROUND {round}
          {of !== undefined ? ` / ${of}` : ""}
        </span>
      )}
      {right}
    </header>
  );
}

/**
 * The right end of a host header: whatever the screen counts, then its way
 * out. Every host screen's back-out lives here rather than in the footer, so
 * the footer carries a single forward action and the destructive one is never
 * next to it.
 */
export function HostHeaderRight({ children }: { children: ReactNode }) {
  return <div className="host-header__right">{children}</div>;
}

/**
 * A back-out drawn as a cream outline on the pink field — deliberately not a
 * `.btn`, which is gold and means "go forward".
 *
 * **A closed ✕ that opens on hover into the words.** It sits in the corner of
 * every host screen and it is never the thing a room is looking at; at rest it
 * takes the room a circle costs and says what it does the moment a pointer
 * goes near it. The label is on the button as `aria-label` either way, so
 * nothing about what this is depends on the hover — which matters on a TV,
 * where there is no pointer to hover with and the ✕ is the whole of it.
 *
 * `active` holds it open and filled while the confirmation it opened is on
 * screen: the pointer has left the button by then, and a dialog whose opener
 * has silently collapsed behind it is a dialog with no subject.
 */
export function HostExit({
  label, active, pinned, onClick,
}: {
  label: string;
  active?: boolean;
  /**
   * Never collapses, and wears no ✕ at all. For the lobby's Close room, which
   * is not a back-out from a phase but the room's off switch — the one control
   * here that ends something nobody in the room can get back into, and the one
   * that has to be findable by someone who has never seen this screen before.
   */
  pinned?: boolean;
  onClick: () => void;
}) {
  const classes = ["host-exit"];
  if (pinned) classes.push("host-exit--pinned");
  if (active) classes.push("host-exit--active");

  return (
    <button
      type="button"
      className={classes.join(" ")}
      aria-label={label}
      onClick={onClick}
    >
      {/* Drawn rather than typed. `✕` is a glyph in a font with one weight, so
          it cannot be made heavier, and it carries its own side bearings — it
          sits high and left of the circle it is centred in by a pixel or two,
          which is exactly the kind of thing a round border makes obvious. Two
          strokes on a symmetric viewBox are centred by construction and as
          heavy as `stroke-width` says. */}
      {!pinned && (
        <svg
          className="host-exit__x"
          viewBox="0 0 24 24"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
        </svg>
      )}
      {/* `aria-hidden`, or a reader announces the label twice. */}
      <span className="host-exit__label" aria-hidden="true">{label}</span>
    </button>
  );
}

/**
 * The back-out that abandons a match, and the confirmation it owes the room.
 *
 * One component rather than the same `useState` in four screens, because the
 * question is the same on all of them: everything played so far goes. That is
 * the same reasoning behind the lobby's Close room dialog — the only other host
 * control whose damage cannot be undone by pressing it again — and it is the
 * same dialog, one field's difference apart.
 *
 * **Not on the final standings**, which is the one screen where this is not
 * destructive: the match is already over and its gold button says the same
 * thing. **Not on "Back to teams" either** — with teams on, backing out of the
 * category vote steps to team select rather than home (see `backToLobby` in
 * `shared/reduce.ts`), so nothing has ended and there is nothing to warn about.
 */
export function HostBackToRoom() {
  const [asking, setAsking] = useState(false);

  return (
    <>
      <HostExit label="Back to room" active={asking} onClick={() => setAsking(true)} />
      {asking && (
        <ConfirmDialog
          title="End this game?"
          body="Everyone goes back to the room and this game ends. The rounds played so far and their scores go with it."
          cancelLabel="No, keep playing"
          confirmLabel="Yes, end it"
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            roomStore.send({ type: "backToLobby" });
          }}
        />
      )}
    </>
  );
}

/**
 * Counts the room, and says nothing at all when there is nobody in it — an
 * empty lobby already says so in the footer, and "0 PLAYERS" is the room's
 * emptiest state announced twice.
 */
export function PlayerCount({ n }: { n: number }) {
  if (n === 0) return null;
  return (
    <span className="host-header__count">
      {n} {n === 1 ? "PLAYER" : "PLAYERS"}
    </span>
  );
}

export function VotingCount({ n, ready }: { n: number; ready: number }) {
  return (
    <span className="host-header__count">
      {n} {n === 1 ? "PLAYER" : "PLAYERS"} · {ready} READY
    </span>
  );
}
