# Running ProdLi for (almost) nothing

Goal: zero or minimal cost for the whole product, now and as it grows. Prices and free-tier limits as of November 2026 — check the providers' pricing pages before relying on a number.

## Today (extension + website)

| Piece | Service | Free tier | Your cost |
|---|---|---|---|
| Source code | GitHub private repo | Unlimited private repos | $0 |
| Tests on every push | GitHub Actions | 2,000 min/month (private), unlimited (public). One CI run ≈ 3–4 min | $0 |
| Website + `/extension` preview | Cloudflare Pages | Unlimited bandwidth & requests for static sites, 500 builds/month, free SSL | $0 |
| DNS | Cloudflare | Free plan | $0 |
| Extension distribution | Chrome Web Store | One-time $5 developer fee | $0 (already paid) |
| AI meeting notes | User's own Claude API key, Claude Haiku 5.5 | — | $0 to you (users pay ~<1¢ per meeting) |
| Domain `prodli.com` | Hostinger (or Cloudflare Registrar at cost when it renews) | — | ~$10–15/year |
| Email `contact@prodli.com` | Hostinger Mail, or Cloudflare Email Routing (forwarding) | Email Routing is free | $0 if forwarding |

**Total: just the domain, about $1/month.** Cancelling Replit removes its subscription and deployment costs.

## When accounts and sync arrive

Stay on Cloudflare so everything is one account and one bill (that stays at $0 for a long time):

| Need | Service | Free tier |
|---|---|---|
| API (sign-in, sync) | Cloudflare Workers | 100,000 requests/day |
| Database (notes, to-dos, meetings text) | Cloudflare D1 (SQLite) | 5 GB storage, 5M row reads/day |
| Files (optional meeting audio backup) | Cloudflare R2 | 10 GB storage, no egress fees |
| Sign-in | "Sign in with Google" via your own Worker (Google OAuth is free), or a magic-link email | $0 |
| Transactional email (magic links) | Cloudflare Email Routing (receive) + a free-tier sender (e.g. ~3,000 emails/month on common providers) | $0 at small scale |

Why not keep the old Replit backend (Express + PostgreSQL)? It needs an always-on server — that's the part that costs money every month. Workers + D1 run only when used and fit ProdLi's "small data per user" shape. (The unused template was removed; it's in git history if ever needed.)

Rough capacity on the free tier: if each active user syncs ~200 times a day, 100,000 requests/day covers ~500 daily active users before the $5/month Workers paid plan is needed.

## Keeping AI cost at zero

1. **Now:** users bring their own Claude API key (already built). You pay nothing.
2. **Later, for a smoother experience:** a ProdLi Worker holds one key and calls Claude Haiku 5.5 ($0.10 / $0.50 per million input / output tokens; a one-hour meeting ≈ 15K tokens in, ~1K out ≈ $0.002). Make it a paid-plan feature (or a small free allowance) so AI cost is always covered by revenue.
3. Transcripts come from Google Meet's captions, so there's no speech-to-text bill.

## Things that would add cost — avoid unless needed

- Always-on servers or managed Postgres (Replit deployments, Render/Fly paid plans, RDS).
- Storing every meeting's audio in the cloud (keep audio on the user's device; store text only).
- Paid speech-to-text (only add it as an optional, paid feature).
- Chrome Web Store has no ongoing fee; a desktop app later would need code-signing certificates (Apple Developer $99/year, Windows signing varies) — the main future unavoidable cost.
