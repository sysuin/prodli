# ProdLi web app + accounts — build plan

Status: **approved** (2026-11-09). Phase 0 done (site on Cloudflare, API on staging). Phase 1 (accounts) done on staging; next: phase 2 (sync).

Decisions so far:
- Everything runs on Cloudflare, in the same account as your other products, with guardrails.
- Sign in with Google only.
- Launch free with fair limits; the server is ready for a Pro plan later.
- ProdLi's servers store users' data.

## 1. What users get

| | Extension | prodli.com (web app) |
|---|---|---|
| Editor, to-dos, habits, Pomodoro, Files | ✅ | ✅ |
| Meetings: transcripts, summaries, action items | ✅ record + view | ✅ view, search, re-summarise |
| Time tracker | ✅ tracks + views | ✅ views (tracking needs the extension) |
| New-tab page, Meet recording, captions | ✅ | — (browser limits) |
| Works offline | ✅ | ✅ (syncs when back online) |
| Same data everywhere, live | ✅ | ✅ |

- One account (Google) works in both.
- Edits appear on the user's other open devices within about a second.

## 2. Architecture

```
 Extension (chrome.storage)        Web app at app.prodli.com (IndexedDB)
            \                                  /
             \──── HTTPS + WebSocket ─────────/
                          │
            Cloudflare Worker "prodli-api"  (app.prodli.com/api)
             ├─ Auth: verify Google sign-in → ProdLi session
             ├─ D1 "prodli-core": users, sessions, plans, quotas
             ├─ Durable Object per user "UserStore": that user's data (SQLite)
             ├─ R2 "prodli-files": attachments (later) · "prodli-backups": nightly exports
             └─ Claude Haiku 5.5 (server key) for AI summaries, with a monthly quota
 prodli.com (marketing site) → Cloudflare static hosting (replaces Replit)
```

**Why one small database per user (Durable Object):**
- *Isolation by design.* The server picks the database from the signed-in session, never from anything the browser sends. A bug can't hand user A's notes to user B.
- *Live sync.* Each user's object holds the WebSocket connections for that user's open devices. It uses hibernation, so idle connections cost nothing.
- *Cheap and scalable.* Storage costs $0.20/GB-month (vs $0.75 in a shared D1 database), with no shared-database size ceiling.

**Local-first stays.**
- Every device keeps its own copy (the extension already works this way).
- The app is instant and works offline.
- The server is the meeting point and the backup.

**Sync protocol:**
- Each item (note, to-do, habit, meeting, setting, tracker day) has an id, `updatedAt` and `deleted` flag. This is the model the extension already uses for multi-tab and Drive merging.
- Devices push changed items and pull everything after their last server sequence number.
- Conflicts on the same item: the newest edit wins. That's the same rule as today.
- Two people editing the same note at the same second is out of scope for v1. A note-level conflict copy is kept so nothing silently disappears. Real-time co-editing (CRDT) can come later with sharing.

**Meeting audio never leaves the device.** Transcripts and summaries sync (they're small text). Syncing transcripts is a per-user setting, on by default, with a clear explanation, because transcripts contain other people's words.

**Extension ↔ server:**
- The server allows the extension's origin (CORS), so the extension needs **no new permission and shows no new install warning**.
- Sign-in uses `chrome.identity` as today. The server verifies the Google token and returns a ProdLi session.
- Web sign-in uses Google Identity Services and a new "Web application" OAuth client.

## 3. Data, privacy and security

- **What's stored:** account (Google ID, email, name, picture), plan and quotas, and the user's ProdLi items. Claude API keys and meeting audio are never stored.
- **Encryption:** in transit (TLS) and at rest (Cloudflare). No end-to-end encryption in v1; it would break server search and AI. It can come later as "private notes".
- **Access:** no admin "view user data" screen. Logs never contain note content.
- **User rights:**
  - Export everything (JSON + Markdown zip) and delete the account from Settings.
  - Deletion removes live data immediately. Backups age out within 30 days.
  - A "sign out everywhere" button.
- **Limits (free):**
  - 100 MB of data per user;
  - 20 AI summaries per month;
  - request rate limits per user and per IP;
  - item size caps.
- **Backups:**
  - Durable Objects and D1 keep 30 days of restore points.
  - A nightly export goes to R2, kept for 30 days.
  - A restore drill is part of launch checks.
- **Laws:** India's DPDP Act and GDPR for EU users. The plan includes:
  - a rewritten privacy policy and terms;
  - data-processor list: Cloudflare, Google (sign-in), Anthropic (summaries);
  - a breach-response checklist.
  - Have a lawyer review the policy before launch; I can draft it, but it isn't legal advice.
- **Secrets:**
  - Anthropic key and session signing key are stored as Worker secrets.
  - CI uses a Cloudflare token limited to what deploys need.
  - Separate staging and production environments, with separate data.

## 4. Build phases (each ends in a PR you review)

| Phase | What ships | Done when |
|---|---|---|
| **0. Foundations** | `artifacts/prodli-api` Worker; staging + production; CI deploys; prodli.com site on Cloudflare (Replit retired) | Health check live on staging; prodli.com served by Cloudflare |
| **1. Accounts** | Google sign-in (extension + web), sessions, users table, Account page (export, delete, sign out everywhere) | Sign in/out on both; export and delete work end-to-end |
| **2. Sync** | UserStore Durable Object, sync engine in the app, live updates, one-time import of local + Drive data; Drive sync retired (file export stays) | Two browsers + extension stay in sync, offline edits merge, deletions sync, nothing lost on import |
| **3. Web app** | app.prodli.com with all sections, offline cache, mobile-friendly layout | Every section usable on desktop and phone browsers |
| **4. AI via ProdLi** | Server summaries with monthly quota; "use my own key" stays as an option | Summaries work without a key; quota enforced |
| **5. Launch hardening** | Privacy/terms, limits, backups + restore drill, monitoring + alerts, load test, Web Store submission, Google consent screen published | Checklist complete; launch |
| **Later: Pro** | Payments (Razorpay or Stripe), Pro limits; plan flags already exist from phase 1 | — |

Testing at every phase:
- unit tests for the Worker and sync logic;
- headless-browser end-to-end tests of the extension and web app against a local server;
- accessibility checks.
Nothing is deployed to production until staging passes.

## 5. What I'll need from you (at the time it's needed)

1. **Phase 0:** create a Cloudflare API token for CI (I'll give exact permissions) and paste it as a GitHub secret. Cloudflare shows it only once, and I can't paste secrets.
2. **Phase 1:** OK for me to add a "Web application" OAuth client and app.prodli.com to the Google Cloud project.
3. **Phase 4:** put your Anthropic API key into the Worker (`wrangler secret put ANTHROPIC_API_KEY`, one command).
4. **Phase 5:** review the privacy policy/terms (ideally with a lawyer), click **Publish app** on Google's consent screen, and submit to the Chrome Web Store.
5. Anytime: change the default limits (100 MB, 20 summaries/month) if you want different numbers.

## 6. Monthly cost

- Uses your existing Workers Paid + R2 subscriptions.
- ProdLi's extra cost is about **$0 at launch**, **~$10–25 at 10,000 daily users**, and **~$150–300 at 100,000 daily users**.
- AI summaries add ≈ $0.0025 per hour-long meeting, capped by the free quota.

## 7. Risks and how they're handled

| Risk | Mitigation |
|---|---|
| A bug exposes one user's data to another | Per-user database chosen only from the verified session; tests that try cross-user access |
| Data loss during migration from local/Drive | Import is additive (never deletes), keeps a local backup file, and is tested with real-shaped data |
| Runaway costs or abuse | Per-user quotas, rate limits, Cloudflare usage alerts, AI capped per month |
| Same note edited on two devices at once | Newest wins plus a conflict copy; co-editing later |
| Google-only excludes some users | Email sign-in links can be added later (Cloudflare Email Sending, already available) |
