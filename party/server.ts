import type * as Party from "partykit/server";

// One instance of this class exists per room. It is the authoritative
// owner of that room's state — the pattern every real game will build on.
export default class Server implements Party.Server {
  constructor(readonly room: Party.Room) {}

  onConnect(connection: Party.Connection) {
    // Tell the newcomer the current headcount, and update everyone else.
    connection.send(JSON.stringify({ type: "presence", count: this.count() }));
    this.broadcastPresence();
  }

  onClose() {
    this.broadcastPresence();
  }

  onMessage(message: string, sender: Party.Connection) {
    const data = JSON.parse(message) as { type: string };
    if (data.type === "wave") {
      this.room.broadcast(JSON.stringify({ type: "wave", from: sender.id }));
    }
  }

  private count(): number {
    return [...this.room.getConnections()].length;
  }

  private broadcastPresence(): void {
    this.room.broadcast(
      JSON.stringify({ type: "presence", count: this.count() }),
    );
  }
}
