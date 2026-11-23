// Personal access tokens, the read-only REST API (/api/v1/*) and the MCP server (/mcp).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/app";
import { htmlToText } from "../src/readApi";
import { cookieFrom, EXT_ORIGIN, json, makeApp, makeEnv } from "./helpers";

let env: Env;
let dispose: () => Promise<void>;
beforeAll(async () => ({ env, dispose } = await makeEnv()));
afterAll(async () => dispose());
beforeEach(async () => {
  await env.DB.batch(["api_tokens", "sessions", "users"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
});

const NOW = 1_800_000_000_000; // 2027-01-15T08:00:00Z
const TODAY = "2027-01-15";
const YESTERDAY = "2027-01-14";
const STAMP = "2026-12-01T10:00:00.000Z";
const LATER = "2026-12-02T10:00:00.000Z";
type App = ReturnType<typeof makeApp>["app"];

async function signIn(app: App, who = "a") {
  const res = await app.request("/api/auth/google", json({ kind: "extension", accessToken: `good:sub-${who}:${who}@example.com:${who}` }, { Origin: EXT_ORIGIN }), env);
  return { Authorization: `Bearer ${((await res.json()) as { token: string }).token}`, Origin: EXT_ORIGIN };
}

async function newToken(app: App, auth: Record<string, string>, name = "Claude Desktop") {
  const res = await app.request("/api/tokens", json({ name }, auth), env);
  expect(res.status).toBe(200);
  return (await res.json()) as { token: string; apiToken: { id: string; name: string; prefix: string; createdAt: number; lastUsedAt: number | null } };
}

const NOTE_HTML =
  `<h2>Goals</h2><p>Ship the <strong>pilot</strong> &amp; learn.</p>` +
  `<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked><span></span></label><div><p>Kickoff</p></div></li>` +
  `<li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Review</p></div></li></ul>` +
  `<p>See <a href="https://acme.example">Acme site</a></p><script>alert(1)</script>`;

/** A user's data, pushed the way devices push it (deleted items as tombstones). */
async function seed(app: App, auth: Record<string, string>) {
  const items = [
    { c: "lists", id: "l_work", v: { id: "l_work", kind: "list", name: "Work", createdAt: STAMP } },
    { c: "lists", id: "f_1", v: { id: "f_1", kind: "filter", name: "Urgent", query: {}, createdAt: STAMP } },
    { c: "todos", id: "t1", v: { id: "t1", title: "Send the plan", completed: false, dueDate: TODAY, dueTime: "15:00", priority: "high", listId: "l_work", labels: ["client"], createdAt: STAMP } },
    { c: "todos", id: "t2", v: { id: "t2", title: "Buy milk", completed: false, plannedFor: TODAY, block: { day: TODAY, start: "09:00" }, estimateMin: 45, subtasks: [{ id: "s", title: "Oat", completed: true }], createdAt: STAMP } },
    { c: "todos", id: "t3", v: { id: "t3", title: "File taxes", completed: false, dueDate: YESTERDAY, repeat: { unit: "week", every: 1, weekdays: [1, 3] }, createdAt: STAMP } },
    { c: "todos", id: "t4", v: { id: "t4", title: "Old done", completed: true, completedAt: "2027-01-10T09:00:00.000Z", createdAt: STAMP } },
    { c: "todos", id: "t5", v: { id: "t5", title: "Deleted task", completed: false, createdAt: STAMP } },
    { c: "todos", id: "t6", v: { id: "t6", title: "Someday", completed: false, createdAt: STAMP } },
    { c: "notes", id: "n1", v: { id: "n1", title: "Acme pilot", content: NOTE_HTML, pinned: true, createdAt: STAMP, updatedAt: STAMP } },
    { c: "notes", id: "n2", v: { id: "n2", title: "Groceries", content: "eggs, milk", createdAt: STAMP, updatedAt: LATER } },
    { c: "notes", id: "n3", v: { id: "n3", title: "Meeting template", content: "<p>Agenda pilot</p>", template: true, createdAt: STAMP, updatedAt: STAMP } },
    { c: "notes", id: "n4", v: { id: "n4", title: "Secret pilot", content: "gone", createdAt: STAMP, updatedAt: STAMP } },
    {
      c: "meetings",
      id: "m1",
      v: {
        id: "m1", platform: "meet", title: "Acme pilot review", startedAt: "2027-01-12T15:00:00.000Z", durationSec: 1800, status: "ready", updatedAt: STAMP,
        transcript: [{ id: "e1", speaker: "Priya", text: "Let's start the pilot Monday.", startMs: 4000, endMs: 6000 }, { id: "e2", speaker: "You", text: "Agreed.", startMs: 65000, endMs: 66000 }],
        summary: { title: "Acme", overview: "Agreed on a two-week pilot.", keyPoints: ["Budget approved"], decisions: ["Pilot starts Monday"], actionItems: [{ task: "Send the plan", owner: "Priya", dueDate: "2027-01-18", priority: "high" }, { task: "Book room", owner: null, dueDate: null, priority: "low" }], openQuestions: ["Who signs?"], customSections: [{ heading: "Budget", points: ["$20k"] }], model: "m", generatedAt: STAMP },
        doneActions: ["Book room"], userNotes: "Call legal first",
      },
    },
    { c: "meetings", id: "m2", v: { id: "m2", platform: "zoom", title: "Old sync", startedAt: "2026-12-20T10:00:00.000Z", durationSec: 600, status: "ready", transcript: [], summary: null, updatedAt: STAMP } },
    { c: "habits", id: "h1", v: { id: "h1", name: "Read", emoji: "📚", color: "#000", completedDays: [TODAY, YESTERDAY, "2027-01-13"], createdAt: "2026-01-01T00:00:00.000Z", archived: false } },
    { c: "habits", id: "h2", v: { id: "h2", name: "Water", emoji: "💧", color: "#000", kind: "count", target: 8, unit: "glasses", log: { [TODAY]: 3 }, completedDays: [], createdAt: "2026-01-01T00:00:00.000Z", archived: false } },
    { c: "habits", id: "h3", v: { id: "h3", name: "Old habit", emoji: "", color: "#000", completedDays: [], createdAt: "2026-01-01T00:00:00.000Z", archived: true } },
    { c: "days", id: TODAY, v: { id: TODAY, focus: "Ship the pilot", brief: { headline: "x" }, createdAt: STAMP } },
  ];
  const push = (changes: unknown[]) => app.request("/api/sync", json({ deviceId: "device-0001", since: 0, changes }, auth), env);
  expect((await push(items.map((i) => ({ ...i, u: STAMP })))).status).toBe(200);
  expect((await push([{ c: "todos", id: "t5", u: LATER, d: true }, { c: "notes", id: "n4", u: LATER, d: true }])).status).toBe(200);
}

const get = (app: App, path: string, token: string) => app.request(path, { headers: { Authorization: `Bearer ${token}` } }, env);

describe("personal access tokens", () => {
  it("creates a token shown once, lists it without the secret, and revokes it", async () => {
    const { app } = makeApp();
    const auth = await signIn(app);
    const { token, apiToken } = await newToken(app, auth, "  Claude\nDesktop  ");
    expect(token).toMatch(/^plt_[A-Za-z0-9_-]{43}$/);
    expect(apiToken).toMatchObject({ name: "Claude Desktop", prefix: token.slice(0, 8), createdAt: NOW, lastUsedAt: null });
    const rows = await env.DB.prepare("SELECT token_hash FROM api_tokens").all<{ token_hash: string }>();
    expect(rows.results[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows.results)).not.toContain(token);

    const list = (await (await app.request("/api/tokens", { headers: auth }, env)).json()) as { tokens: Record<string, unknown>[]; max: number };
    expect(list.max).toBe(10);
    expect(list.tokens).toEqual([apiToken]);
    expect(JSON.stringify(list)).not.toContain(token.slice(8));

    expect((await get(app, "/api/v1/todos", token)).status).toBe(200);
    expect((await app.request(`/api/tokens/${apiToken.id}`, { method: "DELETE", headers: auth }, env)).status).toBe(200);
    expect((await app.request(`/api/tokens/${apiToken.id}`, { method: "DELETE", headers: auth }, env)).status).toBe(404);
    expect((await get(app, "/api/v1/todos", token)).status).toBe(401);
  });

  it("needs a name, allows 10, and only the owner can revoke", async () => {
    const { app } = makeApp();
    const auth = await signIn(app);
    expect((await app.request("/api/tokens", json({ name: "   " }, auth), env)).status).toBe(400);
    expect((await app.request("/api/tokens", json({}, auth), env)).status).toBe(400);
    expect((await app.request("/api/tokens", json({ name: "x" }), env)).status).toBe(401);
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push((await newToken(app, auth, `key ${i}`)).apiToken.id);
    const res = await app.request("/api/tokens", json({ name: "eleven" }, auth), env);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("too_many_tokens");
    const other = await signIn(app, "b");
    expect((await app.request(`/api/tokens/${ids[0]}`, { method: "DELETE", headers: other }, env)).status).toBe(404);
    expect(((await (await app.request("/api/tokens", { headers: other }, env)).json()) as { tokens: unknown[] }).tokens).toEqual([]);
  });

  it("never works on the rest of the API", async () => {
    const { app } = makeApp();
    const auth = await signIn(app);
    const { token } = await newToken(app, auth);
    const bearer = { Authorization: `Bearer ${token}`, Origin: EXT_ORIGIN };
    for (const [path, init] of [
      ["/api/me", { headers: bearer }],
      ["/api/tokens", { headers: bearer }],
      ["/api/tokens", json({ name: "escalate" }, bearer)],
      ["/api/sync", json({ deviceId: "device-0001", since: 0 }, bearer)],
      ["/api/sync/usage", { headers: bearer }],
      ["/api/account/export", { headers: bearer }],
      ["/api/billing", { headers: bearer }],
      ["/api/shares", { headers: bearer }],
      ["/api/ai/usage", { headers: bearer }],
    ] as [string, RequestInit][]) {
      expect((await app.request(path, init, env)).status, path).toBe(401);
    }
  });

  it("is the only thing that works on /api/v1 and /mcp (not sessions or cookies)", async () => {
    const { app } = makeApp();
    const auth = await signIn(app);
    const session = await app.request("/api/v1/todos", { headers: auth }, env);
    expect(session.status).toBe(401);
    expect(((await session.json()) as { error: string }).error).toBe("token_required");
    expect((await app.request("/mcp", json({ jsonrpc: "2.0", id: 1, method: "tools/list" }, auth), env)).status).toBe(401);
    const web = await app.request("/api/auth/google", json({ kind: "web", idToken: "good:sub-a:a@example.com" }, { Origin: "https://app.prodli.com" }), env);
    const cookie = cookieFrom(web);
    expect(cookie).toContain("__Host-prodli_session=");
    expect((await app.request("/api/v1/todos", { headers: { Cookie: cookie } }, env)).status).toBe(401);
    const none = await app.request("/api/v1/todos", {}, env);
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toContain("Bearer");
    expect((await get(app, "/api/v1/todos", "plt_not-a-real-token")).status).toBe(401);
  });

  it("records last use at most once an hour", async () => {
    const clock = { now: NOW };
    const { app } = makeApp(clock);
    const auth = await signIn(app);
    const { token, apiToken } = await newToken(app, auth);
    const lastUsed = async () => (await env.DB.prepare("SELECT last_used_at FROM api_tokens WHERE id = ?").bind(apiToken.id).first<number | null>("last_used_at")) ?? null;
    await get(app, "/api/v1/habits", token);
    expect(await lastUsed()).toBe(NOW);
    clock.now = NOW + 30 * 60_000;
    await get(app, "/api/v1/habits", token);
    expect(await lastUsed()).toBe(NOW);
    clock.now = NOW + 61 * 60_000;
    await get(app, "/api/v1/habits", token);
    expect(await lastUsed()).toBe(NOW + 61 * 60_000);
  });

  it("is rate limited per token", async () => {
    const { app } = makeApp();
    const keys: string[] = [];
    const limited = { ...env, SYNC_LIMITER: { limit: async ({ key }: { key: string }) => (keys.push(key), { success: !key.startsWith("api:") }) } } as unknown as Env;
    const auth = await signIn(app);
    const { token, apiToken } = await newToken(app, auth);
    const res = await app.request("/api/v1/todos", { headers: { Authorization: `Bearer ${token}` } }, limited);
    expect(res.status).toBe(429);
    expect(keys).toContain(`api:${apiToken.id}`);
  });

  it("goes away with the account, and with sign out everywhere", async () => {
    const { app } = makeApp();
    let auth = await signIn(app);
    const first = await newToken(app, auth);
    expect((await app.request("/api/auth/logout-all", { method: "POST", headers: auth }, env)).status).toBe(200);
    expect((await get(app, "/api/v1/todos", first.token)).status).toBe(401);
    auth = await signIn(app);
    const second = await newToken(app, auth);
    const del = await app.request("/api/account", { method: "DELETE", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ confirmEmail: "a@example.com" }) }, env);
    expect(del.status).toBe(200);
    expect((await get(app, "/api/v1/todos", second.token)).status).toBe(401);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM api_tokens").first("n")).toBe(0);
  });
});

describe("REST read API", () => {
  async function setup() {
    const { app } = makeApp();
    const auth = await signIn(app);
    await seed(app, auth);
    const { token } = await newToken(app, auth);
    const read = async <T>(path: string) => {
      const res = await get(app, path, token);
      return { status: res.status, body: (await res.json()) as T };
    };
    return { app, auth, token, read };
  }
  type Todos = { todos: { id: string; title: string; list: string | null; repeats: string | null; subtasks: unknown[] }[]; total: number };

  it("lists open to-dos soonest first, skipping deleted ones", async () => {
    const { read } = await setup();
    const { status, body } = await read<Todos>("/api/v1/todos");
    expect(status).toBe(200);
    expect(body.todos.map((t) => t.id)).toEqual(["t3", "t1", "t2", "t6"]);
    expect(body.todos[0]).toMatchObject({ id: "t3", repeats: "weekly on Mon, Wed" });
    expect(body.todos[1]).toMatchObject({ id: "t1", list: "Work", labels: ["client"], priority: "high", dueTime: "15:00" });
    expect(body.todos.find((t) => t.id === "t5")).toBeUndefined();
    expect(body.todos.find((t) => t.id === "t4")).toBeUndefined();
    expect(body.total).toBe(4);
  });

  it("filters to-dos by status, list, inbox and label", async () => {
    const { read } = await setup();
    expect((await read<Todos>("/api/v1/todos?status=done")).body.todos.map((t) => t.id)).toEqual(["t4"]);
    expect((await read<Todos>("/api/v1/todos?status=all")).body.total).toBe(5);
    expect((await read<Todos>("/api/v1/todos?list=work")).body.todos.map((t) => t.id)).toEqual(["t1"]);
    expect((await read<Todos>("/api/v1/todos?list=l_work")).body.todos.map((t) => t.id)).toEqual(["t1"]);
    expect((await read<Todos>("/api/v1/todos?list=inbox")).body.todos.map((t) => t.id).sort()).toEqual(["t2", "t3", "t6"]);
    expect((await read<Todos>("/api/v1/todos?label=@client")).body.todos.map((t) => t.id)).toEqual(["t1"]);
    expect((await read<Todos>("/api/v1/todos?limit=1")).body).toMatchObject({ total: 4, todos: [{ id: "t3" }] });
    const unknown = await read<{ error: string; message: string }>("/api/v1/todos?list=Nope");
    expect(unknown.status).toBe(400);
    expect(unknown.body.message).toContain("Work");
    expect((await read("/api/v1/todos?status=maybe")).status).toBe(400);
    expect((await read("/api/v1/todos?limit=0")).status).toBe(400);
  });

  it("searches notes as plain text, without templates or deleted notes", async () => {
    const { read } = await setup();
    const all = await read<{ notes: { id: string; title: string; excerpt: string }[] }>("/api/v1/notes");
    expect(all.body.notes.map((n) => n.id)).toEqual(["n1", "n2"]); // pinned first
    expect(all.body.notes[0].excerpt).not.toContain("<");
    const pilot = await read<{ notes: { id: string }[]; total: number }>("/api/v1/notes?q=PILOT");
    expect(pilot.body.notes.map((n) => n.id)).toEqual(["n1"]);
    expect((await read<{ total: number }>("/api/v1/notes?q=eggs%20milk")).body.total).toBe(1);
    expect((await read<{ total: number }>("/api/v1/notes?q=eggs%20bread")).body.total).toBe(0);
    expect((await read<{ total: number }>("/api/v1/notes?q=agenda")).body.total).toBe(0);
  });

  it("returns one note as Markdown-ish text", async () => {
    const { read } = await setup();
    const { status, body } = await read<{ note: { title: string; text: string; pinned: boolean } }>("/api/v1/notes/n1");
    expect(status).toBe(200);
    expect(body.note.title).toBe("Acme pilot");
    expect(body.note.text).toBe("## Goals\n\nShip the pilot & learn.\n\n- [x] Kickoff\n- [ ] Review\n\nSee Acme site (https://acme.example)");
    expect((await read("/api/v1/notes/n4")).status).toBe(404);
    expect((await read("/api/v1/notes/n3")).status).toBe(404);
    expect((await read("/api/v1/notes/nope")).status).toBe(404);
  });

  it("lists meetings with their summaries, and one meeting with its transcript", async () => {
    const { read } = await setup();
    type M = { id: string; title: string; durationSec: number; summary: { decisions: string[]; actionItems: { task: string; done: boolean }[] } | null; transcript?: unknown[]; yourNotes?: string };
    const list = await read<{ meetings: M[]; total: number }>("/api/v1/meetings");
    expect(list.body.meetings.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(list.body.meetings[0]).toMatchObject({ title: "Acme pilot review", durationSec: 1800, summary: { decisions: ["Pilot starts Monday"] } });
    expect(list.body.meetings[0].summary!.actionItems).toEqual([{ task: "Send the plan", owner: "Priya", dueDate: "2027-01-18", done: false }, { task: "Book room", owner: null, dueDate: null, done: true }]);
    expect(JSON.stringify(list.body)).not.toContain("Let's start the pilot");
    expect((await read<{ meetings: M[] }>("/api/v1/meetings?since=2027-01-01")).body.meetings.map((m) => m.id)).toEqual(["m1"]);
    expect((await read("/api/v1/meetings?since=last-week")).status).toBe(400);

    const one = await read<{ meeting: M }>("/api/v1/meetings/m1");
    expect(one.body.meeting.yourNotes).toBe("Call legal first");
    expect(one.body.meeting.transcript).toBeUndefined();
    const full = await read<{ meeting: M }>("/api/v1/meetings/m1?transcript=1");
    expect(full.body.meeting.transcript).toEqual([{ at: "00:04", speaker: "Priya", text: "Let's start the pilot Monday." }, { at: "01:05", speaker: "You", text: "Agreed." }]);
    expect((await read("/api/v1/meetings/zzz")).status).toBe(404);
  });

  it("lists habits with today's state and streaks", async () => {
    const { read } = await setup();
    type H = { id: string; today: { done: boolean; amount: number | null }; streak: number; last7: { date: string; done: boolean | null }[] };
    const { body } = await read<{ date: string; habits: H[] }>("/api/v1/habits");
    expect(body.date).toBe(TODAY);
    expect(body.habits.map((h) => h.id)).toEqual(["h1", "h2"]);
    expect(body.habits[0]).toMatchObject({ today: { done: true, amount: null }, streak: 3 });
    expect(body.habits[0].last7.map((d) => d.done)).toEqual([false, false, false, false, true, true, true]);
    expect(body.habits[1]).toMatchObject({ kind: "count", target: 8, unit: "glasses", today: { done: false, amount: 3 }, streak: 0 });
    expect((await read<{ habits: H[] }>("/api/v1/habits?archived=1")).body.habits).toHaveLength(3);
    // In Honolulu it's still the 14th: today isn't done yet, the streak runs to yesterday.
    const hnl = await read<{ date: string; habits: H[] }>("/api/v1/habits?tz=Pacific/Honolulu");
    expect(hnl.body.date).toBe(YESTERDAY);
    expect(hnl.body.habits[0].streak).toBe(2);
    expect((await read("/api/v1/habits?tz=Mars/Olympus")).status).toBe(400);
  });

  it("shows today's plan", async () => {
    const { read } = await setup();
    type T = { date: string; focus: string | null; timeBlocks: unknown[]; todos: { id: string; why: string }[]; habits: { name: string; done: boolean }[] };
    const { body } = await read<T>("/api/v1/today");
    expect(body.date).toBe(TODAY);
    expect(body.focus).toBe("Ship the pilot");
    expect(body.timeBlocks).toEqual([{ start: "09:00", end: "09:45", title: "Buy milk", todoId: "t2" }]);
    expect(body.todos.map((t) => [t.id, t.why])).toEqual([["t2", "planned"], ["t1", "due"], ["t3", "overdue"]]);
    expect(body.habits).toEqual([{ name: "Read", emoji: "📚", done: true, streak: 3 }, { name: "Water", emoji: "💧", done: false, streak: 0 }]);
    const tomorrow = await read<T>("/api/v1/today?date=2027-01-16");
    expect(tomorrow.body.focus).toBeNull();
    expect(tomorrow.body.todos.map((t) => t.why)).toEqual(["overdue", "overdue"]);
  });

  it("only ever shows the token owner's data", async () => {
    const { app, read } = await setup();
    const other = await signIn(app, "b");
    const { token } = await newToken(app, other);
    expect(((await (await get(app, "/api/v1/todos?status=all", token)).json()) as Todos).total).toBe(0);
    expect((await get(app, "/api/v1/notes/n1", token)).status).toBe(404);
    expect((await get(app, "/api/v1/meetings/m1", token)).status).toBe(404);
    expect((await read<Todos>("/api/v1/todos")).body.total).toBe(4);
  });
});

describe("MCP server", () => {
  async function setup() {
    const { app } = makeApp();
    const auth = await signIn(app);
    await seed(app, auth);
    const { token } = await newToken(app, auth);
    const post = (body: unknown, headers: Record<string, string> = {}, path = "/mcp") =>
      app.request(path, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}`, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }, env);
    const rpc = async (method: string, params?: unknown, headers: Record<string, string> = {}) => {
      const res = await post({ jsonrpc: "2.0", id: 7, method, ...(params === undefined ? {} : { params }) }, headers);
      return { status: res.status, body: (await res.json()) as { id: number; result?: Record<string, unknown>; error?: { code: number; message: string; data?: unknown } } };
    };
    const call = async (name: string, args?: Record<string, unknown>) => {
      const { body } = await rpc("tools/call", { name, ...(args ? { arguments: args } : {}) });
      return body.result as { content: { type: string; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
    };
    return { app, token, post, rpc, call };
  }

  it("initializes, takes the initialized notification and lists read-only tools", async () => {
    const { rpc, post } = await setup();
    const init = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.status).toBe(200);
    expect(init.body).toMatchObject({ jsonrpc: "2.0", id: 7, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "prodli" } } });
    expect(typeof init.body.result!.instructions).toBe("string");
    expect((await rpc("initialize", { protocolVersion: "1999-01-01" })).body.result!.protocolVersion).toBe("2025-06-18");
    const note = await post({ jsonrpc: "2.0", method: "notifications/initialized" }, { "MCP-Protocol-Version": "2025-06-18" });
    expect(note.status).toBe(202);
    expect(await note.text()).toBe("");
    expect((await rpc("ping")).body.result).toEqual({});

    const list = await rpc("tools/list", {}, { "MCP-Protocol-Version": "2025-06-18" });
    const tools = list.body.result!.tools as { name: string; description: string; inputSchema: { type: string }; annotations: { readOnlyHint: boolean } }[];
    expect(tools.map((t) => t.name)).toEqual(["list_todos", "search_notes", "get_note", "list_meetings", "get_meeting", "get_today", "list_habits"]);
    for (const t of tools) {
      expect(t.inputSchema.type).toBe("object");
      expect(t.annotations.readOnlyHint).toBe(true);
      expect(t.description.length).toBeGreaterThan(20);
    }
  });

  it("calls every tool", async () => {
    const { call } = await setup();
    const todos = await call("list_todos");
    expect(todos.content[0].type).toBe("text");
    expect(todos.content[0].text).toContain("4 open to-dos:");
    expect(todos.content[0].text).toContain("- [ ] Send the plan (due 2027-01-15 15:00, high priority, list: Work, @client)");
    expect(todos.structuredContent).toMatchObject({ total: 4 });
    expect((await call("list_todos", { status: "done" })).content[0].text).toContain("[x] Old done");

    const notes = await call("search_notes", { query: "pilot" });
    expect(notes.content[0].text).toContain('1 note matching "pilot"');
    expect(notes.content[0].text).toContain("[id: n1]");
    const note = await call("get_note", { id: "n1" });
    expect(note.content[0].text).toContain("# Acme pilot");
    expect(note.content[0].text).toContain("- [x] Kickoff");
    expect(note.structuredContent).toMatchObject({ note: { id: "n1" } });

    const meetings = await call("list_meetings", { since: "2027-01-01" });
    expect(meetings.content[0].text).toContain("Acme pilot review (30 min) [id: m1]");
    expect(meetings.content[0].text).toContain("Decisions: Pilot starts Monday");
    const meeting = await call("get_meeting", { id: "m1" });
    expect(meeting.content[0].text).toContain("## Action items\n- Send the plan (Priya, due 2027-01-18)\n- [x] Book room");
    expect(meeting.content[0].text).toContain("## Your notes\nCall legal first");
    expect(meeting.content[0].text).not.toContain("Transcript");
    const withTranscript = await call("get_meeting", { id: "m1", transcript: true });
    expect(withTranscript.content[0].text).toContain("## Transcript\n[00:04] Priya: Let's start the pilot Monday.\n[01:05] You: Agreed.");

    const today = await call("get_today", { timezone: "UTC" });
    expect(today.content[0].text).toContain("Plan for 2027-01-15 (UTC)\nFocus: Ship the pilot");
    expect(today.content[0].text).toContain("- 09:00–09:45 Buy milk");
    expect(today.content[0].text).toContain("File taxes (due 2027-01-14, repeats weekly on Mon, Wed) — overdue");
    expect(today.structuredContent).toMatchObject({ date: TODAY, focus: "Ship the pilot" });

    const habits = await call("list_habits");
    expect(habits.content[0].text).toContain("📚 Read: done, streak 3, last 7 days ✗✗✗✗✓✓✓");
    expect(habits.content[0].text).toContain("💧 Water: not done yet 3/8 glasses");
  });

  it("reports missing items and bad arguments as tool errors", async () => {
    const { call } = await setup();
    const missing = await call("get_note", { id: "n4" });
    expect(missing.isError).toBe(true);
    expect(missing.content[0].text).toContain("No note");
    const bad = await call("list_meetings", { since: "yesterday" });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toContain("YYYY-MM-DD");
    expect((await call("get_note")).isError).toBe(true);
    expect((await call("list_todos", { colour: "red" })).isError).toBe(true);
    expect((await call("list_todos", { list: "Nope" })).content[0].text).toContain("Lists: Work");
  });

  it("returns JSON-RPC errors for unknown methods and tools, bad params and bad JSON", async () => {
    const { rpc, post } = await setup();
    expect((await rpc("resources/list")).body.error).toMatchObject({ code: -32601 });
    expect((await rpc("tools/call", { name: "delete_everything" })).body.error).toMatchObject({ code: -32602, message: "Unknown tool: delete_everything" });
    expect((await rpc("tools/call", { name: "list_todos", arguments: "all" })).body.error).toMatchObject({ code: -32602 });
    expect((await rpc("tools/call", {})).body.error).toMatchObject({ code: -32602 });
    expect((await rpc("tools/list", [1, 2])).body.error).toMatchObject({ code: -32602 });
    const parse = await post("{not json");
    expect(parse.status).toBe(400);
    expect(((await parse.json()) as { error: { code: number } }).error.code).toBe(-32700);
    const invalid = await post({ id: 1, method: "ping" });
    expect(invalid.status).toBe(400);
    expect(((await invalid.json()) as { error: { code: number } }).error.code).toBe(-32600);
    const oldHeader = await rpc("tools/list", {}, { "MCP-Protocol-Version": "1999-01-01" });
    expect(oldHeader.status).toBe(400);
    const batch = await post([{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 2, method: "tools/list" }]);
    const replies = (await batch.json()) as { id: number }[];
    expect(replies.map((r) => r.id)).toEqual([1, 2]);
  });

  it("speaks the 2026-07-28 protocol too (no handshake, headers mirror the body)", async () => {
    const { post } = await setup();
    const meta = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientInfo": { name: "t", version: "1" }, "io.modelcontextprotocol/clientCapabilities": {} };
    const headers = (method: string, name?: string) => ({ "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": method, ...(name ? { "Mcp-Name": name } : {}) });
    const discover = await post({ jsonrpc: "2.0", id: 1, method: "server/discover", params: { _meta: meta } }, headers("server/discover"));
    expect(discover.status).toBe(200);
    expect(await discover.json()).toMatchObject({ result: { resultType: "complete", supportedVersions: expect.arrayContaining(["2026-07-28", "2025-06-18"]), capabilities: { tools: {} } } });
    const called = await post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_today", arguments: {}, _meta: meta } }, headers("tools/call", "get_today"));
    expect(await called.json()).toMatchObject({ result: { resultType: "complete", content: [{ type: "text" }] } });
    const encoded = await post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_habits", _meta: meta } }, headers("tools/call", `=?base64?${btoa("list_habits")}?=`));
    expect(encoded.status).toBe(200);

    const mismatch = await post({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_today", _meta: meta } }, headers("tools/call", "list_todos"));
    expect(mismatch.status).toBe(400);
    expect(((await mismatch.json()) as { error: { code: number } }).error.code).toBe(-32020);
    const noHeaders = await post({ jsonrpc: "2.0", id: 5, method: "tools/list", params: { _meta: meta } });
    expect(noHeaders.status).toBe(400);
    const future = { ...meta, "io.modelcontextprotocol/protocolVersion": "2099-01-01" };
    const unsupported = await post({ jsonrpc: "2.0", id: 6, method: "tools/list", params: { _meta: future } }, { ...headers("tools/list"), "MCP-Protocol-Version": "2099-01-01" });
    expect(unsupported.status).toBe(400);
    expect(await unsupported.json()).toMatchObject({ error: { code: -32022, data: { requested: "2099-01-01" } } });
    const unknown = await post({ jsonrpc: "2.0", id: 7, method: "prompts/list", params: { _meta: meta } }, headers("prompts/list"));
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as { error: { code: number } }).error.code).toBe(-32601);
  });

  it("takes the token in the URL, refuses requests without one, and answers GET with 405", async () => {
    const { app, token } = await setup();
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const viaPath = await app.request(`/mcp/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body }, env);
    expect(viaPath.status).toBe(200);
    expect(((await viaPath.json()) as { result: { tools: unknown[] } }).result.tools).toHaveLength(7);
    expect((await app.request("/mcp/plt_wrong", { method: "POST", headers: { "Content-Type": "application/json" }, body }, env)).status).toBe(401);
    const none = await app.request("/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body }, env);
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toContain("Bearer");
    const getRes = await app.request("/mcp", {}, env);
    expect(getRes.status).toBe(405);
    expect(getRes.headers.get("allow")).toBe("POST");
    expect((await app.request(`/mcp/${token}`, { method: "DELETE" }, env)).status).toBe(405);
    const foreign = await app.request("/mcp", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, Origin: "https://evil.example" }, body }, env);
    expect(foreign.status).toBe(403);
    expect((await app.request("/.well-known/oauth-protected-resource/mcp", {}, env)).status).toBe(404);
  });
});

describe("htmlToText", () => {
  it("handles plain text, entities, tables and headings", () => {
    expect(htmlToText("just text & more")).toBe("just text & more");
    expect(htmlToText("<p>a&nbsp;b &lt;tag&gt; &#128512;</p>")).toBe("a b <tag> 😀");
    expect(htmlToText("<table><tbody><tr><th><p>Name</p></th><th><p>Qty</p></th></tr><tr><td><p>Eggs</p></td><td><p>12</p></td></tr></tbody></table>")).toBe("| Name | Qty |\n| Eggs | 12 |");
    expect(htmlToText("<h1>Title</h1><ol><li><p>One</p></li><li><p>Two</p></li></ol><hr><p>End<br>line</p>")).toBe("# Title\n\n- One\n- Two\n\n---\n\nEnd\nline");
  });
});
