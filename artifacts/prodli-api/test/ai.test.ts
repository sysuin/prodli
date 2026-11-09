import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AI_MONTHLY_LIMIT } from "../src/ai";
import type { Env } from "../src/app";
import { EXT_ORIGIN, json, makeApp, makeEnv } from "./helpers";

let base: Env;
let dispose: () => Promise<void>;
beforeAll(async () => ({ env: base, dispose } = await makeEnv()));
afterAll(async () => dispose());
beforeEach(async () => {
  await base.DB.batch([base.DB.prepare("DELETE FROM ai_usage"), base.DB.prepare("DELETE FROM sessions"), base.DB.prepare("DELETE FROM users")]);
});

const withKey = () => ({ ...base, ANTHROPIC_API_KEY: "sk-test" }) as Env;

async function signIn(app: ReturnType<typeof makeApp>["app"], env: Env, who = "a") {
  const res = await app.request("/api/auth/google", json({ kind: "extension", accessToken: `good:sub-${who}:${who}@example.com:${who}` }, { Origin: EXT_ORIGIN }), env);
  const body = (await res.json()) as { token: string };
  return { Authorization: `Bearer ${body.token}`, Origin: EXT_ORIGIN };
}
const meeting = { title: "Standup", date: "2026-11-01", transcript: "[00:00] Ann: Let's ship on Friday." };

describe("AI summaries", () => {
  it("summarizes with ProdLi's key and counts it against the monthly allowance", async () => {
    const { app, calls } = makeApp();
    const env = withKey();
    const auth = await signIn(app, env);
    const res = await app.request("/api/ai/summarize", json(meeting, auth), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ summary: { title: "Notes: Standup" }, usage: { used: 1, limit: AI_MONTHLY_LIMIT.free } });
    expect(calls.filter((c) => c.kind === "summarize")).toHaveLength(1);
    const usage = await (await app.request("/api/ai/usage", { headers: auth }, env)).json();
    expect(usage).toEqual({ used: 1, limit: AI_MONTHLY_LIMIT.free, available: true });
  });

  it("stops at the monthly limit, and the allowance resets next month", async () => {
    const clock = { now: Date.UTC(2026, 10, 15) };
    const { app } = makeApp(clock);
    const env = withKey();
    const auth = await signIn(app, env);
    for (let i = 0; i < AI_MONTHLY_LIMIT.free; i++) expect((await app.request("/api/ai/summarize", json(meeting, auth), env)).status).toBe(200);
    const over = await app.request("/api/ai/summarize", json(meeting, auth), env);
    expect(over.status).toBe(429);
    expect(await over.json()).toMatchObject({ error: "ai_quota_exceeded" });
    clock.now = Date.UTC(2026, 11, 1);
    expect((await app.request("/api/ai/summarize", json(meeting, auth), env)).status).toBe(200);
  });

  it("doesn't count failed summaries", async () => {
    const { app } = makeApp();
    const env = withKey();
    const auth = await signIn(app, env);
    const res = await app.request("/api/ai/summarize", json({ ...meeting, transcript: "FAIL" }, auth), env);
    expect(res.status).toBe(502);
    expect(await (await app.request("/api/ai/usage", { headers: auth }, env)).json()).toMatchObject({ used: 0 });
  });

  it("each user has their own allowance", async () => {
    const { app } = makeApp();
    const env = withKey();
    const a = await signIn(app, env, "a");
    const b = await signIn(app, env, "b");
    await app.request("/api/ai/summarize", json(meeting, a), env);
    expect(await (await app.request("/api/ai/usage", { headers: b }, env)).json()).toMatchObject({ used: 0 });
  });

  it("needs a session, a transcript, and the server key", async () => {
    const { app } = makeApp();
    expect((await app.request("/api/ai/summarize", json(meeting, { Origin: EXT_ORIGIN }), withKey())).status).toBe(401);
    const auth = await signIn(app, withKey());
    expect((await app.request("/api/ai/summarize", json({ ...meeting, transcript: "  " }, auth), withKey())).status).toBe(400);
    expect((await app.request("/api/ai/summarize", json({ ...meeting, transcript: "x".repeat(700_000) }, auth), withKey())).status).toBe(413);
    expect((await app.request("/api/ai/summarize", json(meeting, auth), base)).status).toBe(503);
    expect(await (await app.request("/api/config", {}, base)).json()).toMatchObject({ ai: false });
  });
});
