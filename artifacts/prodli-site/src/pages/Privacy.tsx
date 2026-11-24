import { Link } from "wouter";
import { Logo } from "../components/Logo";

/*
 * DRAFT for legal review (see docs/legal/REVIEW-NOTES.md). Every factual
 * statement here was checked against the code on 2026-11-09, and again on
 * 2026-11-20 for the features added since (section 7 of the notes); if the product
 * changes, update this text and the review notes together. Items in
 * [square brackets] must be filled in before publishing.
 */
export const LAST_UPDATED = "23 November 2026";

export const PRIVACY_SECTIONS: { title: string; body: string }[] = [
  {
    title: "Summary",
    body: `• ProdLi works without an account. Without one, your data stays in your browser on your device.
• With a free ProdLi account (Google sign-in), we also store your data on our servers so it's the same on every device.
• We use your data only to provide ProdLi. We don't sell it, use it for advertising, or let others use it for their own purposes.
• You can download or delete everything at any time from the account window.`,
  },
  {
    title: "Who we are",
    body: `ProdLi is operated by Sunny Singh, an individual based in India ("ProdLi", "we", "us"). Our postal address is available on request at contact@prodli.com. We are responsible for (the "controller" of) the personal data described in this policy. Contact: contact@prodli.com.

Grievance officer (India): Sunny Singh, contact@prodli.com.`,
  },
  {
    title: "What this policy covers",
    body: `The ProdLi Chrome extension, the web app at app.prodli.com, the website prodli.com, and the ProdLi account and sync service.`,
  },
  {
    title: "Data stored only on your device",
    body: `ProdLi stores your workspace in your browser (extension storage, localStorage and IndexedDB):
• notes (and your note templates), to-dos (priorities, due dates, subtasks, repeats, reminders, lists and labels), habits and check-ins
• Pomodoro settings, timer and completed sessions
• Time Tracker (extension): the hostname of the website in your active tab (for example "github.com") and the seconds spent per day, and the category you give each site. Never full web addresses, page titles or page content.
• Focus blocking (extension): the sites you choose to block, your focus hours, and how many times a day you paused on a blocked site
• Saved tabs, quick links and Read later: the titles and web addresses of the tabs, links and pages you choose to save
• Meetings (only if you record calls in your browser (Google Meet, Zoom, Microsoft Teams, Webex, Slack, Discord and others) or meetings in person from your microphone): transcripts, summaries, audio recordings, the meeting type you pick, your word list of names and terms, and, when your microphone is included, a timeline of when you or the others were talking (used to label transcripts and show talk time), and the times of moments you mark as important, and your own notes for a meeting
• Ask ProdLi saved prompts, their schedules and the answers to scheduled prompts
• settings such as theme and fonts

Without an account, none of this is sent to ProdLi. Uninstalling the extension or clearing the website's data deletes it.`,
  },
  {
    title: "Your ProdLi account (optional)",
    body: `When you sign in with Google we receive your Google account ID, name, email address and profile picture. We ask Google only for basic profile information (openid, email and profile). We store this with your plan (Free or Pro) and when you created and last used your account.

For each signed-in device we keep a session: a random sign-in token (we store only a one-way hash of it), whether it's the extension or the web app, the browser and operating system name (for example "Chrome on macOS"), and when it was created and last used. Sessions end after 180 days (extension) or 30 days (web app) without use, or when you sign out. We use this to keep you signed in, show your signed-in devices and protect your account.`,
  },
  {
    title: "Sync: data stored on our servers",
    body: `With an account, the following are stored on our servers and kept the same on all your devices:
• notes, to-dos, your to-do lists and habits
• saved tabs, quick links and your Read later list (titles and web addresses)
• meetings: titles, transcripts, summaries, the talk timeline, marked moments and your notes (text only; audio recordings are never synced. Audio is sent only to be transcribed, as described under "Audio transcription")
• Pomodoro history and your completed-session count
• Time Tracker history (hostnames and seconds per day)
• your Today page: each day's focus, reflection and daily brief, and your weekly reviews and notes on each week
Settings (including site categories, focus blocking and Ask ProdLi saved prompts) are never uploaded. Each account's data is kept in its own separate database.

You can stop a computer from uploading the meetings it records (account window → Sync). Meeting transcripts contain what other participants said. You are responsible for telling them that you take notes and for getting their consent where the law requires it. To help, ProdLi can post your heads-up message in the Google Meet chat when you start recording (off by default; Meetings → Setup), and can delete old recordings or whole meetings automatically after a period you choose (off by default; Meetings → Setup → Auto-delete). Deleting a meeting also deletes its synced copy.

If you used ProdLi's earlier Google Drive sync, the copy in your Drive is merged into your account once, the first time you sign in, and Drive sync then turns off.`,
  },
  {
    title: "AI features: daily brief, weekly review, Ask ProdLi, meetings, audio transcription, page summaries and writing help (optional)",
    body: `Ask ProdLi (chat): with an account, you can ask questions about your day. Our server sends Anthropic's Claude API your question, the last few messages of the conversation, the same day information as the daily brief, and short excerpts from the notes and meetings that match your question (chosen on your device). The conversation isn't stored on our servers or synced; it stays in the open page. Actions it suggests (such as adding a to-do) happen only when you click them. You can save a question and schedule it (for example, every weekday at 8:30): at those times the extension sends the same kind of information in the background and keeps the answer on your device, and each run counts as one question.

Daily brief: with an account, ProdLi can write a short plan for your day. To do this, our server sends Anthropic's Claude API the parts of your day the brief needs: your open tasks (titles, priorities, due dates, estimates), habit names and streaks, today's calendar events (titles and times, if you connected Google Calendar), recent meeting action items, yesterday's top websites, focus sessions and focus score (a number from 0 to 100), and your focus and reflection notes. For today's meetings that match a meeting you recorded before, it also sends that meeting's title and time, when you last met, a short summary of the last meeting, its open action items and the titles of related to-dos (meeting prep). Invitees' names and email addresses are never sent. The brief is saved with that day and synced to your devices; we don't keep a separate copy of what was sent. We count how many briefs you use each month. Without an account, a basic brief is made on your device without AI and nothing is sent.

AI meeting prep (✨ Prep with AI on Today's meeting prep): with an account, our server sends Anthropic's Claude API the upcoming meeting's title, time and date, and from your last meeting with those people its title, date, summary overview, decisions, open action items (with owners) and open questions, plus the titles of related to-dos. Invitees' names and email addresses aren't sent. The prep isn't stored on our servers; it counts toward your monthly briefs.

Weekly review: with an account, ProdLi can write a short review of your week. Our server sends Anthropic's Claude API a summary of that week made on your device: titles of tasks you finished and tasks that slipped (with priorities and dates), counts per day, habit names and how many days you kept them, focus-session totals, total browsing time, your top five websites, your focus score and the time spent per site category (for example "AI tools" or "Social media"), meeting titles and open action items, how many notes you created or edited, your daily focus and reflection notes, and your own notes on the week. The review is saved with that week and synced; we don't keep a separate copy of what was sent. Reviews count toward your monthly briefs. Without an account, a basic review is made on your device without AI and nothing is sent.

Meeting summaries: with an account, our server sends the meeting's transcript, name and date, the meeting type you picked (or your own meeting template: its name, instructions and section headings), your word list of names and terms, the transcript lines around moments you marked and your own notes for that meeting (Pro) to Anthropic's Claude API, and saves the summary with the meeting (a free monthly allowance). We don't keep a separate copy of what was sent, and audio isn't part of it. We count how many summaries you use each month.

Audio transcription: with an account, ProdLi can turn a meeting's recording into a transcript. This happens when you choose 🌐 Transcribe audio with AI on a meeting, and automatically when a recorded call other than Google Meet, or an in-person recording, ends (you can turn the automatic part off in Meetings → Setup). Your device cuts the recording into short pieces and skips silence; each piece is sent to our server, which has it transcribed by an open speech model (Whisper) running on Cloudflare Workers AI, with your word list as a spelling hint. Neither the audio nor the text is stored on our servers; the transcript is saved with the meeting on your device and synced as text. We count how many minutes you transcribe each month. Uploaded recordings (⬆ Upload recording in Meetings) are handled the same way: the file stays on your device (it isn't synced); only its audio, never video, is decoded on your device and sent in short pieces to be transcribed, and the time counts toward your monthly minutes. Recordings contain other participants' voices: you are responsible for telling them and getting their consent where the law requires it.

Page summaries (right-click → Summarize page to ProdLi notes): ProdLi reads the text of that page, in that tab and only when you click. With an account, our server sends the page's title, web address and up to about 24,000 characters of its text to Anthropic's Claude API, and the summary is saved as a note. Neither the page text nor the summary is stored on our servers. Without an account, the note gets a short excerpt and nothing is sent. Read later saves only the page's title and address.

Screenshots (right-click → Screenshot to ProdLi, or 📸 in Quick add): ProdLi takes a picture of the visible part of that tab, only when you click, and keeps it on your device; you crop it and save it in a note, which syncs like any note. If you click ✨ Pull out the text (with an account), our server sends only the cropped picture to Anthropic's Claude API to read the text in it. Neither the picture nor the text is stored on our servers; the text is added to your note. Each use counts toward your monthly writing-help uses.

Speak tasks (🎙 in To-dos): what you say is turned into text by Chrome's built-in speech recognition. Where Chrome supports it for your language, this happens on your device; otherwise Chrome sends the audio to Google's speech recognition service, under Google's terms. With an account, our server sends the text (up to 4,000 characters) and the names of your to-do lists to Anthropic's Claude API to split it into tasks; nothing is stored, and you see the tasks before they're added. Without an account, the text is split on your device. Each use counts toward your monthly writing-help uses.

Voice dictation (Alt+Shift+D in the extension): with an account, while you dictate, ProdLi records your microphone and sends the audio in short pieces to our server, which has it transcribed by Whisper on Cloudflare Workers AI; the text is then sent to Anthropic's Claude API to remove filler words, punctuate and format it in the style you chose for that kind of website (or, in Command Mode, together with the text you selected, to apply your spoken instruction). The website's address is used on your device to pick the style and is not sent. Nothing is stored on our servers except monthly counts; the last 50 dictations are kept on your device. ProdLi only listens after you press the shortcut or 🎙, until you finish or cancel, and shows a pill on the page while it listens.

Break it down (✨ on Today's Now card): with an account, our server sends Anthropic's Claude API the task's title and its existing steps (up to 1,500 characters) and gets back a few suggested steps. Nothing is stored on our servers; the steps are added only if you choose to. Each use counts toward your monthly writing-help uses.

Importing to-dos (Todoist, TickTick, Google Tasks, CSV or Markdown files): the file you choose is read on your device and never uploaded. The imported to-dos are saved like any other, so they sync if you use sync.

Read aloud (▶ Listen in Notes and Read later): the text is spoken by your browser's built-in voices. ProdLi doesn't send it anywhere, but some of Chrome's voices (those named "Google …") are produced online by Google as part of Chrome; pick a voice from your computer to keep it local.

Writing help (✨ Improve in Notes): with an account, you can select text in a note and ask ProdLi to fix spelling and grammar, make it shorter or clearer, or change its tone. Our server sends Anthropic's Claude API only the selected text (up to about 1,000 words), the kind of change you picked and, if you set one (Settings → Writing style), your writing style. Neither the text nor the suggestion is stored on our servers; your note changes only if you click Replace or Insert below. We count how many times you use writing help each month (page summaries and Speak tasks count too).

Meeting coaching (🎯 Coach me, Pro): when you ask for it, our server sends that meeting's transcript, name and date, what kind of meeting you said it was and, if it was recorded, your share of the talking to Anthropic's Claude API. The feedback is saved with the meeting; the server keeps only the monthly count (it uses your AI meeting summaries).

Follow-up emails (✉️ Draft follow-up in Meetings): with an account, you can ask ProdLi to draft an email to a meeting's participants. Our server sends Anthropic's Claude API only that meeting's summary (title, date, overview, key points, decisions, action items with owners and due dates, and open questions) and the tone you picked, never the transcript or audio. Neither the summary nor the draft is stored on our servers. ProdLi doesn't send the email; you copy it or open it in your own email app. Each draft counts toward your monthly writing-help uses.
Anthropic processes this data as our service provider under its commercial terms, which don't allow it to train its models on this data. It keeps requests only for a limited period under its data retention policy.`,
  },
  {
    title: "Shared meeting notes (optional)",
    body: `With an account, you can share a meeting's notes as a read-only link (🔗 Share in Meetings). When you do, our server stores a copy of that meeting's title, date, length and summary (overview, key points, decisions, action items with owners and due dates, open questions and your own template's sections), never the transcript or audio, and shows it to anyone who has the link. We count how many times the link is opened. The page asks search engines not to index it.

The copy is deleted when the link expires (after 7 or 30 days, or never if you choose that with ProdLi Pro), when you click Stop sharing, or when you delete your account. Sharing again updates the copy. Meeting notes contain what other participants said: share them only with people who should see them, and you are responsible for having the right to share them.`,
  },
  {
    title: "Connected apps and API keys (optional)",
    body: `With an account, you can create API keys (Settings → Connections) to let apps you choose, such as Claude, ChatGPT, Cursor or your own scripts, read your synced ProdLi data through ProdLi's read-only API and MCP server: to-dos and lists, notes, meeting summaries and your own meeting notes, meeting transcripts (only when the app asks for one), habits and your day's focus. Connected apps can't change anything. Your calendar, time tracking, files and meeting audio aren't available to them.

What a connected app reads is sent to that app and handled under its own terms and privacy policy; ProdLi isn't responsible for how it uses the data. We store each key's name, a one-way hash of it (never the key itself), its first characters for display, and when it was created and last used. We don't log what's read. If you put a key in an app's connector URL instead of a header, the key appears in that app's settings and may appear in our hosting provider's request logs for up to 7 days.

You can revoke a key at any time in Settings → Connections. "Sign out everywhere" and deleting your account revoke all your keys.`,
  },
  {
    title: "Google Calendar (optional)",
    body: `If you connect Google Calendar on the Today page, ProdLi asks Google for read-only access to your calendar (scope calendar.readonly) and reads today's events in your browser to show your agenda. ProdLi also reads each event's invitees (names and email addresses) to match the event with meetings you recorded before and show meeting prep; this happens only on your device. Events are not stored on ProdLi's servers, and invitees' details are never sent anywhere. Event titles and times, and meeting prep for matched meetings, are included in your daily brief only if you have an account and use the AI brief. You can disconnect at any time on the Today page, and remove ProdLi's access in your Google Account settings.

When you record a meeting while your calendar is connected, ProdLi files the meeting under the calendar event that's on at that time and saves the event's title, time and invitees (names and email addresses) with the meeting. Like the rest of the meeting, this syncs to your account if you use sync.

Time blocks in Google Calendar (optional): if you turn on "Show blocks in Google Calendar" (Today), ProdLi asks Google for permission to create and manage calendars it creates itself (scope calendar.app.created; it can't see or change your other calendars). It creates a calendar called "ProdLi" and keeps one event per time block (the task's title and time) for today and the next 7 days, and reads those events back so changes you make in Google Calendar update your plan. This happens between your browser and Google; nothing goes through ProdLi's servers. Turning it off stops syncing; you can delete the "ProdLi" calendar in Google Calendar at any time.`,
  },
  {
    title: "Technical data and logs",
    body: `Like any online service, our hosting provider processes technical information about each request: IP address, browser type, the address requested, time and response status. We use it to deliver ProdLi, keep it secure and prevent abuse (for example, limiting sign-in attempts per IP address). Request logs are kept for up to 7 days. They never contain the content of your notes, tasks or meetings.`,
  },
  {
    title: "Cookies and similar technologies",
    body: `The web app sets one cookie: a strictly necessary sign-in cookie that scripts can't read. It lasts up to 30 days and is removed when you sign out. ProdLi also uses your browser's storage to keep your data on your device and to work offline.

ProdLi doesn't use advertising or analytics cookies. When you use the web app, Google's sign-in service and Google Fonts are loaded from Google, which receives your IP address and may set its own cookies under Google's privacy policy. The extension bundles its own fonts.`,
  },
  {
    title: "Why we use your data (legal bases)",
    body: `• To provide ProdLi: your account, sync, backups and summaries you ask for. This is necessary to perform our contract with you.
• To keep ProdLi secure, prevent abuse, fix problems and enforce limits. This is our legitimate interest in running a safe service.
• To upload meeting transcripts, share meeting notes by link, transcribe recordings, create AI summaries, daily briefs, weekly reviews, page summaries and task lists from what you say, and read your calendar: your choice to use these features. You can stop at any time.
• To comply with the law where required.
Under India's Digital Personal Data Protection Act, 2023, we process your personal data on the basis of the consent you give when you sign in, and for the purposes described here.`,
  },
  {
    title: "Who processes data for us",
    body: `• Cloudflare, Inc.: hosting, databases, sync, backups, request logs and AI audio transcription (Workers AI), only when you use it with your account
• Dodo Payments: if you buy ProdLi Pro. Dodo Payments is our reseller and the merchant of record: it sells you the subscription, takes payment and handles tax and invoices under its own terms and privacy policy. You give your payment details to Dodo Payments, not to us. We give Dodo Payments your name, email address and ProdLi account ID to set up your checkout, and it tells us your subscription's status, plan, renewal date and its customer and subscription IDs; we never receive your card details.
• Google LLC: sign-in
• Anthropic, PBC: AI daily briefs, weekly reviews, Ask ProdLi answers, meeting summaries, follow-up emails, writing help, page summaries, text from screenshots, Speak tasks and Break it down, only when you use them with your account
Separately, Chrome's speech recognition (used by Speak tasks, and by on-device meeting transcription) is provided by Google as part of Chrome. When it can't run on your device, Chrome sends the audio to Google under Google's terms; ProdLi doesn't receive that audio.
These providers process data only to provide their services to us, under data processing terms. We don't share your data with anyone else, except where the law requires us to or to protect people's safety. If ProdLi is ever transferred to a new owner, we'll tell you first.`,
  },
  {
    title: "International transfers",
    body: `Our providers operate worldwide, so your data may be stored or processed outside your country, including in the United States and the European Union. Where the law requires it (for example, for transfers out of the EU or UK), these transfers are covered by safeguards such as the European Commission's standard contractual clauses in our providers' data processing terms.`,
  },
  {
    title: "How long we keep data",
    body: `• Synced data and your account: until you delete them.
• Shared meeting notes: until the link expires, you stop sharing, or you delete your account.
• Request logs: up to 7 days.
• Backups: we back up synced data nightly. Each copy is deleted automatically after 30 days. Our hosting provider's automatic recovery points also expire within 30 days.
• "Delete account" (account window) immediately deletes your account, sessions, AI usage counts, shared meeting notes, all synced data and our backup copies of it. Data may remain in our provider's automatic recovery points for up to 30 days, after which it's gone.
• Subscription records (ProdLi Pro): while you have the account. Dodo Payments keeps payment and tax records as the law requires; deleting your ProdLi account cancels your subscription.
• Signing out keeps your data on that device. Data stored only in your browser stays until you delete it.
• Meetings: until you delete them, or automatically after the period you set in Meetings → Setup → Auto-delete (recordings and whole meetings separately; off by default).
• Your data is yours: you can download every note, meeting and to-do as plain Markdown files, offline and without an account (Settings → Backup & data). If ProdLi ever shuts down, we'll give at least 60 days' notice so you can download everything first.`,
  },
  {
    title: "Security",
    body: `• All connections use HTTPS, and our provider encrypts stored data.
• Sign-in tokens are stored only as one-way hashes, and the web app's sign-in cookie can't be read by scripts.
• Each account's synced data is in its own database that only that account's sessions can reach.
• Access to our systems is limited to the people who operate ProdLi and is protected by two-factor authentication.
• We have no tool for viewing users' data, and our logs don't contain your content.
• If a personal data breach affects you, we'll tell you and the relevant authorities as the law requires.`,
  },
  {
    title: "Your rights and choices",
    body: `• Access and portability: download everything synced at any time (account window → Download my data).
• Correction: edit your content in the app. Your name, email and picture come from your Google account.
• Deletion: delete your account and synced data at any time (account window → Delete account).
• Withdrawing consent: sign out, turn off meeting uploads or automatic transcription, or stop using the AI features.

Depending on where you live (for example under the EU/UK GDPR or India's DPDP Act), you may also have the right to object to or restrict processing, to nominate someone to exercise your rights, and to complain to your data protection authority (in India, the Data Protection Board). Contact contact@prodli.com; we'll reply within 30 days.`,
  },
  {
    title: "Browser permissions (extension)",
    body: `• storage, unlimitedStorage: save your data on your device
• tabs, idle, alarms, notifications: Time Tracker, Pomodoro, reminders, focus blocking (it checks the site name of the page you open and shows a pause screen instead of a blocked site), saving your open tabs when you click Save, and background sync
• identity: Google sign-in
• search: the search box on Today searches with your default search engine
• contextMenus: the right-click menus "Add to ProdLi", "Read later in ProdLi", "Summarize page to ProdLi notes", "Save highlight to ProdLi" and "Screenshot to ProdLi" (they read the page title, address and any text you selected only when you click them)
• activeTab and scripting: read the text of the page you right-click for "Summarize page", or take a picture of its visible part for "Screenshot to ProdLi" (only that tab, only then), and start reading Google Meet's captions when you start recording a Meet call
• webNavigation: to notice when a Markdown, CSV, JSON or text file from your computer is opened in Chrome, so ProdLi can show it in its Files viewer (only if you turn this on; the file is read on your device and never uploaded)
• Requested only if you turn on "Open files from anywhere in Chrome": access to local files (file:///) and downloads (Chrome downloads some files, such as CSV, instead of opening them; ProdLi cancels that download and shows the file instead), plus Chrome's "Allow access to file URLs" switch, which you control in Chrome's extension settings
• Requested only when you turn on the meeting recorder: tabCapture and offscreen (to record the audio of the call's tab you start recording: a call app ProdLi recognises, or any website if you turn on “Record any website”) and meet.google.com (to read Meet's captions). If you choose to include your microphone, or record a meeting in person, your browser asks for microphone access. You can remove these at any time in Chrome's extension settings.`,
  },
  {
    title: "Google API data",
    body: `ProdLi's use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements. We use your Google profile information only to sign you in and show your account, your calendar events (if you connect your calendar) only to show your agenda, plan your day, prepare for your meetings and file recorded meetings under their events, and the "ProdLi" calendar (if you turn on blocks in Google Calendar) only to show and sync your time blocks. We don't transfer Google data to others except our service providers as described above, and never use it for advertising.`,
  },
  {
    title: "Children",
    body: `ProdLi accounts are for people aged 18 or over. We don't knowingly collect personal data from children. If you believe a child has created an account, contact us and we'll delete it.`,
  },
  {
    title: "Changes to this policy",
    body: `We'll update the date at the top when this policy changes. For significant changes, we'll tell signed-in users in the app or by email before the changes take effect.`,
  },
  {
    title: "Contact",
    body: `Questions, requests or complaints: contact@prodli.com.`,
  },
];

const CHROME_STORE_URL = "https://chromewebstore.google.com/detail/prodli/gjgknflakhglanjaeenkmciohimnbkdp";

export const TERMS_SECTIONS: { title: string; body: string }[] = [
  {
    title: "Agreement",
    body: `These terms are an agreement between you and Sunny Singh, the operator of ProdLi ("ProdLi", "we", "us"), for your use of the ProdLi Chrome extension, the web app at app.prodli.com and the ProdLi account and sync service ("ProdLi"). By using ProdLi you accept these terms. Our Privacy Policy explains how we handle personal data.`,
  },
  {
    title: "Using ProdLi",
    body: `You can use ProdLi without an account. Your data then stays in your browser. A free account, created by signing in with Google, adds sync between your devices, backups and AI meeting summaries. You must be at least 18 to create an account.`,
  },
  {
    title: "Your account",
    body: `Keep your Google account and devices secure. You're responsible for what happens in your ProdLi account. You can sign out any device, or delete your account, at any time from the account window. Tell us at contact@prodli.com if you think someone else has used your account.`,
  },
  {
    title: "Your content",
    body: `Your notes, tasks, meetings and other content belong to you. You give us permission to store, copy, sync, back up and process your content only as needed to provide ProdLi to you. This includes sending meeting transcripts to our AI provider when you ask for a summary, and recordings to our transcription service when you transcribe them (automatically after calls other than Google Meet, and in-person recordings, unless you turn that off). This permission ends when you delete the content or your account, except for backup copies that expire as described in the Privacy Policy.

You're responsible for your content. In particular, if you record or transcribe meetings, you must tell participants and get their consent where the law requires it, and you must only share meeting notes by link with people who should see them.`,
  },
  {
    title: "ProdLi Pro (paid plan)",
    body: `ProdLi Pro raises the limits shown in the app (currently 2 GB of synced data, 300 AI meeting summaries, 200 AI daily briefs or weekly reviews, 1,000 Ask ProdLi questions, 2,000 writing-help uses and 1,500 minutes of audio transcription per month) and adds features shown in the app as Pro (currently your own meeting templates, talk-time insights, action items across meetings, AI meeting prep, focus trends, your writing style, meeting series history, notes in your language, prep reminders, key moments in summaries, meeting insights, meeting coaching, summaries that use your own notes, a decision log, meeting type rules, dictation Command Mode and shared notes links that never expire). Until Pro goes on sale, those features are free for everyone; we may make them Pro-only once it does. Orders are processed by our online reseller Dodo Payments, the merchant of record for all ProdLi Pro orders: it charges you, issues invoices and handles payment questions and refunds.

New accounts get a free 14-day Pro trial. It starts when you create your account, needs no card and ends by itself: afterwards you're on the free plan, nothing you saved is deleted, and only the Pro features and higher limits stop. You can buy Pro during the trial.

Pro is a subscription, billed monthly or yearly in advance at the price shown at checkout (including any tax), and renews automatically until you cancel. You can cancel any time in Account → Manage subscription; Pro then stays on until the end of the period you've paid for, and you won't be charged again. Refunds follow Dodo Payments' terms and the law where you live. If we change the price, we'll tell you before your next renewal, and you can cancel before it applies. If a payment fails, Pro may stop until it's paid. Deleting your account cancels your subscription.`,
  },
  {
    title: "Acceptable use",
    body: `Don't use ProdLi to break the law or to infringe other people's rights. Don't upload malware. Don't try to access other people's accounts or data, or to disrupt, overload or get around the security or limits of ProdLi. Don't use AI summaries in ways that break Anthropic's Usage Policy.`,
  },
  {
    title: "Free plan and limits",
    body: `The free plan currently includes 100 MB of synced data, 20 AI meeting summaries, 62 AI daily briefs or weekly reviews, 100 Ask ProdLi questions, 200 writing-help uses and 300 minutes of audio transcription per month. Limits are shown in the app and may change; we'll give notice before reducing them. More is available with ProdLi Pro (see “ProdLi Pro (paid plan)” above).`,
  },
  {
    title: "AI summaries, briefs, reviews, transcripts and answers",
    body: `Summaries, daily briefs, weekly reviews, page summaries, suggested tasks and Ask ProdLi answers are generated automatically by Anthropic's Claude models, and audio transcripts by an automatic speech model. They can be incomplete or wrong. Check important details against the transcript, the recording or the page before you rely on them.`,
  },
  {
    title: "Our software",
    body: `ProdLi's software, design and name belong to us. We give you a personal, non-exclusive, non-transferable licence to use ProdLi under these terms. If you send us feedback, we may use it without obligation to you.`,
  },
  {
    title: "Availability, changes and backups",
    body: `We work to keep ProdLi available and your data safe, including with nightly backups. But ProdLi is provided "as is", without a guarantee that it will always be available or error-free. Keep your own copies of important data (account window → Download my data, or 💾 Backup in the app).

We may change or remove features. If we decide to shut down the sync service, we'll give you at least 30 days' notice so you can download your data.`,
  },
  {
    title: "Ending",
    body: `You can stop using ProdLi and delete your account at any time. We may suspend or close an account that seriously or repeatedly breaks these terms, or where the law requires it. Unless the law prevents it, we'll tell you why and give you a chance to download your data.`,
  },
  {
    title: "Liability",
    body: `To the extent the law allows, we aren't liable for indirect or consequential losses, or for loss of data beyond restoring it from our backups where possible. Our total liability to you for any claim is limited to the amount you paid us in the 12 months before the claim (or ₹1,000 / US$15 if you use the free plan). Nothing in these terms limits liability that the law doesn't allow us to limit, or your rights as a consumer.`,
  },
  {
    title: "Changes to these terms",
    body: `We may update these terms. For significant changes, we'll tell signed-in users in the app or by email at least 15 days before the changes take effect. If you keep using ProdLi after that, the new terms apply. If you don't agree, you can delete your account.`,
  },
  {
    title: "Law and disputes",
    body: `These terms are governed by the laws of India, and the courts where ProdLi's operator is based in India have jurisdiction. This doesn't take away any mandatory consumer protection you have under the law of the country where you live, including the right to bring claims in your local courts.`,
  },
  {
    title: "Contact",
    body: `contact@prodli.com`,
  },
];

export function Privacy() {
  return <LegalPage title="Privacy Policy" sections={PRIVACY_SECTIONS} />;
}

export function Terms() {
  return <LegalPage title="Terms of Service" sections={TERMS_SECTIONS} />;
}

function LegalPage({ title, sections }: { title: string; sections: { title: string; body: string }[] }) {
  return (
    <div style={{ fontFamily: "var(--font)", background: "var(--bg)", minHeight: "100vh" }}>

      {/* Nav */}
      <nav style={{
        borderBottom: "var(--border)",
        background: "#000",
        padding: "0 32px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: 56,
      }}>
        <Link to="/" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Logo size={24} />
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <a href="https://app.prodli.com" style={{ color: "#fff", fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Log in
          </a>
          <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer" className="nb-btn" style={{ fontSize: 11, padding: "8px 18px" }}>
            Add to Chrome →
          </a>
        </div>
      </nav>

      {/* Content */}
      <div className="privacy-content" style={{ maxWidth: 720, margin: "0 auto", padding: "60px 32px 80px" }}>
        <div className="privacy-card" style={{
          border: "var(--border)", background: "var(--card)",
          padding: "40px 48px", boxShadow: "var(--shadow-lg)",
        }}>
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.15em", color: "var(--muted)", marginBottom: 12 }}>
            Legal
          </div>
          <h1 style={{ fontWeight: 900, fontSize: 32, letterSpacing: "-0.02em", marginBottom: 8 }}>
            {title}
          </h1>
          <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 40 }}>
            Last updated: {LAST_UPDATED}
          </p>

          {sections.map((section, i) => (
            <div key={i} style={{ marginBottom: 36 }}>
              <h2 style={{
                fontWeight: 900, fontSize: 14, textTransform: "uppercase",
                letterSpacing: "0.08em", marginBottom: 10,
                borderBottom: "2px solid #000", paddingBottom: 8,
              }}>
                {section.title}
              </h2>
              <p style={{ fontSize: 14, lineHeight: 1.75, whiteSpace: "pre-line", color: "var(--fg)" }}>
                {section.body}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <footer style={{ borderTop: "var(--border)", background: "#000", padding: "20px 32px", display: "flex", alignItems: "center", justifyContent: "center", gap: 24 }}>
        <span style={{ color: "#555", fontSize: 12, fontWeight: 700 }}>© 2026 ProdLi</span>
        <a href="mailto:contact@prodli.com" style={{ color: "#888", fontSize: 12, fontWeight: 700 }}>contact@prodli.com</a>
        <Link to="/privacy" style={{ color: "#888", fontSize: 12, fontWeight: 700 }}>Privacy</Link>
        <Link to="/terms" style={{ color: "#888", fontSize: 12, fontWeight: 700 }}>Terms</Link>
      </footer>
    </div>
  );
}
