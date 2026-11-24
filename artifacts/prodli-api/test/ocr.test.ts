// POST /api/ai/ocr: "Pull out the text" for screenshots (extension).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { monthKey } from "../src/ai";
import { WRITE_MONTHLY_LIMIT } from "../src/write";
import { MAX_OCR_DATA_URL, parseImageDataUrl } from "../src/ocr";
import type { Env } from "../src/app";
import { EXT_ORIGIN, json, makeApp, makeEnv } from "./helpers";

let base: Env;
let dispose: () => Promise<void>;
beforeAll(async () => ({ env: base, dispose } = await makeEnv()));
afterAll(async () => dispose());
beforeEach(async () => {
  await base.DB.batch([base.DB.prepare("DELETE FROM write_usage"), base.DB.prepare("DELETE FROM sessions"), base.DB.prepare("DELETE FROM users")]);
});

/** makeApp()'s default clock. */
const NOW = 1_800_000_000_000;
const withKey = () => ({ ...base, ANTHROPIC_API_KEY: "sk-test" }) as Env;

async function signIn(app: ReturnType<typeof makeApp>["app"], env: Env) {
  const res = await app.request("/api/auth/google", json({ kind: "extension", accessToken: "good:sub-o:o@example.com:o" }, { Origin: EXT_ORIGIN }), env);
  const body = (await res.json()) as { token: string };
  return { Authorization: `Bearer ${body.token}`, Origin: EXT_ORIGIN };
}

const webp = (data = "UklGRhIAAABXRUJQVlA4") => ({ image: `data:image/webp;base64,${data}` });
const HEAD = "data:image/webp;base64,";

describe("Pull out the text (screenshots)", () => {
  it("reads the text in a screenshot and counts a writing-help use", async () => {
    const { app, calls } = makeApp();
    const env = withKey();
    const auth = await signIn(app, env);
    const res = await app.request("/api/ai/ocr", json(webp(), auth), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "Invoice 42\n\nTotal: $18.00", usage: { used: 1, limit: WRITE_MONTHLY_LIMIT.free } });
    expect(calls.filter((c) => c.kind === "ocr").map((c) => c.clientId)).toEqual(["image/webp"]);
    // PNG works too, on the same allowance.
    expect((await app.request("/api/ai/ocr", json({ image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==" }, auth), env)).status).toBe(200);
    expect(await (await app.request("/api/ai/usage", { headers: auth }, env)).json()).toMatchObject({ used: 0, asks: { used: 0 }, writes: { used: 2 } });
  });

  it("refunds failures, enforces the limit and validates the picture", async () => {
    const { app } = makeApp();
    const env = withKey();
    const auth = await signIn(app, env);
    expect((await app.request("/api/ai/ocr", json(webp("AAAAFAIL"), auth), env)).status).toBe(502);
    expect(await (await app.request("/api/ai/usage", { headers: auth }, env)).json()).toMatchObject({ writes: { used: 0 } });
    expect((await app.request("/api/ai/ocr", json({}, auth), env)).status).toBe(400);
    expect((await app.request("/api/ai/ocr", json({ image: "https://example.com/a.png" }, auth), env)).status).toBe(400);
    expect((await app.request("/api/ai/ocr", json({ image: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" }, auth), env)).status).toBe(400);
    expect((await app.request("/api/ai/ocr", json({ image: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" }, auth), env)).status).toBe(400);
    expect((await app.request("/api/ai/ocr", json({ image: `${HEAD}<script>alert(1)</script>` }, auth), env)).status).toBe(400);
    // Up to the cap is accepted; one character over is "too large", and a much bigger body is cut off before it's parsed.
    expect((await app.request("/api/ai/ocr", json({ image: HEAD + "A".repeat(MAX_OCR_DATA_URL - HEAD.length) }, auth), env)).status).toBe(200);
    expect((await app.request("/api/ai/ocr", json({ image: HEAD + "A".repeat(MAX_OCR_DATA_URL - HEAD.length + 1) }, auth), env)).status).toBe(413);
    expect((await app.request("/api/ai/ocr", json({ image: HEAD + "A".repeat(3_000_000) }, auth), env)).status).toBe(413);
    expect((await app.request("/api/ai/ocr", json(webp(), { Origin: EXT_ORIGIN }), env)).status).toBe(401);
    // Use up the allowance.
    const { user } = (await (await app.request("/api/me", { headers: auth }, env)).json()) as { user: { id: string } };
    await env.DB.prepare("UPDATE write_usage SET count = ?1 WHERE user_id = ?2 AND month = ?3").bind(WRITE_MONTHLY_LIMIT.free, user.id, monthKey(NOW)).run();
    const over = await app.request("/api/ai/ocr", json(webp(), auth), env);
    expect(over.status).toBe(429);
    expect(await over.json()).toMatchObject({ error: "write_quota_exceeded", usage: { used: WRITE_MONTHLY_LIMIT.free, limit: WRITE_MONTHLY_LIMIT.free } });
  });

  it("is off without ProdLi's key", async () => {
    const { app } = makeApp();
    const auth = await signIn(app, base);
    expect((await app.request("/api/ai/ocr", json(webp(), auth), base)).status).toBe(503);
  });

  it("accepts only WebP and PNG data URLs", () => {
    expect(parseImageDataUrl("data:image/webp;base64,AAAA")).toEqual({ mediaType: "image/webp", data: "AAAA" });
    expect(parseImageDataUrl("data:image/png;base64,iVBO==")).toEqual({ mediaType: "image/png", data: "iVBO==" });
    expect(parseImageDataUrl("data:image/jpeg;base64,AAAA")).toBeNull();
    expect(parseImageDataUrl("data:image/png;base64,AA AA")).toBeNull();
    expect(parseImageDataUrl(`data:image/png;base64,${"A".repeat(MAX_OCR_DATA_URL)}`)).toBeNull();
  });
});
