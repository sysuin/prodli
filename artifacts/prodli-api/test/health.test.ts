import { describe, expect, it } from "vitest";
import { app, EXTENSION_ORIGIN, type Env } from "../src/index";

const env = (ENV: Env["ENV"]): Env => ({ ENV });

describe("prodli-api", () => {
  it("reports health with the environment name", async () => {
    const res = await app.request("/api/health", {}, env("staging"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ ok: true, service: "prodli-api", env: "staging" });
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

  it("returns JSON 404s", async () => {
    const res = await app.request("/api/nope", {}, env("staging"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});
