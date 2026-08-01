import { WaitingStrip } from "./WaitingStrip";
import type { RoomState } from "../../shared/state";

/**
 * Where to join, and the code to join with. Present on every host screen so
 * someone who walks in mid-round can still get on — which is exactly why the
 * address is read off `location.host` rather than hardcoded: in production
 * that is the real domain, and during LAN testing it is the machine's IP,
 * which is the address a phone actually needs.
 *
 * It now carries the waiting room beside it, because that is where the people
 * who walked in mid-round actually end up. The strip lives *inside* this
 * component rather than beside it at six call sites, which is the arrangement
 * `TeamBadge` has and for the same reason: it is then correct wherever the chip
 * is dropped, and a new host screen gets it by using the chip rather than by
 * remembering a rule. It draws nothing when nobody is waiting.
 *
 * The chip is `flex: 0 0 auto` and the strip gives — the room code is the one
 * thing in this corner that must never move.
 */
export function RoomChip({ room }: { room: RoomState }) {
  const host = typeof location === "undefined" ? "" : location.host;
  return (
    <div className="room-chip-group">
      <div className="pill room-chip">
        <span className="room-chip__label">
          {host ? `JOIN AT ${host.toUpperCase()} · CODE:` : "CODE:"}
        </span>
        <span className="room-chip__code">{room.code}</span>
      </div>
      <WaitingStrip room={room} />
    </div>
  );
}
