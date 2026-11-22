# Plan: Mail section (Gmail dashboard with on-device AI)

**Status:** parked for later (2026-11-23). Listed in [TODO.md](../TODO.md) → Next ideas.

## Context
The user wants a ProdLi section built from the user's Gmail: read the whole mailbox, with AI, and **without paying** for Google's yearly security assessment (CASA).

Google requires CASA for restricted Gmail scopes when email data is "stored or transmitted on servers". So the design keeps email entirely in the user's browser:
- Gmail is read with `gmail.readonly` through the same Google sign-in Calendar already uses.
- AI runs on the user's computer with Chrome's built-in model (Prompt API, `LanguageModel`, available to extensions from Chrome 138).
- No email content reaches ProdLi's server, sync, backups, the brief or Ask.

Costs are zero:
- In Google's **Testing** mode it works now for the owner and up to 100 listed testers.
- Public use needs Google's free restricted-scope verification: justification, demo video, privacy policy.
- **Risk:** Google's wording on on-device-only apps isn't fully explicit, and a reviewer could still ask for CASA. If so, the fallback is staying in Testing mode.

Scope: the Chrome extension only. The web app and the phone and desktop apps show "Available in the ProdLi Chrome extension". The section is named **Mail**, because "Inbox" already names the To-Dos inbox view and the Ask inbox.

## Design

### 1. Gmail access: new `artifacts/prodli/src/lib/gmail.ts`
Modelled on `src/lib/calendar.ts`.

**Connection**
- `GMAIL_SCOPE = gmail.readonly` and `GMAIL_KEY = "gmailConnected"`.
- `gmailAvailable()`, `isGmailConnected()`, `connectGmail()`, `disconnectGmail()`.
- Scopes are requested at runtime: `getToken(interactive, [...PROFILE_SCOPES, GMAIL_SCOPE])` from `src/lib/google.ts`, the same way Calendar does it. The manifest needs no change, because `identity` is already there.

**Reading mail**
- `listRecent({ days: 7, max: 60 })` calls `users.messages.list` with `q=in:inbox newer_than:7d`, then `messages.get?format=metadata` for each message, at most 6 at a time.
  - Fields kept: From, To, Subject, Date, `List-Unsubscribe`, snippet, labelIds, threadId, and whether the message is unread or marked Important.
- `waitingOn()` returns sent threads from the last 14 days whose last message is from the user (`in:sent`, plus a thread metadata check).
- `getBody(id)` fetches `format=full` when an email is opened. It decodes base64url MIME, prefers text/plain, and falls back to HTML stripped to text, capped at about 8k characters.

**Links and errors**
- Each email gets an "Open in Gmail" link: `https://mail.google.com/mail/u/0/#all/<threadId>`.
- On a 401 it retries once, the same way Calendar does. A 401 or 403 that persists throws `GmailError("Reconnect Gmail…")`.

**Test hook**
- `__prodliGmailStub`, used only when `VITE_E2E === "1"`, the same way `calendarStub()` works.

### 2. On-device AI: new `src/lib/onDeviceAi.ts`
**Model status**
- `aiStatus()` reports "available", "downloadable", "downloading" or "unavailable", plus the reason.
- `ensureModel(onProgress)` handles the one-time download and shows progress.
- `triage(emails)` processes batches of about 8, using `responseConstraint` (a JSON schema).
  - Each email gets a category: `reply` (needs your reply), `action`, `fyi`, `newsletter`, `receipt` or `other`.
  - It also gets a one-line summary and an optional suggested to-do.
- `summarize(body)` and `draftReply(body, tone)`.
- Test hook: `__prodliOnDeviceAiStub` under `VITE_E2E`.

**Fallback when Chrome's AI is unavailable** (older Chrome, under 22 GB free disk, weak hardware):
- `classifyByRules()` in the same file:
  - `List-Unsubscribe` or a bulk sender → newsletter;
  - noreply senders, or receipt words in the subject → receipt or fyi;
  - mail sent directly to the user from a person, ending in a question or marked important → needs reply.
- The section says why AI is off, and everything except summaries and drafts still works.

**Cache**
- Triage results are cached by message id in IndexedDB under the key `mailTriage`. This key must **stay out of** `DATA_KEYS`/`SETTINGS_KEYS_V11` (`src/lib/backupRestore.ts`) and `WATCHED_KEYS` (`src/lib/prodliSync.ts`).
- A unit test guards this.

### 3. The section: new `src/sections/MailSection.tsx`
Plus small pieces under `src/sections/mail/`.

**Not connected:** an explainer ("Your email never leaves this computer") and a "Connect Gmail" button.

**Connected: the dashboard**
- Count tiles: Needs reply, To do, Waiting on others, Newsletters, Unread.
- Lists by category. Each row shows the sender, subject, AI one-liner, age, an "Open in Gmail" link and an **Add to to-dos** button.
- Clicking an email opens a reading panel:
  - the body, loaded when needed;
  - **Summarize** and **Draft a reply** (on-device);
  - the draft can be copied, or opened in Gmail compose with a prefilled body. Opening compose needs no send permission.
- Newsletters list sender volume and an unsubscribe link taken from the `List-Unsubscribe` header.

**Controls and Settings**
- A refresh button. Refresh also runs automatically when the section opens, and at most every 5 minutes.
- Disconnecting Gmail clears `mailTriage`.

**Add to to-dos**
- Calls `addTask({ title, url })` from `src/lib/capture.ts`. The to-do is prefilled as "Reply to <sender name>" and the url is the Gmail thread link. No subject or body is included.
- Then `flash("Added to your to-dos")`.
- Because to-dos sync to the server, the user edits and confirms the title before it is created. The plan leaves out email content by default.

### 4. Wiring a new section
These are the files the explore pass named:
- `src/types.ts`: add `"mail"` to the `Section` union.
- `src/sections/registry.ts`: add a `SECTIONS` entry (✉️, "Mail", shortcut **9**, description and pitch).
- `src/App.tsx`: add it to `importers`, add a `lazy()` import, and render `{section === "mail" && …}`.
- In non-extension builds the section shows the "Available in the Chrome extension" notice.

**Today (optional, local only):** a small "3 emails need a reply →" chip, worked out on the device. It is **not** added to `contextFrom()` in `src/lib/today.ts`, so the brief sent to the server never includes email.

### 5. Docs and Google setup
**Docs to update**
- `Privacy.tsx` / prodli.com privacy page: what Gmail data is read, that it's processed only on the device, never sent to ProdLi's servers, never used for ads or training, and the Google API Limited Use statement.
- Help (the new section), `docs/GOOGLE-SIGN-IN.md` (the Gmail scope and steps), `docs/PLAN-ASSISTANT.md` (update the "Email in the brief" item), `STORE_SUBMISSION.md`/`REVIEW-NOTES` (data disclosure).

**Google Cloud console** (in the user's Chrome, with their go-ahead at that step)
- Enable the Gmail API and add `gmail.readonly` to the consent screen in Testing mode.
- After it ships: submit restricted-scope verification with a written justification and a demo video. The user records the video; I prepare the script and the justification text.

### 6. Tests
**Unit** (`tests/unit/mail.test.ts`)
- MIME and base64url decoding, and HTML to text.
- The rule-based classifier.
- Parsing triage JSON, including malformed model output.
- Cache keys never appear in the sync or backup key lists.
- The `Section` registry includes "mail" with shortcut 9.

**e2e** (a `mail` suite in `tests/e2e/run.mjs`, using both stubs)
- Connect, then see the dashboard tiles and lists.
- Open an email and use Summarize and Draft.
- Add to to-dos, and the to-do appears.
- The fallback path when the AI stub reports "unavailable".
- Disconnect clears it.
- Also update the `smoke` suite's hardcoded tab list.

## Verification
- `pnpm --filter @workspace/prodli typecheck`, unit tests and the full e2e set (`test:e2e`).
- **Real check in the user's Chrome** after the Cloud console step:
  - load the built extension, connect Gmail with the owner account (a test user), and check that the real inbox loads;
  - check that Chrome's built-in model downloads and triages;
  - check in DevTools' Network panel that no request carrying email data goes to `app.prodli.com`.
- Ship as one PR. Merge after CI, following the standing rule. The store upload stays manual.

## Out of scope
- Sending, archiving or labelling mail. That needs `gmail.modify`/`gmail.send`, which are more restricted scopes.
- Outlook, the web app, and the mobile and desktop apps.
- Server-side AI on email (Claude). It would trigger the paid CASA.
