# Privacy policy and terms: notes for legal review

Drafts:
- privacy policy: prodli.com/privacy; source `PRIVACY_SECTIONS` in `artifacts/prodli-site/src/pages/Privacy.tsx`
- terms: prodli.com/terms; source `TERMS_SECTIONS` in the same file

Both were checked line by line against the code on 9 November 2026. This page lists the facts behind them, what still has to be filled in, and the decisions to confirm.

## 1. Drafted details — the lawyer must check these

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
