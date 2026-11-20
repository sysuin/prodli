// ProdLi Pro, billed through Dodo Payments (merchant of record: Dodo sells the
// subscription, charges tax and sends invoices; ProdLi never sees card details).
// ProdLi is a brand under the owner's verified Dodo business.
//
// Flow: the app asks POST /api/billing/checkout → we create (once) a Dodo
// customer for the user and a checkout session → the user pays on Dodo's hosted
// checkout page → Dodo sends signed subscription webhooks to
// POST /api/billing/webhook → we keep one row per user in D1 `subscriptions`
// and set users.plan. The plan decides the limits (sync storage, AI allowances).
//
// Settings (wrangler.jsonc vars, public): DODO_ENV ("test" | "live"),
// DODO_PRODUCT_MONTHLY, DODO_PRODUCT_YEARLY (product ids, pdt_…).
// Secrets: DODO_API_KEY, DODO_WEBHOOK_SECRET (whsec_…).

export type DodoEnv = "test" | "live";

export interface BillingVars {
  DODO_ENV?: string;
  DODO_PRODUCT_MONTHLY?: string;
  DODO_PRODUCT_YEARLY?: string;
  DODO_API_KEY?: string;
  DODO_WEBHOOK_SECRET?: string;
  /** Local end-to-end tests only (a stand-in for Dodo's API); ignored unless ENV is "development". */
  DODO_API_BASE?: string;
}

export type Interval = "monthly" | "yearly";

export const dodoEnv = (env: BillingVars): DodoEnv => (env.DODO_ENV === "live" ? "live" : "test");

/** The products on sale, or null when Pro can't be bought on this server yet. */
export function productsOnSale(env: BillingVars): Partial<Record<Interval, string>> | null {
  // Without the webhook secret a payment could never turn Pro on, and without the
  // API key we can't start a checkout: don't sell.
  if (!env.DODO_API_KEY || !env.DODO_WEBHOOK_SECRET) return null;
  const out: Partial<Record<Interval, string>> = {};
  if (env.DODO_PRODUCT_MONTHLY?.trim()) out.monthly = env.DODO_PRODUCT_MONTHLY.trim();
  if (env.DODO_PRODUCT_YEARLY?.trim()) out.yearly = env.DODO_PRODUCT_YEARLY.trim();
  return out.monthly || out.yearly ? out : null;
}

/**
 * Pro-only features (custom meeting templates, links that never expire). While
 * Pro can't be bought on this server yet, they're open to everyone as early
 * access, so nobody hits a wall they can't pay past.
 */
export function proFeatureAllowed(plan: string, env: BillingVars): boolean {
  return plan === "pro" || !productsOnSale(env);
}

// ── Webhook signature (Standard Webhooks: webhook-id / -timestamp / -signature) ──

const enc = new TextEncoder();

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s);
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signWebhook(id: string, timestamp: number, rawBody: string, secret: string): Promise<string> {
  const keyBytes = secret.startsWith("whsec_") ? base64ToBytes(secret.slice(6)) : enc.encode(secret);
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesToBase64(await crypto.subtle.sign("HMAC", key, enc.encode(`${id}.${timestamp}.${rawBody}`)));
}

/** True when the headers are a valid, recent signature of exactly this body. */
export async function verifyWebhook(
  rawBody: string,
  headers: { id?: string; timestamp?: string; signature?: string },
  secret: string,
  nowMs: number,
  toleranceSec = 300,
): Promise<boolean> {
  if (!headers.id || !headers.timestamp || !headers.signature || !secret) return false;
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > toleranceSec) return false;
  let expected: string;
  try {
    expected = await signWebhook(headers.id, ts, rawBody, secret);
  } catch {
    return false; // malformed secret
  }
  return headers.signature
    .split(" ")
    .map((part) => part.split(","))
    .some(([version, sig]) => version === "v1" && !!sig && safeEqual(sig, expected));
}

// ── Subscriptions ───────────────────────────────────────────────────────────

/** Statuses that keep Pro on (past_due: a renewal failed and the grace period is running). */
const PRO_STATUSES = new Set(["active", "past_due"]);
export const planFor = (status: string) => (PRO_STATUSES.has(status) ? "pro" : "free");

interface DodoSubscription {
  payload_type?: string;
  subscription_id?: string;
  status?: string;
  customer?: { customer_id?: string } | null;
  metadata?: Record<string, unknown> | null;
  product_id?: string;
  payment_frequency_interval?: string;
  next_billing_date?: string | null;
  cancel_at_next_billing_date?: boolean;
}

export interface DodoEvent {
  type?: string;
  timestamp?: string;
  data?: DodoSubscription;
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
export async function applySubscriptionEvent(db: D1Database, event: DodoEvent, nowMs: number, ourProducts?: Set<string>): Promise<ApplyResult> {
  if (!event.type?.startsWith("subscription.")) return { applied: false, reason: "not_a_subscription_event" };
  const sub = event.data;
  // Webhooks are business-wide: other brands' subscriptions (e.g. JobScanner) arrive here too.
  if (ourProducts?.size && sub?.product_id && !ourProducts.has(sub.product_id)) return { applied: false, reason: "other_product" };
  const customerId = sub?.customer?.customer_id;
  if (!sub?.subscription_id || !sub.status || !customerId) return { applied: false, reason: "incomplete" };
  const at = ms(event.timestamp) ?? nowMs;

  // Whose is it? Known subscription → its user; else the customer we created at checkout; else metadata.
  const known = await db.prepare(`SELECT user_id FROM subscriptions WHERE subscription_id = ?1`).bind(sub.subscription_id).first<{ user_id: string }>();
  const byCustomer = await db.prepare(`SELECT user_id FROM billing_customers WHERE customer_id = ?1`).bind(customerId).first<{ user_id: string }>();
  const claimed = typeof sub.metadata?.userId === "string" ? sub.metadata.userId : null;
  const userId = known?.user_id ?? byCustomer?.user_id ?? claimed;
  if (!userId || !(await db.prepare(`SELECT 1 FROM users WHERE id = ?1`).bind(userId).first())) return { applied: false, reason: "unknown_user" };

  const current = await db.prepare(`SELECT * FROM subscriptions WHERE user_id = ?1`).bind(userId).first<SubscriptionRow>();
  if (current?.subscription_id === sub.subscription_id && current.event_at > at) return { applied: false, reason: "stale" };
  // An old subscription ending must not end the newer one.
  if (current && current.subscription_id !== sub.subscription_id && planFor(current.status) === "pro" && planFor(sub.status) !== "pro") return { applied: false, reason: "superseded" };

  const interval = sub.payment_frequency_interval?.toLowerCase();
  const row: SubscriptionRow = {
    user_id: userId,
    subscription_id: sub.subscription_id,
    customer_id: customerId,
    status: sub.status,
    price_id: sub.product_id ?? null,
    billing_interval: interval === "month" || interval === "year" ? interval : null,
    period_end: ms(sub.next_billing_date),
    cancel_at: sub.cancel_at_next_billing_date ? ms(sub.next_billing_date) : null,
    event_at: at,
  };
  const plan = planFor(row.status);
  await db.batch([
    db.prepare(`DELETE FROM subscriptions WHERE subscription_id = ?1 AND user_id <> ?2`).bind(row.subscription_id, userId),
    db
      .prepare(
        `INSERT INTO subscriptions (user_id, provider, subscription_id, customer_id, status, price_id, billing_interval, period_end, cancel_at, event_at, updated_at)
         VALUES (?1, 'dodo', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(user_id) DO UPDATE SET provider = 'dodo', subscription_id = ?2, customer_id = ?3, status = ?4, price_id = ?5, billing_interval = ?6, period_end = ?7, cancel_at = ?8, event_at = ?9, updated_at = ?10`,
      )
      .bind(userId, row.subscription_id, row.customer_id, row.status, row.price_id, row.billing_interval, row.period_end, row.cancel_at, row.event_at, nowMs),
    db.prepare(`UPDATE users SET plan = ?2 WHERE id = ?1`).bind(userId, plan),
  ]);
  return { applied: true, userId, plan };
}

export function getSubscription(db: D1Database, userId: string): Promise<SubscriptionRow | null> {
  return db.prepare(`SELECT * FROM subscriptions WHERE user_id = ?1`).bind(userId).first<SubscriptionRow>();
}

export async function getCustomerId(db: D1Database, userId: string): Promise<string | null> {
  return (await db.prepare(`SELECT customer_id FROM billing_customers WHERE user_id = ?1`).bind(userId).first<{ customer_id: string }>())?.customer_id ?? null;
}

export async function saveCustomerId(db: D1Database, userId: string, customerId: string, nowMs: number): Promise<void> {
  await db.prepare(`INSERT INTO billing_customers (user_id, provider, customer_id, created_at) VALUES (?1, 'dodo', ?2, ?3) ON CONFLICT(user_id) DO UPDATE SET customer_id = ?2`).bind(userId, customerId, nowMs).run();
}

// ── Dodo API ────────────────────────────────────────────────────────────────

export interface Price {
  amount: number; // lowest denomination (cents)
  currency: string;
}

export interface DodoClient {
  createCustomer(input: { email: string; name: string; userId: string }): Promise<string>;
  /** A hosted checkout page for one product. */
  checkoutUrl(input: { productId: string; customerId: string; userId: string; returnUrl: string }): Promise<string>;
  /** Dodo's customer portal: change plan or card, invoices, cancel. */
  portalUrl(customerId: string, returnUrl: string): Promise<string>;
  /** Cancels right away (used when the account is deleted). */
  cancelNow(subscriptionId: string): Promise<void>;
  price(productId: string): Promise<Price | null>;
}

export class BillingError extends Error {}

export function dodoClient(apiKey: string, environment: DodoEnv, fetcher: typeof fetch = fetch, baseOverride?: string): DodoClient {
  const base = baseOverride || (environment === "live" ? "https://live.dodopayments.com" : "https://test.dodopayments.com");
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetcher(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(JSON.stringify({ msg: "dodo_error", method, path: path.replace(/\/(cus|sub|pdt)_[A-Za-z0-9]+/g, "/$1_…"), status: res.status }));
      throw new BillingError(`Dodo answered ${res.status}`);
    }
    return (await res.json()) as T;
  };
  return {
    async createCustomer({ email, name, userId }) {
      const r = await call<{ customer_id?: string }>("POST", "/customers", { email, name: name || email, metadata: { userId } });
      if (!r.customer_id) throw new BillingError("Dodo didn't return a customer");
      return r.customer_id;
    },
    async checkoutUrl({ productId, customerId, userId, returnUrl }) {
      const r = await call<{ checkout_url?: string | null }>("POST", "/checkouts", {
        product_cart: [{ product_id: productId, quantity: 1 }],
        customer: { customer_id: customerId },
        metadata: { userId },
        return_url: returnUrl,
      });
      if (!r.checkout_url) throw new BillingError("Dodo didn't return a checkout page");
      return r.checkout_url;
    },
    async portalUrl(customerId, returnUrl) {
      const r = await call<{ link?: string }>("POST", `/customers/${encodeURIComponent(customerId)}/customer-portal/session?return_url=${encodeURIComponent(returnUrl)}`);
      if (!r.link) throw new BillingError("Dodo didn't return a portal link");
      return r.link;
    },
    async cancelNow(subscriptionId) {
      await call("PATCH", `/subscriptions/${encodeURIComponent(subscriptionId)}`, { status: "cancelled" });
    },
    async price(productId) {
      const r = await call<{ price?: { type?: string; price?: number; currency?: string } }>("GET", `/products/${encodeURIComponent(productId)}`);
      return r.price?.type === "recurring_price" && typeof r.price.price === "number" && r.price.currency ? { amount: r.price.price, currency: r.price.currency } : null;
    },
  };
}
