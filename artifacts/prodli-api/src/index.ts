// ProdLi API — Cloudflare Worker. Phase 0: health check, CORS and security
// headers. Accounts (phase 1), sync (phase 2) and AI (phase 4) build on this.

import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";

export type Environment = "development" | "staging" | "production";

export interface Env {
  ENV: Environment;
}

/** The Chrome Web Store build (and unpacked builds with the store key) share this ID. */
export const EXTENSION_ORIGIN = "chrome-extension://gjgknflakhglanjaeenkmciohimnbkdp";

/** Browser origins allowed to call the API with the user's session. */
export function allowedOrigins(env: Environment): string[] {
  const production = ["https://app.prodli.com", "https://prodli.com", EXTENSION_ORIGIN];
  if (env === "production") return production;
  const local = ["http://localhost:5173", "http://localhost:8787", "http://127.0.0.1:5173"];
  if (env === "staging") return [...production, "https://staging.prodli.com", ...local];
  return [...production, ...local];
}

export const app = new Hono<{ Bindings: Env }>();

app.use("*", secureHeaders());

app.use("/api/*", async (c, next) => {
  const allowed = allowedOrigins(c.env.ENV);
  return cors({
    origin: (origin) => (allowed.includes(origin) ? origin : null),
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    maxAge: 600,
  })(c, next);
});

app.get("/api/health", (c) =>
  c.json({ ok: true, service: "prodli-api", env: c.env.ENV, time: new Date().toISOString() }, 200, { "Cache-Control": "no-store" }),
);

app.notFound((c) => c.json({ error: "not_found" }, 404));

app.onError((err, c) => {
  // Never log request bodies: they will contain users' notes.
  console.error(JSON.stringify({ msg: "unhandled_error", path: new URL(c.req.url).pathname, error: err.message }));
  return c.json({ error: "internal_error" }, 500);
});

export default app;
