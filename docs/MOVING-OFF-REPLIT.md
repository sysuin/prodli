# Moving ProdLi off Replit — checklist

> **Status 2026-11-09: the website has moved.**
> - prodli.com's DNS is on Cloudflare, and the Hostinger Mail records are fixed to "DNS only".
> - The site is served by the `prodli-site` Worker; see [CLOUDFLARE.md](CLOUDFLARE.md). It runs on Workers, not the Pages project described below.
>
> What's left:
> 1. Add the CI secrets (CLOUDFLARE.md → "CI secrets").
> 2. After a few days without problems, unpublish the Replit deployment and cancel any Replit plan.
> 3. Then delete the two `replit-verify` TXT records in Cloudflare DNS.
>
> The rest of this file is kept for reference.

The code no longer depends on Replit (no Replit config, plugins or packages). What's left is moving the **running website** and the **copy of the code** to free services. Do these in order; each step is reversible until step 5.

Current state (checked 2026-11-08):
- `prodli.com` is registered at **Hostinger**, with DNS at Hostinger (`ns1/ns2.dns-parking.com`).
- The website points to Replit (`A 34.111.179.208`).
- Email for `contact@prodli.com` runs on **Hostinger Mail** (`MX mx1/mx2.hostinger.com`). **Keep these records when changing DNS, or email stops.**

---

## 1. Put the code on GitHub (free, private)

1. Create a **private** repo on github.com, e.g. `prodli` (no README, no .gitignore — the repo already has them).
2. From `ProdLi-Extension/`:
   ```bash
   git remote add origin git@github.com:<you>/prodli.git
   git push -u origin feature/meetings-and-files
   git push origin main
   ```
3. On GitHub, open a pull request from `feature/meetings-and-files` into `main`. The **CI** workflow runs the type check, unit tests, extension build and browser tests automatically. Merge when it's green.

## 2. Create the Cloudflare Pages project (free)

1. Sign up at dash.cloudflare.com (free plan).
2. **Workers & Pages → Create → Pages → Upload assets**, project name **`prodli`** (must match the workflow). Upload any folder once (e.g. your local `site-dist/` after `pnpm run build:web`) to create it.
3. Note your **Account ID** (right sidebar of the dashboard).
4. **My Profile → API Tokens → Create Token → "Edit Cloudflare Workers"** template (or a custom token with *Account → Cloudflare Pages → Edit*). Copy the token.
5. In GitHub: **repo → Settings → Secrets and variables → Actions**, add:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
6. Run **Actions → Deploy website → Run workflow**. Check `https://prodli.pages.dev` shows the site, `/privacy` and `/extension/`.

From now on, every push to `main` that touches the site or extension redeploys automatically.

## 3. Point prodli.com at Cloudflare (keep email working)

Recommended: move DNS to Cloudflare (free), keep the domain registered at Hostinger.

1. Cloudflare dashboard → **Add a domain** → `prodli.com` → Free plan. Cloudflare scans and imports existing records.
2. **Before switching nameservers, check these records exist in Cloudflare** (copy them from Hostinger's DNS page if the scan missed any):
   - `MX  @  mx1.hostinger.com  priority 5`
   - `MX  @  mx2.hostinger.com  priority 10`
   - Any `TXT` records (SPF `v=spf1 …`, DKIM `hostingermail…._domainkey`, DMARC `_dmarc`) — these keep email from going to spam.
   - Mail-related `CNAME`s if present (e.g. `autodiscover`, `autoconfig`).
   - Remove the old Replit `A @ 34.111.179.208` record and any Replit verification `TXT`.
3. In **Pages → prodli → Custom domains**, add `prodli.com` and `www.prodli.com`. Cloudflare creates the records.
4. In Hostinger: **Domains → prodli.com → DNS / Nameservers → Change nameservers** to the two Cloudflare nameservers shown in step 1.
5. Wait for Cloudflare to say the domain is **Active** (minutes to a few hours). Then check:
   - https://prodli.com, https://prodli.com/privacy, https://prodli.com/extension/
   - Send a test email to `contact@prodli.com` and reply from it.

> Alternative if you'd rather not touch email at all: keep DNS at Hostinger and only add `www` as a CNAME to `prodli.pages.dev`, with a redirect from the bare domain. This is fiddlier for the bare `prodli.com`, so moving DNS is recommended.

## 4. Optional: free email forwarding instead of Hostinger Mail

If your Hostinger mailbox costs money, Cloudflare **Email Routing** can forward `contact@prodli.com` to your Gmail for free (receive only; to *send* as contact@prodli.com you'd use Gmail's "Send mail as" with an SMTP service). Only switch after step 3 works, and remove the Hostinger MX records when you do.

## 5. Shut down Replit

Only after the site has run from Cloudflare for a few days:

1. Unpublish the Replit deployment.
2. Download a final zip of the Replit project as an archive (already done once: this repo).
3. Cancel any paid Replit plan.

## 6. Chrome Web Store

Nothing to move — the listing stays as is. Future uploads use the zip from CI or `pnpm run build:extension`. The listing's privacy policy link (`https://prodli.com/privacy`) keeps working after step 3.
