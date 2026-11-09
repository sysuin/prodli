// UserStore: one Durable Object per ProdLi user, holding that user's synced
// data in its own SQLite database (logic in src/syncStore.ts).
//
// Isolation: the Worker picks the object with idFromName(<user id from the
// verified session>). Nothing the browser sends can choose another user's
// object.
//
// Live updates: each open device keeps a WebSocket to its user's object. When
// one device pushes changes, the others get a tiny "changed" message (never
// the data itself) and pull. Sockets use the hibernation API, so idle
// connections cost nothing; "ping" is answered without waking the object.

import { DurableObject } from "cloudflare:workers";
import type { Env } from "./app";
import { SyncError, SyncStore, type ChangeIn, type SyncResult } from "./syncStore";

const TICKET_TTL_MS = 60_000;

export type SyncOutcome = { ok: true; result: SyncResult } | { ok: false; error: SyncError["code"]; message: string };

export class UserStore extends DurableObject<Env> {
  private store: SyncStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = this.open();
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  private open(): SyncStore {
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS tickets (t TEXT PRIMARY KEY, device TEXT NOT NULL, exp INTEGER NOT NULL)`);
    return new SyncStore(this.ctx.storage.sql);
  }

  async sync(since: number, changes: ChangeIn[], quota: number, deviceId: string): Promise<SyncOutcome> {
    try {
      const result = this.store.sync(since, changes, quota);
      if (result.accepted) this.notify(deviceId, this.store.seq());
      return { ok: true, result };
    } catch (err) {
      if (err instanceof SyncError) return { ok: false, error: err.code, message: err.message };
      throw err;
    }
  }

  async usage(): Promise<{ bytes: number; counts: Record<string, number> }> {
    return { bytes: this.store.bytes(), counts: this.store.counts() };
  }

  async exportAll() {
    return this.store.exportAll();
  }

  /** Account deleted: remove every byte of this user's data and close their sockets. */
  async wipe(): Promise<void> {
    this.closeAll(4001, "account deleted");
    await this.ctx.storage.deleteAll();
    this.store = this.open();
  }

  /** Signed out everywhere: close live connections (they carry no data, but tidy up). */
  async disconnectAll(): Promise<void> {
    this.closeAll(4000, "signed out");
  }

  /** A one-time, one-minute ticket that lets a WebSocket connect (browsers can't send headers on WebSockets). */
  async issueTicket(deviceId: string): Promise<string> {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const ticket = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const now = Date.now();
    this.ctx.storage.sql.exec(`DELETE FROM tickets WHERE exp < ?`, now);
    this.ctx.storage.sql.exec(`INSERT INTO tickets (t, device, exp) VALUES (?, ?, ?)`, ticket, deviceId, now + TICKET_TTL_MS);
    return ticket;
  }

  /** WebSocket upgrade (the Worker has already checked the Origin). */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("expected websocket", { status: 426 });
    const ticket = new URL(request.url).searchParams.get("ticket") ?? "";
    const row = this.ctx.storage.sql.exec<{ device: string; exp: number }>(`SELECT device, exp FROM tickets WHERE t = ?`, ticket).toArray()[0];
    this.ctx.storage.sql.exec(`DELETE FROM tickets WHERE t = ?`, ticket);
    if (!row || row.exp < Date.now()) return new Response("bad ticket", { status: 401 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, [row.device.slice(0, 64)]);
    server.send(JSON.stringify({ type: "hello", seq: this.store.seq() }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(): Promise<void> {
    // Devices only listen; "ping" is answered automatically.
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, "bye");
    } catch {
      // already closed
    }
  }

  private notify(exceptDevice: string, seq: number): void {
    const msg = JSON.stringify({ type: "changed", seq });
    for (const ws of this.ctx.getWebSockets()) {
      if (this.ctx.getTags(ws).includes(exceptDevice)) continue;
      try {
        ws.send(msg);
      } catch {
        // closing; it will reconnect
      }
    }
  }

  private closeAll(code: number, reason: string): void {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(code, reason);
      } catch {
        // already closed
      }
    }
  }
}
