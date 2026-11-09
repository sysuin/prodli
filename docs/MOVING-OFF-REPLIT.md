# Moving ProdLi off Replit — checklist

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
2. **Workers & Pages → Create → Pages → Upload assets** (Direct Upload), project name **`prodli`** (must match the workflow). Upload the `site-dist` folder once to create it (build it with `pnpm run build:web`; it's in the repo root). Production branch: `main`.
3. Note your **Account ID** (right sidebar of the dashboard).
4. **My Profile → API Tokens → Create Token → Custom token**: name `prodli-github-deploy`, permission **Account → Cloudflare Pages → Edit**, account resources: your account. Create and copy the token (shown once).
5. In GitHub: **repo → Settings → Secrets and variables → Actions → New repository secret**, add:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`

   Or from the terminal (it asks for the value without showing it): `gh secret set CLOUDFLARE_API_TOKEN --repo sysuin/prodli` and `gh secret set CLOUDFLARE_ACCOUNT_ID --repo sysuin/prodli`.
6. Run **Actions → Deploy website → Run workflow**. Check `https://prodli.pages.dev` shows the site, `/privacy` and `/extension/`.

From now on, every push to `main` that touches the site or extension redeploys automatically.

## 3. Point prodli.com at Cloudflare (keep email working)

Recommended: move DNS to Cloudflare (free), keep the domain registered at Hostinger.

### prodli.com records today (looked up 2026-11-09)

**Keep — these run contact@prodli.com (Hostinger Mail).** Set every one to **DNS only** (grey cloud) in Cloudflare:

| Type | Name | Content | Priority |
|---|---|---|---|
| MX | `@` | `mx1.hostinger.com` | 5 |
| MX | `@` | `mx2.hostinger.com` | 10 |
| TXT | `@` | `v=spf1 include:_spf.mail.hostinger.com ~all` | |
| TXT | `_dmarc` | `v=DMARC1; p=none` | |
| CNAME | `hostingermail-a._domainkey` | `hostingermail-a.dkim.mail.hostinger.com` | |
| CNAME | `hostingermail-b._domainkey` | `hostingermail-b.dkim.mail.hostinger.com` | |
| CNAME | `hostingermail-c._domainkey` | `hostingermail-c.dkim.mail.hostinger.com` | |
| CNAME | `autodiscover` | `autodiscover.mail.hostinger.com` | |
| CNAME | `autoconfig` | `autoconfig.mail.hostinger.com` | |

**Delete — these point to Replit:**

| Type | Name | Content |
|---|---|---|
| A | `@` | `34.111.179.208` |
| A | `www` | `34.111.179.208` |
| TXT | `@` | `replit-verify=…` |
| TXT | `www` | `replit-verify=…` (if present) |

### Steps

1. Cloudflare dashboard → **Add a domain** → `prodli.com` → **Free** plan → let it scan the existing records.
2. On the review screen, compare with the tables above: add anything missing from **Keep**, set those to **DNS only** (grey cloud), and delete the **Replit** rows. Continue.
3. **Workers & Pages → prodli → Custom domains → Set up a custom domain** → `prodli.com`, then again for `www.prodli.com`. Cloudflare adds the website records itself.
4. Cloudflare shows two nameservers (like `xxx.ns.cloudflare.com`). In **Hostinger hPanel → Domains → prodli.com → DNS / Nameservers → Change nameservers → Use custom nameservers**, replace `ns1/ns2.dns-parking.com` with Cloudflare's two. Save.
5. Wait until Cloudflare emails that the domain is **Active** (usually under an hour, up to 24 h). The old Replit site keeps serving until the switch, so there's no downtime.
6. Check:
   - https://prodli.com, https://www.prodli.com, https://prodli.com/privacy, https://prodli.com/extension/
   - Send an email **to** contact@prodli.com from Gmail, and reply **from** it. Both should work; the reply shouldn't land in spam.
   - Optional: `dig +short prodli.com MX` should still show the two Hostinger servers.

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
