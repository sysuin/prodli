# ProdLi for Mac and Windows

Status: **first version built** (2026-11-21), not yet distributed. One codebase, `artifacts/prodli-desktop` (Electron + TypeScript), builds both apps. The screens are the extension's / web app's own React code, so every section works the same.

## What's in the app

| | Desktop app | Extension | Web app |
|---|---|---|---|
| Today, Review, To-dos, Habits, Notes, Files, Pomodoro, Ask ProdLi | ✅ | ✅ | ✅ |
| **Record a call in any app** (Zoom, Teams, Slack, Meet, FaceTime…): computer's sound + microphone, no bot | ✅ | browser calls only | — |
| Record in person | ✅ | ✅ | ✅ |
| Works offline, data on this computer, sync with an account | ✅ | ✅ | ✅ |
| Quick add from anywhere (**Alt/Option+Shift+A**), menu bar / tray icon, dock menu | ✅ | Alt+Shift+A in Chrome | — |
| Keeps running when the window is closed (timers, reminders, sync, recordings) | ✅ | ✅ (background) | — |
| Google Calendar on Today | not yet (see below) | ✅ | ✅ |
| Time Tracker | view synced history | ✅ tracks | view |
| Open files: File → Open (⌘/Ctrl+O), Open With → ProdLi, drop on the dock icon | ✅ | drop on Chrome | drop / Open with (installed) |
| Automatic updates (once a download location is set up) | ✅ | Web Store | always latest |
| Settings › Desktop app: open at login, keep running when closed, recording permission | ✅ | — | — |
| Buying Pro | in the browser (Account → Plan opens checkout) | ✅ | ✅ |

## How it's built

```
artifacts/prodli-desktop/
  src/main/      main process: windows, menus + tray, data store, sign-in, call audio, app://prodli
  src/preload/   the bridge the page gets as window.prodliDesktop (nothing else: no Node, no Electron)
  src/core/      pure logic, unit-tested without Electron (store, asset paths + CSP, PKCE, menus, window bounds)
  scripts/       build.mjs (pages + main + preload), dev.mjs, make-icons.mjs
  tests/         unit tests (Vitest), e2e.mjs (real server + app), smoke.mjs (packaged app)
  electron-builder.yml   installers: Mac .dmg/.zip (universal), Windows .exe (x64 + arm64)
artifacts/prodli/
  vite.desktop.config.ts, index.desktop.html, src/main.desktop.tsx   the desktop build of the pages
  src/lib/desktop.ts           the bridge's type; isDesktop()
  src/lib/desktopCommands.ts   menu / tray commands → the page
  src/lib/desktopHandoff.ts + components/DesktopHandoff.tsx   app.prodli.com's half of sign-in
  src/recorder/desktopCall.ts  computer's sound + microphone for "Record a call"
```

- **Pages from `app://prodli/`.** A real origin (not `file://`) with its own strict Content Security Policy: only the app's own scripts, network only to ProdLi's server. Links open in the default browser; the window can't navigate anywhere else.
- **Data** lives in one JSON file in the app-data folder (`~/Library/Application Support/ProdLi/ProdLi Data/store.json`, `%APPDATA%\ProdLi\ProdLi Data\store.json`), under the same keys as the extension's `chrome.storage.local`. Writes are batched and atomic, the previous version is kept as `.bak`, and a damaged file is set aside and the backup used. Meetings' audio is in IndexedDB, as in the extension.
- **The session token** is encrypted with the OS keychain (Keychain on Mac, DPAPI on Windows) via Electron's `safeStorage`; the page reads it only to call the API.
- **Sign-in** (no new Google client needed): the app opens `app.prodli.com/?desktop=signin&port&state&challenge` in the browser; once you're signed in there and click **Open ProdLi**, the page gets a one-time code (`POST /api/auth/desktop/code`) and sends the browser to `http://127.0.0.1:<port>/callback`; the app trades the code and its PKCE verifier for a `desktop` session (`POST /api/auth/desktop/token`, 180 days, "ProdLi app on Mac/Windows" in the devices list). Codes are single-use, last 5 minutes and are stored hashed. Server: `artifacts/prodli-api/src/desktopAuth.ts`, migration `0012_desktop_sessions.sql`; the API also allows the `app://prodli` origin (CORS).
- **Record a call**: the page asks for display media; the app answers with loopback audio (Windows natively; macOS 13+ through ScreenCaptureKit) and the screen, whose video is dropped at once. The computer's sound and the microphone are mixed and go through the in-person recorder (saved in chunks, AI transcription after the call, summary). If the computer's sound isn't available (older macOS, or permission not given), it records the microphone alone and the meeting says so. Meetings recorded this way have platform `desktop` ("Call").
- **Security**: context isolation, sandboxed renderer, no Node in the page, permissions only for the app's own pages (microphone, display capture, notifications), Electron fuses on packaged apps (no run-as-Node, no `NODE_OPTIONS` / `--inspect`, asar integrity, app only from asar).

## Run it

```bash
pnpm install
pnpm --filter @workspace/prodli-desktop run typecheck
pnpm --filter @workspace/prodli-desktop run test
pnpm --filter @workspace/prodli-desktop dev            # development build, data in "ProdLi Dev"
```

Against a local server (`wrangler dev` with fake Google, see docs/MOBILE.md → "Against a local server"):

```bash
PRODLI_API=http://localhost:8787 pnpm --filter @workspace/prodli-desktop dev
```

End-to-end (starts the local server itself; plays the browser's part of sign-in; checks sync, CORS, encryption at rest):

```bash
pnpm --filter @workspace/prodli-desktop run test:e2e
```

Installers (unsigned unless a certificate is configured):

```bash
pnpm --filter @workspace/prodli-desktop run dist:mac   # release/ProdLi-<v>-mac.dmg (universal)
pnpm --filter @workspace/prodli-desktop run dist:win   # release/ProdLi-Setup-<v>-x64.exe / -arm64.exe (works on a Mac too)
node artifacts/prodli-desktop/tests/smoke.mjs <path to the packaged app's executable>
```

CI: every pull request builds a Linux package and smoke-tests it (`ci.yml`). Real Mac and Windows installers are built and smoke-tested by `.github/workflows/desktop.yml` — run it from Actions, push a `desktop-v1.0.0` tag, or change the packaging in a PR. The installers are attached to the run.

## Before shipping (needs you)

1. **Deploy the API to production** (Actions → Deploy → `production-api`): the desktop sign-in endpoints, migration 0012 and the `app://prodli` origin must be live on app.prodli.com, or sign-in and sync won't work in the app.
2. **Mac signing + notarization** (otherwise macOS says the app "can't be opened"): Apple Developer Program ($99/year, the same account as the iPhone app). Create a *Developer ID Application* certificate, export it as .p12, and add GitHub secrets `MAC_CERT_P12_BASE64` (`base64 -i cert.p12`), `MAC_CERT_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` (appleid.apple.com → App-Specific Passwords), `APPLE_TEAM_ID`.
3. **Windows signing** (otherwise SmartScreen warns "Windows protected your PC"): an OV/EV code-signing certificate (~$200–400/year) or Azure Trusted Signing (~$10/month). For a .p12 certificate add `WIN_CERT_P12_BASE64` and `WIN_CERT_PASSWORD`.
4. **Where people download it**: a "Download for Mac / Windows" page on prodli.com, with the installers on Cloudflare R2 (free egress). Automatic updates are built in (electron-updater, "generic" feed): set the repository variable `PRODLI_UPDATE_URL` to the public folder the installers and `latest*.yml` are uploaded to, and builds check it every 6 hours (Mac updates need signing).
5. **Lawyer**: add the desktop apps to the privacy policy and terms (same data as the extension; call recordings include other people's voices — the same disclosure as in-person recording).

## Not yet (next steps)

- Google Calendar on Today (needs a Google "Desktop app" OAuth client and the same browser hand-off).
- The download page and uploading builds to R2 (after signing).
- Native Time Tracker (which app / site you use), and "you're in a Zoom call — record it?" detection.
