import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AI_MONTHLY_LIMIT } from "../src/ai";
import { signWebhook, verifyWebhook } from "../src/billing";
import type { Env } from "../src/app";
import { EXT_ORIGIN, json, makeApp, makeEnv } from "./helpers";

let base: Env;
let dispose: () => Promise<void>;
beforeAll(async () => ({ env: base, dispose } = await makeEnv()));
afterAll(async () => dispose());
beforeEach(async () => {
  await base.DB.batch(["subscriptions", "billing_customers", "ai_usage", "brief_usage", "ask_usage", "sessions", "users"].map((t) => base.DB.prepare(`DELETE FROM ${t}`)));
});

// A Standard Webhooks secret: "whsec_" + base64 key.
const SECRET = `whsec_${btoa("prodli-test-webhook-key-32-bytes!")}`;
const selling = () => ({ ...base, DODO_ENV: "test", DODO_PRODUCT_MONTHLY: "pdt_month", DODO_PRODUCT_YEARLY: "pdt_year", DODO_WEBHOOK_SECRET: SECRET, DODO_API_KEY: "dodo_test_key", ANTHROPIC_API_KEY: "sk-test" }) as Env;

async function signIn(app: ReturnType<typeof makeApp>["app"], env: Env, who = "a") {
  const res = await app.request("/api/auth/google", json({ kind: "extension", accessToken: `good:sub-${who}:${who}@example.com:${who}` }, { Origin: EXT_ORIGIN }), env);
  const body = (await res.json()) as { token: string; user: { id: string } };
  return { headers: { Authorization: `Bearer ${body.token}`, Origin: EXT_ORIGIN }, userId: body.user.id };
}

const subEvent = (type: string, customerId: string, extra: Record<string, unknown> = {}, at = "2027-01-15T10:00:00.000Z") => ({
  business_id: "bus_test",
  type,
  timestamp: at,
  data: {
    payload_type: "Subscription",
    subscription_id: "sub_01",
    status: "active",
    customer: { customer_id: customerId, email: "a@example.com", name: "a" },
    metadata: {},
    product_id: "pdt_month",
    payment_frequency_interval: "Month",
    next_billing_date: "2027-02-15T10:00:00.000Z",
    cancel_at_next_billing_date: false,
    ...extra,
  },
});

async function deliver(app: ReturnType<typeof makeApp>["app"], env: Env, event: unknown, nowMs: number, secret = SECRET) {
  const raw = JSON.stringify(event);
  const ts = Math.floor(nowMs / 1000);
  const id = `msg_${Math.random().toString(36).slice(2)}`;
  const sig = await signWebhook(id, ts, raw, secret);
  return app.request("/api/billing/webhook", { method: "POST", headers: { "Content-Type": "application/json", "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": `v1,${sig}` }, body: raw }, env);
}

/** Signs in, starts a checkout (creates the Dodo customer) and returns the customer id. */
async function checkoutCustomer(app: ReturnType<typeof makeApp>["app"], env: Env, headers: Record<string, string>) {
  const res = await app.request("/api/billing/checkout", json({ interval: "monthly" }, headers), env);
  expect(res.status).toBe(200);
  return (await env.DB.prepare("SELECT customer_id FROM billing_customers").first<{ customer_id: string }>())!.customer_id;
}

describe("Dodo webhook signatures (Standard Webhooks)", () => {
  it("accepts only an exact, recent signature", async () => {
    const now = 1_800_000_000_000;
    const ts = now / 1000;
    const sig = await signWebhook("msg_1", ts, '{"a":1}', SECRET);
    const h = (signature: string, id = "msg_1", t = String(ts)) => ({ id, timestamp: t, signature });
    expect(await verifyWebhook('{"a":1}', h(`v1,${sig}`), SECRET, now)).toBe(true);
    expect(await verifyWebhook('{"a":1}', h(`v1,old v1,${sig}`), SECRET, now)).toBe(true); // key rotation
    expect(await verifyWebhook('{"a": 1}', h(`v1,${sig}`), SECRET, now)).toBe(false); // body changed
    expect(await verifyWebhook('{"a":1}', h(`v1,${sig}`, "msg_2"), SECRET, now)).toBe(false); // id changed
    expect(await verifyWebhook('{"a":1}', h(`v1,${sig}`), `whsec_${btoa("another key")}`, now)).toBe(false);
    expect(await verifyWebhook('{"a":1}', h(`v1,${sig}`), SECRET, now + 10 * 60_000)).toBe(false); // replayed later
    expect(await verifyWebhook('{"a":1}', h(`v2,${sig}`), SECRET, now)).toBe(false);
    expect(await verifyWebhook('{"a":1}', {}, SECRET, now)).toBe(false);
  });
});

describe("ProdLi Pro", () => {
  it("isn't for sale until Dodo is configured", async () => {
    const { app } = makeApp();
    const { headers } = await signIn(app, base);
    expect(await (await app.request("/api/billing", { headers }, base)).json()).toMatchObject({ plan: "free", onSale: null, subscription: null, limits: { free: { summaries: AI_MONTHLY_LIMIT.free }, pro: { summaries: AI_MONTHLY_LIMIT.pro } } });
    expect((await app.request("/api/billing/checkout", json({ interval: "monthly" }, headers), base)).status).toBe(503);
    expect((await deliver(app, base, subEvent("subscription.active", "cus_x"), Date.now())).status).toBe(404);
  });

  it("shows Dodo's prices and opens a hosted checkout for the user (one Dodo customer per user)", async () => {
    const { app, calls } = makeApp();
    const env = selling();
    const { headers, userId } = await signIn(app, env);
    expect(await (await app.request("/api/billing", { headers }, env)).json()).toMatchObject({ onSale: { monthly: true, yearly: true }, prices: { monthly: { amount: 500, currency: "USD" }, yearly: { amount: 4800, currency: "USD" } } });
    const r1 = await app.request("/api/billing/checkout", json({ interval: "yearly" }, headers), env);
    expect(await r1.json()).toEqual({ url: "https://checkout.dodopayments.com/session/pdt_year" });
    await app.request("/api/billing/checkout", json({ interval: "monthly" }, headers), env);
    expect(calls.filter((c) => c.kind === "dodo-customer")).toEqual([{ kind: "dodo-customer", clientId: `test:a@example.com:${userId}` }]);
    expect(calls.filter((c) => c.kind === "dodo-checkout").map((c) => c.clientId)).toEqual([`pdt_year:cus_${userId.slice(0, 8)}:http://localhost/?pro=thanks`, `pdt_month:cus_${userId.slice(0, 8)}:http://localhost/?pro=thanks`]);
    expect((await app.request("/api/billing/checkout", json({ interval: "weekly" }, headers), env)).status).toBe(400);
    expect((await app.request("/api/billing/checkout", json({ interval: "monthly" }, headers), { ...env, DODO_API_KEY: "FAIL" } as Env)).status).toBe(502);
  });

  it("a paid subscription turns Pro on (and raises the limits); cancelling turns it off", async () => {
    const clock = { now: Date.parse("2027-01-15T10:00:05Z") };
    const { app } = makeApp(clock);
    const env = selling();
    const { headers } = await signIn(app, env);
    const customer = await checkoutCustomer(app, env, headers);

    expect(await (await deliver(app, env, subEvent("subscription.active", customer), clock.now)).json()).toEqual({ ok: true, applied: true });
    expect(await (await app.request("/api/billing", { headers }, env)).json()).toMatchObject({ plan: "pro", canManage: true, subscription: { status: "active", interval: "month", renewsAt: Date.parse("2027-02-15T10:00:00Z"), endsAt: null } });
    expect(await (await app.request("/api/ai/usage", { headers }, env)).json()).toMatchObject({ limit: AI_MONTHLY_LIMIT.pro });
    expect((await app.request("/api/billing/checkout", json({ interval: "monthly" }, headers), env)).status).toBe(409); // already Pro

    // Cancelled at the end of the period: still Pro until then.
    clock.now += 60_000;
    await deliver(app, env, subEvent("subscription.updated", customer, { cancel_at_next_billing_date: true }, "2027-01-15T10:01:00.000Z"), clock.now);
    expect(await (await app.request("/api/billing", { headers }, env)).json()).toMatchObject({ plan: "pro", subscription: { renewsAt: null, endsAt: Date.parse("2027-02-15T10:00:00Z") } });

    // A failed renewal: grace period keeps Pro; on hold ends it.
    clock.now += 60_000;
    await deliver(app, env, subEvent("subscription.past_due", customer, { status: "past_due" }, "2027-01-15T10:02:00.000Z"), clock.now);
    expect(await (await app.request("/api/billing", { headers }, env)).json()).toMatchObject({ plan: "pro", subscription: { status: "past_due" } });
    clock.now += 60_000;
    await deliver(app, env, subEvent("subscription.cancelled", customer, { status: "cancelled" }, "2027-01-15T10:03:00.000Z"), clock.now);
    expect(await (await app.request("/api/billing", { headers }, env)).json()).toMatchObject({ plan: "free", subscription: { status: "cancelled" } });
    expect(await (await app.request("/api/ai/usage", { headers }, env)).json()).toMatchObject({ limit: AI_MONTHLY_LIMIT.free });
  });

  it("matches events by metadata too, and ignores stale, unsigned and unknown-user events", async () => {
    const clock = { now: Date.parse("2027-01-15T10:05:00Z") };
    const { app } = makeApp(clock);
    const env = selling();
    const { headers, userId } = await signIn(app, env);
    // No checkout recorded here (e.g. bought through a payment link): metadata.userId identifies the user.
    await deliver(app, env, subEvent("subscription.active", "cus_other", { metadata: { userId } }, "2027-01-15T10:04:00.000Z"), clock.now);
    expect(await (await app.request("/api/billing", { headers }, env)).json()).toMatchObject({ plan: "pro" });

    const late = await deliver(app, env, subEvent("subscription.cancelled", "cus_other", { status: "cancelled" }, "2027-01-15T09:00:00.000Z"), clock.now);
    expect(await late.json()).toEqual({ ok: true, applied: false });
    expect(await (await app.request("/api/billing", { headers }, env)).json()).toMatchObject({ plan: "pro" });

    expect((await deliver(app, env, subEvent("subscription.cancelled", "cus_other", { status: "cancelled" }), clock.now, `whsec_${btoa("wrong")}`)).status).toBe(401);
    expect((await app.request("/api/billing/webhook", { method: "POST", body: JSON.stringify(subEvent("subscription.cancelled", "cus_other", { status: "cancelled" })) }, env)).status).toBe(401);
    expect(await (await deliver(app, env, subEvent("subscription.active", "cus_nobody", { subscription_id: "sub_02" }), clock.now)).json()).toEqual({ ok: true, applied: false });
    expect(await (await deliver(app, env, { type: "payment.succeeded", data: {} }, clock.now)).json()).toEqual({ ok: true, applied: false });
    // Another brand's product in the same Dodo business (e.g. JobScanner) never touches ProdLi.
    expect(await (await deliver(app, env, subEvent("subscription.cancelled", "cus_other", { status: "cancelled", product_id: "pdt_jobscanner" }, "2027-01-15T10:06:00.000Z"), clock.now)).json()).toEqual({ ok: true, applied: false });
    expect(await (await app.request("/api/billing", { headers }, env)).json()).toMatchObject({ plan: "pro" });
  });

  it("opens Dodo's customer portal for subscribers", async () => {
    const clock = { now: Date.parse("2027-01-15T10:00:05Z") };
    const { app, calls } = makeApp(clock);
    const env = selling();
    const { headers } = await signIn(app, env);
    expect((await app.request("/api/billing/portal", { method: "POST", headers }, env)).status).toBe(404);
    const customer = await checkoutCustomer(app, env, headers);
    await deliver(app, env, subEvent("subscription.active", customer), clock.now);
    const res = await app.request("/api/billing/portal", { method: "POST", headers }, env);
    expect(await res.json()).toEqual({ url: `https://customer.dodopayments.com/${customer}` });
    expect(calls.filter((c) => c.kind === "dodo-portal")).toEqual([{ kind: "dodo-portal", clientId: `test:${customer}` }]);
    expect((await app.request("/api/billing/portal", { method: "POST", headers }, { ...env, DODO_API_KEY: "FAIL" } as Env)).status).toBe(502);
  });

  it("deleting the account cancels the subscription first", async () => {
    const clock = { now: Date.parse("2027-01-15T10:00:05Z") };
    const { app, calls } = makeApp(clock);
    const env = selling();
    const { headers } = await signIn(app, env);
    const customer = await checkoutCustomer(app, env, headers);
    await deliver(app, env, subEvent("subscription.active", customer), clock.now);
    const del = (e: Env) => app.request("/api/account", { method: "DELETE", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ confirmEmail: "a@example.com" }) }, e);
    expect((await del({ ...env, DODO_API_KEY: "FAIL" } as Env)).status).toBe(502);
    expect((await del({ ...env, DODO_API_KEY: undefined } as Env)).status).toBe(409);
    expect((await del(env)).status).toBe(200);
    expect(calls.filter((c) => c.kind === "dodo-cancel")).toEqual([{ kind: "dodo-cancel", clientId: "sub_01" }, { kind: "dodo-cancel", clientId: "sub_01" }]);
    expect(await base.DB.prepare("SELECT (SELECT COUNT(*) FROM subscriptions) + (SELECT COUNT(*) FROM billing_customers) AS n").first("n")).toBe(0);
  });
});
