import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AI_MONTHLY_LIMIT, monthKey } from "../src/ai";
import { BRIEF_MONTHLY_LIMIT } from "../src/brief";
import { ASK_MONTHLY_LIMIT } from "../src/ask";
import { MAX_FOLLOW_UP_CHARS, MAX_REWRITE_CHARS, WRITE_MONTHLY_LIMIT } from "../src/write";
import { TRANSCRIBE_MONTHLY_MINUTES, wavSeconds } from "../src/transcribe";
import type { Env } from "../src/app";
import { EXT_ORIGIN, json, makeApp, makeEnv } from "./helpers";

let base: Env;
let dispose: () => Promise<void>;
beforeAll(async () => ({ env: base, dispose } = await makeEnv()));
afterAll(async () => dispose());
beforeEach(async () => {
  await base.DB.batch([base.DB.prepare("DELETE FROM ai_usage"), base.DB.prepare("DELETE FROM brief_usage"), base.DB.prepare("DELETE FROM ask_usage"), base.DB.prepare("DELETE FROM write_usage"), base.DB.prepare("DELETE FROM sessions"), base.DB.prepare("DELETE FROM users")]);
});

/** makeApp()'s default clock. */
const NOW = 1_800_000_000_000;
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
    expect(usage).toEqual({ used: 1, limit: AI_MONTHLY_LIMIT.free, available: true, briefs: { used: 0, limit: BRIEF_MONTHLY_LIMIT.free }, asks: { used: 0, limit: ASK_MONTHLY_LIMIT.free }, writes: { used: 0, limit: WRITE_MONTHLY_LIMIT.free }, transcribeSeconds: { used: 0, limit: TRANSCRIBE_MONTHLY_MINUTES.free * 60, available: false } });
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
    // Use up the allowance by setting this month's count (62 requests are too slow for CI).
    const { user } = (await (await app.request("/api/me", { headers: auth }, env)).json()) as { user: { id: string } };
    await env.DB.prepare("INSERT INTO brief_usage (user_id, month, count) VALUES (?1, ?2, ?3) ON CONFLICT (user_id, month) DO UPDATE SET count = excluded.count").bind(user.id, monthKey(clock.now), BRIEF_MONTHLY_LIMIT.free - 1).run();
    expect((await app.request("/api/ai/brief", json(day, auth), env)).status).toBe(200);
    const over = await app.request("/api/ai/brief", json(day, auth), env);
    expect(over.status).toBe(429);
    expect(await over.json()).toMatchObject({ error: "brief_quota_exceeded" });
  });

  it("accepts meeting prep for today's meetings, within limits", async () => {
    const { app } = makeApp();
    const env = withKey();
    const auth = await signIn(app, env);
    const meetingPrep = [{ event: "Acme pilot review", start: "14:00", lastMet: "12 Nov", lastSummary: "Agreed on a two-week pilot.", openItems: ["Send Priya the pilot plan"], relatedTasks: ["Book the venue with Priya"] }];
    expect((await app.request("/api/ai/brief", json({ ...day, meetingPrep }, auth), env)).status).toBe(200);
    expect((await app.request("/api/ai/brief", json({ ...day, meetingPrep: [{ ...meetingPrep[0], openItems: Array.from({ length: 20 }, () => "x") }] }, auth), env)).status).toBe(400);
    expect((await app.request("/api/ai/brief", json({ ...day, meetingPrep: [{ ...meetingPrep[0], start: "2pm" }] }, auth), env)).status).toBe(400);
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
    expect(await res.json()).toEqual({ answer: "Start with Write release notes.", actions: [{ type: "plan_today", title: "Write release notes", details: "" }], sources: [1], usage: { used: 1, limit: ASK_MONTHLY_LIMIT.free } });
    // Without note/meeting snippets there are no sources.
    const noSnippets = await app.request("/api/ai/ask", json(ask("What did we decide?", { snippets: [] }), auth), env);
    expect(await noSnippets.json()).toMatchObject({ sources: [] });
    expect(await (await app.request("/api/ai/usage", { headers: auth }, env)).json()).toMatchObject({ used: 0, briefs: { used: 0 }, asks: { used: 2 } });
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
    // Use up the allowance by setting this month's count (a hundred requests are too slow for CI).
    const { user } = (await (await app.request("/api/me", { headers: auth }, env)).json()) as { user: { id: string } };
    await env.DB.prepare("INSERT INTO ask_usage (user_id, month, count) VALUES (?1, ?2, ?3) ON CONFLICT (user_id, month) DO UPDATE SET count = excluded.count").bind(user.id, monthKey(NOW), ASK_MONTHLY_LIMIT.free - 1).run();
    expect((await app.request("/api/ai/ask", json(ask("q"), auth), env)).status).toBe(200);
    const over = await app.request("/api/ai/ask", json(ask("q"), auth), env);
    expect(over.status).toBe(429);
    expect(await over.json()).toMatchObject({ error: "ask_quota_exceeded" });
  });
});

describe("Writing help (rewrite)", () => {
  const rewrite = (text: string, action = "fix") => ({ action, text });

  it("rewrites the selection, counted separately from the other allowances", async () => {
    const { app, calls } = makeApp();
    const env = withKey();
    const auth = await signIn(app, env);
    const res = await app.request("/api/ai/rewrite", json(rewrite("I saw teh **plan**."), auth), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "I saw the **plan**.", changed: true, usage: { used: 1, limit: WRITE_MONTHLY_LIMIT.free } });
    expect(calls.filter((c) => c.kind === "rewrite").map((c) => c.clientId)).toEqual(["fix"]);
    expect(await (await app.request("/api/ai/usage", { headers: auth }, env)).json()).toMatchObject({ used: 0, briefs: { used: 0 }, asks: { used: 0 }, writes: { used: 1 } });
    const billing = (await (await app.request("/api/billing", { headers: auth }, env)).json()) as { limits: { free: { writes: number }; pro: { writes: number } } };
    expect(billing.limits.free.writes).toBe(WRITE_MONTHLY_LIMIT.free);
    expect(billing.limits.pro.writes).toBe(WRITE_MONTHLY_LIMIT.pro);
  });

  it("refunds failures, enforces the limit and validates input", async () => {
    const { app } = makeApp();
    const env = withKey();
    const auth = await signIn(app, env);
    expect((await app.request("/api/ai/rewrite", json(rewrite("FAIL"), auth), env)).status).toBe(502);
    expect(await (await app.request("/api/ai/usage", { headers: auth }, env)).json()).toMatchObject({ writes: { used: 0 } });
    expect((await app.request("/api/ai/rewrite", json(rewrite(""), auth), env)).status).toBe(400);
    expect((await app.request("/api/ai/rewrite", json(rewrite("   \n "), auth), env)).status).toBe(400);
    expect((await app.request("/api/ai/rewrite", json(rewrite("hi", "translate"), auth), env)).status).toBe(400);
    expect((await app.request("/api/ai/rewrite", json({ text: "hi" }, auth), env)).status).toBe(400);
    expect((await app.request("/api/ai/rewrite", json(rewrite("x".repeat(MAX_REWRITE_CHARS)), auth), env)).status).toBe(200);
    expect((await app.request("/api/ai/rewrite", json(rewrite("x".repeat(MAX_REWRITE_CHARS + 1)), auth), env)).status).toBe(413);
    expect((await app.request("/api/ai/rewrite", json(rewrite("hi"), { Origin: EXT_ORIGIN }), env)).status).toBe(401);
    // Use up the allowance by setting this month's count (hundreds of requests are too slow for CI).
    const { user } = (await (await app.request("/api/me", { headers: auth }, env)).json()) as { user: { id: string } };
    await env.DB.prepare("UPDATE write_usage SET count = ?1 WHERE user_id = ?2 AND month = ?3").bind(WRITE_MONTHLY_LIMIT.free - 1, user.id, monthKey(NOW)).run();
    const last = await app.request("/api/ai/rewrite", json(rewrite("hi", "shorter"), auth), env);
    expect(last.status).toBe(200);
    expect(await last.json()).toMatchObject({ usage: { used: WRITE_MONTHLY_LIMIT.free, limit: WRITE_MONTHLY_LIMIT.free } });
    const over = await app.request("/api/ai/rewrite", json(rewrite("hi"), auth), env);
    expect(over.status).toBe(429);
    expect(await over.json()).toMatchObject({ error: "write_quota_exceeded", usage: { used: WRITE_MONTHLY_LIMIT.free, limit: WRITE_MONTHLY_LIMIT.free } });
  });

  it("is off without ProdLi's key", async () => {
    const { app } = makeApp();
    const auth = await signIn(app, base);
    expect((await app.request("/api/ai/rewrite", json(rewrite("hi"), auth), base)).status).toBe(503);
  });
});

describe("Writing help (follow-up email)", () => {
  const meeting = (over: Record<string, unknown> = {}) => ({
    title: "Launch sync",
    date: "2026-11-17",
    overview: "We agreed the launch plan.",
    keyPoints: ["Store listing is ready"],
    decisions: ["Launch on Monday"],
    actionItems: [{ task: "Submit the extension", owner: "Sunny", dueDate: "2026-11-18" }, { task: "Post the announcement", owner: null, dueDate: null }],
    openQuestions: [],
    ...over,
  });
  const followUp = (tone: string, m = meeting()) => ({ tone, meeting: m });

  it("drafts an email from the summary and shares the writing allowance", async () => {
    const { app, calls } = makeApp();
    const env = withKey();
    const auth = await signIn(app, env);
    const res = await app.request("/api/ai/follow-up", json(followUp("formal"), auth), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ subject: "Follow-up: Launch sync", body: "formal | Submit the extension, Post the announcement", usage: { used: 1, limit: WRITE_MONTHLY_LIMIT.free } });
    expect(calls.filter((c) => c.kind === "follow-up").map((c) => c.clientId)).toEqual(["formal"]);
    // Rewrites and follow-ups count toward the same monthly number.
    await app.request("/api/ai/rewrite", json({ action: "fix", text: "hi" }, auth), env);
    expect(await (await app.request("/api/ai/usage", { headers: auth }, env)).json()).toMatchObject({ writes: { used: 2 } });
    // Older summaries without optional lists still work.
    const minimal = await app.request("/api/ai/follow-up", json({ tone: "friendly", meeting: { title: "t", date: "d", overview: "o" } }, auth), env);
    expect(minimal.status).toBe(200);
  });

  it("refunds failures, enforces the limit and validates input", async () => {
    const { app } = makeApp();
    const env = withKey();
    const auth = await signIn(app, env);
    expect((await app.request("/api/ai/follow-up", json(followUp("formal", meeting({ overview: "FAIL" })), auth), env)).status).toBe(502);
    expect(await (await app.request("/api/ai/usage", { headers: auth }, env)).json()).toMatchObject({ writes: { used: 0 } });
    expect((await app.request("/api/ai/follow-up", json(followUp("rude"), auth), env)).status).toBe(400);
    expect((await app.request("/api/ai/follow-up", json(followUp("formal", meeting({ overview: "  " })), auth), env)).status).toBe(400);
    expect((await app.request("/api/ai/follow-up", json({ tone: "formal" }, auth), env)).status).toBe(400);
    expect((await app.request("/api/ai/follow-up", { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: "{not json" }, env)).status).toBe(400);
    expect((await app.request("/api/ai/follow-up", json(followUp("formal", meeting({ actionItems: Array.from({ length: 41 }, () => ({ task: "t" })) })), auth), env)).status).toBe(400);
    expect((await app.request("/api/ai/follow-up", json(followUp("formal", meeting({ overview: "x".repeat(MAX_FOLLOW_UP_CHARS) })), auth), env)).status).toBe(413);
    expect((await app.request("/api/ai/follow-up", json(followUp("formal"), { Origin: EXT_ORIGIN }), env)).status).toBe(401);
    const { user } = (await (await app.request("/api/me", { headers: auth }, env)).json()) as { user: { id: string } };
    await env.DB.prepare("INSERT INTO write_usage (user_id, month, count) VALUES (?1, ?2, ?3) ON CONFLICT (user_id, month) DO UPDATE SET count = excluded.count").bind(user.id, monthKey(NOW), WRITE_MONTHLY_LIMIT.free).run();
    const over = await app.request("/api/ai/follow-up", json(followUp("friendly"), auth), env);
    expect(over.status).toBe(429);
    expect(await over.json()).toMatchObject({ error: "write_quota_exceeded" });
  });

  it("is off without ProdLi's key", async () => {
    const { app } = makeApp();
    const auth = await signIn(app, base);
    expect((await app.request("/api/ai/follow-up", json(followUp("formal"), auth), base)).status).toBe(503);
  });
});

describe("Audio transcription (Workers AI Whisper)", () => {
  /** A 16 kHz mono 16-bit WAV of `seconds`, optionally starting with a marker sample. */
  const wav = (seconds: number, { rate = 16000, channels = 1, first = 0 } = {}) => {
    const data = Math.round(seconds * rate) * 2 * channels;
    const b = new Uint8Array(44 + data);
    const v = new DataView(b.buffer);
    const put = (at: number, t: string) => [...t].forEach((ch, i) => (b[at + i] = ch.charCodeAt(0)));
    put(0, "RIFF"); v.setUint32(4, 36 + data, true); put(8, "WAVE"); put(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, channels, true); v.setUint32(24, rate, true);
    v.setUint32(28, rate * 2 * channels, true); v.setUint16(32, 2 * channels, true); v.setUint16(34, 16, true);
    put(36, "data"); v.setUint32(40, data, true);
    if (data) b[44] = first;
    return b;
  };
  const post = (body: Uint8Array, headers: Record<string, string>) => ({ method: "POST", headers: { ...headers, "Content-Type": "audio/wav" }, body });
  const withAi = () => ({ ...withKey(), AI: {} as Ai }) as Env;

  it("reads WAV headers and rejects other formats", () => {
    expect(wavSeconds(wav(30))).toBe(30);
    expect(wavSeconds(wav(1, { rate: 44100 }))).toBeNull();
    expect(wavSeconds(wav(1, { channels: 2 }))).toBeNull();
    expect(wavSeconds(new TextEncoder().encode("not audio at all, definitely not a wav file header"))).toBeNull();
  });

  it("transcribes a piece and counts its seconds", async () => {
    const { app, calls } = makeApp();
    const env = withAi();
    const auth = await signIn(app, env);
    const res = await app.request("/api/ai/transcribe", post(wav(29.5), auth), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "Kumusta, let's start the review.", segments: [{ start: 0.4, end: 2.1, text: "Kumusta, let's start the review." }], language: "tl", usage: { usedSeconds: 30, limitSeconds: TRANSCRIBE_MONTHLY_MINUTES.free * 60 } });
    expect(calls.filter((c) => c.kind === "transcribe")).toHaveLength(1);
    expect(await (await app.request("/api/ai/usage", { headers: auth }, env)).json()).toMatchObject({ transcribeSeconds: { used: 30, limit: TRANSCRIBE_MONTHLY_MINUTES.free * 60, available: true }, writes: { used: 0 } });
    const billing = (await (await app.request("/api/billing", { headers: auth }, env)).json()) as { limits: { pro: { transcribeMinutes: number } } };
    expect(billing.limits.pro.transcribeMinutes).toBe(TRANSCRIBE_MONTHLY_MINUTES.pro);
  });

  it("refunds failures, enforces the minutes and validates the audio", async () => {
    const { app } = makeApp();
    const env = withAi();
    const auth = await signIn(app, env);
    expect((await app.request("/api/ai/transcribe", post(wav(10, { first: 0x7f }), auth), env)).status).toBe(503);
    expect(await (await app.request("/api/ai/usage", { headers: auth }, env)).json()).toMatchObject({ transcribeSeconds: { used: 0 } });
    expect((await app.request("/api/ai/transcribe", post(wav(1, { rate: 44100 }), auth), env)).status).toBe(400);
    expect((await app.request("/api/ai/transcribe", post(wav(0.1), auth), env)).status).toBe(400);
    expect((await app.request("/api/ai/transcribe", post(wav(36), auth), env)).status).toBe(413);
    expect((await app.request("/api/ai/transcribe", post(wav(5), { Origin: EXT_ORIGIN }), env)).status).toBe(401);
    const { user } = (await (await app.request("/api/me", { headers: auth }, env)).json()) as { user: { id: string } };
    const limit = TRANSCRIBE_MONTHLY_MINUTES.free * 60;
    await env.DB.prepare("INSERT INTO transcribe_usage (user_id, month, seconds) VALUES (?1, ?2, ?3) ON CONFLICT (user_id, month) DO UPDATE SET seconds = excluded.seconds").bind(user.id, monthKey(NOW), limit - 10).run();
    expect((await app.request("/api/ai/transcribe", post(wav(10), auth), env)).status).toBe(200);
    const over = await app.request("/api/ai/transcribe", post(wav(1), auth), env);
    expect(over.status).toBe(429);
    expect(await over.json()).toMatchObject({ error: "transcribe_quota_exceeded", usage: { usedSeconds: limit, limitSeconds: limit } });
  });

  it("is off where Workers AI isn't bound (local development)", async () => {
    const { app } = makeApp();
    const env = withKey();
    const auth = await signIn(app, env);
    expect((await app.request("/api/ai/transcribe", post(wav(5), auth), env)).status).toBe(503);
    expect(await (await app.request("/api/ai/usage", { headers: auth }, env)).json()).toMatchObject({ transcribeSeconds: { available: false } });
  });
});

describe("Meeting templates and word list", () => {
  const meeting = { title: "Screen", date: "2026-11-18", transcript: "[00:00] You: Tell me about Flynn." };
  it("passes a known meeting type and a cleaned word list to the summary", async () => {
    const { app, calls } = makeApp();
    const env = withKey();
    const auth = await signIn(app, env);
    const res = await app.request("/api/ai/summarize", json({ ...meeting, template: "interview", glossary: ["Ghill  John", "Flynn", "Flynn", 42, " "] }, auth), env);
    expect(res.status).toBe(200);
    expect(calls.find((c) => c.kind === "summarize-options")?.clientId).toBe("interview|Ghill John,Flynn");
    await app.request("/api/ai/summarize", json({ ...meeting, template: "made-up" }, auth), env);
    expect(calls.filter((c) => c.kind === "summarize-options")).toHaveLength(1); // unknown types are ignored
  });

  it("sends the word list to Whisper as a hint", async () => {
    const { app, calls } = makeApp();
    const env = { ...withKey(), AI: {} as Ai } as Env;
    const auth = await signIn(app, env);
    const wav = new Uint8Array(44 + 32000);
    const v = new DataView(wav.buffer);
    const put = (at: number, t: string) => [...t].forEach((ch, i) => (wav[at + i] = ch.charCodeAt(0)));
    put(0, "RIFF"); put(8, "WAVE"); put(12, "fmt "); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 16000, true); v.setUint16(34, 16, true); put(36, "data"); v.setUint32(40, 32000, true);
    const res = await app.request("/api/ai/transcribe", { method: "POST", headers: { ...auth, "Content-Type": "audio/wav", "X-ProdLi-Vocabulary": encodeURIComponent("Ghill John,Flynn,DSR") }, body: wav }, env);
    expect(res.status).toBe(200);
    expect(calls.find((c) => c.kind === "transcribe")?.clientId).toBe("Ghill John|Flynn|DSR");
  });
});

describe("Page summaries (right-click Summarize page)", () => {
  it("summarises the page text and counts a writing-help use", async () => {
    const { app, calls } = makeApp();
    const env = withKey();
    const auth = await signIn(app, env);
    const res = await app.request("/api/ai/summarize-page", json({ title: "Pricing guide", url: "https://x.test/p", text: "Long article text." }, auth), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ summary: { tldr: "About Pricing guide.", points: ["One", "Two"] }, usage: { used: 1, limit: WRITE_MONTHLY_LIMIT.free } });
    expect(calls.some((c) => c.kind === "page")).toBe(true);
    expect((await app.request("/api/ai/summarize-page", json({ title: "x", text: "FAIL" }, auth), env)).status).toBe(502);
    expect(await (await app.request("/api/ai/usage", { headers: auth }, env)).json()).toMatchObject({ writes: { used: 1 } });
    expect((await app.request("/api/ai/summarize-page", json({ title: "x", text: " " }, auth), env)).status).toBe(400);
    expect((await app.request("/api/ai/summarize-page", json({ title: "x", text: "y".repeat(24_001) }, auth), env)).status).toBe(413);
    expect((await app.request("/api/ai/summarize-page", json({ text: "y" }, { Origin: EXT_ORIGIN }), env)).status).toBe(401);
  });
});

describe("Tasks from a brain dump", () => {
  it("returns quick-add lines, passes list names, and counts a writing-help use", async () => {
    const { app, calls } = makeApp();
    const env = withKey();
    const auth = await signIn(app, env);
    const res = await app.request("/api/ai/extract-tasks", json({ text: "call mom tomorrow and buy milk", lists: ["Home", "Work"] }, auth), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ lines: ["call mom tomorrow", "buy milk"], usage: { used: 1, limit: WRITE_MONTHLY_LIMIT.free } });
    expect(calls.find((c) => c.kind === "extract")?.clientId).toBe("Home,Work");
    expect((await app.request("/api/ai/extract-tasks", json({ text: "FAIL" }, auth), env)).status).toBe(502);
    expect(await (await app.request("/api/ai/usage", { headers: auth }, env)).json()).toMatchObject({ writes: { used: 1 } });
    expect((await app.request("/api/ai/extract-tasks", json({ text: "  " }, auth), env)).status).toBe(400);
    expect((await app.request("/api/ai/extract-tasks", json({ text: "x".repeat(4001) }, auth), env)).status).toBe(413);
    expect((await app.request("/api/ai/extract-tasks", json({ text: "x" }, { Origin: EXT_ORIGIN }), env)).status).toBe(401);
  });
});
