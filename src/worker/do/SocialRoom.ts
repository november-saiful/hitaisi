import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";

export class SocialRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS presence (conn_id TEXT PRIMARY KEY, name TEXT, joined_at INTEGER)"
      );
    });
  }

  async broadcastCount(): Promise<number> {
    const row = this.ctx.storage.sql
      .exec<{ n: number }>("SELECT COUNT(*) AS n FROM presence")
      .one();
    const msg = JSON.stringify({ type: "rsvp", present: row.n });
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(msg); } catch { /* drop dead socket */ }
    }
    return row.n;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/ws")) {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      const name = url.searchParams.get("name")?.slice(0, 60) ?? "guest";
      this.ctx.storage.sql.exec("INSERT OR REPLACE INTO presence VALUES (?, ?, ?)", crypto.randomUUID(), name, Date.now());
      server.send(JSON.stringify({ type: "hello", name }));
      return new Response(null, { status: 101, webSocket: client });
    }
    if (url.pathname.endsWith("/count")) {
      const n = this.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM presence").one().n;
      return Response.json({ present: n });
    }
    return new Response("Room ok. Use /ws for live presence.", { status: 200 });
  }

  async webSocketMessage(ws: WebSocket, message: string): Promise<void> {
    // Persist first, broadcast second. Echo to room only.
    try {
      const data = JSON.parse(message) as { text?: string; name?: string };
      const text = (data.text ?? "").slice(0, 500);
      if (!text) return;
      ws.send(JSON.stringify({ type: "echo", text }));
    } catch {
      // Ignore malformed frames; never crash the room.
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    try { ws.close(); } catch { /* already closed */ }
  }
}
