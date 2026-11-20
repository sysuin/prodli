# ProdLi v1.4.0: Chrome Web Store submission kit

Everything to paste into the [Developer Dashboard](https://chrome.google.com/webstore/devconsole) for this release.

**New in 1.4.0** (since 1.3.0): repeating to-dos, reminders, lists and labels, and natural-language quick add; 🎙 Speak tasks; focus blocking with schedules and strict mode; saved tabs, quick links and a search box on Today; Read later and "Summarize page to ProdLi notes"; note templates and a daily note; richer habits (count, timed, quit, skip days, year heatmap); Ask ProdLi sources, saved and scheduled prompts; meeting prep; site categories and a daily focus score; the drag-to-timebox Day view; AI notes for Zoom and Teams calls in the browser and for in-person meetings; to-do Board and Eisenhower matrix views; AI audio transcription for mixed-language calls; meeting types and a word list.

## 1. Package

- Build from the latest `main`, at the repo root:
  ```bash
  pnpm run build:extension:store
  ```
  This writes `prodli-extension-store.zip`. It always talks to https://app.prodli.com, includes Google sign-in from `.env.local`, and leaves out the `key` field (the store rejects it). It never touches the `dist-extension` folder your Chrome loads.
- Version: **1.4.0** in `artifacts/prodli/extension/manifest.json`. Raise it for every upload after this one.
- The production API must be deployed first (done 20 Nov 2026): 1.4.0 syncs new lists (to-do lists, saved tabs, quick links, Read later) and uses new AI endpoints.
- The store's name and summary come from the manifest: **ProdLi** and the summary in section 3.

## 2. Store listing → Graphics

All screenshots are 1280×800 and in `artifacts/prodli/store-assets/`. Upload 1–5 in this order and delete the old ones from the listing.

| Slot | File | Shows |
|---|---|---|
| Screenshot 1 | `screenshot-1-today.png` | Today: quick links, AI daily brief, the Day view with time blocks and meetings |
| Screenshot 2 | `screenshot-2-ask.png` | Ask ProdLi answering "What should I focus on now?" |
| Screenshot 3 | `screenshot-3-meetings.png` | AI meeting notes (Meet, Zoom and Teams) |
| Screenshot 4 | `screenshot-6-todos.png` | To-dos with lists, labels, repeats and reminders |
| Screenshot 5 | `screenshot-7-time-tracker.png` | Time Tracker with the focus score and site categories |
| Small promo tile (440×280) | `promo-440x280.png` | Logo and "Your day, planned." |

Extras, if you'd rather swap one in: `screenshot-11-day-view.png` (Day view and "Before your meetings"), `screenshot-4-notes.png`, `screenshot-5-review.png`, `screenshot-8-files.png`, `screenshot-9-habits.png` (count and timed habits), `screenshot-10-pomodoro.png` (with focus blocking).

To regenerate them after UI changes (from `artifacts/prodli`): `node scripts/store-screenshots.mjs`. It builds its own copy with demo data and a stand-in server, so no real account is used.

## 3. Store listing → Text

**Summary** (from the manifest, 127 of 132 characters):

```
Plan your day in every new tab: AI daily brief, Ask ProdLi, notes, to-dos, habits, focus tools, AI notes for Meet, Zoom and Teams.
```

**Description:**

```
ProdLi is a personal assistant in every new tab. It plans your day around your tasks and calendar, answers questions about your work, and keeps your notes, to-dos, habits, focus tools and meeting notes in one place.

☀️ TODAY: YOUR DAY, PLANNED
Each morning ProdLi writes a short daily brief: your top priorities and why, a suggested schedule around your meetings, what to watch out for, and prep for meetings you've had before (what you covered last time and what's still open). Plan tasks for today and drag them onto the Day view to block time, or let ProdLi fit them into the free time between meetings. Search the web, open your quick links and saved tabs, and keep a Read later list, all from the same page. In the evening, wrap up the day; tomorrow's brief reads it.

✨ ASK PRODLI
Ask anything about your day, notes and meetings: "What should I focus on now?", "What's overdue?", "Summarize my last meeting". Answers come from your own data and show the notes and meetings they used, so you can open them. Save questions you ask often, or schedule them ("every weekday at 8:30") and get the answer as a notification.

🎙️ AI MEETING NOTES FOR GOOGLE MEET, ZOOM AND TEAMS, NO BOT
Click the ProdLi icon in a call. On Google Meet, ProdLi takes notes from Meet's live captions (only you see them). On Zoom and Microsoft Teams in the browser, it records the call's audio and transcribes it with AI when the call ends; AI transcription also handles calls where people switch languages. You get a summary, decisions and action items, shaped by the meeting type (1:1, interview, sales call, stand-up…), with names spelled from your own word list. Send action items to your to-dos in one click, or draft a follow-up email. No bot joins the call. For a meeting in the room, press 🎙 Record in person on the Meetings page (it works at app.prodli.com on your phone too).

✅ TO-DOS THAT KEEP UP
Type naturally: "call mom every Monday at 5pm #family" sets the date, time, repeat and list. Repeating tasks, reminders with snooze, lists, labels and subtasks, in a list, a Board or an Eisenhower matrix. Or press 🎙 Speak tasks, say everything on your mind, and review the tasks before they're added.

🚫 FOCUS
Block distracting sites while a focus session runs or during your focus hours. A pause screen offers "Close tab", with strict mode if you want no way around it. The Pomodoro timer keeps running when ProdLi is closed. The Time Tracker sorts your sites into categories (work, AI tools, social media…) and gives you a daily focus score (only website names are recorded, never full addresses).

🎯 HABITS
Yes/no, count ("8 glasses of water"), timed ("20 minutes of reading") and quit habits, on the days you choose, with skip days that keep your streak and a year heatmap.

✍️ NOTES
Type "/" for checklists, tables, headings and code. Start from templates (meeting notes, 1:1, weekly plan, or your own) or open today's daily note. Select text and ✨ Improve it, or right-click any web page → "Summarize page to ProdLi notes". Export to Markdown or PDF.

📊 WEEKLY REVIEW
Every Friday, see your week in numbers (tasks done, focus time, habits, meetings, where your time went, focus score) and an AI review with wins, patterns, what slipped and next week's priorities.

➕ FROM ANY PAGE
Right-click any page or selection, or press Alt+Shift+A, to save it as a to-do or note, or add it to Read later. Markdown, CSV, JSON and text files opened in Chrome show in ProdLi's viewer.

🔄 ONE ACCOUNT, EVERY DEVICE
ProdLi works without an account; everything stays in your browser. Sign in with Google (free) to sync between computers and the web app at app.prodli.com (works on your phone too), with nightly backups. The account also turns on the AI features.

FREE
The free plan includes 20 AI meeting summaries, 62 daily briefs and weekly reviews, 100 Ask ProdLi questions, 200 writing-help uses and 300 minutes of AI audio transcription a month, plus 100 MB of synced data. ProdLi Pro raises these limits.

PRIVACY
No ads, no analytics, no tracking, and your data is never sold. Your data is used only to run ProdLi. AI features send only what they need to Anthropic's Claude (which doesn't train on it) or, for audio transcription, to an open speech model on Cloudflare. Google Calendar access is read-only and optional. Full policy: https://prodli.com/privacy
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
| `tabs` | Reads the website name (hostname) of the active tab to total browsing time per site for the Time Tracker, and to show a pause screen instead of a site the user chose to block. When the user clicks "Save tabs", it saves the titles and addresses of their open tabs so they can reopen them later. Page content is never read. |
| `idle` | Pauses time tracking while the user is away so idle time isn't counted. |
| `alarms` | Schedules the time-tracking heartbeat, the end of Pomodoro sessions, the daily planning reminder, time-block and to-do reminders, focus-hour blocking, the user's scheduled Ask ProdLi questions and background sync. |
| `notifications` | Tells the user when a Pomodoro session ends, a time block or to-do is due, a daily site limit is reached, meeting notes are ready, a scheduled Ask ProdLi answer arrives, or a Zoom/Teams recording doesn't include their microphone. |
| `identity` | Used only when the user chooses "Sign in with Google" (to sign in to their ProdLi account) or connects Google Calendar (read-only, to plan their day around their meetings). |
| `contextMenus` | Adds "Add to ProdLi to-dos", "Save to ProdLi notes", "Read later in ProdLi" and "Summarize page to ProdLi notes" to the right-click menu. The page title, address and selected text are read only when the user clicks one. |
| `webNavigation` | Notices when the user opens a Markdown, CSV, JSON or text file from their computer in Chrome, so ProdLi can show it in its file viewer. Only active if the user turns on "Open files from anywhere"; the file is read on the device and never uploaded. |
| `search` | The search box on ProdLi's new tab page sends what the user types to their default search engine through Chrome's Search API. ProdLi never changes the search engine and doesn't see the results. |
| `activeTab` | When the user right-clicks a page and picks "Summarize page to ProdLi notes", ProdLi reads that one page's text to write the summary. Access lasts only for that click and that tab. |
| `scripting` | Used with `activeTab` to read the page's text for "Summarize page", and to start the Google Meet caption reader on a Meet tab when the user starts recording. |
| `tabCapture` *(optional)* | Requested only when the user turns on the meeting recorder; captures the audio of the Google Meet, Zoom or Teams tab the user starts recording (toolbar icon or Alt+Shift+R). The audio is saved on the device; it is sent to the AI provider for transcription only when the user asks (“Transcribe audio with AI”), or after a Zoom/Teams call when that setting is on (default) and the user is signed in. |
| `offscreen` *(optional)* | Runs the meeting recorder's audio capture in an offscreen document. |
| `downloads` *(optional)* | Requested only with "Open files from anywhere": Chrome downloads some local files (such as CSV) instead of opening them; ProdLi cancels that download and shows the file in its viewer instead. |
| Host access *(optional)*: `https://meet.google.com/*`, `file:///*` | `meet.google.com` to read Meet's captions when the user records a Meet call; `file:///*` only for "Open files from anywhere". Each is requested when the user turns that feature on. (1.3.0 also declared `<all_urls>` for a Time Tracker auto-redirect that no longer needs it.) |

### Remote code

**No, I am not using remote code.** All code is in the package. Network requests go to ProdLi's server (app.prodli.com) and Google's sign-in and Calendar APIs, and carry data, not code.

### Data usage

Tick these (they leave the device only when the user signs in or uses a feature):

| Type | Why |
|---|---|
| **Personally identifiable information** | Name, email address and profile picture from Google sign-in, to create and show the account. |
| **Authentication information** | A Google sign-in token is exchanged for a ProdLi session, used to sync the user's data. |
| **Personal communications** | Meeting transcripts and summaries (Google Meet, Zoom, Teams), and Zoom/Teams call audio sent for transcription, synced to the account and sent to the AI provider when the user asks for a summary. For writing help, the selected note text or a meeting's summary is sent to the AI provider to write a suggestion or follow-up email; neither is stored on ProdLi's servers. |
| **Web history** | Time Tracker totals per website name (no full addresses), synced and used in the daily brief and weekly review; the titles and addresses of tabs, links and pages the user chooses to save (saved tabs, quick links, Read later), synced to the account. |
| **Website content** | Text, titles and links the user saves from pages with "Add to ProdLi", stored as notes and to-dos; the text of a page the user asks to summarize ("Summarize page"), sent to the AI provider and not stored on ProdLi's servers. |

Leave the others unticked (health, financial and payment information, location, user activity). Payments for ProdLi Pro happen on Dodo Payments' checkout page, not in the extension.

Then tick all three: data is **not sold** to third parties, **not used or transferred for purposes unrelated** to the single purpose, and **not used for creditworthiness or lending**.

**Privacy policy URL:** https://prodli.com/privacy

### Notes for the reviewer (if the form asks)

```
No account is needed: every section works offline after install. To try the AI features, click the avatar (bottom left) → Sign in with Google; a free ProdLi account is created. The meeting recorder needs a Google Meet call, or a Zoom or Teams call in the browser: Meetings → Setup → Turn on recorder, join a call, then click the ProdLi toolbar icon.
```

## 5. Before you submit

- [x] Google consent screen published (17 Nov 2026). Calendar verification: branding re-check scheduled 18 Nov, then the Calendar request
- [x] Production API deployed with the 1.4.0 server changes (20 Nov 2026)
- [ ] Privacy policy on prodli.com updated for 1.4.0 (PR #71; lawyer review of the changes: `docs/legal/REVIEW-NOTES.md` §7)
- [ ] 1.4.0 zip built from the latest `main` (`prodli-extension-store.zip`)
- [ ] Recorder tested on a real Google Meet call
- [ ] Recorder tested on real Zoom (web client) and Teams (web) calls
- [ ] Five screenshots and the promo tile uploaded; old screenshots removed
- [ ] Description pasted
- [ ] Single purpose and every permission justification pasted, including the changed `tabs`, `alarms`, `notifications`, `contextMenus` and host access rows
- [ ] Optional: new screenshots of the 1.4.0 features (Day view, meeting prep, focus blocking, to-do lists) with `node scripts/store-screenshots.mjs`
- [ ] The five data types ticked and the three statements checked
- [ ] Privacy policy URL set
- [ ] Submit. The review can take longer than usual because of the tab-audio permission
