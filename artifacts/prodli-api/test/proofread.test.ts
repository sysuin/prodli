// POST /api/ai/proofread: the writing check (underlines in notes and in text boxes on the web).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { monthKey } from "../src/ai";
import { locate, MAX_ISSUES_PER_PARAGRAPH, MAX_PROOFREAD_CHARS, placeIssues, PROOFREAD_MONTHLY_LIMIT } from "../src/proofread";
import type { Env } from "../src/app";
import { EXT_ORIGIN, json, makeApp, makeEnv } from "./helpers";

let base: Env;
let dispose: () => Promise<void>;
beforeAll(async () => ({ env: base, dispose } = await makeEnv()));
afterAll(async () => dispose());
beforeEach(async () => {
  await base.DB.batch(["proofread_usage", "write_usage", "sessions", "users"].map((t) => base.DB.prepare(`DELETE FROM ${t}`)));
});

const NOW = 1_800_000_000_000;
const withKey = () => ({ ...base, ANTHROPIC_API_KEY: "sk-test" }) as Env;
async function signIn(app: ReturnType<typeof makeApp>["app"], env: Env) {
  const res = await app.request("/api/auth/google", json({ kind: "extension", accessToken: "good:sub-p:p@example.com:p" }, { Origin: EXT_ORIGIN }), env);
  const body = (await res.json()) as { token: string; user: { id: string } };
  return { headers: { Authorization: `Bearer ${body.token}`, Origin: EXT_ORIGIN }, id: body.user.id };
}

describe("placing the model's suggestions", () => {
  it("finds the right occurrence, using the words before it", () => {
    const p = "I think its fine and its done.";
    expect(locate(p, "its", "", [])).toBe(8);
    expect(locate(p, "its", "fine and", [])).toBe(21);
    expect(locate(p, "its", "", [[8, 11]])).toBe(21);
    expect(locate(p, "missing", "", [])).toBe(-1);
    expect(locate(p, "", "", [])).toBe(-1);
  });

  it("drops what can't be placed, overlaps and no-op changes, and keeps paragraph order", () => {
    const paragraphs = ["Teh cat sat.", "We was late. We was tired."];
    const raw = [
      { paragraph: 1, original: "We was", before: "late.", replacement: "We were", type: "grammar" as const, explanation: "Agreement" },
      { paragraph: 1, original: "We was", before: "", replacement: "We were", type: "grammar" as const, explanation: "Agreement" },
      { paragraph: 0, original: "Teh", before: "", replacement: "The", type: "spelling" as const, explanation: "Spelling" },
      { paragraph: 0, original: "Teh cat", before: "", replacement: "The cat", type: "spelling" as const, explanation: "Overlaps" },
      { paragraph: 0, original: "dog", before: "", replacement: "cat", type: "word_choice" as const, explanation: "Not there" },
      { paragraph: 0, original: "sat", before: "", replacement: "sat", type: "grammar" as const, explanation: "Same" },
      { paragraph: 5, original: "x", before: "", replacement: "y", type: "grammar" as const, explanation: "No paragraph" },
    ];
    expect(placeIssues(paragraphs, raw).map((i) => [i.paragraph, i.start, i.end, i.replacement])).toEqual([
      [0, 0, 3, "The"],
      [1, 0, 6, "We were"],
      [1, 13, 19, "We were"],
    ]);
  });

  it("caps the suggestions per paragraph", () => {
    const p = Array.from({ length: 15 }, (_, i) => `w${i}`).join(" ");
    const raw = Array.from({ length: 15 }, (_, i) => ({ paragraph: 0, original: `w${i}`, before: "", replacement: `W${i}`, type: "spelling" as const, explanation: "x" }));
    expect(placeIssues([p], raw)).toHaveLength(MAX_ISSUES_PER_PARAGRAPH);
  });
});

describe("the writing check endpoint", () => {
  it("returns placed suggestions and counts one check per request", async () => {
    const { app, calls } = makeApp();
    const env = withKey();
    const { headers } = await signIn(app, env);
    const res = await app.request("/api/ai/proofread", json({ paragraphs: ["Fix teh typo.", "All good."], variant: "en-GB", level: "correct" }, headers), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ issues: [{ paragraph: 0, start: 4, end: 7, original: "teh", replacement: "the", type: "spelling", explanation: "Spelling" }], usage: { used: 1, limit: PROOFREAD_MONTHLY_LIMIT.free } });
    expect(calls.filter((c) => c.kind === "proofread").map((c) => c.clientId)).toEqual(["correct|en-GB|2"]);
    const usage = await (await app.request("/api/ai/usage", { headers }, env)).json();
    expect(usage).toMatchObject({ checks: { used: 1, limit: PROOFREAD_MONTHLY_LIMIT.free }, writes: { used: 0 } });
  });

  it("validates, refunds failures and stops at the allowance", async () => {
    const { app } = makeApp();
    const env = withKey();
    const { headers, id } = await signIn(app, env);
    expect((await app.request("/api/ai/proofread", json({ paragraphs: ["x"] }, { Origin: EXT_ORIGIN }), env)).status).toBe(401);
    expect((await app.request("/api/ai/proofread", json({}, headers), env)).status).toBe(400);
    expect((await app.request("/api/ai/proofread", json({ paragraphs: ["  "] }, headers), env)).status).toBe(400);
    expect((await app.request("/api/ai/proofread", json({ paragraphs: Array(9).fill("x") }, headers), env)).status).toBe(400);
    expect((await app.request("/api/ai/proofread", json({ paragraphs: ["x"], variant: "fr-FR" }, headers), env)).status).toBe(400);
    expect((await app.request("/api/ai/proofread", json({ paragraphs: ["a".repeat(2000), "b".repeat(2000), "c".repeat(2000), "d"] }, headers), env)).status).toBe(413);
    expect(MAX_PROOFREAD_CHARS).toBe(6000);
    expect((await app.request("/api/ai/proofread", json({ paragraphs: ["FAIL"] }, headers), env)).status).toBe(502);
    expect(await (await app.request("/api/ai/usage", { headers }, env)).json()).toMatchObject({ checks: { used: 0 } });
    await env.DB.prepare("INSERT INTO proofread_usage (user_id, month, count) VALUES (?1, ?2, ?3) ON CONFLICT (user_id, month) DO UPDATE SET count = excluded.count").bind(id, monthKey(NOW), PROOFREAD_MONTHLY_LIMIT.free).run();
    const over = await app.request("/api/ai/proofread", json({ paragraphs: ["teh"] }, headers), env);
    expect(over.status).toBe(429);
    expect(await over.json()).toEqual({ error: "check_quota_exceeded", usage: { used: PROOFREAD_MONTHLY_LIMIT.free, limit: PROOFREAD_MONTHLY_LIMIT.free } });
  });

  it("says when AI isn't set up", async () => {
    const { app } = makeApp();
    const { headers } = await signIn(app, base);
    expect((await app.request("/api/ai/proofread", json({ paragraphs: ["x"] }, headers), base)).status).toBe(503);
  });
});
