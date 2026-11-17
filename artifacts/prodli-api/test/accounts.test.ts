import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SESSION_TTL } from "../src/accounts";
import type { Env } from "../src/app";
import { cookieFrom, EXT_ORIGIN, json, makeApp, makeEnv } from "./helpers";

let env: Env;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ env, dispose } = await makeEnv());
});
afterAll(async () => dispose());
beforeEach(async () => {
  await env.DB.batch([env.DB.prepare("DELETE FROM ai_usage"), env.DB.prepare("DELETE FROM brief_usage"), env.DB.prepare("DELETE FROM ask_usage"), env.DB.prepare("DELETE FROM write_usage"), env.DB.prepare("DELETE FROM sessions"), env.DB.prepare("DELETE FROM users")]);
});

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0 Safari/537.36";

async function extensionSignIn(app: ReturnType<typeof makeApp>["app"], token = "good:sub-a:a@example.com:Alice") {
  const res = await app.request("/api/auth/google", json({ kind: "extension", accessToken: token }, { Origin: EXT_ORIGIN, "User-Agent": UA }), env);
  expect(res.status).toBe(200);
  return (await res.json()) as { user: { id: string; email: string; name: string }; token: string; session: { id: string } };
}

const bearer = (token: string, extra: Record<string, string> = {}) => ({ headers: { Authorization: `Bearer ${token}`, ...extra } });

describe("sign in", () => {
  it("extension: verifies with the extension client, creates the account and returns a session token", async () => {
    const { app, calls } = makeApp();
    const body = await extensionSignIn(app);
    expect(calls).toEqual([{ kind: "extension", clientId: "ext-client" }]);
    expect(body.user).toMatchObject({ email: "a@example.com", name: "Alice" });
    expect(body.token).toMatch(/^pls_[A-Za-z0-9_-]{43}$/);
    const me = await app.request("/api/me", bearer(body.token), env);
    expect(await me.json()).toMatchObject({ user: { id: body.user.id, email: "a@example.com" }, session: { client: "extension" } });
  });

  it("stores only a hash of the session token", async () => {
    const { app } = makeApp();
    const { token } = await extensionSignIn(app);
    const rows = await env.DB.prepare("SELECT token_hash, device FROM sessions").all<{ token_hash: string; device: string }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows.results)).not.toContain(token);
    expect(rows.results[0].device).toBe("Chrome on macOS");
  });

  it("signing in again keeps the same account and updates the profile", async () => {
    const { app } = makeApp();
    const first = await extensionSignIn(app);
    const second = await extensionSignIn(app, "good:sub-a:a@example.com:Alice Renamed");
    expect(second.user.id).toBe(first.user.id);
    expect(second.user.name).toBe("Alice Renamed");
    const list = await app.request("/api/sessions", bearer(second.token), env);
    const { sessions } = (await list.json()) as { sessions: { current: boolean }[] };
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((s) => s.current)).toHaveLength(1);
  });

  it("web: sets a secure HttpOnly __Host- cookie and never returns the token", async () => {
    const { app, calls } = makeApp();
    const res = await app.request("/api/auth/google", json({ kind: "web", idToken: "good:sub-w:w@example.com" }, { Origin: "https://app.prodli.com" }), env);
    expect(res.status).toBe(200);
    expect(calls).toEqual([{ kind: "web", clientId: "web-client" }]);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.token).toBeUndefined();
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^__Host-prodli_session=pls_/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\//);
    const me = await app.request("/api/me", { headers: { Cookie: cookieFrom(res) } }, env);
    expect(await me.json()).toMatchObject({ user: { email: "w@example.com" }, session: { client: "web" } });
  });

  it("web: refuses sign-in from other sites (login CSRF)", async () => {
    const { app } = makeApp();
    const res = await app.request("/api/auth/google", json({ kind: "web", idToken: "good:sub-w:w@example.com" }, { Origin: "https://evil.example" }), env);
    expect(res.status).toBe(403);
    const none = await app.request("/api/auth/google", json({ kind: "web", idToken: "good:sub-w:w@example.com" }), env);
    expect(none.status).toBe(403);
  });

  it("rejects tokens Google doesn't accept, and malformed requests", async () => {
    const { app } = makeApp();
    const bad = await app.request("/api/auth/google", json({ kind: "extension", accessToken: "forged" }), env);
    expect(bad.status).toBe(401);
    expect(await bad.json()).toEqual({ error: "google_auth_failed", reason: "invalid_token" });
    expect((await app.request("/api/auth/google", json({ kind: "admin" }), env)).status).toBe(400);
    expect((await app.request("/api/auth/google", json({ kind: "extension" }), env)).status).toBe(400);
    expect((await app.request("/api/auth/google", { method: "POST", body: "not json" }, env)).status).toBe(400);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first("n")).toBe(0);
  });

  it("rate-limits sign-in attempts per IP", async () => {
    const { app } = makeApp();
    const keys: string[] = [];
    const limited = { ...env, AUTH_LIMITER: { limit: async ({ key }: { key: string }) => (keys.push(key), { success: false }) } } as unknown as Env;
    const res = await app.request("/api/auth/google", json({ kind: "extension", accessToken: "good:s:e@x.com" }, { "CF-Connecting-IP": "203.0.113.9" }), limited);
    expect(res.status).toBe(429);
    expect(keys).toEqual(["auth:203.0.113.9"]);
  });
});

describe("local test stand-in for Google", () => {
  it("only works in development, never on staging or production", async () => {
    const { app } = makeApp();
    for (const ENV of ["staging", "production"] as const) {
      const res = await app.request("/api/auth/google", json({ kind: "extension", accessToken: "forged" }), { ...env, ENV, DEV_FAKE_GOOGLE: "true" });
      expect(res.status).toBe(401); // the real verifier (here: the test fake) still decides
    }
    const dev = await app.request("/api/auth/google", json({ kind: "extension", accessToken: "good:x:x@example.com" }), { ...env, ENV: "development", DEV_FAKE_GOOGLE: "true" });
    expect(dev.status).toBe(200);
    expect(((await dev.json()) as { user: { email: string } }).user.email).toBe("x@example.com");
  });

  it("accepts random unpacked-extension origins only in development", async () => {
    const { app } = makeApp();
    const origin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
    const dev = await app.request("/api/health", { headers: { Origin: origin } }, { ...env, ENV: "development" });
    expect(dev.headers.get("access-control-allow-origin")).toBe(origin);
    const prod = await app.request("/api/health", { headers: { Origin: origin } }, { ...env, ENV: "production" });
    expect(prod.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("sessions", () => {
  it("rejects missing, unknown and malformed tokens", async () => {
    const { app } = makeApp();
    expect((await app.request("/api/me", {}, env)).status).toBe(401);
    expect((await app.request("/api/me", bearer("pls_doesnotexist"), env)).status).toBe(401);
    expect((await app.request("/api/me", bearer("x".repeat(500)), env)).status).toBe(401);
  });

  it("each user only ever sees their own account and devices", async () => {
    const { app } = makeApp();
    const a = await extensionSignIn(app, "good:sub-a:a@example.com");
    const b = await extensionSignIn(app, "good:sub-b:b@example.com");
    const meB = (await (await app.request("/api/me", bearer(b.token), env)).json()) as { user: { email: string } };
    expect(meB.user.email).toBe("b@example.com");
    const { sessions } = (await (await app.request("/api/sessions", bearer(b.token), env)).json()) as { sessions: { id: string }[] };
    expect(sessions.map((s) => s.id)).toEqual([b.session.id]);
    // B can't sign out A's device.
    expect((await app.request(`/api/sessions/${a.session.id}`, { method: "DELETE", ...bearer(b.token) }, env)).status).toBe(404);
    expect((await app.request("/api/me", bearer(a.token), env)).status).toBe(200);
  });

  it("signs out one device, another device, or every device", async () => {
    const { app } = makeApp();
    const one = await extensionSignIn(app);
    const two = await extensionSignIn(app);
    const three = await extensionSignIn(app);
    expect((await app.request(`/api/sessions/${two.session.id}`, { method: "DELETE", ...bearer(one.token) }, env)).status).toBe(200);
    expect((await app.request("/api/me", bearer(two.token), env)).status).toBe(401);
    expect((await app.request("/api/auth/logout", { method: "POST", ...bearer(one.token) }, env)).status).toBe(200);
    expect((await app.request("/api/me", bearer(one.token), env)).status).toBe(401);
    expect((await app.request("/api/me", bearer(three.token), env)).status).toBe(200);
    const four = await extensionSignIn(app);
    expect((await app.request("/api/auth/logout-all", { method: "POST", ...bearer(four.token) }, env)).status).toBe(200);
    for (const s of [three, four]) expect((await app.request("/api/me", bearer(s.token), env)).status).toBe(401);
  });

  it("cookie sessions refuse writes from other sites (CSRF) but allow the app itself", async () => {
    const { app } = makeApp();
    const res = await app.request("/api/auth/google", json({ kind: "web", idToken: "good:sub-w:w@example.com" }, { Origin: "https://app.prodli.com" }), env);
    const Cookie = cookieFrom(res);
    expect((await app.request("/api/auth/logout", { method: "POST", headers: { Cookie, Origin: "https://evil.example" } }, env)).status).toBe(403);
    expect((await app.request("/api/auth/logout", { method: "POST", headers: { Cookie } }, env)).status).toBe(403);
    expect((await app.request("/api/me", { headers: { Cookie } }, env)).status).toBe(200);
    const out = await app.request("/api/auth/logout", { method: "POST", headers: { Cookie, Origin: "https://app.prodli.com" } }, env);
    expect(out.status).toBe(200);
    expect(out.headers.get("set-cookie")).toMatch(/__Host-prodli_session=;/);
    expect((await app.request("/api/me", { headers: { Cookie } }, env)).status).toBe(401);
  });

  it("sessions expire unless used, and using them extends them", async () => {
    const { app, clock } = makeApp();
    const { token } = await extensionSignIn(app);
    clock.now += SESSION_TTL.extension - 60_000;
    expect((await app.request("/api/me", bearer(token), env)).status).toBe(200); // used → extended
    clock.now += SESSION_TTL.extension - 60_000;
    expect((await app.request("/api/me", bearer(token), env)).status).toBe(200);
    clock.now += SESSION_TTL.extension + 1;
    expect((await app.request("/api/me", bearer(token), env)).status).toBe(401);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions").first("n")).toBe(0);
  });
});

describe("account", () => {
  it("exports the account and devices as a download", async () => {
    const { app } = makeApp();
    const { token, user } = await extensionSignIn(app);
    const res = await app.request("/api/account/export", bearer(token), env);
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="prodli-account-\d{4}-\d{2}-\d{2}\.json"/);
    const body = (await res.json()) as { format: string; account: { id: string }; devices: unknown[]; data: object };
    expect(body).toMatchObject({ format: "prodli-account-export", version: 1, account: { id: user.id, email: "a@example.com" }, data: {} });
    expect(body.devices).toHaveLength(1);
  });

  it("deletes the account only after the email is typed, and removes everything", async () => {
    const { app } = makeApp();
    const first = await extensionSignIn(app);
    const other = await extensionSignIn(app);
    const wrong = await app.request("/api/account", { method: "DELETE", ...bearer(first.token, { "Content-Type": "application/json" }), body: JSON.stringify({ confirmEmail: "nope@example.com" }) }, env);
    expect(wrong.status).toBe(400);
    const ok = await app.request("/api/account", { method: "DELETE", ...bearer(first.token, { "Content-Type": "application/json" }), body: JSON.stringify({ confirmEmail: " A@Example.com " }) }, env);
    expect(await ok.json()).toEqual({ deleted: true });
    for (const s of [first, other]) expect((await app.request("/api/me", bearer(s.token), env)).status).toBe(401);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first("n")).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions").first("n")).toBe(0);
    // Signing in again starts a brand-new account.
    const again = await extensionSignIn(app);
    expect(again.user.id).not.toBe(first.user.id);
  });
});
