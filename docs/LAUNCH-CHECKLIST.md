# ProdLi launch checklist (phase 5)

✅ = done. **You:** = needs you (accounts, money, legal, or production access I don't have).

## Product
- ✅ Extension and web app (app.prodli.com) share one account and sync live (phases 1–2)
- ✅ Web app: every section works on desktop and phones; installable; opens offline (phase 3)
- ✅ AI summaries through ProdLi with a monthly allowance; own key still works (phase 4)
- **You:** try it on your phone at https://prodli-api-staging.sunnysinghnitb.workers.dev (Share → Add to Home Screen)

## Production
- **You:** deploy production (creates app.prodli.com, its certificate, database tables and nightly backups):
  ```bash
  pnpm --filter @workspace/prodli-api run deploy:production
  ```
- **You:** turn on AI summaries (paste your Anthropic key when asked; one per environment):
  ```bash
  pnpm --filter @workspace/prodli-api exec wrangler secret put ANTHROPIC_API_KEY --env production
  ```
  Optionally also `--env staging` to test summaries there first.
- **You:** set an admin token for backups and restore (saved to the git-ignored file `.admin-token-production`):
  ```bash
  openssl rand -hex 32 | tee -a .admin-token-production | pnpm --filter @workspace/prodli-api exec wrangler secret put ADMIN_TOKEN --env production
  ```
  (Do the same with `--env staging`, then run the restore drill below.)
- **You:** build the store extension against production: in `.env.local` set `VITE_PRODLI_API="https://app.prodli.com"`, then `source .env.local && pnpm run build:extension`.

## Limits (free plan)
- ✅ 100 MB synced data per user, 1.5 MB per item
- ✅ 20 AI summaries per user per month (Pro: 300); failed summaries aren't counted
- ✅ Rate limits: sign-in 20/min per IP, sync 300/min per user, AI 10/min per user
- ✅ Request size caps: 64 KB normally, 8 MB for sync, 1 MB for summaries
- To change a number: `QUOTA_BYTES` in `artifacts/prodli-api/src/syncStore.ts`, `AI_MONTHLY_LIMIT` in `src/ai.ts`, rate limits in `wrangler.jsonc`.

## Security
- ✅ Each user's data is in their own Durable Object, chosen only from the verified session (tests try cross-user access)
- ✅ Sessions stored as hashes; web session cookie is HttpOnly, Secure, `__Host-`; CSRF origin checks
- ✅ Strict Content-Security-Policy and security headers on the web app; HSTS
- ✅ Logs never contain note or meeting content; no admin "view data" tool exists
- ✅ Admin backup/restore endpoints exist only when `ADMIN_TOKEN` (32+ characters) is set; wrong tokens get a 404

## Backups and restore
- ✅ Nightly at 03:17 UTC, each changed account is copied to R2 (`prodli-backups`; staging: `prodli-backups-staging`). Unchanged accounts are re-copied weekly. Copies expire after 30 days (bucket rule). Deleting an account deletes its copies.
- ✅ Cloudflare also keeps 30 days of point-in-time recovery for D1 and Durable Objects.
- **You (with me): restore drill on staging** once the staging `ADMIN_TOKEN` is set. Use a test account with a few notes:
  1. Find the user id: `pnpm --filter @workspace/prodli-api exec wrangler d1 execute DB --env staging --remote --command "SELECT id, email FROM users"`
  2. Back up now: `curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"userId":"<id>"}' https://prodli-api-staging.sunnysinghnitb.workers.dev/api/admin/backup`
  3. Delete a note in the app and wait for it to sync.
  4. Restore: `curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"userId":"<id>","date":"<YYYY-MM-DD>","mode":"overwrite"}' https://prodli-api-staging.sunnysinghnitb.workers.dev/api/admin/restore`
  5. The note reappears on every device. (`"mode":"merge"` keeps anything edited after the backup.)
  The same steps run automatically in `artifacts/prodli-api/test/backup.test.ts`.

## Monitoring and alerts
- ✅ Worker logs and metrics: Cloudflare dashboard → Workers → prodli-api → Observability
- ✅ Uptime check every 15 minutes (`.github/workflows/uptime.yml`): production, staging and prodli.com. A failure emails you. (It reports app.prodli.com as down until production is deployed.)
- **You:** Cloudflare dashboard → Notifications → add "Usage-based billing" alerts (for example at $10 and $25 a month) and "Workers: Durable Objects storage" alerts.
- **You:** Anthropic console → set a monthly spend limit (for example $20) on the key you give ProdLi.

## Load test
- ✅ `node scripts/load-test.mjs 50 20`: 2,000 syncs from 50 users and 100 devices on a local server, 0 errors, all data correct (p95 ≈ 250 ms on a laptop). 200 users: 0 errors, all data correct. On a laptop everything shares one process; on Cloudflare each user's object runs separately.

## Legal
- ✅ Drafts: privacy policy (`artifacts/prodli-site/src/pages/Privacy.tsx`, prodli.com/privacy) and terms (prodli.com/terms), describing ProdLi as built. Sign-in links to both.
- **You:** have a lawyer review them (India DPDP Act 2023, GDPR) before launch; they go live when the site deploys.
- **You:** keep a short breach-response note: who to contact (Cloudflare, Google, Anthropic), and notifying affected users and the Data Protection Board of India / EU authorities within the legal deadlines (72 hours under GDPR).

## Google and Chrome Web Store
- **You:** Google Cloud console → OAuth consent screen → add app.prodli.com, prodli.com/privacy and prodli.com/terms → **Publish app**. Until then, only the listed test users can sign in.
- **You:** Chrome Web Store → upload `prodli-extension.zip` (built against production), update the privacy disclosures ("personal communications" for meeting transcripts, "authentication information", "website content" for notes) and the privacy policy link → submit for review.
