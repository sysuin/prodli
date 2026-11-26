# Handoff: from the Mac session to Claude Cloud (2026-11-24)

Until 24 Nov 2026, ProdLi was built in one long Claude Code session on the owner's Mac. Work now continues in Claude Code cloud sessions (environment **ProdLi**). This file is what that session knew that isn't obvious from the code. Read it with [CLAUDE.md](../CLAUDE.md) (how to work) and [TODO.md](../TODO.md) (what's open).

## Where things stand

- **Production (app.prodli.com):** deployed 26 Nov 2026 from main `85fb745` (up to sysuin/prodli#130: Edge sign-in allowed) through the GitHub workflow (restore point before it: `00000040-00000000-0000512f-1efa20184d7465f1b7b995787b8fbe3f`). Not yet in production: #131 (payment-page wording, no welcome tour over plan links) and #126 (current-time line fix in the web app). Before that: 25 Nov from `16baf95`. Health: `https://app.prodli.com/api/health`.
- **Website (prodli.com):** deploys by itself on every push to main; shows the three plans.
- **Chrome extension:** the store still has **1.4.0**. The code is **1.5.0** (manifest), with everything below; it reaches users only when the owner uploads a new store build from the Mac.
- **Plans (live in Dodo since 24 Nov):** Free; Pro $5/month or $48/year; Pro Plus $12/month or $120/year. Limits and product IDs: docs/PRO-PLAN.md. Every new account gets a 14-day Pro trial (TRIAL_DAYS). No real purchase has been made yet (TODO: real purchase test).
- **Desktop app:** built (artifacts/prodli-desktop), not signed or shipped; production sign-in for it is live.
- **Phone app:** built (artifacts/prodli-mobile); a separate local session, "ProdLi mobile development", works on it on branch `mobile-4` (pushed, no open PR). Check with the owner before changing `artifacts/prodli-mobile`.

## What shipped recently (newest first)

- **#109** `scripts/pr.sh`: open PRs and merge after CI through GitHub's REST API (GraphQL is blocked in cloud sessions).
- **#107, #108** Ready for the cloud: CLAUDE.md, `scripts/cloud-setup.sh`, the production deploy from GitHub saving a D1 restore point and checking health; the GitHub `production` environment needs the owner's approval and deploys only from main.
- **#106** Pro Plus, lower Pro limits, plan cards with a Monthly/Yearly switch, one-page Dodo checkout, sign-in that carries on to checkout, plan switching (`POST /api/billing/change`), public `GET /api/billing/plans`, site pricing and Terms.
- **#105** Upload Retry continues from the last transcribed piece; dictation in the web and desktop apps (Alt+Shift+D or 🎙 on a text box); version 1.5.0 and store kit.
- **#104** Streak freezes and milestones (web, Today, phone); typed prefixes in ⌘K and Quick add (t / n / h / p 25 / ? / s); "Insert a ProdLi snippet" in any text box; "Screenshot to ProdLi" (crop, marks, `POST /api/ai/ocr`); Hindi and 10 more Indian languages (Settings → Language).
- **#102, #103** Note editor: pictures with captions and sizes, code blocks with languages, find and replace, link box, nested lists, touch block handle, toolbar that fits small screens.
- **#100, #101** Tier 1 and Tier 2 of the feature plan (meeting trust pack, reverse trial, two-way Google Calendar with a "ProdLi" calendar, meetings filed under calendar events, importer, gentle day mode, read-only MCP server and personal API, upload a recording, read aloud and highlights).

## Decisions the owner made (don't reopen without asking)

- Keep $5 for Pro everywhere (no India price for now). Pro Plus at $12 / $120.
- 14-day reverse trial for new accounts. Meet chat heads-up is opt-in. Recording auto-delete is off by default.
- Free plan limits unchanged; Pro limits lowered (Ask 500, writing 1,000, dictation 3,000).
- Mail (Gmail) section: later, in TODO (plan in docs/PLAN-MAIL.md); importing from other apps: first part built, rest in docs/PLAN-IMPORT.md.
- Prefer few permissions: no new required or host permissions in the extension.
- The feature plan and its ranking come from research in `docs/research/` (the reports, and the raw notes in `docs/research/notes/`).

## Open, in order (details in TODO.md)

1. **Owner, on the Mac:** upload 1.5.0 to the Chrome Web Store; make one real purchase (Pro, then switch to Pro Plus, then cancel and refund).
2. **Owner:** Google Calendar verification (demo video), first real two-way calendar run, real-use checks (Meet, Zoom, Teams, pasting from Google Docs/Word/Notion, a real phone).
3. ~~The first GitHub production deploy~~ — *done 25 Nov 2026:* the restore point, deploy and health check all worked; the owner approves each run in GitHub.
4. **1 Dec 2026:** a scheduled task on the owner's Mac makes the repo private again (to save Actions minutes, the repo was public in November). After that, check the `production` environment's required reviewer still works on the owner's GitHub plan, and remember Actions minutes count again (each CI run is about 15–18 minutes).
5. Next features, when the owner asks: the desktop menu-bar timer (A1) was the next quick item; then the larger items in TODO's feature plan.

## The other local sessions (all finished, all merged)

Besides the main session, four local sessions worked on ProdLi. Everything they built is on main; what they left open is in TODO.md.

- **"GTM strategy planning"** (until 22 Nov; sysuin/prodli#89, #91): store listing led by meeting notes, a Chrome Web Store review prompt after 3 summarized meetings, an uninstall survey (`/api/feedback/uninstall`, migration 0013), a growth report, and comparison pages on prodli.com (`/compare/granola` and others). Left: lawyer review of `docs/legal/REVIEW-NOTES.md` §10.
- **"ProdLi desktop app"** (until 21 Nov; up to sysuin/prodli#88): the Electron app (every section, record a call in any app, Quick add shortcut, tray, time in apps), its e2e and smoke tests, Mac and Windows packaging in CI (`.github/workflows/desktop.yml`), and `docs/legal/DESKTOP-ADDITIONS.md`. Left: signing certificates, lawyer review, a Google "Desktop app" OAuth client for Calendar, a real-world check on a signed build.
- **"ProdLi mobile development"** (until 21 Nov; up to sysuin/prodli#87, branch `mobile-4` is merged): the Expo app, its browser tests at phone size (in CI), store screenshots and listing kit (`docs/MOBILE-STORE.md`), welcome and error screens. Left: Expo account, iOS/Android Google sign-in clients, Apple/Google developer accounts, lawyer review (§9). Its worktree on the Mac (`.claude/worktrees/mobile-app`) holds nothing unmerged.
- **"ProdLi: retry Google branding verification"** (scheduled run, 18 Nov): Google verified the branding; it was published on 24 Nov from the Mac session. Next: submit `calendar.readonly` for verification (demo video).

## Things only the Mac has (not in the repo)

- `.env.local` (Google sign-in client ID and the extension key) for store builds.
- The owner's Chrome sign-ins (Dodo, Google Cloud console, Chrome Web Store dashboard, Search Console).
- `.claude/launch.json` (local preview servers with Mac paths) and that session's local memory notes; the rules from those notes are now in CLAUDE.md.
- Local scheduled tasks (the 1 Dec repo-private task).

## How the owner likes to hear back

Plain, short updates: what changed, what's live, what isn't verified, and one clear question when a decision is theirs. They often say "merge after CI and deploy to production" — that's the yes for that batch, not for later ones.
