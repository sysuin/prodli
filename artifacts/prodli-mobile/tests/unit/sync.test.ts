/// <reference types="node" />
// The phone's sync engine against the real server storage logic
// (prodli-api/src/syncStore.ts on Node's built-in SQLite): what the phone
// pushes, pulls, deletes and refuses to delete.
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { parseChanges, SyncStore, type Sql } from "../../../prodli-api/src/syncStore";
import { kv } from "../../src/lib/kv";
import { read, resetCache, write } from "../../src/lib/store";
import { getSyncStatus, syncOnce, type Transport } from "../../src/lib/sync";
import { recordDeletions } from "../../src/lib/tombstones";

function nodeSql(): Sql {
  const db = new DatabaseSync(":memory:");
  return {
    exec(query: string, ...bindings: unknown[]) {
      const rows = db.prepare(query).all(...(bindings as never[])) as Record<string, never>[];
      return { toArray: () => rows, one: () => rows[0] };
    },
  } as Sql;
}

let server: SyncStore;
let offline = false;
const transport: Transport = {
  async post<T>(_path: string, body: unknown): Promise<T> {
    if (offline) throw Object.assign(new Error("Can't reach ProdLi."), { status: 0 });
    const b = body as { since: number; changes: unknown };
    // Round-trip through JSON like the network would.
    return JSON.parse(JSON.stringify(server.sync(b.since, parseChanges(JSON.parse(JSON.stringify(b.changes))), 100 * 1024 * 1024))) as T;
  },
  isOffline: (err) => (err as { status?: number }).status === 0,
  isSignedOut: (err) => (err as { status?: number }).status === 401,
};

/** Another device writing straight to the server. */
const otherDevice = (changes: unknown[]) => server.sync(Number.MAX_SAFE_INTEGER, parseChanges(changes), 100 * 1024 * 1024);
const serverItem = (c: string, id: string) => server.sync(0, [], 1e9).changes.find((x) => x.c === c && x.id === id);

beforeEach(() => {
  server = new SyncStore(nodeSql());
  for (const k of kv.keys()) kv.remove(k);
  resetCache();
  offline = false;
});

describe("phone sync", () => {
  it("uploads what's on the phone and downloads what's on the server", async () => {
    write("todos", [{ id: "t1", title: "Buy milk", completed: false, createdAt: "2026-11-20T08:00:00.000Z", updatedAt: "2026-11-20T08:00:00.000Z" }]);
    otherDevice([{ c: "notes", id: "n1", u: "2026-11-19T10:00:00.000Z", v: { id: "n1", title: "From the laptop", content: "<p>Hi</p>", createdAt: "2026-11-19T10:00:00.000Z", updatedAt: "2026-11-19T10:00:00.000Z" } }]);

    await syncOnce("user-1", transport);

    expect(serverItem("todos", "t1")?.v).toMatchObject({ title: "Buy milk" });
    expect(read<{ id: string; title: string }[]>("notes", [])).toEqual([expect.objectContaining({ id: "n1", title: "From the laptop" })]);
    expect(getSyncStatus()).toMatchObject({ state: "idle", error: null });
  });

  it("newest edit wins in both directions", async () => {
    write("todos", [{ id: "t1", title: "Old", completed: false, createdAt: "2026-11-20T08:00:00.000Z", updatedAt: "2026-11-20T08:00:00.000Z" }]);
    await syncOnce("user-1", transport);
    otherDevice([{ c: "todos", id: "t1", u: "2026-11-20T09:00:00.000Z", v: { id: "t1", title: "Newer on laptop", completed: false, createdAt: "2026-11-20T08:00:00.000Z", updatedAt: "2026-11-20T09:00:00.000Z" } }]);
    await syncOnce("user-1", transport);
    expect(read<{ title: string }[]>("todos", [])[0].title).toBe("Newer on laptop");

    write("todos", [{ id: "t1", title: "Newest on phone", completed: true, createdAt: "2026-11-20T08:00:00.000Z", updatedAt: "2026-11-20T10:00:00.000Z" }]);
    await syncOnce("user-1", transport);
    expect(serverItem("todos", "t1")?.v).toMatchObject({ title: "Newest on phone", completed: true });
  });

  it("a deletion on the phone deletes everywhere, with the time it happened", async () => {
    write("notes", [{ id: "n1", title: "Bye", content: "", createdAt: "2026-11-20T08:00:00.000Z", updatedAt: "2026-11-20T08:00:00.000Z" }]);
    await syncOnce("user-1", transport);
    write("notes", []);
    recordDeletions("notes", ["n1"], "2026-11-20T11:00:00.000Z");
    await syncOnce("user-1", transport);
    expect(serverItem("notes", "n1")).toMatchObject({ d: true, u: "2026-11-20T11:00:00.000Z" });
  });

  it("a meeting missing on the phone without a recorded deletion is fetched again, never deleted", async () => {
    otherDevice([{ c: "meetings", id: "m1", u: "2026-11-18T10:00:00.000Z", v: { id: "m1", title: "Stand-up", startedAt: "2026-11-18T09:30:00.000Z", updatedAt: "2026-11-18T10:00:00.000Z", status: "ready", hasAudio: true, audioMimeType: "audio/webm", transcript: [] } }]);
    let pushes = 0;
    const counting: Transport = { ...transport, post: (p, b) => ((pushes += (b as { changes: unknown[] }).changes.length), transport.post(p, b)) };
    await syncOnce("user-1", counting);
    await syncOnce("user-1", counting);
    expect(pushes).toBe(0); // stored exactly as received: never echoed back

    write("meetings", []); // e.g. storage cleared
    await syncOnce("user-1", transport);
    expect(serverItem("meetings", "m1")?.d).toBe(false);
    await syncOnce("user-1", transport);
    expect(read<{ id: string }[]>("meetings", []).map((m) => m.id)).toEqual(["m1"]);
  });

  it("Time Tracker days and the Pomodoro counter merge by the larger number", async () => {
    write("completedPomodoros", 3);
    otherDevice([{ c: "stats", id: "completedPomodoros", u: "2026-11-20T08:00:00.000Z", v: 7 }]);
    otherDevice([{ c: "tracking", id: "2026-11-19", u: "2026-11-20T08:00:00.000Z", v: { "github.com": 600 } }]);
    await syncOnce("user-1", transport);
    expect(read("completedPomodoros", 0)).toBe(7);
    expect(read("tracking", {})).toEqual({ "2026-11-19": { "github.com": 600 } });
  });

  it("offline: keeps everything and says so", async () => {
    write("todos", [{ id: "t1", title: "Later", completed: false, createdAt: "2026-11-20T08:00:00.000Z" }]);
    offline = true;
    await syncOnce("user-1", transport);
    expect(getSyncStatus().state).toBe("offline");
    offline = false;
    await syncOnce("user-1", transport, { onlyIfLocalChanges: true });
    expect(serverItem("todos", "t1")).toBeDefined();
    expect(getSyncStatus().state).toBe("idle");
  });

  it("only-if-local-changes does nothing when nothing changed", async () => {
    let calls = 0;
    const counting: Transport = { ...transport, post: (p, b) => (calls++, transport.post(p, b)) };
    await syncOnce("user-1", counting);
    const before = calls;
    await syncOnce("user-1", counting, { onlyIfLocalChanges: true });
    expect(calls).toBe(before);
  });

  it("a different account starts fresh and adds the phone's data to it", async () => {
    write("habits", [{ id: "h1", name: "Read", emoji: "📚", color: "#FFD700", completedDays: [], createdAt: "2026-11-01T08:00:00.000Z", archived: false }]);
    await syncOnce("user-1", transport);
    const first = server;
    server = new SyncStore(nodeSql());
    await syncOnce("user-2", transport);
    expect(serverItem("habits", "h1")).toBeDefined();
    expect(first).not.toBe(server);
  });
});
