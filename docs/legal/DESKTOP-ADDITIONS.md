# Privacy policy and terms: proposed additions for the desktop apps

Status: **draft for legal review (21 November 2026). Not published.** The live policy and terms (`artifacts/prodli-site/src/pages/Privacy.tsx`) cover the extension, the web app and the account service. They don't yet mention ProdLi for Mac and Windows (`artifacts/prodli-desktop`, [docs/DESKTOP.md](../DESKTOP.md)). Each change below gives the section, the proposed wording, and the facts in the code behind it. Publish only after the lawyer's OK; the phone apps need the same review ([docs/MOBILE.md](../MOBILE.md)).

## Privacy policy

### "What this policy covers"
Proposed: *The ProdLi Chrome extension, the ProdLi apps for Mac and Windows, the web app at app.prodli.com, the website prodli.com, and the ProdLi account and sync service.*

### "What's stored on your device": add a desktop paragraph
Proposed:
> **Desktop app (Mac and Windows):** your workspace is stored in a file in the app's data folder on your computer, along with the meeting recordings you make. Your sign-in token is encrypted with your computer's keychain (Keychain on Mac, Windows' data protection on Windows). If you turn on **Track time in apps**, the app notes every few seconds the name of the app in front (for example "Slack") and adds up the time per day. Nothing is counted while you're idle or the screen is locked. Only app names are recorded, never window titles or what's on screen, and this stays on your computer (it isn't synced). Uninstalling the app leaves the data folder in place so a reinstall keeps your data; delete the folder to remove it.

Facts: `src/core/fileStore.ts` (one JSON file, `.bak`), `src/main/store.ts` (safeStorage), `src/main/appTracker.ts` + `src/core/appUsage.ts` (app names only, idle threshold, `apps_YYYY-MM-DD`, not in the sync list), `electron-builder.yml` (`deleteAppDataOnUninstall: false`).

### "Your account": sessions
Proposed addition: *…whether it's the extension, the web app, the phone app or the desktop app ("ProdLi app on Mac" / "on Windows")… Desktop and phone sessions end after 180 days without use.*

Facts: `SESSION_TTL.desktop = 180 days`, device label from `desktopDeviceLabel()` (the app sends only "mac" or "windows").

### Sign-in from the desktop app (new sentence under "Your account")
Proposed:
> The desktop app signs you in through your web browser: after you sign in at app.prodli.com, the page passes a one-time code to the app on your computer, which exchanges it for a session. The code works once, expires after five minutes and is stored only as a one-way hash.

Facts: `artifacts/prodli-api/src/desktopAuth.ts`, migration `0012_desktop_sessions.sql`.

### Meetings: recording calls in other apps
Proposed addition to the meetings section:
> In the desktop app, **Record a call** records your computer's sound (so the other people on a call in any app, such as Zoom or Teams) together with your microphone. The screen picture is never recorded. As with other recordings, the audio stays on your computer; it's sent for AI transcription only as described above, and isn't kept by us. On a Mac this needs your permission in System Settings (Screen & System Audio Recording, Microphone).

Facts: `src/recorder/desktopCall.ts` (video track stopped immediately), `src/main/media.ts`, audio in IndexedDB like in-person recordings, transcription via `/api/ai/transcribe` (existing processor: Cloudflare Workers AI).

### "Call reminders" (new, short)
Proposed:
> The desktop app can remind you to record when a call starts. On Windows it checks which apps are using your microphone (the same list Windows shows in its privacy settings); on a Mac it checks for Zoom's and Webex's in-meeting processes. This happens on your computer only; nothing is sent anywhere. You can turn it off in Settings › Desktop app.

Facts: `src/core/callDetect.ts`, `src/main/callNudge.ts`.

### Updates and downloads (new, short)
Proposed:
> The desktop app checks prodli.com about every six hours for a new version and downloads it from there. Like any website request, this shares your IP address with our host (Cloudflare); no account information is sent.

Facts: `src/main/updates.ts` (electron-updater, generic feed `https://prodli.com/download/desktop`), served by `artifacts/prodli-site/worker/downloads.js`.

### Processors
No new processor: the desktop app uses the same server (Cloudflare), AI (Anthropic; Cloudflare Workers AI for transcription) and Google sign-in (through the browser, as for the web app).

## Terms

- **"Agreement"**: add *the ProdLi apps for Mac and Windows* to the list of what the terms cover.
- **Recording calls** (existing meeting-consent clause): make it explicit that this also covers calls recorded with the desktop app in any app. *You're responsible for telling the other people on a call, and getting their consent where the law requires it, before you record it with ProdLi.*
- **Software licence / updates** (new, short): *We grant you a personal, non-transferable licence to install and use the desktop app. It updates itself to fix problems and add features; you can delay an update until you quit the app.*

## Questions for the lawyer

1. **Two-party consent and "record any call".** The desktop app makes recording calls in any app easy, which raises the stakes compared with the extension (where Meet's captions are the main path). Is the existing user-responsibility clause enough, or should the app show a one-time notice before the first call recording? The heads-up text button already exists in the recording bar.
2. **App-usage tracking.** It's opt-in, local only and records app names only. Does it need to be in the policy at all, given nothing leaves the device? (Proposed: yes, briefly, for transparency.)
3. **Store distribution.** If the Mac app goes to the Mac App Store later, Apple's privacy labels will be needed (same answers as the phone app: contact info, user content, audio, not used for tracking).
