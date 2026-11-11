import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AI_MONTHLY_LIMIT } from "../src/ai";
import { signPaddle, verifyPaddleSignature } from "../src/billing";
import type { Env } from "../src/app";
import { EXT_ORIGIN, json, makeApp, makeEnv } from "./helpers";

let base: Env;
let dispose: () => Promise<void>;
beforeAll(async () => ({ env: base, dispose } = await makeEnv()));
afterAll(async () => dispose());
beforeEach(async () => {
  await base.DB.batch(["subscriptions", "ai_usage", "brief_usage", "ask_usage", "sessions", "users"].map((t) => base.DB.prepare(`DELETE FROM ${t}`)));
});

const SECRET = "pdl_ntfset_test_secret";
const selling = () => ({ ...base, PADDLE_ENV: "sandbox", PADDLE_CLIENT_TOKEN: "test_abc", PADDLE_PRICE_MONTHLY: "pri_month", PADDLE_PRICE_YEARLY: "pri_year", PADDLE_WEBHOOK_SECRET: SECRET, PADDLE_API_KEY: "pdl_sdbx_apikey", ANTHROPIC_API_KEY: "sk-test" }) as Env;

async function signIn(app: ReturnType<typeof makeApp>["app"], env: Env, who = "a") {
  const res = await app.request("/api/auth/google", json({ kind: "extension", accessToken: `good:sub-${who}:${who}@example.com:${who}` }, { Origin: EXT_ORIGIN }), env);
  const body = (await res.json()) as { token: string; user: { id: string } };
  return { headers: { Authorization: `Bearer ${body.token}`, Origin: EXT_ORIGIN }, userId: body.user.id };
}

const subEvent = (type: string, userId: string | null, extra: Record<string, unknown> = {}, at = "2027-01-15T10:00:00.000Z") => ({
  event_id: `evt_${Math.random().toString(36).slice(2)}`,
  event_type: type,
  occurred_at: at,
  data: {
    id: "sub_01",
    status: "active",
    customer_id: "ctm_01",
    custom_data: userId ? { userId } : null,
    items: [{ price: { id: "pri_month" } }],
    billing_cycle: { interval: "month", frequency: 1 },
    current_billing_period: { starts_at: "2027-01-15T10:00:00.000Z", ends_at: "2027-02-15T10:00:00.000Z" },
    scheduled_change: null,
    ...extra,
  },
});

async function deliver(app: ReturnType<typeof makeApp>["app"], env: Env, event: unknown, nowMs: number, secret = SECRET) {
  const raw = JSON.stringify(event);
  const ts = Math.floor(nowMs / 1000);
  return app.request("/api/billing/webhook", { method: "POST", headers: { "Content-Type": "application/json", "Paddle-Signature": `ts=${ts};h1=${await signPaddle(raw, secret, ts)}` }, body: raw }, env);
}

describe("Paddle webhook signatures", () => {
  it("accepts only an exact, recent signature", async () => {
    const now = 1_800_000_000_000;
    const ts = now / 1000;
    const sig = await signPaddle('{"a":1}', SECRET, ts);
    expect(await verifyPaddleSignature('{"a":1}', `ts=${ts};h1=${sig}`, SECRET, now)).toBe(true);
    expect(await verifyPaddleSignature('{"a":1}', `ts=${ts};h1=old;h1=${sig}`, SECRET, now)).toBe(true); // secret rotation
    expect(await verifyPaddleSignature('{"a": 1}', `ts=${ts};h1=${sig}`, SECRET, now)).toBe(false); // body changed
    expect(await verifyPaddleSignature('{"a":1}', `ts=${ts};h1=${sig}`, "other", now)).toBe(false);
    expect(await verifyPaddleSignature('{"a":1}', `ts=${ts};h1=${sig}`, SECRET, now + 10 * 60_000)).toBe(false); // replayed later
    expect(await verifyPaddleSignature('{"a":1}', undefined, SECRET, now)).toBe(false);
  });
});

describe("ProdLi Pro", () => {
  it("isn't for sale until Paddle is configured", async () => {
    const { app } = makeApp();
    const { headers } = await signIn(app, base);
    const body = await (await app.request("/api/billing", { headers }, base)).json();
    expect(body).toMatchObject({ plan: "free", checkout: null, subscription: null, limits: { free: { summaries: AI_MONTHLY_LIMIT.free }, pro: { summaries: AI_MONTHLY_LIMIT.pro } } });
    expect((await deliver(app, base, subEvent("subscription.created", "x"), Date.now())).status).toBe(404);
  });

  it("a paid subscription turns Pro on (and raises the limits); cancelling turns it off", async () => {
    const clock = { now: Date.parse("2027-01-15T10:00:05Z") };
    const { app } = makeApp(clock);
    const env = selling();
    const { headers, userId } = await signIn(app, env);
    expect(await (await app.request("/api/billing", { headers }, env)).json()).toMatchObject({ plan: "free", checkout: { environment: "sandbox", clientToken: "test_abc", prices: { monthly: "pri_month", yearly: "pri_year" } } });

    const res = await deliver(app, env, subEvent("subscription.created", userId), clock.now);
    expect(await res.json()).toEqual({ ok: true, applied: true });
    expect(await (await app.request("/api/billing", { headers }, env)).json()).toMatchObject({ plan: "pro", canManage: true, subscription: { status: "active", interval: "month", renewsAt: Date.parse("2027-02-15T10:00:00Z"), endsAt: null } });
    expect(await (await app.request("/api/ai/usage", { headers }, env)).json()).toMatchObject({ limit: AI_MONTHLY_LIMIT.pro });

    // Scheduled cancellation: still Pro until the end of the period.
    clock.now += 60_000;
    await deliver(app, env, subEvent("subscription.updated", null, { scheduled_change: { action: "cancel", effective_at: "2027-02-15T10:00:00.000Z" } }, "2027-01-15T10:01:00.000Z"), clock.now);
    expect(await (await app.request("/api/billing", { headers }, env)).json()).toMatchObject({ plan: "pro", subscription: { renewsAt: null, endsAt: Date.parse("2027-02-15T10:00:00Z") } });

    clock.now += 60_000;
    await deliver(app, env, subEvent("subscription.canceled", null, { status: "canceled" }, "2027-01-15T10:02:00.000Z"), clock.now);
    expect(await (await app.request("/api/billing", { headers }, env)).json()).toMatchObject({ plan: "free", subscription: { status: "canceled" } });
    expect(await (await app.request("/api/ai/usage", { headers }, env)).json()).toMatchObject({ limit: AI_MONTHLY_LIMIT.free });
  });

  it("ignores stale, unsigned and unknown-user events", async () => {
    const clock = { now: Date.parse("2027-01-15T10:05:00Z") };
    const { app } = makeApp(clock);
    const env = selling();
    const { headers, userId } = await signIn(app, env);
    await deliver(app, env, subEvent("subscription.updated", userId, {}, "2027-01-15T10:04:00.000Z"), clock.now);
    // An older "past_due → canceled" arriving late doesn't undo the newer state.
    const late = await deliver(app, env, subEvent("subscription.canceled", userId, { status: "canceled" }, "2027-01-15T09:00:00.000Z"), clock.now);
    expect(await late.json()).toEqual({ ok: true, applied: false });
    expect(await (await app.request("/api/billing", { headers }, env)).json()).toMatchObject({ plan: "pro" });

    expect((await deliver(app, env, subEvent("subscription.canceled", userId, { status: "canceled" }), clock.now, "wrong-secret")).status).toBe(401);
    const raw = JSON.stringify(subEvent("subscription.canceled", userId, { status: "canceled" }));
    expect((await app.request("/api/billing/webhook", { method: "POST", body: raw }, env)).status).toBe(401);
    expect(await (await deliver(app, env, { ...subEvent("subscription.created", "someone-else"), data: { ...subEvent("subscription.created", "someone-else").data, id: "sub_02" } }, clock.now)).json()).toEqual({ ok: true, applied: false });
    expect(await (await deliver(app, env, { event_type: "transaction.completed", data: {} }, clock.now)).json()).toEqual({ ok: true, applied: false });
    expect(await (await app.request("/api/billing", { headers }, env)).json()).toMatchObject({ plan: "pro" });
  });

  it("opens Paddle's customer portal for subscribers", async () => {
    const clock = { now: Date.parse("2027-01-15T10:00:05Z") };
    const { app, calls } = makeApp(clock);
    const env = selling();
    const { headers, userId } = await signIn(app, env);
    expect((await app.request("/api/billing/portal", { method: "POST", headers }, env)).status).toBe(404);
    await deliver(app, env, subEvent("subscription.created", userId), clock.now);
    const res = await app.request("/api/billing/portal", { method: "POST", headers }, env);
    expect(await res.json()).toEqual({ url: "https://customer-portal.paddle.com/ctm_01" });
    expect(calls.filter((c) => c.kind === "paddle-portal")).toEqual([{ kind: "paddle-portal", clientId: "sandbox:ctm_01:sub_01" }]);
    expect((await app.request("/api/billing/portal", { method: "POST", headers }, { ...env, PADDLE_API_KEY: "FAIL" } as Env)).status).toBe(502);
  });

  it("deleting the account cancels the subscription first", async () => {
    const clock = { now: Date.parse("2027-01-15T10:00:05Z") };
    const { app, calls } = makeApp(clock);
    const env = selling();
    const { headers, userId } = await signIn(app, env);
    await deliver(app, env, subEvent("subscription.created", userId), clock.now);
    const del = (e: Env) => app.request("/api/account", { method: "DELETE", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ confirmEmail: "a@example.com" }) }, e);
    expect((await del({ ...env, PADDLE_API_KEY: "FAIL" } as Env)).status).toBe(502);
    expect((await del({ ...env, PADDLE_API_KEY: undefined } as Env)).status).toBe(409);
    expect((await del(env)).status).toBe(200);
    expect(calls.filter((c) => c.kind === "paddle-cancel")).toEqual([{ kind: "paddle-cancel", clientId: "sub_01" }, { kind: "paddle-cancel", clientId: "sub_01" }]);
    expect(await base.DB.prepare("SELECT COUNT(*) AS n FROM subscriptions").first("n")).toBe(0);
  });
});
