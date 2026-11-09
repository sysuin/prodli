// The real sync engine (src/lib/prodliSync.ts) on two simulated devices,
// talking to the real server-side store logic (prodli-api/src/syncStore.ts)
// on SQLite. Each "device" has its own localStorage contents.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SyncStore, type Sql } from "../../../prodli-api/src/syncStore";
import { getSyncStatus, syncOnce, SYNC_STATE_KEY } from "../../src/lib/prodliSync";
import { storageGet, storageSet } from "../../src/lib/storage";
import { recordDeletions } from "../../src/lib/tombstones";
import { listMeetings, putMeeting } from "../../src/recorder/db";
import type { Meeting } from "../../src/recorder/types";

// happy-dom runs this file as "browser" code, so load Node's SQLite at runtime.
const { DatabaseSync } = (process as unknown as { getBuiltinModule(id: string): typeof import("node:sqlite") }).getBuiltinModule("node:sqlite");

function sqlite(): Sql {
  const db = new DatabaseSync(":memory:");
  return {
    exec(query: string, ...bindings: unknown[]) {
      const rows = db.prepare(query).all(...(bindings as never[])) as never[];
      return { toArray: () => rows, one: () => rows[0] };
    },
  } as Sql;
}

let server: SyncStore;
let offline = false;
let requests = 0;
const devices: Record<string, Record<string, string>> = {};
let current: string | null = null;

function use(name: string) {
  if (current) {
    const dump: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) dump[localStorage.key(i)!] = localStorage.getItem(localStorage.key(i)!)!;
    devices[current] = dump;
  }
  localStorage.clear();
  for (const [k, v] of Object.entries(devices[name] ?? {})) localStorage.setItem(k, v);
  current = name;
}

async function device(name: string, fn: () => Promise<void>) {
  use(name);
  if (!(await storageGet("prodliAccount", null))) await storageSet("prodliAccount", { id: "user-1", email: "a@example.com", name: "A", picture: null, plan: "free", createdAt: 0 });
  await fn();
}

const T = (n: number) => new Date(Date.UTC(2026, 10, 1, 0, 0, n)).toISOString();
const note = (id: string, content: string, at: number) => ({ id, title: id, content, createdAt: T(0), updatedAt: T(at) });

beforeEach(() => {
  vi.stubEnv("VITE_PRODLI_API", "https://api.test");
  server = new SyncStore(sqlite());
  offline = false;
  requests = 0;
  current = null;
  for (const k of Object.keys(devices)) delete devices[k];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (offline) throw new TypeError("Failed to fetch");
    requests++;
    const url = String(input);
    if (url !== "https://api.test/api/sync") return new Response("{}", { status: 404 });
    const body = JSON.parse(String(init?.body));
    // Round-trip through JSON like the network does.
    return Response.json(JSON.parse(JSON.stringify(server.sync(body.since, body.changes, 100 * 1024 * 1024))));
  }) as typeof fetch;
});
afterEach(() => vi.unstubAllEnvs());

describe("ProdLi sync between two devices", () => {
  it("merges what both devices already had, then keeps them the same", async () => {
    await device("A", async () => {
      await storageSet("notes", [note("a1", "from A", 1)]);
      await storageSet("todos", [{ id: "t1", text: "A's todo", completed: false, createdAt: T(1) }]);
      await syncOnce();
    });
    await device("B", async () => {
      await storageSet("notes", [note("b1", "from B", 2)]);
      await syncOnce();
      expect((await storageGet<{ id: string }[]>("notes", [])).map((n) => n.id).sort()).toEqual(["a1", "b1"]);
      expect(await storageGet<{ text: string }[]>("todos", [])).toMatchObject([{ text: "A's todo" }]);
    });
    await device("A", async () => {
      await syncOnce();
      expect((await storageGet<{ id: string }[]>("notes", [])).map((n) => n.id).sort()).toEqual(["a1", "b1"]);
      expect((await getSyncStatus()).state).toBe("idle");
    });
  });

  it("syncs edits and deletions both ways", async () => {
    await device("A", async () => {
      await storageSet("notes", [note("n1", "v1", 1), note("n2", "keep", 1)]);
      await syncOnce();
    });
    await device("B", async () => {
      await syncOnce();
      await storageSet("notes", [note("n1", "edited on B", 5), note("n2", "keep", 1)]);
      await syncOnce();
    });
    await device("A", async () => {
      await syncOnce();
      expect((await storageGet<{ id: string; content: string }[]>("notes", [])).find((n) => n.id === "n1")?.content).toBe("edited on B");
      // Delete n2 on A (the editor records a tombstone when deleting).
      await storageSet("notes", (await storageGet<{ id: string }[]>("notes", [])).filter((n) => n.id !== "n2"));
      await recordDeletions("notes", ["n2"], T(6));
      await syncOnce();
    });
    await device("B", async () => {
      await syncOnce();
      expect((await storageGet<{ id: string }[]>("notes", [])).map((n) => n.id)).toEqual(["n1"]);
    });
  });

  it("the newest edit wins when both devices edited the same note offline", async () => {
    await device("A", async () => {
      await storageSet("notes", [note("n1", "original", 1)]);
      await syncOnce();
    });
    await device("B", async () => syncOnce());
    await device("A", async () => storageSet("notes", [note("n1", "A at 10s", 10)]));
    await device("B", async () => storageSet("notes", [note("n1", "B at 20s", 20)]));
    await device("A", async () => syncOnce()); // A pushes first…
    await device("B", async () => syncOnce()); // …B's later edit still wins
    await device("A", async () => {
      await syncOnce();
      expect((await storageGet<{ content: string }[]>("notes", []))[0].content).toBe("B at 20s");
    });
    await device("B", async () => expect((await storageGet<{ content: string }[]>("notes", []))[0].content).toBe("B at 20s"));
  });

  it("an older edit pushed later doesn't overwrite a newer one", async () => {
    await device("A", async () => {
      await storageSet("notes", [note("n1", "new", 50)]);
      await syncOnce();
    });
    await device("B", async () => {
      await storageSet("notes", [note("n1", "stale", 5)]);
      await syncOnce();
      expect((await storageGet<{ content: string }[]>("notes", []))[0].content).toBe("new");
    });
  });

  it("Time Tracker: each device's browsing is combined (larger number per site), never double-counted", async () => {
    await device("A", async () => {
      await storageSet("tt_2026-11-01", { "github.com": 600 });
      await syncOnce();
    });
    await device("B", async () => {
      await storageSet("tt_2026-11-01", { "github.com": 120, "news.com": 300 });
      await syncOnce();
      expect(await storageGet("tt_2026-11-01", {})).toEqual({ "github.com": 600, "news.com": 300 });
    });
    await device("A", async () => {
      await syncOnce();
      expect(await storageGet("tt_2026-11-01", {})).toEqual({ "github.com": 600, "news.com": 300 });
    });
  });

  it("Pomodoro: the completed count and history merge", async () => {
    await device("A", async () => {
      await storageSet("completedPomodoros", 7);
      await storageSet("pomodoroSessions", [{ id: "s1", label: "A", completedAt: T(1), duration: 25 }]);
      await syncOnce();
    });
    await device("B", async () => {
      await storageSet("completedPomodoros", 3);
      await storageSet("pomodoroSessions", [{ id: "s2", label: "B", completedAt: T(2), duration: 25 }]);
      await syncOnce();
      expect(await storageGet("completedPomodoros", 0)).toBe(7);
      expect((await storageGet<{ id: string }[]>("pomodoroSessions", [])).map((s) => s.id)).toEqual(["s2", "s1"]);
    });
  });

  it("doesn't contact the server after local edits when nothing changed", async () => {
    await device("A", async () => {
      await storageSet("notes", [note("n1", "x", 1)]);
      await syncOnce();
      const before = requests;
      await syncOnce({ onlyIfLocalChanges: true });
      expect(requests).toBe(before);
      await storageSet("notes", [note("n1", "y", 2)]);
      await syncOnce({ onlyIfLocalChanges: true });
      expect(requests).toBe(before + 1);
    });
  });

  it("offline: keeps changes here and sends them when back online", async () => {
    await device("A", async () => {
      offline = true;
      await storageSet("notes", [note("n1", "written offline", 1)]);
      await syncOnce();
      expect((await getSyncStatus()).state).toBe("offline");
      offline = false;
      await syncOnce();
      expect((await getSyncStatus()).state).toBe("idle");
    });
    await device("B", async () => {
      await syncOnce();
      expect((await storageGet<{ content: string }[]>("notes", []))[0].content).toBe("written offline");
    });
  });

  it("meetings: uploads text only, never audio flags, and keeps local audio when updating", async () => {
    const meeting: Meeting = {
      id: "m1", platform: "google-meet", title: "Standup", meetingCode: null, url: "https://meet.google.com/x", startedAt: T(1), endedAt: T(2),
      durationSec: 60, status: "ready", transcript: [{ id: "e1", speaker: "Ann", text: "hi", startMs: 0, endMs: 1 }], summary: null,
      error: null, notice: null, hasAudio: true, micIncluded: false, audioMimeType: "audio/webm", updatedAt: T(2),
    };
    await device("A", async () => {
      await putMeeting(meeting);
      await syncOnce();
    });
    const exported = server.exportAll().meetings as Meeting[];
    expect(exported).toHaveLength(1);
    expect(exported[0]).toMatchObject({ title: "Standup", hasAudio: false, audioMimeType: null });
    // Another device renames it; this device keeps its audio.
    server.sync(server.seq(), [{ c: "meetings", id: "m1", u: T(9), v: { ...exported[0], title: "Daily standup", updatedAt: T(9) } }], 1e12);
    await device("A", async () => {
      await syncOnce();
      const [m] = await listMeetings();
      expect(m).toMatchObject({ title: "Daily standup", hasAudio: true, audioMimeType: "audio/webm" });
    });
  });

  it("remembers its position, and starts fresh for a different account", async () => {
    await device("A", async () => {
      await storageSet("notes", [note("n1", "x", 1)]);
      await syncOnce();
      const seq = (await storageGet<{ seq: number }>(SYNC_STATE_KEY, { seq: 0 })).seq;
      expect(seq).toBe(server.seq());
      expect(seq).toBeGreaterThan(0);
      await storageSet("prodliAccount", { id: "user-2", email: "b@example.com", name: "B", picture: null, plan: "free", createdAt: 0 });
      await syncOnce();
      expect((await storageGet<{ userId: string }>(SYNC_STATE_KEY, { userId: "" })).userId).toBe("user-2");
    });
  });
});
