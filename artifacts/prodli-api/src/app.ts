// ProdLi API — the Hono app (src/index.ts is the Worker entry).
//   Phase 0: health, CORS, security headers.
//   Phase 1: Google sign-in → ProdLi session, account (me, devices, export, delete).
//   Phase 2: sync — each user's data lives in their own UserStore Durable Object.
//   Phase 4: AI meeting summaries with ProdLi's Claude key and a monthly allowance.
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
import { ASK_MONTHLY_LIMIT, AskInputSchema, askClaude, MAX_ASK_CHARS, type AskAnswer, type AskInput } from "./ask";
import { BRIEF_MONTHLY_LIMIT, BriefContextSchema, generateBrief, MAX_BRIEF_CONTEXT_CHARS, type Brief, type BriefContext } from "./brief";
import { generateReview, MAX_REVIEW_CONTEXT_CHARS, ReviewContextSchema, type Review, type ReviewContext } from "./review";
import { backupUser, deleteBackups, listBackups, restoreUser } from "./backup";
import { AI_MONTHLY_LIMIT, AiError, aiUsage, MAX_TRANSCRIPT_CHARS, refundAi, reserveAi, summarizeWithClaude, type Summary, type SummarizeInput } from "./ai";
import { parseChanges, QUOTA_BYTES, SyncError } from "./syncStore";
import { applySubscriptionEvent, BillingError, dodoClient, dodoEnv, getCustomerId, getSubscription, planFor, productsOnSale, saveCustomerId, verifyWebhook, type BillingVars, type DodoClient, type DodoEnv, type DodoEvent, type Interval, type Price } from "./billing";
import type { SyncOutcome, UserStore } from "./userStore";

export type Environment = "development" | "staging" | "production";

export interface Env extends BillingVars {
  ENV: Environment;
  DB: D1Database;
  GOOGLE_EXTENSION_CLIENT_ID: string;
  GOOGLE_WEB_CLIENT_ID: string;
  AUTH_LIMITER?: RateLimit;
  SYNC_LIMITER?: RateLimit;
  AI_LIMITER?: RateLimit;
  /** Secret (`wrangler secret put ANTHROPIC_API_KEY --env …`). Without it, server summaries are off. */
  ANTHROPIC_API_KEY?: string;
  /** R2 bucket for nightly backups (src/backup.ts). */
  BACKUPS?: R2Bucket;
  /** Secret for the admin backup/restore endpoints. Unset = those endpoints don't exist. */
  ADMIN_TOKEN?: string;
  USER_STORE: DurableObjectNamespace<UserStore>;
  ASSETS?: Fetcher;
  /** Local end-to-end tests only: `wrangler dev --var DEV_FAKE_GOOGLE:true`. Ignored unless ENV is "development". */
  DEV_FAKE_GOOGLE?: string;
}

export interface Deps {
  verifyExtension: (accessToken: string, clientId: string) => Promise<GoogleIdentity>;
  verifyWeb: (idToken: string, clientId: string) => Promise<GoogleIdentity>;
  summarize: (input: SummarizeInput, apiKey: string) => Promise<Summary>;
  brief: (ctx: BriefContext, apiKey: string) => Promise<Brief>;
  review: (ctx: ReviewContext, apiKey: string) => Promise<Review>;
  ask: (input: AskInput, apiKey: string) => Promise<AskAnswer>;
  /** Dodo Payments API client (tests pass a fake). */
  dodo?: (apiKey: string, environment: DodoEnv) => DodoClient;
  now: () => number;
}

const realDeps: Deps = { verifyExtension: (t, id) => verifyExtensionAccessToken(t, id), verifyWeb: verifyWebIdToken, summarize: summarizeWithClaude, brief: generateBrief, review: generateReview, ask: askClaude, now: Date.now };

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

const DEVICE_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** The signed-in user's own Durable Object. The id comes only from the verified session. */
const storeFor = (env: Env, userId: string) => env.USER_STORE.get(env.USER_STORE.idFromName(userId));

const clearSessionCookie = (c: Ctx) => deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });

/** Constant-time comparison (via SHA-256 digests, so lengths don't leak either). */
async function sameSecret(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const u = new Uint8Array(x);
  const v = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < u.length; i++) diff |= u[i] ^ v[i];
  return diff === 0;
}

export function createApp(deps: Deps = realDeps) {
  const app = new Hono<AppEnv>();
  const dodo = (c: Ctx) =>
    deps.dodo ? deps.dodo(c.env.DODO_API_KEY ?? "", dodoEnv(c.env)) : dodoClient(c.env.DODO_API_KEY ?? "", dodoEnv(c.env), fetch, c.env.ENV === "development" ? c.env.DODO_API_BASE : undefined);

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

  // Sync carries notes and meeting transcripts; everything else is tiny.
  const tooLarge = (c: Ctx) => c.json({ error: "too_large" }, 413);
  const smallBody = bodyLimit({ maxSize: 64 * 1024, onError: tooLarge });
  const syncBody = bodyLimit({ maxSize: 8 * 1024 * 1024, onError: tooLarge });
  const aiBody = bodyLimit({ maxSize: 1024 * 1024, onError: tooLarge });
  const webhookBody = bodyLimit({ maxSize: 256 * 1024, onError: tooLarge });
  app.use("/api/*", (c, next) =>
    c.req.path === "/api/sync" ? syncBody(c, next) : c.req.path.startsWith("/api/ai/") ? aiBody(c, next) : c.req.path === "/api/billing/webhook" ? webhookBody(c, next) : smallBody(c, next),
  );
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

  const rateLimitSync: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (c.env.SYNC_LIMITER) {
      const { success } = await c.env.SYNC_LIMITER.limit({ key: `sync:${c.get("auth").user.id}` });
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
  app.get("/api/config", (c) => c.json({ env: c.env.ENV, googleWebClientId: c.env.GOOGLE_WEB_CLIENT_ID || null, ai: !!c.env.ANTHROPIC_API_KEY }));

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
    const userId = c.get("auth").user.id;
    await deleteAllSessions(c.env.DB, userId);
    await storeFor(c.env, userId).disconnectAll();
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
      data: await storeFor(c.env, auth.user.id).exportAll(),
    });
  });

  app.delete("/api/account", requireAuth, async (c) => {
    const auth = c.get("auth");
    const body = (await c.req.json().catch(() => null)) as { confirmEmail?: unknown } | null;
    if (typeof body?.confirmEmail !== "string" || body.confirmEmail.trim().toLowerCase() !== auth.user.email.toLowerCase()) {
      return c.json({ error: "confirmation_mismatch" }, 400);
    }
    // A paid subscription ends with the account (otherwise it would keep renewing).
    const sub = await getSubscription(c.env.DB, auth.user.id);
    if (sub && planFor(sub.status) === "pro") {
      if (!c.env.DODO_API_KEY) return c.json({ error: "subscription_active", message: "Cancel your Pro subscription first (Account → Manage subscription), then delete your account." }, 409);
      try {
        await dodo(c).cancelNow(sub.subscription_id);
      } catch {
        return c.json({ error: "subscription_active", message: "Couldn't cancel your Pro subscription. Try again, or cancel it in Account → Manage subscription first." }, 502);
      }
    }
    await storeFor(c.env, auth.user.id).wipe();
    await deleteBackups(c.env, auth.user.id);
    await deleteUser(c.env.DB, auth.user.id);
    clearSessionCookie(c);
    return c.json({ deleted: true });
  });

  // ── Sync ───────────────────────────────────────────────────────────────────
  // POST { deviceId, since, changes: [{ c, id, u, d?, v? }] }
  //   → { seq, changes, more, accepted, rejected, usage }
  app.post("/api/sync", requireAuth, rateLimitSync, async (c) => {
    const auth = c.get("auth");
    const body = (await c.req.json().catch(() => null)) as { deviceId?: unknown; since?: unknown; changes?: unknown } | null;
    const since = body?.since ?? 0;
    if (typeof body?.deviceId !== "string" || !DEVICE_ID.test(body.deviceId) || typeof since !== "number" || !Number.isInteger(since) || since < 0) {
      return c.json({ error: "bad_request" }, 400);
    }
    let changes;
    try {
      changes = parseChanges(body.changes);
    } catch (err) {
      if (err instanceof SyncError) return c.json({ error: err.code, message: err.message }, 400);
      throw err;
    }
    const quota = QUOTA_BYTES[auth.user.plan as keyof typeof QUOTA_BYTES] ?? QUOTA_BYTES.free;
    const outcome = (await storeFor(c.env, auth.user.id).sync(since, changes, quota, body.deviceId)) as SyncOutcome;
    if (!outcome.ok) return c.json({ error: outcome.error, message: outcome.message }, outcome.error === "bad_request" ? 400 : 413);
    return c.json(outcome.result);
  });

  app.get("/api/sync/usage", requireAuth, async (c) => {
    const auth = c.get("auth");
    const quota = QUOTA_BYTES[auth.user.plan as keyof typeof QUOTA_BYTES] ?? QUOTA_BYTES.free;
    return c.json({ ...(await storeFor(c.env, auth.user.id).usage()), quota });
  });

  /** A one-minute ticket for the live-updates WebSocket. */
  app.post("/api/sync/ticket", requireAuth, async (c) => {
    const auth = c.get("auth");
    const body = (await c.req.json().catch(() => null)) as { deviceId?: unknown } | null;
    if (typeof body?.deviceId !== "string" || !DEVICE_ID.test(body.deviceId)) return c.json({ error: "bad_request" }, 400);
    const ticket = await storeFor(c.env, auth.user.id).issueTicket(body.deviceId);
    return c.json({ path: `/api/sync/live?u=${encodeURIComponent(auth.user.id)}&ticket=${encodeURIComponent(ticket)}` });
  });

  /** Live updates. The ticket only works in the object that issued it (the signed-in user's). */
  app.get("/api/sync/live", async (c) => {
    if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") return c.json({ error: "expected_websocket" }, 426);
    if (!isAllowedOrigin(c, c.req.header("Origin"))) return c.json({ error: "bad_origin" }, 403);
    const userId = c.req.query("u") ?? "";
    if (!/^[0-9a-f-]{36}$/.test(userId)) return c.json({ error: "bad_request" }, 400);
    // Don't wake (or create) a Durable Object for ids that aren't real accounts.
    if (!(await c.env.DB.prepare("SELECT 1 FROM users WHERE id = ?").bind(userId).first())) return c.json({ error: "unauthorized" }, 401);
    return storeFor(c.env, userId).fetch(c.req.raw);
  });

  // ── ProdLi Pro (src/billing.ts) ─────────────────────────────────────────────
  // Prices come from Dodo (cached per Worker instance for 10 minutes).
  const priceCache = new Map<string, { at: number; price: Price | null }>();
  const priceOf = async (c: Ctx, productId: string): Promise<Price | null> => {
    const hit = priceCache.get(productId);
    if (hit && deps.now() - hit.at < 600_000) return hit.price;
    const price = await dodo(c).price(productId).catch(() => null);
    priceCache.set(productId, { at: deps.now(), price });
    return price;
  };
  const appOrigin = (c: Ctx) => new URL(c.req.url).origin;

  /** The user's plan, what each plan includes, and (when Pro is on sale) the prices. */
  app.get("/api/billing", requireAuth, async (c) => {
    const auth = c.get("auth");
    const sub = await getSubscription(c.env.DB, auth.user.id);
    const products = productsOnSale(c.env);
    const prices: Partial<Record<Interval, Price | null>> = {};
    if (products) for (const i of ["monthly", "yearly"] as const) if (products[i]) prices[i] = await priceOf(c, products[i]!);
    const limits = (plan: "free" | "pro") => ({ storageBytes: QUOTA_BYTES[plan], summaries: AI_MONTHLY_LIMIT[plan], briefs: BRIEF_MONTHLY_LIMIT[plan], asks: ASK_MONTHLY_LIMIT[plan] });
    return c.json({
      plan: auth.user.plan === "pro" ? "pro" : "free",
      onSale: products ? { monthly: !!products.monthly, yearly: !!products.yearly } : null,
      prices,
      canManage: !!sub && !!c.env.DODO_API_KEY,
      subscription: sub ? { status: sub.status, interval: sub.billing_interval, renewsAt: sub.cancel_at ? null : sub.period_end, endsAt: sub.cancel_at } : null,
      limits: { free: limits("free"), pro: limits("pro") },
    });
  });

  /** POST { interval } → { url } of Dodo's hosted checkout page for this user. */
  app.post("/api/billing/checkout", requireAuth, async (c) => {
    const auth = c.get("auth");
    const body = (await c.req.json().catch(() => null)) as { interval?: unknown } | null;
    const interval = body?.interval === "monthly" || body?.interval === "yearly" ? body.interval : null;
    const products = productsOnSale(c.env);
    if (!products) return c.json({ error: "billing_unavailable" }, 503);
    if (!interval || !products[interval]) return c.json({ error: "bad_request" }, 400);
    if (auth.user.plan === "pro") return c.json({ error: "already_pro" }, 409);
    try {
      const client = dodo(c);
      let customerId = await getCustomerId(c.env.DB, auth.user.id);
      if (!customerId) {
        customerId = await client.createCustomer({ email: auth.user.email, name: auth.user.name, userId: auth.user.id });
        await saveCustomerId(c.env.DB, auth.user.id, customerId, deps.now());
      }
      return c.json({ url: await client.checkoutUrl({ productId: products[interval]!, customerId, userId: auth.user.id, returnUrl: `${appOrigin(c)}/?pro=thanks` }) });
    } catch (err) {
      if (err instanceof BillingError) return c.json({ error: "billing_failed", message: "Couldn't open the checkout. Try again." }, 502);
      throw err;
    }
  });

  /** A link to Dodo's customer portal (change plan or card, invoices, cancel). */
  app.post("/api/billing/portal", requireAuth, async (c) => {
    const auth = c.get("auth");
    const sub = await getSubscription(c.env.DB, auth.user.id);
    if (!sub) return c.json({ error: "no_subscription" }, 404);
    if (!c.env.DODO_API_KEY) return c.json({ error: "billing_unavailable" }, 503);
    try {
      return c.json({ url: await dodo(c).portalUrl(sub.customer_id, `${appOrigin(c)}/`) });
    } catch (err) {
      if (err instanceof BillingError) return c.json({ error: "billing_failed", message: "Couldn't open the subscription page. Try again." }, 502);
      throw err;
    }
  });

  /** Dodo → us (Standard Webhooks signature with the endpoint's secret); nothing else is trusted. */
  app.post("/api/billing/webhook", async (c) => {
    const secret = c.env.DODO_WEBHOOK_SECRET;
    if (!secret) return c.json({ error: "not_found" }, 404);
    const raw = await c.req.text();
    const headers = { id: c.req.header("webhook-id"), timestamp: c.req.header("webhook-timestamp"), signature: c.req.header("webhook-signature") };
    if (!(await verifyWebhook(raw, headers, secret, deps.now()))) return c.json({ error: "bad_signature" }, 401);
    let event: DodoEvent;
    try {
      event = JSON.parse(raw) as DodoEvent;
    } catch {
      return c.json({ error: "bad_request" }, 400);
    }
    const ours = new Set([c.env.DODO_PRODUCT_MONTHLY, c.env.DODO_PRODUCT_YEARLY].map((x) => x?.trim()).filter((x): x is string => !!x));
    const result = await applySubscriptionEvent(c.env.DB, event, deps.now(), ours);
    console.log(JSON.stringify({ msg: "dodo_webhook", type: event.type, applied: result.applied, ...(result.applied ? { plan: result.plan } : { reason: result.reason }) }));
    // 200 even when ignored, so Dodo doesn't retry events we can't use.
    return c.json({ ok: true, applied: result.applied });
  });

  // ── AI summaries ───────────────────────────────────────────────────────────
  const aiLimit = (plan: string) => AI_MONTHLY_LIMIT[plan as keyof typeof AI_MONTHLY_LIMIT] ?? AI_MONTHLY_LIMIT.free;

  const askLimit = (plan: string) => ASK_MONTHLY_LIMIT[plan as keyof typeof ASK_MONTHLY_LIMIT] ?? ASK_MONTHLY_LIMIT.free;
  const briefLimit = (plan: string) => BRIEF_MONTHLY_LIMIT[plan as keyof typeof BRIEF_MONTHLY_LIMIT] ?? BRIEF_MONTHLY_LIMIT.free;

  app.get("/api/ai/usage", requireAuth, async (c) => {
    const auth = c.get("auth");
    const now = deps.now();
    return c.json({
      used: await aiUsage(c.env.DB, auth.user.id, now),
      limit: aiLimit(auth.user.plan),
      available: !!c.env.ANTHROPIC_API_KEY,
      briefs: { used: await aiUsage(c.env.DB, auth.user.id, now, "brief_usage"), limit: briefLimit(auth.user.plan) },
      asks: { used: await aiUsage(c.env.DB, auth.user.id, now, "ask_usage"), limit: askLimit(auth.user.plan) },
    });
  });

  // POST <BriefContext> → { brief, usage }. The context is sent to Anthropic and not stored.
  app.post("/api/ai/brief", requireAuth, async (c) => {
    const auth = c.get("auth");
    if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: "ai_unavailable" }, 503);
    if (c.env.AI_LIMITER && !(await c.env.AI_LIMITER.limit({ key: `ai:${auth.user.id}` })).success) return c.json({ error: "rate_limited" }, 429);
    const raw = await c.req.text();
    if (raw.length > MAX_BRIEF_CONTEXT_CHARS) return c.json({ error: "too_large" }, 413);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return c.json({ error: "bad_request" }, 400);
    }
    const ctx = BriefContextSchema.safeParse(parsed);
    if (!ctx.success) return c.json({ error: "bad_request", message: "That day doesn't look right." }, 400);
    const now = deps.now();
    const limit = briefLimit(auth.user.plan);
    const used = await reserveAi(c.env.DB, auth.user.id, now, limit, "brief_usage");
    if (used === null) return c.json({ error: "brief_quota_exceeded", usage: { used: limit, limit } }, 429);
    try {
      const brief = await deps.brief(ctx.data, c.env.ANTHROPIC_API_KEY);
      return c.json({ brief, usage: { used, limit } });
    } catch (err) {
      await refundAi(c.env.DB, auth.user.id, now, "brief_usage");
      if (err instanceof AiError) return c.json({ error: err.code, message: err.message }, err.code === "ai_busy" ? 503 : 502);
      throw err;
    }
  });

  // POST <ReviewContext> → { review, usage }. Counted with daily briefs. Sent to Anthropic, not stored.
  app.post("/api/ai/review", requireAuth, async (c) => {
    const auth = c.get("auth");
    if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: "ai_unavailable" }, 503);
    if (c.env.AI_LIMITER && !(await c.env.AI_LIMITER.limit({ key: `ai:${auth.user.id}` })).success) return c.json({ error: "rate_limited" }, 429);
    const raw = await c.req.text();
    if (raw.length > MAX_REVIEW_CONTEXT_CHARS) return c.json({ error: "too_large" }, 413);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return c.json({ error: "bad_request" }, 400);
    }
    const ctx = ReviewContextSchema.safeParse(parsed);
    if (!ctx.success) return c.json({ error: "bad_request", message: "That week doesn't look right." }, 400);
    const now = deps.now();
    const limit = briefLimit(auth.user.plan);
    const used = await reserveAi(c.env.DB, auth.user.id, now, limit, "brief_usage");
    if (used === null) return c.json({ error: "brief_quota_exceeded", message: "You've used this month's AI briefs and reviews.", usage: { used: limit, limit } }, 429);
    try {
      const review = await deps.review(ctx.data, c.env.ANTHROPIC_API_KEY);
      return c.json({ review, usage: { used, limit } });
    } catch (err) {
      await refundAi(c.env.DB, auth.user.id, now, "brief_usage");
      if (err instanceof AiError) return c.json({ error: err.code, message: err.message }, err.code === "ai_busy" ? 503 : 502);
      throw err;
    }
  });

  // POST { title, date: "YYYY-MM-DD", transcript } → { summary, usage }
  // The transcript is sent to Anthropic and not stored here (the meeting itself syncs separately).
  app.post("/api/ai/summarize", requireAuth, async (c) => {
    const auth = c.get("auth");
    if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: "ai_unavailable" }, 503);
    if (c.env.AI_LIMITER && !(await c.env.AI_LIMITER.limit({ key: `ai:${auth.user.id}` })).success) return c.json({ error: "rate_limited" }, 429);
    const body = (await c.req.json().catch(() => null)) as Partial<SummarizeInput> | null;
    const title = typeof body?.title === "string" ? body.title.slice(0, 300) : "";
    const date = typeof body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : new Date(deps.now()).toISOString().slice(0, 10);
    const transcript = typeof body?.transcript === "string" ? body.transcript.trim() : "";
    if (!transcript) return c.json({ error: "bad_request", message: "There is no transcript to summarize." }, 400);
    if (transcript.length > MAX_TRANSCRIPT_CHARS) return c.json({ error: "too_large", message: "This transcript is too long to summarize." }, 413);

    const now = deps.now();
    const limit = aiLimit(auth.user.plan);
    const used = await reserveAi(c.env.DB, auth.user.id, now, limit);
    if (used === null) return c.json({ error: "ai_quota_exceeded", usage: { used: limit, limit } }, 429);
    try {
      const summary = await deps.summarize({ title, date, transcript }, c.env.ANTHROPIC_API_KEY);
      return c.json({ summary, usage: { used, limit } });
    } catch (err) {
      await refundAi(c.env.DB, auth.user.id, now);
      if (err instanceof AiError) return c.json({ error: err.code, message: err.message }, err.code === "ai_busy" ? 503 : 502);
      throw err;
    }
  });

  // POST <AskInput> → { answer, actions, usage }. Sent to Anthropic, not stored.
  app.post("/api/ai/ask", requireAuth, async (c) => {
    const auth = c.get("auth");
    if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: "ai_unavailable" }, 503);
    if (c.env.AI_LIMITER && !(await c.env.AI_LIMITER.limit({ key: `ai:${auth.user.id}` })).success) return c.json({ error: "rate_limited" }, 429);
    const raw = await c.req.text();
    if (raw.length > MAX_ASK_CHARS) return c.json({ error: "too_large" }, 413);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return c.json({ error: "bad_request" }, 400);
    }
    const input = AskInputSchema.safeParse(parsed);
    if (!input.success) return c.json({ error: "bad_request" }, 400);
    const now = deps.now();
    const limit = askLimit(auth.user.plan);
    const used = await reserveAi(c.env.DB, auth.user.id, now, limit, "ask_usage");
    if (used === null) return c.json({ error: "ask_quota_exceeded", usage: { used: limit, limit } }, 429);
    try {
      const r = await deps.ask(input.data, c.env.ANTHROPIC_API_KEY);
      return c.json({ answer: r.answer, actions: r.actions, usage: { used, limit } });
    } catch (err) {
      await refundAi(c.env.DB, auth.user.id, now, "ask_usage");
      if (err instanceof AiError) return c.json({ error: err.code, message: err.message }, err.code === "ai_busy" ? 503 : 502);
      throw err;
    }
  });

  // ── Admin: backups and restore (only when the ADMIN_TOKEN secret is set) ────
  // Used for the restore drill and to help a user who lost data. There is no
  // endpoint to read a user's data.
  const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
    const expected = c.env.ADMIN_TOKEN ?? "";
    if (expected.length < 32) return c.json({ error: "not_found" }, 404);
    if (c.env.AUTH_LIMITER && !(await c.env.AUTH_LIMITER.limit({ key: `admin:${c.req.header("CF-Connecting-IP") ?? "unknown"}` })).success) return c.json({ error: "rate_limited" }, 429);
    const given = c.req.header("Authorization")?.replace(/^Bearer\s+/, "") ?? "";
    if (!(await sameSecret(given, expected))) return c.json({ error: "not_found" }, 404);
    console.log(JSON.stringify({ msg: "admin_request", path: c.req.path, method: c.req.method }));
    return next();
  };
  const adminUser = async (c: Ctx, userId: unknown) =>
    typeof userId === "string" && /^[0-9a-f-]{36}$/.test(userId) && !!(await c.env.DB.prepare("SELECT 1 FROM users WHERE id = ?").bind(userId).first());

  app.post("/api/admin/backup", requireAdmin, async (c) => {
    const { userId } = ((await c.req.json().catch(() => ({}))) ?? {}) as { userId?: unknown };
    if (!(await adminUser(c, userId))) return c.json({ error: "unknown_user" }, 404);
    return c.json({ result: await backupUser(c.env, userId as string, deps.now(), true) });
  });

  app.get("/api/admin/backups", requireAdmin, async (c) => {
    const userId = c.req.query("userId");
    if (!(await adminUser(c, userId))) return c.json({ error: "unknown_user" }, 404);
    return c.json({ dates: await listBackups(c.env, userId!) });
  });

  app.post("/api/admin/restore", requireAdmin, async (c) => {
    const { userId, date, mode } = ((await c.req.json().catch(() => ({}))) ?? {}) as { userId?: unknown; date?: unknown; mode?: unknown };
    if (!(await adminUser(c, userId))) return c.json({ error: "unknown_user" }, 404);
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || (mode !== "merge" && mode !== "overwrite")) return c.json({ error: "bad_request" }, 400);
    try {
      return c.json(await restoreUser(c.env, userId as string, date, mode, deps.now()));
    } catch (err) {
      return c.json({ error: "restore_failed", message: err instanceof Error ? err.message : String(err) }, 400);
    }
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
