// ProdLi Pro (server: /api/billing, src/billing.ts there).
//
// Checkout is Paddle's overlay on the web app (app.prodli.com): Paddle is the
// merchant of record, so card details never touch ProdLi. The extension can't
// load Paddle's script (Chrome extensions only run their own code), so it opens
// the web app at /?upgrade=monthly|yearly, which continues there.

import { accountRequest, apiBase, refreshAccount, type ProdliUser } from "./prodliAccount";

export type Interval = "monthly" | "yearly";

export interface PlanLimits {
  storageBytes: number;
  summaries: number;
  briefs: number;
  asks: number;
}

export interface Billing {
  plan: "free" | "pro";
  checkout: { environment: "sandbox" | "production"; clientToken: string; prices: { monthly: string | null; yearly: string | null } } | null;
  canManage: boolean;
  subscription: { status: string; interval: string | null; renewsAt: number | null; endsAt: number | null } | null;
  limits: { free: PlanLimits; pro: PlanLimits };
}

export const getBilling = () => accountRequest<Billing>("/api/billing");

export async function openPortal(): Promise<void> {
  const { url } = await accountRequest<{ url: string }>("/api/billing/portal", { method: "POST" });
  window.open(url, "_blank", "noopener");
}

const isExtension = () => typeof chrome !== "undefined" && !!chrome.runtime?.id;

/** Opens the upgrade page (extension → web app). */
export function upgradeInWebApp(interval: Interval): void {
  const url = `${apiBase() || window.location.origin}/?upgrade=${interval}`;
  if (isExtension() && chrome.tabs) void chrome.tabs.create({ url });
  else window.open(url, "_blank", "noopener");
}

// ── Paddle.js (web app only) ────────────────────────────────────────────────

interface PaddleEventData {
  name?: string;
}
interface PaddleJs {
  Environment: { set(env: string): void };
  Initialize(o: { token: string; eventCallback?: (e: PaddleEventData) => void }): void;
  Checkout: { open(o: unknown): void };
  PricePreview(o: unknown): Promise<{ data: { details: { lineItems: { price: { id: string }; formattedTotals: { total: string } }[] } } }>;
}

let paddle: Promise<PaddleJs> | null = null;
let onCompleted: (() => void) | null = null;

function loadPaddle(checkout: NonNullable<Billing["checkout"]>): Promise<PaddleJs> {
  return (paddle ??= new Promise<PaddleJs>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
    s.onload = () => {
      const P = (window as unknown as { Paddle?: PaddleJs }).Paddle;
      if (!P) return reject(new Error("Paddle didn't load."));
      if (checkout.environment === "sandbox") P.Environment.set("sandbox");
      P.Initialize({ token: checkout.clientToken, eventCallback: (e) => e.name === "checkout.completed" && onCompleted?.() });
      resolve(P);
    };
    s.onerror = () => {
      paddle = null;
      reject(new Error("The payment page didn't load. Check your connection and try again."));
    };
    document.head.appendChild(s);
  }));
}

/** Local prices ("$5.00", "₹399.00") from Paddle, for the plans on sale. */
export async function localPrices(checkout: NonNullable<Billing["checkout"]>): Promise<Partial<Record<Interval, string>>> {
  if (isExtension()) return {};
  const P = await loadPaddle(checkout);
  const ids = (["monthly", "yearly"] as const).filter((i) => checkout.prices[i]);
  const r = await P.PricePreview({ items: ids.map((i) => ({ priceId: checkout.prices[i], quantity: 1 })) });
  const out: Partial<Record<Interval, string>> = {};
  for (const i of ids) {
    const line = r.data.details.lineItems.find((l) => l.price.id === checkout.prices[i]);
    if (line) out[i] = line.formattedTotals.total;
  }
  return out;
}

/**
 * Opens Paddle's checkout. Resolves when the payment went through and the
 * server has switched the account to Pro (Paddle's webhook usually takes a few seconds).
 */
export async function checkout(billing: Billing, interval: Interval, user: ProdliUser, dark: boolean): Promise<"pro" | "pending"> {
  const c = billing.checkout;
  const priceId = c?.prices[interval];
  if (!c || !priceId) throw new Error("ProdLi Pro isn't available yet.");
  const P = await loadPaddle(c);
  await new Promise<void>((resolve) => {
    onCompleted = () => {
      onCompleted = null;
      resolve();
    };
    P.Checkout.open({
      items: [{ priceId, quantity: 1 }],
      customer: { email: user.email },
      customData: { userId: user.id },
      settings: { displayMode: "overlay", theme: dark ? "dark" : "light", allowLogout: false, showAddDiscounts: true },
    });
  });
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const b = await getBilling().catch(() => null);
    if (b?.plan === "pro") {
      await refreshAccount();
      return "pro";
    }
  }
  return "pending";
}

export const formatBytes = (n: number) => (n >= 1024 ** 3 ? `${Math.round(n / 1024 ** 3)} GB` : `${Math.round(n / 1024 ** 2)} MB`);

/** Opens the account window at the plan section (App.tsx listens). */
export const UPGRADE_EVENT = "prodli-upgrade";
export function openUpgrade(): void {
  window.dispatchEvent(new CustomEvent(UPGRADE_EVENT));
}
