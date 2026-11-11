// ProdLi Pro, billed through Paddle (merchant of record: Paddle sells the
// subscription, charges tax and sends invoices; ProdLi never sees card details).
//
// Flow: the web app opens Paddle's checkout with the user's id in custom_data →
// Paddle sends subscription webhooks to POST /api/billing/webhook (signed) →
// we keep one row per user in D1 `subscriptions` and set users.plan.
// The plan decides the limits (sync storage, AI allowances).
//
// Settings (wrangler.jsonc vars, public): PADDLE_ENV ("sandbox" | "production"),
// PADDLE_CLIENT_TOKEN, PADDLE_PRICE_MONTHLY, PADDLE_PRICE_YEARLY.
// Secrets: PADDLE_WEBHOOK_SECRET (the notification destination's secret key),
// PADDLE_API_KEY (customer portal links, cancelling when an account is deleted).

export type PaddleEnv = "sandbox" | "production";

export interface BillingVars {
  PADDLE_ENV?: string;
  PADDLE_CLIENT_TOKEN?: string;
  PADDLE_PRICE_MONTHLY?: string;
  PADDLE_PRICE_YEARLY?: string;
  PADDLE_WEBHOOK_SECRET?: string;
  PADDLE_API_KEY?: string;
}

export interface CheckoutConfig {
  environment: PaddleEnv;
  clientToken: string;
  prices: { monthly: string | null; yearly: string | null };
}

/** Checkout settings for the app, or null when Pro can't be bought on this server yet. */
export function checkoutConfig(env: BillingVars): CheckoutConfig | null {
  const clientToken = env.PADDLE_CLIENT_TOKEN?.trim();
  const monthly = env.PADDLE_PRICE_MONTHLY?.trim() || null;
  const yearly = env.PADDLE_PRICE_YEARLY?.trim() || null;
  // Without the webhook secret a payment could never turn Pro on, so don't sell.
  if (!clientToken || (!monthly && !yearly) || !env.PADDLE_WEBHOOK_SECRET) return null;
  return { environment: env.PADDLE_ENV === "production" ? "production" : "sandbox", clientToken, prices: { monthly, yearly } };
}

// ── Webhook signature (Paddle-Signature: ts=…;h1=…) ─────────────────────────

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signPaddle(rawBody: string, secret: string, ts: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ts}:${rawBody}`)));
}

/** True when the header is a valid signature of exactly this body, made recently. */
export async function verifyPaddleSignature(rawBody: string, header: string | undefined, secret: string, nowMs: number, toleranceSec = 300): Promise<boolean> {
  if (!header || !secret) return false;
  const parts = header.split(";").map((p) => p.trim().split("="));
  const ts = Number(parts.find(([k]) => k === "ts")?.[1]);
  const sigs = parts.filter(([k]) => k === "h1").map(([, v]) => v ?? "");
  if (!Number.isFinite(ts) || !sigs.length) return false;
  if (Math.abs(nowMs / 1000 - ts) > toleranceSec) return false;
  const expected = await signPaddle(rawBody, secret, ts);
  return sigs.some((s) => safeEqual(s, expected));
}

// ── Subscriptions ───────────────────────────────────────────────────────────

/** Statuses that keep Pro on (past_due: Paddle is retrying the payment). */
const PRO_STATUSES = new Set(["active", "trialing", "past_due"]);
export const planFor = (status: string) => (PRO_STATUSES.has(status) ? "pro" : "free");

interface PaddleSubscription {
  id?: string;
  status?: string;
  customer_id?: string;
  custom_data?: { userId?: unknown } | null;
  items?: { price?: { id?: string } }[];
  billing_cycle?: { interval?: string } | null;
  current_billing_period?: { ends_at?: string } | null;
  scheduled_change?: { action?: string; effective_at?: string } | null;
}

export interface PaddleEvent {
  event_id?: string;
  event_type?: string;
  occurred_at?: string;
  data?: PaddleSubscription;
}

export interface SubscriptionRow {
  user_id: string;
  subscription_id: string;
  customer_id: string;
  status: string;
  price_id: string | null;
  billing_interval: string | null;
  period_end: number | null;
  cancel_at: number | null;
  event_at: number;
}

const ms = (iso: string | undefined | null) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : null;
};

export type ApplyResult = { applied: true; userId: string; plan: string } | { applied: false; reason: string };

/** Applies one subscription.* webhook event. Safe to receive twice or out of order. */
export async function applySubscriptionEvent(db: D1Database, event: PaddleEvent, nowMs: number): Promise<ApplyResult> {
  if (!event.event_type?.startsWith("subscription.")) return { applied: false, reason: "not_a_subscription_event" };
  const sub = event.data;
  if (!sub?.id || !sub.status || !sub.customer_id) return { applied: false, reason: "incomplete" };
  const at = ms(event.occurred_at) ?? nowMs;

  // Whose is it? The checkout passes our user id; later events may come without it.
  const claimed = typeof sub.custom_data?.userId === "string" ? sub.custom_data.userId : null;
  const known = await db.prepare(`SELECT * FROM subscriptions WHERE subscription_id = ?1`).bind(sub.id).first<SubscriptionRow>();
  const userId = known?.user_id ?? claimed;
  if (!userId || !(await db.prepare(`SELECT 1 FROM users WHERE id = ?1`).bind(userId).first())) return { applied: false, reason: "unknown_user" };

  const current = await db.prepare(`SELECT * FROM subscriptions WHERE user_id = ?1`).bind(userId).first<SubscriptionRow>();
  if (current?.subscription_id === sub.id && current.event_at > at) return { applied: false, reason: "stale" };
  // An old subscription ending must not end the newer one.
  if (current && current.subscription_id !== sub.id && planFor(current.status) === "pro" && planFor(sub.status) !== "pro") return { applied: false, reason: "superseded" };

  const row: SubscriptionRow = {
    user_id: userId,
    subscription_id: sub.id,
    customer_id: sub.customer_id,
    status: sub.status,
    price_id: sub.items?.[0]?.price?.id ?? null,
    billing_interval: sub.billing_cycle?.interval ?? null,
    period_end: ms(sub.current_billing_period?.ends_at),
    cancel_at: sub.scheduled_change?.action === "cancel" ? ms(sub.scheduled_change.effective_at) : null,
    event_at: at,
  };
  const plan = planFor(row.status);
  await db.batch([
    db.prepare(`DELETE FROM subscriptions WHERE subscription_id = ?1 AND user_id <> ?2`).bind(row.subscription_id, userId),
    db
      .prepare(
        `INSERT INTO subscriptions (user_id, provider, subscription_id, customer_id, status, price_id, billing_interval, period_end, cancel_at, event_at, updated_at)
         VALUES (?1, 'paddle', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(user_id) DO UPDATE SET subscription_id = ?2, customer_id = ?3, status = ?4, price_id = ?5, billing_interval = ?6, period_end = ?7, cancel_at = ?8, event_at = ?9, updated_at = ?10`,
      )
      .bind(userId, row.subscription_id, row.customer_id, row.status, row.price_id, row.billing_interval, row.period_end, row.cancel_at, row.event_at, nowMs),
    db.prepare(`UPDATE users SET plan = ?2 WHERE id = ?1`).bind(userId, plan),
  ]);
  return { applied: true, userId, plan };
}

export function getSubscription(db: D1Database, userId: string): Promise<SubscriptionRow | null> {
  return db.prepare(`SELECT * FROM subscriptions WHERE user_id = ?1`).bind(userId).first<SubscriptionRow>();
}

// ── Paddle API (portal links, cancel on account deletion) ───────────────────

export interface PaddleClient {
  /** A link to Paddle's customer portal: change plan, payment method, invoices, cancel. */
  portalUrl(customerId: string, subscriptionId: string): Promise<string>;
  /** Cancels right away (used when the account is deleted). */
  cancelNow(subscriptionId: string): Promise<void>;
}

export class BillingError extends Error {}

export function paddleClient(apiKey: string, environment: PaddleEnv, fetcher: typeof fetch = fetch): PaddleClient {
  const base = environment === "production" ? "https://api.paddle.com" : "https://sandbox-api.paddle.com";
  const call = async (path: string, body: unknown) => {
    const res = await fetcher(`${base}${path}`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) {
      console.error(JSON.stringify({ msg: "paddle_error", path: path.replace(/\/(ctm|sub)_[a-z0-9]+/g, "/$1_…"), status: res.status }));
      throw new BillingError(`Paddle answered ${res.status}`);
    }
    return (await res.json()) as { data?: unknown };
  };
  return {
    async portalUrl(customerId, subscriptionId) {
      const r = (await call(`/customers/${encodeURIComponent(customerId)}/portal-sessions`, { subscription_ids: [subscriptionId] })) as { data?: { urls?: { general?: { overview?: string } } } };
      const url = r.data?.urls?.general?.overview;
      if (!url) throw new BillingError("Paddle didn't return a portal link");
      return url;
    },
    async cancelNow(subscriptionId) {
      await call(`/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, { effective_from: "immediately" });
    },
  };
}
