import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AI_MONTHLY_LIMIT } from "../src/ai";
import { BRIEF_MONTHLY_LIMIT } from "../src/brief";
import { ASK_MONTHLY_LIMIT } from "../src/ask";
import type { Env } from "../src/app";
import { EXT_ORIGIN, json, makeApp, makeEnv } from "./helpers";

let base: Env;
let dispose: () => Promise<void>;
beforeAll(async () => ({ env: base, dispose } = await makeEnv()));
afterAll(async () => dispose());
beforeEach(async () => {
  await base.DB.batch([base.DB.prepare("DELETE FROM ai_usage"), base.DB.prepare("DELETE FROM brief_usage"), base.DB.prepare("DELETE FROM ask_usage"), base.DB.prepare("DELETE FROM sessions"), base.DB.prepare("DELETE FROM users")]);
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
    expect(usage).toEqual({ used: 1, limit: AI_MONTHLY_LIMIT.free, available: true, briefs: { used: 0, limit: BRIEF_MONTHLY_LIMIT.free }, asks: { used: 0, limit: ASK_MONTHLY_LIMIT.free } });
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

const day = {
  date: "2026-11-10",
  weekday: "Tuesday",
  now: "08:30",
  workHours: { start: "09:00", end: "18:00" },
  focus: "Ship the release",
  tasks: [{ title: "Write release notes", priority: "high", planned: true, estimateMin: 60 }, { title: "Reply to Priya", overdue: true }],
  habits: [{ name: "Drink water", doneToday: false, streak: 4 }],
  events: [{ title: "Standup", start: "10:00", end: "10:15" }],
};

describe("daily brief", () => {
  it("writes a brief with its own monthly allowance (separate from summaries)", async () => {
    const { app, calls } = makeApp();
    const env = withKey();
    const auth = await signIn(app, env);
    const res = await app.request("/api/ai/brief", json(day, auth), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ brief: { headline: "Your Tuesday", priorities: [{ title: "Write release notes" }, { title: "Reply to Priya" }] }, usage: { used: 1, limit: BRIEF_MONTHLY_LIMIT.free } });
    expect(calls.filter((c) => c.kind === "brief")).toEqual([{ kind: "brief", clientId: "2026-11-10" }]);
    const usage = await (await app.request("/api/ai/usage", { headers: auth }, env)).json();
    expect(usage).toMatchObject({ used: 0, briefs: { used: 1 } });
  });

  it("stops at the monthly limit and doesn't count failures", async () => {
    const clock = { now: Date.UTC(2026, 10, 10) };
    const { app } = makeApp(clock);
    const env = withKey();
    const auth = await signIn(app, env);
    expect((await app.request("/api/ai/brief", json({ ...day, focus: "FAIL" }, auth), env)).status).toBe(502);
    for (let i = 0; i < BRIEF_MONTHLY_LIMIT.free; i++) expect((await app.request("/api/ai/brief", json(day, auth), env)).status).toBe(200);
    const over = await app.request("/api/ai/brief", json(day, auth), env);
    expect(over.status).toBe(429);
    expect(await over.json()).toMatchObject({ error: "brief_quota_exceeded" });
  });

  it("validates the day it's given", async () => {
    const { app } = makeApp();
    const env = withKey();
    const auth = await signIn(app, env);
    expect((await app.request("/api/ai/brief", json({ ...day, date: "tomorrow" }, auth), env)).status).toBe(400);
    expect((await app.request("/api/ai/brief", json({ ...day, tasks: Array.from({ length: 200 }, () => ({ title: "x" })) }, auth), env)).status).toBe(400);
    expect((await app.request("/api/ai/brief", json({ ...day, focus: "x".repeat(50_000) }, auth), env)).status).toBe(413);
    expect((await app.request("/api/ai/brief", json(day, { Origin: EXT_ORIGIN }), env)).status).toBe(401);
    expect((await app.request("/api/ai/brief", json(day, auth), base)).status).toBe(503);
  });
});

const week = {
  weekStart: "2026-11-02",
  weekEnd: "2026-11-08",
  daysSoFar: 7,
  done: [{ title: "Write release notes", day: "2026-11-03", priority: "high" }],
  slipped: [{ title: "Reply to Priya", due: "2026-11-05" }],
  added: 4,
  perDay: [{ day: "2026-11-02", done: 0, focusMin: 50 }],
  habits: [{ name: "Drink water", done: 5, of: 7 }],
  focus: { sessions: 2, minutes: 50 },
  browsing: { minutes: 600, topSites: [{ site: "github.com", minutes: 200 }] },
  meetings: { count: 1, minutes: 30, titles: ["Standup"], openActions: [] },
  notes: { created: 1, edited: 2 },
  focuses: [{ day: "2026-11-03", text: "Ship the release" }],
  reflections: [],
  userNote: "Too many meetings",
};

describe("weekly review", () => {
  it("writes a review, counted with daily briefs", async () => {
    const { app, calls } = makeApp();
    const env = withKey();
    const auth = await signIn(app, env);
    const res = await app.request("/api/ai/review", json(week, auth), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ review: { headline: "1 tasks done", nextWeek: [{ title: "Reply to Priya" }] }, usage: { used: 1, limit: BRIEF_MONTHLY_LIMIT.free } });
    expect(calls.filter((c) => c.kind === "review")).toEqual([{ kind: "review", clientId: "2026-11-02" }]);
    expect(await (await app.request("/api/ai/usage", { headers: auth }, env)).json()).toMatchObject({ used: 0, briefs: { used: 1 }, asks: { used: 0 } });
  });

  it("refunds failures and validates the week", async () => {
    const { app } = makeApp();
    const env = withKey();
    const auth = await signIn(app, env);
    expect((await app.request("/api/ai/review", json({ ...week, userNote: "FAIL" }, auth), env)).status).toBe(502);
    expect(await (await app.request("/api/ai/usage", { headers: auth }, env)).json()).toMatchObject({ briefs: { used: 0 } });
    expect((await app.request("/api/ai/review", json({ ...week, weekStart: "last week" }, auth), env)).status).toBe(400);
    expect((await app.request("/api/ai/review", json({ ...week, done: Array.from({ length: 200 }, () => ({ title: "x", day: "2026-11-03" })) }, auth), env)).status).toBe(400);
    expect((await app.request("/api/ai/review", json({ ...week, userNote: "x".repeat(60_000) }, auth), env)).status).toBe(413);
    expect((await app.request("/api/ai/review", json(week, { Origin: EXT_ORIGIN }), env)).status).toBe(401);
    expect((await app.request("/api/ai/review", json(week, auth), base)).status).toBe(503);
  });
});

describe("Ask ProdLi", () => {
  const ask = (question: string, extra: Record<string, unknown> = {}) => ({ question, context: day, snippets: [{ kind: "note", title: "Ideas", text: "Launch blog post" }], history: [{ role: "user", text: "hi" }, { role: "assistant", text: "Hello!" }], ...extra });

  it("answers with suggested actions, counted separately from briefs and summaries", async () => {
    const { app } = makeApp();
    const env = withKey();
    const auth = await signIn(app, env);
    const res = await app.request("/api/ai/ask", json(ask("What should I do first?"), auth), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ answer: "Start with Write release notes.", actions: [{ type: "plan_today", title: "Write release notes", details: "" }], usage: { used: 1, limit: ASK_MONTHLY_LIMIT.free } });
    expect(await (await app.request("/api/ai/usage", { headers: auth }, env)).json()).toMatchObject({ used: 0, briefs: { used: 0 }, asks: { used: 1 } });
  });

  it("refunds failures, enforces the limit and validates input", async () => {
    const { app } = makeApp();
    const env = withKey();
    const auth = await signIn(app, env);
    expect((await app.request("/api/ai/ask", json(ask("FAIL"), auth), env)).status).toBe(502);
    expect(await (await app.request("/api/ai/usage", { headers: auth }, env)).json()).toMatchObject({ asks: { used: 0 } });
    expect((await app.request("/api/ai/ask", json(ask(""), auth), env)).status).toBe(400);
    expect((await app.request("/api/ai/ask", json(ask("q", { history: Array.from({ length: 20 }, () => ({ role: "user", text: "x" })) }), auth), env)).status).toBe(400);
    expect((await app.request("/api/ai/ask", json(ask("q", { snippets: [{ kind: "email", title: "x", text: "y" }] }), auth), env)).status).toBe(400);
    expect((await app.request("/api/ai/ask", json(ask("x".repeat(2000), { history: Array.from({ length: 10 }, () => ({ role: "user", text: "h".repeat(4000) })), snippets: Array.from({ length: 12 }, () => ({ kind: "note", title: "t".repeat(300), text: "y".repeat(3000) })) }), auth), env)).status).toBe(413);
    expect((await app.request("/api/ai/ask", json(ask("q"), { Origin: EXT_ORIGIN }), env)).status).toBe(401);
    for (let i = 0; i < ASK_MONTHLY_LIMIT.free; i++) await app.request("/api/ai/ask", json(ask("q"), auth), env);
    const over = await app.request("/api/ai/ask", json(ask("q"), auth), env);
    expect(over.status).toBe(429);
    expect(await over.json()).toMatchObject({ error: "ask_quota_exceeded" });
  });
});
