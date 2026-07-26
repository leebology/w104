import type { ReactNode } from "react";

type Props = {
  left: ReactNode;
  round: number;
  /** Total rounds in the match. Omitted or 1 renders a bare round number. */
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
      <span className="host-header__round">
        ROUND {round}
        {of !== undefined && of > 1 ? ` / ${of}` : ""}
      </span>
      {right}
    </header>
  );
}

export function PlayerCount({ n }: { n: number }) {
  return (
    <span className="host-header__count">
      {n} {n === 1 ? "PLAYER" : "PLAYERS"}
    </span>
  );
}
