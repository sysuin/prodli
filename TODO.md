# ProdLi — To-Do

Last updated: 2026-11-20 · Version 1.4.0 · Repo: https://github.com/sysuin/prodli · Cost plan: [docs/COSTS.md](docs/COSTS.md)

## Now — needs you

Full details: [docs/LAUNCH-CHECKLIST.md](docs/LAUNCH-CHECKLIST.md).

- [x] **Google consent screen:** published (In production) on 2026-11-17; sign-in works for everyone. prodli.com verified in Search Console (TXT record in Cloudflare; keep it).
- [ ] **Calendar verification:** branding re-verification is scheduled for 2026-11-18 (Google asks for a 24-hour wait after domain verification). After branding passes, submit `calendar.readonly` in the Verification Center with a short demo video (sign in → Connect Calendar → Today).
- [ ] **Chrome Web Store:** `pnpm run build:extension:store` → upload `prodli-extension-store.zip` and paste the kit in [STORE_SUBMISSION.md](STORE_SUBMISSION.md) (screenshots, description, privacy answers) → submit.
- [ ] **ProdLi Pro (when ready to sell):** in Dodo Payments (ProdLi brand created), live mode: products, API key and webhook (test mode is done) — [docs/PRO-PLAN.md](docs/PRO-PLAN.md).
- [ ] **Real-use checks:**
  - [ ] A real Google Meet call with captions on (full transcript, summary)
  - [ ] Captions off for part of a call with on-device transcription on (gaps filled, marked "on device")
  - [ ] A time-block reminder going off; "Add to Google Calendar"
  - [ ] A weekly review with your real data
  - [ ] Phone: the web app (Share → Add to Home Screen)
- [x] **Cloudflare billing alerts:** budget alerts at $10 (auto-created) and $25 (added 2026-11-17), emailed to the account owner

## Next — Claude can do

- Nothing pending before launch.

## Optional

- [ ] **If user data ever leaks** (not legally required to plan ahead; India's breach rule applies from 13 May 2027):
  1. Contain it: rotate the Cloudflare, Anthropic and Google keys; Account → "Sign out everywhere"; switch off the affected feature.
  2. Notify quickly: affected users and India's Data Protection Board without delay, with a detailed report within 72 hours; the EU authority within 72 hours if EU users are at risk.
  3. Ask the lawyer who must be told (also whether CERT-In's 6-hour reporting applies), and keep a written log of what happened and what you did.

## Next ideas

- [ ] Keep an eye on Meet page changes (the captions reader is tested against a simulated Meet page in English and Spanish)
- [ ] Real-use checks for 1.4.0: a Zoom web call and a Teams web call (with "Include my microphone" on), and 🎙 Record in person on a phone (app.prodli.com)
- [ ] Move inline styles into shared UI components (needed before a web/desktop app)
- [ ] Optional: publish to the Chrome Web Store from CI (the Web Store API is free)
- [ ] Decided against: auto-opening `.md` / `.json` from websites or `file://` links (needs the "all websites" permission; free extensions already do it)

## Roadmap

- [x] Web app (app.prodli.com), reusing the extension's screens
- [ ] Desktop app (Mac/Windows) with native meeting recording for any app
- [ ] Mobile app

## How to test

From the repo root (see README.md for all commands):

- `pnpm run typecheck` — TypeScript
- `pnpm test` — unit tests (extension + API)
- `pnpm test:e2e` — builds the extension and runs ~100 checks in a throwaway headless Chrome (all tabs, Editor incl. two tabs, Meetings, captions reader in English + Spanish, Files, Pomodoro, real Time Tracker tracking incl. worker restarts, Habits, Drive sign-in/sync with a simulated Google, backup, accessibility audit). `E2E_SPEECH=1` adds the real on-device speech test (downloads Chrome's model). Run selected suites with `node artifacts/prodli/tests/e2e/run.mjs editor,files`.
- `node artifacts/prodli/scripts/store-screenshots.mjs` — regenerate store screenshots after UI changes (builds its own copy with demo data; no real account).
- `node artifacts/prodli/scripts/brand-images.mjs` — regenerate the Web Store promo tile and prodli.com's link-preview image (logo + tagline, from `scripts/brand/*.html`).

## Done

- [x] 2026-11-20 — 1.4.0 ready for the store: production API deployed, privacy policy and terms updated (prodli.com), store zip, kit and screenshots; in-person recording; to-do Board and Matrix views
- [x] 2026-11-19 — Tier 1 and 2 features (sysuin/prodli#53–#69): repeating to-dos, reminders, lists and labels, quick add, focus blocking, saved tabs, quick links, Read later and page summaries, note templates, richer habits, Speak tasks, Ask sources and scheduled prompts, meeting prep, focus score, Day view, Zoom and Teams capture

- [x] 2026-11-17 — Web Store listing refreshed (description, privacy answers, screenshots of Today, Ask ProdLi and the weekly review); lawyer review of the legal pages

- [x] 2026-11-11 — ProdLi Pro: plans, Dodo Payments checkout and subscription management (on sale once Dodo is set up)
- [x] 2026-11-11 — Weekly review; time blocks on Today; caption gaps filled from on-device transcription
- [x] 2026-11-10 — Local Markdown/CSV/JSON files dropped on Chrome open in ProdLi
- [x] 2026-11-10 — Today (daily brief, calendar), Ask ProdLi, Add to ProdLi from any page, AI summaries via ProdLi's own key, Meet recording fixes
- [x] 2026-11-10 — Accounts, sync, web app, nightly backups and production at app.prodli.com

- [x] 2026-11-09 — On-device transcription when Meet captions are off (Chrome's built-in speech recognition; You / Others; free, audio stays local)
- [x] 2026-11-09 — Accessibility: WCAG 2.1 AA axe audit passes on every tab (light + dark, with data) and every pop-up; visible keyboard focus
- [x] 2026-11-09 — Files: syntax highlighting (~20 languages) and Recent files
- [x] 2026-11-09 — Time Tracker: "Clear all" no longer wipes settings; All-time view no longer stale; file split; real tracking tests
- [x] 2026-11-09 — Two-way Google Drive sync (item-by-item merge, deletions sync)
- [x] 2026-11-09 — New tab ~5× faster (352 ms → 63 ms to the Editor)
- [x] 2026-11-09 — Meet recorder works in any Meet language
- [x] 2026-11-09 — Store screenshots + v1.3.0 submission kit; Editor toolbar fits on one line
- [x] 2026-11-08 — Editor v2 (data-loss fixes, `/` menu, checklists, tables, bubble menu, Markdown paste, pin/sort/duplicate, undo delete, outline, print)
- [x] 2026-11-08 — Multi-tab safe storage for notes, to-dos and habits; saves report errors; unlimitedStorage
- [x] 2026-11-08 — Time Tracker keeps tracking after background-worker restarts
- [x] 2026-11-08 — Sign in with Google + Google Drive backup ($0, no server)
- [x] 2026-11-08 — Website + privacy policy updated; independent of Replit; CI + Cloudflare deploy workflows
- [x] 2026-11-08 — Backup includes Time Tracker + meetings; Pomodoro survives closed tabs; Markdown import/export
- [x] 2026-11-08 — Meeting recorder for Google Meet; Files previewer
