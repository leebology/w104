/**
 * "This one is ready", everywhere the room is told it.
 *
 * There is one of these in the app and there was never a reason for two. The
 * lobby drew a cream tag inside the player's pill; the standings drew an ink
 * chip with a mint dot in it; and the results screen drew nothing at all, so a
 * host reading the room off the TV had to look at three different things to ask
 * one question. This is the lobby's — the first one a room ever sees, and the
 * one every player has already learned by the time a round ends.
 *
 * It carries the outline the lobby's did not need. There the tag sits on a gold
 * pill and cream alone is enough; on the results card and the standings row it
 * sits on cream, where a fill with no edge is not a tag at all. The `.badge`
 * strip on the podium is built the same way and for the same reason.
 *
 * **The predicate is `isWaiting`, never `player.ready` on its own** — see
 * `shared/bots.ts`. A bot never readies up, and every readout on a screen has to
 * agree with the rules that ignore it, or the scenery reads as the holdout.
 */
export function ReadyMark({ className }: { className?: string }) {
  return (
    <span className={className ? `ready-mark ${className}` : "ready-mark"}>✓ READY</span>
  );
}
