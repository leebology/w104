import { Server, routePartykitRequest } from "partyserver";
import type { Connection } from "partyserver";

// Durable Object binding declared in wrangler.jsonc.
export interface Env {
  W104: DurableObjectNamespace;
}

type ClientMessage = { type: "wave" };

// One instance of this class exists per room. It is the authoritative owner of
// that room's state — the pattern every real game will build on. PartyServer's
// Server base class IS a Cloudflare Durable Object; wrangler.jsonc pins it to
// the SQLite storage backend, which is what the free plan requires.
export class W104 extends Server {
  onConnect(connection: Connection) {
    // Tell the newcomer the current headcount, and update everyone else.
    connection.send(JSON.stringify({ type: "presence", count: this.count() }));
    this.broadcastPresence();
  }

  onClose() {
    this.broadcastPresence();
  }

  onMessage(connection: Connection, message: string | ArrayBuffer) {
    if (typeof message !== "string") return;
    const data = JSON.parse(message) as ClientMessage;
    if (data.type === "wave") {
      this.broadcast(JSON.stringify({ type: "wave", from: connection.id }));
    }
  }

  private count(): number {
    return [...this.getConnections()].length;
  }

  private broadcastPresence(): void {
    this.broadcast(JSON.stringify({ type: "presence", count: this.count() }));
  }
}

// Worker entrypoint: route /parties/:party/:room to the right room instance.
export default {
  async fetch(request, env) {
    return (
      (await routePartykitRequest(request, env)) ??
      new Response("Not Found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
