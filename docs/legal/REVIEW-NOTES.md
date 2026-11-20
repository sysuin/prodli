# Privacy policy and terms: notes for legal review

Drafts:
- privacy policy: prodli.com/privacy; source `PRIVACY_SECTIONS` in `artifacts/prodli-site/src/pages/Privacy.tsx`
- terms: prodli.com/terms; source `TERMS_SECTIONS` in the same file

Both were checked line by line against the code on 9 November 2026. This page lists the facts behind them, what still has to be filled in, and the decisions to confirm.

## 1. Drafted details — reviewed

**Lawyer review done (17 November 2026).** Since then, one factual line was added to the policy's browser permissions: the optional `downloads` permission used by "Open files from anywhere".


To publish the updated site, the placeholders were filled with **assumptions** (13 November 2026), to be corrected after legal review. Nothing was invented that would be false; where a fact wasn't known, the wording stays general.

| Detail | Drafted as | Where | To confirm |
|---|---|---|---|
| Operator (controller) | Sunny Singh, an individual based in India | Privacy: "Who we are"; Terms: "Agreement" | Individual or a company? Exact legal name |
| Postal address | "available on request at contact@prodli.com" | Privacy: "Who we are" | Add the real postal address if required (GDPR Art. 13 asks for the controller's contact details) |
| Grievance officer (India) | Sunny Singh, contact@prodli.com | Privacy: "Who we are" | Name / contact as required by the DPDP Rules |
| Courts | "the courts where ProdLi's operator is based in India" | Terms: "Law and disputes" | Name the city |
| Payments | Dodo Payments as reseller / merchant of record | Privacy: processors; Terms: "ProdLi Pro" | Dodo's exact legal entity name and its required wording |

## 2. Decisions to confirm with the lawyer

1. **Minimum age is 18 for accounts** (policy, terms and the sign-in screen). This avoids the verifiable parental consent that India's DPDP Act requires for under-18s; the GDPR would allow 13–16. Without an account nothing is collected, so younger people can still use ProdLi locally. Lower it only if you'll add parental consent.
2. **Legal bases:** contract (the service), legitimate interests (security and abuse prevention), and the user's choice (meeting uploads, AI summaries). For the DPDP Act, consent at sign-in. Confirm the wording, and whether a separate consent checkbox is needed (today, signing in shows "By signing in you agree to…").
3. **Liability cap:** amount paid in the last 12 months, or ₹1,000 / US$15 on the free plan. Confirm it's enforceable for consumers in India and the EU.
4. **Governing law:** India, keeping mandatory consumer protections where the user lives.
5. **Notice periods:** 15 days for terms changes, 30 days before shutting down sync.
6. **Data transfers:** relies on the providers' data processing terms. Cloudflare and Anthropic include standard contractual clauses. For sign-in, Google acts largely as an independent controller. Confirm this is enough for EU/UK users.
7. **Meeting transcripts:** they contain other people's words. The policy and terms put notice and consent on the user, and there's a per-computer switch to stop uploading meetings. Confirm this is adequate (India, EU and US two-party-consent states).

## 3. What ProdLi stores (facts behind the policy)

| Data | Where | Kept | Code |
|---|---|---|---|
| Google ID (`sub`), email, name, picture URL, plan, created / updated / last seen | Cloudflare D1 `users` | until account deletion | `artifacts/prodli-api/migrations/0001_accounts.sql` |
| Session: SHA-256 hash of a random token, client (extension/web), "Browser on OS", created / last used / expiry | D1 `sessions` | 180 days idle (extension), 30 days idle (web), or sign-out | `src/accounts.ts` |
| AI summaries used per month (a count only) | D1 `ai_usage` | until account deletion | `src/ai.ts` |
| Last backup time and sequence number | D1 `backups` | until account deletion | `src/backup.ts` |
| Synced items: notes, to-dos, habits, meetings (text, no audio), Pomodoro sessions and count, Time Tracker days (hostname → seconds) | one Durable Object per user (SQLite) | until the user deletes them or the account | `src/syncStore.ts` |
| Nightly backup of the synced items | R2 `prodli-backups`, `users/<id>/<date>/` | 30 days (bucket rule); deleted immediately with the account | `src/backup.ts` |
| Request logs (IP, user agent, URL, status, time), never request bodies | Cloudflare Workers Logs | 7 days | `observability` in `wrangler.jsonc` |
| Live-update ticket (random, single use) | Durable Object | 60 seconds | `src/userStore.ts` |
| Daily briefs used per month (a count only) | D1 `brief_usage` | until account deletion | `src/brief.ts` |
| Ask ProdLi questions used per month (a count only) | D1 `ask_usage` | until account deletion | `src/ask.ts` |
| Writing help (✨ Improve) uses per month (a count only; the text isn't stored) | D1 `write_usage` | until account deletion | `src/write.ts` |
| Today: each day's focus, reflection and the brief text | the user's Durable Object (`days` collection) | until deleted | `artifacts/prodli/src/sections/TodaySection.tsx` |

**Never stored on ProdLi's servers:**
- meeting audio;
- settings (theme, fonts, tracker settings);
- the content sent to Anthropic, beyond the resulting summary saved with the meeting.

**Account deletion:** deletes the user row, sessions, AI counts and backup row in D1; wipes the user's Durable Object; deletes their R2 backups. Cloudflare's own point-in-time recovery for D1 and Durable Objects keeps data for up to 30 days.

**Google Calendar (optional, Today page):**
- Scope `calendar.readonly`, requested only when the user clicks "Connect Google Calendar".
- Today's events are read in the browser; they're not stored on the server.
- Event titles and times go to Anthropic only inside an AI brief request.
- It's a sensitive scope, so Google verification is needed before publishing the consent screen.

**Google scopes:**
- ProdLi accounts request only `openid email profile`, in both the extension and the web.
- Builds without a ProdLi server (Drive sync) also request `drive.appdata`.
- A device that used Drive sync before has its Drive copy merged once, using the permission it already granted.

**Add to ProdLi (extension):**
- The right-click menu uses the `contextMenus` permission, which shows no install warning.
- It reads the page title, URL and selection only when the user clicks the menu, and saves them locally as a to-do or note.
- The Quick add shortcut reads the active tab's title and URL.

**Open files from anywhere in Chrome (extension):**
- `webNavigation` notices when a local `.md`, `.csv`, `.json`, `.txt` or code file is opened in a tab. It shows the same install warning as the existing `tabs` permission.
- The optional `file:///*` permission and Chrome's "Allow access to file URLs" switch let ProdLi read that file in the Files viewer.
- Files are read on the device only; nothing is uploaded or stored on the server.

**Cookies:**
- One strictly necessary cookie, `__Host-prodli_session` (HttpOnly, Secure, SameSite=Lax, up to 30 days), set only by app.prodli.com.
- No analytics or advertising.
- The web app loads Google Identity Services and Google Fonts.

## 4. Processors

| Provider | Role | Data |
|---|---|---|
| Cloudflare, Inc. | hosting, D1, Durable Objects, R2, logs | everything above |
| Google LLC | sign-in (Google Identity Services, `chrome.identity`) | Google profile, at sign-in |
| Anthropic, PBC | AI summaries and daily briefs through ProdLi (Claude Haiku 5.5) | summaries: transcript, meeting name and date; briefs: open task titles, priorities, due dates and estimates, habit names and streaks, today's calendar event titles and times, recent meeting action items, yesterday's top sites and focus sessions, focus and reflection notes; Ask ProdLi: the question, the last few chat messages, the same day context, and up to 8 short note or meeting excerpts matching the question (chosen on the device). Sent only when used. Chats aren't stored. |

## 5. Other places that must match the policy
- **Google Cloud consent screen:**
  - app name;
  - support email;
  - links: app.prodli.com, prodli.com/privacy and prodli.com/terms;
  - authorized domain prodli.com;
  - scopes: `openid`, `email` and `profile` (plus `drive.appdata` while the Drive-sync build exists).
- **Chrome Web Store "Privacy practices":**
  - data types: "Personally identifiable information" (name, email), "Authentication information", "Personal communications" (meeting transcripts), "Website content" (notes, files viewed locally), "Web history" (Time Tracker hostnames);
  - certify the Limited Use disclosures;
  - privacy policy link: prodli.com/privacy.
- **In the app:** the sign-in screen links to the terms and privacy policy and asks for confirmation of age 18+.

## 6. Changes from the previous privacy policy
The previous policy said ProdLi had no servers and synced only through the user's own Google Drive. The new one covers:
- accounts and server-side sync;
- AI summaries through ProdLi;
- request logs, cookies and international transfers;
- retention and backups;
- users' rights;
- the operator's identity.

The terms are new.

## 7. Changes since the lawyer review (20 November 2026)

The policy and terms were updated for the features added on 18–20 November. Each statement was checked against the code. **These additions haven't been reviewed by the lawyer yet.**

**New data on the device only:** task lists, labels, repeats and reminders; note templates; site categories; blocked sites, focus hours and daily pause counts; Ask ProdLi saved prompts, schedules and scheduled answers; the meeting type and the word list.

**New synced collections** (one Durable Object per user, like the rest): `lists` (to-do lists), `tabSessions` (titles and **full web addresses** of tabs the user saves), `quickLinks` (titles and addresses), `readLater` (page titles and addresses). Code: `prodli-api/src/syncStore.ts` `COLLECTIONS`.

**New AI processing:**
| Feature | Sent | To | Stored on our servers |
|---|---|---|---|
| Audio transcription (🌐 on a meeting; **automatic after Zoom and Teams calls, on by default**, can be turned off) | WAV pieces of the recording (silence skipped), the word list as a hint | Cloudflare Workers AI (Whisper) | no; minutes counted in D1 `transcribe_usage` |
| Page summaries (right-click) | page title, address, up to 24,000 characters of page text | Anthropic | no |
| Speak tasks | the spoken text (up to 4,000 characters) and the user's list names | Anthropic | no |
| Daily brief (meeting prep, focus score) | for matched meetings: title, time, last-met date, last summary overview, open action items, related to-do titles; yesterday's focus score | Anthropic | no (the brief is saved with the day) |
| Weekly review (categories) | the week's focus score and minutes per site category | Anthropic | no |
| Scheduled Ask prompts | as Ask ProdLi, sent by the extension in the background at the chosen times | Anthropic | no (answer kept on the device) |
| Meeting summaries | adds the meeting type and the word list | Anthropic | no |

**Google:**
- Calendar: invitees' names and email addresses are now read on the device to match events with past meetings (meeting prep). They're never sent or stored.
- Chrome's speech recognition (Speak tasks; on-device meeting transcription) runs on the device when Chrome supports it, otherwise **Chrome sends the audio to Google's speech service**. ProdLi never receives that audio. The policy says so; Google acts under its own terms there.

**Permissions:** `search`, `activeTab` and `scripting` are now required (Today's search box; reading the page for "Summarize page"; Meet's caption reader). The Focus List redirect no longer requests extra permissions; focus blocking uses `tabs`. The recorder's optional `tabCapture`/`offscreen` now also cover Zoom and Teams tabs (no host access to them).

**Terms:** free and Pro limits now include audio transcription (300 and 1,500 minutes a month). "Your content" and the AI disclaimer cover transcription, page summaries and suggested tasks.

**Decisions to confirm:**
1. **Automatic transcription of Zoom and Teams calls is on by default.** It sends other participants' voices to a processor without a prompt for each call. The setting explains this and can be turned off, and the user is responsible for consent. Confirm the default is acceptable, or whether it should be off by default or ask once.
2. **Speech recognition fallback to Google.** Confirm the disclosure is enough, or whether Speak tasks should refuse to run when on-device recognition isn't available.
3. **Full web addresses** are now synced for saved tabs, quick links and Read later. The Chrome Web Store "Privacy practices" should list "Web history" and "Website content" accordingly (page text for summaries).

**Also updated to match:** the website's FAQ and pricing (prodli.com), and in the app the Meetings Setup text and the account window ("meeting audio is never synced" instead of "never uploaded").

**Added later on 20 November 2026 (in-person recording):** "🎙 Record in person" records from the microphone on the Meetings page (extension and web app). The recording stays on the device. Like Zoom/Teams calls, it's transcribed with AI automatically when it ends if the user is signed in and the setting is on (same setting, on by default). Policy updated: device data, audio transcription and microphone access. The consent decision in item 1 above applies here too (people in the room).

**Added later on 20 November 2026 (more call apps):** the recorder also recognises Webex, Slack huddles, Discord voice, Jitsi and Whereby in the browser, and an optional "Record any website" setting (off by default) lets the toolbar icon record any tab. It works the same as Zoom/Teams: tab audio, automatic AI transcription after the call if signed in and the setting is on. No new permissions (tab capture follows the toolbar click). Policy wording now says "calls in your browser (Google Meet, Zoom, Microsoft Teams, Webex, Slack, Discord and others)".

## 8. Pro features and shared links (20 November 2026, not yet reviewed)

- **Shared meeting notes:** a user can share a meeting's summary as a read-only link (`app.prodli.com/s/<random id>`). The server stores a snapshot (title, date, length, summary, never the transcript or audio) in D1 `shares` until the link expires (7 or 30 days, or never with Pro), the user stops sharing, or the account is deleted. The view count is kept. The page is noindex, runs no scripts and has a strict CSP. Code: `prodli-api/src/shares.ts`. Policy section "Shared meeting notes"; Terms "Your content" adds that users must only share notes with people who should see them.
- **Your own meeting templates (Pro):** the template's name, instructions and section headings go to Anthropic with the transcript. Policy updated under "Meeting summaries".
- **Pro-only features** are free for everyone until Pro goes on sale ("early access"); the Terms say they may become Pro-only then.

**Decisions to confirm:**
1. Sharing meeting summaries publishes other participants' words to whoever has the link. Is the user-responsibility wording enough, or should the share panel also ask the user to confirm the participants agreed?
2. Is "may make them Pro-only once it does" in the Terms enough notice for features that are free during early access?
- **AI meeting prep (Pro):** sends the upcoming meeting's title/time and, from the last meeting with those people, its summary overview, decisions, open action items with owners and open questions, plus related to-do titles, to Anthropic. Not stored; counted with briefs. Policy updated in the AI section.
- **Talk timeline:** with the mic included, a timeline of who was talking (you vs. the call) is kept with the meeting and synced as text, to label transcripts and show talk time. Policy updated (device data and sync).

