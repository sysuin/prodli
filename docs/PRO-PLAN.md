# ProdLi Pro and Pro Plus: setting up payments (Dodo Payments)

ProdLi Pro is sold through **Dodo Payments**, a *merchant of record*: Dodo is the seller in each sale. It takes the payment, charges and pays sales tax / VAT / GST, sends invoices and handles refunds and chargebacks. ProdLi never sees card details.

ProdLi is a **brand** under your existing, verified Dodo business (JobScanner), so there's no new account or KYC; payouts go to the same bank account. The brand is already created: name *ProdLi*, support email contact@prodli.com, logo, statement descriptor `DODOPAY_PRODLI` (Settings → Business → Brands).

Until the settings below are filled in, the app shows "ProdLi Pro is coming soon" and nothing can be bought.

## Plans

Three plans (2026-11-24): **Free**, **Pro** ($5/month or $48/year) and **Pro Plus** ($12/month or $120/year, everything in Pro with higher limits). Pro's limits were lowered the same day so a Pro user who uses everything costs about $6 a month at most (Claude Haiku 5.5 $0.10/$0.50 per million tokens, Whisper on Workers AI $0.0005 per audio minute); a Pro Plus user at most about $15. Real use is usually 10–20% of the limits.

| Per month | Free | Pro | Pro Plus |
|---|---|---|---|
| AI meeting summaries | 20 | 300 | 900 |
| AI daily briefs & weekly reviews | 62 | 200 | 400 |
| Ask ProdLi questions | 100 | 500 | 1,200 |
| Writing help (✨ Improve, follow-ups, screenshot text) | 200 | 1,000 | 2,500 |
| AI audio transcription | 300 min | 1,500 min | 4,500 min |
| Voice dictation AI clean-ups (the audio counts as transcription) | 1,000 | 3,000 | 6,000 |
| Synced storage | 100 MB | 2 GB | 10 GB |
| Your own meeting templates | — | ✓ |
| Talk-time insights | — | ✓ |
| Action items across all meetings | — | ✓ |
| AI meeting prep (counts toward briefs) | — | ✓ |
| Focus trends (30 and 90 days) | — | ✓ |
| Your writing style (writing help and follow-ups) | — | ✓ |
| Meeting series history | — | ✓ |
| Notes in your language | — | ✓ |
| Prep reminders before meetings | — | ✓ |
| Key moments in summaries (★ Mark moment) | — | ✓ |
| Meeting insights (where your meeting time goes) | — | ✓ |
| Meeting coach (🎯 AI feedback on a meeting; counts as a summary) | — | ✓ |
| Summaries that build on your own notes (📝 Your notes) | — | ✓ |
| Decision log (🧭 every decision from every meeting) | — | ✓ |
| Meeting type rules (pick the type from the meeting's name) | — | ✓ |
| Dictation Command Mode (select text, say how to change it) | — | ✓ |
| Shared notes links that never expire | 7 or 30 days | ✓ |

**Pro-only features** are checked on the server with `proFeatureAllowed` (`artifacts/prodli-api/src/billing.ts`). Until Pro is on sale (`productsOnSale` is null), they're open to everyone as early access, and `/api/billing` says `earlyAccess: true`; they become Pro-only by themselves once the Dodo settings below are in place.

The numbers live in `artifacts/prodli-api/src/ai.ts`, `brief.ts`, `ask.ts`, `write.ts` and `syncStore.ts` (the account window reads them from the server; update the Terms text if you change them).

Suggested price: **$5/month or $48/year** (two months free). The app shows the price from Dodo.

## 1. Test mode first (test cards, no real money)

**Done:** the ProdLi brand also exists in test mode (Dodo keeps brands per mode), with two products, already in `env.staging.vars`:
- ProdLi Pro (Monthly): `pdt_0Nrhskgoru9SBqjRagidr`, $5 every month
- ProdLi Pro (Yearly): `pdt_0NrhszgAdnghjeQRShn7u`, $48 every year

Prices are tax-exclusive (Dodo adds tax at checkout). Turn on *Tax Inclusive Pricing* on a product if you want $5 to be the final price. **Left for you:** steps 2, 3 and 5 below (API key, webhook, the two secrets).

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

**Done (21 Nov 2026):** live products imported from Test mode (brand ProdLi): ProdLi Pro (Monthly) `pdt_0NsQmaoynGpbLkII9UlW0`, $5 a month, and ProdLi Pro (Yearly) `pdt_0NsQmag3mV5vpOWnPiT6N`, $48 a year, in `env.production.vars`. Live webhook endpoint `ep_3MQ0xGOC13zRK280G6NwhGawHZs` → `https://app.prodli.com/api/billing/webhook`, all `subscription.*` events. Selling starts once the two production secrets are set and this config is deployed; from then on the Pro features need Pro (early access ends).

1. Switch the dashboard to **Live Mode** and repeat steps 1–3 with the webhook URL `https://app.prodli.com/api/billing/webhook`. (Dodo may review the new products and the brand's website, so have prodli.com with the final Privacy Policy and Terms live first.)
2. Fill `env.production.vars` in `wrangler.jsonc` (`DODO_ENV: "live"`, live product IDs), then:
   ```bash
   pnpm --filter @workspace/prodli-api exec wrangler secret put DODO_API_KEY --env production
   pnpm --filter @workspace/prodli-api exec wrangler secret put DODO_WEBHOOK_SECRET --env production
   pnpm --filter @workspace/prodli-api run deploy:production
   ```
   (The deploy applies migration `0007_billing_customers.sql`.)

## Pro Plus (2026-11-24)

Products created in Test Mode and imported to Live (brand ProdLi, tax category SaaS, prices tax-exclusive like Pro), already in `wrangler.jsonc`:
- Test: ProdLi Pro Plus (Monthly) `pdt_0NscNWBlygXD2Z8IFNSQU` $12/month · ProdLi Pro Plus (Yearly) `pdt_0NscNiMZcdNKW7eMRmMSO` $120/year
- Live: ProdLi Pro Plus (Monthly) `pdt_0NscNqMoBSbttL6KZtAAp` $12/month · ProdLi Pro Plus (Yearly) `pdt_0NscNqHcM1KzjyfRpnn4z` $120/year

The existing webhook endpoints already send every `subscription.*` event (including `plan_changed`), so nothing else changes in Dodo.

**Buying and switching:** Settings → Plan & usage shows the three plans with a Monthly / Yearly switch. One click opens Dodo's one-page checkout (card and postcode, saved cards offered, no phone number) and comes straight back. Signed out, the button signs in first and then carries on to the checkout; prodli.com's pricing buttons link to `app.prodli.com/?plan=pro|plus&period=monthly|yearly`, which does the same. Subscribers switch with `POST /api/billing/change` (Dodo's change-plan): a higher plan, or monthly → yearly, starts now with the unused time credited (`prorated_immediately`); a lower plan starts at the next renewal. Apps from before Pro Plus see Pro Plus as `plan: "pro"`; the exact plan is `tier`.

## How it works

- **Free trial (reverse trial):** new accounts get 14 days of Pro (`TRIAL_DAYS` var in `wrangler.jsonc`, staging and production; unset in dev and tests). `users.trial_ends_at` is set once when the account is created; `users.plan` stays `free`, and `toUser` in `src/accounts.ts` reports `plan: "pro"` with `trialEndsAt` while it runs, so limits and Pro features apply and checkout still works. Existing accounts never get one. The app shows "Pro trial: N days left" on the plan screen, a reminder on Today in the last 3 days (with what ProdLi did during the trial), and a monthly recap in the first days of each month (`lib/valueRecap.ts`, counted on the device).

- **Checkout:** "Upgrade to Pro" asks the server (`POST /api/billing/checkout`) to create a Dodo customer for the account (once, saved in D1 `billing_customers`) and a checkout session, then opens Dodo's hosted checkout in a new tab, from the extension and the web app alike. After paying, Dodo returns to `app.prodli.com/pro/done` (a thank-you page served by the Worker, `src/proPage.ts`).
- **Webhooks** (`POST /api/billing/webhook`) are verified with the Standard Webhooks signature (`webhook-id`, `webhook-timestamp`, `webhook-signature`, HMAC-SHA256) and a 5-minute window. Each user has one row in D1 `subscriptions`; `users.plan` is `pro` while the status is `active` or `past_due` (grace period after a failed renewal) and `free` otherwise (`on_hold`, `cancelled`, `expired`, `failed`). Old or repeated events are ignored.
- **Manage subscription** opens Dodo's customer portal (change plan or card, invoices, cancel). A cancellation at the end of the period keeps Pro until then.
- **Deleting an account** cancels its subscription at Dodo first.
