import { useEffect, useState } from "react";
import { useRemaining } from "../../net/clock";
import { PlayerPill } from "../../components/Roster";
import { Wordmark } from "../../components/Wordmark";
import { roomStore } from "../../net/room";
import { currentRound } from "../../../shared/state";
import type { RoomState } from "../../../shared/state";
import { ConfirmDialog } from "../../components/ConfirmDialog";
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
  const remaining = useRemaining(countdown?.endsAt ?? 0, countdown?.offset ?? 0);
  const host = typeof location === "undefined" ? "" : location.host.toUpperCase();
  const waiting = room.players.length === 0;
  // Almost every time this screen is up it is round one's own waiting room,
  // and a marker that only ever reads "ROUND 1 / 3" there counts nothing that
  // has happened yet. It earns its place only in the one case where the lobby
  // has rounds behind it: the host walked the room back here mid-match.
  const round = currentRound(room);
  const [drawer, setDrawer] = useState<OpenDrawer>(null);
  const [closing, setClosing] = useState(false);

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
    <main className="screen screen--host">
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
              active={closing}
              onClick={() => setClosing(true)}
            />
          </HostHeaderRight>
        }
      />

      <div className="host-lobby__stage">
        {/* The label the round screen gives NAME A: — cream Bungee above the
            gold, not a plaque on it. */}
        <p className="host-lobby__label">ROOM CODE</p>
        <div className="banner host-lobby__code">
          <span className="banner__text">{room.code}</span>
        </div>
        <ul className="roster-row roster-row--inline">
          {room.players.map((p) => (
            <PlayerPill
              key={p.id}
              player={p}
              variant="lobby"
              onKick={(id) => roomStore.send({ type: "kick", targetId: id })}
            />
          ))}
        </ul>
      </div>

      <button
        type="button"
        className="drawer-tab drawer-tab--left"
        onClick={() => openDrawer("modes")}
      >
        Game modes
      </button>
      <button
        type="button"
        className="drawer-tab drawer-tab--right"
        onClick={() => openDrawer("settings")}
      >
        Game settings
      </button>

      <div className="host-lobby__footer">
        {countdown ? (
          <>
            <p className="get-ready">Get ready… {remaining}</p>
            <button
              type="button"
              className="btn btn--secondary btn--small"
              onClick={() => roomStore.send({ type: "cancelStart" })}
            >
              Stop
            </button>
          </>
        ) : (
          <>
            {waiting && <p className="host-lobby__hint">Waiting for players to join…</p>}
            <button
              type="button"
              className="btn host-lobby__start"
              disabled={waiting}
              onClick={() => roomStore.send({ type: "startGame" })}
            >
              Start game
            </button>
          </>
        )}
      </div>

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
  );
}
