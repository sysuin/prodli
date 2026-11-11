// ProdLi Pro (server: /api/billing, src/billing.ts there), billed through
// Dodo Payments (merchant of record: card details never touch ProdLi).
//
// Checkout is Dodo's hosted page: the server creates a checkout session for the
// signed-in user and returns its URL. It opens in a new tab from both the
// extension and the web app; after paying, Dodo returns to app.prodli.com/?pro=thanks
// and the webhook switches the account to Pro (every device picks it up).

import { accountRequest, refreshAccount } from "./prodliAccount";

export type Interval = "monthly" | "yearly";

export interface PlanLimits {
  storageBytes: number;
  summaries: number;
  briefs: number;
  asks: number;
}

export interface Billing {
  plan: "free" | "pro";
  onSale: { monthly: boolean; yearly: boolean } | null;
  prices: Partial<Record<Interval, { amount: number; currency: string } | null>>;
  canManage: boolean;
  subscription: { status: string; interval: string | null; renewsAt: number | null; endsAt: number | null } | null;
  limits: { free: PlanLimits; pro: PlanLimits };
}

export const getBilling = () => accountRequest<Billing>("/api/billing");

const isExtension = () => typeof chrome !== "undefined" && !!chrome.runtime?.id && !!chrome.tabs;

function openTab(url: string): void {
  if (isExtension()) void chrome.tabs.create({ url });
  else window.open(url, "_blank", "noopener");
}

export async function openPortal(): Promise<void> {
  const { url } = await accountRequest<{ url: string }>("/api/billing/portal", { method: "POST" });
  openTab(url);
}

/**
 * Opens Dodo's checkout in a new tab, then waits (up to ~5 minutes) for the
 * account to turn Pro. Resolves "pro" when it does, "pending" otherwise.
 */
export async function checkout(interval: Interval, signal?: AbortSignal): Promise<"pro" | "pending"> {
  const { url } = await accountRequest<{ url: string }>("/api/billing/checkout", { method: "POST", body: JSON.stringify({ interval }) });
  openTab(url);
  for (let i = 0; i < 100 && !signal?.aborted; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const b = await getBilling().catch(() => null);
    if (b?.plan === "pro") {
      await refreshAccount();
      return "pro";
    }
  }
  return "pending";
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
