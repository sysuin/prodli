# ProdLi — To-Do

Last updated: 2026-11-09 · Version 1.3.0 · Repo: https://github.com/sysuin/prodli · Cost plan: [docs/COSTS.md](docs/COSTS.md)

## Now — needs you

- [ ] **Test on a real Google Meet call** (load `artifacts/prodli/dist-extension` unpacked; disable the store copy):
  - [ ] With captions on: transcript with speaker names
  - [ ] With captions off + Meetings → Setup → "Transcribe on this computer" (click "Download speech model" once): transcript labelled You / Others
  - [ ] Audio playback (with and without microphone)
  - [ ] Summary + action items with your Claude API key
  - [ ] Stop works from: badge, toolbar icon, Alt+Shift+R, leaving the call (try Meet in another language too), closing the tab
- [ ] **Google sign-in** — [docs/GOOGLE-SIGN-IN.md](docs/GOOGLE-SIGN-IN.md):
  - [x] Google Cloud project, consent screen (Testing), OAuth client, test user
  - [x] Local builds use the store ID + client ID (`source .env.local && pnpm run build:extension`)
  - [ ] Add the `PRODLI_GOOGLE_CLIENT_ID` GitHub secret: `gh secret set PRODLI_GOOGLE_CLIENT_ID --repo sysuin/prodli`
  - [ ] Sign in on two computers and check notes sync both ways (including a deletion)
  - [ ] Before the store release: **Publish app** in Google Auth Platform → Audience
- [ ] **Leave Replit** — [docs/CLOUDFLARE.md](docs/CLOUDFLARE.md):
  - [x] Code on GitHub with CI
  - [x] prodli.com DNS on Cloudflare (Hostinger email records kept, DNS only)
  - [x] Website served by Cloudflare (`prodli-site` Worker)
  - [ ] Add `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` GitHub secrets so CI deploys
  - [ ] After a few days: unpublish the Replit deployment, cancel any Replit plan, delete the `replit-verify` TXT records
- [ ] **Web app + accounts** — [docs/PLAN-WEB-APP.md](docs/PLAN-WEB-APP.md): phase 0 (foundations) in review; next phase 1 (accounts)
- [ ] **Publish v1.3.0 to the Chrome Web Store** using [STORE_SUBMISSION.md](STORE_SUBMISSION.md) (screenshots in `artifacts/prodli/store-assets/`, listing text, permission justifications, data-usage answers). Expect a slower review because of the tab-audio permission.

## Next ideas

- [ ] Keep an eye on Meet page changes (the captions reader is tested against a simulated Meet page in English and Spanish)
- [ ] Move AI summaries to a ProdLi server for a smoother experience (instead of each user's own key) — only alongside a paid plan
- [ ] Zoom / Microsoft Teams web support
- [ ] Mobile: mic-based recording for in-person meetings
- [ ] Move inline styles into shared UI components (needed before a web/desktop app)
- [ ] Optional: publish to the Chrome Web Store from CI (the Web Store API is free)
- [ ] Decided against: auto-opening `.md` / `.json` from websites or `file://` links (needs the "all websites" permission; free extensions already do it)

## Roadmap

- [ ] Accounts on Cloudflare Workers + D1 (free tier) if/when a server is needed — Drive sync covers cross-device today
- [ ] Web app (app.prodli.com), reusing the extension's screens
- [ ] Desktop app (Mac/Windows) with native meeting recording for any app
- [ ] Mobile app

## How to test

From the repo root (see README.md for all commands):

- `pnpm run typecheck` — TypeScript
- `pnpm test` — unit tests (extension + API)
- `pnpm test:e2e` — builds the extension and runs ~100 checks in a throwaway headless Chrome (all tabs, Editor incl. two tabs, Meetings, captions reader in English + Spanish, Files, Pomodoro, real Time Tracker tracking incl. worker restarts, Habits, Drive sign-in/sync with a simulated Google, backup, accessibility audit). `E2E_SPEECH=1` adds the real on-device speech test (downloads Chrome's model). Run selected suites with `node artifacts/prodli/tests/e2e/run.mjs editor,files`.
- `node artifacts/prodli/scripts/store-screenshots.mjs` — regenerate store screenshots after UI changes.

## Done

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
