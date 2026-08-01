/**
 * "Somebody is writing this team's name right now."
 *
 * Sits on its own line above the team's badge, on every surface that draws
 * one during team select — the panels on the TV and the tiles on the phones.
 * A rename is the one edit in this game that changes something *shared*: the
 * name arrives on every screen at once when it is committed, and without this
 * it arrives out of nowhere. It also explains the countdown that is not
 * starting, which is the other half of the same rule — see `Player.naming`.
 *
 * Absolutely positioned, so it costs the card no height and nothing moves when
 * it comes and goes. It is a component rather than a rule each screen
 * re-derives for the same reason `TeamBadge` is, and it takes the same size
 * modifier the badge beside it does so the two stay in step.
 */
export function TeamNaming({ size }: { size: "sm" | "lg" }) {
  return (
    <span className={`team-naming team-naming--${size}`}>
      <svg
        className="team-naming__pen"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4 20h4l11-11-4-4L4 16z" />
        <path d="M14 5l4 4" />
      </svg>
      WRITING
      {/* Three dots that come and go on their own timer, so the tag reads as
          something happening rather than as a label that has been left up. */}
      <span className="team-naming__dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    </span>
  );
}
