// Phone sign-in (the iOS / Android app): a Google ID token → a bearer session of type "mobile".
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SESSION_TTL } from "../src/accounts";
import type { Env } from "../src/app";
import { json, makeApp, makeEnv } from "./helpers";

let env: Env;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ env, dispose } = await makeEnv());
});
afterAll(async () => dispose());
beforeEach(async () => {
  await env.DB.batch([env.DB.prepare("DELETE FROM sessions"), env.DB.prepare("DELETE FROM users")]);
});

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

describe("phone sign-in", () => {
  it("verifies the ID token for the web client's audience and returns a long-lived bearer token", async () => {
    const { app, calls, clock } = makeApp();
    const res = await app.request("/api/auth/google", json({ kind: "mobile", idToken: "good:sub-m:m@example.com:Mo", platform: "ios" }, { "User-Agent": "ProdLi/1 CFNetwork/1500 Darwin/25.0.0" }), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie")).toBeNull();
    const body = (await res.json()) as { token: string; user: { email: string }; session: { client: string; device: string; expiresAt: number } };
    expect(calls).toEqual([{ kind: "web", clientId: "web-client" }]);
    expect(body.token).toMatch(/^pls_/);
    expect(body.user.email).toBe("m@example.com");
    expect(body.session).toMatchObject({ client: "mobile", device: "ProdLi app on iPhone", expiresAt: clock.now + SESSION_TTL.mobile });

    const me = await app.request("/api/me", bearer(body.token), env);
    expect(await me.json()).toMatchObject({ session: { client: "mobile" } });
    const sync = await app.request("/api/sync", { method: "POST", headers: { Authorization: `Bearer ${body.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ deviceId: "phone-device-1", since: 0, changes: [] }) }, env);
    expect(sync.status).toBe(200);
  });

  it("Android is labelled as such; an unknown platform is just 'a phone'", async () => {
    const { app } = makeApp();
    const a = await app.request("/api/auth/google", json({ kind: "mobile", idToken: "good:sub-a:a@example.com", platform: "android" }), env);
    expect(((await a.json()) as { session: { device: string } }).session.device).toBe("ProdLi app on Android");
    const b = await app.request("/api/auth/google", json({ kind: "mobile", idToken: "good:sub-b:b@example.com", platform: "<script>" }), env);
    expect(((await b.json()) as { session: { device: string } }).session.device).toBe("ProdLi app on a phone");
  });

  it("also accepts the iOS client's own audience when it's configured", async () => {
    const { app, calls } = makeApp();
    // The fake Google accepts any audience, so make the first (web) audience fail.
    const strict = { ...env, GOOGLE_WEB_CLIENT_ID: "", GOOGLE_IOS_CLIENT_ID: "ios-client" };
    const res = await app.request("/api/auth/google", json({ kind: "mobile", idToken: "good:sub-i:i@example.com" }), strict);
    expect(res.status).toBe(200);
    expect(calls).toEqual([{ kind: "web", clientId: "ios-client" }]);
  });

  it("refuses forged tokens, missing tokens, foreign browser origins, and servers without a client", async () => {
    const { app } = makeApp();
    expect((await app.request("/api/auth/google", json({ kind: "mobile", idToken: "forged" }), env)).status).toBe(401);
    expect((await app.request("/api/auth/google", json({ kind: "mobile" }), env)).status).toBe(400);
    expect((await app.request("/api/auth/google", json({ kind: "mobile", idToken: "good:s:e@x.com" }, { Origin: "https://evil.example" }), env)).status).toBe(403);
    const none = await app.request("/api/auth/google", json({ kind: "mobile", idToken: "good:s:e@x.com" }), { ...env, GOOGLE_WEB_CLIENT_ID: "" });
    expect(none.status).toBe(503);
    expect(await none.json()).toEqual({ error: "mobile_signin_unavailable" });
  });

  it("phone sessions show up in the devices list and can be signed out", async () => {
    const { app } = makeApp();
    const res = await app.request("/api/auth/google", json({ kind: "mobile", idToken: "good:sub-m:m@example.com", platform: "android" }), env);
    const { token, session } = (await res.json()) as { token: string; session: { id: string } };
    const list = (await (await app.request("/api/sessions", bearer(token), env)).json()) as { sessions: { client: string; current: boolean }[] };
    expect(list.sessions).toEqual([expect.objectContaining({ client: "mobile", current: true })]);
    expect((await app.request(`/api/sessions/${session.id}`, { method: "DELETE", ...bearer(token) }, env)).status).toBe(200);
    expect((await app.request("/api/me", bearer(token), env)).status).toBe(401);
  });
});
