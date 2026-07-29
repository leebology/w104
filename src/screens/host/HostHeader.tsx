import type { ReactNode } from "react";

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
 * `.btn`, which is gold and means "go forward". `active` fills it in while
 * the confirmation it opened is on screen.
 */
export function HostExit({
  label, active, onClick,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={active ? "host-exit host-exit--active" : "host-exit"}
      onClick={onClick}
    >
      {label}
    </button>
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
