import { describe, expect, it } from "vitest";
import { app, EXTENSION_ORIGIN, type Env } from "../src/app";

const env = (ENV: Env["ENV"]) => ({ ENV, GOOGLE_EXTENSION_CLIENT_ID: "x", GOOGLE_WEB_CLIENT_ID: "y" }) as unknown as Env;

describe("prodli-api basics", () => {
  it("reports health with the environment name", async () => {
    const res = await app.request("/api/health", {}, env("staging"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ ok: true, service: "prodli-api", env: "staging" });
  });

  it("shares the public web sign-in settings", async () => {
    const res = await app.request("/api/config", {}, env("production"));
    expect(await res.json()).toEqual({ env: "production", googleWebClientId: "y" });
  });

  it("sends security headers", async () => {
    const res = await app.request("/api/health", {}, env("production"));
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });

  it("allows the extension and the web app, and nobody else", async () => {
    for (const origin of [EXTENSION_ORIGIN, "https://app.prodli.com"]) {
      const res = await app.request("/api/health", { headers: { Origin: origin } }, env("production"));
      expect(res.headers.get("access-control-allow-origin")).toBe(origin);
      expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    }
    const evil = await app.request("/api/health", { headers: { Origin: "https://evil.example" } }, env("production"));
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
    const local = await app.request("/api/health", { headers: { Origin: "http://localhost:5173" } }, env("production"));
    expect(local.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("answers CORS preflight for allowed origins", async () => {
    const res = await app.request(
      "/api/health",
      { method: "OPTIONS", headers: { Origin: EXTENSION_ORIGIN, "Access-Control-Request-Method": "POST" } },
      env("production"),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(EXTENSION_ORIGIN);
  });

  it("returns JSON 404s for unknown API routes", async () => {
    const res = await app.request("/api/nope", {}, env("staging"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("rejects oversized request bodies", async () => {
    const res = await app.request(
      "/api/auth/google",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "web", idToken: "x".repeat(70_000) }) },
      env("staging"),
    );
    expect(res.status).toBe(413);
  });
});
