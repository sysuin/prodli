// ProdLi Pro (server: /api/billing, src/billing.ts there), billed through
// Dodo Payments (merchant of record: card details never touch ProdLi).
//
// Checkout is Dodo's hosted page: the server creates a checkout session for the
// signed-in user and returns its URL. It opens in a new tab from both the
// extension and the web app; after paying, Dodo returns to app.prodli.com/pro/done
// and the webhook switches the account to Pro (every device picks it up).

import { accountRequest, refreshAccount } from "./prodliAccount";
import { desktop } from "./desktop";

export type Interval = "monthly" | "yearly";
export type PaidPlan = "pro" | "plus";
export type Tier = "free" | PaidPlan;
export const PLAN_NAMES: Record<Tier, string> = { free: "Free", pro: "Pro", plus: "Pro Plus" };
type PriceInfo = { amount: number; currency: string };

/** A paid plan on sale: which billing periods, and their prices. */
export interface PlanOffer {
  onSale: Record<Interval, boolean>;
  prices: Partial<Record<Interval, PriceInfo | null>>;
}

export interface PlanLimits {
  storageBytes: number;
  summaries: number;
  briefs: number;
  asks: number;
  /** Writing help (✨ Improve). Optional: older servers don't send it. */
  writes?: number;
  /** AI audio transcription, minutes a month. Optional: older servers don't send it. */
  transcribeMinutes?: number;
  /** AI clean-ups of voice dictation a month. */
  dictations?: number;
  /** Writing check: ProdLi AI checks a month (checks on the computer itself don't count). */
  checks?: number;
  /** Shared videos: how many (null: unlimited) and how long each. */
  videos?: { videos: number | null; maxSec: number };
}

export interface Billing {
  /** "free" | "pro" (Pro Plus is "pro" here, for older apps); `tier` is exact. */
  plan: "free" | "pro";
  /** The exact plan (older servers don't send it). */
  tier?: Tier;
  /** Every paid plan on sale (older servers don't send it). */
  plans?: Partial<Record<PaidPlan, PlanOffer>>;
  onSale: { monthly: boolean; yearly: boolean } | null;
  prices: Partial<Record<Interval, PriceInfo | null>>;
  canManage: boolean;
  subscription: { status: string; interval: string | null; renewsAt: number | null; endsAt: number | null; plan?: PaidPlan } | null;
  limits: { free: PlanLimits; pro: PlanLimits; plus?: PlanLimits };
  /** Pro-only features are open to everyone until Pro is on sale (older servers don't send it). */
  earlyAccess?: boolean;
  /** The free 14-day Pro trial while it runs (plan is "pro" then, with no subscription). Older servers don't send it. */
  trial?: { endsAt: number } | null;
}

/** Whole days left in a trial ending at `endsAt` (at least 1 while it runs). */
export function trialDaysLeft(endsAt: number, now = Date.now()): number {
  return Math.max(1, Math.ceil((endsAt - now) / 86_400_000));
}

export const getBilling = () => accountRequest<Billing>("/api/billing");

/** The plans, prices and limits, without signing in (the plan picker before sign-in). */
export interface PublicPlans {
  plans: Partial<Record<PaidPlan, PlanOffer>>;
  earlyAccess: boolean;
  limits: { free: PlanLimits; pro: PlanLimits; plus?: PlanLimits };
}
export const getPlans = () => accountRequest<PublicPlans>("/api/billing/plans");

/** The exact plan from a billing answer (older servers: free or pro). */
export const tierOf = (b: Pick<Billing, "plan" | "tier">): Tier => b.tier ?? b.plan;

/** "Save 20%": what paying yearly saves against 12 monthly payments, or null. */
export function yearlySaving(offer: PlanOffer | undefined): number | null {
  const m = offer?.prices.monthly;
  const y = offer?.prices.yearly;
  if (!m || !y || m.currency !== y.currency || m.amount <= 0) return null;
  const pct = Math.round((1 - y.amount / (12 * m.amount)) * 100);
  return pct > 0 ? pct : null;
}

/**
 * Picked a plan while signed out: remembered for a few minutes, so signing in
 * carries straight on to the checkout (PlanPicker picks it up).
 */
export const PENDING_UPGRADE_KEY = "pendingUpgrade";
export interface PendingUpgrade {
  plan: PaidPlan;
  interval: Interval;
  at: number;
}
export const pendingUpgradeFresh = (p: PendingUpgrade | null, now = Date.now()): p is PendingUpgrade => !!p && (p.plan === "pro" || p.plan === "plus") && (p.interval === "monthly" || p.interval === "yearly") && now - p.at < 15 * 60_000;

export interface ProAccess {
  signedIn: boolean;
  /** May use Pro-only features now (Pro, or early access before Pro is on sale). */
  allowed: boolean;
  earlyAccess: boolean;
  pro: boolean;
  /** When the free Pro trial ends, while it runs. */
  trialEndsAt?: number | null;
}

/** Whether Pro-only features (your own meeting templates, links that never expire) are available. */
export async function getProAccess(): Promise<ProAccess> {
  const b = await getBilling().catch(() => null);
  if (!b) return { signedIn: false, allowed: false, earlyAccess: false, pro: false };
  const pro = b.plan === "pro"; // Pro and Pro Plus
  const earlyAccess = b.earlyAccess ?? !b.onSale;
  return { signedIn: true, allowed: pro || earlyAccess, earlyAccess: earlyAccess && !pro, pro, trialEndsAt: b.trial?.endsAt ?? null };
}

const isExtension = () => typeof chrome !== "undefined" && !!chrome.runtime?.id && !!chrome.tabs;

function openTab(url: string): void {
  if (isExtension()) void chrome.tabs.create({ url });
  else if (desktop()) void desktop()!.openExternal(url);
  else window.open(url, "_blank", "noopener");
}

/**
 * Dodo's checkout: a new tab in the extension, the browser from the desktop app,
 * and this tab on the web (a new tab opened after a sign-in or a wait would be
 * stopped by the popup blocker; Dodo comes back to /pro/done afterwards).
 */
function openCheckout(url: string): "here" | "elsewhere" {
  if (isExtension() || desktop()) {
    openTab(url);
    return "elsewhere";
  }
  window.location.assign(url);
  return "here";
}

export async function openPortal(): Promise<void> {
  const { url } = await accountRequest<{ url: string }>("/api/billing/portal", { method: "POST" });
  openTab(url);
}

/** Waits (up to ~5 minutes) until the account is on `plan`; true when it is. */
async function waitForPlan(plan: PaidPlan, interval: Interval | null, signal?: AbortSignal): Promise<boolean> {
  for (let i = 0; i < 100 && !signal?.aborted; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const b = await getBilling().catch(() => null);
    const on = b && !b.trial && (b.tier ? b.tier === plan : plan === "pro" && b.plan === "pro");
    const period = !interval || !b?.subscription?.interval || b.subscription.interval === (interval === "yearly" ? "year" : "month");
    if (on && period) {
      await refreshAccount();
      return true;
    }
  }
  return false;
}

/**
 * Opens Dodo's checkout (one page) in a new tab, then waits for the account to
 * switch to the plan. Resolves "done" when it does, "pending" otherwise.
 */
export async function checkout(plan: PaidPlan, interval: Interval, signal?: AbortSignal): Promise<"done" | "pending"> {
  const { url } = await accountRequest<{ url: string }>("/api/billing/checkout", { method: "POST", body: JSON.stringify({ plan, interval }) });
  if (openCheckout(url) === "here") return "pending";
  return (await waitForPlan(plan, interval, signal)) ? "done" : "pending";
}

/**
 * Moves the current subscription to another plan or billing period. Higher
 * plans (and monthly → yearly) start now, charged the difference; lower ones at
 * the next renewal. Resolves "done" (switched), "pending" (charged, waiting for
 * Dodo) or "at_renewal".
 */
export async function changePlan(plan: PaidPlan, interval: Interval, signal?: AbortSignal): Promise<"done" | "pending" | "at_renewal"> {
  const { change } = await accountRequest<{ change: "now" | "at_renewal" }>("/api/billing/change", { method: "POST", body: JSON.stringify({ plan, interval }) });
  if (change === "at_renewal") return "at_renewal";
  return (await waitForPlan(plan, interval, signal)) ? "done" : "pending";
}

/** "$5", "₹399" — Dodo amounts are in the currency's smallest unit. */
export function formatPrice(p: { amount: number; currency: string }): string {
  try {
    const fmt = new Intl.NumberFormat(undefined, { style: "currency", currency: p.currency });
    const digits = fmt.resolvedOptions().maximumFractionDigits ?? 2;
    const value = p.amount / 10 ** digits;
    return new Intl.NumberFormat(undefined, { style: "currency", currency: p.currency, maximumFractionDigits: Number.isInteger(value) ? 0 : digits }).format(value);
  } catch {
    return `${(p.amount / 100).toFixed(2)} ${p.currency}`;
  }
}

export const formatBytes = (n: number) => (n >= 1024 ** 3 ? `${Math.round(n / 1024 ** 3)} GB` : `${Math.round(n / 1024 ** 2)} MB`);

/** Opens the account window at the plan section (App.tsx listens). */
export const UPGRADE_EVENT = "prodli-upgrade";
export function openUpgrade(): void {
  window.dispatchEvent(new CustomEvent(UPGRADE_EVENT));
}
