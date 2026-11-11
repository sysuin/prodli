# ProdLi Pro: setting up payments (Paddle)

ProdLi Pro is sold through **Paddle**, a *merchant of record*. Paddle is the seller in each sale: it takes the payment, charges and pays sales tax / VAT / GST in every country, sends invoices and handles refunds and chargebacks. ProdLi never sees card details. Paddle's fee is about 5% + $0.50 per transaction.

Until the settings below are filled in, the app shows "ProdLi Pro is coming soon" and nothing can be bought.

## What Pro includes

| Per month | Free | Pro |
|---|---|---|
| AI meeting summaries | 20 | 300 |
| AI daily briefs & weekly reviews | 62 | 200 |
| Ask ProdLi questions | 100 | 1,000 |
| Synced storage | 100 MB | 2 GB |

The numbers live in `artifacts/prodli-api/src/ai.ts`, `brief.ts`, `ask.ts` and `syncStore.ts`. The account window and the Terms read them from the server, so change them in one place (and update the Terms text).

Suggested price: **$5/month or $48/year** (two months free). Set prices in Paddle; the app shows Paddle's localized price.

## 1. Sandbox first (test cards, no real money)

1. Create a sandbox account at https://sandbox-vendors.paddle.com.
2. **Catalog → Products → New product** "ProdLi Pro" (tax category: *Standard digital goods* / SaaS). Add two prices: monthly ($5, billing every 1 month) and yearly ($48, every 1 year). Copy both price IDs (`pri_…`).
3. **Developer tools → Authentication → Client-side tokens → New** → copy the token (`test_…`).
4. **Developer tools → Authentication → API keys → New** with permissions: *Customers: read/write* (customer portal) and *Subscriptions: read/write* (cancel). Copy it (`pdl_sdbx_apikey_…`). Shown once.
5. **Developer tools → Notifications → New destination**:
   - URL: `https://prodli-api-staging.sunnysinghnitb.workers.dev/api/billing/webhook`
   - Events: `subscription.created`, `subscription.updated`, `subscription.activated`, `subscription.canceled`, `subscription.past_due`, `subscription.paused`, `subscription.resumed`, `subscription.trialing`
   - Copy the destination's **secret key** (`pdl_ntfset_…`).
6. **Checkout → Checkout settings**: default payment link `https://prodli-api-staging.sunnysinghnitb.workers.dev/` (Paddle requires one); approve the domain if asked.
7. Put the public values in `artifacts/prodli-api/wrangler.jsonc` → `env.staging.vars`:
   ```jsonc
   "PADDLE_ENV": "sandbox",
   "PADDLE_CLIENT_TOKEN": "test_…",
   "PADDLE_PRICE_MONTHLY": "pri_…",
   "PADDLE_PRICE_YEARLY": "pri_…"
   ```
   (Client tokens and price IDs are public: they ship in every checkout page.)
8. Secrets (you run these; paste when asked):
   ```bash
   pnpm --filter @workspace/prodli-api exec wrangler secret put PADDLE_WEBHOOK_SECRET --env staging
   pnpm --filter @workspace/prodli-api exec wrangler secret put PADDLE_API_KEY --env staging
   ```
9. Merge → CI deploys staging. Open the staging web app, sign in, Account → **Upgrade to Pro**, pay with Paddle's test card `4242 4242 4242 4242` (any future date, CVC `100`). Within a few seconds the account shows **ProdLi Pro**. Then try **Manage subscription → Cancel**.

## 2. Live

1. Sign up at https://vendors.paddle.com and complete **business verification** (Paddle reviews your website, so prodli.com with the final Privacy Policy, Terms, pricing and refund policy must be live first). Check that your country is supported for payouts.
2. Repeat steps 2–6 in the live dashboard with `https://app.prodli.com/api/billing/webhook` and `https://app.prodli.com/`.
3. Fill `env.production.vars` in `wrangler.jsonc` (`PADDLE_ENV: "production"`, `live_…` token, live price IDs), then:
   ```bash
   pnpm --filter @workspace/prodli-api exec wrangler secret put PADDLE_WEBHOOK_SECRET --env production
   pnpm --filter @workspace/prodli-api exec wrangler secret put PADDLE_API_KEY --env production
   pnpm --filter @workspace/prodli-api run deploy:production
   ```
   (The deploy applies migration `0006_subscriptions.sql`.)

## How it works

- **Checkout** runs on the web app only (Paddle's overlay). In the extension, "Upgrade to Pro" opens `app.prodli.com/?upgrade=yearly` (or monthly), which signs in with the same Google account and opens the checkout. The account ID goes to Paddle as `custom_data.userId`.
- **Webhooks** (`POST /api/billing/webhook`) are verified with the `Paddle-Signature` HMAC and a 5-minute window. Each user has one row in D1 `subscriptions`; `users.plan` is `pro` while the status is `active`, `trialing` or `past_due` (Paddle retries failed payments for a while), and `free` once it's `canceled` or `paused`. Old or repeated events are ignored.
- **Manage subscription** opens Paddle's customer portal (change plan or card, invoices, cancel).
- **Deleting an account** cancels its subscription at Paddle first.
