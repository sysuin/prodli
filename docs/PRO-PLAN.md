# ProdLi Pro: setting up payments (Dodo Payments)

ProdLi Pro is sold through **Dodo Payments**, a *merchant of record*: Dodo is the seller in each sale. It takes the payment, charges and pays sales tax / VAT / GST, sends invoices and handles refunds and chargebacks. ProdLi never sees card details.

ProdLi is a **brand** under your existing, verified Dodo business (JobScanner), so there's no new account or KYC; payouts go to the same bank account. The brand is already created: name *ProdLi*, support email contact@prodli.com, logo, statement descriptor `DODOPAY_PRODLI` (Settings → Business → Brands).

Until the settings below are filled in, the app shows "ProdLi Pro is coming soon" and nothing can be bought.

## What Pro includes

| Per month | Free | Pro |
|---|---|---|
| AI meeting summaries | 20 | 300 |
| AI daily briefs & weekly reviews | 62 | 200 |
| Ask ProdLi questions | 100 | 1,000 |
| Synced storage | 100 MB | 2 GB |

The numbers live in `artifacts/prodli-api/src/ai.ts`, `brief.ts`, `ask.ts` and `syncStore.ts` (the account window reads them from the server; update the Terms text if you change them).

Suggested price: **$5/month or $48/year** (two months free). The app shows the price from Dodo.

## 1. Test mode first (test cards, no real money)

In the Dodo dashboard, switch to **Test Mode** (bottom left), then:

1. **Products → Create product**, brand **ProdLi**, *Subscription*:
   - "ProdLi Pro (monthly)": $5, every 1 month
   - "ProdLi Pro (yearly)": $48, every 1 year

   Copy both product IDs (`pdt_…`).
2. **Developer → API keys → Create** → copy the key (shown once).
3. **Developer → Webhooks → Add endpoint**:
   - URL: `https://prodli-api-staging.sunnysinghnitb.workers.dev/api/billing/webhook`
   - Events: all `subscription.*` events (active, updated, renewed, on_hold, past_due, plan_changed, cancelled, expired, failed)
   - Copy the endpoint's signing secret (`whsec_…`).
4. Put the product IDs in `artifacts/prodli-api/wrangler.jsonc` → `env.staging.vars` (they're public):
   ```jsonc
   "DODO_ENV": "test",
   "DODO_PRODUCT_MONTHLY": "pdt_…",
   "DODO_PRODUCT_YEARLY": "pdt_…"
   ```
5. Secrets (you run these and paste when asked):
   ```bash
   pnpm --filter @workspace/prodli-api exec wrangler secret put DODO_API_KEY --env staging
   pnpm --filter @workspace/prodli-api exec wrangler secret put DODO_WEBHOOK_SECRET --env staging
   ```
6. Merge → CI deploys staging. In the staging web app or a staging extension build: sign in, Account → **Upgrade to Pro** → Dodo's checkout opens in a new tab → pay with a Dodo test card (Dodo docs → Testing). Within a few seconds the account window shows **You're on ProdLi Pro**. Then try **Manage subscription → Cancel**.

## 2. Live

1. Switch the dashboard to **Live Mode** and repeat steps 1–3 with the webhook URL `https://app.prodli.com/api/billing/webhook`. (Dodo may review the new products and the brand's website, so have prodli.com with the final Privacy Policy and Terms live first.)
2. Fill `env.production.vars` in `wrangler.jsonc` (`DODO_ENV: "live"`, live product IDs), then:
   ```bash
   pnpm --filter @workspace/prodli-api exec wrangler secret put DODO_API_KEY --env production
   pnpm --filter @workspace/prodli-api exec wrangler secret put DODO_WEBHOOK_SECRET --env production
   pnpm --filter @workspace/prodli-api run deploy:production
   ```
   (The deploy applies migration `0007_billing_customers.sql`.)

## How it works

- **Checkout:** "Upgrade to Pro" asks the server (`POST /api/billing/checkout`) to create a Dodo customer for the account (once, saved in D1 `billing_customers`) and a checkout session, then opens Dodo's hosted checkout in a new tab, from the extension and the web app alike. After paying, Dodo returns to `app.prodli.com/?pro=thanks`.
- **Webhooks** (`POST /api/billing/webhook`) are verified with the Standard Webhooks signature (`webhook-id`, `webhook-timestamp`, `webhook-signature`, HMAC-SHA256) and a 5-minute window. Each user has one row in D1 `subscriptions`; `users.plan` is `pro` while the status is `active` or `past_due` (grace period after a failed renewal) and `free` otherwise (`on_hold`, `cancelled`, `expired`, `failed`). Old or repeated events are ignored.
- **Manage subscription** opens Dodo's customer portal (change plan or card, invoices, cancel). A cancellation at the end of the period keeps Pro until then.
- **Deleting an account** cancels its subscription at Dodo first.
