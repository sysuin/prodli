import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/app";
import { EXT_ORIGIN, json, makeApp, makeEnv } from "./helpers";

let base: Env;
let dispose: () => Promise<void>;
beforeAll(async () => ({ env: base, dispose } = await makeEnv()));
afterAll(async () => dispose());
beforeEach(async () => {
  await base.DB.batch(["shares", "ai_usage", "brief_usage", "sessions", "users"].map((t) => base.DB.prepare(`DELETE FROM ${t}`)));
});

const NOW = 1_800_000_000_000;
/** Pro on sale on this server (so Pro-only features are gated). */
const selling = () => ({ ...base, ANTHROPIC_API_KEY: "sk-test", DODO_ENV: "test", DODO_PRODUCT_MONTHLY: "pdt_m", DODO_WEBHOOK_SECRET: "whsec_x", DODO_API_KEY: "k" }) as Env;
const notSelling = () => ({ ...base, ANTHROPIC_API_KEY: "sk-test" }) as Env;

async function signIn(app: ReturnType<typeof makeApp>["app"], env: Env, who = "a") {
  const res = await app.request("/api/auth/google", json({ kind: "extension", accessToken: `good:sub-${who}:${who}@example.com:${who}` }, { Origin: EXT_ORIGIN }), env);
  return { Authorization: `Bearer ${((await res.json()) as { token: string }).token}`, Origin: EXT_ORIGIN };
}
const share = (extra: Record<string, unknown> = {}) => ({
  meetingId: "mtg_1",
  title: "Acme pilot review",
  date: "2026-11-20",
  durationSec: 1800,
  expiresDays: 30,
  summary: { overview: "Agreed on a two-week pilot.", keyPoints: ["Budget is approved"], decisions: ["Pilot starts Monday"], actionItems: [{ task: "Send the plan", owner: "Priya", dueDate: "2026-11-24" }], openQuestions: ["Who signs?"], customSections: [{ heading: "Budget", points: ["$20k approved"] }] },
  ...extra,
});

describe("shared meeting notes", () => {
  it("creates a link anyone can open, with the summary only", async () => {
    const { app } = makeApp();
    const env = notSelling();
    const auth = await signIn(app, env);
    const res = await app.request("/api/shares", json(share(), auth), env);
    expect(res.status).toBe(200);
    const { share: s } = (await res.json()) as { share: { id: string; url: string; expiresAt: number } };
    expect(s.url).toMatch(/\/s\/[A-Za-z0-9_-]{20,}$/);
    expect(s.expiresAt).toBe(NOW + 30 * 86_400_000);
    const page = await app.request(`/s/${s.id}`, {}, env);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(page.headers.get("x-robots-tag")).toContain("noindex");
    const html = await page.text();
    for (const text of ["Acme pilot review", "Agreed on a two-week pilot.", "Pilot starts Monday", "Send the plan", "Priya", "Budget", "$20k approved", "Who signs?"]) expect(html).toContain(text);
    expect(html).not.toContain("<script");
  });

  it("escapes what it shows", async () => {
    const { app } = makeApp();
    const env = notSelling();
    const auth = await signIn(app, env);
    const res = await app.request("/api/shares", json(share({ title: `<img src=x onerror="alert(1)">` })), env);
    expect(res.status).toBe(401); // needs an account
    const ok = (await (await app.request("/api/shares", json(share({ title: `<img src=x onerror="alert(1)">` }), auth), env)).json()) as { share: { id: string } };
    const html = await (await app.request(`/s/${ok.share.id}`, {}, env)).text();
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("keeps one link per meeting: sharing again updates it", async () => {
    const { app } = makeApp();
    const env = notSelling();
    const auth = await signIn(app, env);
    const a = (await (await app.request("/api/shares", json(share(), auth), env)).json()) as { share: { id: string } };
    const b = (await (await app.request("/api/shares", json(share({ title: "Renamed", expiresDays: 7 }), auth), env)).json()) as { share: { id: string; title: string; expiresAt: number } };
    expect(b.share.id).toBe(a.share.id);
    expect(b.share.title).toBe("Renamed");
    expect(b.share.expiresAt).toBe(NOW + 7 * 86_400_000);
    const list = (await (await app.request("/api/shares", { headers: auth }, env)).json()) as { shares: { id: string; views: number }[] };
    expect(list.shares.map((s) => s.id)).toEqual([a.share.id]);
  });

  it("counts views, stops when the user stops sharing, and expires", async () => {
    const clock = { now: NOW };
    const { app } = makeApp(clock);
    const env = notSelling();
    const auth = await signIn(app, env);
    const { share: s } = (await (await app.request("/api/shares", json(share({ expiresDays: 7 }), auth), env)).json()) as { share: { id: string } };
    await app.request(`/s/${s.id}`, {}, env);
    await app.request(`/s/${s.id}`, {}, env);
    const list = (await (await app.request("/api/shares", { headers: auth }, env)).json()) as { shares: { views: number }[] };
    expect(list.shares[0].views).toBe(2);
    clock.now = NOW + 8 * 86_400_000;
    expect((await app.request(`/s/${s.id}`, {}, env)).status).toBe(404);
    clock.now = NOW;
    const other = await signIn(app, env, "b");
    expect((await app.request(`/api/shares/${s.id}`, { method: "DELETE", headers: other }, env)).status).toBe(404); // not theirs
    expect((await app.request(`/api/shares/${s.id}`, { method: "DELETE", headers: auth }, env)).status).toBe(200);
    expect((await app.request(`/s/${s.id}`, {}, env)).status).toBe(404);
    expect(await (await app.request(`/s/${s.id}`, {}, env)).text()).toContain("isn't available");
  });

  it("links that never expire are Pro once Pro is on sale (open to everyone before)", async () => {
    const { app } = makeApp();
    const early = notSelling();
    const auth = await signIn(app, early);
    expect((await app.request("/api/shares", json(share({ expiresDays: null }), auth), early)).status).toBe(200);
    const sale = selling();
    const res = await app.request("/api/shares", json(share({ meetingId: "mtg_2", expiresDays: null }), auth), sale);
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: "pro_required" });
    expect((await app.request("/api/shares", json(share({ meetingId: "mtg_2", expiresDays: 30 }), auth), sale)).status).toBe(200);
    const billing = (await (await app.request("/api/billing", { headers: auth }, early)).json()) as { earlyAccess: boolean };
    expect(billing.earlyAccess).toBe(true);
  });

  it("rejects bad input and deletes links with the account", async () => {
    const { app } = makeApp();
    const env = notSelling();
    const auth = await signIn(app, env);
    expect((await app.request("/api/shares", json(share({ expiresDays: 365 }), auth), env)).status).toBe(400);
    expect((await app.request("/api/shares", json(share({ summary: { overview: "x".repeat(70_000) } }), auth), env)).status).toBe(413);
    expect((await app.request("/s/not-a-real-id", {}, env)).status).toBe(404);
    const { share: s } = (await (await app.request("/api/shares", json(share(), auth), env)).json()) as { share: { id: string } };
    expect((await app.request("/api/account", { method: "DELETE", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ confirmEmail: "a@example.com" }) }, env)).status).toBeLessThan(300);
    expect((await app.request(`/s/${s.id}`, {}, env)).status).toBe(404);
  });
});

describe("your own meeting templates", () => {
  const meeting = { title: "Discovery", date: "2026-11-20", transcript: "[00:00] Ann: Our budget is 20k." };
  const custom = { name: "Sales discovery", instructions: "Focus on budget and timing.", sections: ["Budget", "Timeline", "Budget"] };

  it("sends the template and returns its sections (open to everyone before Pro is on sale)", async () => {
    const { app, calls } = makeApp();
    const env = notSelling();
    const auth = await signIn(app, env);
    const res = await app.request("/api/ai/summarize", json({ ...meeting, custom }, auth), env);
    expect(res.status).toBe(200);
    const { summary } = (await res.json()) as { summary: { customSections: { heading: string }[] } };
    expect(summary.customSections.map((c) => c.heading)).toEqual(["Budget", "Timeline"]); // duplicates dropped
    expect(calls).toContainEqual({ kind: "summarize-custom", clientId: "Sales discovery|Budget,Timeline" });
  });

  it("needs Pro once Pro is on sale, without using an allowance", async () => {
    const { app } = makeApp();
    const env = selling();
    const auth = await signIn(app, env);
    const res = await app.request("/api/ai/summarize", json({ ...meeting, custom }, auth), env);
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: "pro_required" });
    const usage = (await (await app.request("/api/ai/usage", { headers: auth }, env)).json()) as { used: number };
    expect(usage.used).toBe(0);
    expect((await app.request("/api/ai/summarize", json(meeting, auth), env)).status).toBe(200); // built-in types stay free
  });

  it("ignores an empty or malformed template", async () => {
    const { app, calls } = makeApp();
    const env = selling();
    const auth = await signIn(app, env);
    expect((await app.request("/api/ai/summarize", json({ ...meeting, custom: { name: "", sections: [] } }, auth), env)).status).toBe(200);
    expect((await app.request("/api/ai/summarize", json({ ...meeting, custom: "nope" }, auth), env)).status).toBe(200);
    expect(calls.some((c) => c.kind === "summarize-custom")).toBe(false);
  });
});

describe("AI meeting prep", () => {
  const input = { event: { title: "Acme pilot review", start: "14:00", date: "2026-11-20" }, history: [{ title: "Acme kickoff", date: "2026-11-13", overview: "Agreed on a two-week pilot.", decisions: ["Pilot starts Monday"], openItems: [{ task: "Send the plan", owner: "You" }], openQuestions: ["Who signs?"] }], relatedTasks: ["Call Priya"] };

  it("writes a prep brief from earlier meetings, counted with briefs", async () => {
    const { app, calls } = makeApp();
    const env = notSelling();
    const auth = await signIn(app, env);
    const res = await app.request("/api/ai/meeting-prep", json(input, auth), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ prep: { goal: "Move Acme pilot review forward", followUps: ["Send the plan"], questions: ["Who signs?"] }, usage: { used: 1 } });
    expect(calls).toContainEqual({ kind: "prep", clientId: "Acme pilot review" });
  });

  it("is Pro once Pro is on sale, validates input, and refunds failures", async () => {
    const { app } = makeApp();
    const sale = selling();
    const auth = await signIn(app, sale);
    expect((await app.request("/api/ai/meeting-prep", json(input, auth), sale)).status).toBe(402);
    const early = notSelling();
    expect((await app.request("/api/ai/meeting-prep", json({ ...input, history: [] }, auth), early)).status).toBe(400);
    expect((await app.request("/api/ai/meeting-prep", json({ ...input, event: { ...input.event, title: "FAIL" } }, auth), early)).status).toBe(502);
    const usage = (await (await app.request("/api/ai/usage", { headers: auth }, early)).json()) as { briefs: { used: number } };
    expect(usage.briefs.used).toBe(0);
  });
});
