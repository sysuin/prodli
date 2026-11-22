# ProdLi — To-Do

Last updated: 2026-11-23 · Version 1.4.0 · Repo: https://github.com/sysuin/prodli · Cost plan: [docs/COSTS.md](docs/COSTS.md)

## Now — needs you

Full details: [docs/LAUNCH-CHECKLIST.md](docs/LAUNCH-CHECKLIST.md).

- [x] **Google consent screen:** published (In production) on 2026-11-17; sign-in works for everyone. prodli.com verified in Search Console (TXT record in Cloudflare; keep it).
- [ ] **Calendar verification:** branding re-verification is scheduled for 2026-11-18 (Google asks for a 24-hour wait after domain verification). After branding passes, submit `calendar.readonly` in the Verification Center with a short demo video (sign in → Connect Calendar → Today).
- [ ] **Chrome Web Store:** `pnpm run build:extension:store` → upload `prodli-extension-store.zip` and paste the kit in [STORE_SUBMISSION.md](STORE_SUBMISSION.md) (screenshots, description, privacy answers) → submit.
- [x] **ProdLi Pro:** live in Dodo Payments (verification approved, live products, API key and webhook; on sale since 2026-11-22). Left for you: one real purchase to confirm the live flow — [docs/PRO-PLAN.md](docs/PRO-PLAN.md).
- [ ] **Real-use checks:**
  - [ ] A real Google Meet call with captions on (full transcript, summary)
  - [ ] Captions off for part of a call with on-device transcription on (gaps filled, marked "on device")
  - [ ] A time-block reminder going off; "Add to Google Calendar"
  - [ ] A weekly review with your real data
  - [ ] Phone: the web app (Share → Add to Home Screen)
- [ ] **Phone app (iOS + Android):** one-time setup in [docs/MOBILE.md](docs/MOBILE.md) → "One-time setup": Expo account, iOS + Android Google OAuth clients, Apple Developer ($99/yr) and Google Play ($25) accounts; deploy the production API (phone sign-in); then `eas build` and a TestFlight / internal-testing beta. Listing text, screenshots and privacy answers are ready in [docs/MOBILE-STORE.md](docs/MOBILE-STORE.md). Ask the lawyer about the phone-app additions in `docs/legal/REVIEW-NOTES.md` §9.
- [ ] **Desktop app (Mac + Windows):** production API with desktop sign-in is live (2026-11-21); next: Apple + Windows signing certificates and a download page — [docs/DESKTOP.md](docs/DESKTOP.md) → "Before shipping".
- [x] **Cloudflare billing alerts:** budget alerts at $10 (auto-created) and $25 (added 2026-11-17), emailed to the account owner

## Next — Claude can do

- Nothing pending before launch.

## Optional

- [ ] **If user data ever leaks** (not legally required to plan ahead; India's breach rule applies from 13 May 2027):
  1. Contain it: rotate the Cloudflare, Anthropic and Google keys; Account → "Sign out everywhere"; switch off the affected feature.
  2. Notify quickly: affected users and India's Data Protection Board without delay, with a detailed report within 72 hours; the EU authority within 72 hours if EU users are at risk.
  3. Ask the lawyer who must be told (also whether CERT-In's 6-hour reporting applies), and keep a written log of what happened and what you did.

## Feature plan (from research, 2026-11-23)

Why and evidence for each item: [docs/research/2026-11-productivity-apps-feature-plan.md](docs/research/2026-11-productivity-apps-feature-plan.md). Effort is for one developer; add a 30–50% buffer.

**Tier 1: next 2–4 weeks** (ship 1, 2 and 5 first if time is short)
- [ ] **1. Meeting trust pack** (3–4 days): one-click notice to participants (chat line or spoken intro), visible recording indicator, auto-delete for audio and transcripts, one-page "export everything", and a written promise to keep export working if ProdLi ever shuts down.
- [ ] **2. Voice brain-dump to tasks and plan** (4–6 days): hold the shortcut, talk, get dated tasks with lists, labels and subtasks, optionally dropped straight into Plan your day.
- [ ] **3. Recipes and citations in Ask** (5–7 days): saved prompt templates over meetings and notes ("1:1 recap", "what did I promise this week?") and answers that link to the exact source.
- [ ] **4. Focus friction** (4–5 days): block lists with active hours, automatic blocking while a Pomodoro runs, and a pause screen with a big "close tab" button.
- [ ] **5. Conversion mechanics** (3–5 days): 14–30-day reverse trial (full Pro, then free), free plan limits history and AI volume rather than features, monthly "value recap", annual plan (about two months free), India price (try ₹199/month or ₹1,499/year; check UPI AutoPay in Dodo), fair-use allowance for AI transcription.
- [ ] **Start Google verification for a Calendar write scope now** (1 day of paperwork; it takes weeks and gates item 6).

**Tier 2: next quarter** (6–8 first; 13 can slip)
- [ ] **6. Two-way Google Calendar** (2–3 weeks + verification): put time blocks and tasks on the real calendar, move them, keep both sides in step.
- [ ] **7. Meetings tied to calendar events** (1–2 weeks): "starts in 2 minutes, take notes?", notes filed under the event, prep card with past notes and open action items for the same people.
- [ ] **8. Basic importer** (1–1.5 weeks): Todoist (API token), TickTick and Google Tasks files, generic CSV — the first part of the import plan below, brought forward because switching is when people pay.
- [ ] **9. Gentle day mode** (2–3 weeks): vertical visual timeline, big countdown for the current block, one-tap AI "break this down", reminders that repeat until done or snoozed (ADHD-friendly).
- [ ] **10. Read-only MCP server and personal API** (1–2 weeks) over tasks, notes, meetings and time, so Claude and ChatGPT can read ProdLi.
- [ ] **11. Scheduled prompts** (1 week): e.g. "every Friday, summarise my meetings and open loops", by notification or email.
- [ ] **12. Upload any recording for notes** (2–4 days): phone memos, Plaud exports, in-person meetings.
- [ ] **13. Web clipper and read-later** (2–3 weeks): save, highlight, AI summary into notes, link to a task, listen with the browser's text-to-speech.

**Tier 3: later / needs the native apps**
- [ ] **14.** System-wide dictation in the desktop app, later a phone keyboard (3–5 weeks for desktop).
- [ ] **15.** Capture audio from the Zoom and Teams desktop apps (3–4 weeks, plus OS permission and consent).
- [ ] **16.** Phone quick capture: widget, voice memo to tasks, reliable reminders, offline queue (4–8 weeks).
- [ ] **17.** Note properties and a table view, a light Notion database (4–6 weeks).
- [ ] **18.** Blocking whole apps on desktop and phone (2–4 weeks per platform).

**Decided not to build** (reasons in the report): a Gmail client or full Gmail dashboard (at most right-click "email to task"), AI that rearranges the calendar by itself, autonomous agents, scheduling links, team spaces, screen recall / always-on recording / wearables, focus soundscapes, whiteboards and graph views, a generic "chat with this page" sidebar.

**Positioning:** lead with meetings, not "15 apps in one": "No bot joins your call. Your action items land in tomorrow's plan, and Ask finds anything you said. $5."

## Next ideas

- [ ] **Import from other apps (first part is Feature plan item 8):** start with "paste a list" (any app, ~half a day), then Todoist/TickTick/CSV files with a preview and Undo, then Google Tasks and Microsoft To Do sign-in; later notes (Notion, Evernote, Keep), meeting transcripts (Otter, Granola) and habit history. Plan, difficulty and the full wish list: [docs/PLAN-IMPORT.md](docs/PLAN-IMPORT.md)
- [ ] **Mail section (later; the 2026-11-23 research says don't build the full dashboard, see Feature plan):** a Gmail dashboard in the extension (needs reply / waiting on others / newsletters, add to to-dos), read in the browser with `gmail.readonly` and sorted by Chrome's on-device AI, so email never reaches ProdLi's servers and Google's paid security assessment shouldn't apply. Works for up to 100 testers right away; public use needs Google's free restricted-scope review. Plan: [docs/PLAN-MAIL.md](docs/PLAN-MAIL.md)
- [ ] **Phone app keeps Notion-style blocks:** the phone app's note editor flattens callouts, toggles and text/background colours made in the extension (they come back as plain text). Render them, or at least keep them intact when a note is edited on the phone.
- [ ] **Dictation outside the extension:** voice dictation (Alt+Shift+D) works only in the Chrome extension. Add it to the web app, and system-wide dictation (any app) through the desktop app.
- [ ] Keep an eye on Meet page changes (the captions reader is tested against a simulated Meet page in English and Spanish)
- [ ] Real-use checks for 1.4.0: a Zoom web call and a Teams web call (with "Include my microphone" on), and 🎙 Record in person on a phone (app.prodli.com)
- [ ] Move inline styles into shared UI components (needed before a web/desktop app)
- [ ] Optional: publish to the Chrome Web Store from CI (the Web Store API is free)
- [ ] Decided against: auto-opening `.md` / `.json` from websites or `file://` links (needs the "all websites" permission; free extensions already do it)

## Roadmap

- [x] Web app (app.prodli.com), reusing the extension's screens
- [ ] Desktop app (Mac/Windows) — first version built in `artifacts/prodli-desktop` ([docs/DESKTOP.md](docs/DESKTOP.md)): every section, record a call in any app, Quick add shortcut, tray; next: signing, download page + auto-updates, Calendar, native time tracking
- [ ] Mobile app — first version built in `artifacts/prodli-mobile` ([docs/MOBILE.md](docs/MOBILE.md)); next: in-person recording on the phone, table editing, widgets

## How to test

From the repo root (see README.md for all commands):

- `pnpm run typecheck` — TypeScript
- `pnpm test` — unit tests (extension + API)
- `pnpm test:e2e` — builds the extension and runs ~100 checks in a throwaway headless Chrome (all tabs, Editor incl. two tabs, Meetings, captions reader in English + Spanish, Files, Pomodoro, real Time Tracker tracking incl. worker restarts, Habits, Drive sign-in/sync with a simulated Google, backup, accessibility audit). `E2E_SPEECH=1` adds the real on-device speech test (downloads Chrome's model). Run selected suites with `node artifacts/prodli/tests/e2e/run.mjs editor,files`.
- `node artifacts/prodli/scripts/store-screenshots.mjs` — regenerate store screenshots after UI changes (builds its own copy with demo data; no real account).
- `node artifacts/prodli/scripts/brand-images.mjs` — regenerate the Web Store promo tile and prodli.com's link-preview image (logo + tagline, from `scripts/brand/*.html`).

## Done

- [x] 2026-11-22 — Go-to-market groundwork: store listing led by meeting notes (name, summary, description, screenshot order), Chrome Web Store review ask after 3 summarized meetings, anonymous uninstall survey (prodli.com/goodbye) and admin growth report, prodli.com pre-rendered for search engines with real 404s, meeting notes landing pages (Meet, Zoom, Teams, in person) and a meetings-first homepage. Policy wording for the survey awaits the lawyer: `docs/legal/REVIEW-NOTES.md` §10
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
