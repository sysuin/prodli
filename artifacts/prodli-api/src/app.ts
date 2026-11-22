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
import { CHALLENGE, createDesktopCode, desktopDeviceLabel, redeemDesktopCode, VERIFIER } from "./desktopAuth";
import { GoogleAuthError, verifyExtensionAccessToken, verifyWebIdToken, type GoogleIdentity } from "./google";
import { ASK_MONTHLY_LIMIT, AskInputSchema, askClaude, MAX_ASK_CHARS, type AskAnswer, type AskInput } from "./ask";
import { BRIEF_MONTHLY_LIMIT, BriefContextSchema, generateBrief, MAX_BRIEF_CONTEXT_CHARS, type Brief, type BriefContext } from "./brief";
import { generateReview, MAX_REVIEW_CONTEXT_CHARS, ReviewContextSchema, type Review, type ReviewContext } from "./review";
import { backupUser, deleteBackups, listBackups, restoreUser } from "./backup";
import { AI_MONTHLY_LIMIT, AiError, aiUsage, cleanCustomTemplate, cleanGlossary, cleanMoments, cleanUserNotes, isMeetingTemplate, isSummaryLanguage, MAX_TRANSCRIPT_CHARS, refundAi, reserveAi, summarizeWithClaude, type Summary, type SummarizeInput } from "./ai";
import { MAX_PIECE_BYTES, refundSeconds, reserveSeconds, TRANSCRIBE_MONTHLY_MINUTES, transcribeUsage, transcribeWithWorkersAi, wavSeconds, type TranscriptPiece } from "./transcribe";
import { funnelReport, parseUninstallFeedback, saveUninstallFeedback } from "./insights";
import { ExtractTasksInputSchema, extractTasksWithClaude, MAX_DUMP_CHARS, MAX_PAGE_CHARS, PageSummaryInputSchema, summarizePageWithClaude, type ExtractTasksInput, type PageSummary, type PageSummaryInput } from "./write";
import { draftFollowUpWithClaude, FollowUpInputSchema, MAX_FOLLOW_UP_CHARS, MAX_REWRITE_CHARS, RewriteInputSchema, rewriteWithClaude, WRITE_MONTHLY_LIMIT, type FollowUp, type FollowUpInput, type Rewrite, type RewriteInput } from "./write";
import { parseChanges, QUOTA_BYTES, SyncError } from "./syncStore";
import { applySubscriptionEvent, BillingError, dodoClient, dodoEnv, getCustomerId, getSubscription, planFor, productsOnSale, proFeatureAllowed, saveCustomerId, verifyWebhook, type BillingVars, type DodoClient, type DodoEnv, type DodoEvent, type Interval, type Price } from "./billing";
import type { SyncOutcome, UserStore } from "./userStore";
import { MAX_PREP_CHARS, PrepInputSchema, prepWithClaude, type Prep, type PrepInput } from "./prep";
import { CoachInputSchema, coachWithClaude, type CoachInput, type Coaching } from "./coach";
import { DICTATE_MONTHLY_LIMIT, DictateInputSchema, dictateWithClaude, MAX_DICTATION_CHARS, type DictateInput } from "./dictate";
import { DODO_RETURN_PARAMS, renderProPage, type ProPageFrom } from "./proPage";
import { deleteShare, listShares, MAX_SHARE_BYTES, openShare, renderShareMissing, renderSharePage, saveShare, SHARE_PAGE_HEADERS, ShareInputSchema, type ShareRow } from "./shares";

export type Environment = "development" | "staging" | "production";

export interface Env extends BillingVars {
  ENV: Environment;
  DB: D1Database;
  GOOGLE_EXTENSION_CLIENT_ID: string;
  GOOGLE_WEB_CLIENT_ID: string;
  /** Optional: the iOS app's own OAuth client, accepted as an ID-token audience for phone sign-in. */
  GOOGLE_IOS_CLIENT_ID?: string;
  AUTH_LIMITER?: RateLimit;
  SYNC_LIMITER?: RateLimit;
  AI_LIMITER?: RateLimit;
  /** Workers AI (staging and production only): Whisper for "Transcribe audio with AI". */
  AI?: Ai;
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
  prep: (input: PrepInput, apiKey: string) => Promise<Prep>;
  coach: (input: CoachInput, apiKey: string) => Promise<Coaching>;
  dictate: (input: DictateInput, apiKey: string) => Promise<{ text: string }>;
  ask: (input: AskInput, apiKey: string) => Promise<AskAnswer>;
  rewrite: (input: RewriteInput, apiKey: string) => Promise<Rewrite>;
  followUp: (input: FollowUpInput, apiKey: string) => Promise<FollowUp>;
  transcribe: (wav: Uint8Array, ai: Ai, vocabulary?: string[]) => Promise<TranscriptPiece>;
  summarizePage: (input: PageSummaryInput, apiKey: string) => Promise<PageSummary>;
  extractTasks: (input: ExtractTasksInput, apiKey: string) => Promise<{ lines: string[]; model: string }>;
  /** Dodo Payments API client (tests pass a fake). */
  dodo?: (apiKey: string, environment: DodoEnv) => DodoClient;
  now: () => number;
}

const realDeps: Deps = { verifyExtension: (t, id) => verifyExtensionAccessToken(t, id), verifyWeb: verifyWebIdToken, summarize: summarizeWithClaude, brief: generateBrief, review: generateReview, prep: prepWithClaude, coach: coachWithClaude, dictate: dictateWithClaude, ask: askClaude, rewrite: rewriteWithClaude, followUp: draftFollowUpWithClaude, transcribe: transcribeWithWorkersAi, summarizePage: summarizePageWithClaude, extractTasks: extractTasksWithClaude, now: Date.now };

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
/** The desktop apps (artifacts/prodli-desktop) serve their pages from this origin. */
export const DESKTOP_ORIGIN = "app://prodli";

/** Browser origins allowed to call the API with the user's session. */
export function allowedOrigins(env: Environment): string[] {
  const production = ["https://app.prodli.com", "https://prodli.com", EXTENSION_ORIGIN, DESKTOP_ORIGIN];
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

/** "ProdLi app on iPhone" / "… on Android" for the sessions list (the app says which; nothing else is recorded). */
export const mobileDeviceLabel = (platform: unknown) => `ProdLi app on ${platform === "ios" ? "iPhone" : platform === "android" ? "Android" : "a phone"}`;

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

  /** An ID token for any of these audiences (the phone apps ask for the web client's; iOS may use its own). */
  const verifyAny = async (idToken: string, audiences: string[]): Promise<GoogleIdentity> => {
    let last: unknown;
    for (const aud of audiences) {
      try {
        return await deps.verifyWeb(idToken, aud);
      } catch (err) {
        if (!(err instanceof GoogleAuthError)) throw err;
        last = err;
      }
    }
    throw last;
  };

  app.get("/api/health", (c) => c.json({ ok: true, service: "prodli-api", env: c.env.ENV, time: new Date(deps.now()).toISOString() }));

  /** Public settings the web app needs before signing in. */
  app.get("/api/config", (c) => c.json({ env: c.env.ENV, googleWebClientId: c.env.GOOGLE_WEB_CLIENT_ID || null, ai: !!c.env.ANTHROPIC_API_KEY }));

  // ── Sign in ────────────────────────────────────────────────────────────────
  //   extension: chrome.identity access token → bearer token
  //   web:       Google Identity Services ID token → HttpOnly cookie
  //   mobile:    the iOS / Android app's Google ID token (requested for the web
  //              client's audience, or the iOS client's) → bearer token. Native
  //              apps send no Origin; a browser always does, so one that sends a
  //              foreign Origin is refused.
  app.post("/api/auth/google", rateLimitAuth, async (c) => {
    const body = (await c.req.json().catch(() => null)) as { kind?: unknown; accessToken?: unknown; idToken?: unknown; platform?: unknown } | null;
    const kind = body?.kind;
    if (kind !== "extension" && kind !== "web" && kind !== "mobile") return c.json({ error: "bad_request" }, 400);
    if (kind === "web" && !isAllowedOrigin(c, c.req.header("Origin"))) return c.json({ error: "bad_origin" }, 403);
    if (kind === "mobile" && c.req.header("Origin") !== undefined && !isAllowedOrigin(c, c.req.header("Origin"))) return c.json({ error: "bad_origin" }, 403);

    let identity: GoogleIdentity;
    try {
      if (kind === "extension") {
        if (typeof body?.accessToken !== "string" || !c.env.GOOGLE_EXTENSION_CLIENT_ID) return c.json({ error: "bad_request" }, 400);
        identity = useFakeGoogle(c.env) ? fakeGoogle(body.accessToken) : await deps.verifyExtension(body.accessToken, c.env.GOOGLE_EXTENSION_CLIENT_ID);
      } else if (kind === "web") {
        if (typeof body?.idToken !== "string" || !c.env.GOOGLE_WEB_CLIENT_ID) return c.json({ error: "bad_request" }, 400);
        identity = useFakeGoogle(c.env) ? fakeGoogle(body.idToken) : await deps.verifyWeb(body.idToken, c.env.GOOGLE_WEB_CLIENT_ID);
      } else {
        if (typeof body?.idToken !== "string") return c.json({ error: "bad_request" }, 400);
        const audiences = [c.env.GOOGLE_WEB_CLIENT_ID, c.env.GOOGLE_IOS_CLIENT_ID].filter((x): x is string => !!x);
        if (!audiences.length) return c.json({ error: "mobile_signin_unavailable" }, 503);
        identity = useFakeGoogle(c.env) ? fakeGoogle(body.idToken) : await verifyAny(body.idToken, audiences);
      }
    } catch (err) {
      if (err instanceof GoogleAuthError) return c.json({ error: "google_auth_failed", reason: err.message }, 401);
      throw err;
    }

    const now = deps.now();
    const user = await upsertUser(c.env.DB, identity, now);
    const client: Client = kind;
    const device = kind === "mobile" ? mobileDeviceLabel(body?.platform) : deviceLabel(c.req.header("User-Agent"));
    const { token, session } = await createSession(c.env.DB, user.id, client, device, now);
    if (client === "web") {
      setCookie(c, SESSION_COOKIE, token, { path: "/", secure: true, httpOnly: true, sameSite: "Lax", maxAge: Math.floor(SESSION_TTL.web / 1000) });
      return c.json({ user, session });
    }
    return c.json({ user, session, token });
  });

  // ── Desktop app sign-in (src/desktopAuth.ts) ──────────────────────────────
  // Step 2: the signed-in web app asks for a one-time code for the app's challenge.
  app.post("/api/auth/desktop/code", rateLimitAuth, requireAuth, async (c) => {
    const body = (await c.req.json().catch(() => null)) as { challenge?: unknown } | null;
    if (typeof body?.challenge !== "string" || !CHALLENGE.test(body.challenge)) return c.json({ error: "bad_request" }, 400);
    const code = await createDesktopCode(c.env.DB, c.get("auth").user.id, body.challenge, deps.now());
    return c.json({ code });
  });

  // Step 3: the app trades the code and its verifier for a bearer session. The
  // app's main process sends no Origin; a browser always does, so a foreign one is refused.
  app.post("/api/auth/desktop/token", rateLimitAuth, async (c) => {
    const origin = c.req.header("Origin");
    if (origin !== undefined && !isAllowedOrigin(c, origin)) return c.json({ error: "bad_origin" }, 403);
    const body = (await c.req.json().catch(() => null)) as { code?: unknown; verifier?: unknown; platform?: unknown } | null;
    if (typeof body?.code !== "string" || typeof body.verifier !== "string" || !VERIFIER.test(body.verifier)) return c.json({ error: "bad_request" }, 400);
    const now = deps.now();
    const redeemed = await redeemDesktopCode(c.env.DB, body.code, body.verifier, now);
    if (!redeemed.ok) return c.json({ error: redeemed.error }, 400);
    const { token, session } = await createSession(c.env.DB, redeemed.userId, "desktop", desktopDeviceLabel(body.platform), now);
    const auth = await authenticate(c.env.DB, token, now);
    if (!auth) return c.json({ error: "unauthorized" }, 401);
    return c.json({ user: auth.user, session, token });
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
    const limits = (plan: "free" | "pro") => ({ storageBytes: QUOTA_BYTES[plan], summaries: AI_MONTHLY_LIMIT[plan], briefs: BRIEF_MONTHLY_LIMIT[plan], asks: ASK_MONTHLY_LIMIT[plan], writes: WRITE_MONTHLY_LIMIT[plan], transcribeMinutes: TRANSCRIBE_MONTHLY_MINUTES[plan], dictations: DICTATE_MONTHLY_LIMIT[plan] });
    return c.json({
      plan: auth.user.plan === "pro" ? "pro" : "free",
      onSale: products ? { monthly: !!products.monthly, yearly: !!products.yearly } : null,
      // Pro-only features (custom meeting templates, links that never expire) are open to everyone until Pro is on sale.
      earlyAccess: !products,
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
      return c.json({ url: await client.checkoutUrl({ productId: products[interval]!, customerId, userId: auth.user.id, returnUrl: `${appOrigin(c)}/pro/done?from=checkout` }) });
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
      return c.json({ url: await dodo(c).portalUrl(sub.customer_id, `${appOrigin(c)}/pro/done?from=portal`) });
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
  const dictateLimit = (plan: string) => DICTATE_MONTHLY_LIMIT[plan as keyof typeof DICTATE_MONTHLY_LIMIT] ?? DICTATE_MONTHLY_LIMIT.free;

  const askLimit = (plan: string) => ASK_MONTHLY_LIMIT[plan as keyof typeof ASK_MONTHLY_LIMIT] ?? ASK_MONTHLY_LIMIT.free;
  const briefLimit = (plan: string) => BRIEF_MONTHLY_LIMIT[plan as keyof typeof BRIEF_MONTHLY_LIMIT] ?? BRIEF_MONTHLY_LIMIT.free;
  const writeLimit = (plan: string) => WRITE_MONTHLY_LIMIT[plan as keyof typeof WRITE_MONTHLY_LIMIT] ?? WRITE_MONTHLY_LIMIT.free;
  const transcribeLimitSeconds = (plan: string) => 60 * (TRANSCRIBE_MONTHLY_MINUTES[plan as keyof typeof TRANSCRIBE_MONTHLY_MINUTES] ?? TRANSCRIBE_MONTHLY_MINUTES.free);

  app.get("/api/ai/usage", requireAuth, async (c) => {
    const auth = c.get("auth");
    const now = deps.now();
    return c.json({
      used: await aiUsage(c.env.DB, auth.user.id, now),
      limit: aiLimit(auth.user.plan),
      available: !!c.env.ANTHROPIC_API_KEY,
      briefs: { used: await aiUsage(c.env.DB, auth.user.id, now, "brief_usage"), limit: briefLimit(auth.user.plan) },
      asks: { used: await aiUsage(c.env.DB, auth.user.id, now, "ask_usage"), limit: askLimit(auth.user.plan) },
      writes: { used: await aiUsage(c.env.DB, auth.user.id, now, "write_usage"), limit: writeLimit(auth.user.plan) },
      dictations: { used: await aiUsage(c.env.DB, auth.user.id, now, "dictate_usage"), limit: dictateLimit(auth.user.plan) },
      transcribeSeconds: { used: await transcribeUsage(c.env.DB, auth.user.id, now), limit: transcribeLimitSeconds(auth.user.plan), available: !!c.env.AI },
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

  // POST <PrepInput> → { prep, usage }. AI prep for one meeting (Pro). Counted with daily briefs. Sent to Anthropic, not stored.
  app.post("/api/ai/meeting-prep", requireAuth, async (c) => {
    const auth = c.get("auth");
    if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: "ai_unavailable" }, 503);
    if (!proFeatureAllowed(auth.user.plan, c.env)) return c.json({ error: "pro_required", message: "AI meeting prep is part of ProdLi Pro." }, 402);
    if (c.env.AI_LIMITER && !(await c.env.AI_LIMITER.limit({ key: `ai:${auth.user.id}` })).success) return c.json({ error: "rate_limited" }, 429);
    const raw = await c.req.text();
    if (raw.length > MAX_PREP_CHARS) return c.json({ error: "too_large" }, 413);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return c.json({ error: "bad_request" }, 400);
    }
    const input = PrepInputSchema.safeParse(parsed);
    if (!input.success) return c.json({ error: "bad_request", message: "That meeting doesn't look right." }, 400);
    const now = deps.now();
    const limit = briefLimit(auth.user.plan);
    const used = await reserveAi(c.env.DB, auth.user.id, now, limit, "brief_usage");
    if (used === null) return c.json({ error: "brief_quota_exceeded", message: "You've used this month's AI briefs and prep.", usage: { used: limit, limit } }, 429);
    try {
      const prep = await deps.prep(input.data, c.env.ANTHROPIC_API_KEY);
      return c.json({ prep, usage: { used, limit } });
    } catch (err) {
      await refundAi(c.env.DB, auth.user.id, now, "brief_usage");
      if (err instanceof AiError) return c.json({ error: err.code, message: err.message }, err.code === "ai_busy" ? 503 : 502);
      throw err;
    }
  });

  // POST <DictateInput> → { text, usage }. Voice dictation: cleans up what Whisper heard
  // (polish), or applies a spoken instruction to selected text (command, Pro). Not stored.
  app.post("/api/ai/dictate", requireAuth, async (c) => {
    const auth = c.get("auth");
    if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: "ai_unavailable" }, 503);
    if (c.env.AI_LIMITER && !(await c.env.AI_LIMITER.limit({ key: `ai:${auth.user.id}` })).success) return c.json({ error: "rate_limited" }, 429);
    const raw = await c.req.text();
    if (raw.length > MAX_DICTATION_CHARS * 2 + 4000) return c.json({ error: "too_large", message: "That's too much text at once." }, 413);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return c.json({ error: "bad_request" }, 400);
    }
    const input = DictateInputSchema.safeParse(parsed);
    if (!input.success || !input.data.text.trim() || (input.data.mode === "command" && !input.data.selection?.trim())) return c.json({ error: "bad_request" }, 400);
    if (input.data.mode === "command" && !proFeatureAllowed(auth.user.plan, c.env)) return c.json({ error: "pro_required", message: "Command Mode (editing selected text by voice) is part of ProdLi Pro." }, 402);
    const now = deps.now();
    const limit = dictateLimit(auth.user.plan);
    const used = await reserveAi(c.env.DB, auth.user.id, now, limit, "dictate_usage");
    if (used === null) return c.json({ error: "dictate_quota_exceeded", message: "You've used this month's AI dictation clean-ups.", usage: { used: limit, limit } }, 429);
    try {
      const r = await deps.dictate(input.data, c.env.ANTHROPIC_API_KEY);
      return c.json({ text: r.text, usage: { used, limit } });
    } catch (err) {
      await refundAi(c.env.DB, auth.user.id, now, "dictate_usage");
      if (err instanceof AiError) return c.json({ error: err.code, message: err.message }, err.code === "ai_busy" ? 503 : 502);
      throw err;
    }
  });

  // POST <CoachInput> → { coaching, usage } (Pro). "🎯 Coach me" on a meeting:
  // the transcript goes to Anthropic and isn't stored; counts as a meeting summary.
  app.post("/api/ai/meeting-coach", requireAuth, async (c) => {
    const auth = c.get("auth");
    if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: "ai_unavailable" }, 503);
    if (!proFeatureAllowed(auth.user.plan, c.env)) return c.json({ error: "pro_required", message: "Meeting coaching is part of ProdLi Pro." }, 402);
    if (c.env.AI_LIMITER && !(await c.env.AI_LIMITER.limit({ key: `ai:${auth.user.id}` })).success) return c.json({ error: "rate_limited" }, 429);
    const raw = await c.req.text();
    if (raw.length > MAX_TRANSCRIPT_CHARS + 2000) return c.json({ error: "too_large", message: "This transcript is too long to coach." }, 413);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return c.json({ error: "bad_request" }, 400);
    }
    const input = CoachInputSchema.safeParse(parsed);
    if (!input.success) return c.json({ error: "bad_request", message: "That meeting doesn't look right." }, 400);
    const now = deps.now();
    const limit = aiLimit(auth.user.plan);
    const used = await reserveAi(c.env.DB, auth.user.id, now, limit);
    if (used === null) return c.json({ error: "ai_quota_exceeded", message: "You've used this month's AI meeting summaries.", usage: { used: limit, limit } }, 429);
    try {
      const coaching = await deps.coach(input.data, c.env.ANTHROPIC_API_KEY);
      return c.json({ coaching, usage: { used, limit } });
    } catch (err) {
      await refundAi(c.env.DB, auth.user.id, now);
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
    // Your own meeting template is a Pro feature (open to everyone until Pro is on sale).
    const custom = cleanCustomTemplate(body?.custom);
    if (custom && !proFeatureAllowed(auth.user.plan, c.env)) return c.json({ error: "pro_required", message: "Your own meeting templates are part of ProdLi Pro." }, 402);
    // Notes in a chosen language (Pro). Unknown codes are ignored.
    const language = isSummaryLanguage((body as { language?: unknown } | null)?.language) ? ((body as { language: string }).language) : undefined;
    if (language && !proFeatureAllowed(auth.user.plan, c.env)) return c.json({ error: "pro_required", message: "Notes in another language are part of ProdLi Pro." }, 402);
    // Marked moments (Pro). Without Pro they're left out rather than refused, so the notes still come.
    const moments = proFeatureAllowed(auth.user.plan, c.env) ? cleanMoments((body as { moments?: unknown } | null)?.moments) : [];
    // Your notes from the meeting (Pro), left out the same way.
    const notes = proFeatureAllowed(auth.user.plan, c.env) ? cleanUserNotes((body as { notes?: unknown } | null)?.notes) : "";

    const now = deps.now();
    const limit = aiLimit(auth.user.plan);
    const used = await reserveAi(c.env.DB, auth.user.id, now, limit);
    if (used === null) return c.json({ error: "ai_quota_exceeded", usage: { used: limit, limit } }, 429);
    try {
      const template = isMeetingTemplate(body?.template) ? body.template : undefined;
      const glossary = cleanGlossary(body?.glossary);
      const summary = await deps.summarize({ title, date, transcript, ...(template ? { template } : {}), ...(glossary.length ? { glossary } : {}), ...(custom ? { custom } : {}), ...(language ? { language } : {}), ...(moments.length ? { moments } : {}), ...(notes ? { notes } : {}) }, c.env.ANTHROPIC_API_KEY);
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
      return c.json({ answer: r.answer, actions: r.actions, sources: r.sources ?? [], usage: { used, limit } });
    } catch (err) {
      await refundAi(c.env.DB, auth.user.id, now, "ask_usage");
      if (err instanceof AiError) return c.json({ error: err.code, message: err.message }, err.code === "ai_busy" ? 503 : 502);
      throw err;
    }
  });

  // POST { action, text } → { text, changed, usage }. Writing help for a note selection. Sent to Anthropic, not stored.
  app.post("/api/ai/rewrite", requireAuth, async (c) => {
    const auth = c.get("auth");
    if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: "ai_unavailable" }, 503);
    if (c.env.AI_LIMITER && !(await c.env.AI_LIMITER.limit({ key: `ai:${auth.user.id}` })).success) return c.json({ error: "rate_limited" }, 429);
    const body = (await c.req.json().catch(() => null)) as { text?: unknown } | null;
    if (typeof body?.text === "string" && body.text.length > MAX_REWRITE_CHARS) return c.json({ error: "too_large", message: "That's too much text at once. Select a shorter part." }, 413);
    const input = RewriteInputSchema.safeParse(body);
    if (input.success && input.data.style?.trim() && !proFeatureAllowed(auth.user.plan, c.env)) return c.json({ error: "pro_required", message: "Your writing style is part of ProdLi Pro." }, 402);
    if (!input.success || !input.data.text.trim()) return c.json({ error: "bad_request" }, 400);
    const now = deps.now();
    const limit = writeLimit(auth.user.plan);
    const used = await reserveAi(c.env.DB, auth.user.id, now, limit, "write_usage");
    if (used === null) return c.json({ error: "write_quota_exceeded", usage: { used: limit, limit } }, 429);
    try {
      const r = await deps.rewrite(input.data, c.env.ANTHROPIC_API_KEY);
      return c.json({ text: r.text, changed: r.changed, usage: { used, limit } });
    } catch (err) {
      await refundAi(c.env.DB, auth.user.id, now, "write_usage");
      if (err instanceof AiError) return c.json({ error: err.code, message: err.message }, err.code === "ai_busy" ? 503 : 502);
      throw err;
    }
  });

  // Follow-up email from a meeting's summary (never the transcript). Same allowance as rewrites.
  app.post("/api/ai/follow-up", requireAuth, async (c) => {
    const auth = c.get("auth");
    if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: "ai_unavailable" }, 503);
    if (c.env.AI_LIMITER && !(await c.env.AI_LIMITER.limit({ key: `ai:${auth.user.id}` })).success) return c.json({ error: "rate_limited" }, 429);
    const raw = await c.req.text().catch(() => "");
    if (raw.length > MAX_FOLLOW_UP_CHARS) return c.json({ error: "too_large", message: "These meeting notes are too long for a follow-up email." }, 413);
    let body: unknown = null;
    try {
      body = JSON.parse(raw);
    } catch {
      return c.json({ error: "bad_request" }, 400);
    }
    const input = FollowUpInputSchema.safeParse(body);
    if (input.success && input.data.style?.trim() && !proFeatureAllowed(auth.user.plan, c.env)) return c.json({ error: "pro_required", message: "Your writing style is part of ProdLi Pro." }, 402);
    if (!input.success || !input.data.meeting.overview.trim()) return c.json({ error: "bad_request" }, 400);
    const now = deps.now();
    const limit = writeLimit(auth.user.plan);
    const used = await reserveAi(c.env.DB, auth.user.id, now, limit, "write_usage");
    if (used === null) return c.json({ error: "write_quota_exceeded", usage: { used: limit, limit } }, 429);
    try {
      const r = await deps.followUp(input.data, c.env.ANTHROPIC_API_KEY);
      return c.json({ subject: r.subject, body: r.body, usage: { used, limit } });
    } catch (err) {
      await refundAi(c.env.DB, auth.user.id, now, "write_usage");
      if (err instanceof AiError) return c.json({ error: err.code, message: err.message }, err.code === "ai_busy" ? 503 : 502);
      throw err;
    }
  });

  // POST { text, lists } → { lines, usage }. 🎙 Speak tasks: a brain dump → quick-add lines.
  app.post("/api/ai/extract-tasks", requireAuth, async (c) => {
    const auth = c.get("auth");
    if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: "ai_unavailable" }, 503);
    if (c.env.AI_LIMITER && !(await c.env.AI_LIMITER.limit({ key: `ai:${auth.user.id}` })).success) return c.json({ error: "rate_limited" }, 429);
    const body = (await c.req.json().catch(() => null)) as { text?: unknown } | null;
    if (typeof body?.text === "string" && body.text.length > MAX_DUMP_CHARS) return c.json({ error: "too_large" }, 413);
    const input = ExtractTasksInputSchema.safeParse(body);
    if (!input.success || !input.data.text.trim()) return c.json({ error: "bad_request" }, 400);
    const now = deps.now();
    const limit = writeLimit(auth.user.plan);
    const used = await reserveAi(c.env.DB, auth.user.id, now, limit, "write_usage");
    if (used === null) return c.json({ error: "write_quota_exceeded", usage: { used: limit, limit } }, 429);
    try {
      const r = await deps.extractTasks(input.data, c.env.ANTHROPIC_API_KEY);
      return c.json({ lines: r.lines, usage: { used, limit } });
    } catch (err) {
      await refundAi(c.env.DB, auth.user.id, now, "write_usage");
      if (err instanceof AiError) return c.json({ error: err.code, message: err.message }, err.code === "ai_busy" ? 503 : 502);
      throw err;
    }
  });

  // POST { title, url, text } → { summary: { tldr, points }, usage }. Right-click "Summarize page".
  // Counts toward the writing allowance; the page text goes to Anthropic and isn't stored.
  app.post("/api/ai/summarize-page", requireAuth, async (c) => {
    const auth = c.get("auth");
    if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: "ai_unavailable" }, 503);
    if (c.env.AI_LIMITER && !(await c.env.AI_LIMITER.limit({ key: `ai:${auth.user.id}` })).success) return c.json({ error: "rate_limited" }, 429);
    const body = (await c.req.json().catch(() => null)) as { text?: unknown } | null;
    if (typeof body?.text === "string" && body.text.length > MAX_PAGE_CHARS) return c.json({ error: "too_large" }, 413);
    const input = PageSummaryInputSchema.safeParse(body);
    if (!input.success || !input.data.text.trim()) return c.json({ error: "bad_request" }, 400);
    const now = deps.now();
    const limit = writeLimit(auth.user.plan);
    const used = await reserveAi(c.env.DB, auth.user.id, now, limit, "write_usage");
    if (used === null) return c.json({ error: "write_quota_exceeded", usage: { used: limit, limit } }, 429);
    try {
      const r = await deps.summarizePage(input.data, c.env.ANTHROPIC_API_KEY);
      return c.json({ summary: { tldr: r.tldr, points: r.points }, usage: { used, limit } });
    } catch (err) {
      await refundAi(c.env.DB, auth.user.id, now, "write_usage");
      if (err instanceof AiError) return c.json({ error: err.code, message: err.message }, err.code === "ai_busy" ? 503 : 502);
      throw err;
    }
  });

  // POST <16 kHz mono WAV, ≤ 35 s> → { text, segments, language, usage }. One piece of a
  // meeting's recording, transcribed by Whisper on Workers AI. The audio isn't stored.
  app.post("/api/ai/transcribe", requireAuth, async (c) => {
    const auth = c.get("auth");
    if (!c.env.AI) return c.json({ error: "ai_unavailable" }, 503);
    const declared = Number(c.req.header("Content-Length") ?? 0);
    if (declared > MAX_PIECE_BYTES) return c.json({ error: "too_large" }, 413);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.length > MAX_PIECE_BYTES) return c.json({ error: "too_large" }, 413);
    const seconds = wavSeconds(bytes);
    if (seconds === null || seconds < 0.2) return c.json({ error: "bad_request" }, 400);
    const now = deps.now();
    const limit = transcribeLimitSeconds(auth.user.plan);
    const cost = Math.ceil(seconds);
    const used = await reserveSeconds(c.env.DB, auth.user.id, now, cost, limit);
    if (used === null) return c.json({ error: "transcribe_quota_exceeded", usage: { usedSeconds: await transcribeUsage(c.env.DB, auth.user.id, now), limitSeconds: limit } }, 429);
    try {
      // Optional word list (names, jargon) as a hint for Whisper: comma-separated, URI-encoded.
      let vocabulary: string[] = [];
      try {
        vocabulary = cleanGlossary(decodeURIComponent(c.req.header("X-ProdLi-Vocabulary") ?? "").split(",")).slice(0, 40);
      } catch {
        vocabulary = [];
      }
      const r = await deps.transcribe(bytes, c.env.AI, vocabulary);
      return c.json({ ...r, usage: { usedSeconds: used, limitSeconds: limit } });
    } catch (err) {
      await refundSeconds(c.env.DB, auth.user.id, now, cost);
      if (err instanceof AiError) return c.json({ error: err.code, message: err.message }, 503);
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

  /** GET → the founder's growth report: counts only, no content or personal data (src/insights.ts). */
  app.get("/api/admin/funnel", requireAdmin, async (c) => c.json(await funnelReport(c.env.DB, deps.now())));

  // ── Uninstall survey (prodli.com/goodbye, opened by Chrome after removal) ──
  // Anonymous: only the reason, optional words and the extension version are kept.
  app.post("/api/feedback/uninstall", async (c) => {
    if (!isAllowedOrigin(c, c.req.header("Origin"))) return c.json({ error: "forbidden" }, 403);
    if (c.env.AUTH_LIMITER && !(await c.env.AUTH_LIMITER.limit({ key: `feedback:${c.req.header("CF-Connecting-IP") ?? "unknown"}` })).success) return c.json({ error: "rate_limited" }, 429);
    const feedback = parseUninstallFeedback(await c.req.json().catch(() => null));
    if (!feedback) return c.json({ error: "bad_request" }, 400);
    await saveUninstallFeedback(c.env.DB, feedback, deps.now());
    return c.json({ ok: true });
  });

  // ── Shared meeting notes (src/shares.ts) ──────────────────────────────────
  const shareUrl = (c: Ctx, id: string) => `${appOrigin(c)}/s/${id}`;
  const shareJson = (c: Ctx, r: ShareRow) => ({ id: r.id, url: shareUrl(c, r.id), meetingId: r.meeting_id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at, expiresAt: r.expires_at, views: r.views });

  /** POST <ShareInput> → { share }. Creates the meeting's link, or updates it. */
  app.post("/api/shares", requireAuth, async (c) => {
    const auth = c.get("auth");
    if (c.env.SYNC_LIMITER && !(await c.env.SYNC_LIMITER.limit({ key: `share:${auth.user.id}` })).success) return c.json({ error: "rate_limited" }, 429);
    const raw = await c.req.text();
    if (raw.length > MAX_SHARE_BYTES) return c.json({ error: "too_large", message: "These notes are too long to share." }, 413);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return c.json({ error: "bad_request" }, 400);
    }
    const input = ShareInputSchema.safeParse(parsed);
    if (!input.success) return c.json({ error: "bad_request" }, 400);
    // Links that never expire are a Pro feature (open to everyone until Pro is on sale).
    if (input.data.expiresDays === null && !proFeatureAllowed(auth.user.plan, c.env)) return c.json({ error: "pro_required", message: "Links that never expire are part of ProdLi Pro. Choose 7 or 30 days." }, 402);
    const row = await saveShare(c.env.DB, auth.user.id, input.data, deps.now());
    return c.json({ share: shareJson(c, row) });
  });

  app.get("/api/shares", requireAuth, async (c) => {
    const auth = c.get("auth");
    return c.json({ shares: (await listShares(c.env.DB, auth.user.id, deps.now())).map((r) => shareJson(c, r)) });
  });

  app.delete("/api/shares/:id", requireAuth, async (c) => {
    const auth = c.get("auth");
    return (await deleteShare(c.env.DB, auth.user.id, c.req.param("id"))) ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
  });

  /** The public, read-only page. */
  app.get("/s/:id", async (c) => {
    const row = await openShare(c.env.DB, c.req.param("id"), deps.now());
    return row ? c.body(renderSharePage(row), 200, SHARE_PAGE_HEADERS) : c.body(renderShareMissing(), 404, SHARE_PAGE_HEADERS);
  });

  /** Where Dodo returns people after checkout or the portal (src/proPage.ts). */
  app.get("/pro/done", (c) => {
    const url = new URL(c.req.url);
    const from: ProPageFrom = url.searchParams.get("from") === "portal" ? "portal" : "checkout";
    if (DODO_RETURN_PARAMS.some((k) => url.searchParams.has(k))) {
      const clean = new URL("/pro/done", url.origin);
      clean.searchParams.set("from", from);
      const status = url.searchParams.get("status");
      if (status && /^[a-z_]{1,40}$/i.test(status)) clean.searchParams.set("status", status);
      return c.redirect(clean.pathname + clean.search, 303);
    }
    return c.body(renderProPage(from, url.searchParams.get("status")), 200, SHARE_PAGE_HEADERS);
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
