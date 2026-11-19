# ProdLi v1.3.0: Chrome Web Store submission kit

Everything to paste into the [Developer Dashboard](https://chrome.google.com/webstore/devconsole) for this release: the first one with ProdLi accounts, sync, the daily brief, Ask ProdLi, the weekly review, writing help and the web app at app.prodli.com.

## 1. Package

- Build from the latest `main`, at the repo root:
  ```bash
  pnpm run build:extension:store
  ```
  This writes `prodli-extension-store.zip`. It always talks to https://app.prodli.com, includes Google sign-in from `.env.local`, and leaves out the `key` field (the store rejects it). It never touches the `dist-extension` folder your Chrome loads.
- Version: **1.3.0** in `artifacts/prodli/extension/manifest.json`. Raise it for every upload after this one.
- The store's name and summary come from the manifest: **ProdLi** and the summary in section 3.

## 2. Store listing → Graphics

All screenshots are 1280×800 and in `artifacts/prodli/store-assets/`. Upload 1–5 in this order and delete the old ones from the listing.

| Slot | File | Shows |
|---|---|---|
| Screenshot 1 | `screenshot-1-today.png` | Today: AI daily brief, time blocks, main focus, habits |
| Screenshot 2 | `screenshot-2-ask.png` | Ask ProdLi answering "What should I focus on now?" |
| Screenshot 3 | `screenshot-3-meetings.png` | AI meeting notes for Google Meet |
| Screenshot 4 | `screenshot-4-notes.png` | Notes with checklists and tables |
| Screenshot 5 | `screenshot-5-review.png` | Weekly review |
| Small promo tile (440×280) | `promo-440x280.png` | Logo and "Your day, planned." |

Extras, if you'd rather swap one in: `screenshot-6-todos.png`, `screenshot-7-time-tracker.png`, `screenshot-8-files.png`, `screenshot-9-habits.png`, `screenshot-10-pomodoro.png`.

To regenerate them after UI changes (from `artifacts/prodli`): `node scripts/store-screenshots.mjs`. It builds its own copy with demo data and a stand-in server, so no real account is used.

## 3. Store listing → Text

**Summary** (from the manifest, 127 of 132 characters):

```
Plan your day in every new tab: AI daily brief, Ask ProdLi, notes, to-dos, habits, focus tools, AI notes for Meet, Zoom and Teams.
```

**Description:**

```
ProdLi is a personal assistant in every new tab. It plans your day around your tasks and calendar, answers questions about your work, and keeps your notes, to-dos, habits and meeting notes in one place.

☀️ TODAY: YOUR DAY, PLANNED
Each morning ProdLi writes a short daily brief: your top priorities and why, a suggested schedule around your meetings, and what to watch out for. Pick one main focus, plan tasks for today and put them into the free time between meetings with one click. Reminders tell you when a block starts, and any block can go straight to Google Calendar. In the evening, wrap up the day; tomorrow's brief reads it.

✨ ASK PRODLI
Ask anything about your day, notes and meetings: "What should I focus on now?", "What's overdue?", "Summarize my last meeting", "Plan my afternoon". Answers come from your own data, and suggested actions, like adding a to-do, happen only when you click them.

📊 WEEKLY REVIEW
Every Friday, see your week in numbers (tasks done, focus time, habits, meetings, where your time went) and an AI review with wins, patterns, what slipped and next week's priorities.

🎙️ AI MEETING NOTES FOR GOOGLE MEET, ZOOM AND TEAMS, NO BOT
Click the ProdLi icon in a Google Meet call. ProdLi builds a transcript from Meet's live captions (only you see them) and turns it into a summary, decisions and action items. Zoom and Microsoft Teams calls in the browser work too: ProdLi records the call's audio and transcribes it with AI when the call ends. Send action items to your to-dos in one click, or draft a follow-up email to everyone from the summary. No bot joins the call.

✍️ NOTES
Type "/" for checklists, tables, headings, quotes and code. Select text and ✨ Improve it: fix spelling and grammar, make it shorter or clearer, or change the tone. You see the suggestion before anything changes. Paste Markdown, pin notes, search everything, and export to Markdown or PDF.

✅ TO-DOS, 🎯 HABITS, 🍅 POMODORO, ⏱ TIME TRACKER
Priorities, due dates and subtasks. Daily habits with streaks. A focus timer that keeps running when ProdLi is closed. See where your browsing time goes and set daily limits per site (only website names are recorded, never full addresses).

📄 OPEN FILES FROM ANYWHERE
Markdown, CSV, JSON and text files opened in Chrome show in ProdLi's viewer, with syntax highlighting. Turn it on in Files.

➕ ADD TO PRODLI FROM ANY PAGE
Right-click any page or selection, or press Alt+Shift+A, to save it as a to-do or note.

🔄 ONE ACCOUNT, EVERY DEVICE
ProdLi works without an account; everything stays in your browser. Sign in with Google (free) to sync between computers and the web app at app.prodli.com (works on your phone too), with nightly backups. The account also turns on the AI daily brief, weekly review, Ask ProdLi, meeting summaries and writing help.

FREE
The free plan includes 20 AI meeting summaries, 62 daily briefs and weekly reviews, 100 Ask ProdLi questions and 200 writing-help uses a month, plus 100 MB of synced data. ProdLi Pro raises these limits.

PRIVACY
No ads, no analytics, no tracking, and your data is never sold. Your data is used only to run ProdLi. AI features send only what they need to Anthropic's Claude, which doesn't train on it. Google Calendar access is read-only and optional. Full policy: https://prodli.com/privacy
```

**Category:** Productivity (Workflow & Planning) · **Language:** English · **Website:** https://prodli.com · **Support:** contact@prodli.com

## 4. Privacy practices tab

### Single purpose

```
ProdLi replaces the new tab page with a personal assistant that helps the user plan and organise their own work: a daily plan built from their tasks and calendar, notes, to-dos, habits, focus tools and notes from their Google Meet, Zoom and Teams calls, optionally synced to their ProdLi account.
```

### Permission justifications

| Permission | Paste this |
|---|---|
| `storage` | Saves the user's notes, tasks, habits, daily plans, focus sessions, time-tracking totals and settings on the device. |
| `unlimitedStorage` | Notes, meeting transcripts and optional meeting recordings can exceed the default quota; without it, saves could fail and the user could lose work. |
| `tabs` | Reads only the website name (hostname) of the active tab to total browsing time per site for the Time Tracker. Full addresses, titles and page content are never stored. |
| `idle` | Pauses time tracking while the user is away so idle time isn't counted. |
| `alarms` | Schedules the time-tracking heartbeat, the end of Pomodoro sessions, the daily planning reminder, time-block reminders and background sync. |
| `notifications` | Tells the user when a Pomodoro session ends, a time block starts, a daily site limit is reached, or meeting notes are ready. |
| `identity` | Used only when the user chooses "Sign in with Google" (to sign in to their ProdLi account) or connects Google Calendar (read-only, to plan their day around their meetings). |
| `contextMenus` | Adds "Add to ProdLi to-dos" and "Save to ProdLi notes" to the right-click menu. The page title, address and selected text are read only when the user clicks one. |
| `webNavigation` | Notices when the user opens a Markdown, CSV, JSON or text file from their computer in Chrome, so ProdLi can show it in its file viewer. Only active if the user turns on "Open files from anywhere"; the file is read on the device and never uploaded. |
| `search` | The search box on ProdLi's new tab page sends what the user types to their default search engine through Chrome's Search API. ProdLi never changes the search engine and doesn't see the results. |
| `activeTab` | When the user right-clicks a page and picks "Summarize page to ProdLi notes", ProdLi reads that one page's text to write the summary. Access lasts only for that click and that tab. |
| `scripting` | Used with `activeTab` to read the page's text for "Summarize page", and to start the Google Meet caption reader on a Meet tab when the user starts recording. |
| `tabCapture` *(optional)* | Requested only when the user turns on the meeting recorder; captures the audio of the Google Meet, Zoom or Teams tab the user starts recording (toolbar icon or Alt+Shift+R). The audio is saved on the device; it is sent to the AI provider for transcription only when the user asks (“Transcribe audio with AI”), or after a Zoom/Teams call when that setting is on (default) and the user is signed in. |
| `offscreen` *(optional)* | Runs the meeting recorder's audio capture in an offscreen document. |
| `downloads` *(optional)* | Requested only with "Open files from anywhere": Chrome downloads some local files (such as CSV) instead of opening them; ProdLi cancels that download and shows the file in its viewer instead. |
| Host access *(optional)*: `<all_urls>`, `file:///*` | `meet.google.com` for the meeting recorder; other websites only for the optional Time Tracker auto-redirect; `file:///*` only for "Open files from anywhere". Each is requested when the user turns that feature on. |

### Remote code

**No, I am not using remote code.** All code is in the package. Network requests go to ProdLi's server (app.prodli.com) and Google's sign-in and Calendar APIs, and carry data, not code.

### Data usage

Tick these (they leave the device only when the user signs in or uses a feature):

| Type | Why |
|---|---|
| **Personally identifiable information** | Name, email address and profile picture from Google sign-in, to create and show the account. |
| **Authentication information** | A Google sign-in token is exchanged for a ProdLi session, used to sync the user's data. |
| **Personal communications** | Meeting transcripts and summaries (Google Meet, Zoom, Teams), and Zoom/Teams call audio sent for transcription, synced to the account and sent to the AI provider when the user asks for a summary. For writing help, the selected note text or a meeting's summary is sent to the AI provider to write a suggestion or follow-up email; neither is stored on ProdLi's servers. |
| **Web history** | Time Tracker totals per website name (no full addresses), synced to the account and used in the daily brief and weekly review. |
| **Website content** | Text, titles and links the user saves from pages with "Add to ProdLi", stored as notes and to-dos. |

Leave the others unticked (health, financial and payment information, location, user activity). Payments for ProdLi Pro happen on Dodo Payments' checkout page, not in the extension.

Then tick all three: data is **not sold** to third parties, **not used or transferred for purposes unrelated** to the single purpose, and **not used for creditworthiness or lending**.

**Privacy policy URL:** https://prodli.com/privacy

### Notes for the reviewer (if the form asks)

```
No account is needed: every section works offline after install. To try the AI features, click the avatar (bottom left) → Sign in with Google; a free ProdLi account is created. The meeting recorder needs a Google Meet call, or a Zoom or Teams call in the browser: Meetings → Setup → Turn on recorder, join a call, then click the ProdLi toolbar icon.
```

## 5. Before you submit

- [x] Google consent screen published (17 Nov 2026). Calendar verification: branding re-check scheduled 18 Nov, then the Calendar request
- [x] Zip built from the latest `main` (17 Nov 2026, includes writing help)
- [ ] Recorder tested on a real Google Meet call
- [ ] Recorder tested on real Zoom (web client) and Teams (web) calls
- [ ] Five screenshots and the promo tile uploaded; old screenshots removed
- [ ] Description pasted
- [ ] Single purpose and every permission justification pasted, including the newer `contextMenus`, `webNavigation`, `search` and `downloads`
- [ ] The five data types ticked and the three statements checked
- [ ] Privacy policy URL set
- [ ] Submit. The review can take longer than usual because of the tab-audio permission
