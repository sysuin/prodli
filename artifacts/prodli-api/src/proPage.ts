// The page Dodo sends people back to after checkout or the customer portal
// (/pro/done). It's on the server, not in the web app, because most people
// upgrade from the extension and aren't signed in to the web app: they'd land
// in an empty app (or its welcome tour) with nothing saying the payment worked.
// The webhook is what turns Pro on; this page only says what happens next.
//
// Dodo appends subscription_id, payment_id, status and the buyer's email to the
// return URL. The route redirects to a clean URL (keeping only `status`) so the
// email doesn't sit in the address bar or the browser history.

import { PAGE_STYLE } from "./shares";

export type ProPageFrom = "checkout" | "portal";

const FAILED = new Set(["failed", "cancelled", "canceled", "expired", "requires_payment_method"]);
const PENDING = new Set(["pending", "processing", "requires_customer_action", "on_hold"]);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Dodo's query parameters that shouldn't stay in the address bar. */
export const DODO_RETURN_PARAMS = ["subscription_id", "payment_id", "email"];

export function proPageContent(from: ProPageFrom, status: string | null): { title: string; body: string[]; ok: boolean } {
  const s = (status ?? "").toLowerCase();
  if (from === "portal") {
    return { ok: true, title: "You're all set", body: ["Any change you made to your subscription shows up in ProdLi within a few seconds.", "You can close this tab and go back to ProdLi."] };
  }
  if (FAILED.has(s)) {
    return { ok: false, title: "The payment didn't go through", body: ["You haven't been charged.", "Close this tab and try again from ProdLi: Settings → Plan & usage."] };
  }
  if (PENDING.has(s)) {
    return { ok: true, title: "Your payment is processing", body: ["Pro switches on as soon as Dodo Payments confirms it, usually within a minute, on every device you're signed in on.", "You can close this tab and go back to ProdLi."] };
  }
  return {
    ok: true,
    title: "You're on ProdLi Pro",
    body: ["Thanks for upgrading. Pro switches on within a few seconds on every device you're signed in on, with no need to sign in again.", "You can close this tab and go back to ProdLi. Your receipt from Dodo Payments is on its way to your inbox."],
  };
}

/** The page (escaped; no scripts). */
export function renderProPage(from: ProPageFrom, status: string | null): string {
  const p = proPageContent(from, status);
  const mark = p.ok ? `<p class="mark" aria-hidden="true">✓</p>` : "";
  const webLink = from === "checkout" && !p.ok ? "" : `<p class="actions"><a class="btn" href="/?pro=thanks">Open ProdLi on the web</a></p>`;
  const style = `${PAGE_STYLE}.mark{display:inline-block;margin:0 0 12px;width:44px;height:44px;line-height:40px;text-align:center;font-size:24px;font-weight:700;background:#FFD43B;border:3px solid #000}.actions{margin:20px 0 0}.btn{display:inline-block;padding:8px 16px;background:#000;color:#fff;font-weight:700;text-decoration:none;border:3px solid #000}.btn:hover{background:#FF4FA3;color:#000}@media (prefers-color-scheme:dark){.mark{color:#000;border-color:#eee}.btn{background:#eee;color:#000;border-color:#eee}}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${esc(p.title)} · ProdLi</title><style>${style}</style></head><body><main><article>${mark}<h1>${esc(p.title)}</h1>${p.body.map((b) => `<p>${esc(b)}</p>`).join("")}${webLink}</article><footer><a href="https://prodli.com" rel="noopener">ProdLi</a> · Payments by Dodo Payments</footer></main></body></html>`;
}
