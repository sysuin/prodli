# ProdLi on Cloudflare

ProdLi shares the Cloudflare account that hosts your other projects (jobscanner, vedlora, doeity). ProdLi's resources are kept apart by naming (`prodli-…`) and by keys limited to ProdLi wherever Cloudflare allows. Plan: [PLAN-WEB-APP.md](PLAN-WEB-APP.md).

## What's deployed

| Worker | Serves | Source | Deployed by |
|---|---|---|---|
| `prodli-site` | https://prodli.com (www and http:// redirect to it) | `artifacts/prodli-site` (static files from `pnpm run build:web`) | CI on push to main |
| `prodli-site-preview` | https://prodli-site-preview.sunnysinghnitb.workers.dev (manual previews) | same, `--env preview` | by hand |
| `prodli-api-staging` | https://prodli-api-staging.sunnysinghnitb.workers.dev/api/health | `artifacts/prodli-api` | CI on push to main |
| `prodli-api` (production) | app.prodli.com/api, from phase 1 | `artifacts/prodli-api` | CI, manual run only |

- The site's routes (`prodli.com/*`, `www.prodli.com/*`) attach to the proxied DNS records. Requests never reach the old Replit address the A records still show.
- Email DNS (Hostinger Mail) is **DNS only** and must stay that way. That covers MX, SPF, DMARC, the three `hostingermail-*._domainkey` DKIM records, `autoconfig` and `autodiscover`.

## Deploying by hand

From the repo root (Wrangler on this Mac is signed in to the account):

```bash
pnpm run build:web && pnpm --filter @workspace/prodli-api exec wrangler deploy -c ../prodli-site/wrangler.jsonc
```

```bash
pnpm --filter @workspace/prodli-api run deploy:staging
```

## CI secrets (one-time)

CI deploys with an API token. Create it at **dash.cloudflare.com → My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template**, then adjust:

- **Account Resources:** Include → *Sunnysinghnitb@gmail.com's Account*.
- **Zone Resources:** Include → *Specific zone* → **prodli.com**. Not "All zones", so the token can't change routes on your other domains.
- **Add these permissions** (needed in later phases):
  - Account → **D1** → Edit
  - Account → **Workers R2 Storage** → Edit
- Leave the template's other permissions.
- Leave IP filtering and TTL empty.

Copy the token (Cloudflare shows it once) and add two repository secrets:

```bash
gh secret set CLOUDFLARE_API_TOKEN --repo sysuin/prodli
```

```bash
gh secret set CLOUDFLARE_ACCOUNT_ID --repo sysuin/prodli --body 92d363869ce9f33cc7f3423541976375
```

Limits of what Cloudflare can scope: a token that deploys Workers can deploy *any* Worker in the account. That's why the token lives only in this repository's secrets. User data (per-user Durable Objects, from phase 2) is reachable only by the `prodli-api` Worker's code, never by your other Workers.

## Environments

| | Staging | Production |
|---|---|---|
| API Worker | `prodli-api-staging` | `prodli-api` |
| Data (from phase 1) | separate D1 database + Durable Objects | separate D1 database + Durable Objects |
| Secrets | `wrangler secret put NAME --env staging` | `wrangler secret put NAME --env production` |

Staging never touches production data.
