/**
 * Where to join, and the code to join with. Present on every host screen so
 * someone who walks in mid-round can still get on — which is exactly why the
 * address is read off `location.host` rather than hardcoded: in production
 * that is the real domain, and during LAN testing it is the machine's IP,
 * which is the address a phone actually needs.
 */
export function RoomChip({ code }: { code: string }) {
  const host = typeof location === "undefined" ? "" : location.host;
  return (
    <div className="pill room-chip">
      <span className="room-chip__label">
        {host ? `JOIN AT ${host.toUpperCase()} · ROOM` : "ROOM"}
      </span>
      <span className="room-chip__code">{code}</span>
    </div>
  );
}
