import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/app";
import { MAX_ITEM_BYTES, PAGE_ITEMS, SyncStore, parseChanges, type ChangeIn } from "../src/syncStore";
import { EXT_ORIGIN, json, makeApp, makeEnv } from "./helpers";
import { nodeSql } from "./userStoreFake";

const T = (n: number) => new Date(Date.UTC(2026, 10, 1, 0, 0, n)).toISOString();
const note = (id: string, u: string, content = id): ChangeIn => ({ c: "notes", id, u, v: { id, content, updatedAt: u } });
const BIG = 1e12;

describe("SyncStore", () => {
  it("stores changes and hands them to other devices after their last sequence number", () => {
    const s = new SyncStore(nodeSql());
    const a = s.sync(0, [note("n1", T(1)), note("n2", T(2))], BIG);
    expect(a).toMatchObject({ accepted: 2, rejected: 0, changes: [], seq: 2 });
    const b = s.sync(0, [], BIG);
    expect(b.changes.map((c) => c.id)).toEqual(["n1", "n2"]);
    expect(b.seq).toBe(2);
    expect(s.sync(2, [], BIG).changes).toEqual([]);
  });

  it("newest edit wins; an older push is rejected and the device gets the current version back", () => {
    const s = new SyncStore(nodeSql());
    s.sync(0, [note("n1", T(5), "new")], BIG);
    const r = s.sync(1, [note("n1", T(3), "old")], BIG);
    expect(r).toMatchObject({ accepted: 0, rejected: 1 });
    expect(r.changes).toEqual([{ c: "notes", id: "n1", u: T(5), d: false, v: { id: "n1", content: "new", updatedAt: T(5) }, s: 1 }]);
    const r2 = s.sync(1, [note("n1", T(9), "newer")], BIG);
    expect(r2.accepted).toBe(1);
    expect((s.sync(0, [], BIG).changes[0].v as { content: string }).content).toBe("newer");
  });

  it("breaks ties on equal stamps the same way everywhere", () => {
    const a = new SyncStore(nodeSql());
    const b = new SyncStore(nodeSql());
    a.sync(0, [note("n1", T(1), "aaa")], BIG);
    a.sync(1, [note("n1", T(1), "zzz")], BIG);
    b.sync(0, [note("n1", T(1), "zzz")], BIG);
    b.sync(1, [note("n1", T(1), "aaa")], BIG);
    expect(a.sync(0, [], BIG).changes[0].v).toEqual(b.sync(0, [], BIG).changes[0].v);
  });

  it("syncs deletions, and an edit made after a deletion brings the item back", () => {
    const s = new SyncStore(nodeSql());
    s.sync(0, [note("n1", T(1))], BIG);
    s.sync(1, [{ c: "notes", id: "n1", u: T(2), d: true }], BIG);
    expect(s.sync(1, [], BIG).changes).toMatchObject([{ id: "n1", d: true, v: null }]);
    expect(s.exportAll().notes).toEqual([]);
    expect(s.sync(2, [note("n1", T(1))], BIG).rejected).toBe(1); // older than the deletion
    expect(s.sync(2, [note("n1", T(3))], BIG).accepted).toBe(1);
    expect(s.exportAll().notes).toHaveLength(1);
  });

  it("merges Time Tracker days and counters (larger number per site) instead of replacing them", () => {
    const s = new SyncStore(nodeSql());
    s.sync(0, [{ c: "tracking", id: "2026-11-01", u: T(1), v: { a: 600 } }], BIG);
    // A later push from another device with smaller/other numbers is merged, and the result comes back.
    const r = s.sync(1, [{ c: "tracking", id: "2026-11-01", u: T(9), v: { a: 120, b: 300 } }], BIG);
    expect(r.changes).toMatchObject([{ id: "2026-11-01", v: { a: 600, b: 300 } }]);
    // A push that adds nothing new isn't stored, but the device gets the server's numbers.
    const r2 = s.sync(r.seq, [{ c: "tracking", id: "2026-11-01", u: T(10), v: { a: 1 } }], BIG);
    expect(r2).toMatchObject({ accepted: 0, changes: [{ v: { a: 600, b: 300 } }] });
    s.sync(r2.seq, [{ c: "stats", id: "completedPomodoros", u: T(1), v: 7 }], BIG);
    s.sync(r2.seq, [{ c: "stats", id: "completedPomodoros", u: T(2), v: 3 }], BIG);
    expect(s.exportAll().stats).toEqual([{ id: "completedPomodoros", value: 7 }]);
  });

  it("pages large pulls", () => {
    const s = new SyncStore(nodeSql());
    s.sync(0, Array.from({ length: PAGE_ITEMS + 5 }, (_, i) => note(`n${i}`, T(1))), BIG);
    const p1 = s.sync(0, [], BIG);
    expect(p1.changes).toHaveLength(PAGE_ITEMS);
    expect(p1.more).toBe(true);
    const p2 = s.sync(p1.seq, [], BIG);
    expect(p2.changes).toHaveLength(5);
    expect(p2.more).toBe(false);
    expect(p2.seq).toBe(PAGE_ITEMS + 5);
  });

  it("enforces the storage quota and the item size cap", () => {
    const s = new SyncStore(nodeSql());
    expect(() => s.sync(0, [note("n1", T(1), "x".repeat(2000))], 1000)).toThrow(/quota_exceeded/);
    expect(() => s.sync(0, [note("n1", T(1), "x".repeat(MAX_ITEM_BYTES + 1))], BIG)).toThrow(/larger than/);
    s.sync(0, [note("n1", T(1), "x".repeat(500))], 1000);
    // Shrinking or deleting is always allowed, even when full.
    expect(s.sync(1, [{ c: "notes", id: "n1", u: T(2), d: true }], 10).accepted).toBe(1);
    expect(s.bytes()).toBeLessThan(100);
  });

  it("rejects malformed changes", () => {
    expect(() => parseChanges([{ c: "passwords", id: "x", u: T(1), v: 1 }])).toThrow();
    expect(() => parseChanges([{ c: "notes", id: "", u: T(1), v: 1 }])).toThrow();
    expect(() => parseChanges([{ c: "notes", id: "x", u: "yesterday", v: 1 }])).toThrow();
    expect(() => parseChanges([{ c: "notes", id: "x", u: T(1) }])).toThrow();
    expect(() => parseChanges("nope")).toThrow();
    expect(parseChanges([{ c: "notes", id: "x", u: T(1), d: true, v: { secret: 1 } }])).toEqual([{ c: "notes", id: "x", u: T(1), d: true, v: null }]);
  });
});

describe("/api/sync", () => {
  let env: Env;
  let dispose: () => Promise<void>;
  beforeAll(async () => ({ env, dispose } = await makeEnv()));
  afterAll(async () => dispose());
  beforeEach(async () => {
    await env.DB.batch([env.DB.prepare("DELETE FROM ai_usage"), env.DB.prepare("DELETE FROM brief_usage"), env.DB.prepare("DELETE FROM sessions"), env.DB.prepare("DELETE FROM users")]);
  });

  async function signIn(app: ReturnType<typeof makeApp>["app"], who = "a") {
    const res = await app.request("/api/auth/google", json({ kind: "extension", accessToken: `good:sub-${who}:${who}@example.com:${who}` }, { Origin: EXT_ORIGIN }), env);
    const body = (await res.json()) as { token: string; user: { id: string } };
    return { ...body, auth: { Authorization: `Bearer ${body.token}`, Origin: EXT_ORIGIN } };
  }
  const sync = (app: ReturnType<typeof makeApp>["app"], auth: Record<string, string>, body: unknown) => app.request("/api/sync", json(body, auth), env);

  it("needs a session", async () => {
    const { app } = makeApp();
    expect((await sync(app, { Origin: EXT_ORIGIN }, { deviceId: "device-aaaa", since: 0 })).status).toBe(401);
  });

  it("two devices of the same user see each other's changes", async () => {
    const { app } = makeApp();
    const a = await signIn(app);
    const b = await signIn(app); // second device, same Google account
    const push = await sync(app, a.auth, { deviceId: "device-aaaa", since: 0, changes: [note("n1", T(1), "hello")] });
    expect(push.status).toBe(200);
    expect(await push.json()).toMatchObject({ accepted: 1, seq: 1, changes: [] });
    const pull = (await (await sync(app, b.auth, { deviceId: "device-bbbb", since: 0 })).json()) as { changes: { v: { content: string } }[]; usage: { bytes: number } };
    expect(pull.changes[0].v.content).toBe("hello");
    expect(pull.usage.bytes).toBeGreaterThan(0);
  });

  it("one user can never read another user's data", async () => {
    const { app } = makeApp();
    const alice = await signIn(app, "alice");
    const bob = await signIn(app, "bob");
    await sync(app, alice.auth, { deviceId: "device-aaaa", since: 0, changes: [note("secret", T(1), "alice's diary")] });
    const pull = (await (await sync(app, bob.auth, { deviceId: "device-bbbb", since: 0 })).json()) as { changes: unknown[] };
    expect(pull.changes).toEqual([]);
    const exp = await (await app.request("/api/account/export", { headers: bob.auth }, env)).text();
    expect(exp).not.toContain("diary");
  });

  it("accepts large sync bodies (meeting transcripts) but validates them", async () => {
    const { app } = makeApp();
    const a = await signIn(app);
    const big = await sync(app, a.auth, { deviceId: "device-aaaa", since: 0, changes: [note("n1", T(1), "x".repeat(200_000))] });
    expect(big.status).toBe(200);
    expect((await sync(app, a.auth, { deviceId: "bad id!", since: 0 })).status).toBe(400);
    expect((await sync(app, a.auth, { deviceId: "device-aaaa", since: -1 })).status).toBe(400);
    expect((await sync(app, a.auth, { deviceId: "device-aaaa", since: 0, changes: [{ c: "nope", id: "1", u: T(1), v: 1 }] })).status).toBe(400);
    // Other routes keep the small limit.
    const res = await app.request("/api/auth/google", json({ kind: "web", idToken: "x".repeat(70_000) }), env);
    expect(res.status).toBe(413);
  });

  it("reports usage and includes synced data in the account export", async () => {
    const { app } = makeApp();
    const a = await signIn(app);
    await sync(app, a.auth, {
      deviceId: "device-aaaa",
      since: 0,
      changes: [note("n1", T(1), "my note"), { c: "tracking", id: "2026-11-01", u: T(1), v: { "github.com": 60 } }],
    });
    const usage = (await (await app.request("/api/sync/usage", { headers: a.auth }, env)).json()) as { bytes: number; quota: number; counts: Record<string, number> };
    expect(usage).toMatchObject({ quota: 100 * 1024 * 1024, counts: { notes: 1, tracking: 1 } });
    const exp = (await (await app.request("/api/account/export", { headers: a.auth }, env)).json()) as { data: { notes: { content: string }[]; tracking: unknown[] } };
    expect(exp.data.notes[0].content).toBe("my note");
    expect(exp.data.tracking).toEqual([{ id: "2026-11-01", value: { "github.com": 60 } }]);
  });

  it("deleting the account wipes the synced data", async () => {
    const { app } = makeApp();
    const a = await signIn(app);
    await sync(app, a.auth, { deviceId: "device-aaaa", since: 0, changes: [note("n1", T(1))] });
    const del = await app.request("/api/account", { method: "DELETE", headers: { ...a.auth, "Content-Type": "application/json" }, body: JSON.stringify({ confirmEmail: "a@example.com" }) }, env);
    expect(del.status).toBe(200);
    const again = await signIn(app); // same Google account signs up again → a fresh, empty account
    const pull = (await (await sync(app, again.auth, { deviceId: "device-aaaa", since: 0 })).json()) as { changes: unknown[] };
    expect(pull.changes).toEqual([]);
    const old = (env.USER_STORE as unknown as { stores: Map<string, { usage(): Promise<{ bytes: number }> }> }).stores.get(a.user.id)!;
    expect((await old.usage()).bytes).toBe(0);
  });

  it("live updates: issues a one-time ticket; the socket route checks the origin", async () => {
    const { app } = makeApp();
    const a = await signIn(app);
    const t = await app.request("/api/sync/ticket", json({ deviceId: "device-aaaa" }, a.auth), env);
    const { path } = (await t.json()) as { path: string };
    expect(path).toMatch(new RegExp(`^/api/sync/live\\?u=${a.user.id}&ticket=[A-Za-z0-9_-]{32}$`));
    expect((await app.request(path, { headers: { Upgrade: "websocket", Origin: "https://evil.example" } }, env)).status).toBe(403);
    expect((await app.request(path, { headers: { Origin: EXT_ORIGIN } }, env)).status).toBe(426);
    const stores = (env.USER_STORE as unknown as { stores: Map<string, unknown> }).stores;
    const before = stores.size;
    const unknown = await app.request("/api/sync/live?u=00000000-0000-4000-8000-000000000000&ticket=x", { headers: { Upgrade: "websocket", Origin: EXT_ORIGIN } }, env);
    expect(unknown.status).toBe(401);
    expect(stores.size).toBe(before); // no Durable Object created for a made-up id
    expect((await app.request("/api/sync/ticket", json({ deviceId: "device-aaaa" }, { Origin: EXT_ORIGIN }), env)).status).toBe(401);
  });
});
