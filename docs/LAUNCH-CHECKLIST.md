# ProdLi launch checklist

✅ = done. **You:** = needs you (accounts, money, legal, or production access).

## What's left before launch
1. **You:** lawyer review of the privacy policy and terms, then fill in the `[placeholders]` in `artifacts/prodli-site/src/pages/Privacy.tsx` (operator name, address, grievance officer, court city). prodli.com deploys only once none are left.
2. **You:** Google Cloud console → OAuth consent screen → add app.prodli.com, prodli.com/privacy and prodli.com/terms → **Publish app**. Calendar (`calendar.readonly`) is a sensitive scope, so Google verifies the app first (can take a few weeks; start once the legal pages are live). Until then only the listed test users can sign in.
3. **You:** build the store extension and submit it (see "Chrome Web Store" below).
4. **You (when you want to sell Pro):** set up Paddle — sandbox first, then live (business verification needs prodli.com with the final legal pages). Step by step: `docs/PRO-PLAN.md`.
5. **You:** a short breach-response note: who to contact (Cloudflare, Google, Anthropic), and notifying affected users and the Data Protection Board of India / EU authorities within the legal deadlines (72 hours under GDPR).

## Product
- ✅ Extension and web app (app.prodli.com) share one account and sync live
- ✅ Web app: every section works on desktop and phones; installable; opens offline
- ✅ Today: daily brief with Google Calendar; Ask ProdLi chat; Add to ProdLi from any page
- ✅ Meetings: Google Meet recording with full transcripts and AI summaries (Meet captions must be on)
- ✅ Local Markdown, CSV, JSON and text files dropped on Chrome open in ProdLi (Files → "Open files from anywhere")
- ✅ Weekly review (Review section) with AI write-up and next week's priorities
- ✅ Time blocks on Today: planned tasks placed in free time, reminders, "Add to Google Calendar"
- ✅ Meeting transcripts: caption gaps filled from on-device transcription (when it's on)
- ✅ ProdLi Pro: plans, Paddle checkout, subscription management (on sale once Paddle is configured)
- **You:** a real Google Meet call with captions on, to check the whole transcript comes through
- **You:** try the web app on your phone (Share → Add to Home Screen)

## Production
- ✅ Production deployed at app.prodli.com (custom domain, certificate, database, nightly backups)
- ✅ `ANTHROPIC_API_KEY` set for production and staging (separate keys)
- ✅ `ADMIN_TOKEN` set for production and staging; restore drill done on staging
- ✅ CI deploys staging and prodli.com on every merge to main (Cloudflare secrets in GitHub)
- Deploy production after merging server or web-app changes (it applies database migrations first):
  ```bash
  pnpm --filter @workspace/prodli-api run deploy:production
  ```

## Limits (free plan / Pro)
- ✅ 100 MB synced data per user, 1.5 MB per item
- ✅ Per month: 20 / 300 meeting summaries, 62 / 200 daily briefs and weekly reviews, 100 / 1000 Ask ProdLi questions; 100 MB / 2 GB synced storage. Failed calls aren't counted.
- ✅ Rate limits: sign-in 20/min per IP, sync 300/min per user, AI 10/min per user
- ✅ Request size caps: 64 KB normally, 8 MB for sync, 1 MB for summaries
- To change a number: `QUOTA_BYTES` in `artifacts/prodli-api/src/syncStore.ts`; `AI_MONTHLY_LIMIT` (`src/ai.ts`), `BRIEF_MONTHLY_LIMIT` (`src/brief.ts`), `ASK_MONTHLY_LIMIT` (`src/ask.ts`); rate limits in `wrangler.jsonc`.

## Security
- ✅ Each user's data is in their own Durable Object, chosen only from the verified session (tests try cross-user access)
- ✅ Sessions stored as hashes; web session cookie is HttpOnly, Secure, `__Host-`; CSRF origin checks
- ✅ Strict Content-Security-Policy and security headers on the web app; HSTS
- ✅ Logs never contain note or meeting content; no admin "view data" tool exists
- ✅ Admin backup/restore endpoints exist only when `ADMIN_TOKEN` (32+ characters) is set; wrong tokens get a 404

## Backups and restore
- ✅ Nightly at 03:17 UTC, each changed account is copied to R2 (`prodli-backups`; staging: `prodli-backups-staging`). Unchanged accounts are re-copied weekly. Copies expire after 30 days. Deleting an account deletes its copies.
- ✅ Cloudflare also keeps 30 days of point-in-time recovery for D1 and Durable Objects.
- To restore one account (staging shown; use the production URL and token for production):
  1. Find the user id: `pnpm --filter @workspace/prodli-api exec wrangler d1 execute DB --env staging --remote --command "SELECT id, email FROM users"`
  2. Restore: `curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"userId":"<id>","date":"<YYYY-MM-DD>","mode":"merge"}' https://prodli-api-staging.sunnysinghnitb.workers.dev/api/admin/restore`
  (`"mode":"overwrite"` replaces everything with the backup; `"merge"` keeps anything edited after it.)

## Monitoring and alerts
- ✅ Worker logs and metrics: Cloudflare dashboard → Workers → prodli-api → Observability
- ✅ Uptime check every 15 minutes (`.github/workflows/uptime.yml`): production, staging and prodli.com. A failure emails you.
- ✅ Anthropic monthly spend limits
- **You (if not done):** Cloudflare dashboard → Notifications → "Usage-based billing" alerts (for example at $10 and $25 a month)

## Chrome Web Store
- Build the store version (always against https://app.prodli.com; it never touches the `dist-extension` folder your Chrome loads):
  ```bash
  pnpm --filter @workspace/prodli run build:extension:store
  ```
  It reads `PRODLI_GOOGLE_CLIENT_ID` and `PRODLI_EXTENSION_KEY` from `.env.local` and writes `prodli-extension-store.zip` (without the `key`, which the store rejects).
- **You:** upload `prodli-extension-store.zip`, fill in the privacy disclosures ("personal communications" for meeting transcripts, "authentication information", "website content" for notes), add the privacy policy link (prodli.com/privacy) → submit for review.
- The plain `build:extension` (staging) is for your own testing only.
