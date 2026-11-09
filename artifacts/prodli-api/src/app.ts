// ProdLi API — the Hono app (src/index.ts is the Worker entry).
//   Phase 0: health, CORS, security headers.
//   Phase 1: Google sign-in → ProdLi session, account (me, devices, export, delete).
// The same Worker serves the web app's static files (everything outside /api).
//
// Sessions: the extension sends `Authorization: Bearer <token>`; the web app
// uses an HttpOnly `__Host-` cookie. Cookie-authenticated writes must come
// from an allowed Origin (CSRF protection).

import { Hono, type Context, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import {
  authenticate,
  createSession,
  deleteAllSessions,
  deleteSession,
  deleteUser,
  deviceLabel,
  listSessions,
  SESSION_TTL,
  upsertUser,
  type Authenticated,
  type Client,
} from "./accounts";
import { GoogleAuthError, verifyExtensionAccessToken, verifyWebIdToken, type GoogleIdentity } from "./google";

export type Environment = "development" | "staging" | "production";

export interface Env {
  ENV: Environment;
  DB: D1Database;
  GOOGLE_EXTENSION_CLIENT_ID: string;
  GOOGLE_WEB_CLIENT_ID: string;
  AUTH_LIMITER?: RateLimit;
  ASSETS?: Fetcher;
  /** Local end-to-end tests only: `wrangler dev --var DEV_FAKE_GOOGLE:true`. Ignored unless ENV is "development". */
  DEV_FAKE_GOOGLE?: string;
}

export interface Deps {
  verifyExtension: (accessToken: string, clientId: string) => Promise<GoogleIdentity>;
  verifyWeb: (idToken: string, clientId: string) => Promise<GoogleIdentity>;
  now: () => number;
}

const realDeps: Deps = { verifyExtension: (t, id) => verifyExtensionAccessToken(t, id), verifyWeb: verifyWebIdToken, now: Date.now };

/** Stand-in for Google in local end-to-end tests: accepts "good:<sub>:<email>[:<name>]". */
function fakeGoogle(token: string): GoogleIdentity {
  const [kind, sub, email, name] = token.split(":");
  if (kind !== "good" || !sub || !email) throw new GoogleAuthError("invalid_token");
  return { sub: `dev-${sub}`, email, name: name ?? "", picture: null };
}
const useFakeGoogle = (env: Env) => env.ENV === "development" && env.DEV_FAKE_GOOGLE === "true";

/** The Chrome Web Store build (and unpacked builds with the store key) share this ID. */
export const EXTENSION_ORIGIN = "chrome-extension://gjgknflakhglanjaeenkmciohimnbkdp";
export const SESSION_COOKIE = "__Host-prodli_session";

/** Browser origins allowed to call the API with the user's session. */
export function allowedOrigins(env: Environment): string[] {
  const production = ["https://app.prodli.com", "https://prodli.com", EXTENSION_ORIGIN];
  if (env === "production") return production;
  const local = ["http://localhost:5173", "http://localhost:8787", "http://127.0.0.1:5173"];
  if (env === "staging") return [...production, "https://staging.prodli.com", ...local];
  return [...production, ...local];
}

type AppEnv = { Bindings: Env; Variables: { auth: Authenticated; authVia: "bearer" | "cookie" } };
type Ctx = Context<AppEnv>;

/** Local development also accepts unpacked test builds, whose extension ID is random. */
const devExtension = (env: Environment, origin: string) => env === "development" && /^chrome-extension:\/\/[a-p]{32}$/.test(origin);

const isAllowedOrigin = (c: Ctx, origin: string | undefined) =>
  !!origin && (allowedOrigins(c.env.ENV).includes(origin) || devExtension(c.env.ENV, origin) || origin === new URL(c.req.url).origin);

const clearSessionCookie = (c: Ctx) => deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });

export function createApp(deps: Deps = realDeps) {
  const app = new Hono<AppEnv>();

  app.use("*", secureHeaders());

  app.use("/api/*", async (c, next) => {
    const allowed = allowedOrigins(c.env.ENV);
    return cors({
      origin: (origin) => (allowed.includes(origin) || devExtension(c.env.ENV, origin) ? origin : null),
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      credentials: true,
      maxAge: 600,
    })(c, next);
  });

  app.use("/api/*", bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: "too_large" }, 413) }));
  app.use("/api/*", async (c, next) => {
    await next();
    if (!c.res.headers.has("Cache-Control")) c.res.headers.set("Cache-Control", "no-store");
  });

  const rateLimitAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (c.env.AUTH_LIMITER) {
      const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
      const { success } = await c.env.AUTH_LIMITER.limit({ key: `auth:${ip}` });
      if (!success) return c.json({ error: "rate_limited" }, 429);
    }
    return next();
  };

  const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
    const header = c.req.header("Authorization");
    const via: "bearer" | "cookie" = header?.startsWith("Bearer ") ? "bearer" : "cookie";
    const token = via === "bearer" ? header!.slice(7).trim() : getCookie(c, SESSION_COOKIE);
    if (!token) return c.json({ error: "unauthorized" }, 401);
    if (via === "cookie" && !["GET", "HEAD", "OPTIONS"].includes(c.req.method) && !isAllowedOrigin(c, c.req.header("Origin"))) {
      return c.json({ error: "bad_origin" }, 403);
    }
    const auth = await authenticate(c.env.DB, token, deps.now());
    if (!auth) {
      if (via === "cookie") clearSessionCookie(c);
      return c.json({ error: "unauthorized" }, 401);
    }
    c.set("auth", auth);
    c.set("authVia", via);
    return next();
  };

  app.get("/api/health", (c) => c.json({ ok: true, service: "prodli-api", env: c.env.ENV, time: new Date(deps.now()).toISOString() }));

  /** Public settings the web app needs before signing in. */
  app.get("/api/config", (c) => c.json({ env: c.env.ENV, googleWebClientId: c.env.GOOGLE_WEB_CLIENT_ID || null }));

  // ── Sign in ────────────────────────────────────────────────────────────────
  app.post("/api/auth/google", rateLimitAuth, async (c) => {
    const body = (await c.req.json().catch(() => null)) as { kind?: unknown; accessToken?: unknown; idToken?: unknown } | null;
    const kind = body?.kind;
    if (kind !== "extension" && kind !== "web") return c.json({ error: "bad_request" }, 400);
    if (kind === "web" && !isAllowedOrigin(c, c.req.header("Origin"))) return c.json({ error: "bad_origin" }, 403);

    let identity: GoogleIdentity;
    try {
      if (kind === "extension") {
        if (typeof body?.accessToken !== "string" || !c.env.GOOGLE_EXTENSION_CLIENT_ID) return c.json({ error: "bad_request" }, 400);
        identity = useFakeGoogle(c.env) ? fakeGoogle(body.accessToken) : await deps.verifyExtension(body.accessToken, c.env.GOOGLE_EXTENSION_CLIENT_ID);
      } else {
        if (typeof body?.idToken !== "string" || !c.env.GOOGLE_WEB_CLIENT_ID) return c.json({ error: "bad_request" }, 400);
        identity = useFakeGoogle(c.env) ? fakeGoogle(body.idToken) : await deps.verifyWeb(body.idToken, c.env.GOOGLE_WEB_CLIENT_ID);
      }
    } catch (err) {
      if (err instanceof GoogleAuthError) return c.json({ error: "google_auth_failed", reason: err.message }, 401);
      throw err;
    }

    const now = deps.now();
    const user = await upsertUser(c.env.DB, identity, now);
    const client: Client = kind;
    const { token, session } = await createSession(c.env.DB, user.id, client, deviceLabel(c.req.header("User-Agent")), now);
    if (client === "web") {
      setCookie(c, SESSION_COOKIE, token, { path: "/", secure: true, httpOnly: true, sameSite: "Lax", maxAge: Math.floor(SESSION_TTL.web / 1000) });
      return c.json({ user, session });
    }
    return c.json({ user, session, token });
  });

  // ── Account ────────────────────────────────────────────────────────────────
  app.get("/api/me", requireAuth, (c) => {
    const auth = c.get("auth");
    return c.json({ user: auth.user, session: { id: auth.sessionId, client: auth.client } });
  });

  app.get("/api/sessions", requireAuth, async (c) => {
    const auth = c.get("auth");
    const sessions = await listSessions(c.env.DB, auth.user.id, deps.now());
    return c.json({ sessions: sessions.map((s) => ({ ...s, current: s.id === auth.sessionId })) });
  });

  app.delete("/api/sessions/:id", requireAuth, async (c) => {
    const auth = c.get("auth");
    const ok = await deleteSession(c.env.DB, auth.user.id, c.req.param("id"));
    if (!ok) return c.json({ error: "not_found" }, 404);
    if (c.req.param("id") === auth.sessionId && c.get("authVia") === "cookie") clearSessionCookie(c);
    return c.json({ ok: true });
  });

  app.post("/api/auth/logout", requireAuth, async (c) => {
    const auth = c.get("auth");
    await deleteSession(c.env.DB, auth.user.id, auth.sessionId);
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  app.post("/api/auth/logout-all", requireAuth, async (c) => {
    await deleteAllSessions(c.env.DB, c.get("auth").user.id);
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  app.get("/api/account/export", requireAuth, async (c) => {
    const auth = c.get("auth");
    const now = deps.now();
    const sessions = await listSessions(c.env.DB, auth.user.id, now);
    const date = new Date(now).toISOString().slice(0, 10);
    c.header("Content-Disposition", `attachment; filename="prodli-account-${date}.json"`);
    return c.json({
      format: "prodli-account-export",
      version: 1,
      exportedAt: new Date(now).toISOString(),
      account: auth.user,
      devices: sessions,
      // Notes, to-dos, habits, meetings etc. are added here once sync (phase 2) stores them on the server.
      data: {},
    });
  });

  app.delete("/api/account", requireAuth, async (c) => {
    const auth = c.get("auth");
    const body = (await c.req.json().catch(() => null)) as { confirmEmail?: unknown } | null;
    if (typeof body?.confirmEmail !== "string" || body.confirmEmail.trim().toLowerCase() !== auth.user.email.toLowerCase()) {
      return c.json({ error: "confirmation_mismatch" }, 400);
    }
    await deleteUser(c.env.DB, auth.user.id);
    clearSessionCookie(c);
    return c.json({ deleted: true });
  });

  app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

  // Everything else is the web app (static files). With `run_worker_first:
  // ["/api/*"]` Cloudflare serves these without running this code at all.
  app.all("*", (c) => (c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.json({ error: "not_found" }, 404)));

  app.onError((err, c) => {
    // Never log request bodies: they will contain users' notes.
    console.error(JSON.stringify({ msg: "unhandled_error", path: new URL(c.req.url).pathname, error: err.message }));
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}

export const app = createApp();
