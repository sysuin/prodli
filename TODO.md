# ProdLi — To-Do

Last updated: 2026-11-08

## Now — finish the meeting recorder (v1.2.0)

- [ ] **Test on a real Google Meet call**: load `artifacts/prodli/dist-extension` unpacked, record a short call, and check:
  - [ ] Transcript is captured from Meet captions (speaker names correct)
  - [ ] Audio recording plays back (with and without microphone)
  - [ ] Summary + action items generate with your Claude API key
  - [ ] Stop works from: badge, toolbar icon, Alt+Shift+R, leaving the call, closing the tab
- [ ] **Try the Files previewer** with your own files: drag one onto ProdLi, then use Save to Notes
- [ ] **Commit the recorder + Files work** to a new git branch
- [ ] **Get the code back into one place**: push to GitHub (the code currently lives on Replit plus this local copy, with no GitHub backup)
- [ ] **Update the Chrome Web Store listing** for v1.2.0: new description, Meetings and Files screenshots, "all-in-one workspace" wording
- [ ] **Update the privacy policy and store data disclosure**: meeting transcripts can now go to Anthropic (Claude) when the user adds their key
- [ ] Submit v1.2.0 to the Chrome Web Store (expect a slower review because of the tab-audio permission)

## Recorder improvements

- [ ] Detect "left the call" in languages other than English (it only checks for the English "Leave call" button today)
- [ ] Keep an eye on Meet page changes; the captions reader depends on Meet's page structure
- [ ] Transcription option for when captions aren't on (e.g. a speech-to-text service, or on-device Whisper)
- [ ] Move AI calls to a ProdLi server before public launch (instead of each user pasting their own key)
- [ ] Zoom / Microsoft Teams support (web versions first; desktop apps need the future desktop app)
- [ ] Mobile: mic-based recording for in-person meetings and phone calls

## Bugs in existing features

- [ ] **Backup skips Time Tracker data**: `src/lib/backupRestore.ts` doesn't export the `tt_*` history or `tt_settings`
- [ ] **Pomodoro stops when its tab closes**: the timer runs inside the page and isn't saved, and other tabs don't show it running. Move it to the background worker (alarms). The store listing currently says it "keeps running across tabs".

## Foundation (before accounts and sync)

- [ ] **Change how data is saved**: give every note, to-do and habit its own ID, a "last changed" time and a "deleted" flag, so syncing devices doesn't overwrite changes (today each tool saves its whole list at once)
- [ ] Add automated tests (start with storage, backup/restore, the captions reader and To-Do creation from meetings)
- [ ] Split `TimeTrackerSection.tsx` (1,767 lines) into smaller files
- [ ] Move inline styles into shared UI components, so screens can be reused on web, desktop and mobile
- [ ] Remove build output (`dist-extension/`, `prodli-extension.zip`) from git and build it in CI instead

## Roadmap

- [ ] Accounts + cloud sync (use the existing `api-server` + PostgreSQL skeleton); keep "use without an account"
- [ ] Web app (app.prodli.com), reusing the extension's screens
- [ ] Desktop app (Mac/Windows) with native meeting recording for any app
- [ ] Mobile app

## Files previewer — later improvements

- [ ] Export notes as Markdown (`.md` download from the Editor)
- [ ] Keep a "recent files" list (needs the File System Access API to reopen files)
- [ ] Syntax highlighting for code files (`.js`, `.py`, `.yaml`, …)
- [ ] Save CSV files to Notes as real tables (the Editor needs a table extension first)
- [ ] Decided against: auto-opening `.md` / `.json` from websites or `file://` links (needs the "all websites" permission, and free extensions already do it)

## Done

- [x] 2026-11-08 — Meeting recorder for Google Meet (no bot, Meet captions, Claude Haiku 5.5 notes, action items → To-Dos)
- [x] 2026-11-08 — Files previewer: Markdown, JSON / JSON Lines (tree + search), CSV / TSV tables, text and code; drag-and-drop anywhere; Save to Notes
