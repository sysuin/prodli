// Desktop sign-in (Mac / Windows app): the signed-in web app gets a one-time code
// for the app's PKCE challenge; the app trades code + verifier for a "desktop" session.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SESSION_TTL } from "../src/accounts";
import { DESKTOP_ORIGIN, type Env } from "../src/app";
import { challengeFor, DESKTOP_CODE_TTL } from "../src/desktopAuth";
import { cookieFrom, json, makeApp, makeEnv } from "./helpers";

let env: Env;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ env, dispose } = await makeEnv());
});
afterAll(async () => dispose());
beforeEach(async () => {
  await env.DB.batch([env.DB.prepare("DELETE FROM desktop_codes"), env.DB.prepare("DELETE FROM sessions"), env.DB.prepare("DELETE FROM users")]);
});

const WEB = "https://app.prodli.com";
const VERIFIER = "v".repeat(20) + "-._~" + "a1B2c3D4e5F6g7H8i9J0k";

async function webCookie(app: ReturnType<typeof makeApp>["app"], token = "good:sub-d:d@example.com:Dee") {
  const res = await app.request("/api/auth/google", json({ kind: "web", idToken: token }, { Origin: WEB }), env);
  expect(res.status).toBe(200);
  return cookieFrom(res);
}

async function getCode(app: ReturnType<typeof makeApp>["app"], cookie: string, verifier = VERIFIER) {
  const res = await app.request("/api/auth/desktop/code", json({ challenge: await challengeFor(verifier) }, { Origin: WEB, Cookie: cookie }), env);
  expect(res.status).toBe(200);
  return ((await res.json()) as { code: string }).code;
}

const redeem = (app: ReturnType<typeof makeApp>["app"], body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  app.request("/api/auth/desktop/token", json(body, headers), env);

describe("desktop sign-in", () => {
  it("web session → one-time code → desktop bearer session for the same account", async () => {
    const { app, clock } = makeApp();
    const cookie = await webCookie(app);
    const code = await getCode(app, cookie);
    expect(code).toMatch(/^pldc_[A-Za-z0-9_-]{43}$/);

    const res = await redeem(app, { code, verifier: VERIFIER, platform: "mac" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie")).toBeNull();
    const body = (await res.json()) as { token: string; user: { email: string }; session: { client: string; device: string; expiresAt: number } };
    expect(body.token).toMatch(/^pls_/);
    expect(body.user.email).toBe("d@example.com");
    expect(body.session).toMatchObject({ client: "desktop", device: "ProdLi app on Mac", expiresAt: clock.now + SESSION_TTL.desktop });

    const me = await app.request("/api/me", { headers: { Authorization: `Bearer ${body.token}` } }, env);
    expect(await me.json()).toMatchObject({ user: { email: "d@example.com" }, session: { client: "desktop" } });
    const sync = await app.request("/api/sync", { method: "POST", headers: { Authorization: `Bearer ${body.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ deviceId: "desktop-device-1", since: 0, changes: [] }) }, env);
    expect(sync.status).toBe(200);
  });

  it("labels Windows; an unknown platform is just 'a computer'", async () => {
    const { app } = makeApp();
    const cookie = await webCookie(app);
    const w = await redeem(app, { code: await getCode(app, cookie), verifier: VERIFIER, platform: "windows" });
    expect(((await w.json()) as { session: { device: string } }).session.device).toBe("ProdLi app on Windows");
    const x = await redeem(app, { code: await getCode(app, cookie), verifier: VERIFIER, platform: "<b>" });
    expect(((await x.json()) as { session: { device: string } }).session.device).toBe("ProdLi app on a computer");
  });

  it("a code works once, even after a wrong verifier", async () => {
    const { app } = makeApp();
    const code = await getCode(app, await webCookie(app));
    const wrong = await redeem(app, { code, verifier: "w".repeat(43) });
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toEqual({ error: "verifier_mismatch" });
    const again = await redeem(app, { code, verifier: VERIFIER });
    expect(await again.json()).toEqual({ error: "invalid_code" });
  });

  it("a code expires after five minutes", async () => {
    const { app, clock } = makeApp();
    const code = await getCode(app, await webCookie(app));
    clock.now += DESKTOP_CODE_TTL + 1;
    const res = await redeem(app, { code, verifier: VERIFIER });
    expect(await res.json()).toEqual({ error: "code_expired" });
  });

  it("stores only a hash of the code", async () => {
    const { app } = makeApp();
    const code = await getCode(app, await webCookie(app));
    const rows = await env.DB.prepare("SELECT * FROM desktop_codes").all();
    expect(rows.results).toHaveLength(1);
    expect(JSON.stringify(rows.results)).not.toContain(code.slice(5));
  });

  it("asking for a code needs a session, an allowed origin and a well-formed challenge", async () => {
    const { app } = makeApp();
    const challenge = await challengeFor(VERIFIER);
    expect((await app.request("/api/auth/desktop/code", json({ challenge }, { Origin: WEB }), env)).status).toBe(401);
    const cookie = await webCookie(app);
    expect((await app.request("/api/auth/desktop/code", json({ challenge }, { Origin: "https://evil.example", Cookie: cookie }), env)).status).toBe(403);
    expect((await app.request("/api/auth/desktop/code", json({ challenge: "short" }, { Origin: WEB, Cookie: cookie }), env)).status).toBe(400);
  });

  it("redeeming refuses junk, missing verifiers and foreign browser origins", async () => {
    const { app } = makeApp();
    expect((await redeem(app, { code: "pldc_nope", verifier: VERIFIER })).status).toBe(400);
    expect((await redeem(app, { code: "not-a-code", verifier: VERIFIER })).status).toBe(400);
    expect((await redeem(app, { code: "pldc_x" })).status).toBe(400);
    expect((await redeem(app, { code: "pldc_x", verifier: "short" })).status).toBe(400);
    const code = await getCode(app, await webCookie(app));
    expect((await redeem(app, { code, verifier: VERIFIER }, { Origin: "https://evil.example" })).status).toBe(403);
  });

  it("the desktop app's origin may call the API (CORS) with its bearer token", async () => {
    const { app } = makeApp();
    const pre = await app.request("/api/me", { method: "OPTIONS", headers: { Origin: DESKTOP_ORIGIN, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization" } }, env);
    expect(pre.headers.get("Access-Control-Allow-Origin")).toBe(DESKTOP_ORIGIN);
    const code = await getCode(app, await webCookie(app));
    expect((await redeem(app, { code, verifier: VERIFIER }, { Origin: DESKTOP_ORIGIN })).status).toBe(200);
  });

  it("desktop sessions show up in the devices list; deleting the account removes pending codes", async () => {
    const { app } = makeApp();
    const cookie = await webCookie(app);
    const { token } = (await (await redeem(app, { code: await getCode(app, cookie), verifier: VERIFIER, platform: "windows" })).json()) as { token: string };
    await getCode(app, cookie); // left pending
    const list = (await (await app.request("/api/sessions", { headers: { Authorization: `Bearer ${token}` } }, env)).json()) as { sessions: { client: string; current: boolean }[] };
    expect(list.sessions).toEqual(expect.arrayContaining([expect.objectContaining({ client: "desktop", current: true }), expect.objectContaining({ client: "web", current: false })]));
    const del = await app.request("/api/account", { method: "DELETE", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ confirmEmail: "d@example.com" }) }, env);
    expect(del.status).toBe(200);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM desktop_codes").first<{ n: number }>())?.n).toBe(0);
  });
});
