import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/app";
import { parseUninstallFeedback, pruneUninstallFeedback, saveUninstallFeedback, type FunnelReport } from "../src/insights";
import { EXT_ORIGIN, json, makeApp, makeEnv } from "./helpers";
import { fakeUserStoreNamespace } from "./userStoreFake";

const ADMIN = "b".repeat(40);
const SITE = "https://prodli.com";

let base: Env;
let dispose: () => Promise<void>;
let env: Env;
beforeAll(async () => ({ env: base, dispose } = await makeEnv()));
afterAll(async () => dispose());
beforeEach(async () => {
  await base.DB.batch(["uninstall_feedback", "shares", "subscriptions", "billing_customers", "ai_usage", "sessions", "users"].map((t) => base.DB.prepare(`DELETE FROM ${t}`)));
  env = { ...base, USER_STORE: fakeUserStoreNamespace(), ADMIN_TOKEN: ADMIN } as Env;
});

describe("uninstall survey", () => {
  it("keeps only a known reason, trimmed words and a version", () => {
    expect(parseUninstallFeedback({ reason: "nope" })).toBeNull();
    expect(parseUninstallFeedback(null)).toBeNull();
    expect(parseUninstallFeedback({ reason: "bugs", details: "  too   slow \n", version: "1.4.0", email: "x@y.z" })).toEqual({ reason: "bugs", details: "too slow", version: "1.4.0" });
    expect(parseUninstallFeedback({ reason: "other", details: "x".repeat(900), version: "<script>" })).toEqual({ reason: "other", details: "x".repeat(500), version: "" });
  });

  it("accepts answers from prodli.com only", async () => {
    const { app } = makeApp();
    const ok = await app.request("/api/feedback/uninstall", json({ reason: "not_using", details: "forgot about it", version: "1.4.0" }, { Origin: SITE }), env);
    expect(ok.status).toBe(200);
    expect((await app.request("/api/feedback/uninstall", json({ reason: "not_using" }, { Origin: "https://evil.example" }), env)).status).toBe(403);
    expect((await app.request("/api/feedback/uninstall", json({ reason: "not_using" }), env)).status).toBe(403);
    expect((await app.request("/api/feedback/uninstall", json({ reason: "made_up" }, { Origin: SITE }), env)).status).toBe(400);
    const rows = await env.DB.prepare("SELECT * FROM uninstall_feedback").all();
    expect(rows.results).toHaveLength(1);
    expect(Object.keys(rows.results[0]).sort()).toEqual(["created_at", "details", "id", "reason", "version"]);
  });

  it("removes answers older than two years", async () => {
    const DAY = 86_400_000;
    const now = Date.UTC(2028, 0, 1);
    await saveUninstallFeedback(env.DB, { reason: "bugs", details: "", version: "" }, now - 731 * DAY);
    await saveUninstallFeedback(env.DB, { reason: "other", details: "", version: "" }, now - 10 * DAY);
    await pruneUninstallFeedback(env.DB, now);
    const rows = await env.DB.prepare("SELECT reason FROM uninstall_feedback").all<{ reason: string }>();
    expect(rows.results.map((r) => r.reason)).toEqual(["other"]);
  });
});

describe("funnel report", () => {
  const signIn = async (app: ReturnType<typeof makeApp>["app"], who: string) => {
    const res = await app.request("/api/auth/google", json({ kind: "extension", accessToken: `good:sub-${who}:${who}@example.com:${who}` }, { Origin: EXT_ORIGIN }), env);
    return ((await res.json()) as { user: { id: string } }).user.id;
  };

  it("is hidden without the admin token", async () => {
    const { app } = makeApp();
    expect((await app.request("/api/admin/funnel", {}, env)).status).toBe(404);
    expect((await app.request("/api/admin/funnel", { headers: { Authorization: "Bearer wrong" } }, env)).status).toBe(404);
  });

  it("counts accounts, meeting users, shares, Pro and uninstall reasons, with no personal data", async () => {
    const { app, clock } = makeApp();
    const now = clock.now;
    const month = new Date(now).toISOString().slice(0, 7);
    const a = await signIn(app, "a");
    const b = await signIn(app, "b");
    await signIn(app, "c");
    await env.DB.batch([
      env.DB.prepare("INSERT INTO ai_usage (user_id, month, count) VALUES (?, ?, 20), (?, ?, 3)").bind(a, month, b, month),
      env.DB.prepare("INSERT INTO shares (id, user_id, meeting_id, title, payload, created_at, updated_at, views) VALUES ('s1', ?, 'm1', 'Kickoff', '{}', ?, ?, 4)").bind(a, now, now),
      env.DB.prepare("INSERT INTO billing_customers (user_id, customer_id, created_at) VALUES (?, 'cus_1', ?)").bind(b, now),
      env.DB.prepare("INSERT INTO subscriptions (user_id, provider, subscription_id, customer_id, status, billing_interval, event_at, updated_at) VALUES (?, 'dodo', 'sub_1', 'cus_1', 'active', 'year', ?, ?)").bind(b, now, now),
    ]);
    await env.DB.prepare("UPDATE users SET plan = 'pro' WHERE id = ?").bind(b).run();
    for (const reason of ["not_using", "not_using", "bugs"]) await app.request("/api/feedback/uninstall", json({ reason, details: reason === "bugs" ? "crashed" : "" }, { Origin: SITE }), env);

    const res = await app.request("/api/admin/funnel", { headers: { Authorization: `Bearer ${ADMIN}` } }, env);
    expect(res.status).toBe(200);
    const r = (await res.json()) as FunnelReport;
    expect(r.accounts).toMatchObject({ total: 3, last7Days: 3, activeLast7Days: 3 });
    expect(r.signupsByWeek).toHaveLength(12);
    expect(r.signupsByWeek.at(-1)!.accounts).toBe(3);
    expect(r.surfaces.extension).toBe(3);
    expect(r.meetings.everSummarized).toBe(2);
    expect(r.meetings.thisMonth).toEqual({ month, accountsWithSummary: 2, summaries: 23, freeAccountsAtLimit: 1 });
    expect(r.shares).toEqual({ links: 1, createdLast30Days: 1, views: 4 });
    expect(r.pro).toEqual({ active: 1, monthly: 0, yearly: 1, cancelling: 0, checkoutsStarted: 1 });
    expect(r.uninstalls.last90Days).toBe(3);
    expect(r.uninstalls.byReason).toEqual({ not_using: 2, bugs: 1 });
    expect(r.uninstalls.recentDetails).toEqual([{ at: expect.any(String), reason: "bugs", details: "crashed", version: "" }]);
    const text = JSON.stringify(r);
    for (const secret of ["example.com", a, b, "Kickoff"]) expect(text).not.toContain(secret);
  });
});
