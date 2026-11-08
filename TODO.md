# ProdLi — To-Do

Last updated: 2026-11-08 · Branch: `feature/meetings-and-files` · Cost plan: [docs/COSTS.md](docs/COSTS.md)

## Now — needs you

- [ ] **Test the recorder on a real Google Meet call**: load `artifacts/prodli/dist-extension` unpacked (`chrome://extensions` → Developer mode → Load unpacked), record a short call, and check:
  - [ ] Transcript is captured from Meet captions (speaker names correct)
  - [ ] Audio recording plays back (with and without microphone)
  - [ ] Summary + action items generate with your Claude API key
  - [ ] Stop works from: badge, toolbar icon, Alt+Shift+R, leaving the call, closing the tab
- [ ] **Quick check of this round's changes** in your own Chrome: Files tab, Editor ⬆/⬇ Markdown buttons, Pomodoro across tabs, Backup export
- [ ] **Leave Replit** — follow [docs/MOVING-OFF-REPLIT.md](docs/MOVING-OFF-REPLIT.md):
  - [ ] Push to a private GitHub repo (CI then runs all tests on every push)
  - [ ] Create the free Cloudflare Pages project + add the two GitHub secrets
  - [ ] Move prodli.com DNS to Cloudflare, **keeping the Hostinger email (MX/TXT) records**
  - [ ] After a few days on Cloudflare: unpublish the Replit deployment and cancel any Replit plan
- [ ] **Update the Chrome Web Store listing** for v1.2.0: new description, Meetings and Files screenshots, "all-in-one workspace" wording; remove "keeps running across tabs" caveats (now true)
- [ ] **Update the privacy policy and store data disclosure**: meeting transcripts can go to Anthropic (Claude) when the user adds their key
- [ ] Submit v1.2.0 to the Chrome Web Store (expect a slower review because of the tab-audio permission)

## Recorder improvements

- [ ] Detect "left the call" in languages other than English (only the English "Leave call" button is checked today)
- [ ] Keep an eye on Meet page changes; the captions reader depends on Meet's page structure (`pnpm test:e2e` covers it against a simulated Meet page)
- [ ] Transcription option for when captions aren't on (e.g. a speech-to-text service, or on-device Whisper)
- [ ] Move AI calls to a ProdLi server before public launch (instead of each user pasting their own key)
- [ ] Zoom / Microsoft Teams support (web versions first; desktop apps need the future desktop app)
- [ ] Mobile: mic-based recording for in-person meetings and phone calls

## Files previewer — later improvements

- [ ] Keep a "recent files" list (needs the File System Access API to reopen files)
- [ ] Syntax highlighting for code files (`.js`, `.py`, `.yaml`, …)
- [ ] Save CSV files to Notes as real tables (the Editor needs a table extension first; Markdown tables are also lost when a .md is saved as a note)
- [ ] Decided against: auto-opening `.md` / `.json` from websites or `file://` links (needs the "all websites" permission, and free extensions already do it)

## Foundation (before accounts and sync)

- [ ] **Change how data is saved**: give every note, to-do and habit its own ID, a "last changed" time and a "deleted" flag, so syncing devices doesn't overwrite changes (today each tool saves its whole list at once)
- [ ] Add tests for the Time Tracker and Habits (only smoke-tested today)
- [ ] Split `TimeTrackerSection.tsx` (1,767 lines) into smaller files
- [ ] Move inline styles into shared UI components, so screens can be reused on web, desktop and mobile
- [ ] Optional: publish to the Chrome Web Store from CI (the Web Store API is free)

## Roadmap

- [ ] Accounts + cloud sync on Cloudflare Workers + D1 (free tier; see [docs/COSTS.md](docs/COSTS.md)); keep "use without an account"
- [ ] Web app (app.prodli.com), reusing the extension's screens
- [ ] Desktop app (Mac/Windows) with native meeting recording for any app
- [ ] Mobile app

## How to test

From the repo root (see README.md for all commands):

- `pnpm run typecheck` — TypeScript
- `pnpm test` — unit tests (file parsing & sanitizing, Pomodoro timer, backup/restore, Markdown export)
- `pnpm test:e2e` — builds the extension and drives it in a throwaway headless Chrome (all 7 tabs, Meetings, Files, captions reader, Pomodoro across tabs + background completion, Markdown import/export, backup). Set `CHROME_PATH` if Chrome isn't in the default place.

## Done

- [x] 2026-11-08 — Meeting recorder for Google Meet (no bot, Meet captions, Claude Haiku 5.5 notes, action items → To-Dos)
- [x] 2026-11-08 — Files previewer: Markdown, JSON / JSON Lines (tree + search), CSV / TSV tables, text and code; drag-and-drop anywhere; Save to Notes
- [x] 2026-11-08 — Backup now includes Time Tracker history + settings and meetings (no audio; the Claude API key is never exported); old 1.0 backups still restore
- [x] 2026-11-08 — Pomodoro keeps running across tabs and when ProdLi is closed; the background finishes phases, logs sessions and notifies
- [x] 2026-11-08 — Editor: import a Markdown file as a note, export a note as Markdown
- [x] 2026-11-08 — Top bar fits on smaller screens (icons only below ~1040 px)
- [x] 2026-11-08 — Automated tests: 31 unit tests + 44 browser checks
- [x] 2026-11-08 — Markdown safety: never show unsanitized HTML if the sanitizer can't run
- [x] 2026-11-08 — Independent of Replit: removed Replit config/plugins/packages and the unused backend template; builds on any OS; `pnpm run build:web` produces a static website for free hosting; GitHub Actions CI + Cloudflare Pages deploy workflows; build output no longer committed; website-only files removed from the extension zip
