# ProdLi v1.3.0 — Chrome Web Store submission kit

Everything to paste into the [Developer Dashboard](https://chrome.google.com/webstore/devconsole) for this update.

## 1. Package

- Build: `pnpm run build:extension` from the repo root → `prodli-extension.zip` (or download it from the latest CI run on GitHub → Actions → Artifacts).
- For Google sign-in to work in the store build, build with `PRODLI_GOOGLE_CLIENT_ID` set (see `docs/GOOGLE-SIGN-IN.md`). Without it, sign-in shows "not set up" and everything else works.
- Version in `artifacts/prodli/extension/manifest.json`: **1.3.0** (bump for every upload).

## 2. Store listing → Graphics

| Slot | File (in `artifacts/prodli/store-assets/`) |
|---|---|
| Screenshot 1 | `screenshot-1-editor.png` — notes with checklists and tables |
| Screenshot 2 | `screenshot-2-meetings.png` — AI meeting notes |
| Screenshot 3 | `screenshot-3-todos.png` |
| Screenshot 4 | `screenshot-4-time-tracker.png` |
| Screenshot 5 | `screenshot-5-files.png` — file previewer |
| Small promo tile (440×280) | `promo-440x280.png` |

Extra (if you prefer them): `screenshot-6-habits.png`, `screenshot-7-pomodoro.png`. All are 1280×800 and regenerated from the real extension with `node scripts/store-screenshots.mjs` (from `artifacts/prodli/`, after a build).

## 3. Store listing → Text

**Name:** ProdLi — Productivity New Tab

**Short description** (124 characters — the limit is 132):

```
Notes, to-dos, Pomodoro, habits, time tracking, AI meeting notes for Google Meet and a file previewer — all in your new tab.
```

**Detailed description:**

```
ProdLi turns your new tab into an all-in-one productivity workspace. Seven tools, one tab — and your data stays on your device. No account needed.

✍️ NOTES THAT FEEL PROFESSIONAL
Type "/" to insert checklists, tables, headings, quotes, code blocks and dividers. Select text for quick formatting, paste Markdown and it just works, pin important notes, search everything, see an outline of long notes, and export to Markdown or PDF. Notes save automatically — even with ProdLi open in several tabs.

🎙️ AI MEETING NOTES FOR GOOGLE MEET — NO BOT
Click the ProdLi icon in a Google Meet call. ProdLi builds a transcript from Meet's live captions (only you see them) and, with your own Claude API key, turns it into a summary, decisions and action items. Send action items straight to your to-do list. No bot joins the call.

✅ TO-DOS
Priorities, due dates, subtasks, drag to reorder, and filters.

🍅 POMODORO
A focus timer that keeps running across tabs — even when ProdLi is closed — with a notification when time is up and a log of your sessions.

🎯 HABITS
Daily check-ins with streaks and a heatmap calendar.

⏱ TIME TRACKER
See where your browsing time goes: today, the last 7 days, and all-time charts. Set daily limits per site with optional auto-redirect. Only domain names are recorded, never full URLs.

📄 FILE PREVIEWER
Drop a Markdown, JSON, CSV or text file anywhere on ProdLi to preview it beautifully, then save it as a note.

☁️ OPTIONAL GOOGLE DRIVE BACKUP
Sign in with Google to back up everything to a private ProdLi folder in your own Google Drive and restore it on another computer. No ProdLi servers.

PRIVACY
Your data lives in your browser. ProdLi has no servers, no analytics and no tracking. Optional features send data only where you choose: meeting transcripts to Anthropic with your own API key, and backups to your own Google Drive. Full policy: https://prodli.com/privacy
```

**Category:** Productivity · **Language:** English · **Homepage:** https://prodli.com · **Support:** contact@prodli.com

## 4. Privacy practices tab

### Single purpose
> ProdLi replaces the new tab page with a personal productivity workspace: notes, to-dos, a Pomodoro timer, habit tracking, browsing-time tracking, meeting notes and a file previewer. All features help the user organise their own work, and the data is stored on the user's device.

### Permission justifications

| Permission | Justification to paste |
|---|---|
| `storage` | Stores the user's notes, tasks, habits, Pomodoro data, time-tracking data and settings on the device so they persist between sessions. |
| `unlimitedStorage` | Notes, meeting transcripts and optional recordings can exceed the default storage quota; without it, saves could fail and the user could lose work. |
| `tabs` | Reads only the hostname of the active tab to total browsing time per domain for the Time Tracker. Full URLs, titles and page content are never read or stored. |
| `idle` | Pauses time tracking when the user is away so idle time isn't counted. |
| `alarms` | Schedules the tracking heartbeat, the daily summary notification, the end of Pomodoro sessions, and the optional daily Google Drive backup. |
| `notifications` | Notifies the user when a Pomodoro session ends, a daily site limit is reached, or meeting notes are ready. |
| `identity` | Used only if the user chooses "Sign in with Google", to back up their data to a private app-data folder in their own Google Drive. |
| `tabCapture` *(optional)* | Requested only when the user turns on the meeting recorder; captures the audio of the Google Meet tab the user explicitly starts recording (by clicking the toolbar icon or shortcut). |
| `offscreen` *(optional)* | Runs the audio recorder for the meeting recorder in an offscreen document. |
| `scripting` *(optional)* | Injects the caption reader into the Google Meet tab being recorded, and the Focus List auto-redirect when the user enables it. |
| Host access *(optional)*: `meet.google.com`, `<all_urls>` | `meet.google.com` to read live captions for meeting notes; other sites only for the optional Focus List redirect. |

### Remote code
**No, I am not using remote code.** All code is bundled in the package. (Network requests go only to Anthropic's API with the user's key and to Google's sign-in/Drive APIs — data, not code.)

### Data usage (declare conservatively)

Tick the types that can leave the device because of an optional feature the user turns on:
- **Personally identifiable information** — name, email and profile picture from Google sign-in (stored locally; used to show the signed-in account).
- **Personal communications** — meeting transcripts sent to Anthropic's API when the user adds a Claude key and requests a summary.
- **Web history** — per-domain browsing time, included in the user's own Google Drive backup when they turn it on.

Then certify all three: data is **not sold** to third parties, **not used or transferred for purposes unrelated** to the single purpose, and **not used for creditworthiness or lending**.

**Privacy policy URL:** https://prodli.com/privacy (updated November 2026 — covers Meetings, Google sign-in and the Google API Limited Use statement).

## 5. Before you submit

- [ ] Zip built from the latest `main` (with `PRODLI_GOOGLE_CLIENT_ID` if sign-in should work)
- [ ] Recorder tested on a real Google Meet call
- [ ] Five screenshots + promo tile uploaded; old screenshot removed
- [ ] Short and detailed descriptions pasted
- [ ] Permission justifications pasted (including the new `unlimitedStorage`, `identity`, `tabCapture`, `offscreen`)
- [ ] Data usage boxes ticked and the three certifications checked
- [ ] Privacy policy URL set; prodli.com/privacy shows the November 2026 version
- [ ] Submit — expect a longer review than usual because of the tab-audio permission
