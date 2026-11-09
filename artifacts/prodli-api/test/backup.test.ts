import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/app";
import { backupUser, listBackups, restoreUser, runBackups } from "../src/backup";
import { SyncStore } from "../src/syncStore";
import { fakeR2 } from "./fakeR2";
import { EXT_ORIGIN, json, makeApp, makeEnv } from "./helpers";
import { fakeUserStoreNamespace, nodeSql } from "./userStoreFake";

const T = (n: number) => new Date(Date.UTC(2026, 10, 1, 0, 0, n)).toISOString();
const DAY = 86_400_000;
const ADMIN = "a".repeat(40);

let base: Env;
let dispose: () => Promise<void>;
let env: Env & { BACKUPS: ReturnType<typeof fakeR2> };
beforeAll(async () => ({ env: base, dispose } = await makeEnv()));
afterAll(async () => dispose());
beforeEach(async () => {
  await base.DB.batch(["backups", "ai_usage", "sessions", "users"].map((t) => base.DB.prepare(`DELETE FROM ${t}`)));
  env = { ...base, BACKUPS: fakeR2(), USER_STORE: fakeUserStoreNamespace(), ADMIN_TOKEN: ADMIN } as typeof env;
});

async function user(app: ReturnType<typeof makeApp>["app"], who: string, notes: number) {
  const res = await app.request("/api/auth/google", json({ kind: "extension", accessToken: `good:sub-${who}:${who}@example.com:${who}` }, { Origin: EXT_ORIGIN }), env);
  const { token, user } = (await res.json()) as { token: string; user: { id: string } };
  const auth = { Authorization: `Bearer ${token}`, Origin: EXT_ORIGIN };
  if (notes) {
    const changes = Array.from({ length: notes }, (_, i) => ({ c: "notes", id: `${who}-${i}`, u: T(i + 1), v: { id: `${who}-${i}`, content: `${who} note ${i}` } }));
    expect((await app.request("/api/sync", json({ deviceId: "device-aaaa", since: 0, changes }, auth), env)).status).toBe(200);
  }
  return { id: user.id, auth };
}
const pull = async (app: ReturnType<typeof makeApp>["app"], auth: Record<string, string>) =>
  ((await (await app.request("/api/sync", json({ deviceId: "device-bbbb", since: 0 }, auth), env)).json()) as { changes: { id: string; v: { content: string } }[] }).changes;

describe("backups", () => {
  it("backs up each user's data, skips unchanged accounts, and refreshes weekly", async () => {
    const { app } = makeApp();
    const a = await user(app, "a", 3);
    const b = await user(app, "b", 0);
    const now = Date.UTC(2026, 10, 2);
    expect(await runBackups(env, now)).toMatchObject({ backedUp: 1, skipped: 1, failed: 0 });
    const keys = [...env.BACKUPS.objects.keys()];
    expect(keys).toEqual([`users/${a.id}/2026-11-02/part-0001.ndjson`]);
    expect(env.BACKUPS.objects.get(keys[0])!.body.split("\n")).toHaveLength(3);
    expect(keys.some((k) => k.includes(b.id))).toBe(false); // nothing to back up yet
    expect(await runBackups(env, now + DAY)).toMatchObject({ backedUp: 0 }); // unchanged
    expect(await runBackups(env, now + 8 * DAY)).toMatchObject({ backedUp: 1 }); // weekly refresh
    expect(await listBackups(env, a.id)).toEqual(["2026-11-10", "2026-11-02"]);
  });

  it("writes large accounts in parts", async () => {
    const store = new SyncStore(nodeSql());
    store.sync(0, Array.from({ length: 50 }, (_, i) => ({ c: "notes" as const, id: `n${i}`, u: T(1), v: { content: "x".repeat(100_000) } })), 1e12);
    const first = store.backupChunk(0, 1_000_000);
    expect(first.done).toBe(false);
    expect(first.rows.length).toBe(10);
    let rows = first.rows.length;
    let next = first;
    while (!next.done) {
      next = store.backupChunk(next.last, 1_000_000);
      rows += next.rows.length;
    }
    expect(rows).toBe(50);
  });

  it("restores lost data (merge keeps newer edits; overwrite makes the backup win)", async () => {
    const { app } = makeApp();
    const a = await user(app, "a", 3);
    await backupUser(env, a.id, Date.UTC(2026, 10, 2));
    // Disaster: the user's data is gone…
    await env.USER_STORE.get(env.USER_STORE.idFromName(a.id)).wipe();
    expect(await pull(app, a.auth)).toEqual([]);
    // …and one note was re-created with a newer edit meanwhile.
    await app.request("/api/sync", json({ deviceId: "device-aaaa", since: 0, changes: [{ c: "notes", id: "a-0", u: T(100), v: { id: "a-0", content: "newer" } }] }, a.auth), env);
    expect(await restoreUser(env, a.id, "2026-11-02", "merge", Date.UTC(2026, 10, 3))).toEqual({ items: 3, accepted: 2 });
    let notes = await pull(app, a.auth);
    expect(notes.map((n) => n.v.content).sort()).toEqual(["a note 1", "a note 2", "newer"]);
    await restoreUser(env, a.id, "2026-11-02", "overwrite", Date.UTC(2026, 10, 3));
    notes = await pull(app, a.auth);
    expect(notes.find((n) => n.id === "a-0")?.v.content).toBe("a note 0");
  });

  it("deleting the account deletes its backups too", async () => {
    const { app } = makeApp();
    const a = await user(app, "a", 2);
    const b = await user(app, "b", 1);
    for (const d of [2, 10, 18]) await backupUser(env, a.id, Date.UTC(2026, 10, d), true);
    await backupUser(env, b.id, Date.UTC(2026, 10, 2));
    const del = await app.request("/api/account", { method: "DELETE", headers: { ...a.auth, "Content-Type": "application/json" }, body: JSON.stringify({ confirmEmail: "a@example.com" }) }, env);
    expect(del.status).toBe(200);
    expect([...env.BACKUPS.objects.keys()].every((k) => !k.includes(a.id))).toBe(true);
    expect([...env.BACKUPS.objects.keys()].some((k) => k.includes(b.id))).toBe(true);
  });

  it("admin endpoints are hidden without the right token", async () => {
    const { app } = makeApp();
    const a = await user(app, "a", 1);
    const call = (token: string | null, e: Env = env) =>
      app.request("/api/admin/backup", json({ userId: a.id }, token ? { Authorization: `Bearer ${token}` } : {}), e);
    expect((await call(null)).status).toBe(404);
    expect((await call("wrong")).status).toBe(404);
    expect((await call(ADMIN, { ...env, ADMIN_TOKEN: "short" } as Env)).status).toBe(404); // weak token = disabled
    expect((await call(a.auth.Authorization.slice(7))).status).toBe(404); // a user session isn't an admin token
    const ok = await call(ADMIN);
    expect(await ok.json()).toEqual({ result: "done" });
    const list = await app.request(`/api/admin/backups?userId=${a.id}`, { headers: { Authorization: `Bearer ${ADMIN}` } }, env);
    expect(((await list.json()) as { dates: string[] }).dates).toHaveLength(1);
    const bad = await app.request("/api/admin/restore", json({ userId: a.id, date: "nope", mode: "merge" }, { Authorization: `Bearer ${ADMIN}` }), env);
    expect(bad.status).toBe(400);
  });
});
