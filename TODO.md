# ProdLi — To-Do

Last updated: 2026-11-24 · Version 1.5.0 · Repo: https://github.com/sysuin/prodli · Cost plan: [docs/COSTS.md](docs/COSTS.md)

## Now — needs you

Full details: [docs/LAUNCH-CHECKLIST.md](docs/LAUNCH-CHECKLIST.md).

- [x] **Google consent screen:** published (In production) on 2026-11-17; sign-in works for everyone. prodli.com verified in Search Console (TXT record in Cloudflare; keep it).
- [x] **Google branding:** verified 18 Nov and **published 24 Nov 2026** (Google Auth Platform → Branding: "Your branding has been verified and is being shown to users").
- [ ] **Calendar verification:** after publishing the branding, submit `calendar.readonly` in the Verification Center with a short demo video (sign in → Connect Calendar → Today). (`calendar.app.created`, for two-way calendar, needs no review.)
- [ ] **Chrome Web Store (1.5.0):** *uploaded 2026-11-24 as a draft from GitHub (Actions → Store → upload, main `1b134de`).* Left for you, in the Developer Dashboard: update the listing from [STORE_SUBMISSION.md](STORE_SUBMISSION.md) (screenshots, description, permission notes, data usage), then **Submit for review**. Until it's approved, extension users keep 1.4.0.
- [x] **Store releases from GitHub, one-time setup** — *done 2026-11-24:* Chrome Web Store API on in the `prodli` project; service account `chrome-web-store@prodli.iam.gserviceaccount.com` (no Cloud roles) added in the Developer Dashboard; GitHub secrets `CWS_SERVICE_ACCOUNT` and `PRODLI_GOOGLE_CLIENT_ID` and variable `CWS_PUBLISHER_ID` set. A `build` run passed (1.5.0 zip with sign-in). The first real `upload` (1.5.0) worked on 2026-11-24.
- [ ] **Real purchase test (live Dodo):** on app.prodli.com → Settings → Plan & usage → Get Pro (yearly or monthly) → pay with a real card → check the plan turns on by itself; then "Switch to Pro Plus" (charged the difference) → check it says Pro Plus; then cancel in Manage subscription and refund yourself in the Dodo dashboard. Also try picking a plan on prodli.com while signed out (sign in → checkout opens by itself).
- [x] **ProdLi Pro:** live in Dodo Payments (verification approved, live products, API key and webhook; on sale since 2026-11-22). Pro Plus ($12/$120) and the lower Pro limits went live on 2026-11-24 (production version 3ba3d0ed) — [docs/PRO-PLAN.md](docs/PRO-PLAN.md).
- [x] **Chrome Web Store: version number.** *done 2026-11-24:* raised to 1.5.0; `STORE_SUBMISSION.md` lists what's new and the screenshot data disclosure. Rebuild the zip from `main` right before uploading.
- [ ] **Two-way calendar, first real run:** on Today, turn on "Show blocks in Google Calendar" with your real Google account; check a "ProdLi" calendar appears in Google Calendar, a block shows there, and moving/deleting the event moves/unblocks the task in ProdLi.
- [ ] **Real-use checks:**
  - [ ] A real Google Meet call with captions on (full transcript, summary)
  - [ ] Captions off for part of a call with on-device transcription on (gaps filled, marked "on device")
  - [ ] A time-block reminder going off; "Add to Google Calendar"
  - [ ] A weekly review with your real data
  - [ ] Phone: the web app (Share → Add to Home Screen)
- [ ] **Phone app (iOS + Android):** one-time setup in [docs/MOBILE.md](docs/MOBILE.md) → "One-time setup": Expo account, iOS + Android Google OAuth clients, Apple Developer ($99/yr) and Google Play ($25) accounts; then `eas build` and a TestFlight / internal-testing beta. Listing text, screenshots and privacy answers are ready in [docs/MOBILE-STORE.md](docs/MOBILE-STORE.md). Ask the lawyer about the phone-app additions in `docs/legal/REVIEW-NOTES.md` §9. (The production API has had phone sign-in since the 22–24 Nov deploys.)
- [ ] **Desktop app (Mac + Windows):** production API with desktop sign-in is live (2026-11-21); next: Apple + Windows signing certificates and a download page — [docs/DESKTOP.md](docs/DESKTOP.md) → "Before shipping".
  - [ ] Your lawyer reviews [docs/legal/DESKTOP-ADDITIONS.md](docs/legal/DESKTOP-ADDITIONS.md) (privacy and terms wording for the desktop apps) before it goes on prodli.com.
  - [ ] Google Calendar in the desktop app needs a Google "Desktop app" OAuth client in the prodli Google Cloud project.
  - [ ] One real-world check on a signed build: record a real call and sign in with your own Google account.
- [x] **Cloudflare billing alerts:** budget alerts at $10 (auto-created) and $25 (added 2026-11-17), emailed to the account owner

## Working in Claude Cloud (from 2026-11-24)

Day-to-day building runs in Claude Code cloud sessions; the guide for them is [CLAUDE.md](CLAUDE.md). Some work still needs this Mac:

- [ ] **On the Mac only:** Chrome Web Store builds and uploads (`.env.local` secrets), anything in your own Chrome (Dodo, Google Cloud console, Chrome Web Store dashboard, Search Console), desktop app builds and signing (macOS), and the desktop e2e/smoke scripts.
- [x] **Production deploys:** from GitHub, not a laptop — Actions → Deploy → Run workflow → `production-api`. It saves a database restore point first (shown in the run summary), deploys, and checks the health endpoint. *2026-11-24:* the `production` environment now needs your approval (required reviewer: you) and only deploys from `main`; GitHub emails you to approve each run. Note: when the repo turns private (1 Dec), check this still applies on your GitHub plan (protection rules on private repos may need GitHub Pro).
- [x] **Cloud environment:** *created 2026-11-24* in claude.ai/code as **ProdLi** (repo sysuin/prodli; Limited network with package managers plus dl.google.com, deb.nodesource.com, github.com, *.githubusercontent.com, expo.dev, api.expo.dev, u.expo.dev, app.prodli.com, prodli.com; setup script runs `scripts/cloud-setup.sh`; no secrets). The "Default" environment is ReadX's; leave it as it is.
- [x] **First cloud session (check):** *passed 2026-11-24* ("ProdLi environment verification"): setup, typecheck, all unit tests, extension build and e2e suites (smoke, quickwins, habits, snippets). Fixed after it: the environment's setup script now finds the repo at `/home/user/prodli`, and merging uses `scripts/pr.sh` (REST) because GraphQL `gh pr …` commands are blocked in cloud sessions.
- [ ] **Your preferences travel in CLAUDE.md** (batch PRs, merge after CI, ask before deploys/store/billing). Edit it there, not in a session's local memory.

## Before 1 Dec 2026 (found by the first cloud session, 2026-11-24)

- [x] **GitHub Actions minutes:** *done 2026-11-24:* the uptime check runs hourly as one job (it was three jobs every 15 minutes, about 8,600 billed minutes a month once private); now about 720 a month. Was: `.github/workflows/uptime.yml` runs every 15 minutes; once the repo is private again (1 Dec), each run bills at least 1 minute, more than GitHub Free's 2,000 before any CI run (15–18 minutes each).
- [x] **Store kit out of date:** *done 2026-11-24:* the description and the `identity` row say how the "ProdLi" calendar is used; the `contextMenus`, `activeTab` and `scripting` rows cover Screenshot to ProdLi and the snippet picker; "Before you submit" is for 1.5.0. Was: `STORE_SUBMISSION.md` still says Google Calendar access is read-only (description and the `identity` permission note), but 1.5.0 also writes to a "ProdLi" calendar (`calendar.app.created`; the Privacy page already says so). The "Before you submit" checklist still lists 1.4.0 items. Fix both before uploading 1.5.0.
- [x] *Small:* *done 2026-11-24:* `scripts/pr.sh` with no arguments prints one stray line (`set -euo pipefail`) after its help.

## Next — Claude can do

- Nothing pending before launch.

## Lawyer review (collected from all sessions)

- [ ] `docs/legal/REVIEW-NOTES.md` §9: phone-app additions to the privacy policy.
- [ ] `docs/legal/REVIEW-NOTES.md` §10: uninstall survey and growth report wording (from the GTM session, 22 Nov).
- [ ] `docs/legal/DESKTOP-ADDITIONS.md`: desktop app privacy and terms wording.
- [ ] The screenshot text extraction, Indian languages and web dictation lines added to the Privacy page on 24 Nov (already live; worth a look).

## Optional

- [ ] **If user data ever leaks** (not legally required to plan ahead; India's breach rule applies from 13 May 2027):
  1. Contain it: rotate the Cloudflare, Anthropic and Google keys; Account → "Sign out everywhere"; switch off the affected feature.
  2. Notify quickly: affected users and India's Data Protection Board without delay, with a detailed report within 72 hours; the EU authority within 72 hours if EU users are at risk.
  3. Ask the lawyer who must be told (also whether CERT-In's 6-hour reporting applies), and keep a written log of what happened and what you did.

## Feature plan (from research, 2026-11-23)

Why and evidence for each item: [docs/research/2026-11-productivity-apps-feature-plan.md](docs/research/2026-11-productivity-apps-feature-plan.md). Which features of the most-installed apps and extensions fit ProdLi: [docs/research/2026-11-most-installed-apps-and-extensions.md](docs/research/2026-11-most-installed-apps-and-extensions.md). Effort is for one developer; add a 30–50% buffer. Statuses checked against `main` on 2026-11-23.

**Tier 1: next 2–4 weeks** (1 and 5 are the real work; 2–4 are mostly built already)
- [x] **1. Meeting trust pack** — *done 2026-11-23:* opt-in heads-up posted in the Meet chat, auto-delete for recordings and meetings (off by default), "Download everything as Markdown" and a 60-day shutdown-notice promise (Privacy). Was: one-click notice to participants (chat line or spoken intro), visible recording indicator, auto-delete for audio and transcripts, one-page "export everything", and a written promise to keep export working if ProdLi ever shuts down.
- [x] **2. Voice brain-dump to tasks and plan** — *done 2026-11-23:* "Plan these for today" in Speak tasks, and the dictation shortcut opens Speak tasks in ProdLi when no text box is selected. Was: 🎙 Speak tasks (`lib/voiceTasks.ts`) turns a spoken brain dump into reviewed to-dos. Left (1–2 days): start it from the dictation shortcut, and an option to drop the result straight into Plan your day.
- [x] **3. Recipes and citations in Ask** — *built:* saved prompts and scheduled prompts (`lib/askPrompts.ts`), answers with sources (`lib/ask.ts`). Starter recipes added 2026-11-23. Left: a real-use check.
- [x] **4. Focus friction** — *built:* scheduled blocking and blocking during Pomodoro, with a pause page ("Close tab" / slow "Continue anyway") (`lib/focusBlock.ts`, `PausePage.tsx`). Shorts and Reels blocks added 2026-11-23 (A8).
- [x] **5. Conversion mechanics** — *done 2026-11-24:* Pro limits lowered (Ask 500, writing 1,000, dictation 3,000) and a third plan, **Pro Plus** ($12/month, $120/year, ~3× limits, 10 GB); plan cards with a Monthly/Yearly switch, one-page checkout, sign-in that carries on to checkout, plan switching without a second subscription (docs/PRO-PLAN.md). Earlier, 2026-11-23: 14-day reverse trial for new accounts, trial reminder and monthly value recap on Today. Decided: keep $5 everywhere (no India price for now). Was: 14–30-day reverse trial (full Pro, then free), free plan limits history and AI volume rather than features, monthly "value recap", annual plan (about two months free), India price (try ₹199/month or ₹1,499/year; check UPI AutoPay in Dodo), fair-use allowance for AI transcription.
- [x] **Start Google verification for a Calendar write scope now** — not needed: `calendar.app.created` is non-sensitive (added to the consent screen 2026-11-23). Was: (1 day of paperwork; it takes weeks and gates item 6).

**Tier 2: next quarter** (6–8 first; 13 can slip)
- [x] **6. Two-way Google Calendar** — *built 2026-11-23:* blocks go to a "ProdLi" calendar (scope `calendar.app.created`), moves/deletes in Google come back. Scope added to the Google consent screen 2026-11-23 (non-sensitive: no review needed). Was: (2–3 weeks + verification): put time blocks and tasks on the real calendar, move them, keep both sides in step.
- [x] **7. Meetings tied to calendar events** — *built 2026-11-23:* recordings are filed under the event on now (Meet link or time), show it and its invitees, and prep matches the series. (The "remember to record" nudge and prep reminders already existed.) Was: (1–2 weeks): "starts in 2 minutes, take notes?", notes filed under the event, prep card with past notes and open action items for the same people.
- [x] **8. Basic importer** — *built 2026-11-23:* Todoist CSV/backup zip, TickTick backup, Google Tasks (Takeout), generic CSV, Markdown; preview, Undo, no duplicates. Todoist API sign-in not built (no host permission). Was: (1–1.5 weeks): Todoist (API token), TickTick and Google Tasks files, generic CSV — the first part of the import plan below, brought forward because switching is when people pay.
- [x] **9. Gentle day mode** — *built 2026-11-23:* Today's Now card (countdown, steps, Done, +5 min), ✨ Break it down (AI steps), reminders that repeat every 10 min until done. Was: (2–3 weeks): vertical visual timeline, big countdown for the current block, one-tap AI "break this down", reminders that repeat until done or snoozed (ADHD-friendly).
- [x] **10. Read-only MCP server and personal API** — *built 2026-11-23:* API keys (Settings → Connections), `/api/v1/*` and `/mcp` (docs/API.md). Was: (1–2 weeks) over tasks, notes, meetings and time, so Claude and ChatGPT can read ProdLi.
- [x] **11. Scheduled prompts** — *built* (`lib/askPrompts.ts`: saved prompts run on chosen days, answers in a small inbox with a notification). Left: email delivery, phone push once the phone app ships.
- [x] **12. Upload any recording for notes** — *built 2026-11-23:* ⬆ Upload recording in Meetings (audio/video up to 500 MB / 3 h). Was: (2–4 days): phone memos, Plaud exports, in-person meetings.
- [x] **13. Web clipper and read-later** — *built 2026-11-23:* read aloud, Save highlight to ProdLi, Read later → to-do. Was: — *partly built:* Read later and right-click page summaries to notes (`lib/readLater.ts`). Left (1–2 weeks): highlights, link to a task, and read aloud with the browser's text-to-speech.

**Tier 3: later / needs the native apps**
- [ ] **14.** System-wide dictation in the desktop app, later a phone keyboard (3–5 weeks for desktop).
- [ ] **15.** Capture audio from the Zoom and Teams desktop apps (3–4 weeks, plus OS permission and consent).
- [ ] **16.** Phone quick capture: widget, voice memo to tasks, reliable reminders, offline queue (4–8 weeks).
- [ ] **17.** Note properties and a table view, a light Notion database (4–6 weeks).
- [ ] **18.** Blocking whole apps on desktop and phone (2–4 weeks per platform).

**Additions from the install research** (2026-11-23; ranked, best first; why: [docs/research/2026-11-most-installed-apps-and-extensions.md](docs/research/2026-11-most-installed-apps-and-extensions.md))
- [ ] **A1. Desktop menu-bar timer** (2–4 days, desktop): Pomodoro countdown, next meeting and top task in the tray; keep-awake toggle, and automatic keep-awake while recording or focusing.
- [x] **A2. Habit streak freeze and milestone moments** — *done 2026-11-24:* a freeze is earned every 7 days of streak (hold up to 2) and covers a missed day automatically (light blue on the heatmap); milestones (3, 7, 14, 30, 100… days) get a celebration. Web, Today and the phone app. Was: (2–3 days, web + phone).
- [x] **A3. Screenshot to note or task** — *done 2026-11-24:* right-click → Screenshot to ProdLi, or 📸 in Quick add (Alt+Shift+A); crop, box, arrow, highlight, undo; save as a note or a to-do linked to its note; ✨ Pull out the text (`/api/ai/ocr`, writing allowance) so Ask finds it. activeTab only, no new permission. Full-page capture not built. Was: (5–8 days, +3–4 for full-page; extension, then paste in the web app): visible area or region, annotate, AI pulls out the text. No new permission.
- [x] **A4. One palette with prefixes** — *done 2026-11-24:* ⌘K and Quick add (extension window, desktop global shortcut) read t / n / h / p 25 / ? (and s for snippets in the extension). Was: (4–6 days, desktop + extension): "t" to-do, "n" note, "h" habit, "p 25" Pomodoro, "?" Ask — shared by Quick add and Cmd+K.
- [ ] **A5. Phone widgets** (2–3 weeks): habit check-off with streak, today's to-dos, next meeting (replaces part of Tier 3 #16).
- [ ] **A6. Phone share sheet** (1–2 weeks): link, text or image to a note, task or Read later.
- [x] **A7. Read aloud** (done with item 13) (2–3 days, all): Read later items, summaries and notes (`tts` permission, no warning).
- [x] **A8. Block Shorts and Reels** (1–2 days, extension): path-level blocks like youtube.com/shorts, instagram.com/reels in focus blocking.
- [ ] **A9. Morning brief and scheduled-prompt answers as phone notifications** (2–4 days).
- [ ] **A10. System-wide dictation into any app** (3–5 weeks, desktop): moved up from Tier 3 #14 to the first desktop feature once the app is signed.
- [ ] **A11. Document scan to a note with OCR**, searchable in Ask (1–2 weeks, phone).
- [x] **A12. Hindi and other Indian languages** — *done 2026-11-24:* Settings → Language (Automatic, English, Hindi, Hinglish, Bengali, Marathi, Telugu, Tamil, Gujarati, Kannada, Malayalam, Punjabi, Urdu), free. Dictation tells Whisper the language (`language`, ISO 639-1) and the clean-up keeps the script; Hinglish goes to Whisper as Hindi and the clean-up writes Latin letters. Speak tasks listens in hi-IN etc. and keeps titles in that language with English date words; the brief is written in it. Left: a check with real speech. Was: for dictation, Speak tasks and the daily brief (3–7 days).
- [x] **A13. Snippet picker** — *done 2026-11-24:* right-click any text box → Insert a ProdLi snippet, or an optional shortcut (chrome://extensions/shortcuts); searchable, types into the field, fills {date}/{time}/{day}; "s" in ⌘K copies one. Uses the dictation snippets. Was: (3–5 days, extension): a shortcut or palette opens saved snippets and inserts into the focused field (no all-sites permission). All four Chrome shortcut slots are used, so it goes in the palette.
- [ ] **A14. Clipboard history** (2–3 weeks, desktop): send to note or task, AI transforms, skips password-manager copies.
- [ ] **A15. Follow-ons** (desktop + phone): desktop region screenshot with OCR (reuses A3), Pomodoro on the phone lock screen (Live Activity).
- [ ] *Cheap extra:* list ProdLi on Edge Add-ons with the same package (~1 day).
- Phone items (A5, A6, A9, A11, A15) need native device builds, which can't be tested in the current setup; treat them as riskier than their effort.
- **Rule:** no feature may add a required all-websites permission. Anything that needs one ships as an optional permission asked for on first use, or doesn't ship.

**Decided not to build** (reasons in the report): a Gmail client or full Gmail dashboard (at most right-click "email to task"), AI that rearranges the calendar by itself, autonomous agents, scheduling links, team spaces, screen recall / always-on recording / wearables, focus soundscapes, whiteboards and graph views, a generic "chat with this page" sidebar. From the install research: ad blocking, coupons, password managers; dark mode for sites, video speed, volume boost, grammar underlines, inline translation bubbles (all need every-site access); PDF editing, an office suite, an authenticator, a QR scanner; a full launcher (app/file search), window management, system monitor, menu-bar organiser, keyboard remapping; system-wide text expansion; a tab suspender; a bookmarks manager; hosted screen-recording links; a multi-model chat picker; pet/companion gamification; a watch app; a Firefox port (for now).

**Positioning:** lead with meetings, not "15 apps in one": "No bot joins your call. Your action items land in tomorrow's plan, and Ask finds anything you said. $5."

## Next ideas

- [ ] **Import from other apps (first part is Feature plan item 8):** ~~"paste a list"~~ (covered by 🎙 Speak or paste tasks, 2026-11-24), then Todoist/TickTick/CSV files with a preview and Undo, then Google Tasks and Microsoft To Do sign-in; later notes (Notion, Evernote, Keep), meeting transcripts (Otter, Granola) and habit history. Plan, difficulty and the full wish list: [docs/PLAN-IMPORT.md](docs/PLAN-IMPORT.md)
- [x] **Upload Retry resumes:** *done 2026-11-24:* finished pieces are kept on the device while it runs; Retry sends only the rest and joins the transcript in order. retrying a failed uploaded-recording transcription starts from the beginning, so minutes already used for pieces sent before the failure count twice. Resume from the last finished piece instead.
- [ ] **Editor, next round** (from the 2026-11-23 editor testing):
  - [x] Picture resizing and captions (done 2026-11-23: S/M/L/Full, drag the edge, caption) (pictures always fill the note width today).
  - [x] Code blocks: syntax colours, a language picker and a Copy button.
  - [x] Find & replace inside a note (done: Ctrl/⌘+F, Ctrl/⌘+Shift+F for replace) (Ctrl/⌘+F finds with the browser, no replace).
  - [x] Phone toolbar (done: everyday buttons fit): only a few formatting buttons fit before it scrolls.
  - [x] The ⋮⋮ block handle on touch screens (done: follows the block you tap) (hidden on phones and tablets).
  - [ ] Check pasting from real apps (Google Docs, Word, Notion) and on a real phone — only simulated so far.
- [ ] **Mail section (later; the 2026-11-23 research says don't build the full dashboard, see Feature plan):** a Gmail dashboard in the extension (needs reply / waiting on others / newsletters, add to to-dos), read in the browser with `gmail.readonly` and sorted by Chrome's on-device AI, so email never reaches ProdLi's servers and Google's paid security assessment shouldn't apply. Works for up to 100 testers right away; public use needs Google's free restricted-scope review. Plan: [docs/PLAN-MAIL.md](docs/PLAN-MAIL.md)
- [ ] **Phone app keeps Notion-style blocks:** the phone app's note editor flattens callouts, toggles and text/background colours made in the extension (they come back as plain text). Render them, or at least keep them intact when a note is edited on the phone.
- [ ] **Dictation outside the extension:** *web app and desktop app done 2026-11-24* (Alt+Shift+D or the 🎙 on a ProdLi text box, Whisper + AI clean-up, Command Mode). Left: system-wide dictation (any app) through the desktop app (A10).
- [ ] Keep an eye on Meet page changes (the captions reader is tested against a simulated Meet page in English and Spanish)
- [ ] Real-use checks for 1.4.0: a Zoom web call and a Teams web call (with "Include my microphone" on), and 🎙 Record in person on a phone (app.prodli.com)
- [ ] Move inline styles into shared UI components (needed before a web/desktop app)
- [x] Optional: publish to the Chrome Web Store from CI (the Web Store API is free) — *built 2026-11-24:* Actions → Store (`.github/workflows/store.yml`): build, upload as a draft, or submit for review. Needs the one-time setup below.
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
