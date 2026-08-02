import { useEffect, useRef, useState } from "react";
import { PlayerPill } from "../../components/Roster";
import { Wordmark } from "../../components/Wordmark";
import { roomStore } from "../../net/room";
import { joinHost } from "../../joinhost";
import { currentRound } from "../../../shared/state";
import type { RoomState } from "../../../shared/state";
import { AboutLink, AboutPanel } from "../../components/About";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { GetReady } from "../../components/GetReady";
import { HostExit, HostHeader, HostHeaderRight, PlayerCount } from "./HostHeader";
import { GameModesDrawer } from "./GameModesDrawer";
import { GameSettingsDrawer } from "./GameSettingsDrawer";

type Props = {
  room: RoomState;
  /** Present during the countdown phase; un-readying still cancels it. */
  countdown?: { endsAt: number; offset: number };
  onLeave: () => void;
};

type OpenDrawer = "modes" | "settings" | null;

export function HostLobby({ room, countdown, onLeave }: Props) {
  const host = joinHost().toUpperCase();
  const waiting = room.players.length === 0;
  // Almost every time this screen is up it is round one's own waiting room,
  // and a marker that only ever reads "ROUND 1 / 3" there counts nothing that
  // has happened yet. It earns its place only in the one case where the lobby
  // has rounds behind it: the host walked the room back here mid-match.
  const round = currentRound(room);
  const [drawer, setDrawer] = useState<OpenDrawer>(null);
  const [closing, setClosing] = useState(false);
  /**
   * The about panel, which is deliberately **not** a `Drawer`.
   *
   * A drawer is an overlay over a lobby that keeps its exact sizing, and that
   * is right for the settings — a host reading a stepper is not also reading
   * the room code. This is the opposite case: the room is still joining while
   * somebody skims this, so nothing here may be covered. The panel takes width
   * from the lobby instead and the lobby lays itself out narrower, which every
   * part of it can do — the roster is a flex column, the code banner is
   * negative-margined to whatever width it is given.
   *
   * It therefore sends no `setConfiguring`: reading the credits is not
   * configuring the match, and holding the countdown down for it would stop a
   * room that is ready to play.
   */
  const [about, setAbout] = useState(false);

  /**
   * Which ends of the roster have players past them.
   *
   * Each end fades only while there is something out there — a permanent fade
   * would say "there is more" to a room of four people, and no fade at all
   * leaves the pills that overflow looking cut off rather than scrolled past.
   *
   * Re-measured on every join as well as on scroll: a new pill changes
   * `scrollHeight` without the list moving, so no scroll event fires.
   */
  const roster = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ above: false, below: false });
  const players = room.players.length;
  useEffect(() => {
    const el = roster.current;
    if (!el) return;
    // A pixel of slack at each end: fractional scroll positions and device
    // pixel ratios mean an exact equality never quite lands on a real screen.
    const update = () =>
      setEdges({
        above: el.scrollTop > 1,
        below: el.scrollHeight - el.scrollTop - el.clientHeight > 1,
      });
    update();
    el.addEventListener("scroll", update, { passive: true });
    return () => el.removeEventListener("scroll", update);
  }, [players]);
  const rosterClass = [
    "roster-row",
    "roster-row--inline",
    edges.above ? "roster-row--above" : "",
    edges.below ? "roster-row--more" : "",
  ].filter(Boolean).join(" ");

  // Only the null <-> open transitions cross the wire: switching straight from
  // one drawer to the other must not flap the server flag, which would drop and
  // re-derive the countdown for no reason.
  const openDrawer = (next: Exclude<OpenDrawer, null>) => {
    if (drawer === null) roomStore.send({ type: "setConfiguring", open: true });
    setDrawer(next);
  };
  const closeDrawer = () => {
    if (drawer !== null) roomStore.send({ type: "setConfiguring", open: false });
    setDrawer(null);
  };

  // The server flag outlives this screen — the host leaving the lobby with a
  // drawer open would hold the next countdown down forever.
  useEffect(() => {
    return () => {
      roomStore.send({ type: "setConfiguring", open: false });
    };
  }, []);

  return (
    // A row rather than the bare screen: the about panel is a sibling of the
    // lobby, not a layer over it, so opening it narrows the lobby instead of
    // hiding any of it.
    <div className={about ? "host-shell host-shell--about" : "host-shell"}>
    <main className="screen screen--host host-lobby">
      {/* The room chip other host screens carry would only repeat the code
          that is already the hero here, so the lobby leads with the wordmark
          instead — the join instruction below is louder than any chip. */}
      <HostHeader
        left={
          /* The join URL rides under the wordmark on the same tilt as the
             NAME ONE! plaque, so the pair reads as one stamped block. It is
             the standing instruction for the room — it belongs with the
             branding, not in front of the room code, which is the one thing
             the stage is for. */
          <div className="host-lobby__brand">
            <Wordmark small />
            {host && <p className="host-lobby__url">JOIN AT {host}</p>}
          </div>
        }
        round={round > 1 ? round : undefined}
        of={room.settings.roundCount}
        right={
          <HostHeaderRight>
            <PlayerCount n={room.players.length} />
            {/* Closing kicks everyone in the room, so it asks first — this is
                the one host control whose damage cannot be undone by pressing
                it again. */}
            <HostExit
              label="Close room"
              pinned
              active={closing}
              onClick={() => setClosing(true)}
            />
          </HostHeaderRight>
        }
      />

      <div
        className={
          countdown ? "host-lobby__stage countdown-dim" : "host-lobby__stage"
        }
      >
        {/* The label the round screen gives NAME A: — cream Bungee above the
            gold, not a plaque on it. */}
        <p className="host-lobby__label">ROOM CODE:</p>
        <div className="banner host-lobby__code">
          <span className="banner__text">{room.code}</span>
        </div>
        {/* Newest first. The person who just typed the code is looking for
            their own name, and at the front of the list they find it without
            reading the nine above it. Reversed here rather than in `players`,
            which is join order and is what every other screen — team rosters,
            the reveal grid — derives a stable order from. */}
        <ul className={rosterClass} ref={roster}>
          {[...room.players].reverse().map((p) => (
            <PlayerPill
              key={p.id}
              player={p}
              variant="lobby"
              onKick={(id) => roomStore.send({ type: "kick", targetId: id })}
            />
          ))}
        </ul>
      </div>

      {/* Commented out, not deleted: there is one mode to choose between at the
          moment, so the tab is a drawer that opens onto a decision nobody has.
          The catalog, the drawer and the `setMode` event all still work — put
          this back when there is a second mode to switch to.
      <button
        type="button"
        className="drawer-tab drawer-tab--left"
        onClick={() => openDrawer("modes")}
      >
        Game modes
      </button>
      */}
      <button
        type="button"
        className="drawer-tab drawer-tab--right"
        onClick={() => openDrawer("settings")}
      >
        Game settings
      </button>
      {/* Under the settings tab, in the same corner. Text on the field rather
          than a second tab: two pills side by side in the lobby's corner would
          read as two halves of one decision, and this one leads nowhere near
          the match. */}
      <AboutLink
        className="about-link--host"
        onClick={() => setAbout(true)}
      />

      {/* The footer keeps its shape through the count rather than swapping its
          contents: it steps back with the rest of the screen and the countdown
          card carries the only live control, so nothing under the card moves
          when the count opens or is stopped. */}
      <div
        className={
          countdown ? "host-lobby__footer countdown-dim" : "host-lobby__footer"
        }
      >
        {waiting && <p className="host-lobby__hint">Waiting for players to join…</p>}
        <button
          type="button"
          className="btn host-lobby__start"
          disabled={waiting}
          onClick={() => roomStore.send({ type: "startGame" })}
        >
          Start game
        </button>
      </div>

      {/* The same card the standings screen poses between rounds. Labelled for
          where this one actually leads: with teams off the lobby counts into
          the category vote, never straight into a round. */}
      {countdown && (
        <div className="countdown-pose">
          <GetReady
            endsAt={countdown.endsAt}
            offset={countdown.offset}
            label="CATEGORY VOTE"
            onStop={() => roomStore.send({ type: "cancelStart" })}
          />
        </div>
      )}

      <GameModesDrawer room={room} open={drawer === "modes"} onClose={closeDrawer} />
      <GameSettingsDrawer
        room={room}
        open={drawer === "settings"}
        onClose={closeDrawer}
        disabled={Boolean(countdown)}
      />

      {closing && (
        <ConfirmDialog
          title="Close this room?"
          body="Are you sure you want to close this room? All players will be kicked."
          cancelLabel="No, keep playing"
          confirmLabel="Yes, close it"
          onCancel={() => setClosing(false)}
          onConfirm={onLeave}
        />
      )}
    </main>

      {/* Mounted only while open, the way `Drawer` is: it holds no state worth
          keeping across a close, and an unmounted panel cannot be a flex child
          taking width from the lobby. */}
      {about && <AboutPanel variant="host" onClose={() => setAbout(false)} />}
    </div>
  );
}
